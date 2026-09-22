#!/usr/bin/env node
/* A local server for a site that had no way to be run locally.
   Zero dependencies — node:http and node:fs are enough for static files, and
   adding a package for this would be the only runtime dependency in the repo.

   It also honours _redirects, so /squad-analysis behaves the way it does in
   production rather than 404ing only on your machine.

   Usage:  npm run dev        (http://localhost:8080)
           npm run dev -- 3000 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.argv[2]) || 8080;

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
    '.ico': 'image/x-icon', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8'
};

const CACHE_LIKE_PROD = process.env.DEV_CACHE === '1';

// Parsed once at boot; restart to pick up changes to _redirects.
const redirects = (() => {
    try {
        return fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8')
            .split('\n').map(l => l.trim())
            .filter(l => l && !l.startsWith('#'))
            .map(l => l.split(/\s+/))
            .filter(p => p.length >= 2)
            .map(([from, to, code]) => ({ from, to, code: Number(code) || 200 }));
    } catch { return []; }
})();

function resolveRedirect(pathname) {
    for (const r of redirects) {
        if (r.from === pathname) return r;
        if (r.from.endsWith('/*') && pathname.startsWith(r.from.slice(0, -1))) return r;
    }
    return null;
}

http.createServer((req, res) => {
    let pathname = decodeURIComponent(url.parse(req.url).pathname);

    const hit = resolveRedirect(pathname);
    if (hit) {
        if (hit.code >= 300 && hit.code < 400) {
            res.writeHead(hit.code, { Location: hit.to });
            return res.end();
        }
        pathname = hit.to;   // 200 rewrite: serve the target in place
    }
    if (pathname.endsWith('/')) pathname += 'index.html';

    /* Clean URLs, as Pages serves them. Every canonical on the site and every
       entry in sitemap.xml names the extensionless form — /fpl-faq, not
       /fpl-faq.html — so a server that only answers the second one disagrees
       with the site's own account of where its pages live, and a link written
       the canonical way 404s here while working in production. */
    if (!path.extname(pathname)) {
        const asPage = path.join(ROOT, pathname + '.html');
        if (asPage.startsWith(ROOT) && fs.existsSync(asPage)) pathname += '.html';
    }

    // Stay inside the repo.
    const file = path.join(ROOT, pathname);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

    fs.readFile(file, (err, body) => {
        if (err) {
            /* The site's own 404 page, at a 404, which is what Pages does with
               a root 404.html. A plain text body here meant the one page a
               broken link actually reaches was the one page never looked at. */
            const notFound = path.join(ROOT, '404.html');
            if (pathname !== '/404.html' && fs.existsSync(notFound)) {
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
                return res.end(fs.readFileSync(notFound));
            }
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end(`404  ${pathname}`);
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            /* Never cache locally: the whole point is seeing the edit you just
               made.

               Except when measuring. _headers serves /assets, /scripts and
               /styles immutable for a year, and no-store changes what the
               page does rather than only how fast it is: a preloaded response
               marked no-store is discarded and fetched again, so every
               preload on the page happened twice and the second copy was what
               gated the largest paint. Numbers taken here described this
               server, not the site. DEV_CACHE=1 puts production's headers
               back for exactly those three directories. */
            'Cache-Control': CACHE_LIKE_PROD && /^\/(assets|scripts|styles)\//.test(pathname)
                ? 'public, max-age=31536000, immutable'
                : 'no-store'
        });
        res.end(body);
    });
}).listen(PORT, () => {
    console.log(`\n  easyfpl → http://localhost:${PORT}\n`);
    console.log(`  ${redirects.length} redirect rule(s) loaded from _redirects`);
    console.log('  Data is served from the committed data/*.json, so the site works offline.');
    if (CACHE_LIKE_PROD) console.log('  DEV_CACHE=1: /assets, /scripts and /styles carry production cache headers.');
    console.log('  Ctrl-C to stop.\n');
});
