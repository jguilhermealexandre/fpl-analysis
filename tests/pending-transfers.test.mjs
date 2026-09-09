/* The squad a manager is actually holding, between a round ending and the next
   deadline. FPL's picks endpoint cannot answer for that window, so the moves are
   replayed from the public transfer log — and every one of these tests is a way
   that replay can hand back a squad the manager does not own. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const sellingPriceTenths = loadFunction('scripts/common.js', 'sellingPriceTenths');
const applyPendingTransfers = loadFunction('scripts/common.js', 'applyPendingTransfers', { sellingPriceTenths });

/* A fifteen-slot squad in FPL's own shape. Slot order is the pick position:
   1-11 start, 12-15 are the bench, and 12 is always the reserve keeper. */
function squad(overrides = {}) {
    const picks = [];
    for (let i = 1; i <= 15; i++) {
        picks.push({
            element: 100 + i,
            position: i,
            multiplier: i <= 11 ? 1 : 0,
            is_captain: i === 5,
            is_vice_captain: i === 6,
            selling_price: 50,
            purchase_price: 50
        });
    }
    return { active_chip: null, picks, entry_history: { bank: 15, value: 1000, points: 61 }, ...overrides };
}

const move = (out, ins, extra = {}) => ({
    element_out: out, element_in: ins,
    element_out_cost: 50, element_in_cost: 50,
    event: 4, time: '2026-09-08T10:00:00Z', ...extra
});

test('a transfer puts the incoming player in the outgoing one\'s slot', () => {
    const r = applyPendingTransfers(squad(), [move(103, 500)], 4);
    const slot = r.picksData.picks.find(p => p.position === 3);
    assert.equal(slot.element, 500);
    assert.equal(r.picksData.picks.some(p => p.element === 103), false);
    assert.deepEqual(r.moves.map(m => [m.out, m.in]), [[103, 500]]);
});

test('the bank moves by what FPL credited and charged, not by list price', () => {
    // The feed states both halves. Deriving either from now_cost would be wrong
    // for any player bought before his price last changed.
    const r = applyPendingTransfers(squad(), [
        move(103, 500, { element_out_cost: 62, element_in_cost: 71 })
    ], 4);
    assert.equal(r.picksData.entry_history.bank, 15 + 62 - 71);
    // Team value is squad plus bank, and a transfer moves one into the other.
    assert.equal(r.picksData.entry_history.value, 1000);
});

test('transfers for another gameweek are not applied', () => {
    // The log is every transfer the manager has ever made. Replaying a past
    // round's moves onto the current squad would undo a season of them.
    assert.equal(applyPendingTransfers(squad(), [move(103, 500, { event: 3 })], 4), null);
});

test('a player bought and sold again before the deadline is one net move', () => {
    const r = applyPendingTransfers(squad(), [
        move(103, 500, { time: '2026-09-08T10:00:00Z' }),
        move(500, 600, { time: '2026-09-08T18:00:00Z' })
    ], 4);
    assert.equal(r.picksData.picks.find(p => p.position === 3).element, 600);
    assert.deepEqual(r.moves.map(m => [m.out, m.in]), [[103, 600]], 'the intermediate player is not reported');
});

test('the chain is replayed in time order, not feed order', () => {
    // FPL returns newest first. Applied that way, the second move looks for a
    // player the first has not put in the squad yet and is dropped.
    const r = applyPendingTransfers(squad(), [
        move(500, 600, { time: '2026-09-08T18:00:00Z' }),
        move(103, 500, { time: '2026-09-08T10:00:00Z' })
    ], 4);
    assert.equal(r.picksData.picks.find(p => p.position === 3).element, 600);
});

test('a move back to the player already owned reports nothing', () => {
    assert.equal(applyPendingTransfers(squad(), [
        move(103, 500, { time: '2026-09-08T10:00:00Z' }),
        move(500, 103, { time: '2026-09-08T18:00:00Z' })
    ], 4), null);
});

