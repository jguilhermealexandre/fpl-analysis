/* Whether a player is actually playing LATELY.

   THE BUG THIS EXISTS FOR. expectedMinutesModel estimated the chance of starting
   from `starts / gameweeks elapsed`, a season rate, so every week a player was
   injured or on the bench kept counting against him after he was back in the
   side. Konsa opened 2026/27 with 0 and 11 minutes and then started three in a
   row at ninety: the season rate said 3/5 = 0.600, his fitness doubt took another
   quarter off, and the projection arrived at 44 expected minutes and 1.8 points
   for a defender about to play the full match. FPL's own estimate was 2.6.

   Measured before the change, GW1-4 reconstructed and GW5 graded, n=610, both
   arms running the shipped engine: pStart Brier 0.1084 -> 0.0948, xP MAE
   1.4705 -> 1.4408, top-10 and top-20 actual points UNCHANGED. The ranking
   holding still is the whole reason this shipped — an earlier attempt to
   recalibrate the same term improved calibration and cost the top ten, because a
   monotone correction inflates the marginal tail where a recency window sorts it.

   What is tested here is the decay, the fallbacks, and the two invariants that
   make the change safe: a player who has started everything must not move, and a
   player with no recent window must get exactly what he got before. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const SRC = 'scripts/xp-engine.js';
const HALFLIFE = 1.5;

const xpRecentStartRate = loadFunction(SRC, 'xpRecentStartRate', { XP_RECENT_HALFLIFE: HALFLIFE });

/* The minutes model, with only what it reads. computePlayerGamesPlayed is the
   club's games played, so it is handed in rather than derived. */
const minutesModel = (player, games) => loadFunction(SRC, 'expectedMinutesModel', {
    XP_RECENT_HALFLIFE: HALFLIFE,
    xpRecentStartRate,
    computePlayerGamesPlayed: () => games,
    lastSeasonMinsPerStart: () => null
})(player);

const mf = (st, mins) => ({
    gws: st.map((_, i) => i + 1),
    st,
    mins: mins || st.map(s => (s ? 90 : 0))
});

/* xpRecentStartRate takes a PLAYER and reads player.mf, so the window has to be
   wrapped in one. Worth a named helper: passing the bare window reads fine and
   returns null, which is the one failure mode that looks like a pass. */
const rate = (st, mins) => xpRecentStartRate({ mf: mf(st, mins) });

/* ---- the decay ---- */

test('an unbroken run of starts is a rate of one, whatever its length', () => {
    assert.equal(rate([1]), 1);
    assert.equal(rate([1, 1, 1, 1, 1]), 1);
});

test('no starts at all is a rate of zero', () => {
    assert.equal(rate([0, 0, 0, 0, 0]), 0);
});

test('the same three starts are worth 2.5x more at the end than at the start', () => {
    /* A half-life of a gameweek and a half over a five-week window. The point is
       that "started the last three" and "started the first three" are opposite
       claims about a player, and a season rate scores them identically at 0.6.
       Here they are 0.833 and 0.330.

       The older end is not crushed to nothing on purpose: a man who started
       three and has been left out twice is a plausible one-in-three to return,
       not a 0.05. The weights put a third of the total on the oldest three
       slots, which is what that belief looks like as a number. */
    const recent = rate([0, 0, 1, 1, 1]);
    const stale = rate([1, 1, 1, 0, 0]);
    assert.ok(Math.abs(recent - 0.833) < 0.005, `last three: ${recent.toFixed(3)}`);
    assert.ok(Math.abs(stale - 0.330) < 0.005, `first three: ${stale.toFixed(3)}`);
    assert.ok(recent > stale * 2, 'and the gap has to be decisive, not cosmetic');
});

test("Konsa's real window reads 0.83, where the season rate read 0.60", () => {
    // GW1-5: 0, 11, 90, 90, 90 minutes — benched twice, then three starts.
    const r = rate([0, 0, 1, 1, 1], [0, 11, 90, 90, 90]);
    assert.ok(Math.abs(r - 0.833) < 0.005, `expected ~0.833, got ${r.toFixed(3)}`);
});

test('one rested week does not undo a long run', () => {
    /* The reason the window is five with a decay rather than "the last two":
       last-two scored marginally better on Brier and turns a single rotation
       into a coin flip. */
    const r = rate([1, 1, 1, 1, 0]);
    assert.ok(r > 0.55, `a rested man who started the previous four, got ${r.toFixed(3)}`);
});

