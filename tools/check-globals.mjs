#!/usr/bin/env node
/* Fails when two files loaded by the same page declare the same top-level name.

   Every script on this site shares one global scope, so a duplicate silently
   replaces the earlier definition — and it has happened: twRecencyWeightedAvg
   in transfer-wizard.js exists only because compare-report.js already owns
   recencyWeightedAvg with different semantics. Naming discipline is the only
   thing preventing a repeat, and discipline is what CI is for.

   It also checks that the scanner still understands every file, which is a
   different failure and a quieter one — see the balance pass below. */
import fs from 'node:fs';
import { topLevelNames, braceBalance } from './scan-globals.mjs';
import { pages } from './page-scripts.mjs';

const site = pages();

/* Does the scanner still know where it is?

   topLevelNames() finds declarations by brace depth, so the moment it
   mis-lexes something it loses every declaration after that point — and says
   nothing, because a shorter list of globals looks exactly like a smaller file.
   That is not hypothetical: an unrecognised regex literal in escHTML hid
   twenty-five names in common.js from the day it was written, and the only
   visible symptom was eslint.config.mjs quietly going stale.

   A unit whose braces do not net to zero is the observable those faults share.
   Real code always balances, so anything else is the lexer, not the source. */
let unbalanced = 0;
const seen = new Set();
for (const [page, { scripts, inline }] of Object.entries(site)) {
    const units = scripts.filter(s => fs.existsSync(s)).map(s => [s, fs.readFileSync(s, 'utf8')]);
    if (inline.trim()) units.push([`${page} (inline)`, inline]);
    for (const [name, src] of units) {
        if (seen.has(name)) continue;
        seen.add(name);
        const depth = braceBalance(src);
        if (depth !== 0) {
            console.error(`✗ ${name}: braces net to ${depth}, not 0 — the scanner has lost its place and every declaration after that point is invisible`);
            unbalanced++;
        }
    }
}

let failures = 0;
for (const [page, { scripts, inline }] of Object.entries(site)) {
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
if (unbalanced) {
    console.error(`\n${unbalanced} unit${unbalanced === 1 ? '' : 's'} the scanner could not read to the end. Fix tools/scan-globals.mjs, not the source.`);
}
if (failures) {
    console.error(`\n${failures} colliding global${failures === 1 ? '' : 's'}. Rename one, or move it behind a page-specific prefix.`);
}
if (unbalanced || failures) process.exit(1);
console.log(`✓ no colliding globals across any page; ${seen.size} units all balanced`);
