#!/usr/bin/env node
/* The Premier League's club-by-club injury table, and the club articles behind it.
 *
 * Every URL on premierleague.com returns the same ~80KB client-rendered shell:
 * the injuries page has no injury rows in it, /en/clubs has no club links, and
 * sitemap_index.xml answers with HTML. Four API spellings were probed — three
 * 404, and api.premierleague.com/content/premierleague/injuries/en answers 400,
 * the same "path is right, query is wrong" wall that fetch-pl-news.mjs spent a
 * long investigation on. So this renders the page, the way the news fetcher
 * ended up doing.
 *
 * What the table gives, per club:
 *
 *     Player              Injury   Latest
 *     Ben White           Knock    [Details]
 *     Cristhian Mosquera  Muscle   [Details]
 *
 * There is no date column — "Latest" is the Details link. That link leaves
 * premierleague.com for the club's own site, and THAT is the news:
 * arsenal.com/news/artetas-update-on-white-mosquera-and-timber. One article
 * usually covers several players, so the articles are fetched once each, by
 * URL, and carry the date the feed is ordered by.
 *
 * A row whose article has no discoverable date keeps a null. It is never given
 * the run time or the page's own "last update" stamp — an invented timestamp in
 * a feed sorted by timestamp is a lie about which news is newest.
 *
 * Usage:
 *   node tools/fetch-pl-injuries.mjs --out data/injuries.json
 *   node tools/fetch-pl-injuries.mjs --dump      # write the rendered HTML to inspect
 */
import fs from 'node:fs';

const PAGE = 'https://www.premierleague.com/en/latest-player-injuries';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const argOf = name => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : null;
};
const DUMP = process.argv.includes('--dump');
const OUT = argOf('--out');

/* premierleague.com tags every outbound link with its own campaign parameters.
   Passing those on would report our readers' clicks as Premier League referrals,
   which they are not, so they come off before the URL is stored or deduped. */
export function cleanUrl(raw) {
    try {
        const u = new URL(raw);
        [...u.searchParams.keys()]
            .filter(k => /^utm_/i.test(k) || k === 'fbclid' || k === 'gclid')
            .forEach(k => u.searchParams.delete(k));
        u.hash = '';
        return u.toString();
    } catch {
        return null;
    }
}

/* A date out of an article page, without a browser: club sites are ordinary
   server-rendered pages. Three places carry it, in descending order of how much
   the standard says they mean it. Anything unparseable is no date rather than a
   guess. */
export function publishedFrom(html) {
    const patterns = [
        /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i,
        /<meta[^>]+name=["'](?:pubdate|publish-date|date)["'][^>]+content=["']([^"']+)["']/i,
        /"datePublished"\s*:\s*"([^"]+)"/i,
        /<time[^>]+datetime=["']([^"']+)["']/i
    ];
    for (const re of patterns) {
        const m = html.match(re);
        if (!m) continue;
        const t = Date.parse(m[1]);
        if (Number.isFinite(t)) return new Date(t).toISOString();
    }
    return null;
}

/* Meta content is HTML-escaped, so a headline arrives as "Sarr &amp; Nketiah"
   and would render with the entity showing — the page escapes what it is given,
   as it must, and double-escaping is what that produces. */
export function decodeEntities(s) {
    return String(s == null ? '' : s)
        .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, code) => {
            if (code[0] === '#') {
                const n = code[1] === 'x' || code[1] === 'X'
                    ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
                return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
            }
            const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
                            rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c',
                            ndash: '\u2013', mdash: '\u2014', hellip: '\u2026' };
            return Object.prototype.hasOwnProperty.call(named, code.toLowerCase())
                ? named[code.toLowerCase()] : whole;
        });
}

export function titleFrom(html) {
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (!og) return null;
    return decodeEntities(og[1]).replace(/\s+/g, ' ').trim().slice(0, 200) || null;
}

