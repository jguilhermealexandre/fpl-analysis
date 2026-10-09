/* What eleven is a legal eleven. One rule, three readers.
 *
 * Three places encoded FPL's shape rule independently:
 *
 *   isValidFormation()    panels-and-tabs.js  — the squad pitch, the GW Draft
 *                                               pitch and the wizard overview
 *   isValidLWFormation()  lineup-wizard.js    — the Lineup Wizard
 *   a literal array       transfer-engine.js  — inside solveQuickLineup()
 *
 * Measured over every split of ten outfield players, they disagreed on seven
 * shapes: isValidFormation checked the lower bounds and not the upper, so it
 * accepted fifteen where FPL allows eight. 6-3-1 and 3-2-5 were among them.
 *
 * No live difference, and the reason is worth keeping written down: an FPL
 * squad is 2 GK, 5 DEF, 5 MID, 3 FWD, and a transfer must be same-position, so
 * that shape is invariant. 3-2-5 needs five forwards and 6-3-1 needs six
 * defenders, so none of the seven can be built. The loose check was safe by
 * accident of something it did not check — which is the kind of safety that
 * stops being safe when a fourth caller passes a hypothetical squad.
 *
 * These tests pin the rule, the derived list, and the agreement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const FPL_XI_SHAPE = { 1: [1, 1], 2: [3, 5], 3: [2, 5], 4: [1, 3] };
const FPL_XI_SIZE = 11;
const v2LegalXI = loadFunction('scripts/common.js', 'v2LegalXI', { FPL_XI_SHAPE, FPL_XI_SIZE });

// The three readers, each with the shared rule injected.
const isValidFormation = loadFunction('scripts/panels-and-tabs.js', 'isValidFormation', { v2LegalXI });
const isValidLWFormation = loadFunction('scripts/lineup-wizard.js', 'isValidLWFormation', { v2LegalXI });

// Rebuilt here the way common.js derives it, so the expectation is independent.
const derived = [];
for (let d = 3; d <= 5; d++) {
    for (let m = 2; m <= 5; m++) {
        for (let f = 1; f <= 3; f++) {
            if (v2LegalXI({ 1: 1, 2: d, 3: m, 4: f })) derived.push(`${d}-${m}-${f}`);
        }
    }
}

const lineupOf = (d, m, f) => [
    { position: 1, onBench: false },
    ...Array.from({ length: d }, () => ({ position: 2, onBench: false })),
    ...Array.from({ length: m }, () => ({ position: 3, onBench: false })),
    ...Array.from({ length: f }, () => ({ position: 4, onBench: false })),
    // A real squad always has four on the bench; they must not be counted.
    { position: 1, onBench: true }, { position: 2, onBench: true },
    { position: 3, onBench: true }, { position: 4, onBench: true }
];
const xiOf = (d, m, f) => lineupOf(d, m, f).filter(p => !p.onBench).map(p => ({ pos: p.position }));

test('FPL allows exactly eight formations', () => {
    assert.deepEqual(derived, [
        '3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-2-3', '5-3-2', '5-4-1'
    ]);
});

test('the three readers agree on every possible split of ten', () => {
    const disagreements = [];
    for (let d = 0; d <= 10; d++) {
        for (let m = 0; m <= 10 - d; m++) {
            const f = 10 - d - m;
            const key = `${d}-${m}-${f}`;
            const a = isValidFormation(lineupOf(d, m, f));
            const b = isValidLWFormation(xiOf(d, m, f));
            const c = derived.includes(key);
            if (!(a === b && b === c)) disagreements.push(`${key} panels=${a} lineupWizard=${b} list=${c}`);
        }
    }
    assert.deepEqual(disagreements, []);
});

test('the seven shapes the loose check used to accept are now refused', () => {
    /* Named rather than counted, so a future loosening says which rule it
       broke. All seven need more bodies in one position than a squad holds. */
    for (const [d, m, f] of [[3, 2, 5], [3, 3, 4], [3, 6, 1], [4, 2, 4], [6, 2, 2], [6, 3, 1], [7, 2, 1]]) {
        assert.equal(isValidFormation(lineupOf(d, m, f)), false, `${d}-${m}-${f} is not an FPL formation`);
    }
});

test('two goalkeepers is never legal, however the outfield is arranged', () => {
    assert.equal(v2LegalXI({ 1: 2, 2: 4, 3: 3, 4: 2 }), false);
    assert.equal(v2LegalXI({ 1: 0, 2: 5, 3: 4, 4: 2 }), false, 'and nor is none');
});

test('an eleven that is not eleven is refused', () => {
    assert.equal(v2LegalXI({ 1: 1, 2: 4, 3: 4, 4: 3 }), false, 'twelve');
    assert.equal(v2LegalXI({ 1: 1, 2: 3, 3: 3, 4: 3 }), false, 'ten');
    assert.equal(isValidFormation([{ position: 1, onBench: false }]), false, 'one');
});

test('nothing at all is refused rather than thrown at', () => {
    assert.equal(v2LegalXI(null), false);
    assert.equal(v2LegalXI({}), false);
    assert.equal(isValidLWFormation(null), false);
    assert.equal(isValidLWFormation([]), false);
});

test('a position the rule does not know about cannot sneak in', () => {
    /* counts[5] is ignored by the loop, so the total check is what catches it:
       ten known plus one unknown is not eleven known. */
    assert.equal(v2LegalXI({ 1: 1, 2: 3, 3: 4, 4: 2, 5: 1 }), false);
});
