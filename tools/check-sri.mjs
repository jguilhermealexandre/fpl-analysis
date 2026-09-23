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
/* The runtime-injected ones.

   This used to match one exact shape: `s.src = '<url>';` on one line and
   `s.integrity = '<hash>';` on the next. The moment Chart.js moved out of the
   markup and into a lazy loader that assigns those two from named constants,
   the pattern stopped matching and the file silently dropped out of SRI
   coverage — no error, no warning, just one fewer thing checked. Which is the
   failure mode this whole file exists to catch, arriving through the back
   door.

   So: every pinned CDN URL in the file, paired with the sha384 literal nearest
   to it. Naming, formatting and the order of the two assignments no longer
   matter; only that both are present. A URL with no hash within reach is
   reported, because an injected script with no integrity is the thing worth
   knowing about. */
const common = fs.readFileSync('scripts/common.js', 'utf8');
const hashes = [...common.matchAll(/'(sha(?:256|384|512)-[A-Za-z0-9+/=]+)'/g)]
    .map(m => ({ hash: m[1], at: m.index }));
for (const m of common.matchAll(/'(https:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)\/[^']+)'/g)) {
    const near = hashes
        .map(h => ({ ...h, d: Math.abs(h.at - m.index) }))
        .sort((a, b) => a.d - b.d)[0];
    if (!near || near.d > 600) {
        console.error(`::error::${m[1]} is injected from scripts/common.js with no integrity hash near it`);
        process.exitCode = 1;
        continue;
    }
    targets.set(m[1], { hash: near.hash, where: 'scripts/common.js' });
}

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