/* The article's own picture.
 *
 * An injury card had the club crest on the club's colour and nothing else,
 * because the Premier League's table carries no image and nothing here went
 * looking for one. But the article behind the link is already being fetched —
 * that is where the headline and the date come from — and essentially every
 * club story carries an og:image for the sake of Facebook and Twitter. It costs
 * one more regex over HTML already in hand.
 *
 * Both meta orders, because the two are equally common in the wild and a
 * pattern that insists on property-then-content silently misses half of them.
 * twitter:image second: a handful of club CMSes set only that one.
 *
 * Only absolute http(s) survives. A root-relative /img/hero.jpg is resolvable
 * in principle and not worth the guessing — the crest is a good answer and a
 * broken image is not. Data URIs and SVG sprites are turned away for the same
 * reason: this is a photograph slot.
 */
/* Four shapes, in the order of how much they mean. og:image is the club
 * saying "this is the picture for this story"; twitter:image is the same claim
 * from the handful of CMSes that set only that; link rel=image_src is the old
 * spelling some still emit; and the JSON-LD article block is where a headless
 * CMS puts it when it emits no social meta at all.
 *
 * On one real scrape 22 of 43 articles answered on og:image alone, and three
 * Crystal Palace pages were read successfully and gave up no picture at any of
 * them — which is what the last two entries are for. They can only find an
 * image where the ones above it found none, so they cannot change an answer
 * that already works.
 */
const IMAGE_META = [
    /<meta[^>]+property=["']og:image(?::url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
    /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']image_src["']/i,
    /"image"\s*:\s*"([^"]+)"/i,
    /"image"\s*:\s*\{[^{}]*?"url"\s*:\s*"([^"]+)"/i,
    /"image"\s*:\s*\[\s*"([^"]+)"/i,
    /"image"\s*:\s*\[\s*\{[^{}]*?"url"\s*:\s*"([^"]+)"/i
];

