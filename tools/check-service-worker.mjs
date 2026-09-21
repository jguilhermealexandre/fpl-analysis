#!/usr/bin/env node
/* Every precached path must exist, and the worker must be versioned.

   cache.addAll() is atomic: one missing URL rejects the whole install and the
   service worker never activates. So a file deleted from the repo without being
   deleted from STATIC_ASSETS is not a small oversight — it is the offline
   experience gone for every visitor, silently, with the site otherwise working
   perfectly.

   It happened. /scripts/players-ai.js went with the FPL assistant and stayed in
   the list for days, and the only reason nothing broke is that Cloudflare Pages
   was answering unknown paths with 200 and the full dashboard — so addAll
   "succeeded" and cached a 322 KB HTML document under a .js key. The moment
   that soft 404 was fixed (functions/_middleware.js) the stale entry would have
   become a worker that installs for nobody.

   Two faults, each masking the other, and neither visible from the browser.
   This is the check that makes the first one loud.

   Usage: node tools/check-service-worker.mjs
*/
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SW = 'service-worker.js';

/* The list as the worker will see it. Read out of the source rather than
   imported, because the file is a service worker and importing it would run
   self.addEventListener against a Node global that has none. */
export function precachedPaths(src) {
    const block = /const STATIC_ASSETS\s*=\s*\[([\s\S]*?)\]\s*;/.exec(src);
    if (!block) return null;
    return [...block[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map(m => m[1] ?? m[2]);
}

/* '/' is index.html; everything else is a path from the site root. Query
   strings are not expected here and would not resolve to a file on disk. */
export function resolveEntry(entry) {
    if (entry === '/') return 'index.html';
    if (!entry.startsWith('/')) return null;          // relative: wrong for a precache list
    return entry.slice(1).split('?')[0];
}

function main() {
    const src = fs.readFileSync(path.join(ROOT, SW), 'utf8');
    const entries = precachedPaths(src);
    const problems = [];

    if (!entries) {
        console.error(`✗ ${SW}: could not find a STATIC_ASSETS array to check`);
        process.exit(1);
    }

    for (const entry of entries) {
        const rel = resolveEntry(entry);
        if (rel == null) {
            problems.push(`${entry} is relative — a precache list is resolved against the worker's scope, not a page`);
            continue;
        }
        if (!fs.existsSync(path.join(ROOT, rel))) {
            problems.push(`${entry} is precached but ${rel} does not exist`);
        }
    }

    /* Every other same-origin asset the worker names — the notification icon
       and badge live outside STATIC_ASSETS and are fetched only when a push
       arrives, which is the least observable moment on the site. /icon-192.png
       sat there broken for the whole life of the feature. */
    for (const m of src.matchAll(/(?:icon|badge):\s*'(\/[^']+)'/g)) {
        const rel = m[1].slice(1).split('?')[0];
        if (!fs.existsSync(path.join(ROOT, rel))) {
            problems.push(`${m[1]} is used as a notification icon but does not exist`);
        }
    }

    /* A worker whose cache name never changes cannot evict anything: activate
       deletes caches that are not the current name, so the name IS the eviction
       mechanism. */
    if (!/const CACHE_NAME\s*=\s*['"][^'"]*v\d+['"]/.test(src)) {
        problems.push('CACHE_NAME has no version suffix, so activate() can never evict an old cache');
    }

    if (problems.length) {
        problems.forEach(p => console.error(`✗ ${p}`));
        console.error(`\ncache.addAll() is atomic — any one of these stops the service worker installing at all.`);
        process.exit(1);
    }
    console.log(`✓ ${entries.length} precached paths all exist, and the cache is versioned`);
}

if (process.argv[1] && process.argv[1].endsWith('check-service-worker.mjs')) main();
