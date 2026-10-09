/* What a gameweek's transfers actually returned.

   A transfer log is a list of EDITS, not a list of transfers, and the difference
   is the whole of this function. FPL writes a row every time a manager swaps one
   player for another in the planner, including the ones they undo a minute later
   — so a wildcard week produces dozens of rows describing a handful of real
   moves.

   The expensive mistake is not the undone pair, which is obvious. It is the
   player sold and then bought BACK through a different slot: a pairwise replay
   reports him as an arrival and as a departure, so his points are credited once
   and charged once against a manager who still owns him. The user's real GW4
   wildcard is exactly this — thirty rows, which a sequential chain collapse
   turned into ten moves with Groß arriving for +15 and leaving for −14 in the
   same list. The truth is eight moves, and the ten players who went out and came
   back belong in neither column.

   Hence the net flow count, and hence most of these tests. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const SRC = 'scripts/gameweek-review.js';

/* Players are built so that a player's id IS his points, which keeps the
   expected arithmetic readable: id 7 scored 7. Position matters because moves
   are paired within position. */
function harness(ids, pointsOverride = {}) {
    const allPlayersById = {};
    Object.entries(ids).forEach(([id, spec]) => {
        allPlayersById[id] = { id: Number(id), name: spec.name, position: spec.position, teamId: 1 };
    });
    return {
        allPlayersById,
        gwPlayerStats: (p, gw) => {
            const pts = pointsOverride[p.id] !== undefined ? pointsOverride[p.id] : p.id;
            return pts == null ? null : { points: pts, round: gw };
        }
    };
}

const load = (stubs) => loadFunction(SRC, 'gwTransferROI', stubs);
const row = (outId, inId, event = 5, time = '2026-09-19T10:00:00Z') =>
    ({ event, element_out: outId, element_in: inId, time });
const mid = (name) => ({ name, position: 3 });
const def = (name) => ({ name, position: 2 });

test('one transfer is one line, and the delta is the two players', () => {
    const fn = load(harness({ 4: mid('Sold'), 9: mid('Bought') }));
    const r = fn(5, [row(4, 9)], 0, []);
    assert.equal(r.moves.length, 1);
    assert.equal(r.moves[0].in.name, 'Bought');
    assert.equal(r.moves[0].out.name, 'Sold');
    assert.equal(r.moves[0].delta, 5, '9 scored against 4 scored');
    assert.equal(r.gross, 5);
    assert.equal(r.net, 5, 'no hit');
});

test('the hit comes off the total and not off any single move', () => {
    /* Charging four points to whichever transfer happened to return least would
       be a judgement dressed up as arithmetic. */
    const fn = load(harness({ 4: mid('A'), 9: mid('B'), 2: def('C'), 8: def('D') }));
    const r = fn(5, [row(4, 9), row(2, 8)], 4, []);
    assert.equal(r.gross, 11, '(9-4) + (8-2)');
    assert.equal(r.hit, 4);
    assert.equal(r.net, 7);
    assert.ok(r.moves.every(m => m.delta === 5 || m.delta === 6), 'no move absorbed the hit');
});

/* ---- the edits that are not transfers ---- */

test('a player bought and sold again before the deadline is not a transfer', () => {
    const fn = load(harness({ 4: mid('Kept'), 9: mid('Flirtation') }));
    assert.equal(fn(5, [row(4, 9), row(9, 4)], 0, []), null, 'the week changed nothing');
});

test('a player sold and bought back through another slot appears in neither column', () => {
    /* THE REAL GW4 CASE, reduced. Groß is sold for Gakpo; later Gomez is sold and
       Groß bought back. Net: Gomez out, Gakpo in. Replaying the rows pairwise
       instead reports Groß both ways and charges a manager who still owns him. */
    const gross14 = { 14: mid('Gross'), 20: mid('Gakpo'), 3: mid('Gomez') };
    const fn = load(harness(gross14));
    const r = fn(5, [row(14, 20), row(3, 14)], 0, []);
    assert.equal(r.moves.length, 1, 'one net move, not two');
    assert.equal(r.moves[0].out.name, 'Gomez');
    assert.equal(r.moves[0].in.name, 'Gakpo');
    assert.equal(r.gross, 17, '20 scored against 3 scored');
    const named = r.moves.flatMap(m => [m.in.name, m.out.name]);
    assert.ok(!named.includes('Gross'), 'a player he still owns is not a transfer');
});

