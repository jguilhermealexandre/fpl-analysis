/* A gameweek is over when the last whistle goes, not when FPL says so.

   FPL flips a fixture's `finished` at the round's data check — every match
   concluded and bonus confirmed — which lands a day or more after the final
   whistle. `finished_provisional` flips at full time. GW3 2026/27: ten matches
   played, scores in by Sunday afternoon, every one still `finished: false` on
   Monday morning.

   Four pages independently filtered on `finished` to decide what was still to
   come, so for that whole window the site projected a round it had already
   scored — fixture strips pointing at played matches, form and xG models
   ignoring the newest results, and the Players page ranking a midfielder on the
   venue split of a game he had just finished. fixturePlayed() in
   scripts/common.js is the one definition; this stops the fifth copy. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFunction } from './helpers/load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const fixturePlayed = loadFunction('scripts/common.js', 'fixturePlayed');
const planningGameweek = loadFunction('scripts/common.js', 'planningGameweek');

/* Straight off data/fixtures.json, 2026-09-07. */
const GW3_PLAYED = { event: 3, started: true, finished: false, finished_provisional: true, team_h_score: 2, team_a_score: 2 };
const GW2_SETTLED = { event: 2, started: true, finished: true, finished_provisional: true, team_h_score: 1, team_a_score: 4 };
const GW4_TO_COME = { event: 4, started: false, finished: false, finished_provisional: false, team_h_score: null, team_a_score: null };

test('a played round counts as played before FPL confirms bonus', () => {
    assert.equal(fixturePlayed(GW3_PLAYED), true);
    assert.equal(fixturePlayed(GW2_SETTLED), true);
});

test('a fixture that has not kicked off is still to come', () => {
    assert.equal(fixturePlayed(GW4_TO_COME), false);
    assert.equal(fixturePlayed(null), false);
    assert.equal(fixturePlayed(undefined), false);
});

test('a 0-0 in progress is played, not pending', () => {
    // team_h_score goes to 0 at kick-off, so the score check must be against
    // null and not falsiness — `|| ` here would read every goalless match as
    // an upcoming fixture.
    assert.equal(fixturePlayed({ started: true, finished: false, finished_provisional: false, team_h_score: 0, team_a_score: 0 }), true);
});

/* ===== The same lag, one level up: which gameweek are we planning for? =====

   `is_current` names the round whose deadline passed most recently, and keeps
   naming it for the days between that round's last whistle and the next
   deadline. Teams Analysis started every fixture horizon there, so on the
   Wednesday after GW3 it opened its calendar on GW3, compared GW3-5 against
   GW6-8, and offered "upcoming" fixture runs beginning with a game already
   played. */

const EVENTS = [
    { id: 3, deadline_time: '2026-09-04T17:30:00Z', finished: true },
    { id: 4, deadline_time: '2026-09-12T12:30:00Z', finished: false },
    { id: 5, deadline_time: '2026-09-18T17:30:00Z', finished: false }
];
// Two fixtures a round is enough to exercise every transition.
const round = (event, ...states) => states.map((s, i) => ({ event, id: event * 10 + i, ...s }));
const PLAYED = { started: true, finished: false, finished_provisional: true };
const PENDING = { started: false, finished: false, finished_provisional: false };
const AT = iso => Date.parse(iso);

test('between rounds the horizon starts at the gameweek being picked', () => {
    // The reported bug, to the day: GW3 done, GW4 deadline still ahead.
    const gw = planningGameweek({ events: EVENTS }, round(3, PLAYED, PLAYED), AT('2026-09-09T10:00:00Z'));
    assert.equal(gw, 4);
});

test('a round still to be played is the round being planned', () => {
    // Deadline gone, nothing kicked off — the fixtures ahead of you start here.
    const locked = planningGameweek({ events: EVENTS }, round(3, PENDING, PENDING), AT('2026-09-04T18:00:00Z'));
    assert.equal(locked, 3);
    // Half the round played is still this round.
    const live = planningGameweek({ events: EVENTS }, round(3, PLAYED, PENDING), AT('2026-09-05T18:00:00Z'));
    assert.equal(live, 3);
});

