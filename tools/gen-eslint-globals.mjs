#!/usr/bin/env node
/* Regenerates the shared-globals block in eslint.config.mjs.

   Classic scripts reach each other's top-level names by design, which reads to
   any linter as thousands of undefined references. Declaring them is what makes
   no-undef usable here — and generating the list means it cannot drift.

   Inline blocks count. A page's global scope is the union of its <script src>
   files AND its inline <script>, and several modules under scripts/ legitimately
   read state that a page declares inline — xp-engine.js reads positionAverages
   and teamAnalysis, which index.html publishes from its own inline block. Omit
   those and no-undef fires on correct code. */
import fs from 'node:fs';
import { topLevelNames } from './scan-globals.mjs';
import { pages } from './page-scripts.mjs';

const names = new Set();
for (const f of fs.readdirSync('scripts').sort()) {
    if (f.endsWith('.js') && f !== 'build-articles.js') {
        for (const n of topLevelNames(fs.readFileSync(`scripts/${f}`, 'utf8'))) names.add(n);
    }
}
let inlineCount = 0;
for (const { inline } of Object.values(pages())) {
    if (!inline.trim()) continue;
    for (const n of topLevelNames(inline)) { if (!names.has(n)) inlineCount++; names.add(n); }
}

const sorted = [...names].sort();
const block = sorted.map(n => `                ${n}: 'writable',`).join('\n');
const cfg = fs.readFileSync('eslint.config.mjs', 'utf8');
fs.writeFileSync('eslint.config.mjs', cfg.replace(
    /(\/\* GENERATED-GLOBALS-START \*\/\n)[\s\S]*?(\n\s*\/\* GENERATED-GLOBALS-END \*\/)/,
    `$1${block}$2`));
console.log(`✓ ${sorted.length} shared globals (${inlineCount} from inline page blocks)`);
