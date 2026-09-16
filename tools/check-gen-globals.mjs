#!/usr/bin/env node
/* eslint.config.mjs is generated from the page and script sources by
   tools/gen-eslint-globals.mjs. If it is stale, eslint is linting against a
   list of globals the codebase no longer has: functions that were deleted
   still count as declared, and functions that were added read as undefined.

   CI has always checked this. `npm run check` did not — so the one gate that
   catches a stale generated file was the one gate a local run could not tell
   you about, and four pushes in a row went red on it while every local check
   passed. That gap is the whole reason this file exists.

   Unlike CI, this leaves the regenerated file in place: if it was stale the
   fix is already applied by the time you read the error, and all that is
   left is to commit it. */
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'eslint.config.mjs';
const before = fs.readFileSync(FILE, 'utf8');

execFileSync(process.execPath, ['tools/gen-eslint-globals.mjs'], { stdio: 'pipe' });

const after = fs.readFileSync(FILE, 'utf8');
if (before === after) {
    console.log('✓ generated globals match');
    process.exit(0);
}

const beforeLines = new Set(before.split('\n'));
const afterLines = new Set(after.split('\n'));
const added = [...afterLines].filter(l => !beforeLines.has(l) && l.trim());
const removed = [...beforeLines].filter(l => !afterLines.has(l) && l.trim());

console.error(`✗ ${FILE} was stale — it has been regenerated, so commit it.\n`);
if (added.length) console.error('  now declared:\n' + added.map(l => '    + ' + l.trim()).join('\n'));
if (removed.length) console.error('  no longer declared:\n' + removed.map(l => '    - ' + l.trim()).join('\n'));
process.exit(1);
