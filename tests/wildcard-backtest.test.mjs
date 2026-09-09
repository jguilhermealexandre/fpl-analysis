/* The backtest harness.

   A backtest that is wrong is worse than no backtest, because it produces a
   number and the number gets believed. The two ways this one could lie are the
   two things most of these tests are about: reading the future into a past
   gameweek, and scoring a squad by rules that are not FPL's.

   These are plain node imports rather than a vm sandbox — tools/ is real ESM,
   unlike everything under scripts/. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    maskFixtures, reconstructPlayers, actualsFor, truncatePlayersData,
    pickXI, applyAutoSubs, scoreGameweek,
    greedyFill, baselineSquads, lcg, shuffled, engineSource,
    mean, sd, pearson, spearman, SQUAD_QUOTA, MAX_PER_CLUB
} from '../tools/wildcard-backtest.mjs';

/* ===== no reading the future ===== */

/* The raw players file used to be handed to the engine whole while only the
   reconstructed pool was truncated. Nothing read it, so nothing lied — but
   buildTeamXgData walks playersDetailData.players[].history to build per-gameweek
   team xG, and the moment team strength starts reading that, an untruncated file
   is a backtest quietly scoring itself on gameweeks it should not have seen. */
test('the raw players file is cut off at the build gameweek too', () => {
    const data = { metadata: { lastUpdated: 'x' }, players: [
        { id: 1, team: 3, history: [
            { round: 8, expected_goals: '0.5' },
            { round: 9, expected_goals: '0.7' },
            { round: 10, expected_goals: '9.9' },
            { round: 11, expected_goals: '9.9' }
        ] }
    ] };
    const cut = truncatePlayersData(data, 10);
    assert.deepEqual(cut.players[0].history.map(h => h.round), [8, 9],
        'gameweek 10 is the one being projected and has not happened yet');
    assert.equal(cut.metadata.lastUpdated, 'x', 'everything else survives');
});

test('truncating leaves the season object alone', () => {
    // stateCache holds one season and truncates per gameweek. A mutating cut
    // would shorten the history for every later gameweek as a side effect, and
    // the tool would get quieter and more wrong the further it ran.
    const data = { players: [{ id: 1, team: 3, history: [{ round: 1 }, { round: 2 }, { round: 3 }] }] };
    truncatePlayersData(data, 2);
    assert.equal(data.players[0].history.length, 3);
    assert.equal(truncatePlayersData(data, 3).players[0].history.length, 2,
        'a second cut still sees the full history');
});

/* ===== team news, when there is any ===== */

const BOOT = { elements: [
    { id: 1, web_name: 'Fit', team: 3, element_type: 3, now_cost: 70 },
    { id: 2, web_name: 'Hurt', team: 3, element_type: 4, now_cost: 90 },
    { id: 3, web_name: 'Doubt', team: 3, element_type: 2, now_cost: 50 }
] };
const HIST = { players: [1, 2, 3].map(id => ({ id, history: [
    { round: 1, minutes: 90, value: 70, total_points: 5 },
    { round: 2, minutes: 90, value: 70, total_points: 3 }
] })) };
const byId = ps => Object.fromEntries(ps.map(p => [p.id, p]));

test('without a snapshot every player is still offered as fit', () => {
    const p = byId(reconstructPlayers(BOOT, HIST, 3, {}));
    assert.equal(p[2].status, 'a', 'this is how the harness ran before the snapshots existed');
    assert.equal(p[2].chanceNextRound, null);
    assert.equal(p[2].penaltiesOrder, null);
});

test('team news from before kickoff reaches the player', () => {
    const avail = { 2: { s: 'i' }, 3: { s: 'd', c: 25 }, 1: { p: 1 } };
    const p = byId(reconstructPlayers(BOOT, HIST, 3, {}, avail));
    assert.equal(p[2].status, 'i', 'injured — the projection returns a flat zero for this');
    assert.equal(p[3].status, 'd');
    assert.equal(p[3].chanceNextRound, 25, 'the minutes model scales by this');
    assert.equal(p[1].penaltiesOrder, 1);
});

