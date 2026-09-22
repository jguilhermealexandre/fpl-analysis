#!/usr/bin/env node
/* ============================================
   EasyFPL — article archive builder

   Runs after the FPL data refresh. Executes the same generators the browser
   uses (scripts/scouts-desk.js is loaded as a module here) and writes each
   article to disk once, keyed by the gameweek it describes.

   Two outputs per article:
     data/articles/<slug>.json   — the feed reads these
     articles/<slug>.html        — a real static page, so the text exists in
                                   the HTML for crawlers rather than being
                                   assembled by JavaScript at view time

   Existing files are never rewritten. A gameweek's debrief is a record of that
   gameweek; regenerating it later against newer data would quietly rewrite
   history, and the archive is the only reason this build step exists.
   ============================================ */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const ARTICLE_DATA = path.join(DATA, 'articles');
const ARTICLE_HTML = path.join(ROOT, 'articles');
const SITE = 'https://easyfpl.com';

const sd = require('./scouts-desk.js');
const art = require('./scouts-art.js');

// Reading order within a single build. Evergreen explainer sits last.
const SECTION_ORDER = ['Gameweek Debrief', 'Hall of Shame', 'Strategy', 'Fixture Watch', 'Data Deep-Dive',
    'Market', 'Tactical', 'Differentials', 'Budget', 'Behind the Build'];

function readJSON(file, fallback) {
    try { return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); }
    catch (e) { console.warn(`  ! could not read ${file}: ${e.message}`); return fallback; }
}

function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A standalone page carrying the article text in the markup. No JavaScript is
// needed to read it, which is the entire point.
function articlePage(a) {
    const url = `${SITE}/articles/${a.slug}.html`;
    const published = new Date(a.date).toISOString();
    const bodyHtml = sd.sdMarkdown(a.body);

    const words = a.words || sd.sdWordCount(a.body);
    const ld = {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: a.title,
        description: a.dek,
        datePublished: published,
        dateModified: published,
        author: { '@type': 'Organization', name: 'EasyFPL' },
        publisher: { '@type': 'Organization', name: 'EasyFPL' },
        mainEntityOfPage: url,
        articleSection: a.category,
        wordCount: words,
        timeRequired: `PT${a.readTime}M`,
        inLanguage: 'en-GB',
        isAccessibleForFree: true
    };

    return `<!DOCTYPE html>
<html lang="en" class="v2-theme">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(a.title)} — The Scout's Desk | Easy FPL</title>
<meta name="description" content="${esc(a.dek)}">
<!-- The site's mark. Every other page carries it; these were generated
     without one, so the archive was the only part of EasyFPL that showed
     the browser's blank page icon in a tab. -->
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="alternate icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Crect%20width='100'%20height='100'%20rx='20'%20fill='%2310B981'/%3E%3Ctext%20x='50'%20y='72'%20font-size='65'%20font-family='Arial,sans-serif'%20font-weight='bold'%20fill='%230a0f1a'%20text-anchor='middle'%3Ee%3C/text%3E%3C/svg%3E">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(a.title)}">
<meta property="og:description" content="${esc(a.dek)}">
<meta property="og:url" content="${url}">
<meta property="article:published_time" content="${published}">
<meta property="article:section" content="${esc(a.category)}">
<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../styles/common.css">
<link rel="stylesheet" href="../styles/v2-design.css">
<link rel="stylesheet" href="../styles/scouts-desk.css">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
<main class="sd-standalone">
    <nav class="sd-crumb"><a href="../fpl-scouts-desk.html">← The Scout's Desk</a></nav>
    <article class="sd-reader-body">
        <!-- The same generated artwork the Desk's cards carry, at the
             featured size. Written into the markup rather than drawn by
             script, because this page runs none. -->
        <div class="sd-standalone-art">${art.sdArtwork(a, 'lead')}</div>
        <div class="sd-tags">
            <span class="sd-tag primary">${esc(a.icon)} ${esc(a.category)}</span>
            <span class="sd-read">${a.readTime} min read</span>
            <span class="sd-read">${words.toLocaleString()} words</span>
        </div>
        <h1 class="sd-reader-title">${esc(a.title)}</h1>
        <p class="sd-reader-dek">${esc(a.dek)}</p>
        <div class="sd-reader-meta">
            <time datetime="${published}">${new Date(a.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</time>
            · ${esc(a.source)}
        </div>
        <div class="sd-prose">${bodyHtml}</div>
        <div class="sd-reader-foot">
            Every figure in this piece was read from the FPL dataset at the moment it was published, and has not been edited since.
        </div>
    </article>
</main>
</body>
</html>
`;
}

