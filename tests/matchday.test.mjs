/* Which gameweek the site thinks it is in.

   This was previously read off bootstrap-static.json's `is_current`, which is
   wrong in two different ways — by meaning between rounds, and by up to twenty
   minutes of latency at a deadline. Deriving it from the clock and the fixture
   list fixes both, and makes the whole thing a pure function that can be tested
   at any point in a season without waiting for one. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, browserStubs } from './helpers/load.mjs';

const md = loadScript('scripts/matchday.js', browserStubs({ escHTML: s => String(s ?? '') }));
const { mdGameweekState, mdCountdown, mdExpandLiveRow } = md;

const HOUR = 3600000, DAY = 86400000;
const T0 = Date.parse('2026-09-04T17:30:00Z');    // GW3 deadline

const EVENTS = [
    { id: 2, deadline_time: '2026-08-28T17:30:00Z' },
    { id: 3, deadline_time: '2026-09-04T17:30:00Z' },
    { id: 4, deadline_time: '2026-09-12T12:30:00Z' }
];

// Two fixtures a round is enough to exercise every transition.
const fx = (event, state) => ([
    { id: event * 10 + 1, event, kickoff_time: '2026-09-05T14:00:00Z', ...state[0] },
    { id: event * 10 + 2, event, kickoff_time: '2026-09-05T16:30:00Z', ...state[1] }
]);
const UNPLAYED = { started: false, finished: false, finished_provisional: false };
const PLAYING = { started: true, finished: false, finished_provisional: false, minutes: 55 };
const DONE = { started: true, finished: true, finished_provisional: true, minutes: 90 };

const round2Done = fx(2, [DONE, DONE]);

test('before the first deadline of the season there is no current gameweek', () => {
    const s = mdGameweekState(EVENTS, [], Date.parse('2026-08-01T00:00:00Z'));
    assert.equal(s.phase, 'preseason');
    assert.equal(s.gw, 2, 'the badge names the gameweek being picked');
    assert.equal(s.locked, false);
});

test('between rounds the badge names the gameweek you are picking, not the one just played', () => {
    // The old behaviour: is_current still said GW2 here, so the dashboard read
    // GW2 for four days while everyone was picking a GW3 team.
    const s = mdGameweekState(EVENTS, round2Done, T0 - DAY);
    assert.equal(s.phase, 'upcoming');
    assert.equal(s.gw, 3, 'names GW3, the one being picked');
    assert.equal(s.currentGW, 2, 'while still knowing GW2 is the one behind us');
    assert.equal(s.deadline, '2026-09-04T17:30:00Z');
    assert.equal(s.locked, false);
});

test('the badge flips the moment the deadline passes', () => {
    const before = mdGameweekState(EVENTS, round2Done.concat(fx(3, [UNPLAYED, UNPLAYED])), T0 - 1000);
    const after = mdGameweekState(EVENTS, round2Done.concat(fx(3, [UNPLAYED, UNPLAYED])), T0 + 1000);
    assert.equal(before.phase, 'upcoming');
    assert.equal(before.locked, false);
    assert.equal(after.phase, 'locked', 'deadline gone, nothing kicked off yet');
    assert.equal(after.gw, 3);
    assert.equal(after.locked, true);
    // A second either side of a timestamp is the whole test: this is why it is
    // computed from the clock and not from a flag in a file refreshed every
    // fifteen minutes.
    assert.equal(before.gw, after.gw, 'the number itself does not jump, its state does');
});

test('the next kick-off is surfaced while the round is locked but not started', () => {
    const s = mdGameweekState(EVENTS, round2Done.concat(fx(3, [UNPLAYED, UNPLAYED])), T0 + HOUR);
    assert.equal(s.phase, 'locked');
    assert.equal(s.nextKickoff, '2026-09-05T14:00:00Z');
});

test('a match in play makes the round live', () => {
    const s = mdGameweekState(EVENTS, round2Done.concat(fx(3, [PLAYING, UNPLAYED])), T0 + DAY);
    assert.equal(s.phase, 'live');
    assert.equal(s.gw, 3);
    assert.deepEqual(s.fixtures, { total: 2, finished: 0, live: 1, upcoming: 1 });
});

test('a round with one match left to play is still live, not finished', () => {
    const s = mdGameweekState(EVENTS, round2Done.concat(fx(3, [DONE, UNPLAYED])), T0 + DAY);
    assert.equal(s.phase, 'locked', 'nothing in play right now, but the round is not over');
    assert.equal(s.gw, 3, 'and the badge still names it');
    assert.equal(s.fixtures.finished, 1);
});

test('the last whistle starts the countdown to the next gameweek', () => {
    const s = mdGameweekState(EVENTS, round2Done.concat(fx(3, [DONE, DONE])), T0 + 3 * DAY);
    assert.equal(s.phase, 'upcoming');
    assert.equal(s.gw, 4, 'the badge moves on');
    assert.equal(s.currentGW, 3);
    assert.equal(s.deadline, '2026-09-12T12:30:00Z');
    assert.ok(mdCountdown(s.deadline, T0 + 3 * DAY).length > 0, 'and it is counting down');
});

test('finished_provisional ends a round, not finished', () => {
    // `finished` waits for the game to confirm bonus, which can be a day later.
    // A round whose last match ended an hour ago is over.
    const provisional = { started: true, finished: false, finished_provisional: true, minutes: 90 };
    const s = mdGameweekState(EVENTS, round2Done.concat(fx(3, [provisional, provisional])), T0 + 2 * DAY);
    assert.equal(s.phase, 'upcoming');
    assert.equal(s.gw, 4);
});

test('the final gameweek does not roll into a gameweek 39', () => {
    // Every deadline behind us and the last round played out: there is nothing
    // to count down to, and the badge must not invent a fixture list for it.
    const season = EVENTS.slice(0, 2);   // GW2 and GW3 only
    const s = mdGameweekState(season, round2Done.concat(fx(3, [DONE, DONE])), T0 + 3 * DAY);
    assert.equal(s.phase, 'season-over');
    assert.equal(s.gw, 3, 'stays on the last gameweek played');
    assert.equal(s.nextGW, null);
    assert.equal(s.deadline, null);
});

test('a round with no fixtures listed does not strand the badge', () => {
    // Fixtures can be missing entirely — a data refresh that failed, or a
    // gameweek FPL has not scheduled yet. It must not read as "live forever".
    const s = mdGameweekState(EVENTS, [], T0 + HOUR);
    assert.equal(s.phase, 'upcoming');
    assert.equal(s.gw, 4);
});

test('nothing to go on produces nothing, rather than a wrong number', () => {
    for (const bad of [null, undefined, []]) {
        const s = mdGameweekState(bad, [], Date.now());
        assert.equal(s.phase, 'unknown');
        assert.equal(s.gw, null);
    }
});

test('the countdown coarsens with distance', () => {
    const now = 0;
    assert.equal(mdCountdown(new Date(2 * DAY + 4 * HOUR).toISOString(), now), '2d 4h');
    assert.equal(mdCountdown(new Date(3 * HOUR + 12 * 60000).toISOString(), now), '3h 12m');
    assert.equal(mdCountdown(new Date(8 * 60000 + 40000).toISOString(), now), '8m 40s');
    assert.equal(mdCountdown(new Date(-1000).toISOString(), now), '', 'a passed deadline counts down to nothing');
    assert.equal(mdCountdown(null, now), '');
});

test('both live shapes normalise to one', () => {
    // The live endpoint returns full field names; event-live.json abbreviates
    // them to keep a file rewritten every fifteen minutes small.
    const fromApi = mdExpandLiveRow({ total_points: 9, minutes: 90, goals_scored: 1, assists: 1, bonus: 2, bps: 41 });
    const fromFeed = mdExpandLiveRow({ pts: 9, min: 90, g: 1, a: 1, b: 2, bps: 41 });
    for (const k of ['points', 'minutes', 'goals', 'assists', 'bonus', 'bps']) {
        assert.equal(fromApi[k], fromFeed[k], `${k} agrees across both sources`);
    }
    assert.equal(mdExpandLiveRow(null), null);
});
