/* The activity feed.

   Everything here is a diff against what the page looked like last time, which
   makes the failure modes specific: an event that fires again on every visit, a
   first visit that invents a history it never saw, a live player producing a
   fresh entry every fifteen minutes rather than one that gets rewritten. Each
   of those reads as a working feed and is worthless. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load() {
    const ctx = {
        console,
        escHTML: (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
        localStorage: {
            _d: {},
            getItem(k) { return k in this._d ? this._d[k] : null; },
            setItem(k, v) { this._d[k] = String(v); },
            removeItem(k) { delete this._d[k]; }
        },
        // Enough of a document for the click-away listener to register.
        document: { getElementById: () => null, querySelector: () => null, addEventListener: () => {} }
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    const f = 'scripts/notifications.js';
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInContext(ctx);
    return ctx;
}

const squad = [
    { id: 1, name: 'Saka', status: 'a', news: '' },
    { id: 2, name: 'Haaland', status: 'a', news: '' },
    { id: 3, name: 'Raya', status: 'a', news: '' }
];
const T0 = Date.UTC(2026, 8, 5, 12, 0);

test('a first visit invents no history for a squad with nothing wrong', () => {
    /* There is nothing to diff against, and forty things that happened before
       you arrived is noise dressed as a record. A fit squad has nothing
       standing either, so a first visit is still silent. */
    const nt = load();
    const events = nt.ntCollect({ squad, live: {}, phase: 'live', gw: 4, now: T0, prev: null });
    assert.deepEqual([...events], []);
});

test('a first visit still reports the flags the squad is carrying', () => {
    /* The feed is a diff, which is the wrong shape for someone who has never
       been here: nothing has changed, so the bell was empty even with an
       injured player in the squad. What is true now is reported once. */
    const nt = load();
    const hurt = [
        { id: 1, name: 'Saka', status: 'i', news: 'Hamstring' },
        { id: 2, name: 'Haaland', status: 'a', news: '' },
        { id: 3, name: 'Raya', status: 'd', news: 'Knock — 75% chance' }
    ];
    const events = [...nt.ntCollect({ squad: hurt, live: {}, phase: 'pre', gw: 4, now: T0, prev: null })];
    assert.equal(events.length, 2, 'only the two who are flagged');
    const saka = events.find(e => e.title === 'Saka');
    assert.ok(/injured/.test(saka.body), saka.body);
    assert.equal(saka.tone, 'bad');
    assert.equal(events.find(e => e.title === 'Raya').tone, 'warn');
});

test('a standing flag is raised once, not again on the next visit', () => {
    /* Its id is the one the change-based path would give it, so the second
       visit — which now has a snapshot and finds no change — adds nothing,
       and the merge does not produce a duplicate. */
    const nt = load();
    const hurt = [{ id: 1, name: 'Saka', status: 'i', news: 'Hamstring' }];
    const first = nt.ntUpdate({ squad: hurt, live: {}, phase: 'pre', gw: 4, now: T0 });
    assert.equal(first.events.length, 1);
    const second = nt.ntUpdate({ squad: hurt, live: {}, phase: 'pre', gw: 4, now: T0 + 60000 });
    assert.equal(second.events.length, 1, 'still the one entry');
    assert.equal(second.fresh, 0, 'and nothing new was collected');
});

test('a player picking up a knock is an event, and only once', () => {
    const nt = load();
    const before = nt.ntSnapshot(squad, {}, 'upcoming', 4);
    const hurt = squad.map(p => p.id === 1 ? { ...p, status: 'd', news: 'Knock - 75% chance' } : p);

    const first = nt.ntCollect({ squad: hurt, live: {}, phase: 'upcoming', gw: 4, now: T0, prev: before });
    assert.equal(first.length, 1);
    assert.equal(first[0].kind, 'squad-news');
    assert.equal(first[0].tone, 'bad');
    assert.match(first[0].body, /Saka is a doubt — Knock - 75% chance/);

    // Same state again: the snapshot has moved on, so nothing repeats.
    const after = nt.ntSnapshot(hurt, {}, 'upcoming', 4);
    assert.deepEqual([...nt.ntCollect({ squad: hurt, live: {}, phase: 'upcoming', gw: 4, now: T0 + 1e6, prev: after })], []);
});

