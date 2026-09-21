/* Marking the homework, checked against arithmetic done by hand.

   The statistics here are the ones an accuracy page will quote, so they are
   tested against values worked out on paper rather than against whatever the
   code happened to return the first time. The methodology choices — blanks
   excluded, populations taken from the prediction and never the result, doubles
   summed — each get a test of their own, because every one of them is a way the
   published number could quietly become flattering nonsense.

   No test here writes anything. The grader is pure: main() does the writing,
   and it is not called.
*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { errorStats, ranks, spearman, actualsFor, gradeRound, gradeAll, gradeRising } from '../tools/grade-predictions.mjs';
import { REPO_ROOT } from '../tools/xp-engine-host.mjs';

// ---- the arithmetic

test('error statistics match the sums done by hand', () => {
    // predicted 3,2,0 against actual 1,2,4 → errors +2, 0, -4
    const s = errorStats([[3, 1], [2, 2], [0, 4]]);
    assert.equal(s.n, 3);
    assert.equal(s.mae, 2);                       // (2 + 0 + 4) / 3
    assert.equal(s.rmse, 2.582);                  // sqrt((4 + 0 + 16) / 3)
    assert.equal(s.bias, -0.667);                 // (2 + 0 - 4) / 3, so: under-predicting
});

test('bias is signed, and positive means we said more than happened', () => {
    assert.equal(errorStats([[5, 2]]).bias, 3);
    assert.equal(errorStats([[1, 6]]).bias, -5);
});

test('an empty population reports nothing rather than zero', () => {
    const s = errorStats([]);
    assert.equal(s.n, 0);
    assert.equal(s.mae, null, 'zero error on no data would read as a perfect model');
});

test('ties share an averaged rank', () => {
    // A third of any FPL round is tied on 0, 1 or 2 points. Breaking those ties
    // by sort order would manufacture agreement out of nothing.
    assert.deepEqual(ranks([1, 2, 2, 3]), [1, 2.5, 2.5, 4]);
    assert.deepEqual(ranks([5, 5, 5]), [2, 2, 2]);
});

test('rank correlation runs from agreement to reversal', () => {
    assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
    assert.equal(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);
    assert.equal(spearman([1, 2], [1, 2]), null, 'two points is not a correlation');
});

// ---- joining to what happened

const hist = (id, rows) => ({ id, history: rows });

test('a double gameweek sums both matches', () => {
    /* The archived prediction covers both fixtures, so the result has to. Taking
       the first match would grade a two-match projection against one and call
       the model wildly over-confident twice a season. */
    const data = { players: [hist(1, [
        { round: 6, total_points: 7, minutes: 90 },
        { round: 6, total_points: 4, minutes: 75 },
        { round: 7, total_points: 2, minutes: 90 }
    ])] };
    const a = actualsFor(data, 6).get(1);
    assert.equal(a.points, 11);
    assert.equal(a.minutes, 165);
    assert.equal(a.fixtures, 2);
});

test('a player with no row for that round is absent, not zero', () => {
    const data = { players: [hist(1, [{ round: 7, total_points: 5, minutes: 90 }])] };
    assert.equal(actualsFor(data, 6).has(1), false,
        'absent and zero mean different things — one is a blank, the other a gap in the feed');
});

// ---- the methodology

const player = (id, over = {}) => ({
    id, pos: 3, sel: 10, pStart: 0.9,
    fx: [{ o: 1, h: 1, d: 3 }],
    xp: 4, ep: 4, ppg: 4, form: 4, ...over
});
const snapshotOf = players => ({ gw: 6, deadlineTime: '2026-10-10T10:00:00Z', takenAt: '2026-10-10T09:00:00Z', players });
const actualsOf = pairs => new Map(pairs.map(([id, points]) => [id, { points, minutes: 90, fixtures: 1 }]));

