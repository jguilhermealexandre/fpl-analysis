#!/usr/bin/env node
/* Every inline <style> block, and every stylesheet, must have balanced braces.

   This exists because of a real outage. Removing a component's rules from
   index.html by pattern left one orphaned declaration body and an unclosed
   @media, and the page still passed every gate: eslint does not read HTML, the
   inline-script check only parses <script>, and there is no build step. A
   browser recovers from broken CSS by discarding everything it cannot parse,
   so what shipped was a page whose price-ticker strip had no styles at all —
   30px of scrolling marquee rendered as a 147px static block — with nothing
   anywhere reporting an error.

   Brace depth is a coarse check and deliberately so: it catches the one class
   of damage that silently disables the rest of a stylesheet, and it cannot
   produce a false alarm on valid CSS. */
import fs from 'node:fs';
import path from 'node:path';

const IGNORE_DIRS = new Set(['node_modules', '.git', 'data']);

function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/* Braces inside a string or url() are text, not structure. */
function depthOf(css) {
    const clean = stripComments(css)
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/'(?:\\.|[^'\\])*'/g, "''");
    let depth = 0, min = 0;
    for (const ch of clean) {
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth < min) min = depth; }
    }
    return { depth, min };
}

function lineOfOffset(text, offset) {
    return text.slice(0, offset).split('\n').length;
}

let bad = 0, checked = 0;

function checkCss(label, css, lineOffset = 0) {
    checked++;
    const { depth, min } = depthOf(css);
    if (depth === 0 && min === 0) return;
    if (min < 0) {
        // Find the first point the depth goes negative, for a usable message.
        const clean = stripComments(css);
        let d = 0, at = 0;
        for (let i = 0; i < clean.length; i++) {
            if (clean[i] === '{') d++;
            else if (clean[i] === '}') { d--; if (d < 0) { at = i; break; } }
        }
        console.error(`✗ ${label}: a closing brace with nothing open, around line ${lineOffset + lineOfOffset(clean, at)}`);
    } else {
        console.error(`✗ ${label}: ${depth} unclosed rule${depth === 1 ? '' : 's'} (brace depth ${depth} at end of block)`);
    }
    bad++;
}

for (const file of fs.readdirSync('.').filter(f => f.endsWith('.html'))) {
    const html = fs.readFileSync(file, 'utf8');
    const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
    let m, i = 0;
    while ((m = re.exec(html)) !== null) {
        i++;
        checkCss(`${file} <style> #${i}`, m[1], html.slice(0, m.index).split('\n').length - 1);
    }
}

function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) walk(path.join(dir, entry.name));
        } else if (entry.name.endsWith('.css')) {
            const p = path.join(dir, entry.name);
            checkCss(p, fs.readFileSync(p, 'utf8'));
        }
    }
}
walk('styles');

if (bad) {
    console.error(`\n${bad} stylesheet(s) with unbalanced braces. A browser discards everything it cannot parse, so this silently disables rules further down.`);
    process.exit(1);
}
console.log(`✓ braces balanced in all ${checked} stylesheet(s) and inline <style> block(s)`);
