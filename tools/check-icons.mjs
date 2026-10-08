#!/usr/bin/env node
/* Two ways a mark on this site can silently render as nothing, both of which
   had happened and neither of which anything caught.

   1. v2Icon('name') with a name that is not in V2_ICON_PATHS. The function
      returns an empty string for an unknown name — deliberately, so a missing
      icon never throws — which means the only symptom is a gap where every
      other heading has its mark. The draft planner's "Find a replacement
      yourself" heading had been calling v2Icon('search') with no `search` path
      behind it.

   2. A conditional whose branches are all empty strings. The sweep that took
      the emoji out of the site left `? '📈' : '📉'` as `? '' : ''` in four
      places and never put the replacements in. One of them was the price
      ticker's up/down arrow — with CSS sitting right beside it saying "the
      ticker marks are SVG now rather than emoji, so they need a size", which
      is the half of that migration that did ship. Another was the GW Draft
      table's injury flag, so an injured player looked exactly like a fit one
      on the table you plan a draft from.

   Both are invisible to every other gate: the syntax is valid, the lint is
   clean, the tests pass, and the page renders. Only a human looking at the
   right pixel would notice, which is why it took months.

   Not a parser. It does not need to be: both faults are local to one
   expression, and a false positive here is a dead ternary that genuinely
   should be written some other way.

   It does have to ignore comments, though, and the first version did not — it
   flagged the comment in draft-planner.js that quotes the old broken code in
   order to explain what replaced it. A checker that cannot be written about is
   a checker people work around. So comments come out first — with
   stripComments from scan-globals.mjs, this repo's one JS lexer, rather than a
   second hand-rolled one. The hand-rolled version this file started with read
   `${a ? `x` : ''}` as the end of a template and lost its place for the rest of
   the file, which is the same fault that lexer already documents having had. */
import fs from 'node:fs';
import { stripComments } from './scan-globals.mjs';

const files = [
    ...fs.readdirSync('scripts').filter(f => f.endsWith('.js') && !f.endsWith('.min.js')).map(f => `scripts/${f}`),
    ...fs.readdirSync('.').filter(f => f.endsWith('.html'))
];

/* The icon table, read out of the source rather than imported: common.js is a
   classic script and has no exports. */
const common = fs.readFileSync('scripts/common.js', 'utf8');
const open = common.indexOf('const V2_ICON_PATHS = {');
if (open < 0) {
    console.error('✗ V2_ICON_PATHS not found in scripts/common.js');
    process.exit(1);
}
const block = common.slice(open, common.indexOf('\n};', open));
const known = new Set([...block.matchAll(/^ {4}([A-Za-z][\w]*):/gm)].map(m => m[1]));

const problems = [];
const lineOf = (src, i) => src.slice(0, i).split('\n').length;

for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    // HTML comments first — <!-- --> is not a JS comment and can quote code too.
    const src = stripComments(raw.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' ')));

    /* Every quoted string inside a v2Icon(...) call, so the ternary form
       v2Icon(up ? 'trend' : 'trendDown') is covered as well as the literal.
       Stops at the first ')' — none of these calls nest one. */
    for (const m of src.matchAll(/v2Icon\(([^)]*)\)/g)) {
        for (const q of m[1].matchAll(/'([^']*)'|"([^"]*)"/g)) {
            const name = q[1] ?? q[2];
            if (!name) continue;
            if (!known.has(name)) {
                problems.push(`${file}:${lineOf(src, m.index)}  v2Icon('${name}') — no such key in V2_ICON_PATHS`);
            }
        }
    }

    // A conditional every branch of which is an empty string literal.
    for (const m of src.matchAll(/\?\s*(''|"")\s*:\s*(?:[^?:;]{0,80}?\?\s*(''|"")\s*:\s*)?(''|"")/g)) {
        problems.push(`${file}:${lineOf(src, m.index)}  every branch of this conditional is an empty string: ${m[0].replace(/\s+/g, ' ').trim()}`);
    }
}

if (problems.length) {
    console.error(`✗ ${problems.length} icon/marker problem${problems.length === 1 ? '' : 's'}:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
}
console.log(`✓ ${known.size} icon paths; every v2Icon() name resolves and no conditional renders nothing`);
