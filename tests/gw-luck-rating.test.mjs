/* Was it the picks or the week?

   A gameweek score is a selection plus a week of variance, and the two ask for
   opposite responses — so the comparison worth making is the squad against its
   own projection, taken before the round.

   TWO THINGS ARE EASY TO GET WRONG HERE AND BOTH FLATTER THE READER.

   The first is answering at all. The projection cannot be rebuilt after the fact:
   the engine reads data/bootstrap-static.json, which is overwritten every fifteen
   minutes, so re-running it over a played round grades a different squad on
   different inputs. Only data/model-log/gw{N}.json will do, and most of these
   tests are about returning null rather than finding something to say.

   The second is the multiplier. An auto-substitution sets a starter's multiplier
   to zero, so reading the realised multiplier silently drops that player's
   projection out of the expected total — discarding exactly the predictions that
   failed. On the real GW5 squad that is a 15-point swing in the manager's favour
   if the captain is the one who does not appear. The forecast was made about the
   eleven that was submitted, so that is what it is graded against. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const SRC = 'scripts/gameweek-review.js';

const gwSubmittedMultiplier = loadFunction(SRC, 'gwSubmittedMultiplier');
const gwLuckRating = loadFunction(SRC, 'gwLuckRating', { gwSubmittedMultiplier });

/* An entry in the shape buildGameweekReview() produces. `started` is where he was
   PICKED; `multiplier` is what the round made of it, and the two disagree exactly
   when an auto-sub happened. */
const entry = (id, name, o = {}) => ({
    player: { id, name }, started: true, multiplier: 1, isCaptain: false, raw: 0, ...o
});
const snapshot = (gw, xps, extra = {}) => ({
    gw, takenAt: '2026-09-19T10:00:00Z', hoursBeforeDeadline: 13.5,
    players: Object.entries(xps).map(([id, xp]) => ({ id: Number(id), xp })),
    ...extra
});
const done = { complete: true, chip: null };

test('expected and actual are both weighted by the multiplier that was picked', () => {
    const r = gwLuckRating(5, [
        entry(1, 'Normal', { raw: 6 }),
        entry(2, 'Captain', { raw: 10, isCaptain: true })
    ], snapshot(5, { 1: 4, 2: 5 }), done);
    assert.equal(r.expected, 14, '4 + 5x2');
    assert.equal(r.actual, 26, '6 + 10x2');
    assert.equal(r.delta, 12);
    assert.equal(r.graded, 2);
});

test('the bench is not graded, because it was not asked to score', () => {
    const r = gwLuckRating(5, [
        entry(1, 'Starter', { raw: 5 }),
        entry(2, 'Benched', { started: false, multiplier: 0, raw: 14 })
    ], snapshot(5, { 1: 4, 2: 6 }), done);
    assert.equal(r.graded, 1);
    assert.equal(r.expected, 4);
    assert.equal(r.actual, 5);
});

test('Bench Boost grades all fifteen, because all fifteen were asked to score', () => {
    const r = gwLuckRating(5, [
        entry(1, 'Starter', { raw: 5 }),
        entry(2, 'Benched', { started: false, multiplier: 1, raw: 14 })
    ], snapshot(5, { 1: 4, 2: 6 }), { complete: true, chip: 'bboost' });
    assert.equal(r.graded, 2);
    assert.equal(r.expected, 10);
    assert.equal(r.actual, 19);
});

/* ---- the multiplier trap ---- */

test('a captain who never appeared is still graded, at the armband he was given', () => {
    /* THE ONE THAT FLATTERS. FPL sets his multiplier to 0 and promotes the vice.
       Reading that multiplier would delete a 15-point projection from the
       expected total and report a squad that missed its forecast by fifteen as
       having met it. */
    const subbedOut = entry(2, 'Captain', { isCaptain: true, multiplier: 0, raw: 0 });
    const r = gwLuckRating(5, [
        entry(1, 'Normal', { raw: 5 }),
        subbedOut
    ], snapshot(5, { 1: 4, 2: 7.5 }), done);
    assert.equal(r.expected, 19, '4 + 7.5x2 — the armband is still in it');
    assert.equal(r.actual, 5);
    assert.equal(r.delta, -14);
    assert.equal(r.graded, 2, 'he is graded, not skipped');
});

