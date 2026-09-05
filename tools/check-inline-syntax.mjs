#!/usr/bin/env node
/* Every inline <script> in every page must parse.

   ESLint only sees scripts/. Until the ~14.6k lines living inside HTML are
   extracted, this is the only automated guard on them — and a syntax error in
   an inline block takes the whole page down, silently, with no build step to
   catch it first. */
import vm from 'node:vm';
import { pages } from './page-scripts.mjs';

let bad = 0, checked = 0;
for (const [page, { inline }] of Object.entries(pages())) {
    if (!inline.trim()) continue;
    checked++;
    try {
        new vm.Script(inline, { filename: page });
    } catch (e) {
        console.error(`✗ ${page}: ${e.message}`);
        bad++;
    }
}
if (bad) { console.error(`\n${bad} page(s) with a syntax error in inline script.`); process.exit(1); }
console.log(`✓ inline script parses on all ${checked} page(s) with any`);
