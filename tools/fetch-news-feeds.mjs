#!/usr/bin/env node
/* The other three news feeds, fetched server-side for their pictures.
 *
 * The news page reads BBC, Sky and the Guardian through api.rss2json.com,
 * because a browser cannot fetch an RSS feed cross-origin. That proxy decides
 * for itself which namespaced elements to map, and the Guardian's pictures are
 * the casualty: its items carry no <enclosure> and no <media:thumbnail>, only a
 * stack of <media:content> at different widths, and its <description> is a
 * plain-text standfirst with no <img> in it. So by the time the item reaches
 * the page there is nothing left in it that looks like an image, and the card
 * falls back to a coloured placeholder. A deep scan of the item was already
 * tried and could not help: you cannot find a field the proxy never sent.
 *
 * Fetching the feed here instead means reading the actual XML, where
 * <media:content url="..."> is right there. Same reasoning as the Premier
 * League fetcher next door: do it where there is no CORS, validate it, and
 * commit JSON the page reads from its own origin.
 *
 * Run: node tools/fetch-news-feeds.mjs [--out data/news-feeds.json] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_PER_FEED = 25;
const TIMEOUT_MS = 20000;

const FEEDS = [
    { url: 'https://feeds.bbci.co.uk/sport/football/premier-league/rss.xml', source: 'BBC Sport', badge: 'bbc' },
    { url: 'https://www.skysports.com/rss/11661', source: 'Sky Sports', badge: 'sky' },
    { url: 'https://www.theguardian.com/football/premierleague/rss', source: 'The Guardian', badge: 'guardian' }
];

const UA = 'Mozilla/5.0 (compatible; EasyFPL/1.0; +https://easyfpl.pages.dev)';

// ===== XML reading =====
// A regex reader rather than a parser: no dependencies in CI, the shape is
// fixed, and a feed it cannot read falls out rather than failing the run.

const uncdata = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

function decode(s) {
    return uncdata(s)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        // Ampersand last, so &amp;lt; does not become a real < on the way out.
        .replace(/&amp;/g, '&')
        .trim();
}

const stripTags = s => decode(uncdata(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function tag(xml, name) {
    const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
    return m ? decode(m[1]) : '';
}

/* Every occurrence of an attribute on a tag, not just the first — the whole
   reason this file exists is that the Guardian ships several <media:content>
   at different widths and the useful one is not necessarily first. */
export function attrsOf(xml, name, key) {
    const out = [];
    const re = new RegExp(`<${name}\\b[^>]*?\\s${key}=["']([^"']+)["'][^>]*>`, 'gi');
    let m;
    while ((m = re.exec(xml)) !== null) out.push(m[1]);
    return out;
}

/* A tracking pixel is not a picture. */
const SKIP = /(?:^|\/)(?:1x1|pixel|spacer|blank|transparent)\.(?:gif|png|jpg)(?:\?|$)/i;

/* The widest <media:content> the item offers, since a card is 300px wide and
   the feed's first entry is often a 140px thumbnail.
 *
 * The width lives in a `width` attribute beside the url, so the two are read
 * from the same tag rather than from two independent scans — a pair of lists
 * zipped by position would silently mismatch the moment one tag omits width. */
