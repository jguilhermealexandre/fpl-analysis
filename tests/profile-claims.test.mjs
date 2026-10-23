/* What the player profile is allowed to assert.
 *
 * Two reports, one theme: the profile was stating things it had not earned.
 *
 * 1. "MCI form rating 100/100 — team on fire". A score out of a hundred implies
 *    a scale somebody calibrated; these were internal 0-100 indices with no
 *    legend anywhere on the page, printed beside the real figure that had
 *    produced them. The figures stayed and the scores went.
 *
 * 2. Gvardiol — benched, projecting 1.8 for the round — was given HOLD,
 *    "Performing as expected … keep starting him". HOLD is the else branch of
 *    the verdict: it fires when nothing else did. It now says that, instead of
 *    describing a player it never examined.
 *
 * Deliberately NOT asserted here: that the verdict reads the projection. It
 * does not, and that is the open defect — but a test pinning its absence would
 * forbid the fix. The reasoning, and the two calibrations that failed
 * validation, are recorded at the branch itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from '../tools/scan-globals.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = 'scripts/player-profile.js';
const raw = fs.readFileSync(path.join(ROOT, SRC), 'utf8');
const code = stripComments(raw);

test('no 0-100 score is printed or claimed anywhere on the profile', () => {
    /* The line drawn here, deliberately: the 0-100 indices still EXIST and
       still pick words — "In form", "Poor form" — because rewriting that is a
       calibration job, not a copy one. What they may no longer do is appear.
       Nothing prints one as a figure, and nothing tells the reader it is out
       of a hundred. */
    assert.equal(code.includes('/100'), false, 'no x/100 in anything that renders');
    assert.equal(code.includes('out of 100'), false, 'and no tooltip says so either');
    for (const printed of ['.attackPower.toString()', '.defensePower.toString()',
        '.formRating}', '.attackPower}', '.defensePower}', '.fixtureScore}']) {
        assert.equal(code.includes(printed), false, `${printed} puts an index on screen`);
    }
});

test('the figures that justified those scores are still printed', () => {
    /* Removing the score must not remove the evidence — that would be a
       quieter version of the same problem. */
    assert.match(code, /goals a game/, 'attack says goals per game');
    assert.match(code, /conceding \$\{ta\.avgConceded\.toFixed\(1\)\} a game/, 'defence says goals conceded');
    assert.match(code, /won \$\{ta\.wins\} of their last 5/, 'form says the W-D-L record');
    assert.match(code, /run of fixtures ahead/, 'and fixtures say kind or tough');
});

test('HOLD no longer claims to have examined him', () => {
    assert.equal(code.includes('Performing as expected'), false);
    assert.equal(code.includes('keep starting him'), false);
    assert.equal(code.includes('Keep starting. Reliable performer'), false);
});

test('HOLD says what it actually checked, and points at the projection', () => {
    const i = code.indexOf("verdict = 'hold';");
    assert.ok(i > 0);
    const branch = code.slice(i, i + 700);
    assert.match(branch, /No flags on form, minutes or fixtures/, 'the reason is the absence of flags');
    assert.match(branch, /Check his projected points before you start him/,
        'and it sends you to the number that does decide it');

    const tip = /hold:\s*\{ chip: 'HOLD',\s*tip: '([^']*)'/.exec(code);
    assert.ok(tip, 'the chip tooltip must still exist');
    assert.match(tip[1], /not the same as a recommendation to start him/);
    assert.match(tip[1], /projected points/);
});

test('the other three verdicts are untouched', () => {
    /* Only the default branch over-claimed. SELL, WATCH and TOP PICK each fire
       on a condition and may describe it. */
    for (const chip of ['TOP PICK', 'SELL', 'WATCH']) {
        assert.ok(code.includes(`chip: '${chip}'`), `${chip} should still exist`);
    }
    assert.match(code, /sellRating >= 55/, 'the sell threshold is unchanged');
    assert.match(code, /sellRating >= 38/, 'and the watch threshold');
});