test('recovering is reported as the good news it is', () => {
    const nt = load();
    const hurt = squad.map(p => p.id === 1 ? { ...p, status: 'i' } : p);
    const prev = nt.ntSnapshot(hurt, {}, 'upcoming', 4);
    const events = nt.ntCollect({ squad, live: {}, phase: 'upcoming', gw: 4, now: T0, prev });
    assert.equal(events.length, 1);
    assert.equal(events[0].tone, 'good');
    assert.match(events[0].body, /is fit again/);
});

test('a live player gets one entry that is rewritten, not a stream', () => {
    /* The alternative produces twelve rows for one good afternoon: a row at
       kickoff, one per goal, and several more as provisional bonus moves. */
    const nt = load();
    const prev = nt.ntSnapshot(squad, {}, 'live', 4);

    const atHalfTime = nt.ntCollect({
        squad, live: { 1: { pts: 6, min: 45, g: 1 } }, phase: 'live', gw: 4, now: T0, prev
    });
    assert.equal(atHalfTime.length, 1);
    assert.match(atHalfTime[0].title, /Saka — 6 points/);
    assert.match(atHalfTime[0].body, /1 goal/);

    const later = nt.ntCollect({
        squad, live: { 1: { pts: 13, min: 90, g: 2, b: 3 } }, phase: 'live', gw: 4,
        now: T0 + 3600000, prev: nt.ntSnapshot(squad, { 1: { pts: 6, min: 45, g: 1 } }, 'live', 4)
    });
    assert.equal(later[0].id, atHalfTime[0].id, 'the same event, so it replaces rather than stacks');
    assert.match(later[0].title, /13 points/);
    assert.match(later[0].body, /2 goals, 3 bonus · 90'/);

    const merged = nt.ntMerge([atHalfTime[0]], later, T0 + 3600000);
    assert.equal(merged.length, 1, 'one row in the feed, not two');
    assert.match(merged[0].title, /13 points/, 'showing the latest state');
});

test('an unchanged live line produces nothing', () => {
    // Otherwise every fifteen-minute refresh marks the whole squad unread.
    const nt = load();
    const live = { 1: { pts: 2, min: 90 }, 2: { pts: 6, min: 90, g: 1 } };
    const prev = nt.ntSnapshot(squad, live, 'live', 4);
    assert.deepEqual([...nt.ntCollect({ squad, live, phase: 'live', gw: 4, now: T0, prev })], []);
});

test('a red card is bad news however many points he has', () => {
    const nt = load();
    const prev = nt.ntSnapshot(squad, { 1: { pts: 8, min: 60, g: 1 } }, 'live', 4);
    const events = nt.ntCollect({
        squad, live: { 1: { pts: 5, min: 71, g: 1, rc: 1 } }, phase: 'live', gw: 4, now: T0, prev
    });
    assert.equal(events[0].tone, 'bad');
    assert.match(events[0].body, /red card/);
});

test('players outside your squad are ignored', () => {
    // The feed is about your fifteen; the rest of the league is a different page.
    const nt = load();
    const prev = nt.ntSnapshot(squad, {}, 'live', 4);
    const events = nt.ntCollect({
        squad, live: { 999: { pts: 20, min: 90, g: 3 } }, phase: 'live', gw: 4, now: T0, prev
    });
    assert.deepEqual([...events], []);
});

test('the gameweek turning over is an event on its own', () => {
    /* The only kind that fires when nothing about the squad changed at all,
       which is exactly when a manager wonders whether the page is working. */
    const nt = load();
    const prev = nt.ntSnapshot(squad, {}, 'upcoming', 4);
    const locked = nt.ntCollect({ squad, live: {}, phase: 'locked', gw: 4, now: T0, prev });
    assert.equal(locked.length, 1);
    assert.match(locked[0].title, /GW4 is locked/);

    const done = nt.ntCollect({
        squad, live: {}, phase: 'upcoming', gw: 4, now: T0,
        prev: nt.ntSnapshot(squad, {}, 'live', 4)
    });
    assert.match(done[0].title, /GW4 is done/);

    // Standing still is not an event.
    assert.deepEqual([...nt.ntCollect({ squad, live: {}, phase: 'locked', gw: 4, now: T0, prev: nt.ntSnapshot(squad, {}, 'locked', 4) })], []);
});

test('unread is measured against the last time the panel was opened', () => {
    const nt = load();
    const events = [
        { id: 'a', at: T0 - 1000, title: 'Old', body: '', tone: 'info' },
        { id: 'b', at: T0 + 1000, title: 'New', body: '', tone: 'good' }
    ];
    assert.equal(nt.ntUnread(events, T0), 1);
    assert.equal(nt.ntUnread(events, 0), 2, 'never opened means everything is new');
    assert.equal(nt.ntUnread(events, T0 + 5000), 0);
});

test('the log is capped by age and by count', () => {
    const nt = load();
    const old = { id: 'ancient', at: T0 - 20 * 86400000, title: 'x', body: '', tone: 'info' };
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `e${i}`, at: T0 - i * 1000, title: 'x', body: '', tone: 'info' }));
    const merged = nt.ntMerge([old], many, T0);
    assert.ok(merged.length <= 60, `capped, got ${merged.length}`);
    assert.ok(!merged.some(e => e.id === 'ancient'), 'a fortnight is the limit');
    assert.ok(merged[0].at >= merged[merged.length - 1].at, 'newest first');
});

