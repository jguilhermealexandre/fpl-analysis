#!/usr/bin/env node
/* Watch the Premier League news page load, and write down what it asks for.
 *
 * Everything up to here was inference from the app bundle, and it got a long
 * way — the gateway host, the account slug, the language, the two X-Pulse
 * headers, the limit/offset convention — but the content endpoint still
 * answers "No configuration found for request" to every spelling of the path
 * those clues produce. At that point another guess is not worth a run.
 *
 * So: open the page in a real browser and record the requests. Whatever URL
 * comes back 200 with articles in it is the answer, headers and all, and there
 * is nothing left to deduce. This needs a browser with unrestricted network,
 * which is what the CI runner is.
 *
 * Run: node tools/pl-news-browser.mjs
 */
const NEWS_PAGE = 'https://www.premierleague.com/en/news';

let chromium;
try {
    ({ chromium } = await import('playwright'));
} catch {
    console.error('::error::playwright is not installed — the workflow step installs it before this runs');
    process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
        + '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
});

/* Only the requests that could carry articles. The page pulls in a few hundred
   images and fonts and none of them are the point. */
const interesting = url => /content|article|news|editorial|sdp|pulselive/i.test(url)
    && !/\.(png|jpg|jpeg|webp|svg|woff2?|css|ico)(\?|$)/i.test(url);

const seen = [];
page.on('request', req => {
    if (!interesting(req.url())) return;
    seen.push({ url: req.url(), method: req.method(), headers: req.headers() });
});

const responses = new Map();
page.on('response', async res => {
    const url = res.url();
    if (!interesting(url)) return;
    let body = '';
    try {
        const ct = res.headers()['content-type'] || '';
        if (/json/i.test(ct)) body = (await res.text()).slice(0, 1200);
    } catch { /* a response that cannot be read is still worth its status */ }
    responses.set(url, { status: res.status(), body });
});

await page.goto(NEWS_PAGE, { waitUntil: 'networkidle', timeout: 60000 });
// The article list arrives after hydration, so give the app a moment past idle.
await page.waitForTimeout(4000);

console.log(`=== ${seen.length} candidate request(s) ===\n`);
for (const req of seen) {
    const res = responses.get(req.url) || {};
    console.log(`${res.status || '???'}  ${req.method}  ${req.url}`);
    // The headers are the half that could not be inferred from the bundle.
    const hdrs = Object.entries(req.headers)
        .filter(([k]) => /^(x-|account|origin|referer|authorization|accept$)/i.test(k))
        .map(([k, v]) => `${k}: ${/authorization/i.test(k) ? '<redacted>' : v}`);
    if (hdrs.length) console.log(`      ${hdrs.join('  |  ')}`);
    if (res.body) console.log(`      body: ${res.body.replace(/\s+/g, ' ').slice(0, 500)}`);
    console.log('');
}

/* And the rendered article list, which says what a working response looks like
   even if the request that produced it was missed. */
const links = await page.$$eval('a[href*="/news/"]', as => as.slice(0, 12).map(a => ({
    href: a.href,
    text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90)
})));
console.log(`=== ${links.length} rendered news link(s) ===`);
links.forEach(l => console.log(`  ${l.href}\n     ${l.text}`));

await browser.close();
