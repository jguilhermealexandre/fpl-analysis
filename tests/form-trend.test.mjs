/* Rising form: who is trending up, is pickable now, and is not already owned.

   Two families of bug live here. The first is a confident wrong answer — a score
   of 0 for a player nobody has enough season to measure, which reads as
   "measured, and flat". The second is subtler and is what this file was largely
   rewritten for: a model whose pillars cannot fire, whose fixture term points
   backwards, and whose minutes gate admits substitutes. None of those throw.
   They just produce a plausible board that recommends the wrong players, which
   is why most of what follows asserts on ORDER and on which signals fired,
   rather than on any single number. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, browserStubs } from './helpers/load.mjs';

const F = 'scripts/form-trend.js';

/* The engine reads its team model off the page through typeof guards, so each
   case supplies its own. Loading the whole file rather than lifting one function
   keeps the pillars wired to each other the way they are in a browser. */
const engine = (stubs = {}) => loadScript(F, browserStubs({
    teamAnalysis: {}, allFixtures: [], ...stubs
}));

const base = engine();

// Five matches: two to compare against, three recent. A midfielder whose
// returns and whose chances both moved.
const row = (over = {}) => ({
    minutes: 90, total_points: 2, starts: 1,
    expected_goal_involvements: 0.1, creativity: 10, threat: 10,
    expected_goals: 0.05, expected_assists: 0.05,
    expected_goals_conceded: 1.2, bps: 15, saves: 0, ...over
});
const hot = (over = {}) => row({
    total_points: 6, expected_goal_involvements: 0.5,
    creativity: 30, threat: 30, expected_goals: 0.3, expected_assists: 0.2, ...over
});

const player = (over = {}) => ({
    id: 1, name: 'Test', position: 3, teamId: 1, status: 'a', selectedBy: 2,
    history: [row(), row(), hot(), hot(), hot()],
    fixtures: { next3: [{ difficulty: 3 }, { difficulty: 3 }, { difficulty: 3 }] },
    teamScores: null,
    ...over
});

/* ---- can we tell at all ---- */

test('a short season is not a score of zero', () => {
    const r = base.risingFormFor(player({ history: [row(), row(), hot()] }));
    assert.equal(r.measurable, false);
    assert.equal(r.score, null, 'null, not 0');
    assert.match(r.note, /3 of the 5 matches/);
});

test('an unavailable player gets no forward-looking reading', () => {
    const r = base.risingFormFor(player({ status: 'i' }));
    assert.equal(r.measurable, false);
    assert.match(r.note, /Not currently available/);
});

test('a flagged doubt is not a transfer to plan around', () => {
    const r = base.risingFormFor(player({ chanceNextRound: 25 }));
    assert.equal(r.measurable, false, 'not a reading we decline to take, one there is no point taking');
    assert.match(r.note, /25% to play/);
    assert.equal(r.score, null);
});

/* ---- pickable, not merely in form ---- */

test('a substitute in good form is still a substitute', () => {
    /* The old gate was 180 minutes across five matches — 36 a game — so cameo
       players cleared it, and a separate bonus then paid them for their minutes
       rising off that low base. Twenty-two of the fifty-four players on the
       board averaged under an hour. */
    const sub = player({ history: [row({ minutes: 20 }), row({ minutes: 20 }),
        hot({ minutes: 40 }), hot({ minutes: 35 }), hot({ minutes: 45 })] });
    const r = base.risingFormFor(sub);
    assert.equal(r.score, null);
    assert.match(r.note, /minutes a game/);
});

test('coming off the bench three times is not a run of starts', () => {
    const r = base.risingFormFor(player({
        history: [row(), row(), hot({ starts: 0 }), hot({ starts: 0 }), hot({ minutes: 90 })]
    }));
    assert.match(r.note, /Started 1 of his last 3/);
});

