/* The flat totals the All Players table and the AI scouting report are built
   from, and the one thing they must not do: mean something different from the
   profile card sitting next to them.

   They used to. calculateStats() took the last five ROWS of the player's own
   history while the card took the last five ROUNDS of the fixture list, and a
   club with a blank, a player with fewer rows than his club has fixtures, or a
   round still being played pulled the two apart. So the contract under test
   here is not the arithmetic — pfSum does that, and tests/player-form.test.mjs
   covers it. It is which matches got counted, and what the counts are called. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const P = 'scripts/player-profile.js', R = 'scripts/compare-report.js';
const pfMatchStats = loadFunction(P, 'pfMatchStats');
const PF_ZERO_STATS = () => pfMatchStats({});
const pfSum = loadFunction(P, 'pfSum', { pfMatchStats, PF_ZERO_STATS });
const fixturePlayed = loadFunction('scripts/common.js', 'fixturePlayed');
const pfPlayed = loadFunction(P, 'pfPlayed', { fixturePlayed });
const pfFixtureIndex = loadFunction(P, 'pfFixtureIndex', {
    pfPlayed, PF_IDX_CACHE: { fixtures: null, index: null }
});
const pfFormWindow = loadFunction(P, 'pfFormWindow', {
    pfMatchStats, pfSum, pfPlayed, pfFixtureIndex, PF_WINDOW: 5, PF_ZERO_STATS
});
const statsShape = loadFunction(R, 'statsShape');
const splitsFrom = loadFunction(R, 'splitsFrom', { pfSum, PF_ZERO_STATS });
const buildStatWindows = loadFunction(R, 'buildStatWindows', {
    pfFormWindow, pfSum, pfMatchStats, statsShape, splitsFrom
});

const TEAMS = { 1: { short_name: 'ARS' }, 2: { short_name: 'BOU' }, 3: { short_name: 'CHE' } };
const player = { id: 7, teamId: 1, position: 2, name: 'Test' };

/* Team 1's season: GW1 home, GW2 away, GW3 blank, GW4 home, GW5 away — and the
   GW5 fixture has not kicked off, though someone else's has, so the window
   reaches round 5. This is the shape of a live Sunday evening. */
const fixtures = [
    { id: 101, event: 1, team_h: 1, team_a: 2, team_h_score: 2, team_a_score: 0, finished_provisional: true, kickoff_time: '2026-08-15T14:00:00Z' },
    { id: 102, event: 2, team_h: 3, team_a: 1, team_h_score: 1, team_a_score: 3, finished_provisional: true, kickoff_time: '2026-08-22T14:00:00Z' },
    { id: 103, event: 3, team_h: 2, team_a: 3, team_h_score: 0, team_a_score: 0, finished_provisional: true, kickoff_time: '2026-08-29T14:00:00Z' },
    { id: 104, event: 4, team_h: 1, team_a: 3, team_h_score: 1, team_a_score: 1, finished_provisional: true, kickoff_time: '2026-09-05T14:00:00Z' },
    { id: 105, event: 5, team_h: 2, team_a: 1, team_h_score: null, team_a_score: null, finished_provisional: false, kickoff_time: '2026-09-12T19:00:00Z' },
    { id: 110, event: 5, team_h: 2, team_a: 3, team_h_score: 1, team_a_score: 0, finished_provisional: true, kickoff_time: '2026-09-12T11:30:00Z' }
];

const row = (round, fixture, over) => ({
    round, fixture, minutes: 90, total_points: 6, goals_scored: 0, assists: 1,
    expected_goals: '0.10', expected_assists: '0.40', expected_goal_involvements: '0.50',
    expected_goals_conceded: '1.20', clean_sheets: 1, goals_conceded: 0, saves: 0,
    bonus: 2, bps: 30, threat: '10.0', creativity: '25.0', influence: '30.0',
    ict_index: '6.5', defensive_contribution: 3, tackles: 2,
    clearances_blocks_interceptions: 4, recoveries: 5, starts: 1,
    penalties_saved: 0, penalties_missed: 0, ...over
});

// He played GW1, GW2 and GW4. GW3 his club blanked; GW5 has not kicked off but
// FPL has already written the zeroed row for it.
const history = [row(1, 101), row(2, 102), row(4, 104),
    row(5, 105, { minutes: 0, total_points: 0, clean_sheets: 0, assists: 0, bonus: 0, bps: 0 })];

