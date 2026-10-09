/* One filter, one row, across the Transfers tab.
 *
 * The tab carried three lists of players and, between them, three different
 * ideas of what a control looks like:
 *
 *   - "Hot risers / Steep fallers / Budget enablers"  a segmented grey track
 *   - "All / GK / DEF / MID / FWD | Premium / Budget" outlined pills
 *   - "This gameweek / Season"                        a segmented grey track
 *
 * and the two groups in the middle row could not combine: picking "Premium
 * £10m+" cleared the position, picking a position cleared the price back. A
 * control that undoes its neighbour is not a second filter, and the cheap end
 * of the market already had a list of its own one row above. The price pair
 * came off; the segmented tracks became the pill the rest of the row is.
 *
 * The three lists disagreed as rows too. The price watch and the wider market
 * both name their columns and sit each player on a tinted row with the
 * position down its left edge; most-bought and most-sold were bare text on the
 * panel's own ground, with a 92px bar stub under a figure nothing labelled and
 * the whole middle of the row empty.
 *
 * Markup and stylesheet assertions, because that is where all of this lives —
 * none of it is reachable through a return value.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from '../tools/scan-globals.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const wizard = stripComments(read('scripts/transfer-wizard.js'));
const css = read('styles/my-team.css');

/* One rule's declaration block, found by a selector that appears in its
   comma-separated list. */
function ruleFor(sheet, selector) {
    const re = new RegExp(`(^|[,}])\\s*${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*[,{]`, 'm');
    const m = re.exec(sheet);
    if (!m) return null;
    const open = sheet.indexOf('{', m.index + m[0].length - 1);
    const close = sheet.indexOf('}', open);
    return { start: sheet.lastIndexOf('\n', m.index) + 1, body: sheet.slice(open + 1, close) };
}

test('the wider market filters on position and nothing else', () => {
    assert.ok(/class="tm-pos-filter"/.test(wizard), 'the filter row is still there');
    assert.equal((wizard.match(/onclick="tmFilterPos\(/g) || []).length, 5,
        'All, GK, DEF, MID and FWD — five position buttons');
    assert.ok(!/tmFilterPrice|tmPriceFilter/.test(wizard),
        'no price filter left in the renderer, the state or the handler');
    assert.ok(!/Premium £10m|Budget &lt;£5m/.test(wizard),
        'and neither of its two buttons');
    assert.ok(!/tm-filter-sep/.test(wizard) && !/\.tm-filter-sep/.test(css),
        'the separator between the two groups has no second group to separate');
});

test('the note no longer offers a filter the row does not have', () => {
    assert.ok(/narrow it by position\./.test(wizard));
    assert.ok(!/by position or price/.test(wizard));
});

test('picking a position is the whole of the market filter', () => {
    const m = /const filterPlayers = \(list\) => \(([\s\S]*?)\);/.exec(wizard);
    assert.ok(m, 'filterPlayers is one expression now');
    assert.ok(/tmPosFilter/.test(m[1]));
    assert.ok(!/price/i.test(m[1]), 'and says nothing about price');
});

test('the three controls on the tab are one pill, defined once', () => {
    const rule = ruleFor(css, '\\.tm-pos-btn');
    assert.ok(rule, '.tm-pos-btn is still the definition');
    const head = css.slice(rule.start, css.indexOf('{', rule.start));
    for (const sel of ['.tm-pos-btn', '.tm-market-tab', '.tm-tb-scope-btn']) {
        assert.ok(head.includes(sel), `${sel} takes the same rule`);
    }
    assert.ok(!/border-radius: calc\(var\(--radius-md\) - 2px\)/.test(css),
        'the segmented track the tabs and the period switch used to draw is gone');
});

test('the most-transferred lists are the same row as the two lists above them', () => {
    const tint = ruleFor(css, '\\.tm-watch-row');
    assert.ok(tint, 'the shared row surface is still one rule');
    const head = css.slice(tint.start, css.indexOf('{', tint.start));
    assert.ok(head.includes('.tm-tb-row'),
        'most bought and most sold take the surface the squad and market rows take');

    assert.ok(/class="tm-tb-row \$\{cls\} \$\{posEdge\}"/.test(wizard),
        'and the position edge every other player row on the page carries');
    assert.ok(/v2PosEdgeClass\(p\.position\)/.test(wizard));
});

test('every column in those lists is named', () => {
    assert.ok(/class="tm-tb-legend"/.test(wizard), 'there is a column header');
    for (const label of ['>#<', '>Player<', '>Volume<', 'Transfers ']) {
        assert.ok(wizard.includes(label), `the header names ${label.replace(/[<>]/g, '')}`);
    }
    assert.ok(/grid-template-columns: 18px minmax\(0, 1\.4fr\) minmax\(110px, 1fr\) auto/
        .test(ruleFor(css, '\\.tm-tb-legend').body),
        'and its columns are the row’s columns');
});

test('the volume bar is a column of its own, not a stub under the figure', () => {
    assert.ok(/class="tm-tb-meter"/.test(wizard));
    const num = ruleFor(css, '\\.tm-tb-num');
    assert.ok(num && !/tm-tb-track/.test(num.body));
    /* Three rules open with ".tm-tb-row {": the shared surface it now joins,
       its own layout, and the narrow override. The grid is in the layout. */
    const blocks = [];
    for (let i = css.indexOf('.tm-tb-row {'); i > 0; i = css.indexOf('.tm-tb-row {', i + 1)) {
        blocks.push(css.slice(i, css.indexOf('}', i)));
    }
    const layout = blocks.find(b => /display: grid/.test(b));
    assert.ok(layout, 'the row still lays itself out as a grid');
    assert.match(layout, /grid-template-columns: 18px minmax\(0, 1\.4fr\) minmax\(110px, 1fr\) auto/);
});

test('the narrow layout is stated after the rule it narrows', () => {
    /* A @container query carries no specificity of its own, so placed above
       .tm-tb-row the plain rule simply wins — three times this session. */
    const base = css.indexOf('.tm-tb-row {');
    const query = css.indexOf('@container tbcol');
    assert.ok(base > 0 && query > base, 'the container query comes after the base rule');
    assert.ok(/container: tbcol \/ inline-size/.test(css),
        'and something declares the container it measures');
});
