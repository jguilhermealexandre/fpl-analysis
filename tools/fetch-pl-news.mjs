#!/usr/bin/env node
/* Premier League news, fetched where a browser cannot fetch it.
 *
 * premierleague.com sends no CORS headers, so the site cannot read it from the
 * page. The workaround so far was api.rss2json.com pointed at a feed URL, which
 * put two guesses in a row between us and the articles: whether that URL still
 * serves RSS at all, and whether a third-party proxy maps the fields we need.
 * Both have been wrong, and neither can be checked from a browser.
 *
 * So it is fetched the same way every other external dataset in this repo is:
 * server-side, on a schedule, validated, and committed as JSON that the page
 * reads from its own origin. No CORS, no proxy, and if it breaks it breaks in a
 * CI log with the reason in it rather than silently on someone's phone.
 *
 * The Premier League has moved this endpoint more than once and is under no
 * obligation to tell us, so SOURCES is a list and the first one that answers
 * with something usable wins. Add to it rather than replacing it: an endpoint
 * that stops working should fall through to the next, not take the feed down.
 *
 * Run: node tools/fetch-pl-news.mjs [--out data/pl-news.json] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_ITEMS = 30;
const TIMEOUT_MS = 20000;

/* Pulselive is the CMS behind premierleague.com. The `Origin` and `Account`
   headers are what the site's own client sends; without them the content API
   answers 403. */
const PULSE_HEADERS = {
    'Origin': 'https://www.premierleague.com',
    'Referer': 'https://www.premierleague.com/',
    'Account': 'premierleague',
    'User-Agent': 'Mozilla/5.0 (compatible; EasyFPL/1.0; +https://easyfpl.pages.dev)'
};

/* The real one, read out of the site's own code.
 *
 * The page sets window.SDP_API = 'https://sdp-prem-prod...pulselive.com/api',
 * and the app bundle builds its content paths as
 *   `/content/premierleague/${type}/${language}${query}`          (contentType)
 *   `/content/premierleague/${language}?contentTypes=…&limit=…`   (multiType)
 * so those are what the news page itself is calling. footballapi.pulselive.com,
 * which every guess so far went through, is 404 across the board. */
const SDP_API = 'https://sdp-prem-prod.premier-league-prod.pulselive.com/api';

const SOURCES = [
    {
        name: 'SDP content (multiType)',
        url: `${SDP_API}/content/premierleague/EN?contentTypes=text&offset=0&limit=${MAX_ITEMS}&onlyRestrictedContent=false`,
        headers: PULSE_HEADERS,
        parse: parsePulselive
    },
    {
        name: 'SDP content (contentType text)',
        url: `${SDP_API}/content/premierleague/text/EN?limit=${MAX_ITEMS}`,
        headers: PULSE_HEADERS,
        parse: parsePulselive
    },
    {
        name: 'SDP content (contentType news)',
        url: `${SDP_API}/content/premierleague/news/EN?limit=${MAX_ITEMS}`,
        headers: PULSE_HEADERS,
        parse: parsePulselive
    },
    {
        name: 'pulselive content API',
        url: `https://footballapi.pulselive.com/football/content/PREMIERLEAGUE/text/EN?pageSize=${MAX_ITEMS}&page=0&references=ALL&type=news`,
        headers: PULSE_HEADERS,
        parse: parsePulselive
    },
    {
        name: 'pulselive content API (no reference filter)',
        url: `https://footballapi.pulselive.com/football/content/PREMIERLEAGUE/text/EN?pageSize=${MAX_ITEMS}&page=0`,
        headers: PULSE_HEADERS,
        parse: parsePulselive
    },
    {
        name: 'premierleague.com /en/news.rss',
        url: 'https://www.premierleague.com/en/news.rss',
        headers: PULSE_HEADERS,
        parse: parseRss
    },
    {
        name: 'premierleague.com /news.rss',
        url: 'https://www.premierleague.com/news.rss',
        headers: PULSE_HEADERS,
        parse: parseRss
    },
    {
        name: 'premierleague.com /en/news (embedded JSON)',
        url: 'https://www.premierleague.com/en/news',
        headers: PULSE_HEADERS,
        parse: parseEmbedded
    }
];