test('a player absent from the snapshot is available, not unknown', () => {
    // The extractor only records departures from "fit, no set-piece duty", so
    // absence is a positive statement and must not read as missing data.
    const p = byId(reconstructPlayers(BOOT, HIST, 3, {}, { 2: { s: 'i' } }));
    assert.equal(p[1].status, 'a');
    assert.equal(p[1].chanceNextRound, null);
});

test('a zero chance of playing survives, rather than reading as absent', () => {
    const p = byId(reconstructPlayers(BOOT, HIST, 3, {}, { 3: { s: 'd', c: 0 } }));
    assert.equal(p[3].chanceNextRound, 0, '0 is a real answer and must not fall back to null');
});

test('a gameweek before any history leaves nothing to read', () => {
    const data = { players: [{ id: 1, history: [{ round: 5 }, { round: 6 }] }] };
    assert.deepEqual(truncatePlayersData(data, 1).players[0].history, []);
});

test('fixtures from the build gameweek on go back to unplayed', () => {
    const fx = [
        { event: 5, finished: true, finished_provisional: true, started: true, team_h_score: 2, team_a_score: 1 },
        { event: 6, finished: true, finished_provisional: true, started: true, team_h_score: 0, team_a_score: 3 },
        { event: 7, finished: true, finished_provisional: true, started: true, team_h_score: 1, team_a_score: 1 }
    ];
    const masked = maskFixtures(fx, 6);
    assert.equal(masked[0].finished_provisional, true, 'gameweek 5 had happened and stays happened');
    assert.equal(masked[0].team_h_score, 2);
    for (const f of masked.slice(1)) {
        assert.equal(f.finished_provisional, false);
        assert.equal(f.finished, false);
        assert.equal(f.started, false);
        assert.equal(f.team_h_score, null, 'a scoreline that had not been played cannot be visible');
        assert.equal(f.team_a_score, null);
    }
});

test('a player is rebuilt from the rounds before the build gameweek and no others', () => {
    const bootData = { elements: [{ id: 1, web_name: 'A', team: 3, element_type: 4, now_cost: 70 }] };
    const playersData = { players: [{ id: 1, history: [
        { round: 1, minutes: 90, total_points: 2, goals_scored: 0, expected_goals: '0.10', starts: 1, value: 70, selected: 1000 },
        { round: 2, minutes: 90, total_points: 9, goals_scored: 1, expected_goals: '0.60', starts: 1, value: 71, selected: 2000 },
        // The build gameweek itself: its price is fair game, its return is not.
        { round: 3, minutes: 90, total_points: 13, goals_scored: 2, expected_goals: '0.90', starts: 1, value: 72, selected: 5000 },
        { round: 4, minutes: 90, total_points: 20, goals_scored: 3, expected_goals: '1.50', starts: 1, value: 75, selected: 9000 }
    ] }] };
    const [p] = reconstructPlayers(bootData, playersData, 3, { 3: { short_name: 'XYZ' } });

    assert.equal(p.minutes, 180, 'two rounds of minutes, not four');
    assert.equal(p.points, 11, 'the build gameweek and everything after it is invisible');
    assert.equal(p.goals, 1);
    assert.ok(Math.abs(p.xG - 0.70) < 1e-9);
    assert.equal(p.starts, 2);
    assert.equal(p.ppg, 5.5, 'points per appearance, not per gameweek');
    assert.equal(p.price, 7.2, 'the price the game recorded for the round being built, which is known before kickoff');
    assert.equal(p.team, 'XYZ');
    assert.equal(p.position, 4);
    assert.equal(p.pos, 4, 'both spellings, per normalisePlayerShape');
    assert.equal(p.penaltiesOrder, null, 'penalty duty is only stored as of now, so it is not used');
    assert.equal(p.epNext, 0);
});

test('form stands in as the last four appearances', () => {
    const bootData = { elements: [{ id: 1, web_name: 'A', team: 1, element_type: 3, now_cost: 50 }] };
    const rows = [2, 4, 6, 8, 10, 12].map((pts, i) => ({ round: i + 1, minutes: 90, total_points: pts, value: 50 }));
    const playersData = { players: [{ id: 1, history: rows }] };
    const [p] = reconstructPlayers(bootData, playersData, 6, { 1: { short_name: 'T' } });
    // Rounds 1-5 are visible; the last four of those are 4, 6, 8, 10.
    assert.equal(p.form, 7);
});