function main() {
    const boot = readJSON('bootstrap-static.json', null);
    if (!boot) { console.error('No bootstrap data — nothing to build.'); process.exit(0); }
    const fixtures = readJSON('fixtures.json', []);
    const players = readJSON('players-data.json', { players: [] });

    sd.sdSetData(boot, fixtures, players);
    fs.mkdirSync(ARTICLE_DATA, { recursive: true });
    fs.mkdirSync(ARTICLE_HTML, { recursive: true });

    const built = sd.sdBuildArchive();
    console.log(`Generators produced ${built.length} candidate article(s) for GW${sd.sdLastRound()}.`);
    built.forEach(a => console.log(`    ${a.slug} — ${a.words} words, ${a.readTime} min`));

    // One timestamp for the whole build. Stamping each article as it is written
    // gives them different milliseconds, and the date sort then reverses the
    // write order before the section tiebreak ever gets a say.
    const buildTime = new Date().toISOString();

    let written = 0, skipped = 0;
    built.forEach(a => {
        const jsonPath = path.join(ARTICLE_DATA, `${a.slug}.json`);
        if (fs.existsSync(jsonPath)) { skipped++; return; }

        a.date = buildTime;
        fs.writeFileSync(jsonPath, JSON.stringify(a, null, 2));
        fs.writeFileSync(path.join(ARTICLE_HTML, `${a.slug}.html`), articlePage(a));
        console.log(`  + ${a.slug}`);
        written++;
    });
    console.log(`Wrote ${written}, left ${skipped} existing article(s) untouched.`);

    // Index: newest first, body omitted so the feed stays small.
    const index = fs.readdirSync(ARTICLE_DATA)
        .filter(f => f.endsWith('.json') && f !== 'index.json')
        .map(f => {
            const a = JSON.parse(fs.readFileSync(path.join(ARTICLE_DATA, f), 'utf8'));
            /* `subject` rides in the index, not just in the article file: the
               feed renders its cards from this listing alone and would
               otherwise draw every one of them faceless. It is three short
               fields, which is a price worth paying to keep the index small
               while still letting a card carry a face. */
            return { slug: a.slug, title: a.title, dek: a.dek, category: a.category,
                icon: a.icon, readTime: a.readTime, words: a.words, date: a.date, source: a.source,
                gw: a.gw, featured: !!a.featured, subject: a.subject || null };
        })
        // Everything written in one build shares a timestamp, so date alone leaves
        // the order to readdir. Break ties on gameweek, then on a fixed section
        // order, so the debrief always leads its own week.
        .sort((x, y) => (new Date(y.date) - new Date(x.date))
            || ((y.gw || 0) - (x.gw || 0))
            || (SECTION_ORDER.indexOf(x.category) - SECTION_ORDER.indexOf(y.category)));

    // Only the newest debrief leads the page; older ones become ordinary cards.
    let leadTaken = false;
    index.forEach(a => {
        const isDebrief = a.category === 'Gameweek Debrief';
        a.featured = isDebrief && !leadTaken;
        if (a.featured) leadTaken = true;
    });

    fs.writeFileSync(path.join(ARTICLE_DATA, 'index.json'), JSON.stringify(index, null, 2));
    console.log(`Index lists ${index.length} article(s).`);

    /* Sitemap: the pages plus every archived article.
     *
     * EXTENSIONLESS, and that is the whole point of this shape. Cloudflare
     * Pages 308s every .html URL to its bare form — /fpl-faq.html becomes
     * /fpl-faq before anything else happens — so listing the .html spelling
     * made every one of the 34 entries a redirect. Google's guidance is that a
     * sitemap lists the canonical, 200-returning URL; a sitemap of redirects is
     * a sitemap asking to be ignored. The canonical tags on the pages
     * themselves now use the same spelling, so the three agree: what is linked,
     * what is declared canonical, and what is submitted.
     *
     * The four gated pages are NOT here. They answer 302 to /login.html for a
     * signed-out visitor, which includes every crawler, and /login.html is
     * noindex — so submitting them is asking Google to index a redirect to a
     * page that refuses to be indexed. They come back the day they serve a
     * public preview instead. */
    const pages = ['', 'fpl-scouts-desk', 'fpl-news', 'fpl-how-it-works', 'fpl-faq',
        'fpl-methodology', 'fpl-privacy', 'fpl-contact',
        /* The marketing pages built since this list was written. They are
           public, they are the pages a search for "fpl transfer planner" should
           find, and none of them was being submitted. */
        'fpl-pricing', 'fpl-accuracy', 'fpl-changelog', 'fpl-terms',
        'feature-squad-analysis', 'feature-transfer-wizard', 'feature-lineup-wizard',
        'feature-player-explorer', 'feature-fixture-ratings', 'feature-league-rivals',
        'feature-scouts-desk', 'feature-team-news'];
    const today = new Date().toISOString().slice(0, 10);
    const urls = pages.map(p => `  <url><loc>${SITE}/${p}</loc><lastmod>${today}</lastmod></url>`)
        .concat(index.map(a => `  <url><loc>${SITE}/articles/${a.slug}</loc><lastmod>${a.date.slice(0, 10)}</lastmod></url>`));
    fs.writeFileSync(path.join(ROOT, 'sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);

    fs.writeFileSync(path.join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
    console.log(`Sitemap: ${urls.length} URLs.`);
}

main();