test('nobody appears as both an arrival and a departure, however long the chain', () => {
    /* A→B, B→C, C→A is three edits and no transfer at all. */
    const fn = load(harness({ 1: mid('A'), 2: mid('B'), 3: mid('C') }));
    assert.equal(fn(5, [row(1, 2), row(2, 3), row(3, 1)], 0, []), null);
});

test('a chain through one slot collapses to its two ends', () => {
    const fn = load(harness({ 1: mid('Start'), 2: mid('Middle'), 9: mid('End') }));
    const r = fn(5, [row(1, 2), row(2, 9)], 0, []);
    assert.equal(r.moves.length, 1);
    assert.equal(r.moves[0].out.name, 'Start');
    assert.equal(r.moves[0].in.name, 'End');
    assert.equal(r.gross, 8);
});

/* ---- pairing ---- */

test('moves are paired within position, because that is the only readable pairing', () => {
    /* A squad always holds the same shape, so the two net sets have the same
       position counts and a departing defender always has an arriving one to
       pair with. Pairing across positions would print a swap nobody made. */
    const fn = load(harness({ 1: def('OutDef'), 5: mid('OutMid'), 6: def('InDef'), 9: mid('InMid') }));
    const r = fn(5, [row(5, 9), row(1, 6)], 0, []);
    r.moves.forEach(m => assert.equal(m.in.position, m.out.position,
        `${m.in.name} paired with ${m.out.name}`));
});

test('the headline total does not depend on which arrival paired with which', () => {
    const ids = { 1: def('O1'), 2: def('O2'), 7: def('I1'), 8: def('I2') };
    const a = load(harness(ids))(5, [row(1, 7), row(2, 8)], 0, []);
    const b = load(harness(ids))(5, [row(2, 8), row(1, 7)], 0, []);
    assert.equal(a.gross, b.gross);
    assert.equal(a.gross, 12, '(7+8) - (1+2)');
});

/* ---- what it reports beyond the arithmetic ---- */

test('a haul that sat on your bench is marked as not having counted', () => {
    /* Knowable, and it changes the reading: the move was good and it did not win
       the week. */
    const fn = load(harness({ 1: mid('Out'), 12: mid('In') }));
    const entries = [{ player: { id: 12, name: 'In' }, multiplier: 0 }];
    const r = fn(5, [row(1, 12)], 0, entries);
    assert.equal(r.moves[0].counted, false);
    assert.equal(r.moves[0].delta, 11, 'what he scored is still what he scored');
});

test('a player not in the reviewed squad at all is neither counted nor uncounted', () => {
    const fn = load(harness({ 1: mid('Out'), 12: mid('In') }));
    const r = fn(5, [row(1, 12)], 0, []);
    assert.equal(r.moves[0].counted, null, 'null, not false — we do not know');
});

test('a player with no gameweek row scores nothing rather than breaking', () => {
    const fn = load(harness({ 1: mid('Out'), 12: mid('In') }, { 12: null }));
    const r = fn(5, [row(1, 12)], 0, []);
    assert.equal(r.moves[0].inPts, 0);
    assert.equal(r.moves[0].delta, -1);
});

/* ---- refusals ---- */

test('it refuses when the log is absent, empty, or about another gameweek', () => {
    const h = harness({ 1: mid('A'), 9: mid('B') });
    assert.equal(load(h)(5, null, 0, []), null, 'the fetch is optional and can fail');
    assert.equal(load(h)(5, [], 0, []), null);
    assert.equal(load(h)(5, [row(1, 9, 4)], 0, []), null, 'GW4 moves are not GW5 moves');
});

test('a move involving a player who has left the game is left out, and counted', () => {
    /* FPL drops elements mid-season. Scoring him as zero would read as a blank
       rather than as an absence, so the pair is skipped — and `unscored` says so,
       because lines that silently fail to add up to the headline are worse than
       a short list. */
    const fn = load(harness({ 1: def('Out'), 7: def('In'), 5: mid('GoneMid') }));
    const r = fn(5, [row(1, 7), row(5, 999)], 0, []);
    assert.equal(r.moves.length, 1);
    assert.equal(r.moves[0].in.name, 'In');
    assert.equal(r.unscored, 1);
    assert.equal(r.gross, 6, 'the total covers only what it could score');
});