test('a pass persists its snapshot even when it produced nothing', () => {
    /* Otherwise the second visit compares against nothing again, and the first
       real change is missed. */
    const nt = load();
    const first = nt.ntUpdate({ squad, live: {}, phase: 'upcoming', gw: 4, now: T0 });
    assert.equal(first.fresh, 0, 'nothing to say on a first visit');
    assert.ok(first.snapshot && first.snapshot.status[1] === 'a', 'but it remembers');

    const hurt = squad.map(p => p.id === 1 ? { ...p, status: 'i' } : p);
    const second = nt.ntUpdate({ squad: hurt, live: {}, phase: 'upcoming', gw: 4, now: T0 + 86400000 });
    assert.equal(second.fresh, 1, 'and catches the change next time');
    assert.equal(second.unread, 1);
});

test('opening the panel is what marks things read', () => {
    // Marking on render means a badge can be missed by blinking.
    const nt = load();
    nt.ntUpdate({ squad, live: {}, phase: 'upcoming', gw: 4, now: T0 });
    const hurt = squad.map(p => p.id === 1 ? { ...p, status: 'i' } : p);
    const after = nt.ntUpdate({ squad: hurt, live: {}, phase: 'upcoming', gw: 4, now: T0 + 1000 });
    assert.equal(after.unread, 1);

    // Re-rendering without opening leaves it unread.
    assert.equal(nt.ntUpdate({ squad: hurt, live: {}, phase: 'upcoming', gw: 4, now: T0 + 2000 }).unread, 1);

    nt.ntMarkSeen(T0 + 3000);
    assert.equal(nt.ntUpdate({ squad: hurt, live: {}, phase: 'upcoming', gw: 4, now: T0 + 4000 }).unread, 0);
});

