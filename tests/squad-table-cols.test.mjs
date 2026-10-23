/* The squad table: ownership in, the armband buttons out, the trial picker out.
 *
 * Reported together, and they pull in the same direction — the table is for
 * reading your squad, so it gains the stat that changes how you read a player
 * and loses two controls that belong where the eleven is visible.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFunction } from './helpers/load.mjs';
import { stripComments } from '../tools/scan-globals.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SRC = 'scripts/squad-table-chart.js';

/* computePlayerStatColumns reaches for the file's banding tables and a couple
   of page globals; none of them decide anything the Own column asserts, so
   they are stubbed to the shapes the real ones have. */
function cols(player) {
    return loadFunction(SRC, 'computePlayerStatColumns', {
        computePlayerGamesPlayed: () => 7,
        teams: { 5: { name: 'Brighton' } },
        isPreseason: false,
        predictedGWPoints: () => 4.2,
        bandHigh: () => 'Good',
        bandLow: () => 'Average',
        XGI_BANDS: [], XG_BANDS: [], XA_BANDS: [], XGC_BANDS: [],
        CS_BANDS: [], MINS_BANDS: [], FORM_BANDS: [], FDR_BANDS: []
    })(player);
}

const PLAYER = {
    id: 1, name: 'Groß', team: 'BHA', teamId: 5, position: 'MID', price: 6.2,
    form: 5.5, ppg: 8.3, ownership: 45.6, minutes: 610, avgFDR: 3.4,
    cleanSheets: 2, expectedGoalInvolvements: 3.32
};

test('Own is a column, and it is the global ownership figure', () => {
    const c = cols(PLAYER);
    assert.ok(c.own, 'there must be an own column');
    assert.equal(c.own.label, 'Own');
    assert.equal(c.own.value, '45.6%');
    assert.match(c.own.tip, /45\.6% of FPL managers/);
});

test('a player with no ownership reads 0.0%, not NaN or blank', () => {
    assert.equal(cols({ ...PLAYER, ownership: undefined }).own.value, '0.0%');
    assert.equal(cols({ ...PLAYER, ownership: null }).own.value, '0.0%');
    assert.equal(cols({ ...PLAYER, ownership: 0 }).own.value, '0.0%');
});

test('it sits immediately after Form in the row', () => {
    /* The order is a literal array in the row template, so that is what gets
       asserted — the column object existing proves nothing about where it
       renders. */
    const src = stripComments(read(SRC));
    assert.match(src, /\[cols\.xp, cols\.form, cols\.own, cols\.fdr,/,
        'xP, Form, Own, FDR, then the position stats');
});

test('the armband buttons are gone, and so is what they called', () => {
    const src = stripComments(read(SRC));
    for (const gone of ['sq-act-c', 'sq-act-v', 'sqSetArmband']) {
        assert.equal(src.includes(gone), false, `${gone} should be deleted`);
    }
});

test('but the row still shows WHO has the armband', () => {
    /* Removing the control is not removing the information. The crown and the
       V ride in the player's name, which is where they were already. */
    const src = read(SRC);
    assert.match(src, /player\.isCaptain \? `\$\{v2Icon\('crown'\)\} ` : ''/);
    assert.match(src, /player\.isVice \? 'V ' : ''/);
});

test('the other row actions survive', () => {
    const src = read(SRC);
    assert.match(src, /openTransferPanel\(\$\{player\.id\}\)/, 'find a replacement');
    assert.match(src, /toggleSquadRowDetail\(\$\{player\.id\}\)/, 'open the full profile');
});

test('the "player you do not own" search is out of the panel header', () => {
    const src = stripComments(read(SRC));
    assert.equal(src.includes('tlRenderPicker'), false, 'the picker is not called any more');
    assert.equal(src.includes('sq-panel-search'), false, 'and its wrapper is gone');
    // The controls it sat between are untouched.
    assert.match(src, /sq-filter-pills/, 'the position pills stay');
    assert.match(src, /toggleSquadChart\(\)/, 'and the Visual analysis button');
});

test('the trial machinery goes quiet rather than breaking', () => {
    /* Nothing can start a trial now. Both hooks the table and the page still
       hold must therefore return nothing, and the row source must fall through
       to the real squad — otherwise removing the box empties the table. */
    const tl = 'scripts/squad-trial.js';
    const renderInto = loadFunction(tl, 'tlRenderInto', { tlTrial: null, selectedPlayers: [] });
    assert.equal(renderInto(), '', 'the banner renders nothing with no trial');

    const badge = loadFunction(tl, 'tlBadge', {});
    assert.equal(badge({ id: 1, isTrialist: false }), '', 'and no row is badged');
    assert.equal(badge(null), '');

    const src = read(SRC);
    assert.match(src, /tlDisplayResults\(\)\) \|\| analysisResults/,
        'the table falls back to the squad it actually owns');
});
