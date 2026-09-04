/* The market/model comparison, and the weighting that decides how much of the
   market reaches a projection.

   The blend changes every clean sheet and every goals-conceded deduction on the
   site for the priced gameweek, so the guards around it matter more than the
   arithmetic: applied to a half-priced round it would compare players across two
   different estimators, and applied to an unpriced one it would do nothing but
   claim otherwise. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { summarise, appendRound, calibrationSample, CALIBRATION_MAX_ROUNDS } from '../tools/odds-calibration.mjs';
import { loadScript, browserStubs } from './helpers/load.mjs';

const panel = loadScript('scripts/odds-panel.js', browserStubs());

test('the market weight fades as the model earns its own evidence', () => {
    const early = panel.boMarketWeight(0);
    const mid = panel.boMarketWeight(6);
    const late = panel.boMarketWeight(30);
    assert.ok(early > mid && mid > late, `should decrease: ${early} > ${mid} > ${late}`);
    assert.ok(early <= 0.8, 'never lets the market carry everything');
    assert.ok(late >= 0.2, 'never drops the market entirely — it prices team news no rating sees');
    // Junk in must not produce a weight outside the band.
    for (const bad of [null, undefined, NaN, -5, 'x']) {
        const w = panel.boMarketWeight(bad);
        assert.ok(w >= 0.2 && w <= 0.8, `weight stayed in band for ${bad}: ${w}`);
    }
});

test('an unpriced or half-priced round is never blended', () => {
    const { boSetOdds, boRoundFullyPriced, boMarketXGA } = panel;

    boSetOdds(null);
    assert.equal(boRoundFullyPriced(3), false, 'no feed, no blend');
    assert.equal(boMarketXGA(1, { event: 3, opponentId: 2, isHome: true }), null);

    // The producer says the round is short. Consumers must not blend it, even
    // though the fixtures it does have are perfectly good prices.
    boSetOdds({
        metadata: { coverage: [{ event: 3, priced: 6, scheduled: 10, complete: false }] },
        matches: [{ event: 3, homeId: 1, awayId: 2, lambdaHome: 1.5, lambdaAway: 1.1 }]
    });
    assert.equal(boRoundFullyPriced(3), false, 'partial rounds are refused');
    assert.equal(boMarketXGA(1, { event: 3, opponentId: 2, isHome: true }), null);
});

test('a complete round is blended, from the right side', () => {
    const { boSetOdds, boMarketXGA } = panel;
    boSetOdds({
        metadata: { coverage: [{ event: 3, priced: 1, scheduled: 1, complete: true }] },
        matches: [{ event: 3, homeId: 1, awayId: 2, lambdaHome: 1.5, lambdaAway: 1.1 }]
    });
    // Goals AGAINST the home side are the goals the away side scores.
    assert.equal(boMarketXGA(1, { event: 3, opponentId: 2, isHome: true }), 1.1);
    assert.equal(boMarketXGA(2, { event: 3, opponentId: 1, isHome: false }), 1.5);
    // A different gameweek, or a team not in the round, has no price.
    assert.equal(boMarketXGA(1, { event: 4, opponentId: 2, isHome: true }), null);
    assert.equal(boMarketXGA(9, { event: 3, opponentId: 2, isHome: true }), null);
});

test('a double gameweek prices each fixture separately', () => {
    // Keyed on the opponent as well as the event: keying on the event alone
    // would price both of a team's two fixtures off whichever was indexed last.
    const { boSetOdds, boMarketXGA } = panel;
    boSetOdds({
        metadata: { coverage: [{ event: 5, priced: 2, scheduled: 2, complete: true }] },
        matches: [
            { event: 5, homeId: 1, awayId: 2, lambdaHome: 2.0, lambdaAway: 0.8 },
            { event: 5, homeId: 3, awayId: 1, lambdaHome: 1.2, lambdaAway: 1.4 }
        ]
    });
    assert.equal(boMarketXGA(1, { event: 5, opponentId: 2, isHome: true }), 0.8);
    assert.equal(boMarketXGA(1, { event: 5, opponentId: 3, isHome: false }), 1.2);
});

test('summarise separates the venues', () => {
    // Pooling them would hide the whole finding: the home and away errors point
    // in opposite directions and very nearly cancel.
    const rows = [
        { isHome: true, modelXga: 1.0, marketXga: 1.5 },
        { isHome: true, modelXga: 1.0, marketXga: 1.5 },
        { isHome: false, modelXga: 2.0, marketXga: 1.0 },
        { isHome: false, modelXga: 2.0, marketXga: 1.0 }
    ];
    const s = summarise(rows);
    assert.equal(s.samples, 4);
    assert.ok(Math.abs(s.meanRatioHome - 1.5) < 1e-6, 'home sides under-projected to concede');
    assert.ok(Math.abs(s.meanRatioAway - 0.5) < 1e-6, 'away sides over-projected');
    assert.ok(Math.abs(s.venueEffectVsMarket - 3) < 1e-6, 'venue effect three times the market');
    assert.ok(Math.abs(s.meanRatio - 1.0) < 1e-6, 'and the pooled mean says nothing at all');
});

test('summarise survives nothing worth summarising', () => {
    assert.equal(summarise(null), null);
    assert.equal(summarise([]), null);
    assert.equal(summarise([{ isHome: true, modelXga: 0, marketXga: 0 }]), null);
});

test('a gameweek is recorded once, however many times the job runs', () => {
    // Four runs a day would otherwise weight the most-priced round forty times.
    let file = appendRound(null, '2026-09-04T00:00:00Z',
        [{ event: 3, isHome: true, modelXga: 1, marketXga: 1.2 }]);
    assert.equal(file.rounds.length, 1);
    file = appendRound(file, '2026-09-04T12:00:00Z',
        [{ event: 3, isHome: true, modelXga: 1, marketXga: 1.4 }]);
    assert.equal(file.rounds.length, 1, 'same gameweek replaces, does not accumulate');
    assert.equal(file.rounds[0].samples[0].marketXga, 1.4, 'and keeps the newer prices');
    file = appendRound(file, '2026-09-11T00:00:00Z',
        [{ event: 4, isHome: false, modelXga: 2, marketXga: 1.0 }]);
    assert.equal(file.rounds.length, 2);
    assert.deepEqual(file.rounds.map(r => r.event), [3, 4], 'held in gameweek order');
    assert.ok(file.metadata.overall.samples === 2, 'the summary spans every round held');
});

test('the history is bounded to a season', () => {
    let file = null;
    for (let gw = 1; gw <= CALIBRATION_MAX_ROUNDS + 5; gw++) {
        file = appendRound(file, '2026-01-01T00:00:00Z', [{ event: gw, isHome: true, modelXga: 1, marketXga: 1 }]);
    }
    assert.equal(file.rounds.length, CALIBRATION_MAX_ROUNDS);
    assert.equal(file.rounds[file.rounds.length - 1].event, CALIBRATION_MAX_ROUNDS + 5, 'the newest survive');
});

test('the sample is taken from the shipped engine, not a copy of it', () => {
    // The whole point of loading scripts/ into a vm is that the number being
    // measured is the one the site actually serves. If this stops working the
    // calibration silently measures nothing, so it is asserted rather than
    // assumed — the odds job itself only logs the failure and carries on.
    if (!fs.existsSync('data/odds.json')) return;   // nothing to calibrate against yet
    const odds = JSON.parse(fs.readFileSync('data/odds.json', 'utf8'));
    const boot = JSON.parse(fs.readFileSync('data/bootstrap-static.json', 'utf8'));
    const fixtures = JSON.parse(fs.readFileSync('data/fixtures.json', 'utf8'));

    const rows = calibrationSample(odds, boot, fixtures);
    assert.ok(rows, 'the engine loaded and produced a sample');
    assert.equal(rows.length, odds.matches.length * 2, 'both sides of every priced fixture');
    for (const r of rows) {
        assert.ok(r.modelXga > 0.2 && r.modelXga < 4.1, `model xGA is a football number: ${r.modelXga}`);
        assert.ok(r.marketXga > 0.2 && r.marketXga < 6, `market xGA is a football number: ${r.marketXga}`);
    }
    const s = summarise(rows);
    assert.ok(s && s.samples === rows.length);
    assert.ok(s.meanRatioHome != null && s.meanRatioAway != null, 'both venues represented');
});
