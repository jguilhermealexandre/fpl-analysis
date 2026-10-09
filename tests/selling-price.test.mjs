/* What a squad is worth if you sell it.
 *
 * The squad page read `pick.selling_price`, and the picks endpoint does not have
 * that field — a pick is { element, position, multiplier, is_captain,
 * is_vice_captain, element_type }. Purchase prices live behind my-team/{id},
 * which needs the manager's own login and a static site cannot have one. So
 * every player's sellPrice was `undefined / 10`: NaN.
 *
 * NaN then split the consumers, because the two guards in use are not
 * equivalent. `sellPrice || price` takes the price branch and budgets against
 * the LIST price. `sellPrice != null ? sellPrice : price` keeps the NaN, since
 * NaN is not null — and that is the figure behind "£6.2m is £NaNm more than
 * selling Groß raises" in the wizard's recommendation card.
 *
 * Both wrong answers mattered, because the help drawer promises the opposite in
 * as many words: "Replacements are priced against your selling price, not the
 * list price... a move that looks affordable at list price often is not."
 * Measured against a real squad, the list price overstated what 11 of 15
 * players raise, £1.4m across the squad — and £0.1-0.2m per transfer is exactly
 * the margin that decides whether a replacement is affordable.
 *
 * FPL's rule: half of any rise since purchase, rounded down; the whole of any
 * fall. Purchase price comes from entry/{id}/transfers/, which is public and
 * stamps every move with element_in_cost.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const SRC = 'scripts/common.js';
const sellingPriceTenths = loadFunction(SRC, 'sellingPriceTenths');
const v2BoughtTenths = loadFunction(SRC, 'v2BoughtTenths');
const v2SellPrice = loadFunction(SRC, 'v2SellPrice', { sellingPriceTenths });

// price and costChangeStart as the normalised player shape carries them:
// millions, and tenths, respectively.
const player = (o = {}) => ({ id: 1, price: 7.5, costChangeStart: 5, ...o });

test("the help drawer's own example", () => {
    /* "a £7.5m forward bought at £7.0m sells for £7.2m" — the sentence this
       function exists to make true. */
    const bought = v2BoughtTenths([{ element_in: 1, element_in_cost: 70, event: 3 }]);
    assert.equal(v2SellPrice({}, player({ price: 7.5 }), bought), 7.2);
});

test('half the rise, rounded down', () => {
    assert.equal(sellingPriceTenths(70, 75), 72, '0.5 rise banks 0.2');
    assert.equal(sellingPriceTenths(70, 73), 71, '0.3 rise banks 0.1');
    assert.equal(sellingPriceTenths(70, 71), 70, '0.1 rise banks nothing');
    assert.equal(sellingPriceTenths(70, 70), 70, 'no rise, no change');
});

test('the whole of any fall', () => {
    /* Not half. A player who has dropped costs you the full drop, which is why
       holding a falling player is the expensive mistake in FPL. */
    assert.equal(sellingPriceTenths(70, 69), 69);
    assert.equal(sellingPriceTenths(70, 65), 65);
});

test('a player never transferred in was there at the start', () => {
    /* No transfer row, so purchase price is today's price less his whole
       season's movement — which is what cost_change_start is. */
    const p = player({ price: 5.9, costChangeStart: 4 });   // started at 5.5
    assert.equal(v2SellPrice({}, p, new Map()), 5.7, '0.4 rise banks 0.2');
});

test('a player who has only fallen since the start', () => {
    const p = player({ price: 6.9, costChangeStart: -1 });  // started at 7.0
    assert.equal(v2SellPrice({}, p, new Map()), 6.9, 'the whole fall');
});

test('bought, sold and bought again ends on the LAST price paid', () => {
    /* The transfer log is every move ever made, so a player can appear more
       than once. Sorting by event and overwriting is what makes the last one
       win; taking the first would price him at a cost he no longer carries. */
    const bought = v2BoughtTenths([
        { element_in: 1, element_in_cost: 60, event: 2 },
        { element_in: 1, element_in_cost: 80, event: 9 },
        { element_in: 1, element_in_cost: 70, event: 5 }
    ]);
    assert.equal(bought.get(1), 80, 'the GW9 buy-in, not the GW2 one');
    assert.equal(v2SellPrice({}, player({ price: 8.4 }), bought), 8.2);
});

test('a pending transfer keeps the selling price already computed for it', () => {
    /* applyPendingTransfers() writes a real selling_price onto the slot it adds
       for a move made before the round kicks off. That figure wins — deriving it
       again from the transfer log would reach the same answer, but the slot is
       the more direct source. */
    assert.equal(v2SellPrice({ selling_price: 58 }, player({ price: 9.9 }), new Map()), 5.8);
});

test('nothing is NaN, whatever is missing', () => {
    /* The whole point. Every one of these used to produce NaN, and NaN passes
       an `!= null` guard. */
    for (const [pick, p, map, label] of [
        [{}, player(), new Map(), 'no transfer log'],
        [{}, player({ costChangeStart: undefined }), new Map(), 'no season movement'],
        [{}, player({ costChangeStart: null }), null, 'no map at all'],
        [{ selling_price: undefined }, player(), new Map(), 'an explicit undefined']
    ]) {
        const out = v2SellPrice(pick, p, map);
        assert.ok(Number.isFinite(out), `${label} gave ${out}`);
        assert.ok(out > 0, `${label} gave ${out}`);
    }
    assert.equal(v2SellPrice({}, null, new Map()), 0, 'and no player is 0, not NaN');
});

test('a malformed transfer log is ignored rather than trusted', () => {
    assert.equal(v2BoughtTenths(null).size, 0);
    assert.equal(v2BoughtTenths(undefined).size, 0);
    assert.equal(v2BoughtTenths({ detail: 'Not found.' }).size, 0, 'an FPL error body');
    assert.equal(v2BoughtTenths([{ event: 3 }]).size, 0, 'a row with no element_in');
    assert.equal(v2BoughtTenths([{ element_in: 1, event: 3 }]).size, 0, 'or no cost');
});

test('the selling price is never above the list price', () => {
    /* The invariant that makes this a BUDGET fix: FPL never gives back more
       than a player is worth today, so any squad priced at list price is a
       squad whose budget was overstated. */
    for (const [bought, now] of [[40, 40], [40, 150], [150, 40], [70, 71], [70, 69], [45, 46]]) {
        assert.ok(sellingPriceTenths(bought, now) <= now,
            `bought ${bought}, now ${now} sold for more than it is worth`);
    }
});
