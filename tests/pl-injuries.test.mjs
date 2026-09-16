/* The Premier League injury fetcher's pure half.

   The browser half cannot be tested here — it needs Chromium and the live page,
   and the workflow guards that end with a shape check before anything is
   committed. What is testable is everything that decides what gets stored: the
   outbound link, the date, the club, and the order.

   Each of these protects a specific way the feed could quietly lie:

   - The table's Details links carry premierleague.com's own campaign
     parameters. Passing them on would report our readers' clicks as Premier
     League referrals.
   - The table has no date column at all — "Latest" is the link. Dates come from
     the club article behind it, and an article with no date has to keep a null.
     A feed sorted by timestamp, where some timestamps are invented, is wrong
     about which news is newest while looking right.
   - A club that does not match the FPL feed gets no id rather than a near one,
     because the id draws a crest and the wrong crest beside a player's name is
     worse than none. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cleanUrl, publishedFrom, titleFrom, buildClubMap, sortItems, decodeEntities, looksMisaligned }
    from '../tools/fetch-pl-injuries.mjs';

// The real link behind "Ben White / Knock / Details".
const ARSENAL = 'https://www.arsenal.com/news/artetas-update-on-white-mosquera-and-timber-axoYv8N7qYHf'
    + '?utm_source=premier-league-web&utm_medium=referral&utm_campaign=pl-referral-always-on'
    + '&utm_term=injury-news';

test('the outbound link loses the Premier League campaign tags', () => {
    assert.equal(cleanUrl(ARSENAL),
        'https://www.arsenal.com/news/artetas-update-on-white-mosquera-and-timber-axoYv8N7qYHf');
});

test('a link a reader needs keeps its real query', () => {
    assert.equal(cleanUrl('https://a.com/news?id=7'), 'https://a.com/news?id=7');
    assert.equal(cleanUrl('https://a.com/news?id=7&utm_source=x'), 'https://a.com/news?id=7');
});

test('an unusable href is dropped rather than stored', () => {
    assert.equal(cleanUrl('Details'), null);
    assert.equal(cleanUrl(null), null);
});

test('the same article under two campaign tags is one article', () => {
    // Twenty clubs, one update covering three players — the articles are fetched
    // once each by URL, and that only works if the URLs match.
    const a = cleanUrl(ARSENAL);
    const b = cleanUrl(ARSENAL.replace('injury-news', 'something-else'));
    assert.equal(a, b);
});

test('a date is read from whichever shape the club site uses', () => {
    assert.equal(publishedFrom('<meta property="article:published_time" content="2026-09-15T14:02:00Z">'),
        '2026-09-15T14:02:00.000Z');
    assert.equal(publishedFrom('<meta content="2026-09-14T09:00:00Z" property="article:published_time">'),
        '2026-09-14T09:00:00.000Z', 'attribute order is not fixed across sites');
    assert.equal(publishedFrom('{"@type":"NewsArticle","datePublished":"2026-09-13T08:30:00Z"}'),
        '2026-09-13T08:30:00.000Z');
    assert.equal(publishedFrom('<time datetime="2026-09-12T10:00:00Z">12 Sep</time>'),
        '2026-09-12T10:00:00.000Z');
});

test('no date means null, never a stand-in', () => {
    assert.equal(publishedFrom('<html><body>Arteta spoke today</body></html>'), null);
    assert.equal(publishedFrom('<meta property="article:published_time" content="soon">'), null,
        'an unparseable value must not become Invalid Date');
});

test('the article title comes off og:title, or the tag', () => {
    assert.equal(titleFrom('<meta property="og:title" content="Update on White and Timber">'),
        'Update on White and Timber');
    assert.equal(titleFrom('<title>  Club   news  </title>'), 'Club news');
    assert.equal(titleFrom('<p>nothing</p>'), null);
});

test('every club the Premier League names maps to an FPL club', () => {
    // If this fails, a real club is rendering with no crest.
    const boot = JSON.parse(fs.readFileSync(new URL('../data/bootstrap-static.json', import.meta.url), 'utf8'));
    const idFor = buildClubMap(boot.teams);
    const missed = boot.teams.map(t => t.name).filter(n => idFor(n) == null);
    assert.deepEqual(missed, []);
    assert.equal(idFor('Arsenal'), idFor('ARS'), 'long and short names are the same club');
});

test('a club that does not match gets no crest rather than the wrong one', () => {
    const idFor = buildClubMap([{ id: 1, name: 'Arsenal', short_name: 'ARS' }]);
    assert.equal(idFor('Real Madrid'), null);
    assert.equal(idFor(''), null);
});

test('the feed is newest first, with the undated behind all of it', () => {
    const order = sortItems([
        { player: 'C', club: 'Wolves', published: null },
        { player: 'A', club: 'Arsenal', published: '2026-09-10T00:00:00.000Z' },
        { player: 'B', club: 'Arsenal', published: '2026-09-15T00:00:00.000Z' },
        { player: 'D', club: 'Aston Villa', published: null }
    ]).map(x => x.player).join('');
    // B and A are dated, newest first. C and D have no date, so they sort by
    // club — Aston Villa before Wolves — rather than drifting to the top.
    assert.equal(order, 'BADC');
});

test('an all-undated table still comes out in a stable order', () => {
    const items = [
        { player: 'Saliba', club: 'Arsenal', published: null },
        { player: 'White', club: 'Arsenal', published: null },
        { player: 'Onana', club: 'Aston Villa', published: null }
    ];
    assert.equal(sortItems(items).map(x => x.player).join(','), 'Saliba,White,Onana');
    // Sorting twice must not shuffle it.
    assert.deepEqual(sortItems(sortItems(items)).map(x => x.player), sortItems(items).map(x => x.player));
});

/* The first live run passed every shape check the workflow had — ten or more
   rows, a player name on each, a quarter carrying links, no campaign tags — on
   data in which not one player was actually named. The table puts the name in
   the row's <th>, the extractor read only <td>, and so every row came back one
   column out of step: "Groin" and "Ankle" stored as players, and "Details", the
   link's own label, stored as the injury on 71 of 71 rows.

   A shape check cannot catch that, because the shape was right. This one looks
   at the content instead. */