export function imageFrom(html) {
    const text = String(html == null ? '' : html);
    for (const re of IMAGE_META) {
        const m = text.match(re);
        if (!m) continue;
        /* JSON escapes its slashes, and a URL that came out of a script block
           carries \/ where the markup ones carry /. */
        const url = decodeEntities(m[1].replace(/\\\//g, '/')).trim();
        if (!/^https?:\/\//i.test(url)) continue;
        if (/\.svg(\?|#|$)/i.test(url)) continue;
        return url.replace(/^http:\/\//i, 'https://').slice(0, 500);
    }
    return null;
}

/* Does this look like the table was read a column out of step? That is what the
   first run produced, and every shape check it had to pass — ten rows, a name on
   each, a quarter carrying links, no campaign tags — passed on data in which not
   one player was actually named. The tell is the injury column: it holds a dozen
   different words across eighty players, and if instead it holds one word over
   and over, that word is the link's label and the columns have slipped. */
export function looksMisaligned(items) {
    const named = items.filter(i => i.injury);
    if (named.length < 8) return null;
    const counts = new Map();
    for (const i of named) counts.set(i.injury, (counts.get(i.injury) || 0) + 1);
    const [word, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return n / named.length > 0.5
        ? `"${word}" is the injury on ${n} of ${named.length} rows — the columns have slipped`
        : null;
}

/* Is this article actually about who is fit?

   The table's "Latest" link is whatever the club most recently published that
   its editors thought relevant, and that is often not an injury story at all.
   Across one real scrape of 45 articles it included a match report ("Leeds
   United 4 Newcastle United 1"), two confirmed line-ups, a pre-match press
   conference, a piece about a training camp, and one whose entire title was
   "Newcastle United".

   Judged here rather than on the page, for the same reason the player id is:
   the push Worker has to make the same call, and a notification about a
   training camp is worse than the card is.

   Two passes. Anything that is plainly another kind of article is out, and what
   remains has to say something about fitness to stay in. Deliberately the way
   round that errs towards dropping: a missed injury story is a card the reader
   does not see, while a press conference in an injury feed is the feed lying
   about what it is.

   A title we never managed to read is null, not false — unknown, not rejected.
   Those rows still carry the table's own facts, which are what the card falls
   back to. */
const INJ_NOT_NEWS = /\bconfi?rmed\s+line-?up\b|\bline-?ups?\b|\bpress\s+conference\b|\btraining\s+camp\b|\bhighlights\b|\bmatch\s+report\b|\breport\b|\b\d+\s*-\s*\d+\b|\b\w+\s+\d+\s+\w+.*\s+\d+\s*\|/i;
const INJ_IS_NEWS = /injur|fitness|\bteam\s*news\b|\bsquad\s*news\b|\bruled\s+out\b|\bsidelined\b|\bsurgery\b|\bsetback\b|\bscan\b|\bdoubt|\breturn|\bcomeback\b|\brecover|\bavailab|\babsent\b|\bmiss\b|\bmisses\b|\bout\s+of\b|\bback\b|\bupdate|\blatest\b|\bfit\b|\bunavailab/i;

export function looksLikeInjuryNews(title) {
    if (!title) return null;
    if (INJ_NOT_NEWS.test(title)) return false;
    return INJ_IS_NEWS.test(title);
}

/* Which FPL player is this row about?

   Resolved here, once, rather than in every consumer. The page needs it to mark
   your own players, and the push Worker needs the same answer — and the Worker
   cannot import scripts/common.js, which is a classic browser script. Two copies
   of a name-matching rule is two rules the moment one of them is edited, so the
   scrape decides it and writes the id into the file. Unmatched stays null.

The injury table names players the way a newspaper does — "Ben White" — and
   FPL names them its own way: first_name "Benjamin", second_name "White",
   web_name "White". So the first names genuinely disagree for the same man, and
   matching on them would miss him.

   Surname alone is not enough either. The table lists a Julian Araujo; this feed
   has a Ronald Araujo, who is a different person at a different club. Four clubs
   also carry two players with the same surname — two Fletchers, two Murphys, two
   Mileys, two Angulos. Attaching an injury to the wrong player is worse than
   attaching it to nobody, so:

     1. the club must match, which is the constraint that separates the Araujos;
     2. the surname must appear as a whole word in the table's name;
     3. one survivor is a match, several are not — unless the first names
        settle it, allowing Ben for Benjamin and Alex for Alexander, because
        shortened forms are exactly what a match report uses.

   Anything unresolved returns null. No badge, no notification, no guess. */
export function plNormaliseName(s) {
    return String(s == null ? '' : s)
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

// Ben/Benjamin, Alex/Alexander — one a prefix of the other, and long enough
// that "A" does not stand in for "Amadou".
export function plFirstNamesAgree(a, b) {
    const x = plNormaliseName(a).split(' ')[0] || '';
    const y = plNormaliseName(b).split(' ')[0] || '';
    if (!x || !y) return false;
    if (x === y) return true;
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    return short.length >= 3 && long.startsWith(short);
}

/* players: objects carrying { teamId, secondName, firstName }. Returns the one
   player this row is about, or null. */
export function plMatchInjuredPlayer(rowName, clubId, players) {
    if (!rowName || clubId == null || !Array.isArray(players)) return null;
    const tokens = plNormaliseName(rowName).split(' ').filter(Boolean);
    if (!tokens.length) return null;
    const tokenSet = new Set(tokens);

    const sameClub = players.filter(p => p && p.teamId === clubId);
    const bySurname = sameClub.filter(p => {
        const parts = plNormaliseName(p.secondName || p.name).split(' ').filter(Boolean);
        const surname = parts[parts.length - 1];
        return surname && tokenSet.has(surname);
    });

    if (bySurname.length === 1) return bySurname[0];
    if (bySurname.length === 0) return null;
    const byFirst = bySurname.filter(p => plFirstNamesAgree(rowName, p.firstName || ''));
    return byFirst.length === 1 ? byFirst[0] : null;
}


/* Club name -> FPL team id, so the page can draw a crest. Matching is exact
   after normalising case and the handful of spellings that differ between the
   two feeds; anything that does not match keeps a null id and renders without a
   crest. Guessing here would put the wrong badge next to a player's name. */
export function buildClubMap(bootstrapTeams) {
    const map = new Map();
    const norm = s => String(s || '').toLowerCase()
        .replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    const alias = {
        'brighton and hove albion': 'brighton', 'tottenham hotspur': 'spurs',
        'wolverhampton wanderers': 'wolves', 'afc bournemouth': 'bournemouth',
        'west ham united': 'west ham', 'newcastle united': 'newcastle',
        'nottingham forest': "nott'm forest", 'manchester united': 'man utd',
        'manchester city': 'man city', 'leeds united': 'leeds'
    };
    for (const t of bootstrapTeams) {
        map.set(norm(t.name), t.id);
        map.set(norm(t.short_name), t.id);
    }
    return name => {
        const n = norm(name);
        if (map.has(n)) return map.get(n);
        const a = alias[n];
        if (a && map.has(norm(a))) return map.get(norm(a));
        // "Arsenal FC" -> "Arsenal"
        const stripped = n.replace(/\b(fc|afc|united|city|albion|hotspur|wanderers)\b/g, '').trim();
        return map.has(stripped) ? map.get(stripped) : null;
    };
}

/* When this scrape first saw each article, carried across runs.

   Two thirds of the club articles publish no date we can read, and those rows
   still have to sit somewhere sensible in a feed ordered by time. First-seen is
   a true fact about our own observation, so it can order them — but it is not
   the publication date and is never shown as one. The page sorts on it and
   displays nothing where `published` is null.

   It is also what makes "new" mean anything: an article whose URL was not in
   the last run is new, which is the signal the squad notification needs. */
export function carryFirstSeen(previousItems, nowIso) {
    const seen = new Map();
    for (const i of previousItems || []) {
        if (i && i.url && i.firstSeen && !seen.has(i.url)) seen.set(i.url, i.firstSeen);
    }
    return url => (url && seen.get(url)) || nowIso;
}

/* Order: newest article first, and everything undated behind all of it, grouped
   so a club's undated rows stay together rather than scattering. */
export function sortItems(items) {
    return [...items].sort((a, b) => {
        if (a.published && b.published) return b.published.localeCompare(a.published);
        if (a.published) return -1;
        if (b.published) return 1;
        return (a.club || '').localeCompare(b.club || '')
            || (a.player || '').localeCompare(b.player || '');
    });
}

// ---------------------------------------------------------------- the browser

async function render() {
    let chromium;
    try {
        ({ chromium } = await import('playwright'));
    } catch {
        console.error('::error::playwright is not installed — the workflow step installs it before this runs');
        process.exit(1);
    }
    const browser = await chromium.launch();
    const page = await browser.newPage({ userAgent: UA });
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });

    /* The table arrives after the page does. Wait for a row rather than a fixed
       sleep, and treat the timeout as a failed run — an empty table published
       over a good file is worse than no run at all. */
    try {
        await page.waitForSelector('table tr, [role="row"]', { timeout: 45000 });
    } catch {
        console.error('::error::no table rows appeared within 45s — the page shape has probably changed');
    }
    await page.waitForTimeout(2500);

    if (DUMP) {
        const html = await page.content();
        fs.writeFileSync('injuries-rendered.html', html);
        console.log(`wrote injuries-rendered.html (${html.length} bytes)`);
    }

    /* Extracted in the page, against the real DOM, rather than by parsing HTML
       out here — the structure is tables and headings, and querySelector reads
       those far more reliably than a regex does.

       Deliberately structural: it finds tables and reads their cells by position
       under the Player / Injury / Latest header, and takes the club from the
       nearest heading above. No class names, because those are generated and
       change without notice. */
    const scraped = await page.evaluate(() => {
        const out = [];
        const clean = s => (s || '').replace(/\s+/g, ' ').trim();

        for (const table of document.querySelectorAll('table')) {
            const rows = [...table.querySelectorAll('tr')];
            if (rows.length < 2) continue;

            // Column positions from the header row, so a reordered table still reads.
            const head = [...rows[0].querySelectorAll('th,td')].map(c => clean(c.textContent).toLowerCase());
            const iPlayer = head.findIndex(h => h.includes('player'));
            const iInjury = head.findIndex(h => h.includes('injury'));
            if (iPlayer < 0) continue;

            /* The club is the closest preceding heading. The page prints the name
               twice (crest alt text, then the label), so identical neighbours
               collapse to one. */
            let club = '';
            let node = table;
            while (node && !club) {
                node = node.previousElementSibling || node.parentElement;
                if (!node) break;
                const h = node.matches?.('h1,h2,h3,h4') ? node : node.querySelector?.('h1,h2,h3,h4');
                if (h) club = clean(h.textContent);
            }
            if (club) {
                const half = club.slice(0, Math.floor(club.length / 2)).trim();
                if (half && club === `${half} ${half}`) club = half;
            }

            for (const tr of rows.slice(1)) {
                /* th AND td. The player's name is the row header — <th scope="row">
                   — not a cell, so reading only td shifted every row one column
                   left: the first run stored "Groin" and "Ankle" as player names
                   and "Details", the link's own text, as the injury. Not one real
                   name came back. The header row is read the same way, so the
                   indices line up on both. */
                const cells = [...tr.querySelectorAll('th,td')];
                if (!cells.length) continue;
                const player = clean(cells[iPlayer]?.textContent);
                if (!player) continue;
                const injuryRaw = iInjury >= 0 ? clean(cells[iInjury]?.textContent) : '';
                const link = tr.querySelector('a[href]');
                out.push({
                    player,
                    club,
                    injury: injuryRaw && injuryRaw !== '-' ? injuryRaw : null,
                    url: link ? link.href : null
                });
            }
        }
        return out;
    });

    // The page's own stamp, shown as provenance rather than used for ordering.
    const pageUpdated = await page.evaluate(() => {
        const m = document.body.innerText.match(/Last update[^\n]*/i);
        return m ? m[0].replace(/\s+/g, ' ').trim() : null;
    });

    /* The browser stays open. Half the club sites turn a plain fetch away —
       see readArticlesInBrowser below — and starting a second Chromium for
       them would cost another cold start for nothing. */
    return { scraped, pageUpdated, browser };
}

/* The articles a plain fetch could not read, read the way a reader reads them.
 *
 * On one real scrape eight clubs answered nothing at all to fetch() — Aston
 * Villa, Manchester United, Everton, Hull, Bournemouth, Coventry, Forest and
 * Sunderland — not a headline, not a date, not a picture. They are not broken
 * pages: they are behind a bot check that a bare Node request fails and a real
 * browser passes. Chromium is already running for the injury table itself, so
 * the ones fetch lost get another go through it.
 *
 * Crystal Palace is the other case this covers. Its pages answer fetch fine but
 * carry no social meta in the HTML that arrives — the picture is put there by
 * the page's own scripts, so it exists only after the page has run. Reading the
 * rendered DOM finds it where reading the source cannot.
 *
 * So the pass is: anything with no title (fetch was refused) or no image (the
 * markup did not carry one). A page that still gives up nothing keeps the null
 * it already had, and the card falls back to the club crest.
 */
const ARTICLE_NAV_TIMEOUT = 25000;
const ARTICLE_CONCURRENCY = 4;

/* What fetch found and what the browser found, field by field.
 *
 * Never a wholesale replacement. The two reads see different pages — fetch sees
 * the source, the browser sees it after its own scripts have run — and either
 * can be the one that has a given field. A browser read that comes back with no
 * date must not delete a date fetch already had, and the browser is only asked
 * in the first place because something was missing, so it is the filler rather
 * than the authority. */
export function mergeArticleMeta(had, got) {
    const a = had || {};
    const b = got || {};
    return {
        published: a.published || b.published || null,
        title: a.title || b.title || null,
        image: a.image || b.image || null,
        ok: !!(a.ok || b.ok)
    };
}

async function readArticleInBrowser(browser, url) {
    let page = null;
    try {
        /* No userAgent override here, deliberately.
         *
           UA above claims Chrome 125 on macOS. That is a reasonable thing to
           send from a bare fetch, and the wrong thing to send from this
           browser: the client hints, the platform and everything else about
           the request say Linux Chromium, so overriding only the string makes
           a real browser look like something pretending to be one — which is
           the single loudest signal a bot check reads. Left alone, Chromium
           sends a set of headers that agree with each other.

           This is not an attempt to get past anyone's door. It is a real
           browser asking for a public article the Premier League's own site
           links to, twice a day, once per article. A club that still says no is
           saying no, and the card falls back to its crest. */
        /* A tall window, because how much of the page counts as "in view"
           decides how much of it a lazy loader bothers to fetch. */
        page = await browser.newPage({ viewport: { width: 1280, height: 2000 } });
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: ARTICLE_NAV_TIMEOUT });
        if (res && !res.ok()) return { failed: `HTTP ${res.status()}` };
        /* A moment for the head to be filled in by whatever put it there. The
           meta tags are written early — this is not waiting for the article to
           finish rendering, only for the tags to exist. */
        await page.waitForTimeout(1200);
        const html = await page.content();
        const meta = { published: publishedFrom(html), title: titleFrom(html), image: imageFrom(html), ok: true };
        /* The picture the reader sees, when the page names none for sharing.
         *
           Of nineteen articles put through the browser, only four were actually
           refused — Manchester United answered 403 and Manchester City 503. The
           other fifteen loaded perfectly and still produced nothing, which
           means they were never a blocking problem: they carry their picture in
           some shape the meta patterns do not match.

           A regex cannot get further here, and a browser does not need to. The
           page is laid out: ask it which image is actually the big one. Read at
           rendered size rather than off the markup, so a crest in a byline and
           a sprite in the nav are small and a hero is not, and take the largest
           thing that is plausibly a photograph. */
        if (!meta.image) {
            await nudgeLazyImages(page);
            meta.image = await largestArticleImage(page);
        }
        return meta;
    } catch (e) {
        /* Reported rather than swallowed. "18 went through the browser and 3
           came back" says nothing about why the other fifteen did not, and
           whether a club is refusing us or simply slow is the difference
           between a thing to fix and a thing to accept. */
        return { failed: String((e && e.message) || e).split('\n')[0].slice(0, 90) };
    } finally {
        if (page) { try { await page.close(); } catch { /* already gone */ } }
    }
}

/* The biggest image the laid-out page actually shows.
 *
 * Deliberately conservative about what counts. Anything under a postage stamp
 * is furniture; anything much wider than it is tall is a banner; and a src that
 * announces itself as a logo, crest, badge, sprite, icon, avatar or placeholder
 * is not the article's photograph whatever size it is drawn at. What survives
 * is ranked by the area it occupies on screen, which is the same judgement a
 * reader makes without thinking about it.
 */
const ARTICLE_IMG_MIN_W = 300;
const ARTICLE_IMG_MIN_H = 170;
const ARTICLE_IMG_SKIP = /logo|crest|badge|sprite|icon|avatar|placeholder|pixel|1x1|blank|spacer|advert/i;

/* Lazy images do not exist until something looks at them.
 *
 * Eighteen articles went through the browser and fifteen of them loaded
 * perfectly and still gave up nothing — not from the meta tags and not from the
 * images either, which is the tell. Nothing had loaded yet: an <img> that has
 * not been fetched has no natural size and, below the fold, no rendered one, so
 * every candidate measured zero and was discarded as furniture.
 *
 * A reader scrolls. This scrolls a little way down the page and back, which is
 * what an IntersectionObserver is waiting for, then gives the fetches a moment.
 */
async function nudgeLazyImages(page) {
    try {
        await page.evaluate(async () => {
            const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
            for (let y = step; y <= step * 4; y += step) {
                window.scrollTo(0, y);
                await new Promise(r => setTimeout(r, 180));
            }
            window.scrollTo(0, 0);
        });
        await page.waitForTimeout(900);
    } catch { /* a page that refuses to be scrolled is read as it stands */ }
}

async function largestArticleImage(page) {
    try {
        const found = await page.evaluate((cfg) => {
            const skip = new RegExp(cfg.skip, 'i');
            let best = null;
            const consider = (src, w, h) => {
                if (!src || !/^https?:\/\//i.test(src)) return;
                if (/\.svg(\?|#|$)/i.test(src)) return;
                if (skip.test(src)) return;
                if (w < cfg.minW || h < cfg.minH) return;
                // A strip four times wider than it is tall is a banner, not a photo.
                if (w / h > 4) return;
                const area = w * h;
                if (!best || area > best.area) best = { src, area };
            };

            for (const img of document.images) {
                const r = img.getBoundingClientRect();
                /* Whichever of the three knows the size. A loaded image has a
                   natural one; an unloaded image in a sized slot has a rendered
                   one; and the width/height attributes are what the page
                   intended before either existed. */
                const w = Math.max(r.width, img.naturalWidth || 0, Number(img.getAttribute('width')) || 0);
                const h = Math.max(r.height, img.naturalHeight || 0, Number(img.getAttribute('height')) || 0);
                /* src last. A lazy image keeps its real URL in a data attribute
                   or in srcset until it is fetched, and currentSrc is either
                   empty or a grey placeholder until then. */
                const fromSet = (img.getAttribute('srcset') || img.getAttribute('data-srcset') || '')
                    .split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean).pop();
                consider(img.currentSrc || img.src || img.getAttribute('data-src')
                    || img.getAttribute('data-lazy-src') || fromSet || '', w, h);
            }

            /* And the ones that are not <img> at all. Club CMSes routinely put
               the hero on a div as a background, where document.images cannot
               see it. Only elements big enough to be the subject are asked. */
            for (const el of document.querySelectorAll('div, section, figure, a, header, span')) {
                const r = el.getBoundingClientRect();
                if (r.width < cfg.minW || r.height < cfg.minH) continue;
                const bg = el.ownerDocument.defaultView.getComputedStyle(el).backgroundImage;
                if (!bg || bg === 'none') continue;
                const m = /url\((['"]?)(.*?)\1\)/.exec(bg);
                if (m) consider(m[2], r.width, r.height);
            }

            return best ? best.src : null;
        }, { skip: ARTICLE_IMG_SKIP.source, minW: ARTICLE_IMG_MIN_W, minH: ARTICLE_IMG_MIN_H });
        if (!found) return null;
        return String(found).replace(/^http:\/\//i, 'https://').slice(0, 500);
    } catch {
        return null;
    }
}

async function readArticlesInBrowser(browser, byUrl) {
    const needed = [...byUrl.entries()]
        .filter(([, m]) => !m || !m.title || !m.image)
        .map(([u]) => u);
    if (!needed.length) return 0;
    console.log(`${needed.length} article(s) go through the browser — fetch got no headline or no picture`);

    let gained = 0;
    const refusals = new Map();
    for (let i = 0; i < needed.length; i += ARTICLE_CONCURRENCY) {
        const batch = needed.slice(i, i + ARTICLE_CONCURRENCY);
        const metas = await Promise.all(batch.map(u => readArticleInBrowser(browser, u)));
        batch.forEach((u, n) => {
            const got = metas[n];
            if (!got) return;
            if (got.failed) {
                const host = (() => { try { return new URL(u).hostname; } catch { return u; } })();
                refusals.set(`${host} — ${got.failed}`, (refusals.get(`${host} — ${got.failed}`) || 0) + 1);
                return;
            }
            const had = byUrl.get(u) || {};
            const merged = mergeArticleMeta(had, got);
            if (!had.image && merged.image) gained++;
            byUrl.set(u, merged);
        });
    }
    for (const [why, n] of [...refusals].sort((a, b) => b[1] - a[1])) {
        console.log(`  browser could not read ${n} article(s): ${why}`);
    }
    return gained;
}

// ------------------------------------------------------------ article details

async function articleMeta(url) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
        if (!res.ok) return { published: null, title: null, image: null, ok: false };
        const html = await res.text();
        return { published: publishedFrom(html), title: titleFrom(html), image: imageFrom(html), ok: true };
    } catch {
        return { published: null, title: null, image: null, ok: false };
    }
}

// ------------------------------------------------------------------- the run

/* Guarded so the pure helpers above can be imported by a test without the
   import launching a browser at premierleague.com. */
const RUN_DIRECTLY = /fetch-pl-injuries\.mjs$/.test(process.argv[1] || '');
if (RUN_DIRECTLY) {

const { scraped, pageUpdated, browser } = await render();
console.log(`scraped ${scraped.length} rows from the injury table`);
if (!scraped.length) {
    console.error('::error::the injury table produced no rows');
    process.exit(1);
}

let clubIdFor = () => null;
let squadPool = [];
try {
    const boot = JSON.parse(fs.readFileSync('data/bootstrap-static.json', 'utf8'));
    clubIdFor = buildClubMap(boot.teams || []);
    squadPool = (boot.elements || []).map(p => ({
        id: p.id, teamId: p.team, firstName: p.first_name, secondName: p.second_name, name: p.web_name
    }));
} catch {
    console.warn('no bootstrap-static.json — club and player ids will be null');
}

// One fetch per article, not per player: an update covering three players is
// one page, and asking for it three times is three times the load for nothing.
const byUrl = new Map();
for (const r of scraped) {
    const u = cleanUrl(r.url);
    r.url = u;
    if (u && !byUrl.has(u)) byUrl.set(u, null);
}
console.log(`${byUrl.size} distinct club articles to read`);

const urls = [...byUrl.keys()];
for (let i = 0; i < urls.length; i += 5) {
    const batch = urls.slice(i, i + 5);
    const metas = await Promise.all(batch.map(articleMeta));
    batch.forEach((u, n) => byUrl.set(u, metas[n]));
}
const gained = await readArticlesInBrowser(browser, byUrl);
try { await browser.close(); } catch { /* already gone */ }
if (gained) console.log(`${gained} article(s) gave up a picture only through the browser`);

const dated = [...byUrl.values()].filter(m => m && m.published).length;
const pictured = [...byUrl.values()].filter(m => m && m.image).length;
console.log(`${dated} of ${byUrl.size} articles published a date`);
console.log(`${pictured} of ${byUrl.size} articles carry a picture`);

// Whatever the last run stored, so an article keeps the moment we first saw it
// rather than being re-dated on every scrape.
let previousItems = [];
if (OUT) {
    try { previousItems = JSON.parse(fs.readFileSync(OUT, 'utf8')).items || []; }
    catch { /* first run, or the file was removed on purpose */ }
}
const nowIso = new Date().toISOString();
const firstSeenFor = carryFirstSeen(previousItems, nowIso);
const carried = previousItems.filter(i => i.firstSeen && i.firstSeen !== nowIso).length;
console.log(`${carried} row(s) kept a first-seen date from the previous run`);

const items = sortItems(scraped.map(r => {
    const meta = r.url ? byUrl.get(r.url) : null;
    return {
        player: r.player,
        club: r.club || null,
        clubId: r.club ? clubIdFor(r.club) : null,
        injury: r.injury,
        url: r.url,
        articleTitle: meta?.title || null,
        /* true, false, or null when the article could not be read at all. */
        injuryArticle: looksLikeInjuryNews(meta?.title || null),
        published: meta?.published || null,
        /* The article's own picture, so the card can show the story rather than
           the badge. Null is a normal answer — the crest is the fallback and a
           good one — so nothing here fails when a club publishes without one. */
        image: meta?.image || null,
        firstSeen: r.url ? firstSeenFor(r.url) : nowIso,
        /* The FPL element this row is about, decided once here so the page and
           the push Worker agree without either of them re-matching names. */
        playerId: (() => {
            const club = r.club ? clubIdFor(r.club) : null;
            const hit = club != null ? plMatchInjuredPlayer(r.player, club, squadPool) : null;
            return hit ? hit.id : null;
        })()
    };
}));

const resolved = items.filter(i => i.playerId != null).length;
console.log(`${resolved} of ${items.length} rows resolved to an FPL player`);
const kinds = items.reduce((a, i) => {
    const k = i.injuryArticle === true ? 'injury news'
        : i.injuryArticle === false ? 'something else' : 'unreadable';
    a[k] = (a[k] || 0) + 1;
    return a;
}, {});
console.log('article kinds: ' + JSON.stringify(kinds));

const slipped = looksMisaligned(items);
if (slipped) {
    console.error(`::error::${slipped}`);
    process.exit(1);
}

const payload = {
    source: 'premierleague.com',
    sourceUrl: PAGE,
    fetched: new Date().toISOString(),
    pageUpdated,
    items
};

if (OUT) {
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
    console.log(`wrote ${OUT}: ${items.length} players, ${items.filter(i => i.url).length} with a link`);
} else {
    console.log(JSON.stringify(payload, null, 2).slice(0, 2000));
}

}