test('a double gameweek counts both matches', () => {
    const playersData = { players: [{ id: 1, history: [
        { round: 7, minutes: 90, total_points: 6 },
        { round: 7, minutes: 85, total_points: 9 }
    ] }] };
    const a = actualsFor(playersData, 7);
    assert.equal(a.get(1).points, 15, 'a season total would hide the second fixture entirely');
    assert.equal(a.get(1).minutes, 175);
});

test('a blank gameweek is absent, not zero', () => {
    const playersData = { players: [{ id: 1, history: [{ round: 7, minutes: 0, total_points: 0 }] }] };
    assert.equal(actualsFor(playersData, 8).has(1), false, 'no row means no fixture');
    assert.equal(actualsFor(playersData, 7).get(1).minutes, 0, 'a row with no minutes is an unused substitute');
});

/* ===== FPL scoring ===== */

const squad15 = (scores) => scores.map((s, i) => ({
    id: i + 1, position: [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4][i],
    teamId: 1 + (i % 8), price: 5, _s: s
}));

test('the eleven is the best legal shape, and the bench is what is left', () => {
    const squad = squad15([9, 1, 8, 7, 6, 2, 1, 9, 8, 7, 3, 2, 9, 8, 1]);
    const picked = pickXI(squad, p => p._s);
    assert.equal(picked.xi.length, 11);
    assert.equal(picked.bench.length, 4);
    const n = pos => picked.xi.filter(p => p.position === pos).length;
    assert.equal(n(1), 1, 'exactly one keeper plays');
    assert.ok(n(2) >= 3 && n(2) <= 5);
    assert.ok(n(3) >= 2 && n(3) <= 5);
    assert.ok(n(4) >= 1 && n(4) <= 3);
    // The reserve keeper is last on the bench, as FPL orders it.
    assert.equal(picked.bench[picked.bench.length - 1].position, 1);
});

test('a starter who did not play is replaced by the first bench man who did', () => {
    const xi = [
        { id: 1, position: 1 }, { id: 2, position: 2 }, { id: 3, position: 2 }, { id: 4, position: 2 },
        { id: 5, position: 3 }, { id: 6, position: 3 }, { id: 7, position: 3 }, { id: 8, position: 3 },
        { id: 9, position: 4 }, { id: 10, position: 4 }, { id: 11, position: 4 }
    ];
    const bench = [{ id: 12, position: 3 }, { id: 13, position: 2 }, { id: 14, position: 4 }, { id: 15, position: 1 }];
    // Number 5 (a midfielder) did not play; 12 is first off the bench and did.
    const mins = { 5: 0 };
    const out = applyAutoSubs(xi, bench, p => (mins[p.id] !== undefined ? mins[p.id] : 90));
    assert.ok(out.some(p => p.id === 12), 'the first eligible substitute comes on');
    assert.ok(!out.some(p => p.id === 5), 'and the absentee goes off');
    assert.equal(out.length, 11);
});

test('a keeper is only ever replaced by a keeper', () => {
    const xi = [
        { id: 1, position: 1 }, { id: 2, position: 2 }, { id: 3, position: 2 }, { id: 4, position: 2 },
        { id: 5, position: 3 }, { id: 6, position: 3 }, { id: 7, position: 3 }, { id: 8, position: 3 },
        { id: 9, position: 4 }, { id: 10, position: 4 }, { id: 11, position: 4 }
    ];
    const bench = [{ id: 12, position: 3 }, { id: 13, position: 2 }, { id: 14, position: 4 }, { id: 15, position: 1 }];
    const out = applyAutoSubs(xi, bench, p => (p.id === 1 ? 0 : 90));
    assert.ok(out.some(p => p.id === 15), 'the reserve keeper comes on despite being last on the bench');
    assert.ok(!out.some(p => p.id === 12), 'an outfielder cannot take the gloves');
    assert.equal(out.filter(p => p.position === 1).length, 1);
});

