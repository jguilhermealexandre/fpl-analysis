/* The Transfer Wizard's plan, and the squad it must not touch.

   EasyFPL cannot make a transfer — FPL has no public write API — so a swap
   agreed in the wizard is an intention, and an intention is not a squad. It
   used to be treated as one: confirming rewrote selectedPlayers and picksData
   in place, and applyConfirmedSwaps folded the stored record back in on every
   load, so Squad Analysis, the Gameweek Review and the pitch all described a
   team that existed on this site and nowhere else — and a reload did not clear
   it.

   The plan is the wizard's now. Everything below is a way that separation can
   break: the overlay leaking into the shared squad, or the wizard losing the
   plan it is supposed to keep. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const W = 'scripts/transfer-wizard.js';

// A slot carries the shape of the squad — position in the XI, the armband, the
// bench — and a transfer changes who fills it, never the shape.
const slot = (over = {}) => ({
    id: 1, name: 'Out', position: 2, price: 5.0,
    isCaptain: true, isVice: false, onBench: false, pickPosition: 3, multiplier: 2,
    ...over
});
const squadOf = () => [slot(), slot({ id: 2, name: 'Keep', position: 3, price: 7.0,
    isCaptain: false, isVice: true, pickPosition: 5, multiplier: 1 })];
const move = (outId, inId, outPrice, inPrice) =>
    ({ outId, inId, outName: 'Out', inName: 'In', outPrice, inPrice });

const squadWith = (plan, squad, all) => loadFunction(W, 'twSquad', {
    selectedPlayers: squad, allPlayers: all, twPlan: plan
})();

const ALL = [{ id: 9, name: 'In', position: 2, price: 6.0 }];

test('the plan shows in the wizard', () => {
    const view = squadWith([move(1, 9, 52, 60)], squadOf(), ALL);
    assert.equal(view[0].id, 9);
    assert.equal(view[0].name, 'In');
    assert.equal(view[1].id, 2, 'a slot with no move in it is untouched');
});

test('the incoming player inherits the slot, not the other way round', () => {
    /* A transfer changes who is in the squad. It does not hand the armband to
       whoever arrives, move him to the bench, or renumber the XI — all of which
       would follow from spreading the incoming player over the outgoing one in
       the wrong order. */
    const view = squadWith([move(1, 9, 52, 60)], squadOf(), ALL);
    assert.equal(view[0].isCaptain, true);
    assert.equal(view[0].pickPosition, 3);
    assert.equal(view[0].multiplier, 2);
    assert.equal(view[0].onBench, false);
    assert.equal(view[0].sellPrice, 6.0, 'priced at what the plan says he cost');
    assert.equal(view[0].twPlanned, true, 'flagged as planned rather than owned');
});

test('the page\'s own squad is never written to', () => {
    // The whole point. selectedPlayers is what Squad Analysis, the Gameweek
    // Review and the pitch read, and it is FPL's answer, not ours.
    const squad = squadOf();
    squadWith([move(1, 9, 52, 60)], squad, ALL);
    assert.equal(squad[0].id, 1);
    assert.equal(squad[0].name, 'Out');
    assert.equal(squad[0].sellPrice, undefined);
});

test('no plan hands back the real squad itself', () => {
    // Not a copy: an identical-looking copy would mean every render allocated a
    // new fifteen and nothing downstream could compare by identity.
    const squad = squadOf();
    assert.equal(squadWith([], squad, ALL), squad);
});

test('a player the plan names but the pool does not know is left alone', () => {
    // A stale plan can outlive a player leaving the game. Rendering `undefined`
    // into a slot would empty it; the real man stays until the plan is cleared.
    const view = squadWith([move(1, 404, 52, 60)], squadOf(), ALL);
    assert.equal(view[0].id, 1);
    assert.equal(view[0].name, 'Out');
});

test('the bank moves by what each side actually cost', () => {
    const delta = (plan) => loadFunction(W, 'twPlanBankDelta', { twPlan: plan })();
    assert.equal(delta([move(1, 9, 52, 60)]), -0.8, 'a 6.0m man for a 5.2m man');
    assert.equal(delta([move(1, 9, 71, 62)]), 0.9, 'and the other way');
    assert.equal(delta([]), 0);
});

test('the plan is only read back for the same team and gameweek', () => {
    /* It is keyed on both. A plan made for GW8 is not a plan for GW9, and a
       plan made under one team id must never be laid over another manager's
       squad — the wizard is reachable after switching team ids. */
    const load = (rec, teamId, gw) => loadFunction(W, 'twPlanLoad', {
        twConfirmedRead: () => rec,
        planningGW: gw,
        localStorage: { getItem: () => teamId },
        twPlan: []
    })();
    const rec = { teamId: '7', gw: 8, moves: [move(1, 9, 52, 60)] };
    assert.equal(load(rec, '7', 8).length, 1, 'same team, same gameweek');
    assert.deepEqual([...load(rec, '8', 8)], [], 'different team');
    assert.deepEqual([...load(rec, '7', 9)], [], 'different gameweek');
    assert.deepEqual([...load(null, '7', 8)], [], 'nothing stored');
});
