/* Why a Premier League round was never once fully priced.

   data/odds.json was replaced outright on every successful run. The source,
   football-data.co.uk's fixtures.csv, carries roughly two days of fixtures; a
   Premier League round runs Friday to Monday. So no single run can see all ten
   games, and every run threw away the ones the last run had found.

   The evidence: on 19 September it wrote five of ten, and five of ten is what
   the site still held on 7 October — through an international break, with a
   scheduled job reporting success four times a day. coverage.complete could
   therefore never become true, and boMarketXGA(), which refuses to blend the
   market unless a round is complete, had almost certainly never returned a
   number since it was written.

   These pin the merge that fixes it. The other half of the fix — removing the
   five-fixture floor that refused to write a partial round — is what made the
   accumulation reachable, and is asserted at the bottom by reading the source.*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mergeHeldOdds } from '../tools/fetch-odds.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

const T = (iso) => Date.parse(iso);
const NOW = T('2026-10-09T12:00:00Z');          // Friday, GW6 opens the 10th

/** A priced fixture, reduced to what the merge reads. */
const fx = (fixtureId, kickoff, extra = {}) => ({
    fixtureId, kickoff, event: 6, drawError: 0.01, ...extra
});

test('a later run adds to what an earlier one priced', () => {
    /* The whole bug. Friday's run sees two games, Saturday's run sees two more,
       and the round has four rather than two. */
    const held = [fx(1, '2026-10-10T11:30:00Z'), fx(2, '2026-10-10T14:00:00Z')];
    const fresh = [fx(3, '2026-10-11T13:00:00Z'), fx(4, '2026-10-12T19:00:00Z')];
    const out = mergeHeldOdds(held, fresh, NOW);
    assert.deepEqual(out.map(m => m.fixtureId), [1, 2, 3, 4]);
});

test('a re-priced fixture takes the newer price', () => {
    /* A fixture priced again closer to kick-off is better information, and the
       run holding it is the later one. */
    const held = [fx(1, '2026-10-10T11:30:00Z', { winHome: 0.40 })];
    const fresh = [fx(1, '2026-10-10T11:30:00Z', { winHome: 0.55 })];
    const out = mergeHeldOdds(held, fresh, NOW);
    assert.equal(out.length, 1, 'not duplicated');
    assert.equal(out[0].winHome, 0.55);
});

test('a fixture that has kicked off is dropped', () => {
    /* Not housekeeping. Without this the file grows without bound and keeps
       serving prices for games already played — which is precisely what was on
       screen for the whole of the September break. */
    const held = [
        fx(1, '2026-10-09T11:30:00Z'),               // yesterday's, relative to NOW
        fx(2, '2026-10-10T14:00:00Z')
    ];
    const out = mergeHeldOdds(held, [], NOW);
    assert.deepEqual(out.map(m => m.fixtureId), [2]);
});

test('a fixture kicking off this instant is already gone', () => {
    const out = mergeHeldOdds([fx(1, new Date(NOW).toISOString())], [], NOW);
    assert.deepEqual(out.map(m => m.fixtureId), []);
});

test('a fresh price for a match already under way is not kept either', () => {
    /* The source has been known to still list a fixture after kick-off. A price
       is a forecast; once the whistle has gone it is not one. */
    const out = mergeHeldOdds([], [fx(1, '2026-10-09T09:00:00Z')], NOW);
    assert.deepEqual(out.map(m => m.fixtureId), []);
});

test('the result is in kick-off order however the inputs arrived', () => {
    const held = [fx(3, '2026-10-12T19:00:00Z'), fx(1, '2026-10-10T11:30:00Z')];
    const fresh = [fx(2, '2026-10-11T13:00:00Z')];
    assert.deepEqual(mergeHeldOdds(held, fresh, NOW).map(m => m.fixtureId), [1, 2, 3]);
});

test('an unreadable kick-off is kept rather than silently binned', () => {
    /* Dropping on a parse failure would lose a real price to a formatting
       change upstream. Keeping it means the worst case is one stale row, which
       the next successful run overwrites. */
    const out = mergeHeldOdds([fx(1, 'not-a-date')], [], NOW);
    assert.deepEqual(out.map(m => m.fixtureId), [1]);
});

test('nothing held and nothing fresh is nothing, not a crash', () => {
    assert.deepEqual(mergeHeldOdds([], [], NOW), []);
    assert.deepEqual(mergeHeldOdds(null, null, NOW), []);
    assert.deepEqual(mergeHeldOdds(undefined, [fx(1, '2026-10-10T11:30:00Z')], NOW).map(m => m.fixtureId), [1]);
});

test('two rounds can be held at once', () => {
    /* The tail of one gameweek and the head of the next are both in the future
       and both legitimately priced; coverage reports each separately. */
    const held = [fx(1, '2026-10-10T11:30:00Z', { event: 6 })];
    const fresh = [fx(9, '2026-10-17T11:30:00Z', { event: 7 })];
    const out = mergeHeldOdds(held, fresh, NOW);
    assert.deepEqual(out.map(m => m.event), [6, 7]);
});

test('a round accumulates to complete across several runs', () => {
    /* The end state the whole change exists for: coverage.complete becomes
       reachable, which is the gate boMarketXGA() waits on. */
    const kick = (i) => `2026-10-1${i < 5 ? 0 : 1}T1${i % 5}:00:00Z`;
    let file = [];
    for (let run = 0; run < 5; run++) {
        const batch = [fx(run * 2, kick(run * 2)), fx(run * 2 + 1, kick(run * 2 + 1))];
        file = mergeHeldOdds(file, batch, NOW);
    }
    assert.equal(file.length, 10, 'ten fixtures from five runs of two');
    assert.equal(new Set(file.map(m => m.fixtureId)).size, 10, 'no duplicates');
});

test('the five-fixture write floor is gone', () => {
    /* It refused to write unless one run priced five, reasoning that a partial
       round is no use. The second half of that is still enforced downstream, by
       coverage.complete and boMarketXGA reading it. The first half guaranteed
       the completeness it was waiting for could never arrive, because a round
       only becomes complete by accumulating partials. */
    const src = fs.readFileSync(path.join(ROOT, 'tools/fetch-odds.mjs'), 'utf8');
    assert.ok(!/MIN_FIXTURES/.test(src),
        'the per-run fixture floor must not come back without the merge being reconsidered');
    assert.ok(/mergeHeldOdds\(held, matches, now\)/.test(src),
        'the write path must merge rather than replace');
});