test('a substitution that would leave an illegal shape does not happen', () => {
    // Three at the back is the minimum, so losing a defender cannot be covered
    // by a midfielder — only by the defender on the bench.
    const xi = [
        { id: 1, position: 1 }, { id: 2, position: 2 }, { id: 3, position: 2 }, { id: 4, position: 2 },
        { id: 5, position: 3 }, { id: 6, position: 3 }, { id: 7, position: 3 }, { id: 8, position: 3 },
        { id: 9, position: 4 }, { id: 10, position: 4 }, { id: 11, position: 4 }
    ];
    const bench = [{ id: 12, position: 3 }, { id: 13, position: 2 }, { id: 14, position: 4 }, { id: 15, position: 1 }];
    const out = applyAutoSubs(xi, bench, p => (p.id === 2 ? 0 : 90));
    assert.ok(out.some(p => p.id === 13), 'the bench defender comes on');
    assert.ok(!out.some(p => p.id === 12), 'the midfielder ahead of him in the order cannot, it would leave two at the back');
    assert.equal(out.filter(p => p.position === 2).length, 3);
});

test('the captain doubles, and the vice takes over when he does not play', () => {
    const squad = squad15([9, 1, 8, 7, 6, 2, 1, 9, 8, 7, 3, 2, 20, 8, 1]);
    const scoreOf = p => p._s;
    // Everyone plays: the highest projected man in the eleven is captain.
    const all = new Map(squad.map(p => [p.id, { points: 2, minutes: 90 }]));
    const captain = squad.find(p => p._s === 20);
    all.set(captain.id, { points: 10, minutes: 90 });
    const a = scoreGameweek(squad, scoreOf, all);
    assert.equal(a.captainId, captain.id);
    const withoutArmband = pickXI(squad, scoreOf).xi.reduce((s, p) => s + all.get(p.id).points, 0);
    assert.equal(a.points, withoutArmband + 10, 'the captain is counted twice');

    // Captain injured on the morning: the armband falls to the vice.
    all.set(captain.id, { points: 0, minutes: 0 });
    const b = scoreGameweek(squad, scoreOf, all);
    assert.notEqual(b.captainId, captain.id);
    assert.ok(b.captainId != null, 'somebody wears it');
});

test('nobody is captained when neither the captain nor the vice plays', () => {
    const squad = squad15([9, 1, 8, 7, 6, 2, 1, 9, 8, 7, 3, 2, 20, 19, 1]);
    const scoreOf = p => p._s;
    const ranked = pickXI(squad, scoreOf).xi.slice().sort((a, b) => scoreOf(b) - scoreOf(a));
    const all = new Map(squad.map(p => [p.id, { points: 2, minutes: 90 }]));
    all.set(ranked[0].id, { points: 0, minutes: 0 });
    all.set(ranked[1].id, { points: 0, minutes: 0 });
    assert.equal(scoreGameweek(squad, scoreOf, all).captainId, null);
});

/* ===== baselines ===== */

function pool(n = 200) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const position = [1, 2, 2, 3, 3, 4][i % 6];
        out.push({
            id: i + 1, position, pos: position,
            teamId: 1 + (i % 20),
            price: 4.0 + ((i * 7) % 90) / 10,
            points: (i * 13) % 140,
            form: (i * 5) % 9,
            selected: (i * 31) % 900000
        });
    }
    return out;
}

test('a greedy fill is a legal squad or nothing at all', () => {
    const p = pool();
    for (const order of [
        p.slice().sort((a, b) => b.points - a.points),
        p.slice().sort((a, b) => b.price - a.price),
        p.slice().sort((a, b) => b.selected - a.selected)
    ]) {
        const squad = greedyFill(p, order, 100.0);
        assert.ok(squad, 'a legal fifteen exists at this budget and has to be found');
        const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
        squad.forEach(x => counts[x.position]++);
        assert.deepEqual([counts[1], counts[2], counts[3], counts[4]],
            [SQUAD_QUOTA[1], SQUAD_QUOTA[2], SQUAD_QUOTA[3], SQUAD_QUOTA[4]]);
        assert.equal(new Set(squad.map(x => x.id)).size, 15);
        const clubs = {};
        squad.forEach(x => { clubs[x.teamId] = (clubs[x.teamId] || 0) + 1; });
        assert.ok(Math.max(...Object.values(clubs)) <= MAX_PER_CLUB);
        assert.ok(squad.reduce((s, x) => s + x.price, 0) <= 100.0 + 1e-9);
    }
});