test('blanks are excluded from scoring and counted instead', () => {
    /* Predicting zero for a player with no fixture is arithmetic, not
       forecasting. Scoring it pays the model for a certainty and punishes the
       season-average baseline, which does not know about blanks. */
    const snap = snapshotOf([
        player(1), player(2), player(3),
        { ...player(4), fx: [], xp: 0 }
    ]);
    const g = gradeRound(snap, actualsOf([[1, 4], [2, 4], [3, 4], [4, 0]]));
    assert.equal(g.counts.graded, 3);
    assert.equal(g.counts.blanksExcluded, 1);
    assert.equal(g.populations.all.n, 3);
});

test('populations come from the prediction, never from the result', () => {
    /* The player below was written off before the deadline and then played the
       full ninety and hauled. He must stay out of "starters": letting the
       outcome choose the population is hindsight, and it is the usual way an
       accuracy page flatters itself. */
    const snap = snapshotOf([
        player(1, { pStart: 0.9 }), player(2, { pStart: 0.9 }), player(3, { pStart: 0.9 }),
        player(4, { pStart: 0.1, xp: 0.5 })
    ]);
    const g = gradeRound(snap, actualsOf([[1, 4], [2, 4], [3, 4], [4, 13]]));
    assert.equal(g.counts.graded, 4);
    assert.equal(g.populations.starters.n, 3, 'the surprise hauler is not retroactively a starter');
    assert.equal(g.populations.all.n, 4, 'but he is still scored');
});

test('the owned population is the deadline ownership, not the result', () => {
    const snap = snapshotOf([
        player(1, { sel: 40 }), player(2, { sel: 30 }), player(3, { sel: 20 }), player(4, { sel: 0.2 })
    ]);
    const g = gradeRound(snap, actualsOf([[1, 4], [2, 4], [3, 4], [4, 20]]));
    assert.equal(g.populations.owned.n, 3);
});

test('a round missing most of its results is skipped rather than published', () => {
    const snap = snapshotOf([player(1), player(2), player(3), player(4), player(5)]);
    const g = gradeRound(snap, actualsOf([[1, 4]]));      // 1 of 5 = 20% coverage
    assert.ok(g.skipped, 'a fifth of a round is not a round');
    assert.match(g.skipped, /1 of 5/);
});

test('every baseline is scored on the same rows, and the model is compared to each', () => {
    const snap = snapshotOf([
        player(1, { xp: 5, ep: 2, ppg: 2, form: 2 }),
        player(2, { xp: 5, ep: 2, ppg: 2, form: 2 }),
        player(3, { xp: 5, ep: 2, ppg: 2, form: 2 })
    ]);
    const g = gradeRound(snap, actualsOf([[1, 5], [2, 5], [3, 5]]));
    const all = g.populations.all;
    assert.equal(all.rmse, 0, 'the model nailed it');
    assert.equal(all.baselines.ep.rmse, 3);
    assert.equal(all.baselines.ep.modelBeatsBy, 1, 'beating a baseline outright is a skill of 1');
    for (const k of ['ep', 'ppg', 'form']) {
        assert.equal(all.baselines[k].n, 3, `${k} must be scored on the same rows`);
    }
});

// ---- the whole archive

const EVENTS = [
    { id: 5, finished: true, data_checked: true },
    { id: 6, finished: true, data_checked: false },
    { id: 7, finished: false, data_checked: false }
];

test('only finished, data-checked rounds are graded', () => {
    /* Bonus points land after the final whistle and appeals after that. Grading
       a round before FPL has checked it records a number that then changes. */
    const out = gradeAll({
        boot: { events: EVENTS },
        playersData: { players: [1, 2, 3].map(id =>
            hist(id, [5, 6, 7].map(round => ({ round, total_points: 4, minutes: 90 })))) },
        snapshots: [snapshotOf([player(1), player(2), player(3)]),
            { ...snapshotOf([player(1), player(2), player(3)]), gw: 5 },
            { ...snapshotOf([player(1), player(2), player(3)]), gw: 7 }]
    });
    assert.deepEqual(out.metadata.gameweeksGraded, [5]);
    assert.equal(out.metadata.skipped.length, 2);
    assert.match(out.metadata.skipped[0].why, /not finished and data-checked/);
});