export function widestMedia(itemXml) {
    const tags = itemXml.match(/<media:content\b[^>]*>/gi) || [];
    let best = null;
    let bestW = -1;
    for (const t of tags) {
        const url = /\surl=["']([^"']+)["']/i.exec(t);
        if (!url || SKIP.test(url[1])) continue;
        const type = /\stype=["']([^"']+)["']/i.exec(t);
        // Skip video and audio enclosures that share the element name.
        if (type && !/^image\//i.test(type[1])) continue;
        const w = parseInt((/\swidth=["'](\d+)["']/i.exec(t) || [])[1] || '0', 10);
        if (w > bestW) { bestW = w; best = url[1]; }
    }
    return best;
}

/* Everything that could be a picture, best first. The named fields cover the
   BBC and Sky; media:content is what the Guardian actually ships. */
export function itemImage(itemXml) {
    /* The body's markup arrives entity-encoded — a feed writes its description
       as &lt;img src="…"&gt;, because the description is character data inside
       XML. Scanning the raw item for <img therefore never matches, which is a
       quiet way to lose every picture a feed carries in its body rather than
       in a named element. Decode first, then look. */
    const body = decode(tag(itemXml, 'description') || '')
        + ' ' + decode(tag(itemXml, 'content:encoded') || '')
        + ' ' + decode(tag(itemXml, 'summary') || '');

    const imgsIn = html => (html.match(/<img[^>]+?src\s*=\s*["']([^"']+)["']/gi) || [])
        .map(t => (/src\s*=\s*["']([^"']+)["']/i.exec(t) || [])[1]);

    const candidates = [
        widestMedia(itemXml),
        ...attrsOf(itemXml, 'media:thumbnail', 'url'),
        ...attrsOf(itemXml, 'enclosure', 'url'),
        ...imgsIn(body),
        ...imgsIn(itemXml)
    ];
    for (const c of candidates) {
        if (!c) continue;
        const url = decode(c).trim();
        if (SKIP.test(url)) continue;
        if (/^\/\//.test(url)) return widen('https:' + url);
        if (/^https?:\/\//i.test(url)) return widen(url.replace(/^http:\/\//i, 'https://'));
    }
    return null;
}

/* The BBC's feed asks for a 240px crop and the cards draw it at 300, which is
   what "pixelated" looks like — 4.5KB of image stretched across a card. The
   same path serves any width from that one segment and signs nothing, so
   widening it is safe; 800 comes back at 30-45KB. Confirmed against the live
   host rather than assumed.

   Nothing else is touched. Guardian URLs carry an HMAC over their query
   string, so changing a width there turns a working image into a 403. */
function widen(url) {
    return url.replace(/(ichef\.bbci\.co\.uk\/[a-z]+\/[a-z]+\/)\d{2,4}(\/)/i, '$1800$2');
}

/* One item, or null if it is not one. A headline you cannot click is not an
   article, which is the same rule the Premier League fetcher applies. */
export function parseItem(itemXml, feed) {
    const title = stripTags(tag(itemXml, 'title'));
    let link = stripTags(tag(itemXml, 'link'));
    // Atom puts the URL in an attribute rather than in the element's text.
    if (!link) link = (attrsOf(itemXml, 'link', 'href')[0] || '').trim();
    if (!title || !/^https?:\/\//i.test(link)) return null;

    let published = null;
    const raw = tag(itemXml, 'pubDate') || tag(itemXml, 'published') || tag(itemXml, 'updated');
    if (raw) {
        const d = new Date(raw);
        if (!isNaN(d.getTime())) published = d.toISOString();
    }

    return {
        title,
        link: link.replace(/^http:\/\//i, 'https://'),
        summary: stripTags(tag(itemXml, 'description') || tag(itemXml, 'summary')).slice(0, 240) || null,
        image: itemImage(itemXml),
        published,
        source: feed.source,
        badge: feed.badge
    };
}

export function parseFeed(xml, feed) {
    const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi)
        || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi)
        || [];
    return items.slice(0, MAX_PER_FEED).map(x => parseItem(x, feed)).filter(Boolean);
}

async function fetchFeed(feed) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(feed.url, {
            headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
            signal: controller.signal
        });
        if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
        const items = parseFeed(await res.text(), feed);
        if (!items.length) return { ok: false, why: 'answered, but no items could be read from it' };
        return { ok: true, items };
    } catch (e) {
        return { ok: false, why: e.name === 'AbortError' ? `timed out after ${TIMEOUT_MS}ms` : e.message };
    } finally {
        clearTimeout(timer);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const outIdx = args.indexOf('--out');
    const out = outIdx > -1 ? args[outIdx + 1] : 'data/news-feeds.json';

    const feeds = [];
    for (const feed of FEEDS) {
        process.stdout.write(`→ ${feed.source}\n`);
        const r = await fetchFeed(feed);
        if (!r.ok) { console.log(`  ✗ ${r.why}`); continue; }
        const withPics = r.items.filter(i => i.image).length;
        console.log(`  ✓ ${r.items.length} item(s), ${withPics} with a picture`);
        feeds.push({ source: feed.source, badge: feed.badge, items: r.items });
    }

    if (!feeds.length) {
        console.error('::error::no feed answered — leaving the existing file alone');
        process.exit(1);
    }

    const payload = { fetchedAt: new Date().toISOString(), feeds };
    if (dryRun) { console.log(JSON.stringify(payload, null, 2)); return; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n');
    console.log(`written to ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(e => { console.error(`::error::${e.message}`); process.exit(1); });
}
