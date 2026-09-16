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

/* ===== the defensive-contribution threshold ===== */

const DEFENDER = { ...NAILED, position: 2, defCon: 1080, defCon90: 12 };
const mm = (pStart, minsPerStart = 90) =>
    ({ pStart, minsPerStart, avail: 1, expMins: pStart * minsPerStart, min90: pStart * minsPerStart / 90 });

test('the chance of starting multiplies the defensive point, it does not shrink the rate', () => {
    const { defensiveContributionPoints } = engine();
    const full = defensiveContributionPoints(DEFENDER, mm(1.0));
    const half = defensiveContributionPoints(DEFENDER, mm(0.5));

    assert.ok(full > 1.2, `12 defensive actions a match clears a threshold of 10 most weeks (got ${full.toFixed(2)})`);
    /* Exactly half, because starting is a probability and belongs outside the
       distribution. The old code multiplied the Poisson RATE by a figure that
       already carried the chance of not playing, and P(X >= 10) collapses far
       faster than linearly in the mean — at these numbers it returned about a
       ninth of the full value rather than a half. Measured against real team
       news that cost more than half of everything this route pays out. */
    assert.ok(Math.abs(half - full / 2) < 1e-9,
        `halving the chance of starting must halve the points (${half.toFixed(3)} against ${(full / 2).toFixed(3)})`);
});

test('fewer minutes when he does start still lowers the chance', () => {
    const { defensiveContributionPoints } = engine();
    // This one SHOULD go through the rate: sixty minutes really is fewer chances
    // to make ten tackles. It is only the not-playing branch that must not.
    const ninety = defensiveContributionPoints(DEFENDER, mm(1.0, 90));
    const sixty = defensiveContributionPoints(DEFENDER, mm(1.0, 60));
    assert.ok(sixty < ninety * 0.8, 'a shorter match is a genuinely thinner tail');
});

test('goalkeepers never qualify for it', () => {
    const { defensiveContributionPoints } = engine();
    assert.equal(defensiveContributionPoints({ ...DEFENDER, position: 1 }, mm(1.0)), 0);
});

test('a published chance still orders the doubtful', () => {
    const { projectPlayerPointsDetailed } = engine();
    const at = c => projectPlayerPointsDetailed({ ...NAILED, status: 'd', chanceNextRound: c }).total;
    // Whatever the calibration of FPL's percentages, more doubt must never
    // project more points.
    assert.ok(at(75) > at(50) && at(50) > at(25) && at(25) > at(0));
});

/* ---------------------------------------------------------------------------
   The opponent.

   A captaincy pick put a Brighton midfielder above a Chelsea forward for a home
   match against Arsenal, the meanest defence in the division, and the reason was
   that the projection could not tell a hard fixture from an easy one. Both
   opponent terms scaled a 0-100 power rating around a neutral point of 50, and
   neither rating ever reached 50: measured across the committed feed, attack ran
   0-55 with a median of 41 and defence 0-48 with a median of 21. So the
   attacking multiplier spanned 1.007 to 1.550 across a whole round — facing
   Arsenal was worth 1.007 — and it could only ever raise a projection.

   Both now work in goals, as a ratio to the league average, so a league-average
   side is 1.0 by construction rather than by coincidence.

   These tests are about the property that failed, not the constants: a harder
   opponent must project fewer points than an easier one, in both directions. */

// Two clubs, four rounds each: one that concedes freely, one that concedes
// almost nothing. matchesPlayed is what the regression weighs.
const LEAKY = { avgGoals: 1.4, avgConceded: 2.75, matchesPlayed: 4 };
const MEAN = { avgGoals: 1.4, avgConceded: 0.25, matchesPlayed: 4 };
const AVERAGE = { avgGoals: 1.4, avgConceded: 1.4, matchesPlayed: 4 };
const OPPONENTS = { 1: AVERAGE, 2: LEAKY, 3: MEAN, 4: AVERAGE };
const vs = (id, isHome = true) => ({ opponentId: id, isHome, difficulty: 3 });