test('a substitute who came on is not graded as though he had been picked', () => {
    /* His multiplier is 1 after the round and his submitted multiplier is 0. A
       substitute rescues a blank; he was never forecast to play. */
    const r = gwLuckRating(5, [
        entry(1, 'Starter', { raw: 2 }),
        entry(2, 'CameOn', { started: false, multiplier: 1, raw: 9 })
    ], snapshot(5, { 1: 4, 2: 3 }), done);
    assert.equal(r.graded, 1);
    assert.equal(r.actual, 2, 'his nine points are not in the comparison');
});

test('Triple Captain is graded at three, not two', () => {
    const r = gwLuckRating(5, [entry(1, 'TC', { isCaptain: true, raw: 10 })],
        snapshot(5, { 1: 5 }), { complete: true, chip: '3xc' });
    assert.equal(r.expected, 15);
    assert.equal(r.actual, 30);
});

test('the submitted multiplier, on its own', () => {
    assert.equal(gwSubmittedMultiplier({ started: true, isCaptain: false }, null), 1);
    assert.equal(gwSubmittedMultiplier({ started: true, isCaptain: true }, null), 2);
    assert.equal(gwSubmittedMultiplier({ started: true, isCaptain: true }, '3xc'), 3);
    assert.equal(gwSubmittedMultiplier({ started: false, isCaptain: false }, null), 0);
    assert.equal(gwSubmittedMultiplier({ started: false, isCaptain: false }, 'bboost'), 1);
    assert.equal(gwSubmittedMultiplier({ started: false, isCaptain: true }, 'bboost'), 2,
        'a captain can be benched by a Bench Boost manager and still carries the armband');
});

/* ---- refusals ---- */

test('it refuses on a part-played round', () => {
    /* The projection covers every fixture in the week; the points cover the ones
       that have finished. The gap would be a measure of the clock. */
    assert.equal(gwLuckRating(5, [entry(1, 'A', { raw: 5 })], snapshot(5, { 1: 4 }),
        { complete: false }), null);
});

test('it refuses when the snapshot is for a different gameweek', () => {
    assert.equal(gwLuckRating(6, [entry(1, 'A', { raw: 5 })], snapshot(5, { 1: 4 }), done), null);
});

test('it refuses when there is no snapshot, or it holds no projections', () => {
    const e = [entry(1, 'A', { raw: 5 })];
    assert.equal(gwLuckRating(5, e, null, done), null);
    assert.equal(gwLuckRating(5, e, { gw: 5 }, done), null, 'no players array');
    assert.equal(gwLuckRating(5, e, snapshot(5, {}), done), null, 'an empty archive');
});

test('a null projection is not a projection of zero', () => {
    /* xp comes back null for a player the engine could not build at that
       deadline. Counting him as zero would charge the model with a miss it never
       made, in the direction that makes the manager look unlucky. */
    const r = gwLuckRating(5, [
        entry(1, 'Known', { raw: 5 }),
        entry(2, 'Unbuilt', { raw: 12 })
    ], { gw: 5, players: [{ id: 1, xp: 4 }, { id: 2, xp: null }] }, done);
    assert.equal(r.graded, 1);
    assert.equal(r.missing, 1, 'reported, so the copy can say the list is short');
    assert.equal(r.expected, 4);
    assert.equal(r.actual, 5, 'his twelve points are out too — both sides or neither');
});

test('it refuses when not one of the eleven has a projection', () => {
    assert.equal(gwLuckRating(5, [entry(1, 'A', { raw: 5 })],
        snapshot(5, { 99: 4 }), done), null);
});

/* ---- what it hands the renderer ---- */

test('the biggest over- and under-performers come out separately, biggest first', () => {
    const r = gwLuckRating(5, [
        entry(1, 'Hauled', { raw: 13 }),
        entry(2, 'Fine', { raw: 4 }),
        entry(3, 'Blanked', { raw: 0 }),
        entry(4, 'Worse', { raw: 1 })
    ], snapshot(5, { 1: 4, 2: 4, 3: 5, 4: 8 }), done);
    assert.equal(r.over[0].player.name, 'Hauled');
    assert.equal(r.under[0].player.name, 'Worse', '-7 beats -5');
    assert.equal(r.under[1].player.name, 'Blanked');
    assert.ok(!r.over.concat(r.under).some(x => x.player.name === 'Fine'),
        'a player who did exactly what was expected is not a finding');
});

test('it carries how long before the deadline the prediction was sealed', () => {
    const r = gwLuckRating(5, [entry(1, 'A', { raw: 5 })], snapshot(5, { 1: 4 }), done);
    assert.equal(r.hoursBefore, 13.5);
    assert.equal(r.takenAt, '2026-09-19T10:00:00Z');
});