// ===== Parsers =====
// Each takes the raw response body and returns an array of normalised items,
// or an empty array if the body is not the shape it knows about. They never
// throw on a shape they do not recognise — that is what lets the caller fall
// through to the next source.

/* Pulselive's content API. An article's picture is in `imageUrl` or in a
   `leadMedia` object; its body is HTML we do not want, so only the summary
   comes across. */
/* Pulselive's content API, in each of the shapes the bundle's own
   transformResponse copes with: a flat `content` or `items` array, or a
   `content[0].items` one, with each row optionally wrapped in `.response`. */
function pulseRows(json) {
    if (!json) return [];
    if (Array.isArray(json.items)) return json.items;
    if (Array.isArray(json.content)) {
        if (json.content[0] && Array.isArray(json.content[0].items)) return json.content[0].items;
        return json.content;
    }
    if (Array.isArray(json.data)) return json.data;
    return [];
}

function parsePulselive(body) {
    let json;
    try { json = JSON.parse(body); } catch { return []; }
    const rows = pulseRows(json);
    if (!rows.length) return [];

    // Named so a shape change shows up in the run log rather than as an empty file.
    const sample = rows[0] && (rows[0].response || rows[0]);
    if (sample && process.env.PL_NEWS_DEBUG !== '0') {
        console.log(`    row keys: ${Object.keys(sample).slice(0, 25).join(', ')}`);
    }

    return rows.map(row => {
        const a = row.response || row;
        return normalise({
            title: a.title || a.headline,
            link: pulseLink(a),
            summary: a.subtitle || a.summary || a.description,
            image: pulseImage(a),
            published: (a.date && (a.date.millis != null ? new Date(a.date.millis).toISOString() : a.date.label))
                || a.publishFrom || a.publishedDate || a.lastModified
        });
    }).filter(Boolean);
}

/* premierleague.com routes an article as /en/news/{id}; a slug is used when the
   payload carries one. */
