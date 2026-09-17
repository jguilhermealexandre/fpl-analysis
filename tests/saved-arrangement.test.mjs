/* The arrangement a manager makes on Squad Analysis, read back elsewhere.
 *
 * Three views claim to know who your captain is: the pitch, the squad table
 * under it, and the dashboard's readiness panel. Until this landed they were
 * three separate states seeded from the same API response and never
 * reconciled — move the armband on the pitch and the table below went on
 * showing the old one, and the dashboard warned about a captain you had
 * already changed while linking to the page where you had changed it.
 *
 * lsApplyToSquad is the join. It lays a saved arrangement over a squad built
 * from the picks endpoint, which is the shape every readiness check reads.
 *
 * What is tested here is the part that decides what a manager is TOLD. The
 * refusals matter as much as the successes: a half-applied lineup is
 * indistinguishable from a deliberate one, which is the worst possible
 * failure for a page whose job is to tell you what is wrong with your team.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadFunction } from './helpers/load.mjs';

const lsApplyToSquad = loadFunction('scripts/lineup-store.js', 'lsApplyToSquad');

/* readiness.js is a classic script, so it is evaluated in a sandbox the same
   way tests/readiness.test.mjs does it. */
function loadReadiness() {
    const ctx = {
        console,
        escHTML: s => String(s == null ? '' : s),
        expectedMinutesModel: () => ({ pStart: 0.92, expMins: 85 })
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    const f = 'scripts/readiness.js';
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInContext(ctx);
    return ctx;
}
const { rdBuild } = loadReadiness();

/* Fifteen players, numbered as FPL numbers them: 1–11 start, 12–15 on the
   bench, captain and vice as the API last reported them. */
function squad() {
    return Array.from({ length: 15 }, (_, i) => {
        const id = i + 1;
        return {
            id,
            pickPosition: id,
            isCaptain: id === 1,
            isViceCaptain: id === 2,
            onBench: id > 11,
            multiplier: id === 1 ? 2 : (id > 11 ? 0 : 1)
        };
    });
}

const XI = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];   // 12 comes on for 11
const BENCH = [11, 13, 14, 15];

test('a saved arrangement replaces the eleven the API reported', () => {
    const sq = squad();
    assert.equal(lsApplyToSquad(sq, { xi: XI, bench: BENCH, captain: 5, vice: 3 }), true);
    const by = Object.fromEntries(sq.map(p => [p.id, p]));

    assert.equal(by[12].onBench, false, 'the substitute is starting');
    assert.equal(by[11].onBench, true, 'and the man he replaced is not');
    assert.equal(sq.filter(p => !p.onBench).length, 11, 'still eleven');
});

test('the armband follows the arrangement, not the API', () => {
    const sq = squad();
    lsApplyToSquad(sq, { xi: XI, bench: BENCH, captain: 5, vice: 3 });
    const by = Object.fromEntries(sq.map(p => [p.id, p]));

    assert.equal(by[5].isCaptain, true);
    assert.equal(by[1].isCaptain, false, 'the API captain gives it up');
    assert.equal(sq.filter(p => p.isCaptain).length, 1, 'exactly one captain');
    assert.equal(by[3].isViceCaptain, true);
    assert.equal(by[3].isVice, true, 'both spellings, because both are read somewhere');
    assert.equal(by[5].multiplier, 2, 'and the captain doubles');
    assert.equal(by[11].multiplier, 0, 'a benched player scores nothing');
});

test('bench order is a decision, so it is restored', () => {
    // It decides which substitute comes on first, which is the whole of what
    // an auto-sub does.
    const sq = squad();
    lsApplyToSquad(sq, { xi: XI, bench: [15, 14, 13, 11], captain: 5, vice: 3 });
    const by = Object.fromEntries(sq.map(p => [p.id, p]));
    assert.equal(by[15].pickPosition, 12, 'first off the bench');
    assert.equal(by[11].pickPosition, 15, 'last');
});

test('an armband on a benched player is not honoured', () => {
    /* FPL pays nothing for it, so reporting it would have the dashboard
       describing an armband that cannot score. */
    const sq = squad();
    lsApplyToSquad(sq, { xi: XI, bench: BENCH, captain: 11, vice: 3 });
    assert.equal(sq.filter(p => p.isCaptain).length, 0);
});

test('captain and vice are never the same player', () => {
    const sq = squad();
    lsApplyToSquad(sq, { xi: XI, bench: BENCH, captain: 5, vice: 5 });
    assert.equal(sq.filter(p => p.isCaptain).length, 1);
    assert.equal(sq.filter(p => p.isViceCaptain).length, 0, 'the vice slot is left empty rather than doubled up');
});

test('an arrangement naming a player who has been transferred out is refused whole', () => {
    /* The reason this is all-or-nothing. A saved eleven can name somebody sold
       since, and restoring the other ten would put a legal-looking lineup on
       screen that the manager never chose. */
    const sq = squad();
    assert.equal(lsApplyToSquad(sq, { xi: [...XI.slice(0, 10), 99], bench: BENCH, captain: 5, vice: 3 }), false);
    assert.equal(sq[0].isCaptain, true, 'and nothing was mutated on the way to refusing');
    assert.equal(sq[0].pickPosition, 1);
});

test('nonsense is refused rather than half-applied', () => {
    assert.equal(lsApplyToSquad(null, { xi: XI }), false);
    assert.equal(lsApplyToSquad(squad(), null), false);
    assert.equal(lsApplyToSquad(squad(), {}), false);
    assert.equal(lsApplyToSquad(squad(), { xi: [1, 2, 3] }), false, 'a short eleven');
    assert.equal(lsApplyToSquad([], { xi: XI }), false);
});

test('the transfer check waits for a Sell verdict', () => {
    /* Run for real, through rdBuild, because a gate asserted against its own
       source only proves the line is still typed there.

       The recommender will always find SOME move worth a fraction of a point,
       so ungated this row never cleared — a permanent open item on a checklist
       whose entire purpose is reaching zero. */
    const rec = {
        best: { n: 1, net: 2.4, cost: 0, moves: [{ out: { id: 1, name: 'Out' }, in: { id: 99, name: 'In' } }] },
        gws: [12, 13, 14]
    };
    const squadOf = () => [{ id: 1, name: 'Out', pickPosition: 1, status: 'a', isCaptain: true }];

    const withVerdict = v => rdBuild({
        squad: squadOf(), analysisResults: [{ verdict: v, topConcern: 'Rated Sell' }],
        transferRec: rec, now: Date.parse('2026-01-15T12:00:00Z')
    });

    const rows = c => (c.checks.find(x => x.id === 'transfer') || {}).rows || [];

    for (const quiet of ['hold', 'monitor', 'star', 'watch', 'essential']) {
        assert.equal(rows(withVerdict(quiet)).length, 0,
            `${quiet} is a rating that means keep him — it must not raise a transfer alert`);
    }
    assert.equal(rows(withVerdict('sell')).length, 1, 'a Sell verdict opens it');
});
