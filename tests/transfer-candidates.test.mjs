/* What orders the replacement list.

   findTransferCandidates feeds three surfaces: the Replace side panel, the
   Transfer Wizard's per-slot market, and the single auto-suggestion in
   pitch-snapshot, which takes [0] and nothing else. All three then label what
   they show with the xP engine. For years the list was ordered by
   calculateTransferScore, a number in units of its own, so the order and the
   figure printed beside it came out of two different models — and the one
   surface that only ever looks at the top row was picking that row by the
   model it does not display.

   Nothing about that is visible in a screenshot: the list still looks sorted,
   because it is, just not by the thing next to it. These pin the ordering to
   the projection, and pin the fallback so an unready engine degrades to the old
   behaviour rather than to an arbitrary one. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

/* Transfer score runs in the exact opposite order to projected points, so a
   list sorted the old way and one sorted the new way cannot be mistaken for
   each other — and a tie-break can be told apart from both. */
const POOL = [
    { id: 1, name: 'projects best, scores worst', position: 3, price: 8.0, status: 'a', minutes: 900, teamId: 11 },
    { id: 2, name: 'middling at both',            position: 3, price: 7.0, status: 'a', minutes: 900, teamId: 12 },
    { id: 3, name: 'projects worst, scores best', position: 3, price: 6.0, status: 'd', minutes: 900, teamId: 13 }
];
const XP    = { 1: 30, 2: 20, 3: 10 };
const SCORE = { 1: 10, 2: 20, 3: 30 };

function findWith({ ready = true, gws = [5, 6, 7, 8, 9], xp = XP } = {}) {
    return loadFunction('scripts/transfer-wizard.js', 'findTransferCandidates', {
        allPlayers: POOL,
        minMinutesForCandidate: () => 0,
        calculateTransferScore: p => SCORE[p.id],
        twRunGWs: () => gws,
        xpEngineReady: () => ready,
        twXPOver: p => xp[p.id],
        getPlayerRecentStats: () => null
    });
}

const ids = result => [...result].map(p => p.id);

test('the list is ordered by projected points, not by transfer score', () => {
    const out = findWith()(3, 99, new Set());
    assert.deepEqual(ids(out), [1, 2, 3],
        'the best projection must lead even though it has the worst transfer score');
});

test('every candidate carries the projection the order was built from', () => {
    const out = findWith()(3, 99, new Set());
    // The Replace panel branches on `_xpRun != null` to decide which horizon it
    // is describing, so the absence of this field is a user-visible mislabel.
    assert.deepEqual([...out].map(p => p._xpRun), [30, 20, 10]);
});

test('the transfer score survives, because the package strategies still blend it', () => {
    const out = findWith()(3, 99, new Set());
    assert.deepEqual([...out].map(p => p._transferScore), [10, 20, 30],
        'overwriting this would silently change the value, premium and differential builds');
});

test('candidates that project identically fall back to the transfer score', () => {
    const flat = { 1: 20, 2: 20, 3: 20 };
    const out = findWith({ xp: flat })(3, 99, new Set());
    assert.deepEqual(ids(out), [3, 2, 1], 'the tie-break is the score, highest first');
});

test('an engine that cannot project leaves the old ordering alone', () => {
    const out = findWith({ ready: false })(3, 99, new Set());
    assert.deepEqual(ids(out), [3, 2, 1],
        'better the score it always used than everyone sorted by an identical zero');
    assert.deepEqual([...out].map(p => p._xpRun), [null, null, null]);
});

test('a season with no gameweeks left to project also falls back', () => {
    const out = findWith({ gws: [] })(3, 99, new Set());
    assert.deepEqual(ids(out), [3, 2, 1]);
});

test('the existing filters are untouched by the new ordering', () => {
    const out = findWith()(3, 7.5, new Set([2]));
    assert.deepEqual(ids(out), [3], 'price ceiling and the exclude set both still apply');
});
