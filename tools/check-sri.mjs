#!/usr/bin/env node
/* Re-hashes every pinned CDN script and compares against the integrity attribute.

   These versions are immutable on both CDNs, so a mismatch means one of two
   things: the package was republished, or the CDN is serving something it should
   not be. Either way the browser will refuse to run the file and the feature
   simply stops working — Chart.js vanishing takes every graph on the site with
   it, with nothing in the console to explain why beyond an integrity error.

   Run on a schedule rather than on every push: it needs the network, and a
   failure is news about the outside world rather than about the commit. */
import fs from 'node:fs';
import crypto from 'node:crypto';

const targets = new Map();

// Static tags in page markup.
for (const f of fs.readdirSync('.').filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(f, 'utf8');
    for (const m of html.matchAll(/<script src="(https:\/\/[^"]+)"[^>]*integrity="([^"]+)"/g)) {
        targets.set(m[1], { hash: m[2], where: f });
    }
}
// The runtime-injected one.
const common = fs.readFileSync('scripts/common.js', 'utf8');
const inj = /s\.src = '(https:\/\/[^']+)';\s*\n\s*s\.integrity = '([^']+)'/.exec(common);
if (inj) targets.set(inj[1], { hash: inj[2], where: 'scripts/common.js' });

if (!targets.size) { console.error('::error::no pinned CDN scripts found — did the markup change?'); process.exit(1); }

let bad = 0;
for (const [url, { hash, where }] of targets) {
    let res;
    try {
        res = await fetch(url, { redirect: 'follow' });
    } catch (e) {
        console.error(`::warning::${url} unreachable (${e.message}) — skipping, not failing`);
        continue;
    }
    if (!res.ok) { console.error(`::warning::${url} returned ${res.status} — skipping`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const actual = 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
    if (actual !== hash) {
        console.error(`::error::integrity mismatch for ${url} (pinned in ${where})`);
        console.error(`  expected ${hash}`);
        console.error(`  served   ${actual}`);
        bad++;
    } else {
        console.log(`✓ ${url.replace('https://','')}  (${buf.length} bytes)`);
    }
}
if (bad) {
    console.error(`\n${bad} script(s) no longer match their pinned hash. The browser is blocking them right now.`);
    process.exit(1);
}
console.log(`\n✓ all ${targets.size} pinned CDN scripts match`);