test('nothing to grade yet is a real answer, not an empty model', () => {
    const out = gradeAll({ boot: { events: EVENTS }, playersData: { players: [] }, snapshots: [] });
    assert.deepEqual(out.metadata.gameweeksGraded, []);
    assert.equal(out.metadata.playerFixturesGraded, 0);
    assert.deepEqual(out.overall.populations, {}, 'no rounds must not produce a score of zero');
});

test('the published file carries the method, and leaves per-player rows out', () => {
    const out = gradeAll({
        boot: { events: EVENTS },
        playersData: { players: [1, 2, 3].map(id => hist(id, [{ round: 5, total_points: 4, minutes: 90 }])) },
        snapshots: [{ ...snapshotOf([player(1), player(2), player(3)]), gw: 5 }]
    });
    assert.ok(out.metadata.note.includes('never from the result'));
    assert.ok(out.metadata.populations.starters, 'each population must say what it means');
    assert.ok(out.metadata.baselines.ep, 'each baseline must say what it is');
    assert.equal(out.rounds[0].rows, undefined, 'per-player rows stay out of the published file');
    assert.ok(JSON.parse(JSON.stringify(out)), 'and the whole thing survives serialisation');
});

// ---- against the real results file

test('the join finds real players in the real results', (t) => {
    /* Synthetic predictions, real actuals. This proves the join — ids line up,
       rounds line up, coverage is high — without pretending to measure
       accuracy: nothing here was predicted before the fact, so no number this
       produces is publishable, and none of it is written anywhere. */
    const boot = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/bootstrap-static.json'), 'utf8'));
    const playersData = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/players-data.json'), 'utf8'));

    const done = boot.events.filter(e => e.finished && e.data_checked).map(e => e.id);
    if (!done.length) return t.skip('no finished, data-checked round yet — preseason');
    const gw = done[done.length - 1];

    const played = playersData.players.filter(p => (p.history || []).some(h => h.round === gw));
    assert.ok(played.length > 300, `only ${played.length} players have a GW${gw} result`);

    const snap = {
        ...snapshotOf(played.map(p => player(p.id, { pos: 3, xp: 2.5, ep: 2.5, ppg: 2.5, form: 2.5 }))),
        gw
    };
    const g = gradeRound(snap, actualsFor(playersData, gw));

    assert.ok(!g.skipped, `coverage too low against real data: ${g.skipped}`);
    assert.equal(g.counts.notFoundInResults, 0, 'every player built from the results should be found in them');
    assert.equal(g.counts.graded, played.length);
    assert.ok(Number.isFinite(g.populations.all.rmse), 'RMSE against real scores must be a number');
    assert.ok(g.populations.all.rmse > 0, 'a flat 2.5 prediction cannot be exactly right');
    assert.ok(g.calibration.length > 0, 'calibration buckets should fill');
});

/* ---- Rising Form: grading a ranking rather than a number ----------------- */

/* The board claims an ORDER, not a points total, so RMSE cannot touch it. What
   it claims is that these players, in this order, are the ones worth buying —
   so the tests are whether the named players beat the ones who were not named,
   and whether the board's own order tracks what happened. */

const risingSnap = (rising) => ({ gw: 7, rising });
const acts = (pairs) => new Map(pairs.map(([id, points]) => [id, { points, minutes: 90, fixtures: 1 }]));
const boardRow = (id, rank, over = {}) => ({ id, rank, score: 60 - rank, sel: 2, fdrNear: 2.5, ...over });

test('the board is measured against everyone it did not name', () => {
    const snap = risingSnap([boardRow(1, 1), boardRow(2, 2)]);
    // 1 and 2 are on the board; 3 and 4 are the field.
    const r = gradeRising(snap, acts([[1, 10], [2, 8], [3, 2], [4, 0]]));
    assert.equal(r.counts.graded, 2);
    assert.equal(r.counts.field, 2, 'the field is the rest of the game, premiums included');
    assert.equal(r.board.meanPoints, 9);
    assert.equal(r.field.meanPoints, 1);
});

