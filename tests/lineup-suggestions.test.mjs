/* "Do this week" has to be a list you can actually do.
 *
 * Reported from a live gameweek, verbatim from the screen:
 *
 *     Start Hall over Gvardiol    Projected +2.1 pts (3.9 xP vs 1.8 xP)
 *     Start Egan over Gvardiol    Projected +2.0 pts (3.8 xP vs 1.8 xP)
 *
 * Both rows carried a "Make the swap" button, and Gvardiol can only be benched
 * once. The old loop walked the bench and handed each player the weakest
 * starter in his own position, independently of every other row — so two bench
 * defenders who both beat the worst starting defender both named him.
 *
 * The first case below is that squad, with those numbers. The rest are the
 * properties that make the list safe to act on: no player twice on either side,
 * the best single move always first, and a second row that is a REAL second
 * move rather than the first one repeated.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const SRC = 'scripts/pitch-snapshot.js';

/* analysisResults as the page builds it, reduced to what this function reads:
   a player with an id, a name, a position and whether he is on the bench. The
   projection is injected, because projectedScore() is the engine and this is a
   test about selection rather than about xP. */
function squad(rows) {
    return rows.map(([id, name, position, onBench, xp]) => ({
        player: { id, name, position, onBench }, xp
    }));
}

function suggest(rows) {
    const results = squad(rows);
    const byId = new Map(results.map(a => [a.player.id, a.xp]));
    const fn = loadFunction(SRC, 'computeLineupSuggestions', {
        analysisResults: results,
        projectedScore: (player) => byId.get(player.id)
    });
    return fn();
}

const describe = s => s.map(x => `${x.bench.player.name}>${x.starter.player.name}`);

// ---- the squad that was reported

/* Hall and Egan on the bench, both well clear of Gvardiol; Stones is the next
   weakest defender in the eleven. Figures are the ones that were on screen. */
const REPORTED = [
    [1, 'Gvardiol', 'DEF', false, 1.8],
    [2, 'Stones', 'DEF', false, 2.6],
    [3, 'Gabriel', 'DEF', false, 4.4],
    [4, 'Salah', 'MID', false, 6.1],
    [5, 'Hall', 'DEF', true, 3.9],
    [6, 'Egan', 'DEF', true, 3.8]
];

test('the same starter is never benched twice', () => {
    const out = suggest(REPORTED);
    const benched = out.map(s => s.starter.player.name);
    assert.deepEqual(benched, [...new Set(benched)],
        `each starter at most once, got ${describe(out).join(' and ')}`);
});

test('the reported pair becomes two moves you can both make', () => {
    const out = suggest(REPORTED);
    assert.deepEqual(describe(out), ['Hall>Gvardiol', 'Egan>Stones']);
    // The figures the cards print come straight off the pair.
    assert.equal(out[0].delta.toFixed(1), '2.1', 'Hall over Gvardiol, as before');
    assert.equal(out[1].benchScore.toFixed(1), '3.8');
    assert.equal(out[1].starterScore.toFixed(1), '2.6');
    assert.equal(out[1].delta.toFixed(1), '1.2', 'Egan over Stones, which is a real move');
});

test('the best single swap is still the first row', () => {
    /* The reason this is greedy rather than a maximum-weight matching: most
       people take the top row and nothing else, so it has to be the best move
       on the board. */
    const out = suggest(REPORTED);
    assert.equal(out[0].delta, Math.max(...out.map(s => s.delta)));
    assert.equal(describe(out)[0], 'Hall>Gvardiol');
});

// ---- the properties

test('a bench player is never the answer to two different starters', () => {
    /* The mirror of the reported bug, and reachable now that every pair is
       considered: one outstanding bench player against two weak starters. */
    const out = suggest([
        [1, 'Weak1', 'MID', false, 1.0],
        [2, 'Weak2', 'MID', false, 1.1],
        [3, 'Star', 'MID', true, 6.0]
    ]);
    assert.equal(out.length, 1, 'one player, one swap');
    assert.deepEqual(describe(out), ['Star>Weak1'], 'against the weaker of the two');
});

test('every suggestion in the list can be applied after the ones above it', () => {
    /* The invariant the whole fix exists for, asserted directly: replay the
       list as a user clicking down it, and nothing must already be gone. */
    const out = suggest([
        [1, 'D1', 'DEF', false, 1.0],
        [2, 'D2', 'DEF', false, 1.2],
        [3, 'D3', 'DEF', false, 1.4],
        [4, 'M1', 'MID', false, 1.1],
        [5, 'B1', 'DEF', true, 4.0],
        [6, 'B2', 'DEF', true, 3.8],
        [7, 'B3', 'DEF', true, 3.6],
        [8, 'B4', 'MID', true, 3.2]
    ]);
    const onBench = new Set([5, 6, 7, 8]);
    const inXI = new Set([1, 2, 3, 4]);
    for (const s of out) {
        assert.ok(onBench.has(s.bench.player.id), `${s.bench.player.name} is still on the bench`);
        assert.ok(inXI.has(s.starter.player.id), `${s.starter.player.name} is still in the eleven`);
        onBench.delete(s.bench.player.id);
        inXI.delete(s.starter.player.id);
        onBench.add(s.starter.player.id);
        inXI.add(s.bench.player.id);
    }
    assert.equal(out.length, 4, 'three defenders and one midfielder all improve');
});

test('a swap is only offered across the same position', () => {
    // A defender for a midfielder changes the shape, and this function does not
    // check formations — it avoids the question by construction.
    const out = suggest([
        [1, 'Keeper', 'GK', false, 2.0],
        [2, 'Mid', 'MID', false, 1.0],
        [3, 'BenchDef', 'DEF', true, 6.0]
    ]);
    assert.deepEqual(out, [], 'no same-position partner, no suggestion');
});

test('the one-point floor still holds', () => {
    assert.deepEqual(suggest([
        [1, 'Starter', 'MID', false, 3.0],
        [2, 'Bench', 'MID', true, 3.9]
    ]), [], '0.9 is inside the noise of a single match');
    assert.equal(suggest([
        [1, 'Starter', 'MID', false, 3.0],
        [2, 'Bench', 'MID', true, 4.0]
    ]).length, 1, 'and 1.0 exactly is offered');
});

test('a best XI gets an empty list, not an empty-ish one', () => {
    // renderLineupAlert() prints "Best XI already selected" off length === 0.
    assert.deepEqual(suggest([
        [1, 'Good', 'MID', false, 5.0],
        [2, 'Spare', 'MID', true, 2.0]
    ]), []);
});

test('at most five, because the list is capped downstream anyway', () => {
    const rows = [];
    for (let i = 1; i <= 7; i++) rows.push([i, `S${i}`, 'MID', false, 1.0]);
    for (let i = 8; i <= 14; i++) rows.push([i, `B${i}`, 'MID', true, 5.0]);
    assert.equal(suggest(rows).length, 5);
});

test('the order does not wander between renders of the same squad', () => {
    /* Equal deltas are common at the bottom of a squad. An unstable sort there
       would shuffle the cards on every re-render of an unchanged team. */
    const rows = [
        [1, 'A', 'DEF', false, 1.0],
        [2, 'B', 'DEF', false, 1.0],
        [3, 'C', 'DEF', true, 3.0],
        [4, 'D', 'DEF', true, 3.0]
    ];
    const first = describe(suggest(rows));
    for (let i = 0; i < 5; i++) assert.deepEqual(describe(suggest(rows)), first);
});