test('a rise that is still a small number is not a return', () => {
    const r = base.risingFormFor(player({
        history: [row({ total_points: 0 }), row({ total_points: 0 }),
            hot({ total_points: 2 }), hot({ total_points: 2 }), hot({ total_points: 2 })]
    }));
    assert.match(r.note, /still small/);
});

test('measured and not rising is different from not measured', () => {
    const flat = base.risingFormFor(player({ history: [hot(), hot(), hot(), hot(), hot()] }));
    assert.equal(flat.measurable, true, 'we could measure him');
    assert.equal(flat.score, null, 'he is simply not rising');
    assert.match(flat.note, /Not running ahead of himself/);
});

test('an attacker scoring without chances is not rising', () => {
    const r = base.risingFormFor(player({
        history: [row(), row(),
            hot({ expected_goal_involvements: 0 }), hot({ expected_goal_involvements: 0 }),
            hot({ expected_goal_involvements: 0 })]
    }));
    assert.equal(r.measurable, true);
    assert.equal(r.score, null);
    assert.match(r.note, /chances are not/);
});

/* ---- the pillars that used to be dark ---- */

const withTeam = engine({
    getTeamSeasonXg: () => ({ games: 5, xGpg: 1.0, xGCpg: 1.2,
        totalXg: 5, totalXgc: 6, totalGoals: 2, totalConceded: 8 }),
    getTeamXgWindow: () => ({ games: 3, xGpg: 1.5, xGCpg: 0.9,
        totalXg: 4.5, totalXgc: 2.7, totalGoals: 2, totalConceded: 3 })
});

test('the team pillars fire from five matches, not ten', () => {
    /* The bug worth a test of its own. These wanted a club to have played ten
       before they would say anything, so through the first ten gameweeks of
       every season they scored 0 of 667 players — not rarely, never. The window
       is disjoint now, so it does not need a season long enough to dilute the
       overlap. */
    const r = withTeam.risingFormFor(player());
    const labels = r.signals.map(s => s.label);
    assert.ok(labels.includes('Team xG rising'), 'xG trend can fire');
    assert.ok(labels.includes('Goals regression due'), 'regression can fire');
    assert.ok(labels.includes('Stats improving'), 'underlying stats can fire');
});

test('the team trend refuses to compare a window with itself', () => {
    const thin = engine({
        getTeamSeasonXg: () => ({ games: 3, xGpg: 1.5, xGCpg: 1.2, totalXg: 4.5, totalXgc: 3.6 }),
        getTeamXgWindow: () => ({ games: 3, xGpg: 1.5, xGCpg: 1.2, totalXg: 4.5, totalXgc: 3.6 })
    }).ftTeamTrend(1);
    assert.equal(thin.usable, false, 'three matches, all of them in the window');

    const ok = withTeam.ftTeamTrend(1);
    assert.equal(ok.usable, true);
    assert.equal(ok.recentGames, 3);
    assert.equal(ok.priorGames, 2);
    // (5 - 4.5) / 2 = 0.25 before, 1.5 now.
    assert.ok(Math.abs(ok.xgDelta - 1.25) < 1e-9, 'creating more than it was');
    // Signed so positive is always the good direction, whichever stat it is.
    assert.ok(Math.abs(ok.xgcDelta - (1.65 - 0.9)) < 1e-9, 'conceding fewer than it was');
});

test('fixtures easing is measured against what he has just played', () => {
    /* The old signal compared the next three gameweeks against the three AFTER
       them, so it could only fire when the near fixtures were the worse of the
       two — and it carried the heaviest weight in the model. Every flag on the
       board pointed four or more gameweeks out while the section claimed to be
       about the next week or two. */
    const eased = engine({
        allFixtures: [
            { event: 1, team_h: 1, team_a: 2, team_h_difficulty: 5, finished_provisional: true },
            { event: 2, team_h: 3, team_a: 1, team_a_difficulty: 5, finished_provisional: true },
            { event: 3, team_h: 1, team_a: 4, team_h_difficulty: 4, finished_provisional: true }
        ]
    }).risingFormFor(player({
        fixtures: { next3: [{ difficulty: 2 }, { difficulty: 2 }, { difficulty: 2 }] }
    }));
    const easing = eased.signals.find(s => s.label === 'Fixtures easing');
    assert.ok(easing, 'a real turn is reported');
    assert.match(easing.detail, /behind him/);
});

