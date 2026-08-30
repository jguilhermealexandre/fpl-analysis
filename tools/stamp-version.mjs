#!/usr/bin/env node
/* One asset version, stamped everywhere.

   Cache-busting was three incompatible schemes: 87 hand-edited ?v=N across the
   HTML, hardcoded literals for the nav partials inside common.js and
   sidebar-nav.js, and window.ASSET_V for the footer — which nothing ever
   assigned, so footer.html was pinned at v=62 permanently and could not be
   busted at all.

   The failure mode of the manual scheme is silence: change a shared script,
   forget one of the fourteen pages, and that page keeps serving the cached copy.
   Nothing errors. Running this is now the whole procedure.

   Usage:  node tools/stamp-version.mjs [--check]
           --check exits non-zero if anything is out of date, for CI. */
import fs from 'node:fs';

const VERSION_FILE = 'asset-version.json';
const check = process.argv.includes('--check');

const version = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')).version;
if (!Number.isInteger(version)) { console.error('asset-version.json must hold an integer "version"'); process.exit(1); }

const targets = [
    // Every ?v=<digits> in page markup — scripts, stylesheets, the lot.
    ...fs.readdirSync('.').filter(f => f.endsWith('.html')).map(f => ({ file: f, rx: /\?v=\d+/g })),
    // The nav partials fetch themselves, so their busters live in JS.
    { file: 'scripts/sidebar-nav.js', rx: /(sidebar-nav\.html\?v=)\d+/g, keep: 1 },
    { file: 'scripts/common.js', rx: /(nav\.html\?v=)\d+/g, keep: 1 },
    { file: 'scripts/common.js', rx: /(footer\.html\?v=)\d+/g, keep: 1 }
];

let stale = [];
for (const t of targets) {
    if (!fs.existsSync(t.file)) continue;
    const src = fs.readFileSync(t.file, 'utf8');
    const next = t.keep
        ? src.replace(t.rx, (_m, p1) => `${p1}${version}`)
        : src.replace(t.rx, `?v=${version}`);
    if (next !== src) {
        stale.push(t.file);
        if (!check) fs.writeFileSync(t.file, next);
    }
}

if (check) {
    if (stale.length) {
        console.error(`✗ asset version ${version} not stamped in: ${[...new Set(stale)].join(', ')}`);
        console.error('  Run: npm run stamp');
        process.exit(1);
    }
    console.log(`✓ every asset reference is at v${version}`);
} else {
    console.log(stale.length
        ? `✓ stamped v${version} into ${[...new Set(stale)].length} file(s)`
        : `✓ already at v${version}`);
}
