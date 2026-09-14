/* The last five gameweeks, and what they are allowed to claim.

   Two things this has to get right, and both are about not overstating what the
   feed says. A gameweek the club did not play, a fixture the player missed and a
   match he played badly all end up as nothing on the scoresheet and mean three
   different things — collapsing them into a zero is how a stats block starts
   lying quietly. And an actual-against-expected reading over five games is
   mostly noise unless there is enough expected output to divide, so the reading
   has to be able to say so rather than inventing a direction. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const P = 'scripts/player-profile.js';
const pfMatchStats = loadFunction(P, 'pfMatchStats');
const pfSum = loadFunction(P, 'pfSum', { pfMatchStats, PF_ZERO_STATS: () => pfMatchStats({}) });
const fixturePlayed = loadFunction('scripts/common.js', 'fixturePlayed');
const pfLastPlayedRound = loadFunction(P, 'pfLastPlayedRound', { fixturePlayed });
const pfFormWindow = loadFunction(P, 'pfFormWindow', {
    pfMatchStats, pfSum, pfLastPlayedRound, PF_WINDOW: 5, PF_ZERO_STATS: () => pfMatchStats({})
});
const pfVsExpected = loadFunction(P, 'pfVsExpected', { PF_PAR: 1.0, PF_THIN: 0.5 });

const TEAMS = { 1: { short_name: 'ARS' }, 2: { short_name: 'BOU' }, 3: { short_name: 'CHE' } };
const player = { id: 7, teamId: 1, position: 4, name: 'Test' };

// team 1 plays every round except GW3, and twice in GW5.
const fixtures = [
    { id: 101, event: 1, team_h: 1, team_a: 2, team_h_score: 2, team_a_score: 0, finished_provisional: true, kickoff_time: '2026-08-15T14:00:00Z' },
    { id: 102, event: 2, team_h: 3, team_a: 1, team_h_score: 1, team_a_score: 3, finished_provisional: true, kickoff_time: '2026-08-22T14:00:00Z' },
    { id: 103, event: 3, team_h: 2, team_a: 3, team_h_score: 0, team_a_score: 0, finished_provisional: true, kickoff_time: '2026-08-29T14:00:00Z' },
    { id: 104, event: 4, team_h: 1, team_a: 3, team_h_score: 1, team_a_score: 1, finished_provisional: true, kickoff_time: '2026-09-05T14:00:00Z' },
    { id: 105, event: 5, team_h: 2, team_a: 1, team_h_score: 0, team_a_score: 1, finished_provisional: true, kickoff_time: '2026-09-12T14:00:00Z' },
    { id: 106, event: 5, team_h: 1, team_a: 2, team_h_score: 4, team_a_score: 0, finished_provisional: true, kickoff_time: '2026-09-14T19:00:00Z' }
];
const row = (round, fixture, over) => ({
    round, fixture, minutes: 90, total_points: 5, goals_scored: 1, assists: 0,
    expected_goals: '0.50', expected_assists: '0.10', expected_goal_involvements: '0.60',
    expected_goals_conceded: '1.00', clean_sheets: 0, goals_conceded: 1, saves: 0,
    bonus: 0, bps: 20, threat: '30.0', creativity: '5.0', influence: '20.0',
    defensive_contribution: 2, tackles: 1, clearances_blocks_interceptions: 1, recoveries: 3,
    starts: 1, penalties_saved: 0, ...over
});

const build = (history) => pfFormWindow(player, history, fixtures, TEAMS);

test('a gameweek the club did not play is a blank, not a zero', () => {
    const w = build([row(1, 101), row(2, 102), row(4, 104), row(5, 105), row(5, 106)]);
    const gw3 = w.columns.find(c => c.round === 3);
    assert.equal(gw3.state, 'blank', 'team 1 has no GW3 fixture');
    assert.equal(w.blanks, 1);
    // A blank must not be counted as a match he failed to turn up for.
    assert.equal(w.columns.filter(c => c.state === 'dnp').length, 0);
});

test('a fixture the player missed is a dnp, and an unused row is still a dnp', () => {
    // FPL writes a row for an unused squad member, so the row existing is not
    // the test — minutes are. An injured player has rows and no appearances.
    const w = build([row(1, 101), row(2, 102, { minutes: 0, total_points: 0 }), row(4, 104)]);
    assert.equal(w.columns.find(c => c.fixtureId === 101).state, 'played');
    assert.equal(w.columns.find(c => c.fixtureId === 102).state, 'dnp', '0 minutes is not an appearance');
    assert.equal(w.columns.find(c => c.fixtureId === 105).state, 'dnp', 'no row at all is also a dnp');
    assert.equal(w.appearances, 2);
});

test('a double gameweek is two columns, not one merged one', () => {
    const w = build([row(1, 101), row(2, 102), row(4, 104), row(5, 105), row(5, 106)]);
    const gw5 = w.columns.filter(c => c.round === 5);
    assert.equal(gw5.length, 2, 'both GW5 fixtures get a column');
    assert.deepEqual([...gw5].map(c => c.opponent), ['BOU', 'BOU']);
    // Five gameweeks, six matches — the label has to be able to say so.
    assert.equal(w.rounds.length, 5);
    assert.equal(w.columns.length, 6);
});

test('the scoreline reads from this player\'s side, not in fixture order', () => {
    const w = build([row(2, 102)]);
    const away = w.columns.find(c => c.fixtureId === 102);
    assert.equal(away.isHome, false);
    // Fixture order is 1-3 to the home side; from team 1's side it is a 3-1 win.
    assert.equal(away.scoreline, '3-1');
    assert.equal(away.result, 1, 'a win is a win from the away side too');
});

test('totals cover every fixture, and the season covers everything', () => {
    const history = [row(1, 101), row(2, 102), row(4, 104), row(5, 105), row(5, 106)];
    const w = build(history);
    assert.equal(w.totals.goals, 5, 'five scoring matches inside the window');
    assert.equal(w.totals.minutes, 450);
    assert.equal(w.season.goals, 5);
    // gi is an addition of two published fields, not an estimate of anything.
    assert.equal(w.totals.gi, w.totals.goals + w.totals.assists);
});

test('the window ends at the last round anyone has played', () => {
    assert.equal(pfLastPlayedRound(fixtures), 5);
    // An unplayed round must not pull the window forward onto empty columns.
    assert.equal(pfLastPlayedRound(fixtures.concat(
        [{ id: 107, event: 9, team_h: 1, team_a: 2, team_h_score: null, team_a_score: null, finished_provisional: false }])), 5);
});

test('a reading is always given, and says so when the sample cannot support one', () => {
    // Always a verdict — but a verdict is allowed to be "not enough to tell".
    const thin = pfVsExpected(0, 0.3, { noun: 'chances' });
    assert.equal(thin.tone, 'thin');
    assert.match(thin.text, /too few chances/);

    assert.equal(pfVsExpected(1, 1.2, { noun: 'chances' }).tone, 'par', 'inside a goal either way is par');
    assert.equal(pfVsExpected(4, 1.5, { noun: 'chances' }).tone, 'over');
    assert.equal(pfVsExpected(1, 3.4, { noun: 'chances' }).tone, 'under');
});

test('for goals conceded, fewer than expected is the good side', () => {
    // The same delta means opposite things depending on the stat, which is what
    // `invert` is for — a defence conceding under its xGC is doing well.
    const lucky = pfVsExpected(2, 6.0, { noun: 'chances they faced', invert: true });
    assert.equal(lucky.tone, 'over', 'conceding fewer than expected is the good tone');
    const leaky = pfVsExpected(7, 3.0, { noun: 'chances they faced', invert: true });
    assert.equal(leaky.tone, 'under');
});

test('nothing is invented when the feed is silent', () => {
    // Every figure is a field FPL publishes. A row with nothing in it produces
    // zeros, never a number derived from a different stat.
    const empty = pfMatchStats({});
    assert.equal(Object.values(empty).every(v => v === 0), true);

    // No history at all: the fixtures still say what the club was doing, so the
    // columns are real and every one of them reads as a match he did not play.
    const w = build([]);
    assert.equal(w.appearances, 0);
    assert.equal(w.totals.points, 0);
    assert.equal(w.columns.every(c => c.state === 'dnp' || c.state === 'blank'), true);
});