const built = () => buildStatWindows(player, history, { fixtures, teams: TEAMS });

test('"games" is matches his club played — not rows in the feed', () => {
    /* The three counts the old field was standing in for. Rows would say 4 (the
       fixture tonight has one), appearances say 3, and matches-played say 3
       because his club has only played three. 270 minutes divided by 4 is the
       68 mins/g that called a man who has played every minute a rotation risk. */
    const { recent } = built();
    assert.equal(recent.games, 3, 'the fixture still to come is not a game');
    assert.equal(recent.appearances, 3);
    assert.equal(recent.minutes, 270);
    assert.equal(recent.minutes / recent.games, 90);
});

test('appearances is carried separately, because it answers a different question', () => {
    // Same club matches, one of them he watched. Two numbers, not one doing
    // duty for both — the per-match rates still divide by 3.
    const missed = history.map(r => (r.round === 2 ? { ...r, minutes: 0, total_points: 0 } : r));
    const { recent } = buildStatWindows(player, missed, { fixtures, teams: TEAMS });
    assert.equal(recent.games, 3, 'his club still played three');
    assert.equal(recent.appearances, 2, 'he was on the pitch for two');
});

test('the season denominator is his club\'s matches, not his row count', () => {
    const { season } = built();
    assert.equal(season.games, 3, 'team 1 has played GW1, GW2 and GW4');
    assert.equal(season.appearances, 3);
    assert.equal(season.points, 18, 'the zeroed row for tonight adds nothing');
});

test('every field the tables index by name is present and summed', () => {
    // The table reaches for these by string key. A missing one renders blank
    // with no error, which is how a column quietly stops meaning anything.
    const { recent } = built();
    for (const k of ['games', 'appearances', 'minutes', 'points', 'goals', 'assists', 'gi',
        'xG', 'xA', 'xGI', 'cleanSheets', 'goalsConceded', 'xGC', 'saves', 'penaltiesSaved',
        'penaltiesMissed', 'bonus', 'bps', 'ict', 'influence', 'creativity', 'threat', 'defCon']) {
        assert.equal(typeof recent[k], 'number', `${k} is a number`);
    }
    assert.equal(recent.assists, 3);
    assert.equal(recent.gi, recent.goals + recent.assists);
    assert.equal(recent.ict, 19.5);
    assert.equal(recent.defCon, 9);
});

test('home and away come from the fixture, not from the row\'s was_home flag', () => {
    /* was_home only exists on a row. A fixture he has no row for would fall to
       the away side of a `!g.was_home` filter and be counted as an away game he
       played — and the split's own game count would say so. */
    const { recent } = built();
    assert.equal(recent.homeSplit.games, 2, 'GW1 and GW4 at home');
    assert.equal(recent.awaySplit.games, 1, 'GW2 away; GW5 has not been played');
    assert.equal(recent.homeSplit.minutes + recent.awaySplit.minutes, recent.minutes);
});

test('no history is null, not a row of zeroes', () => {
    // Zero is an answer. The All Players table filters on it, and a player with
    // no per-gameweek data must not arrive there claiming to have played none.
    const empty = buildStatWindows(player, [], { fixtures, teams: TEAMS });
    assert.equal(empty.recent, null);
    assert.equal(empty.season, null);
    assert.equal(empty.window, null);
});

test('without a fixture list it falls back to everything he has, and says so', () => {
    // Preseason, or a fixture feed that has not loaded. Emptying the tables
    // would be worse than a window that is honestly the whole season.
    const { recent, window } = buildStatWindows(player, history, { fixtures: [], teams: TEAMS });
    assert.equal(window, null, 'no window was built');
    assert.equal(recent.minutes, 270);
    assert.equal(recent.appearances, 3);
    assert.equal(recent.homeSplit, null, 'no fixtures means no venue to split on');
});

test('the window object is handed back, so nobody rebuilds it', () => {
    // The scouting report reads its match grid and its actual-vs-expected prose
    // off this. Recomputing it there is how the two windows drifted apart.
    const { window, recent } = built();
    assert.equal(window.matches, recent.games);
    assert.equal(window.appearances, recent.appearances);
    assert.equal(window.totals.minutes, recent.minutes);
});