test('a player on the board with no fixture is not counted as a zero', () => {
    // Predicting nothing for a blank is arithmetic, not forecasting — the same
    // rule the xP grading uses.
    const snap = risingSnap([boardRow(1, 1), boardRow(2, 2)]);
    const r = gradeRising(snap, acts([[1, 6]]));
    assert.equal(r.counts.graded, 1);
    assert.equal(r.board.meanPoints, 6);
});

test('ownership is reported beside the points, because the board is tilted', () => {
    /* A board that matches the field at a third of the ownership has done
       something; one that matches it at the same ownership has not. Reading
       meanPoints alone would call both of them a failure. */
    const snap = risingSnap([boardRow(1, 1, { sel: 0.5 }), boardRow(2, 2, { sel: 3.5 })]);
    const r = gradeRising(snap, acts([[1, 5], [2, 5], [3, 5]]));
    assert.equal(r.board.meanOwnership, 2);
});

test('the rank correlation is signed so that positive means the order worked', () => {
    const good = gradeRising(risingSnap([boardRow(1, 1), boardRow(2, 2), boardRow(3, 3)]),
        acts([[1, 12], [2, 6], [3, 1]]));
    assert.ok(good.rankCorrelation > 0.9, 'best-first order that held up');

    const backwards = gradeRising(risingSnap([boardRow(1, 1), boardRow(2, 2), boardRow(3, 3)]),
        acts([[1, 1], [2, 6], [3, 12]]));
    assert.ok(backwards.rankCorrelation < -0.9, 'exactly wrong reads as exactly wrong');
});

test('the return rate counts returns, not appearances', () => {
    const r = gradeRising(risingSnap([boardRow(1, 1), boardRow(2, 2), boardRow(3, 3), boardRow(4, 4)]),
        acts([[1, 9], [2, 6], [3, 5], [4, 2]]));
    assert.equal(r.board.returnRate, 50, 'two of four reached six points');
});

test('no board is null rather than a set of zeroes', () => {
    // A snapshot written before the board existed, or one where the engine
    // threw. Neither is a reading of zero.
    assert.equal(gradeRising({ gw: 7 }, acts([[1, 5]])), null);
    assert.equal(gradeRising(risingSnap([]), acts([[1, 5]])), null);
});

test('a board nobody played is skipped, not scored', () => {
    const r = gradeRising(risingSnap([boardRow(1, 1)]), acts([[9, 5]]));
    assert.equal(r.skipped, 'nobody on the board had a fixture');
});

test('gradeAll pools the board by player-round and says the sample is thin', () => {
    const boot = { events: [{ id: 7, finished: true, data_checked: true }] };
    const playersData = { players: [
        { id: 1, history: [{ round: 7, total_points: 10, minutes: 90 }] },
        { id: 2, history: [{ round: 7, total_points: 2, minutes: 90 }] },
        { id: 3, history: [{ round: 7, total_points: 4, minutes: 90 }] }
    ] };
    const snapshots = [{
        gw: 7, deadlineTime: '2026-10-10T10:00:00Z', takenAt: '2026-10-10T08:00:00Z',
        players: [
            { id: 1, pos: 3, sel: 1, pStart: 0.9, fx: [{ o: 2, h: 1, d: 3 }], xp: 5, ep: 4, ppg: 4, form: 4 },
            { id: 2, pos: 3, sel: 1, pStart: 0.9, fx: [{ o: 2, h: 1, d: 3 }], xp: 3, ep: 3, ppg: 3, form: 3 },
            { id: 3, pos: 3, sel: 1, pStart: 0.9, fx: [{ o: 2, h: 1, d: 3 }], xp: 3, ep: 3, ppg: 3, form: 3 }
        ],
        rising: [boardRow(1, 1), boardRow(2, 2)]
    }];
    const out = gradeAll({ boot, playersData, snapshots });
    assert.ok(out.overall.rising, 'the season view carries the board');
    assert.equal(out.overall.rising.playerRounds, 2);
    assert.equal(out.overall.rising.board.meanPoints, 6);   // (10 + 2) / 2
    assert.equal(out.overall.rising.field.meanPoints, 4);   // player 3 alone
    assert.match(out.overall.rising.note, /not significant yet|Nothing here is significant/);
});
