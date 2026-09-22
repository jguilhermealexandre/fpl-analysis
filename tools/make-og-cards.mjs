#!/usr/bin/env node
/* The picture that shows up when a page of this site is pasted anywhere.
 *
 * Every page had <meta property="og:title"> and none had og:image, so a link
 * to easyfpl.com in a WhatsApp group, a Reddit thread or a Discord server —
 * which is where FPL is actually discussed — rendered as a bare blue line of
 * text next to whatever the scraper could find, usually nothing. That is the
 * one place the site is seen by people who have not chosen to visit it.
 *
 * One card per page rather than one for the site, because a card carrying the
 * page's own title is the difference between "someone linked easyfpl.com" and
 * "someone linked the bit about how the projections are graded". They are
 * generated from each page's own <title> and description, so they cannot
 * drift from the page the way a hand-made image does: change the title, run
 * this, and the card follows.
 *
 * Rendered in the browser rather than drawn with an image library, for the
 * same reason the screenshots are: it is the site's own typeface, the site's
 * own palette and the site's own hero wash, because it is the site's own CSS
 * and the same @font-face rules every page loads.
 *
 * Usage:  node tools/make-og-cards.mjs [--check]
 *         --check re-renders nothing and only reports pages whose card is
 *         missing, for CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const OUT = 'assets/og';
const check = process.argv.includes('--check');

/* The archive. These are the pages of this site most likely to be pasted into
   a thread, because they are the only ones that are about this week. Their
   titles and deks come from the article data the pages were built from, so a
   card and a page cannot disagree. */
export function cardArticles(root = '.') {
    const dir = path.join(root, 'data/articles');
    if (!fs.existsSync(path.join(dir, 'index.json'))) return [];
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    return index
        .filter(a => a.slug && fs.existsSync(path.join(root, `articles/${a.slug}.html`)))
        .map(a => ({ file: `articles/${a.slug}.html`, slug: `articles/${a.slug}`, title: a.title, desc: a.dek || '' }));
}

/* Pages worth a card: the ones a person might share. noindex pages are the
   sign-in screens and the admin tools, and nobody pastes those anywhere. */
export function cardPages(root = '.') {
    const out = [];
    for (const f of fs.readdirSync(root).filter(x => x.endsWith('.html')).sort()) {
        if (['footer.html', 'landing-nav.html', 'sidebar-nav.html'].includes(f)) continue;
        const html = fs.readFileSync(path.join(root, f), 'utf8');
        const robots = (html.match(/<meta name="robots" content="([^"]*)/) || [])[1] || '';
        if (robots.includes('noindex')) continue;
        const title = ((html.match(/<title>([^<]*)/) || [])[1] || '').trim();
        const desc = ((html.match(/<meta name="description" content="([^"]*)/) || [])[1] || '').trim();
        if (!title) continue;
        out.push({ file: f, slug: f.replace(/\.html$/, ''), title, desc });
    }
    return out;
}

/* "FPL FAQ — Common Questions | EasyFPL" is a <title>, written for a tab and
   a search result, and the card already carries the wordmark and the domain.
   What belongs on it is the claim, with the brand taken off whichever end it
   was on — the home page's title leads with it rather than trailing it. */
function cardTitle(t) {
    return t.split(/\s+\|\s+/)[0]
        .replace(/^EasyFPL\s+[—–-]\s+/, '')
        .trim();
}

/* A description is a sentence and ends like one. Cutting it at a word
   boundary and appending an ellipsis produced "…injury news.…" on the home
   page, which reads as a typo rather than as a trim. */
function cardDesc(d) {
    if (d.length <= 128) return d;
    return d.slice(0, 125).replace(/[\s,;.:—–-]+\S*$/, '') + '…';
}

/* The site's own @font-face rules, inlined rather than linked: this page is
   rendered from a string with no origin, so a /assets/fonts URL has nothing
   to resolve against and a file:// one is blocked. Read from the generated
   stylesheet, so the cards cannot end up set in a different face from the
   site, and embedded so there is nothing left to fetch. */
const FONT_CSS = fs.readFileSync('styles/fonts.css', 'utf8')
    .replace(/url\(\/assets\/fonts\/([\w.-]+)\)/g, (_m, f) =>
        `url(data:font/woff2;base64,${fs.readFileSync(path.join('assets/fonts', f)).toString('base64')})`);

