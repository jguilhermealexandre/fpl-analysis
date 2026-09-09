#!/usr/bin/env node
/* Do the pictures we are storing actually load?
 *
 * The news page is showing nothing for the Premier League and the Guardian and
 * something soft and pixelated for the BBC, while the JSON has a URL for every
 * one of them. So the URLs are being written and the browser is refusing them,
 * which is a question about the URLs and not about the page — and it cannot be
 * answered from this sandbox, where every one of those hosts is blocked.
 *
 * This asks each of them, in CI, and tries the obvious rewrites alongside so
 * one run says both what is broken and what fixes it.
 *
 * Run: node tools/check-news-images.mjs
 */
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function probe(url, label, opts) {
    try {
        const headers = { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' };
        /* A browser sends a Referer; this does not, and hotlink protection is
           the difference between the two. Worth knowing which side of it we
           are on before blaming the URL. */
        if (opts && opts.referer) headers.Referer = opts.referer;
        const res = await fetch(url, { method: 'GET', headers, redirect: 'follow' });
        const type = res.headers.get('content-type') || '';
        const len = res.headers.get('content-length') || '?';
        console.log(`  ${String(res.status).padEnd(4)} ${label.padEnd(30)} ${type} ${len}B`);
        // A non-image body is the server explaining itself; print it.
        if (!/^image\//i.test(type)) {
            const body = await res.text();
            console.log(`       ${body.replace(/\s+/g, ' ').slice(0, 180)}`);
        }
        return res.ok && /^image\//i.test(type);
    } catch (e) {
        console.log(`  ERR  ${label.padEnd(30)} ${e.message}`);
        return false;
    }
}

function read(path) {
    try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return null; }
}

const pl = read('data/pl-news.json');
const feeds = read('data/news-feeds.json');

console.log('=== Premier League ===');
for (const item of (pl && pl.items || []).slice(0, 3)) {
    console.log(item.image);
    await probe(item.image, 'as stored');
    /* 400 with a JSON body means the image service wants parameters, not that
       the path is wrong — a Pulselive photo-resource is a source file and the
       public URL is a transform of it. These are the shapes it takes. */
    for (const [q, label] of [
        ['?width=800', 'width=800'],
        ['?width=800&height=450', 'width+height'],
        ['?width=800&height=450&fit=crop', 'width+height+fit'],
        ['?w=800', 'w=800'],
        ['?impolicy=Standard', 'impolicy'],
        ['/800x450', '/800x450 path segment']
    ]) {
        await probe(item.image + q, label);
    }
    console.log('');
}

/* Guardian and Sky both answered 200 here, yet the page shows nothing for the
   Guardian — so ask them again the way a browser would, with our own Referer
   on the request. Hotlink protection is exactly this difference. */
console.log('=== with a Referer, as a browser sends ===');
for (const feed of (feeds && feeds.feeds || [])) {
    const first = feed.items.find(i => i.image);
    if (first) await probe(first.image, `${feed.source} + referer`, { referer: 'https://easyfpl.pages.dev/fpl-news.html' });
}
console.log('');

for (const feed of (feeds && feeds.feeds || [])) {
    console.log(`=== ${feed.source} ===`);
    for (const item of feed.items.slice(0, 2)) {
        console.log(item.image);
        await probe(item.image, 'as stored');
        if (/ichef\.bbci\.co\.uk/.test(item.image)) {
            /* The feed asks for a 240px crop and the card is 300px wide, which
               is why it looks soft. The BBC serves the same image at any width
               from that path segment and signs nothing, so this is safe. */
            await probe(item.image.replace(/(\/ace\/[a-z]+\/)\d{2,4}(\/)/, '$1800$2'), 'widened to 800');
        }
        console.log('');
    }
}
