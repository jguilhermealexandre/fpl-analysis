/* The projection's availability handling.

   scripts/xp-engine.js is the one model behind every xP figure on the site and
   had no unit tests of its own — the backtest covers it end to end, but a
   backtest tells you the total moved, not which term moved it, and for most of
   its life the backtest could not see team news at all.

   These cover the two defects that came out of the first news-aware run. Both
   are in the same place for the same reason: a player who is not going to play
   was being credited as though he might.

   The file declares only constants and functions at the top level, so it loads
   into a sandbox on its own — no page state, no data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers/load.mjs';

function engine(extra = {}) {
    const ctx = {
        console, isPreseason: false, currentGW: 11,
        positionAverages: { 1: {}, 2: {}, 3: { xGIPer90: 0.30, medPrice: 6.5 }, 4: {} },
        teamAnalysis: {}, ...extra
    };
    ctx.globalThis = ctx;
    loadScript('scripts/xp-engine.js', ctx);
    return ctx;
}

/* A nailed-on starter: ten games, ten starts, ninety minutes each.
   Fully formed on purpose. The engine reads a specific player shape — the
   contract documented at the top of the file — and an object missing xG does not
   project badly, it projects NaN. In production xpBuildPlayers guarantees every
   field; a fixture has to do the same or it tests the gap instead of the model. */
const NAILED = {
    status: 'a', chanceNextRound: null, position: 3, teamId: 1, price: 7.0,
    minutes: 900, starts: 10,
    xG: 2.0, xA: 1.5, xGI: 3.5, xGC: 0, bonus: 4, saves: 0,
    yellowCards: 1, redCards: 0, defCon: 90, defCon90: 9,
    penaltiesOrder: null, epNext: 0, fixtures: []
};

test('a player not in the squad is not going to play', () => {
    const { xpIsUnavailable } = engine();
    // 'n' is FPL's code for unregistered or out on loan. It was missing from the
    // two places that listed the unavailable statuses, so those players projected
    // like anyone else: measured at 2.15 points a gameweek against 0.00 returned.
    assert.equal(xpIsUnavailable({ status: 'n' }), true);
    for (const s of ['i', 'u', 's']) assert.equal(xpIsUnavailable({ status: s }), true, s);
    for (const s of ['a', 'd']) assert.equal(xpIsUnavailable({ status: s }), false, s);
    assert.equal(xpIsUnavailable(null), false, 'no player is not an unavailable player');
});

test('an unavailable player projects a flat nothing', () => {
    const { projectPlayerPointsDetailed } = engine();
    const out = projectPlayerPointsDetailed({ ...NAILED, status: 'n' });
    assert.equal(out.total, 0);
    assert.equal(out.appearance, 0);
});

test('doubt scales the bench, not just the start', () => {
    const { expectedMinutesModel } = engine();
    const fit = expectedMinutesModel(NAILED);
    const doubtful = expectedMinutesModel({ ...NAILED, status: 'd', chanceNextRound: 5 });

    /* The old formula credited the not-starting branch with `1 - pStart` twelve
       minutes. pStart already carries availability, so the less likely a player
       was to feature the MORE bench time he was given — a 5% chance produced
       about 15 expected minutes. It has to collapse with availability instead. */
    assert.ok(doubtful.expMins < 5,
        `a 5% chance should be minutes, not a quarter of a match (got ${doubtful.expMins.toFixed(1)})`);
    assert.ok(doubtful.expMins < fit.expMins / 10,
        'and far below the same player when fit');
    assert.ok(doubtful.pStart < 0.06, 'starting is the availability ceiling');
});

test('a fit player is completely unaffected by the change', () => {
    const { expectedMinutesModel } = engine();
    const m = expectedMinutesModel(NAILED);
    // avail is 1, so `avail - pStart` and `1 - pStart` are the same number. This
    // is the property that let the fix ship without moving anything else: the
    // blind backtest reproduces byte for byte.
    assert.equal(m.avail, 1);
    assert.equal(Math.round(m.expMins * 1e6) / 1e6,
                 Math.round((m.pStart * Math.min(90, 900 / 10) + (1 - m.pStart) * 12) * 1e6) / 1e6);
});

test('the appearance term needs someone available to appear', () => {
    const { projectPlayerPointsDetailed } = engine();
    const fit = projectPlayerPointsDetailed(NAILED);
    const doubtful = projectPlayerPointsDetailed({ ...NAILED, status: 'd', chanceNextRound: 5 });
    assert.ok(fit.appearance > 1.8, 'a nailed starter banks close to the full two points');
    assert.ok(doubtful.appearance < 0.15,
        `a 5% chance is not half an appearance point (got ${doubtful.appearance.toFixed(2)})`);
});

test('a published chance still orders the doubtful', () => {
    const { projectPlayerPointsDetailed } = engine();
    const at = c => projectPlayerPointsDetailed({ ...NAILED, status: 'd', chanceNextRound: c }).total;
    // Whatever the calibration of FPL's percentages, more doubt must never
    // project more points.
    assert.ok(at(75) > at(50) && at(50) > at(25) && at(25) > at(0));
});
