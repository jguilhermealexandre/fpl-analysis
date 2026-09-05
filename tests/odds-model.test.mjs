/* The odds model. Every number the panel shows is derived rather than quoted,
   so the derivation is the thing that has to be right — a plausible-looking
   clean-sheet percentage is indistinguishable from a correct one on screen. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    devig, poissonPmf, solveTotalGoals, solveSupremacy,
    homeWinProbability, deriveMatch
} from '../tools/odds-model.mjs';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);

test('devig removes the margin and returns it', () => {
    // A perfectly fair three-way book at even money on each.
    const fair = devig([3, 3, 3]);
    close(fair.overround, 0, 1e-9, 'a fair book has no overround');
    fair.probabilities.forEach(p => close(p, 1 / 3, 1e-9, 'equal odds, equal probability'));

    const real = devig([2.1, 3.64, 3.19]);
    close(real.probabilities.reduce((a, b) => a + b, 0), 1, 1e-9, 'probabilities normalise');
    assert.ok(real.overround > 0.03 && real.overround < 0.10, 'a real book keeps a few per cent');
});

test('devig refuses input it cannot use', () => {
    // Odds of 1.0 or below imply a probability of 1 or more; a missing price
    // arrives as NaN. Either one silently poisons everything downstream.
    assert.equal(devig([1.0, 3, 3]), null);
    assert.equal(devig([NaN, 3, 3]), null);
    assert.equal(devig([2]), null);
    assert.equal(devig(null), null);
});

test('poisson mass is a distribution', () => {
    for (const lambda of [0.2, 1.4, 2.9]) {
        const pmf = poissonPmf(lambda);
        close(pmf.reduce((a, b) => a + b, 0), 1, 1e-6, `pmf sums to one at λ=${lambda}`);
        close(pmf[0], Math.exp(-lambda), 1e-12, 'P(0) is exp(-λ)');
    }
});

test('the total-goals solve inverts the over-2.5 price', () => {
    for (const total of [1.8, 2.6, 3.4, 4.5]) {
        const pOver = 1 - Math.exp(-total) * (1 + total + (total * total) / 2);
        close(solveTotalGoals(pOver), total, 1e-6, 'round trip');
    }
    assert.equal(solveTotalGoals(0), null);
    assert.equal(solveTotalGoals(1), null);
});

test('the supremacy solve reproduces the home-win price', () => {
    const total = 2.7;
    for (const pHome of [0.25, 0.45, 0.7]) {
        const s = solveSupremacy(total, pHome);
        close(homeWinProbability((total + s) / 2, (total - s) / 2), pHome, 1e-6, 'round trip');
    }
});

test('an evenly matched fixture splits its goals evenly', () => {
    const total = 2.6;
    const even = solveSupremacy(total, homeWinProbability(total / 2, total / 2));
    close(even, 0, 1e-5, 'no supremacy when neither side is favoured');
});

test('deriveMatch reconstructs a real fixture', () => {
    // Man City v Coventry, 5 September 2026, consensus prices.
    const m = deriveMatch({ homeOdds: 1.17, drawOdds: 7.64, awayOdds: 13.85, over25Odds: 1.34, under25Odds: 3.17 });
    assert.ok(m, 'a fully priced fixture resolves');
    assert.ok(m.lambdaHome > m.lambdaAway, 'the favourite is expected to score more');
    assert.ok(m.lambdaHome > 2 && m.lambdaHome < 4, `home λ plausible, got ${m.lambdaHome}`);
    assert.ok(m.csHome > m.csAway, 'the favourite is likelier to keep a clean sheet');
    // The identity the whole model rests on.
    close(m.csHome, Math.exp(-m.lambdaAway), 1e-9, 'home CS is the away side failing to score');
    close(m.csAway, Math.exp(-m.lambdaHome), 1e-9, 'away CS is the home side failing to score');
    close(m.winHome + m.draw + m.winAway, 1, 1e-6, 'outcomes are exhaustive');
    close(m.winHome, m.market.home, 1e-5, 'home win is fitted exactly by construction');
});

test('the reconstruction agrees with the market on draws', () => {
    // The draw is the residual — nothing in the fit targets it — so it is the
    // honest check on whether independent Poisson is good enough here. If this
    // ever breaks, Dixon-Coles is the fix.
    const fixtures = [
        { homeOdds: 2.10, drawOdds: 3.64, awayOdds: 3.19, over25Odds: 1.55, under25Odds: 2.37 },
        { homeOdds: 1.62, drawOdds: 3.90, awayOdds: 5.29, over25Odds: 1.82, under25Odds: 1.93 },
        { homeOdds: 5.48, drawOdds: 4.80, awayOdds: 1.50, over25Odds: 1.37, under25Odds: 2.99 },
        { homeOdds: 2.32, drawOdds: 3.37, awayOdds: 3.03, over25Odds: 1.89, under25Odds: 1.86 }
    ];
    for (const f of fixtures) {
        const m = deriveMatch(f);
        assert.ok(m.drawError < 0.05, `draw within 5pp of market, got ${(m.drawError * 100).toFixed(1)}pp`);
    }
});

test('both-teams-to-score follows from the two goal expectations', () => {
    const m = deriveMatch({ homeOdds: 2.10, drawOdds: 3.64, awayOdds: 3.19, over25Odds: 1.55, under25Odds: 2.37 });
    close(m.bttsYes, (1 - m.csAway) * (1 - m.csHome), 1e-9, 'neither side blanks');
    assert.ok(m.bttsYes > 0.3 && m.bttsYes < 0.85, 'plausible range');
});

test('scorelines are ranked and normalised', () => {
    const m = deriveMatch({ homeOdds: 1.17, drawOdds: 7.64, awayOdds: 13.85, over25Odds: 1.34, under25Odds: 3.17 });
    assert.equal(m.scorelines.length, 5);
    for (let i = 1; i < m.scorelines.length; i++) {
        assert.ok(m.scorelines[i - 1].p >= m.scorelines[i].p, 'sorted by probability');
    }
    assert.ok(m.scorelines[0].h > m.scorelines[0].a, 'the favourite wins the likeliest scoreline');
});

test('deriveMatch returns null rather than guessing', () => {
    // A fixture that cannot be priced must vanish from the feed. Half a result
    // is worse than none: it renders as confidently as a real one.
    const base = { homeOdds: 2.1, drawOdds: 3.64, awayOdds: 3.19, over25Odds: 1.55, under25Odds: 2.37 };
    assert.equal(deriveMatch({ ...base, over25Odds: null }), null, 'no totals market');
    assert.equal(deriveMatch({ ...base, drawOdds: null }), null, 'no draw price');
    assert.equal(deriveMatch({ ...base, homeOdds: 0.5 }), null, 'impossible price');
    assert.equal(deriveMatch({}), null, 'nothing at all');
});

test('goal expectations stay inside football', () => {
    // A parsing error that shifted a column would show up as a λ no match has.
    const m = deriveMatch({ homeOdds: 1.05, drawOdds: 15, awayOdds: 40, over25Odds: 1.1, under25Odds: 7 });
    if (m) {
        assert.ok(m.lambdaHome <= 6 && m.lambdaAway >= 0.05, 'clamped to plausible goal rates');
    }
});
