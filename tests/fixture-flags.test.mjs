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