test('the most expensive order still fills, which the loose reserve could not', () => {
    /* The regression this exists for: reserving one cheapest price per empty
       slot rather than the k cheapest is only a lower bound, so a greedy walk
       down a dear list committed money it did not have and came back with
       nothing. It made the points-chasing baseline vanish at five gameweeks of
       the season and, because a missing baseline was being averaged as zero,
       turned into a hundred-point margin in the model's favour. */
    const p = pool();
    const dearest = p.slice().sort((a, b) => b.price - a.price);
    assert.ok(greedyFill(p, dearest, 84.0), 'a tight budget and the worst possible order still has to produce a squad');
    assert.equal(greedyFill(p, dearest, 30.0), null, 'and an impossible budget produces nothing rather than a lie');
});

test('every baseline is built, or the comparison is against a hole', () => {
    const b = baselineSquads(pool(), 100.0, 5);
    for (const k of ['points', 'value', 'template', 'form']) {
        assert.ok(b[k], `${k} baseline`);
        assert.equal(b[k].length, 15);
    }
    assert.equal(b.random.length, 5);
});

test('the random pool is deterministic, so a change in the result is a real change', () => {
    const p = pool();
    const a = baselineSquads(p, 100.0, 3).random.map(s => s.map(x => x.id).join(','));
    const b = baselineSquads(p, 100.0, 3).random.map(s => s.map(x => x.id).join(','));
    assert.deepEqual(a, b);
    const r1 = lcg(1), r2 = lcg(1);
    assert.deepEqual(shuffled([1, 2, 3, 4, 5], r1), shuffled([1, 2, 3, 4, 5], r2));
});

/* ===== sweeps ===== */

test('a swept value actually reaches the engine, or the sweep is a lie', () => {
    /* The regression this exists for: the sweep used to assign the constant
       through a helper on the engine object. Those constants live in the
       evaluated script's own scope rather than on the global object, so the
       assignment reached a different binding, the surrounding catch swallowed
       nothing because nothing threw, and every value in the sweep returned an
       identical total — which reads exactly like "the model does not depend on
       this constant". It is the most expensive way for a tuning tool to be
       wrong, because the output looks like a finding. */
    const src = engineSource(process.cwd(), { WC_BENCH_WEIGHT: 0.42 });
    assert.ok(/\bvar WC_BENCH_WEIGHT = 0\.42;/.test(src), 'the value is in the source the engine is built from');
    assert.ok(!/\bconst WC_BENCH_WEIGHT\b/.test(src), 'and no const survives to shadow it');

    const plain = engineSource(process.cwd());
    assert.ok(/\bvar WC_BENCH_WEIGHT = 0\.12;/.test(plain), 'without an override the shipped value stands');

    assert.throws(() => engineSource(process.cwd(), { WC_NOT_A_REAL_CONSTANT: 1 }),
        /not a constant/, 'an unknown name has to be an error rather than a silent no-op');
});

/* ===== statistics ===== */

test('the statistics are the statistics', () => {
    assert.equal(mean([1, 2, 3]), 2);
    assert.equal(sd([2, 2, 2]), 0);
    assert.ok(Math.abs(sd([1, 2, 3, 4]) - 1.2909944) < 1e-6);
    assert.ok(Math.abs(pearson([1, 2, 3], [2, 4, 6]) - 1) < 1e-9);
    assert.ok(Math.abs(pearson([1, 2, 3], [6, 4, 2]) + 1) < 1e-9);
    // Monotone but bent: rank correlation sees it, linear correlation does not.
    assert.ok(Math.abs(spearman([1, 2, 3, 4], [1, 4, 9, 16]) - 1) < 1e-9);
    assert.ok(pearson([1, 2, 3, 4], [1, 4, 9, 16]) < 1);
    assert.equal(pearson([1], [1]), 0, 'one point is not a correlation');
});