test('a player just dropped reads lower than a player just promoted', () => {
    const dropped = rate([1, 1, 1, 0, 0]);
    const promoted = rate([0, 0, 0, 1, 1]);
    assert.ok(promoted > dropped, 'recency cuts both ways — that is what protects the ranking');
});

/* ---- the fallbacks ---- */

test('no window means no opinion, and the season rate stands', () => {
    assert.equal(xpRecentStartRate(null), null);
    assert.equal(xpRecentStartRate({}), null);
    assert.equal(xpRecentStartRate({ mf: null }), null);
    assert.equal(xpRecentStartRate({ mf: { st: [] } }), null);
    assert.equal(xpRecentStartRate({ mf: { mins: [90, 90] } }), null, 'starts are what it reads');
});

test('a player with no attached window projects exactly as he did before', () => {
    /* The guarantee that makes this safe to ship against a data file that may
       not have landed yet: without `mf` the model is the model it was. */
    const before = minutesModel({ status: 'a', minutes: 281, starts: 3 }, 5);
    assert.ok(Math.abs(before.pStart - 0.6) < 0.001, `season rate 3/5, got ${before.pStart}`);
});

/* ---- the invariants ---- */

test('a nailed starter does not move', () => {
    /* Measured on the real squad: Calafiori, Szoboszlai, Haaland, Gvardiol and
       Hall all projected identically before and after. If this test fails the
       change has stopped being surgical. */
    const season = minutesModel({ status: 'a', minutes: 450, starts: 5 }, 5);
    const recent = minutesModel({ status: 'a', minutes: 450, starts: 5, mf: mf([1, 1, 1, 1, 1]) }, 5);
    assert.equal(recent.pStart, season.pStart);
    assert.equal(recent.expMins, season.expMins);
});

test('the returning starter moves, and by the amount measured', () => {
    const p = { status: 'd', chanceNextRound: 75, minutes: 281, starts: 3 };
    const before = minutesModel(p, 5);
    const after = minutesModel({ ...p, mf: mf([0, 0, 1, 1, 1], [0, 11, 90, 90, 90]) }, 5);
    assert.ok(Math.abs(before.pStart - 0.45) < 0.01, `before ${before.pStart.toFixed(3)}`);
    assert.ok(Math.abs(after.pStart - 0.625) < 0.01, `after ${after.pStart.toFixed(3)}`);
    assert.ok(after.expMins > before.expMins + 10, 'and it has to be worth real minutes');
});

test('the fitness doubt is still applied on top, not replaced', () => {
    /* The recency window says whether he is in the side. chanceNextRound says
       whether he is fit. They are different facts and both have to count — a
       nailed starter on a 25% chance is not a 96% to start. */
    const fit = minutesModel({ status: 'a', minutes: 450, starts: 5, mf: mf([1, 1, 1, 1, 1]) }, 5);
    const doubt = minutesModel({ status: 'd', chanceNextRound: 25, minutes: 450, starts: 5, mf: mf([1, 1, 1, 1, 1]) }, 5);
    assert.ok(Math.abs(doubt.pStart - fit.pStart * 0.25) < 0.001);
    assert.ok(doubt.expMins < fit.expMins / 3);
});

test('a man who has never started is still capped, however recent his minutes', () => {
    /* The season `starts` guard is deliberately kept: a substitute racking up
       minutes off the bench is not a starter, and the window cannot say so on
       its own because it reads starts, not minutes. */
    const sub = minutesModel({ status: 'a', minutes: 200, starts: 0, mf: mf([0, 0, 0, 0, 0], [40, 45, 40, 35, 40]) }, 5);
    assert.ok(sub.pStart <= 0.22, `capped, got ${sub.pStart}`);
});

test('expected minutes never exceed what availability allows', () => {
    for (const chance of [0, 25, 50, 75]) {
        const m = minutesModel({ status: 'd', chanceNextRound: chance, minutes: 450, starts: 5, mf: mf([1, 1, 1, 1, 1]) }, 5);
        assert.ok(m.pStart <= m.avail + 1e-9, `pStart ${m.pStart} > avail ${m.avail} at ${chance}%`);
        assert.ok(m.expMins >= 0, 'and bench time cannot go negative');
    }
});