function pulseLink(a) {
    if (typeof a.url === 'string' && /^https?:\/\//.test(a.url)) return a.url;
    if (a.slug) return `https://www.premierleague.com/en/news/${a.id}/${a.slug}`;
    if (a.id != null) return `https://www.premierleague.com/en/news/${a.id}`;
    return null;
}

function pulseImage(a) {
    // The bundle lifts these two onto `associatedImage`, so they are where the
    // site's own cards get their picture from.
    if (a.customContent && a.customContent.onDemandUrl) return a.customContent.onDemandUrl;
    if (a.promoItem && a.promoItem.onDemandUrl) return a.promoItem.onDemandUrl;
    if (a.associatedImage && a.associatedImage.onDemandUrl) return a.associatedImage.onDemandUrl;
    const media = a.leadMedia || a.imageUrl || a.image;
    if (typeof media === 'string') return media;
    if (media && typeof media === 'object') {
        if (typeof media.onDemandUrl === 'string') return media.onDemandUrl;
        if (media.imageUrl) return String(media.imageUrl);
        // { "url": "https://.../{format}", "variants": [...] }
        if (typeof media.url === 'string') return media.url.replace('{format}', 'landscape');
    }
    return null;
}

/* RSS 2.0. Deliberately a regex reader rather than an XML parser: this runs in
   CI with no dependencies, the shape is fixed, and anything it cannot read
   falls through to the next source rather than failing the run. */
function parseRss(body) {
    if (!/<rss|<feed|<channel/i.test(body)) return [];
    const items = body.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    return items.slice(0, MAX_ITEMS).map(x => normalise({
        title: tag(x, 'title'),
        link: tag(x, 'link'),
        summary: tag(x, 'description'),
        image: attr(x, 'media:content', 'url') || attr(x, 'media:thumbnail', 'url')
            || attr(x, 'enclosure', 'url') || firstImg(tag(x, 'description')),
        published: tag(x, 'pubDate')
    })).filter(Boolean);
}

/* The news page itself, for the day both APIs are gone. Next.js and similar
   frameworks inline the page's data as JSON in a <script>; if we can find an
   array of things with titles and links in there, that is the article list. */
function parseEmbedded(body) {
    const blocks = body.match(/<script[^>]*type="application\/(?:ld\+)?json"[^>]*>([\s\S]*?)<\/script>/gi) || [];
    const found = [];
    for (const block of blocks) {
        const raw = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
        let json;
        try { json = JSON.parse(raw); } catch { continue; }
        collectArticles(json, found, 0);
        if (found.length >= 5) break;
    }
    return found.slice(0, MAX_ITEMS).map(normalise).filter(Boolean);
}

function collectArticles(node, out, depth) {
    if (!node || depth > 6 || out.length >= MAX_ITEMS) return;
    if (Array.isArray(node)) { node.forEach(n => collectArticles(n, out, depth + 1)); return; }
    if (typeof node !== 'object') return;
    const title = node.headline || node.title || node.name;
    const link = node.url || node.link;
    if (typeof title === 'string' && typeof link === 'string' && /^https?:\/\//.test(link)
        && /premierleague\.com/.test(link) && title.length > 12) {
        out.push({
            title, link,
            summary: node.description || node.subtitle,
            image: typeof node.image === 'string' ? node.image : node.image?.url,
            published: node.datePublished || node.date
        });
    }
    Object.values(node).forEach(v => collectArticles(v, out, depth + 1));
}

// ===== Shared helpers =====
const tag = (xml, name) => {
    const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
    return m ? decode(m[1]) : '';
};
/* CDATA has to come off before anything strips tags: <![CDATA[...]]> matches
   /<[^>]*>/ in its entirety, so a tag-stripper run first eats the content along
   with the wrapper and leaves an empty string. */
const uncdata = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const attr = (xml, name, key) => {
    const m = new RegExp(`<${name}[^>]*\\s${key}=["']([^"']+)["']`, 'i').exec(xml);
    return m ? m[1] : null;
};
const firstImg = html => {
    const m = /<img[^>]+?src\s*=\s*["']([^"']+)["']/i.exec(html || '');
    return m ? m[1] : null;
};

function decode(s) {
    return uncdata(s)
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        // Ampersand last, so &amp;lt; does not become a real < on the way through.
        .replace(/&amp;/g, '&')
        .trim();
}

const stripTags = s => decode(uncdata(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/* One shape, whatever answered. Returns null for a row that has no title or no
   link, since a headline you cannot click is not an article. */
export function normalise(raw) {
    if (!raw) return null;
    const title = stripTags(raw.title);
    let link = String(raw.link || '').trim();
    if (!title || !link) return null;
    if (link.startsWith('/')) link = 'https://www.premierleague.com' + link;
    if (!/^https?:\/\//i.test(link)) return null;

    let image = raw.image ? String(raw.image).trim() : null;
    if (image && image.startsWith('//')) image = 'https:' + image;
    if (image && !/^https?:\/\//i.test(image)) image = null;

    let published = null;
    if (raw.published) {
        const d = new Date(raw.published);
        if (!isNaN(d.getTime())) published = d.toISOString();
    }

    return {
        title,
        link: link.replace(/^http:\/\//i, 'https://'),
        summary: stripTags(raw.summary).slice(0, 240) || null,
        image: image ? image.replace(/^http:\/\//i, 'https://') : null,
        published,
        source: 'Premier League'
    };
}

/* De-duplicate by link, keep the order the source gave us. */
export function dedupe(items) {
    const seen = new Set();
    return items.filter(i => {
        if (seen.has(i.link)) return false;
        seen.add(i.link);
        return true;
    });
}

async function tryFetch(src) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(src.url, { headers: src.headers, signal: controller.signal });
        if (!res.ok) {
            /* An API that answers 400 is telling us what is wrong with the
               request, and that sentence is the whole difference between
               guessing at parameters and reading them off. A 404 says nothing,
               so cap it — this goes in a public run log. */
            const detail = await res.text().catch(() => '');
            const why = `HTTP ${res.status}`;
            return { ok: false, why: detail ? `${why} — ${detail.replace(/\s+/g, ' ').slice(0, 300)}` : why };
        }
        const body = await res.text();
        const items = dedupe(src.parse(body));
        if (!items.length) return { ok: false, why: `answered ${body.length}B but no articles could be read from it` };
        return { ok: true, items };
    } catch (e) {
        return { ok: false, why: e.name === 'AbortError' ? `timed out after ${TIMEOUT_MS}ms` : e.message };
    } finally {
        clearTimeout(timer);
    }
}

/* What is actually in the page, printed to a CI log.
 *
 * This exists because the endpoints are all 404 and the only thing left that
 * answers is the news page itself — and its markup cannot be looked at from a
 * browser sandbox or from a laptop behind the same CORS wall. Run the workflow
 * with inspect=true and the log says what the page is made of, which is how the
 * parser below gets written against the real thing rather than a guess. */
async function inspect(url, headers) {
    const res = await fetch(url, { headers });
    const body = await res.text();
    console.log(`HTTP ${res.status}, ${body.length} bytes, content-type: ${res.headers.get('content-type')}`);

    const scripts = [...body.matchAll(/<script([^>]*)>([\s\S]{0,200})/gi)];
    console.log(`\n${scripts.length} <script> tag(s):`);
    scripts.slice(0, 25).forEach(([, attrs, head], i) => {
        console.log(`  [${i}] ${attrs.trim().slice(0, 120) || '(no attrs)'}`);
        const peek = head.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (peek) console.log(`       ${peek}`);
    });

    const anchors = [...body.matchAll(/<a[^>]+href=["']([^"']*\/news\/[^"']*)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)];
    console.log(`\n${anchors.length} anchor(s) pointing at a news URL. First 10:`);
    anchors.slice(0, 10).forEach(([, href, text]) => {
        console.log(`  ${href}`);
        console.log(`     text: ${text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)}`);
    });

    ['__NEXT_DATA__', '__NUXT__', 'INITIAL_STATE', 'application/ld+json', 'articles', 'headline']
        .forEach(k => console.log(`contains ${k}: ${body.includes(k)}`));

    /* The page is a shell: no articles in the markup at all, and a bundle that
       fetches them at runtime. What it fetches them from is configured on
       window.PULSE, which IS in the markup — so print it, and every API-looking
       host alongside it. */
    console.log('\n--- window.PULSE assignments ---');
    [...body.matchAll(/window\.PULSE[.\w]*\s*=\s*([\s\S]{0,1200}?);\s*(?:window\.|<\/script>|\n\s*\n)/g)]
        .slice(0, 6).forEach(m => console.log(m[0].replace(/\s+/g, ' ').slice(0, 1100) + '\n'));

    console.log('--- hosts that look like an API ---');
    const hosts = new Set();
    [...body.matchAll(/https?:\/\/([a-z0-9.-]*(?:api|pulselive|content)[a-z0-9.-]*)/gi)]
        .forEach(m => hosts.add(m[1]));
    [...body.matchAll(/["'](\/\/[a-z0-9.-]*(?:api|pulselive|content)[a-z0-9.-]*)/gi)]
        .forEach(m => hosts.add(m[1]));
    [...hosts].slice(0, 30).forEach(h => console.log('  ' + h));

    console.log('--- any absolute path that mentions content or news ---');
    const paths = new Set();
    [...body.matchAll(/["'](\/[a-z0-9/_-]*(?:content|news)[a-z0-9/_-]*)["']/gi)]
        .forEach(m => paths.add(m[1]));
    [...paths].slice(0, 25).forEach(x => console.log('  ' + x));

    const heads = [...body.matchAll(/<h[23][^>]*>([\s\S]{0,120}?)<\/h[23]>/gi)].slice(0, 10);
    console.log(`\nFirst ${heads.length} h2/h3:`);
    heads.forEach(([, t]) => console.log(`  ${t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90)}`));
}

/* Ask the app's own code where it gets its articles.
 *
 * The news page is a shell that imports a bundle and fetches content at
 * runtime, so the endpoint is not in the markup — but it is in the bundle,
 * written out as a string. Fetch that and print every API path in it, and the
 * guessing stops. */
async function probe(headers) {
    const pageRes = await fetch('https://www.premierleague.com/en/news', { headers });
    const page = await pageRes.text();

    const bundleRef = /import\(["'](\/resources\/[^"']+?\.js)["']\)/.exec(page)
        || /src=["'](\/resources\/[^"']+?\.js)["']/.exec(page);
    if (!bundleRef) { console.log('no bundle reference found in the page'); return; }
    const bundleUrl = 'https://www.premierleague.com' + bundleRef[1];
    console.log(`bundle: ${bundleUrl}`);

    const bRes = await fetch(bundleUrl, { headers });
    const bundle = await bRes.text();
    console.log(`HTTP ${bRes.status}, ${bundle.length} bytes\n`);

    const show = (label, re, limit = 40) => {
        const hits = new Set();
        for (const m of bundle.matchAll(re)) hits.add(m[0]);
        console.log(`--- ${label} (${hits.size}) ---`);
        [...hits].slice(0, limit).forEach(h => console.log('  ' + h));
        console.log('');
    };

    show('api/v2 paths', /\/api\/v[0-9]\/[a-zA-Z0-9/_{}$.-]{2,80}/g, 60);
    show('paths mentioning content or article or news', /["'`]\/[a-zA-Z0-9/_{}$.-]*(?:content|article|news|editorial)[a-zA-Z0-9/_{}$.-]*["'`]/gi, 40);
    show('pulselive hosts', /https?:\/\/[a-z0-9.-]*pulselive[a-z0-9.-]*/gi, 20);

    /* The path templates name variables, not values. Print what surrounds each
       one so the base URL and the arguments are readable. */
    console.log('--- context around each /content/ template ---');
    [...bundle.matchAll(/`\/content\/[^`]{0,120}`/g)].slice(0, 6).forEach((m, i) => {
        const from = Math.max(0, m.index - 700);
        console.log(`\n[${i}] ...${bundle.slice(from, m.index + m[0].length + 400).replace(/\s+/g, ' ')}...`);
    });

    /* And the config the app reads its base URL out of, from the page. */
    console.log('\n--- envPaths / config in the page ---');
    ['envPaths', 'sdp', 'contentApi', 'apiUrl', 'baseUrl'].forEach(key => {
        const idx = page.indexOf(key);
        if (idx === -1) { console.log(`  ${key}: not present`); return; }
        console.log(`  ${key}: ...${page.slice(Math.max(0, idx - 120), idx + 700).replace(/\s+/g, ' ')}...\n`);
    });
}

/* Every plausible spelling of the SDP content request, tried at once.
 *
 * The endpoints answer 400, which means the path is right and the query is
 * not — the host would say 404 otherwise, as footballapi.pulselive.com does.
 * A 400 body normally names the parameter it did not like, so this fires a
 * grid of variants and prints each status with its body. One run should end
 * the guessing; whichever line comes back 200 becomes the source above.
 */
async function matrix(headers) {
    const langs = ['EN', 'en', 'en-GB'];
    const urls = [];
    const add = u => { if (!urls.includes(u)) urls.push(u); };

    for (const lang of langs) {
        // Bare, so the error names what is missing rather than what is wrong.
        add(`${SDP_API}/content/premierleague/${lang}`);
        add(`${SDP_API}/content/premierleague/text/${lang}`);
        // The two builders out of the bundle, with each paging convention.
        add(`${SDP_API}/content/premierleague/${lang}?contentTypes=text&limit=10&offset=0&onlyRestrictedContent=false`);
        add(`${SDP_API}/content/premierleague/${lang}?contentTypes=TEXT&limit=10&offset=0&onlyRestrictedContent=false`);
        add(`${SDP_API}/content/premierleague/${lang}?contentTypes=text&pageSize=10&page=0&onlyRestrictedContent=false`);
        add(`${SDP_API}/content/premierleague/text/${lang}?limit=10&offset=0`);
        add(`${SDP_API}/content/premierleague/text/${lang}?pageSize=10&page=0`);
        add(`${SDP_API}/content/premierleague/text/${lang}?pageSize=10&page=0&references=ALL`);
    }
    // Other content types the site uses, in case `text` is not what news is filed as.
    ['news', 'editorial', 'article', 'story'].forEach(t =>
        add(`${SDP_API}/content/premierleague/${t}/EN?pageSize=10&page=0`));
    // And the API root, which often lists what it serves.
    add(`${SDP_API}/content/premierleague`);

    for (const url of urls) {
        let line;
        try {
            const res = await fetch(url, { headers });
            const body = await res.text();
            line = `${res.status}  ${url}`;
            const peek = body.replace(/\s+/g, ' ').slice(0, 220);
            line += res.ok ? `\n      ${body.length}B  ${peek}` : `\n      ${peek}`;
        } catch (e) {
            line = `ERR  ${url}\n      ${e.message}`;
        }
        console.log(line);
    }

    /* And what the bundle says the parameters are, read out of the code that
       builds them rather than inferred from an error message. */
    console.log('\n--- how the bundle spells the query ---');
    try {
        const page = await (await fetch('https://www.premierleague.com/en/news', { headers })).text();
        const ref = /import\(["'](\/resources\/[^"']+?\.js)["']\)/.exec(page);
        if (!ref) { console.log('no bundle reference in the page'); return; }
        const bundle = await (await fetch('https://www.premierleague.com' + ref[1], { headers })).text();
        for (const key of ['onlyRestrictedContent', 'contentTypes', 'pageSize', 'X-Content-Language', 'account']) {
            const idx = bundle.indexOf(key);
            console.log(`\n[${key}] ${idx === -1 ? 'not present'
                : '...' + bundle.slice(Math.max(0, idx - 500), idx + 500).replace(/\s+/g, ' ') + '...'}`);
        }
    } catch (e) {
        console.log(`bundle read failed: ${e.message}`);
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args.includes('--probe')) {
        await probe(PULSE_HEADERS);
        return;
    }
    if (args.includes('--matrix')) {
        await matrix(PULSE_HEADERS);
        return;
    }
    if (args.includes('--inspect')) {
        const src = SOURCES[SOURCES.length - 1];
        await inspect(src.url, src.headers);
        return;
    }
    const dryRun = args.includes('--dry-run');
    const outIdx = args.indexOf('--out');
    const out = outIdx > -1 ? args[outIdx + 1] : 'data/pl-news.json';

    const tried = [];
    for (const src of SOURCES) {
        process.stdout.write(`→ ${src.name}\n`);
        const r = await tryFetch(src);
        if (r.ok) {
            console.log(`✓ ${src.name}: ${r.items.length} article(s)`);
            r.items.slice(0, 3).forEach(i => console.log(`    · ${i.title}`));
            const payload = {
                fetchedAt: new Date().toISOString(),
                source: src.name,
                items: r.items.slice(0, MAX_ITEMS)
            };
            if (dryRun) { console.log(JSON.stringify(payload, null, 2)); return; }
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n');
            console.log(`written to ${out}`);
            return;
        }
        console.log(`  ✗ ${r.why}`);
        tried.push(`${src.name}: ${r.why}`);
    }

    /* Every source failed. Say so loudly and leave whatever is already in the
       file alone — a stale article list is better than none, and the run log
       now names each thing that was tried and why it did not work. */
    console.error('::error::No Premier League news source answered. Tried:');
    tried.forEach(t => console.error(`::error::  ${t}`));
    process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(e => { console.error(`::error::${e.message}`); process.exit(1); });
}
