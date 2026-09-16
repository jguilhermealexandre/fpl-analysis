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

    await browser.close();
    return { scraped, pageUpdated };
}

// ------------------------------------------------------------ article details

async function articleMeta(url) {
    try {
        const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
        if (!res.ok) return { published: null, title: null, ok: false };
        const html = await res.text();
        return { published: publishedFrom(html), title: titleFrom(html), ok: true };
    } catch {
        return { published: null, title: null, ok: false };
    }
}

// ------------------------------------------------------------------- the run

/* Guarded so the pure helpers above can be imported by a test without the
   import launching a browser at premierleague.com. */
const RUN_DIRECTLY = /fetch-pl-injuries\.mjs$/.test(process.argv[1] || '');
if (RUN_DIRECTLY) {

const { scraped, pageUpdated } = await render();
console.log(`scraped ${scraped.length} rows from the injury table`);
if (!scraped.length) {
    console.error('::error::the injury table produced no rows');
    process.exit(1);
}

let clubIdFor = () => null;
try {
    const boot = JSON.parse(fs.readFileSync('data/bootstrap-static.json', 'utf8'));
    clubIdFor = buildClubMap(boot.teams || []);
} catch {
    console.warn('no bootstrap-static.json to map clubs to crests — ids will be null');
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
const dated = [...byUrl.values()].filter(m => m && m.published).length;
console.log(`${dated} of ${byUrl.size} articles published a date`);

const items = sortItems(scraped.map(r => {
    const meta = r.url ? byUrl.get(r.url) : null;
    return {
        player: r.player,
        club: r.club || null,
        clubId: r.club ? clubIdFor(r.club) : null,
        injury: r.injury,
        url: r.url,
        articleTitle: meta?.title || null,
        published: meta?.published || null
    };
}));

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
