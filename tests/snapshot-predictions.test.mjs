/* The prediction archive, checked against the real engine and the real data.

   This file carries more weight than most here. The archive it guards cannot be
   backfilled: if the snapshot job is broken on the Friday of a deadline, that
   gameweek is lost permanently, and the failure mode is not a crash — it is a
   file full of zeros or nulls that looks fine until someone tries to grade it a
   season later. So these tests run the shipped engine over the committed data
   rather than over a fixture, and assert the numbers are alive.

   That makes them sensitive to data/bootstrap-static.json, which a scheduled
   job rewrites every fifteen minutes. The thresholds below are therefore loose
   on purpose — they are tripwires for "the engine came back empty", not
   assertions about any particular player.
*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chooseSnapshot, takeSnapshot } from '../tools/snapshot-predictions.mjs';
import { REPO_ROOT, buildProjector } from '../tools/xp-engine-host.mjs';

const boot = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/bootstrap-static.json'), 'utf8'));

/* An hour before the next real deadline — the exact condition the job runs in.

   It has to be a deadline in the FUTURE, not merely an unfinished gameweek. A
   round that has kicked off has had its fixtures consumed out of the upcoming
   list one by one, so projecting it returns a growing pile of legitimate blanks
   as the weekend goes on; a test anchored there would drift from healthy to
   failing over three days without anything being wrong. The job never sees that
   state, because it never writes after a deadline. */
function anHourBeforeTheNextDeadline() {
    const target = boot.events.find(e => Date.parse(e.deadline_time) > Date.now());
    if (!target) return null;
    return { gw: target.id, now: Date.parse(target.deadline_time) - 3600000 };
}

/* Built once for the whole file.

   Each call parses a 1.7MB bootstrap and runs the projection over 662 players,
   and three tests were each doing it again to ask a different question of the
   same answer. node --test runs files in parallel, so that was the heaviest
   thing in the suite several times over for no extra coverage. */
let SNAPSHOT;
function snapshotOnce() {
    if (SNAPSHOT === undefined) {
        const next = anHourBeforeTheNextDeadline();
        SNAPSHOT = next ? { ...next, result: takeSnapshot({ now: next.now, withinHours: 3 }) } : null;
    }
    return SNAPSHOT;
}

/* Between seasons there is no deadline ahead, the job correctly does nothing,
   and there is nothing to project. The engine tests below skip in that state
   rather than assert on an empty fixture list; this one holds the tool to the
   behaviour that actually matters there. */
test('with no deadline ahead, it declines instead of guessing', () => {
    if (anHourBeforeTheNextDeadline()) return;      // in season; covered below
    assert.equal(takeSnapshot({}).written, false);
});

// ---- the timing decision, on synthetic events so it is fully deterministic

const EVENTS = [
    { id: 4, deadline_time: '2026-09-12T12:30:00Z' },
    { id: 5, deadline_time: '2026-09-18T17:30:00Z' },
    { id: 6, deadline_time: '2026-10-10T10:00:00Z' }
];
const AT = iso => Date.parse(iso);
const HOURS = h => h * 3600000;

test('the next gameweek is the next deadline, not FPL\'s is_next flag', () => {
    // Mid-GW5: its deadline has passed, so the round being predicted is GW6.
    const c = chooseSnapshot(EVENTS, AT('2026-09-18T21:52:00Z'), HOURS(3), true);
    assert.equal(c.gw, 6);
});

test('outside the window it declines, and says how far out it is', () => {
    const c = chooseSnapshot(EVENTS, AT('2026-10-10T04:00:00Z'), HOURS(3), false);
    assert.equal(c.take, false);
    assert.equal(c.gw, 6, 'it still reports which round it is waiting for');
    assert.match(c.why, /6\.0h away/);
});

test('inside the window it takes it', () => {
    const c = chooseSnapshot(EVENTS, AT('2026-10-10T08:00:00Z'), HOURS(3), false);
    assert.equal(c.take, true);
    assert.equal(c.gw, 6);
    assert.equal(c.msLeft, HOURS(2));
});

test('--force skips the window but never the deadline itself', () => {
    const early = chooseSnapshot(EVENTS, AT('2026-09-20T00:00:00Z'), HOURS(3), true);
    assert.equal(early.take, true, 'forced, three weeks out, is allowed');

    /* The rule the archive depends on: nothing may be written for a round whose
       deadline has passed, however hard the caller insists. A snapshot taken
       after kick-off is not a prediction. */
    const late = chooseSnapshot(EVENTS.slice(0, 2), AT('2026-09-19T00:00:00Z'), HOURS(3), true);
    assert.equal(late.take, false);
    assert.match(late.why, /no deadline ahead of now/);
});

test('a season with nothing ahead of it declines rather than guessing', () => {
    assert.equal(chooseSnapshot([], Date.now(), HOURS(3), true).take, false);
    assert.equal(chooseSnapshot(null, Date.now(), HOURS(3), true).take, false);
});

// ---- the engine, over the data that is actually committed

test('the shipped engine loads outside a browser and reports itself ready', (t) => {
    const next = anHourBeforeTheNextDeadline();
    if (!next) return t.skip('no deadline ahead — between seasons');
    const { gw } = next;
    const fixtures = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data/fixtures.json'), 'utf8'));
    const { engine, players } = buildProjector(boot, fixtures, gw);

    assert.ok(players.length > 300, `xpBuildPlayers returned ${players.length}`);
    assert.ok(engine.positionAverages && Object.keys(engine.positionAverages).length >= 4,
        'position averages did not build, which is how the engine returns silent zeros');
    assert.ok(engine.teamAnalysis && Object.keys(engine.teamAnalysis).length >= 20,
        'team ratings did not build');
});