test('the panel separates what is new from what is not', () => {
    const nt = load();
    /* No hrefs: neither a live score nor a gameweek phase has anywhere to
       send you, which is what ntCollect now emits for both. */
    const events = [
        { id: 'b', at: T0 + 1000, title: 'Saka — 13 points', body: '2 goals', tone: 'good' },
        { id: 'a', at: T0 - 90000000, title: 'GW3 is done', body: 'planning time', tone: 'info' }
    ];
    const html = nt.ntPanelHTML(events, T0, T0 + 2000);
    assert.match(html, /Since your last visit/);
    assert.match(html, /Earlier/);
    assert.match(html, /Saka — 13 points/);
    assert.match(html, /nt-row good/);
    assert.ok(html.indexOf('Since your last visit') < html.indexOf('Earlier'), 'new first');
});

/* ===== which rows are clickable =====

   Every row used to be an <a> defaulting to index.html, so a gameweek notice
   read on the dashboard reloaded the page you were already on — and the rows
   that did lead somewhere real looked exactly like the ones that did not. The
   destination is the difference now, and it is decided where the event is made
   rather than guessed at from its text. */

test('a row with nowhere to go is text, not a link', () => {
    const nt = load();
    const html = nt.ntPanelHTML(
        [{ id: 'p', at: T0, title: 'GW5 is locked', body: 'Your team is set.', tone: 'info' }], 0, T0);
    assert.match(html, /<div class="nt-row info">/);
    assert.doesNotMatch(html, /<a class="nt-row/);
    assert.doesNotMatch(html, /index\.html/, 'and it does not invent a destination');
});

test('a squad-news row keeps the jump to that player, in place', () => {
    const nt = load();
    const html = nt.ntPanelHTML(
        [{ id: 's', at: T0, title: 'Saka', body: 'is injured', tone: 'bad',
           href: 'fpl-my-team-analysis.html#squad?player=7' }], 0, T0);
    assert.match(html, /<a class="nt-row is-link bad" href="fpl-my-team-analysis\.html#squad\?player=7"/);
    // An internal jump is where you were going anyway, so it does not open a tab.
    assert.doesNotMatch(html, /target="_blank"/);
});

test('an injury story opens the club\u2019s own page in a new tab', () => {
    const nt = load();
    const html = nt.ntPanelHTML(
        [{ id: 'i', at: T0, title: 'Tete', body: 'Fulham: Team News', tone: 'bad',
           href: 'https://www.fulhamfc.com/news/team-news' }], 0, T0);
    assert.match(html, /<a class="nt-row is-link bad" href="https:\/\/www\.fulhamfc\.com\/news\/team-news" target="_blank" rel="noopener noreferrer"/);
});

test('the events that carry no destination really carry none', () => {
    /* The renderer decides by asking the event, so this is the half that has
       to hold: a live line and a phase line must arrive without an href. */
    const nt = load();
    const squad = [{ id: 1, name: 'Saka', status: 'a' }];
    const prev = { status: { 1: 'a' }, stats: { 1: { pts: 0, min: 0 } }, phase: 'upcoming', inj: [] };
    const out = nt.ntCollect({
        squad, live: { 1: { pts: 6, min: 90, g: 1 } }, phase: 'live', gw: 5, now: T0, prev
    });
    const live = out.find(e => e.kind === 'live');
    const phase = out.find(e => e.kind === 'phase');
    assert.ok(live, 'a live line was raised');
    assert.equal(live.href, undefined, 'what he scored is not a place');
    assert.ok(phase, 'a phase line was raised');
    assert.equal(phase.href, undefined, 'nor is the gameweek turning over');
});

test('an empty feed explains itself rather than showing a blank box', () => {
    const nt = load();
    const html = nt.ntPanelHTML([], 0, T0);
    assert.match(html, /Nothing yet/);
    assert.match(html, /news on your players/);
});

test('names in events are escaped', () => {
    const nt = load();
    const html = nt.ntPanelHTML([{ id: 'x', at: T0, title: '<img src=x onerror=alert(1)>', body: 'y', tone: 'info' }], 0, T0);
    assert.ok(!/<img/.test(html));
    assert.ok(html.includes('&lt;img'));
});

/* The bell is a row in the sidebar's account menu now rather than a bare
   circular icon, and a row has somewhere to put a number — so the count is
   back, in place of the dot that stood in for it while there was no room.
   What has not changed, and is the thing worth pinning, is that an unread
   mark appears only when something is actually unread. */
test('the bell only carries a count when there is something behind it', () => {
    const nt = load();
    assert.doesNotMatch(nt.ntBellHTML(0), /nt-count/);
    assert.doesNotMatch(nt.ntBellHTML(0), /has-new/);
    assert.match(nt.ntBellHTML(0), /Nothing new/);
    assert.match(nt.ntBellHTML(3), /nt-count/);
    assert.match(nt.ntBellHTML(3), /has-new/);
});

/* Two digits would push the row's label out of shape, so the chip stops at
   9+ — which means the exact figure has to survive somewhere else. It is in
   the label, which is also what a screen reader reads out. */
test('a count too big for the chip is still exact in the bell label', () => {
    const nt = load();
    assert.match(nt.ntBellHTML(3), />3</);
    assert.match(nt.ntBellHTML(14), />9\+</);
    assert.match(nt.ntBellHTML(3), /3 new since your last visit/);
    assert.match(nt.ntBellHTML(14), /14 new since your last visit/);
});

test('a finished player is not described as still having time', () => {
    // "yet" is a promise, and at ninety minutes there is nothing left to promise.
    const nt = load();
    const prev = nt.ntSnapshot(squad, {}, 'live', 4);
    const mid = nt.ntCollect({ squad, live: { 1: { pts: 1, min: 40 } }, phase: 'live', gw: 4, now: T0, prev });
    assert.match(mid[0].body, /no returns yet/);

    const full = nt.ntCollect({ squad, live: { 1: { pts: 2, min: 90 } }, phase: 'live', gw: 4, now: T0, prev });
    assert.match(full[0].body, /no returns · 90'/);
    assert.doesNotMatch(full[0].body, /yet/);

    const unused = nt.ntCollect({ squad, live: { 1: { pts: 0, min: 0 } }, phase: 'live', gw: 4, now: T0, prev });
    assert.match(unused[0].body, /yet to feature/);
});

/* ---------------------------------------------------------------------------
   Club injury news about your fifteen.

   A different signal from the availability diff above, and worth both: a
   manager speaks at a press conference on Thursday, and the game's flag may
   follow on Friday, or never if the player is passed fit.

   "New" here means new to this reader, not new to the table. A story can sit in
   the Premier League's table for a fortnight and still be the first time you
   have seen it — so the snapshot carries the article URLs already shown, and
   the diff is against that rather than against the table's own contents. */

const ARTICLE = 'https://www.arsenal.com/news/artetas-update';
const LATER = 'https://www.arsenal.com/news/a-later-update';

// Two of mine on one story, plus a player I do not own. playerId is resolved by
// the scrape (tools/fetch-pl-injuries.mjs), never by the browser.
const injuryRows = (url) => ([
    { url, playerId: 1, player: 'Ben White', club: 'Arsenal', injury: 'Knock',
      articleTitle: "Arteta's update on White, Mosquera and Timber", published: '2026-09-04T14:00:00.000Z' },
    { url, playerId: 3, player: 'Cristhian Mosquera', club: 'Arsenal', injury: 'Muscle',
      articleTitle: "Arteta's update on White, Mosquera and Timber", published: '2026-09-04T14:00:00.000Z' },
    { url, playerId: 404, player: 'Someone Else', club: 'Arsenal', injury: 'Back',
      articleTitle: "Arteta's update on White, Mosquera and Timber", published: '2026-09-04T14:00:00.000Z' }
]);
const injuryEvents = (events) => [...events].filter(e => e.kind === 'injury-news');

test('a first visit reports no injury stories at all', () => {
    // Forty standing stories on arrival is noise dressed as news.
    const nt = load();
    const events = nt.ntCollect({
        squad, live: {}, phase: 'upcoming', gw: 4, now: T0, prev: null, injuries: injuryRows(ARTICLE)
    });
    assert.deepEqual(injuryEvents(events), []);
});

test('a story already shown does not come back', () => {
    const nt = load();
    const prev = nt.ntSnapshot(squad, {}, 'upcoming', 4, injuryRows(ARTICLE));
    /* Spread first. The snapshot is built inside the vm realm, so its array
       carries that realm's prototype and deepStrictEqual rejects it as "same
       structure but not reference-equal" — the hazard load.mjs documents, and
       the reason every other assertion in this file spreads before comparing. */
    assert.deepEqual([...prev.inj], [ARTICLE], 'the snapshot records the article once, not once per player');
    const again = nt.ntCollect({
        squad, live: {}, phase: 'upcoming', gw: 4, now: T0 + 1e6, prev, injuries: injuryRows(ARTICLE)
    });
    assert.deepEqual(injuryEvents(again), []);
});

test('a new story names every player of yours it is about, once', () => {
    const nt = load();
    const prev = nt.ntSnapshot(squad, {}, 'upcoming', 4, injuryRows(ARTICLE));
    const events = injuryEvents(nt.ntCollect({
        squad, live: {}, phase: 'upcoming', gw: 4, now: T0,
        prev, injuries: [...injuryRows(ARTICLE), ...injuryRows(LATER)]
    }));
    assert.equal(events.length, 1, 'one entry per article, not one per player');
    assert.equal(events[0].href, LATER, 'it opens the club\u2019s own report');
    assert.equal(events[0].id, `inj-${LATER}`);
    assert.match(events[0].title, /Saka/);
    assert.match(events[0].title, /Raya/);
    assert.ok(!/Someone Else/.test(events[0].title + events[0].body),
        'a player you do not own is never named');
});

test('a row the scrape could not resolve is silent', () => {
    /* playerId is null when the name was ambiguous — two players with one
       surname at the same club, say. Silence is the only safe answer: a guess
       here tells someone their defender is hurt when he is not. */
    const nt = load();
    const prev = nt.ntSnapshot(squad, {}, 'upcoming', 4, []);
    const events = nt.ntCollect({
        squad, live: {}, phase: 'upcoming', gw: 4, now: T0, prev,
        injuries: [{ url: LATER, playerId: null, player: 'Ambiguous Name', club: 'Arsenal',
                     injury: 'Knee', articleTitle: 'Someone is hurt', published: null }]
    });
    assert.deepEqual(injuryEvents(events), []);
});

test('a snapshot saved before this existed does not dump the whole table', () => {
    /* Anyone upgrading has a stored snapshot with no `inj` list. Reading that as
       "seen nothing" would fire every standing story at once on their next
       visit — the exact backlog a first visit is careful to avoid. */
    const nt = load();
    const old = nt.ntSnapshot(squad, {}, 'upcoming', 4);
    delete old.inj;
    const events = nt.ntCollect({
        squad, live: {}, phase: 'upcoming', gw: 4, now: T0, prev: old, injuries: injuryRows(ARTICLE)
    });
    assert.deepEqual(injuryEvents(events), []);
});

test('the club\u2019s date is used, and only for ordering when it is missing', () => {
    const nt = load();
    const prev = nt.ntSnapshot(squad, {}, 'upcoming', 4, []);
    const dated = injuryEvents(nt.ntCollect({
        squad, live: {}, phase: 'upcoming', gw: 4, now: T0, prev, injuries: injuryRows(ARTICLE)
    }));
    assert.equal(dated[0].at, Date.parse('2026-09-04T14:00:00.000Z'));

    const undated = injuryEvents(nt.ntCollect({
        squad, live: {}, phase: 'upcoming', gw: 4, now: T0, prev,
        injuries: [{ url: LATER, playerId: 1, player: 'Ben White', club: 'Arsenal',
                     injury: 'Knock', articleTitle: 'Update', published: null }]
    }));
    assert.equal(undated[0].at, T0, 'no published date falls back to now rather than to NaN');
});