function cardHTML({ title, desc }) {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>${FONT_CSS}</style>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    background: #15191F; color: #F4F5F7; position: relative; overflow: hidden;
    font-family: 'Inter', system-ui, sans-serif;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 72px 76px;
  }
  /* The landing hero's own wash, same colour and same shape. */
  body::before {
    content: ''; position: absolute; inset: -30% -10% auto; height: 760px;
    background: radial-gradient(56% 58% at 50% 34%, rgba(0, 229, 125, 0.16) 0%, transparent 72%);
  }
  .row { position: relative; display: flex; align-items: center; justify-content: space-between; }
  .mark { font-size: 34px; font-weight: 700; letter-spacing: -0.03em; }
  .mark b { color: #00E57D; font-weight: 700; }
  .badge {
    display: inline-flex; align-items: center; height: 38px; padding: 0 18px;
    border-radius: 999px; font-size: 16px; font-weight: 600; letter-spacing: 0.01em;
    color: #00E57D; background: rgba(0, 229, 125, 0.12);
    border: 1px solid rgba(0, 229, 125, 0.28);
  }
  main { position: relative; }
  h1 {
    font-weight: 700;
    font-size: ${title.length > 46 ? 62 : title.length > 30 ? 74 : 86}px;
    line-height: 1.02; letter-spacing: -0.035em; max-width: 1000px;
    text-wrap: balance;
  }
  p { margin-top: 26px; font-size: 25px; line-height: 1.45; color: #A8B1BF; max-width: 900px; }
  .foot { position: relative; font-size: 19px; color: #A8B1BF; letter-spacing: 0.01em; }
  .rule { position: absolute; left: 0; right: 0; bottom: 0; height: 6px; background: #00E57D; }
</style></head><body>
  <div class="row">
    <div class="mark">Easy<b>FPL</b></div>
    <div class="badge">Free FPL analysis</div>
  </div>
  <main>
    <h1>${esc(cardTitle(title))}</h1>
    ${desc ? `<p>${esc(cardDesc(desc))}</p>` : ''}
  </main>
  <div class="foot">easyfpl.com</div>
  <div class="rule"></div>
</body></html>`;
}

/* cardPages() is imported by tools/social-meta.mjs, which needs the list and
   not a browser. Everything below only runs when this file is the one being
   executed. */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!isMain) {
    // imported for cardPages() alone
} else {

const pages = [...cardPages(), ...cardArticles()];

if (check) {
    const missing = pages.filter(p => !fs.existsSync(`${OUT}/${p.slug}.png`));
    if (missing.length) {
        for (const m of missing) console.error(`✗ no social card for ${m.file} — expected ${OUT}/${m.slug}.png`);
        console.error('\nRun: node tools/make-og-cards.mjs');
        process.exit(1);
    }
    console.log(`✓ every one of the ${pages.length} shareable page(s) has a social card`);
    process.exit(0);
}

const { chromium } = await import('playwright');
const { default: sharp } = await import('sharp');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
for (const p of pages) {
    await page.setContent(cardHTML(p), { waitUntil: 'load' });
    /* document.fonts.ready alone resolves before a stylesheet-linked webface
       has been fetched and applied, and the first run of this silently drew
       every card in the fallback sans. Asking for the two faces by name is
       what actually waits for them. */
    await page.evaluate(() => Promise.all([
        document.fonts.load('700 86px "Inter"'),
        document.fonts.load('400 25px "Inter"'),
        document.fonts.load('600 19px "Inter"')
    ]).then(() => document.fonts.ready));
    /* Measured, not asked: document.fonts.check() answers for the whole
       fallback chain, so it returns true when the face never arrived. The
       first run of this drew all twenty cards in the fallback sans and said
       nothing. */
    const drawn = await page.evaluate(() => {
        const m = (family) => { const s = document.createElement('span');
            s.style.cssText = `position:absolute;font:700 120px ${family}`; s.textContent = 'Handgloves';
            document.body.appendChild(s); const w = s.getBoundingClientRect().width; s.remove(); return w; };
        return Math.abs(m('Inter, sans-serif') - m('sans-serif')) > 0.5;
    });
    if (!drawn) throw new Error('Inter did not load — the cards would ship in a fallback face');
    fs.mkdirSync(path.dirname(`${OUT}/${p.slug}.png`), { recursive: true });
    /* Through sharp rather than straight to disk. A 1200x630 screenshot of
       flat colour and text is 175KB of truecolour PNG and about 30KB as a
       palette one, with no visible difference — and there are forty-six of
       them, which is the difference between 8MB in the repository and half a
       megabyte. PNG rather than WebP because these are read by link scrapers,
       and not all of them handle WebP. */
    const shot = await page.screenshot({ type: 'png' });
    await sharp(shot).png({ palette: true, quality: 92, effort: 9 }).toFile(`${OUT}/${p.slug}.png`);
    console.log(`  ${p.slug}.png  ${cardTitle(p.title)}`);
}
await browser.close();
console.log(`✓ ${pages.length} card(s) in ${OUT}/`);

}
