/* The Lineup Wizard's Overview: three figures and one block.
 *
 * It carried three more blocks and they were removed deliberately — an armband
 * read-out, a closest-bench-call read-out, and a list of what the optimiser had
 * changed against the live FPL team. Each was true; none was load-bearing. The
 * armband read duplicated the captaincy grid immediately below it, which names
 * the same players with the same figures AND has the buttons; the bench call
 * answered a question the pitch answers by being looked at; and the change list
 * re-stated the "vs live FPL team" figure as prose. Risks & flags — the one
 * thing on the screen you have to act on — sat underneath all three, and now
 * sits beside the figures in the space they occupied.
 *
 * Two things here are worth a test rather than a comment.
 *
 * THE TRAP. Deleting "Optimiser changes" invites deleting lwChangeList() with
 * it, and two survivors read it: the section's own subtitle and the "vs live
 * FPL team" figure. Both would silently lose their change count.
 *
 * THE PLACEMENT. "Beside the figures" is a grid column, so it is only true if
 * the block is emitted INSIDE .lw-ov-head. Emitted after it, everything still
 * renders and the block simply sits underneath — which is what it did before,
 * and the change would look like it had not happened.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFunction } from './helpers/load.mjs';
import { stripComments } from '../tools/scan-globals.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SRC = 'scripts/lineup-wizard.js';
const CSS = 'styles/my-team.css';

const RISKS = '<!--RISKS-AND-FLAGS-->';

function overview({ risks = 2, changes = 3, live = 48.2 } = {}) {
    const squad = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, web_name: `P${i + 1}`, pos: 3 }));
    const fn = loadFunction(SRC, 'lwRenderOverviewRow', {
        planningGW: 8,
        lineupState: {
            xi: squad.slice(0, 11),
            bench: squad.slice(11),
            squad,
            formation: '3-4-3',
            missingPicks: []
        },
        lwTotalXP: () => 52.7,
        lwLiveXP: () => live,
        lwRiskList: () => Array.from({ length: risks }, (_, i) => ({
            p: { id: i + 1, web_name: `Flagged${i + 1}` }, why: 'doubtful', inXI: i === 0
        })),
        lwChangeList: () => ({ total: changes }),
        lwKpiBox: (tone, icon, label, value, sub) =>
            `<div class="sq-kpi" data-label="${label}" data-value="${value}" data-sub="${sub}"></div>`,
        lwRenderRisks: () => RISKS,
        v2Icon: () => '',
        escHTML: s => String(s)
    });
    return fn();
}

// ---- what is there

test('the three figures are still the three figures', () => {
    const html = overview();
    for (const label of ['Projected points', 'vs live FPL team', 'Flagged']) {
        assert.ok(html.includes(`data-label="${label}"`), `${label} should still be a figure`);
    }
    assert.match(html, /data-label="Projected points" data-value="52\.7"/);
});

test('Risks & flags is emitted inside the head row, after the figures', () => {
    /* Inside, because the row is a two-column grid and that is what "beside
       the figures" means. After, because the figures are the left column. */
    const html = overview();
    const head = html.indexOf('<div class="lw-ov-head">');
    const kpis = html.indexOf('class="lw-kpis is-three"');
    const risks = html.indexOf(RISKS);
    assert.ok(head >= 0 && kpis > head, 'the figures open the head row');
    assert.ok(risks > kpis, 'the flags follow them, so they take the right-hand column');

    // And it is still within the head, not after it: the head's closing </div>
    // is the last one before the section closes.
    const tail = html.slice(risks);
    assert.match(tail, /^\s*<!--RISKS-AND-FLAGS-->\s*<\/div>\s*<\/section>`?\s*$/,
        'the only thing between the block and the end of the section is the head closing');
});

// ---- what is gone

test('the three removed blocks are gone from the markup', () => {
    const html = overview();
    for (const heading of ['The armband call', 'Closest bench call', 'Optimiser changes']) {
        assert.equal(html.includes(heading), false, `${heading} should no longer render`);
    }
    assert.equal(html.includes('lw-ov-blocks'), false, 'the second row of blocks is gone with them');
});

test('and their functions are gone from the file, not merely unused', () => {
    /* Dead renderers are worse than removed ones: check:globals still lists
       their names, the minifier still ships them, and the next person reads
       them as live. */
    const src = read(SRC);
    for (const fn of ['lwArmbandRead', 'lwRenderClosestCall', 'lwRenderChanges', 'lwClosestCall', 'lwCallSide']) {
        assert.equal(src.includes(`function ${fn}`), false, `${fn} should be deleted`);
        assert.equal(new RegExp(`\\b${fn}\\s*\\(`).test(stripComments(src)), false,
            `${fn} should have no callers left either`);
    }
});

// ---- what must survive

test('lwChangeList survives, because two things that stayed read it', () => {
    /* The trap. "Optimiser changes" was the obvious caller; the subtitle and
       the vs-live figure are the quiet ones. */
    /* Anchored on the parenthesis. /function lwChangeList/ alone is a prefix
       match: it passes against `function lwChangeListRemoved`, which is exactly
       what a careless rename looks like — and the render below cannot catch it,
       because the renderer is handed a stub. */
    const src = stripComments(read(SRC));
    assert.match(src, /function lwChangeList\(\)/, 'the helper must stay, under that name');
    assert.match(src, /const changes = lwChangeList\(\);/, 'and the Overview must still call it');
    const html = overview({ changes: 3 });
    assert.match(html, /3 changes from your live FPL team/, 'the subtitle still counts them');
    assert.ok(html.includes('data-sub="3 changes"'), 'and so does the vs-live figure');
});

test('the vs-live figure still reads level and signed', () => {
    assert.match(overview({ live: 52.7 }).match(/data-value="[^"]*"/g)[1], /level/);
    assert.match(overview({ live: 48.2 }).match(/data-value="[^"]*"/g)[1], /\+4\.5/);
    assert.match(overview({ live: 55.7 }).match(/data-value="[^"]*"/g)[1], /−3\.0/);
});

test('the captaincy grid is untouched — that is where the armband is chosen', () => {
    /* The armband READ-OUT went; the picker, with its C and V buttons and its
       candidate list, is the control and is not part of this change. */
    const src = read(SRC);
    assert.match(src, /function lwCaptainCandidates/);
    assert.match(src, /function lwCaptainReason/);
    assert.match(src, /setLWCaptain\(/, 'the buttons that actually move the armband');
});

test('a clean squad gets no block — the Flagged figure already says so', () => {
    /* It used to keep the block for an empty state, which put a box wider
       than the three figures on screen to hold one grey sentence. The Flagged
       figure reads "0 · nobody to check", and the figures take the row. */
    const risks = loadFunction(SRC, 'lwRenderRisks', {
        lwRiskList: () => [], v2Icon: () => '', escHTML: s => String(s), lwFace: () => ''
    });
    assert.equal(risks(), '', 'nothing to flag renders nothing');
    assert.ok(overview({ risks: 0 }).includes('data-label="Flagged" data-value="0"'));
    assert.ok(overview({ risks: 0 }).includes('data-sub="nobody to check"'));
});

test('a squad with flags gets the block, with the count and every name', () => {
    const risks = loadFunction(SRC, 'lwRenderRisks', {
        lwRiskList: () => [
            { p: { web_name: 'Salah' }, why: 'doubtful', inXI: true },
            { p: { web_name: 'Saka' }, why: 'suspended', inXI: false }
        ],
        v2Icon: () => '', escHTML: s => String(s), lwFace: () => ''
    });
    const html = risks();
    assert.match(html, /lw-sum-block is-row is-alert/);
    assert.match(html, /<span class="lw-sum-n">2<\/span>/);
    assert.ok(html.includes('Salah') && html.includes('Saka'));
});

// ---- the stylesheet has to agree

test('the head row sizes the flags to their names, and the dead rules are gone', () => {
    const css = read(CSS);
    /* Flex, not the old 1.58fr/2fr grid: the 2fr gave a block holding one or
       two names more room than the three figures. */
    assert.match(css, /\.lw-ov-head \{ display: flex;/);
    assert.equal(/\.lw-ov-head \{[^}]*grid-template-columns/.test(css), false, 'no fixed column split');
    assert.match(css, /\.lw-ov-head > \.lw-kpis \{ flex: 1 1 0;/, 'the figures grow into what is left');
    assert.match(css, /\.lw-ov-head > \.lw-sum-block\.is-row \{[^}]*flex: 0 1 auto; max-width: 46%;/,
        'the flags are content-sized and capped');
    for (const sel of ['.lw-ov-blocks', '.lw-callbox', '.lw-call-i', '.lw-chg-p', '.lw-sum-note', '.lw-sum-sub', '.lw-sum-quiet']) {
        assert.equal(css.includes(sel), false, `${sel} is emitted by nothing now`);
    }
    // The survivors the block itself needs.
    for (const sel of ['.lw-sum-block', '.lw-sum-flag', '.lw-sum-n']) {
        assert.ok(css.includes(sel), `${sel} is still in use`);
    }
});

test('one stacking breakpoint, so the block cannot end up beside a squeezed figure', () => {
    const css = read(CSS);
    assert.match(css, /@container lwov \(max-width: 1000px\) \{\s*\.lw-ov-head \{ flex-direction: column; \}/);
    assert.equal(/@container lwov \(max-width: 1250px\)/.test(css), false,
        'the 1250px rule existed for a call card that no longer exists');
});
