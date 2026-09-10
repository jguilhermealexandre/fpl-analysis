/* The confirmed-swaps layer: transfers agreed in the wizard but not yet made
   on FPL, folded into the picks every page fetches. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

/* Pulled out on its own rather than by evaluating common.js, which boots a
   page when it loads — observers, a footer fetch, a theme pass — none of it
   this function's business. The two storage helpers it calls come with it. */
function ctxWith(record) {
    const store = new Map();
    if (record) store.set('easyfpl_confirmed_transfers', JSON.stringify(record));
    const localStorage = {
        getItem: k => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: k => store.delete(k)
    };
    const twConfirmedRead = loadFunction('scripts/common.js', 'twConfirmedRead',
        { localStorage, TW_CONFIRMED_KEY: 'easyfpl_confirmed_transfers' });
    const twConfirmedClear = loadFunction('scripts/common.js', 'twConfirmedClear',
        { localStorage, TW_CONFIRMED_KEY: 'easyfpl_confirmed_transfers' });
    const applyConfirmedSwaps = loadFunction('scripts/common.js', 'applyConfirmedSwaps',
        { twConfirmedRead, twConfirmedClear });
    return { applyConfirmedSwaps, store };
}

function squad(overrides = {}) {
    const picks = [];
    for (let i = 1; i <= 15; i++) {
        picks.push({ element: 100 + i, position: i, multiplier: i <= 11 ? 1 : 0,
            is_captain: i === 5, is_vice_captain: i === 6, selling_price: 50, purchase_price: 50 });
    }
    return { picks, entry_history: { bank: 15, value: 1000 }, ...overrides };
}

const move = (out, ins, outPrice = 50, inPrice = 50) =>
    ({ outId: out, inId: ins, outName: `p${out}`, inName: `p${ins}`, outPrice, inPrice });

test('a confirmed swap takes the outgoing player\'s slot', () => {
    const { applyConfirmedSwaps } = ctxWith({ teamId: '7', gw: 4, moves: [move(103, 500)] });
    const r = applyConfirmedSwaps(squad(), '7', 4);
    const slot = r.picksData.picks.find(p => p.position === 3);
    assert.equal(slot.element, 500);
    assert.equal(r.picksData.picks.some(p => p.element === 103), false);
    // Captaincy and bench order belong to the slot, not the player.
    assert.equal(r.picksData.picks.find(p => p.position === 5).is_captain, true);
});

test('the bank moves by what each side cost', () => {
    const { applyConfirmedSwaps } = ctxWith({ teamId: '7', gw: 4, moves: [move(103, 500, 62, 71)] });
    const r = applyConfirmedSwaps(squad(), '7', 4);
    assert.equal(r.picksData.entry_history.bank, 15 + 62 - 71);
});

test('another team\'s confirmed swaps are not applied', () => {
    const { applyConfirmedSwaps } = ctxWith({ teamId: '7', gw: 4, moves: [move(103, 500)] });
    assert.equal(applyConfirmedSwaps(squad(), '8', 4), null);
});

test('a swap confirmed for another gameweek is not applied', () => {
    const { applyConfirmedSwaps } = ctxWith({ teamId: '7', gw: 3, moves: [move(103, 500)] });
    assert.equal(applyConfirmedSwaps(squad(), '7', 4), null);
});

test('a move already made on FPL is dropped rather than replayed', () => {
    // 103 is gone from the squad: the manager made this transfer for real.
    const { applyConfirmedSwaps, store } = ctxWith({ teamId: '7', gw: 4, moves: [move(103, 500)] });
    const real = squad();
    real.picks.find(p => p.element === 103).element = 500;
    assert.equal(applyConfirmedSwaps(real, '7', 4), null);
    assert.equal(store.has('easyfpl_confirmed_transfers'), false,
        'the record of a move that has happened is cleared, not carried forever');
});

test('a swap that would duplicate a player already held is skipped', () => {
    const { applyConfirmedSwaps } = ctxWith({ teamId: '7', gw: 4, moves: [move(103, 104)] });
    assert.equal(applyConfirmedSwaps(squad(), '7', 4), null);
});

test('the caller\'s own picks object is not mutated', () => {
    const { applyConfirmedSwaps } = ctxWith({ teamId: '7', gw: 4, moves: [move(103, 500, 62, 71)] });
    const original = squad();
    applyConfirmedSwaps(original, '7', 4);
    assert.equal(original.picks.find(p => p.position === 3).element, 103);
    assert.equal(original.entry_history.bank, 15);
});

test('no record at all is not an error', () => {
    const { applyConfirmedSwaps } = ctxWith(null);
    assert.equal(applyConfirmedSwaps(squad(), '7', 4), null);
});