test('selling the captain moves the armband to the vice, as FPL does', () => {
    const r = applyPendingTransfers(squad(), [move(105, 500)], 4);
    const bought = r.picksData.picks.find(p => p.element === 500);
    const vice = r.picksData.picks.find(p => p.position === 6);
    assert.equal(bought.is_captain, false, 'the armband does not pass to whoever arrives in the slot');
    assert.equal(bought.multiplier, 1);
    assert.equal(vice.is_captain, true);
    assert.equal(vice.multiplier, 2);
    assert.deepEqual({ ...r.armband }, { from: 105, to: 106 });
    assert.equal(r.picksData.picks.filter(p => p.is_captain).length, 1);
    assert.equal(r.picksData.picks.filter(p => p.is_vice_captain).length, 1, 'promoting the vice leaves the squad needing a new one');
});

test('selling captain and vice together still leaves exactly one of each', () => {
    const r = applyPendingTransfers(squad(), [move(105, 500), move(106, 600)], 4);
    const caps = r.picksData.picks.filter(p => p.is_captain);
    const vices = r.picksData.picks.filter(p => p.is_vice_captain);
    assert.equal(caps.length, 1);
    assert.equal(vices.length, 1);
    assert.equal(caps[0].position <= 11, true, 'the armband stays in the starting eleven');
    assert.notEqual(caps[0].element, vices[0].element);
});

test('an armband untouched by the transfers is left alone', () => {
    const r = applyPendingTransfers(squad(), [move(103, 500)], 4);
    assert.equal(r.armband, null);
    assert.equal(r.picksData.picks.find(p => p.is_captain).element, 105);
    assert.equal(r.picksData.picks.find(p => p.is_vice_captain).element, 106);
});

test('a move out of a player this squad never held is skipped, not guessed at', () => {
    // Picks and transfer log disagreeing about the starting point means one of
    // them is stale. Applying it anyway would invent a sixteenth player.
    const r = applyPendingTransfers(squad(), [move(999, 500), move(103, 600)], 4);
    assert.equal(r.picksData.picks.length, 15);
    assert.equal(r.picksData.picks.some(p => p.element === 500), false);
    assert.deepEqual(r.moves.map(m => m.in), [600]);
});

test('the incoming player carries a selling price, so the budget is not overstated', () => {
    // Bought at 71 and now worth 75: FPL banks half the rise, rounded down.
    const r = applyPendingTransfers(squad(), [move(103, 500, { element_in_cost: 71 })], 4,
        id => (id === 500 ? 75 : null));
    const slot = r.picksData.picks.find(p => p.element === 500);
    assert.equal(slot.purchase_price, 71);
    assert.equal(slot.selling_price, 73);
});

test('without current prices the purchase price stands in, which is what FPL uses', () => {
    const r = applyPendingTransfers(squad(), [move(103, 500, { element_in_cost: 71 })], 4);
    assert.equal(r.picksData.picks.find(p => p.element === 500).selling_price, 71);
});

test('a price fall is taken in full', () => {
    assert.equal(sellingPriceTenths(71, 68), 68);
    assert.equal(sellingPriceTenths(71, 71), 71);
    assert.equal(sellingPriceTenths(71, 72), 71, 'a single tenth of a rise is not yet half a tenth back');
    assert.equal(sellingPriceTenths(71, 73), 72);
});

test('the response handed in is not mutated', () => {
    // It is kept whole as reviewPicksData: the Gameweek Review scores the round
    // just played with it, and a mutated copy would credit the wrong players.
    const original = squad();
    const before = JSON.stringify(original);
    applyPendingTransfers(original, [move(105, 500)], 4);
    assert.equal(JSON.stringify(original), before);
});

test('nothing to apply returns null rather than a copy', () => {
    assert.equal(applyPendingTransfers(squad(), [], 4), null);
    assert.equal(applyPendingTransfers(squad(), null, 4), null);
    assert.equal(applyPendingTransfers(null, [move(103, 500)], 4), null);
    assert.equal(applyPendingTransfers({ picks: [] }, [move(103, 500)], 4), null);
});

test('a wildcard-sized rebuild replays whole', () => {
    const moves = [];
    for (let i = 1; i <= 15; i++) moves.push(move(100 + i, 700 + i, { time: `2026-09-08T10:${String(i).padStart(2, '0')}:00Z` }));
    const r = applyPendingTransfers(squad(), moves, 4);
    assert.equal(r.moves.length, 15);
    assert.deepEqual(r.picksData.picks.map(p => p.element), moves.map(m => m.element_in));
    assert.equal(r.picksData.picks.filter(p => p.is_captain).length, 1);
});
