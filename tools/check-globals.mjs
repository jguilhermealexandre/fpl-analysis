#!/usr/bin/env node
/* Fails when two files loaded by the same page declare the same top-level name.

   Every script on this site shares one global scope, so a duplicate silently
   replaces the earlier definition — and it has happened: twRecencyWeightedAvg
   in transfer-wizard.js exists only because compare-report.js already owns
   recencyWeightedAvg with different semantics. Naming discipline is the only
   thing preventing a repeat, and discipline is what CI is for. */
import fs from 'node:fs';
import { topLevelNames } from './scan-globals.mjs';
import { pages } from './page-scripts.mjs';

let failures = 0;
for (const [page, { scripts, inline }] of Object.entries(pages())) {
    const owner = new Map();
    const units = scripts.filter(s => fs.existsSync(s)).map(s => [s, fs.readFileSync(s, 'utf8')]);
    if (inline.trim()) units.push([`${page} (inline)`, inline]);
    for (const [name, src] of units) {
        for (const decl of topLevelNames(src)) {
            const prev = owner.get(decl);
            if (prev && prev !== name) {
                console.error(`✗ ${page}: "${decl}" declared in both ${prev} and ${name}`);
                failures++;
            }
            owner.set(decl, name);
        }
    }
}
if (failures) {
    console.error(`\n${failures} colliding global${failures === 1 ? '' : 's'}. Rename one, or move it behind a page-specific prefix.`);
    process.exit(1);
}
console.log('✓ no colliding globals across any page');
