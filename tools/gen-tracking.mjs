#!/usr/bin/env node
/* One tracking value per font size, everywhere on the site.
 *
 * The problem this solves. styles/common.css sets `body { letter-spacing:
 * var(--tracking-base) }` and then `body * { letter-spacing: inherit
 * !important }`, so every element on every page takes the page's tracking and
 * any component asking for its own is overruled. --tracking-base is 0, which
 * is right for 15px body copy and wrong for the 8-to-13px text this site is
 * mostly made of: as type gets smaller the letters need more air between
 * them, not the same amount. Meanwhile a blunt sweep matched
 * [class*="title"] and drew those in by half a pixel whatever their size, so
 * a 10px .foo-title and a 10px .foo-label — the same words at the same size —
 * were tracked differently for no reason anyone could see.
 *
 * What this does. It reads every stylesheet, finds every rule that declares a
 * font-size, and writes one block into common.css giving each of them the
 * tracking its size calls for. Two rules of thumb:
 *
 *   - A rule that already declares its own letter-spacing keeps it. The author
 *     made a decision; all that was missing was the !important needed to get
 *     past `body *`. Most of the site's uppercase labels are in this group,
 *     and this is what finally lets them have the wider tracking they were
 *     always asking for.
 *   - Everything else takes the value for its size band below.
 *
 * So "font-size X always has letter-spacing Y" holds by construction, and a
 * new component gets it for free by running this.
 *
 * Usage:  node tools/gen-tracking.mjs [--check]
 *         --check exits non-zero if the block is stale, for CI.
 */
import fs from 'node:fs';
import path from 'node:path';

const STYLES = 'styles';
const OPEN = '/* === GENERATED: size-keyed tracking — node tools/gen-tracking.mjs === */';
const CLOSE = '/* === END GENERATED TRACKING === */';

/* Only text small enough to need the help. Above this the headings and the
   display figures already have their own negative tracking, and stamping a
   value on everything else would be a third opinion nobody asked for. */
const SMALL_MAX_PX = 15.99;

/* Smaller type, more air. The steps are small on purpose: the brief was a
   tiny bit wider, not loose. Above 16px the relationship inverts and display
   type wants drawing in, which the headings already do for themselves — those
   bands are here so a 30px number in a card is not left at 0. */
const BANDS = [
    { max: 9.49, em: 0.03 },
    { max: 10.99, em: 0.025 },
    { max: 12.49, em: 0.015 },
    { max: 13.99, em: 0.01 },
    { max: SMALL_MAX_PX, em: 0.005 }
];

/* Nothing is skipped wholesale. The landing page was, on the grounds that it
   runs its own em-based scale — but that scale is for its display type, which
   is all far above the 16px ceiling here, and it left the page's small print
   at dead zero: the hero note, the comparison table headers, the quote
   attributions. Its headlines are skipped by name below instead, which is the
   part that actually has an opinion. */
const SKIP_FILES = new Set();
const SKIP_SELECTORS = [
    /^h[1-6]$/, /\.lp-h[1-9]\b/, /\.hero-title\b/, /\.hero-greeting-text\b/,
    /\.v2-dlh-countdown\b/, /\.hdb-countdown\b/,
    /^option$/i, /\boption\b/,        // native select options ignore tracking anyway
    /::?(before|after|placeholder|selection|marker|backdrop)/,
    /^:root$/, /^html$/, /^body$/, /\*/
];

/* Commas inside :is(), :not(), :nth-child() and [attr="a,b"] are not selector
   separators. Splitting on every comma turned `:is(h1, h2)` into `:is(h1` and
   `h2)` — two selectors with unbalanced parentheses, which is a stylesheet
   that will not parse. */