test('a mean defence is a harder fixture than a leaky one', () => {
    const { fixtureAttackAdj } = engine({ teamAnalysis: OPPONENTS });
    const leaky = fixtureAttackAdj(vs(2));
    const mean = fixtureAttackAdj(vs(3));
    assert.ok(mean < leaky, `${mean.toFixed(3)} against ${leaky.toFixed(3)}`);
    // The old model's entire spread across a round was 0.54 of a multiplier and
    // sat above 1.0 throughout. What matters is that the hard end is genuinely
    // below neutral — that a bad fixture can cost a player points.
    assert.ok(mean < 1, 'the best defence in the league must lower a projection');
    assert.ok(leaky > 1, 'the worst defence in the league must raise one');
});

test('an average opponent is worth no adjustment at all', () => {
    const { fixtureAttackAdj } = engine({ teamAnalysis: OPPONENTS });
    // The property the 50-pivot was meant to have and did not. A side conceding
    // exactly the league rate is the definition of neutral, so the multiplier
    // has to be 1 whatever the regression weight.
    assert.ok(Math.abs(fixtureAttackAdj(vs(1)) - 1) < 1e-9);
});

test('four matches is not proof of a great defence', () => {
    const { fixtureAttackAdj } = engine({ teamAnalysis: OPPONENTS });
    const thin = fixtureAttackAdj(vs(3));
    // Conceding 0.25 a game is 0.18 of the league rate, but on four matches the
    // engine may only claim part of that. Anything at or below the raw ratio
    // would be taking a four-match sample at face value.
    assert.ok(thin > 0.25 / 1.4, `${thin.toFixed(3)} treats four matches as settled`);
});

test('the multiplier stays inside its clamp however extreme the opponent', () => {
    const { fixtureAttackAdj } = engine({
        teamAnalysis: { 9: { avgGoals: 1.4, avgConceded: 9, matchesPlayed: 38 },
                        8: { avgGoals: 1.4, avgConceded: 0, matchesPlayed: 38 } }
    });
    assert.ok(fixtureAttackAdj(vs(9)) <= 1.40);
    assert.ok(fixtureAttackAdj(vs(8)) >= 0.70);
});

test('a missing opponent falls back to the fixture rating', () => {
    const { fixtureAttackAdj } = engine({ teamAnalysis: OPPONENTS });
    // Blanks and gaps in the feed must not read as a neutral fixture.
    const unknown = fixtureAttackAdj({ opponentId: 99, isHome: true, difficulty: 5 });
    assert.ok(unknown < 1, 'an FDR 5 blank is still a hard fixture');
    assert.ok(fixtureAttackAdj({ opponentId: 99, isHome: true, difficulty: 2 }) > 1);
});

test('facing a better attack means conceding more', () => {
    const { expectedGoalsAgainst } = engine({
        teamAnalysis: { 1: AVERAGE, 5: { avgGoals: 3.0, avgConceded: 1.4, matchesPlayed: 4 },
                        6: { avgGoals: 0.3, avgConceded: 1.4, matchesPlayed: 4 } }
    });
    const strong = expectedGoalsAgainst(1, vs(5));
    const weak = expectedGoalsAgainst(1, vs(6));
    assert.ok(strong > weak, `${strong.toFixed(3)} against ${weak.toFixed(3)}`);
});

test('two average sides expect the league average, minus home advantage', () => {
    const { expectedGoalsAgainst } = engine({ teamAnalysis: OPPONENTS });
    // Same property as above, on the defensive side: neutral in, neutral out.
    // Home sides concede a little less, which is the only venue term left in the
    // model — one on the attacking multiplier was tested and made it worse.
    const home = expectedGoalsAgainst(1, vs(4, true));
    const away = expectedGoalsAgainst(1, vs(4, false));
    assert.ok(Math.abs(home - 1.4 * 0.94) < 1e-9, home.toFixed(4));
    assert.ok(away > home, 'away is the harder half of the same fixture');
});

test('the clean sheet follows the opponent, not the badge', () => {
    const { cleanSheetProbFor } = engine({
        teamAnalysis: { 1: MEAN, 5: { avgGoals: 3.0, avgConceded: 1.4, matchesPlayed: 4 },
                        6: { avgGoals: 0.3, avgConceded: 1.4, matchesPlayed: 4 } }
    });
    // The same good defence, against the best and worst attacks in the league.
    // Under the old model this pair barely separated, and clean sheets across
    // the feed came out at 0.218 predicted against 0.325 actually kept.
    assert.ok(cleanSheetProbFor(1, vs(6)) > cleanSheetProbFor(1, vs(5)) + 0.10);
});