test('the horizon moves at the final whistle, not at FPL’s data check', () => {
    // Every fixture finished_provisional, none `finished` yet — the state the
    // feed sits in for a day after a round ends.
    const gw = planningGameweek({ events: EVENTS.map(e => ({ ...e, finished: false })) },
        round(3, PLAYED, PLAYED), AT('2026-09-07T09:00:00Z'));
    assert.equal(gw, 4);
});

test('the horizon moves again the moment the next deadline passes', () => {
    const fixtures = round(3, PLAYED, PLAYED).concat(round(4, PENDING, PENDING));
    const before = planningGameweek({ events: EVENTS }, fixtures, AT('2026-09-12T12:30:00Z') - 1000);
    const after = planningGameweek({ events: EVENTS }, fixtures, AT('2026-09-12T12:30:00Z') + 1000);
    assert.equal(before, 4);
    assert.equal(after, 4, 'GW4 is now the round in progress, and still where the fixtures start');
});

test('before any deadline has passed the horizon is the first round ahead', () => {
    assert.equal(planningGameweek({ events: EVENTS }, [], AT('2026-08-01T00:00:00Z')), 3,
        'the earliest event still to come, whatever its number');
});

test('the last round of the season has nowhere to advance to', () => {
    const finalOnly = [{ id: 38, deadline_time: '2027-05-24T14:00:00Z', finished: true }];
    assert.equal(planningGameweek({ events: finalOnly }, round(38, PLAYED, PLAYED), AT('2027-05-25T00:00:00Z')), 38);
});

test('without a fixture list it falls back to the event flag', () => {
    // season-vault.js and friends only fetch bootstrap-static.
    assert.equal(planningGameweek({ events: EVENTS }, null, AT('2026-09-09T10:00:00Z')), 4);
    assert.equal(planningGameweek({ events: EVENTS.map(e => ({ ...e, finished: false })) }, null,
        AT('2026-09-09T10:00:00Z')), 3, 'nothing to say the round is over, so it stays put');
});

test('missing or malformed bootstrap does not throw', () => {
    assert.equal(planningGameweek(null, null, AT('2026-09-09T10:00:00Z')), 1);
    assert.equal(planningGameweek({ events: [] }, [], AT('2026-09-09T10:00:00Z')), 1);
    assert.equal(planningGameweek({ events: [{ id: 4 }] }, [], AT('2026-09-09T10:00:00Z')), 1,
        'an event with no deadline cannot be placed on the clock');
});

/* Reading `finished` directly is right when the question really is "has bonus
   been confirmed?" — and wrong when it is "has this been played?". These are
   the former, and they say so in their own comments. */
const ALLOWED = new Set(['scripts/live-gw.js']);

const CALLBACK = /\.(filter|some|every|find|findIndex)\s*\(/;
const RAW_FLAG = /\bf\.finished\b/;   // \b will not match f.finished_provisional

test('nothing partitions fixtures on the slow flag', () => {
    const files = [
        ...fs.readdirSync(ROOT).filter(f => f.endsWith('.html')),
        ...fs.readdirSync(path.join(ROOT, 'scripts')).filter(f => f.endsWith('.js')).map(f => `scripts/${f}`)
    ];
    const offenders = [];
    for (const file of files) {
        if (ALLOWED.has(file)) continue;
        fs.readFileSync(path.join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
            const code = line.trim();
            if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
            if (CALLBACK.test(line) && RAW_FLAG.test(line)) offenders.push(`${file}:${i + 1}: ${code}`);
        });
    }
    assert.deepEqual(offenders, [],
        `Use fixturePlayed() from scripts/common.js — a fixture stays finished:false for a day after it is played:\n${offenders.join('\n')}`);
});