test('a table read one column out of step is refused', () => {
    // What the broken run produced: one value repeated down the injury column.
    const slipped = Array.from({ length: 20 }, () => ({ player: 'Knee', injury: 'Details', club: 'Arsenal' }));
    const verdict = looksMisaligned(slipped);
    assert.ok(verdict, 'this is the exact failure that shipped');
    assert.match(verdict, /Details/);
    assert.match(verdict, /slipped/);
});

test('a real spread of injuries is not refused', () => {
    const real = ['Knock', 'Muscle', 'Back', 'ACL', 'Thigh', 'Foot', 'Calf', 'Quad', 'Knee', 'Hamstring']
        .map((injury, n) => ({ player: `P${n}`, injury, club: 'Arsenal' }));
    assert.equal(looksMisaligned(real), null);
});

test('a handful of rows is too few to condemn', () => {
    // Two players with the same injury is a coincidence, not a parsing fault.
    assert.equal(looksMisaligned([
        { player: 'A', injury: 'Knock' }, { player: 'B', injury: 'Knock' }
    ]), null);
});

test('headlines come out of meta content decoded', () => {
    // Meta attributes are escaped, and the page escapes again when it renders —
    // so an undecoded "&amp;" reaches the reader as "&amp;".
    assert.equal(titleFrom('<meta property="og:title" content="Sage hints at Sarr &amp; Nketiah returns">'),
        'Sage hints at Sarr & Nketiah returns');
    assert.equal(decodeEntities('Arteta&#39;s update'), "Arteta's update");
    assert.equal(decodeEntities('Arteta&rsquo;s update'), 'Arteta\u2019s update');
    assert.equal(decodeEntities('5 &lt; 6'), '5 < 6');
    assert.equal(decodeEntities('&notanentity; survives'), '&notanentity; survives');
});