/* ---- the two multipliers ---- */

test('hard fixtures demote rather than merely failing to promote', () => {
    /* The measured consequence of a bonus-only fixture term: the top ten by
       score averaged FDR 3.5 over their next three and the bottom ten 2.4. The
       model ranked bad fixtures above good ones. */
    const kind = base.risingFormFor(player({
        fixtures: { next3: [{ difficulty: 2 }, { difficulty: 2 }, { difficulty: 2 }] } }));
    const cruel = base.risingFormFor(player({
        fixtures: { next3: [{ difficulty: 5 }, { difficulty: 5 }, { difficulty: 5 }] } }));
    assert.ok(kind.score > cruel.score, 'the kind run outranks the brutal one');
});

test('the next match counts for more than the one after it', () => {
    const soon = base.risingFormFor(player({
        fixtures: { next3: [{ difficulty: 2 }, { difficulty: 4 }, { difficulty: 4 }] } }));
    const later = base.risingFormFor(player({
        fixtures: { next3: [{ difficulty: 4 }, { difficulty: 4 }, { difficulty: 2 }] } }));
    assert.ok(soon.score > later.score, 'the kind fixture in front wins');
});

test('a differential outranks the same player at high ownership', () => {
    const hidden = base.risingFormFor(player({ selectedBy: 0.3 }));
    const owned = base.risingFormFor(player({ selectedBy: 45 }));
    assert.ok(hidden.score > owned.score);
    assert.ok(hidden.signals.some(s => s.label === 'Under the radar'));
    assert.ok(!owned.signals.some(s => s.label === 'Under the radar'));
});

test('unknown ownership is neutral, not maximal', () => {
    // Absent data must never read as "nobody owns him".
    const unknown = base.risingFormFor(player({ selectedBy: undefined }));
    const hidden = base.risingFormFor(player({ selectedBy: 0.1 }));
    assert.ok(hidden.score > unknown.score);
});

/* ---- honesty about the window ---- */

test('one big score is worth less than three even ones, and says so', () => {
    const haul = base.risingFormFor(player({
        history: [row(), row(), hot({ total_points: 1 }), hot({ total_points: 1 }),
            hot({ total_points: 16 })] }));
    const even = base.risingFormFor(player({
        history: [row(), row(), hot({ total_points: 6 }), hot({ total_points: 6 }),
            hot({ total_points: 6 })] }));
    assert.ok(even.score > haul.score, 'three returns beat one haul of the same average');
    const pts = haul.signals.find(s => s.label === 'Points trending up');
    assert.match(pts.detail, /on one big score/);
});

test('every signal states the numbers behind it', () => {
    const r = withTeam.risingFormFor(player());
    assert.ok(r.signals.length >= 2);
    for (const s of r.signals) assert.match(s.detail, /\d/, `${s.label} shows its figures`);
});

/* ---- the pool ---- */

test('the pool carries the reason it is empty', () => {
    const out = base.risingFormScores([player({ history: [row(), row(), hot()] })]);
    assert.deepEqual({ ...out.scores }, {});
    assert.equal(out.measurable, 0);
    assert.match(out.note, /not enough season yet/);
});

test('the ranked pool is ordered, and carries what the card draws', () => {
    const rows = withTeam.risingFormRanked([
        player({ id: 1, selectedBy: 40 }),
        player({ id: 2, selectedBy: 0.2 })
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, 2, 'the differential leads');
    assert.ok(rows[0].risingScore >= rows[1].risingScore);
    assert.ok(rows[0].signalCount >= 2);
    assert.equal(typeof rows[0].fdrNear, 'number');
});