test('a snapshot of the next real gameweek is alive, not a page of zeros', (t) => {
    const snap = snapshotOnce();
    if (!snap) return t.skip('no deadline ahead — between seasons');
    const { gw, result: r } = snap;

    assert.equal(r.written, true, r.why || 'expected a snapshot an hour before a real deadline');
    assert.equal(r.gw, gw);
    assert.equal(r.meta.counts.failed, 0, 'no player should fail to project');

    const projected = r.rows.filter(x => x.xp != null);
    assert.ok(projected.length > 300, `only ${projected.length} players projected`);

    /* The failure this is really watching for: the fixture span not covering the
       round being projected, which turns every player into a blank and every
       projection into a legitimate-looking zero. */
    assert.ok(r.meta.counts.withFixture > 300,
        `only ${r.meta.counts.withFixture} players had a fixture in GW${gw} — the fixture span may not reach it`);

    const scoring = projected.filter(x => x.xp > 0);
    assert.ok(scoring.length > 200, `only ${scoring.length} players project above zero`);

    const best = Math.max(...projected.map(x => x.xp));
    assert.ok(best > 3 && best < 25, `top projection of ${best} is not a plausible one-gameweek score`);
});

test('every archived number is finite, and the ones that cannot be recovered are there', (t) => {
    const snap = snapshotOnce();
    if (!snap) return t.skip('no deadline ahead — between seasons');
    const { rows } = snap.result;

    for (const r of rows) {
        for (const k of ['xp', 'pStart', 'xMins', 'ep', 'ppg', 'form', 'sel', 'price']) {
            const v = r[k];
            assert.ok(v == null || Number.isFinite(v), `${k} is ${v} for player ${r.id}`);
        }
        if (r.pStart != null) {
            assert.ok(r.pStart >= 0 && r.pStart <= 1, `pStart ${r.pStart} out of range for ${r.id}`);
        }
        assert.ok('status' in r && 'chance' in r,
            `player ${r.id} is missing availability, which cannot be reconstructed later`);
    }

    // ep_next is the free baseline the whole exercise is measured against; if
    // FPL ever stops publishing it, the grading job loses its comparison.
    assert.ok(rows.filter(r => r.ep != null).length > 300, 'ep_next is missing for most players');
});

test('the file it would write parses back, and one player sits on one line', (t) => {
    const snap = snapshotOnce();
    if (!snap) return t.skip('no deadline ahead — between seasons');
    const { gw, result: { text, rows } } = snap;

    const parsed = JSON.parse(text);
    assert.equal(parsed.gw, gw);
    assert.equal(parsed.players.length, rows.length);
    assert.ok(parsed.note.includes('never edited'), 'the file should say what it is');
    assert.ok(parsed.model && 'assetVersion' in parsed.model,
        'the archive has to record which model version produced it');

    // Readable in a year: metadata over several lines, then one player per line.
    const lines = text.split('\n');
    assert.ok(lines.length > rows.length, 'players should not be crammed onto one line');
});

/* ---- the Rising Form board ---------------------------------------------- */

test('the rising board is archived beside the projections, from the shipped engine', (t) => {
    const snap = snapshotOnce();
    if (!snap) return t.skip('no deadline ahead — between seasons');
    const { result } = snap;

    /* This runs scripts/form-trend.js itself rather than a copy in Node. If the
       engine ever stops evaluating outside a browser the board goes empty and
       the snapshot still writes, which is the right trade for an unbackfillable
       archive — but it must not go empty quietly. */
    assert.equal(result.meta.risingError, undefined,
        `the board should build: ${result.meta.risingError || ''}`);
    assert.ok(result.rising.length > 0, 'somebody is always rising by GW5 or so');
    assert.equal(result.meta.counts.rising, result.rising.length);

    const parsed = JSON.parse(result.text);
    assert.equal(parsed.rising.length, result.rising.length, 'it survives serialisation');
});

test('every row says what the ranking was made of, not just its result', (t) => {
    const snap = snapshotOnce();
    if (!snap) return t.skip('no deadline ahead — between seasons');
    const board = snap.result.rising;

    /* A score with nothing beside it cannot be argued with a year later, and
       arguing with it later is the whole reason for writing it down. Ownership
       and the near-term FDR in particular are gone within hours: ownership
       moves continuously and the fixture list rolls forward. */
    board.forEach((r) => {
        for (const k of ['id', 'rank', 'score', 'pos', 'team', 'price', 'sel',
            'fdrNear', 'ppgRecent', 'ppgPrior', 'mpgRecent']) {
            assert.ok(Number.isFinite(r[k]), `row ${r.id} has a finite ${k}`);
        }
        assert.ok(Array.isArray(r.signals) && r.signals.length >= 2,
            `row ${r.id} carries the signals that put it there`);
    });

    // Ranks are dense and in score order — the archive IS the ordering.
    board.forEach((r, i) => assert.equal(r.rank, i + 1));
    for (let i = 1; i < board.length; i++) {
        assert.ok(board[i - 1].score >= board[i].score, 'ranked best first');
    }
});

test('the archived board agrees with the eligibility the engine publishes', (t) => {
    const snap = snapshotOnce();
    if (!snap) return t.skip('no deadline ahead — between seasons');
    const board = snap.result.rising;

    /* The two gates that exist to keep unbuyable players off it. A substitute
       and an injury are the failures this section shipped with, so they get an
       assertion against real data rather than a fixture. */
    board.forEach((r) => {
        assert.ok(r.mpgRecent >= 60, `row ${r.id} is a starter, not a substitute`);
        assert.ok(r.ppgRecent > r.ppgPrior, `row ${r.id} is actually ahead of himself`);
    });
});