function splitSelectors(sel) {
    const out = [];
    let depth = 0, quote = null, buf = '';
    for (const c of sel) {
        if (quote) { buf += c; if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'") { quote = c; buf += c; continue; }
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        if (c === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
        buf += c;
    }
    if (buf.trim()) out.push(buf);
    return out;
}

function bandFor(px) {
    const b = BANDS.find(x => px <= x.max);
    return b ? b.em : null;
}

/* A component asking for MORE air than its band keeps what it asked for — the
   uppercase micro-labels are the reason, and cutting them back to the band
   would undo the thing this is for. One asking for less, or for a negative,
   takes the band: that is the inconsistency being fixed. Values in units this
   cannot compare (ch, %, a calc) are left alone entirely. */
function authoredEm(value, px) {
    const m = /^(-?[0-9.]+)(px|em|rem)?$/.exec(value.trim());
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (m[2] === 'em') return n;
    if (m[2] === 'rem') return (n * 16) / px;
    if (m[2] === 'px') return n / px;
    return n === 0 ? 0 : null;     // a bare 0
}

/* Enough of a CSS parser for this: top-level rules, and the bodies of @media
   and @supports blocks. Nothing here needs to know about nesting beyond that,
   and the alternative is a dependency. */
function* rules(css) {
    let depth = 0, start = 0, selStart = 0;
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (c === '{') {
            if (depth === 0) { selStart = start; start = i + 1; }
            depth++;
        } else if (c === '}') {
            depth--;
            if (depth === 0) {
                const sel = css.slice(selStart, css.indexOf('{', selStart)).trim();
                const body = css.slice(start, i);
                if (sel.startsWith('@')) {
                    // An at-rule: its body holds ordinary rules.
                    if (/^@(media|supports|layer)/.test(sel)) yield* rules(body);
                } else if (sel) {
                    yield { sel, body };
                }
                start = i + 1;
            }
        }
    }
}

function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function collect(css) {
    const bySpacing = new Map();   // tracking value -> [selectors]
    const seen = new Set();
    const a = css.indexOf(OPEN);
    if (a > -1) css = css.slice(0, a) + css.slice(css.indexOf(CLOSE, a) + CLOSE.length);
    css = stripComments(css);

    for (const { sel, body } of rules(css)) {
        const fsMatch = /(?:^|[;{\s])font-size:\s*([0-9.]+)(px|rem)/.exec(body);

        /* A rule that sets tracking but no size of its own cannot be banded —
           there is nothing to band it against. When what it sets is zero or a
           negative it is almost always there to cancel something rather than
           to express a design, and now that `body *` is gone it wins and drops
           that text to dead zero: "order decides who comes on first" under the
           dugout was exactly this. Handed back to its parent, which does know
           its size. A positive value is a real decision and is left alone. */
        if (!fsMatch) {
            const own = /(?:^|[;{\s])letter-spacing:\s*([^;}]+)/.exec(body);
            if (!own) continue;
            const raw = own[1].trim().replace(/\s*!important\s*$/, '');
            if (!/^(0|0px|0em|0rem|-[0-9.]+(px|em|rem))$/.test(raw)) continue;
            for (let one of splitSelectors(sel)) {
                one = one.trim().replace(/\s+/g, ' ');
                if (!one || SKIP_SELECTORS.some(rx => rx.test(one))) continue;
                const key = one + '|inherit';
                if (seen.has(key)) continue;
                seen.add(key);
                if (!bySpacing.has('inherit')) bySpacing.set('inherit', []);
                bySpacing.get('inherit').push(one);
            }
            continue;
        }
        const px = fsMatch[2] === 'rem' ? parseFloat(fsMatch[1]) * 16 : parseFloat(fsMatch[1]);
        const band = bandFor(px);
        if (band == null) continue;                 // big enough to fend for itself

        let em = band;
        const lsMatch = /(?:^|[;{\s])letter-spacing:\s*([^;}]+)/.exec(body);
        if (lsMatch) {
            const raw = lsMatch[1].trim().replace(/\s*!important\s*$/, '');
            if (/^(inherit|initial|unset|revert|normal)$/.test(raw)) continue;
            const own = authoredEm(raw, px);
            if (own == null) continue;              // a unit we cannot reason about
            if (own > band) em = own;
        }
        const track = `${+em.toFixed(4)}em`;

        for (let one of splitSelectors(sel)) {
            one = one.trim().replace(/\s+/g, ' ');
            if (!one) continue;
            if (SKIP_SELECTORS.some(rx => rx.test(one))) continue;
            const key = one + '|' + track;
            if (seen.has(key)) continue;
            seen.add(key);
            if (!bySpacing.has(track)) bySpacing.set(track, []);
            bySpacing.get(track).push(one);
        }
    }
    return bySpacing;
}

function render(bySpacing) {
    const order = [...bySpacing.keys()].sort((a, b) => {
        if (a === 'inherit') return -1;
        if (b === 'inherit') return 1;
        return parseFloat(a) - parseFloat(b);
    });
    const out = [OPEN,
        '/* Written by tools/gen-tracking.mjs \u2014 do not edit by hand. Every rule in',
        '   this file that sets a font-size under 16px gets the tracking that size',
        '   calls for; one that asked for more air than its band keeps its own. */'];
    for (const track of order) {
        const sels = bySpacing.get(track).sort();
        /* !important, because this block is the file's last word on tracking
           and several pages carry their own !important scales aimed at
           display type that reach down into their small print — the landing
           page draws 13px body copy in by 0.008em. Without it the generated
           value loses to exactly the rules it exists to correct. */
        out.push(sels.join(',\n') + ' {\n    letter-spacing: ' + track + ' !important;\n}');
    }
    out.push(CLOSE);
    return out.join('\n');
}

/* Splice the generated block into a body of CSS, replacing any previous one. */
function splice(text, block) {
    const a = text.indexOf(OPEN);
    if (a > -1) {
        const end = text.indexOf(CLOSE, a) + CLOSE.length;
        return block
            ? text.slice(0, a) + block + text.slice(end)
            : (text.slice(0, a).trimEnd() + '\n' + text.slice(end)).trimEnd() + '\n';
    }
    return block ? text.trimEnd() + '\n\n' + block + '\n' : text;
}

const check = process.argv.includes('--check');
let stale = 0, selectors = 0, touched = 0;

function handle(file, current, write) {
    const bySpacing = collect(current);
    selectors += [...bySpacing.values()].reduce((s, v) => s + v.length, 0);
    const next = splice(current, bySpacing.size ? render(bySpacing) : '');
    if (next === current) return;
    touched++;
    if (check) { console.error(`\u2717 ${file} has a stale tracking block`); stale++; }
    else write(next);
}

for (const file of fs.readdirSync(STYLES).filter(f => f.endsWith('.css') && !f.endsWith('.min.css') && !SKIP_FILES.has(f)).sort()) {
    const target = path.join(STYLES, file);
    handle(target, fs.readFileSync(target, 'utf8'), t => fs.writeFileSync(target, t));
}

/* Pages carry their own <style> blocks — 269 font-size declarations live in
   them, a hundred of those on the league page alone — and a promise that only
   holds for the stylesheets is not the promise. Everything in a page's blocks
   is gathered together and the result written into the last of them, so it is
   that page's final word on tracking the way the block at the foot of a
   stylesheet is that file's. */
for (const file of fs.readdirSync('.').filter(f => f.endsWith('.html')).sort()) {
    const html = fs.readFileSync(file, 'utf8');
    const blocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)];
    if (!blocks.length) continue;

    const bySpacing = collect(blocks.map(m => m[1]).join('\n'));
    selectors += [...bySpacing.values()].reduce((s, v) => s + v.length, 0);
    const block = bySpacing.size ? render(bySpacing) : '';

    const last = blocks[blocks.length - 1];
    const inner = last[1];
    const nextInner = splice(inner, block);
    if (nextInner === inner) continue;
    touched++;
    if (check) { console.error(`\u2717 ${file} has a stale tracking block`); stale++; continue; }
    const at = last.index + last[0].indexOf(inner);
    fs.writeFileSync(file, html.slice(0, at) + nextInner + html.slice(at + inner.length));
}

if (check) {
    if (stale) { console.error('run: node tools/gen-tracking.mjs'); process.exit(1); }
    console.log('\u2713 generated tracking is up to date');
} else {
    console.log(`\u2713 tracking written for ${selectors} selectors across ${touched} file(s)`);
}
