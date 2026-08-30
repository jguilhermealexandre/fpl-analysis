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

    // Stay inside the repo.
    const file = path.join(ROOT, pathname);
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

    fs.readFile(file, (err, body) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end(`404  ${pathname}`);
        }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            // Never cache locally: the whole point is seeing the edit you just made.
            'Cache-Control': 'no-store'
        });
        res.end(body);
    });
}).listen(PORT, () => {
    console.log(`\n  easyfpl → http://localhost:${PORT}\n`);
    console.log(`  ${redirects.length} redirect rule(s) loaded from _redirects`);
    console.log('  Data is served from the committed data/*.json, so the site works offline.');
    console.log('  Ctrl-C to stop.\n');
});
