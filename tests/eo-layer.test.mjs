/* Effective ownership.

   The failures worth pinning here are all of the same kind: this layer produces
   numbers that look exactly as authoritative when they are guesses as when they
   are measured. A player the weekly sample never saw must not come back as a
   confident 0%, and a page loaded before the sample exists must fall back to
   plain ownership rather than telling every manager that nobody owns anybody. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load(data) {
    const ctx = { console };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    const f = 'scripts/eo-layer.js';
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInContext(ctx);
    if (data !== undefined) ctx.eoSetData(data);
    return ctx;
}

// Haaland-shaped: near-universal and heavily captained, so his effective
// ownership runs well past 100.
const table = {
    metadata: {
        lastUpdated: '2026-09-05T00:00:00Z', event: 3,
        tiers: [
            { id: 'top1k', label: 'Top 1k', rankTo: 1000, sampled: 400 },
            { id: 'top10k', label: 'Top 10k', rankTo: 10000, sampled: 400 }
        ]
    },
    players: {
        '355': { top1k: { eo: 145.0, own: 75.3, cap: 69.8 }, top10k: { eo: 148.0, own: 74.8, cap: 71.8 } },
        '401': { top1k: { eo: 120.8, own: 95.3, cap: 25.5 }, top10k: { eo: 107.5, own: 86.8, cap: 17.5 } },
        '99':  { top1k: { eo: 30.3, own: 37.3, cap: 0 },     top10k: { eo: 32.8, own: 39.5, cap: 0 } },
        '7':   { top1k: { eo: 4.0, own: 4.0, cap: 0 },       top10k: { eo: 3.0, own: 3.0, cap: 0 } }
    }
};

test('effective ownership is not headcount', () => {
    /* The whole reason the layer exists. Two players owned by roughly the same
       share of the top 10k carry completely different amounts of that field,
       because one of them is the captain. */
    const eo = load(table);
    const haaland = eo.eoFor('355', 'top10k');
    assert.equal(haaland.own, 74.8, 'three-quarters own him');
    assert.equal(haaland.eo, 148.0, 'but he carries twice that, because most of them captain him');
    assert.ok(haaland.eo > 100, 'effective ownership can exceed 100 and must not be clamped');
});

test('the same player can be template at the top and a differential below it', () => {
    // Isak-shaped, and the insight plain ownership cannot express.
    const eo = load(table);
    assert.equal(eo.eoBand(eo.eoFor('401', 'top1k').eo), 'template');
    assert.equal(eo.eoBand(eo.eoFor('99', 'top10k').eo), 'mid');
    assert.equal(eo.eoBand(eo.eoFor('7', 'top10k').eo), 'differential');
});

test('a player the sample never saw is reported as below resolution, not as zero', () => {
    /* With four hundred managers a tier, one owner is 0.25% — so anything
       rarer is indistinguishable from nobody, and printing a flat 0% would be
       a stronger claim than the sample can support. */
    const eo = load(table);
    const unseen = eo.eoFor('99999', 'top10k');
    assert.equal(unseen.eo, 0);
    assert.equal(unseen.below, true, 'flagged as beneath what the sample can see');
    assert.equal(eo.eoResolution('top10k'), 0.25);
    assert.equal(eo.eoText(unseen), 'under 0.25%');
    assert.equal(eo.eoText(eo.eoFor('355', 'top10k')), '148%', 'a measured value states itself plainly');
});

test('with no table at all the layer says so instead of guessing', () => {
    // A page can load before the weekly sample has ever run, or after a failed
    // one. Callers fall back to plain ownership on null; a zero would tell every
    // manager that nobody owns anybody.
    const eo = load(null);
    assert.equal(eo.eoReady(), false);
    assert.equal(eo.eoFor('355', 'top10k'), null);
    assert.equal(eo.eoSwing('355', '401'), null);
    assert.equal(eo.eoSquadLoad([{ id: 355 }]), null);
});

test('a malformed feed is refused rather than half-read', () => {
    for (const bad of [undefined, {}, { players: {} }, { metadata: {} }, { metadata: {}, players: null }]) {
        assert.equal(load(bad).eoReady(), false, `refused: ${JSON.stringify(bad)}`);
    }
});

test('a transfer is measured by how much of the field it sheds', () => {
    const eo = load(table);
    const swing = eo.eoSwing('355', '7', 'top10k');   // template captain out, differential in
    assert.equal(swing.delta, -145, 'shedding almost the whole field');
    assert.equal(swing.label, 'Top 10k', 'and it says which field');

    const back = eo.eoSwing('7', '355', 'top10k');
    assert.equal(back.delta, 145, 'and the reverse is symmetric');
});

test('the default tier is the one most managers are chasing', () => {
    const eo = load(table);
    assert.equal(eo.eoFor('355').tier, 'top10k', 'no tier named means top 10k');
    assert.equal(eo.eoFor('355').eo, eo.eoFor('355', 'top10k').eo);
});

test('a squad load counts the captain twice', () => {
    /* He is doubled in the sample, so he has to be doubled in the comparison.
       Counting him once would understate exposure by the single largest
       decision in the team. */
    const eo = load(table);
    const squad = [
        { id: 355, pickPosition: 1, isCaptain: true },
        { id: 99, pickPosition: 2 }
    ];
    const load1 = eo.eoSquadLoad(squad, 'top10k');
    assert.equal(load1.total, 148 * 2 + 32.8);
    assert.equal(load1.counted, 2);

    const noCap = eo.eoSquadLoad(squad.map(p => ({ ...p, isCaptain: false })), 'top10k');
    assert.equal(noCap.total, 148 + 32.8, 'without the armband he counts once');
});

test('bench players are left out of the squad load', () => {
    // They do not score, so they carry none of the field.
    const eo = load(table);
    const withBench = eo.eoSquadLoad([
        { id: 355, pickPosition: 1 },
        { id: 401, pickPosition: 12 }
    ], 'top10k');
    assert.equal(withBench.counted, 1, 'only the starter counts');
    assert.equal(withBench.total, 148);
});

test('the shipped table matches the shape the layer expects', () => {
    /* The feed is produced by a separate tool on a weekly schedule. If its
       shape drifts, every consumer silently falls back to plain ownership and
       nothing on the page looks broken. */
    const real = JSON.parse(fs.readFileSync('data/eo.json', 'utf8'));
    const eo = load(real);
    assert.equal(eo.eoReady(), true, 'the committed file loads');

    /* Against the layer's own list rather than a copy of it, so a tier added
       to the sampler and forgotten in the accessor — or the reverse — fails
       here instead of rendering an empty panel. */
    const tiers = real.metadata.tiers.map(t => t.id);
    assert.deepEqual([...tiers], [...vm.runInContext('EO_TIERS', eo)],
        'the shipped tiers are exactly the ones the layer knows about');
    for (const t of real.metadata.tiers) {
        assert.ok(t.sampled >= 100, `${t.id} sampled ${t.sampled} managers`);
    }

    const ids = Object.keys(real.players);
    assert.ok(ids.length > 20, `a usable number of players, got ${ids.length}`);
    for (const id of ids) {
        for (const t of tiers) {
            const v = real.players[id][t];
            if (!v) continue;
            assert.ok(v.eo >= 0 && v.eo <= 300, `${id} ${t} eo in range: ${v.eo}`);
            assert.ok(v.own >= 0 && v.own <= 100, `${id} ${t} ownership is a percentage: ${v.own}`);
            assert.ok(v.cap <= v.own + 0.01, `${id} ${t}: cannot be captained by more than own him`);
            /* Effective ownership can sit either side of plain ownership, and
               both directions are meaningful. Above it means captaincy — the
               armband adds a second share. Below it means the bench: Egan is
               owned by 38% of the top 10k and started by 1%, so headcount calls
               him template while the number that matters says nobody plays him.
               What it cannot exceed is everyone starting him and the captains
               counting again, allowing a Triple Captain its third share. */
            assert.ok(v.eo <= v.own + 2 * v.cap + 0.01,
                `${id} ${t}: eo ${v.eo} exceeds what ${v.own}% owning and ${v.cap}% captaining can produce`);
        }
    }
});

/* ===== Your mini-league =====

   The one tier that cannot be shipped, because it is different for every
   person who opens the page — and the one that decides most people's season,
   since nobody is really competing with the top 10k. It is sampled in the
   browser and held apart from the committed table, which is the source of the
   failures worth pinning: it must be available when the file is not, and
   absent when it has not been sampled, whatever the file says. */

test('the league tier is answered from its own data, not the shipped file', () => {
    const eo = load(table);
    assert.equal(eo.eoFor('355', 'league'), null, 'not sampled yet, so no answer');

    eo.eoSetLeague({
        leagueId: 12345, gw: 4, label: 'Work league', sampled: 20,
        players: { '355': { eo: 190, own: 95, cap: 95 }, '7': { eo: 5, own: 5, cap: 0 } }
    });
    assert.equal(eo.eoFor('355', 'league').eo, 190, 'the league is far more on him than the top 10k');
    assert.equal(eo.eoFor('355', 'top10k').eo, 148, 'and the shipped tiers are untouched');
    assert.equal(eo.eoTierLabel('league'), 'Work league', 'named after the league itself');
    assert.equal(eo.eoResolution('league'), 5, 'twenty managers means five-point steps');
});

test('a player nobody in the league owns is below resolution, not zero', () => {
    // Twenty managers cannot express less than 5%, so a flat 0 would be a
    // stronger claim than the sample supports.
    const eo = load(table);
    eo.eoSetLeague({ leagueId: 1, gw: 4, label: 'L', sampled: 20, players: { '355': { eo: 100, own: 100, cap: 0 } } });
    const unseen = eo.eoFor('401', 'league');
    assert.equal(unseen.below, true);
    assert.equal(eo.eoText(unseen), 'under 5%');
});

test('the league tier works even with no shipped table at all', () => {
    /* It is sampled live, so it does not depend on the weekly job having run.
       Reading it through the same accessor must not fall foul of the guard
       that protects the committed tiers. */
    const eo = load(null);
    assert.equal(eo.eoReady(), false, 'no shipped file');
    eo.eoSetLeague({ leagueId: 9, gw: 4, label: 'L', sampled: 12, players: { '355': { eo: 80, own: 80, cap: 0 } } });
    assert.equal(eo.eoFor('355', 'league').eo, 80);
    assert.equal(eo.eoFor('355', 'top10k'), null, 'while the shipped tiers stay unavailable');
});

test('eoLeagueReady is specific about which league and gameweek', () => {
    // A league sampled for GW3 says nothing about GW4 — every manager may have
    // transferred since, which is exactly what a deadline is.
    const eo = load(table);
    eo.eoSetLeague({ leagueId: 77, gw: 4, label: 'L', sampled: 20, players: {} });
    assert.equal(eo.eoLeagueReady(77, 4), true);
    assert.equal(eo.eoLeagueReady(77, 5), false, 'a new gameweek needs a new sample');
    assert.equal(eo.eoLeagueReady(78, 4), false, 'and so does a different league');
    assert.equal(eo.eoLeagueReady(), true, 'asking loosely is allowed');
});

test('a malformed league sample is refused', () => {
    const eo = load(table);
    eo.eoSetLeague({ leagueId: 1, gw: 4, sampled: 20, players: { '355': { eo: 10, own: 10, cap: 0 } } });
    assert.equal(eo.eoLeagueReady(), true);
    for (const bad of [null, undefined, {}, { leagueId: 1 }]) {
        assert.equal(eo.eoSetLeague(bad), null, `refused: ${JSON.stringify(bad)}`);
        assert.equal(eo.eoLeagueReady(), false);
    }
});

test('a squad load can be taken against the league', () => {
    const eo = load(table);
    eo.eoSetLeague({
        leagueId: 1, gw: 4, label: 'L', sampled: 20,
        players: { '355': { eo: 190, own: 95, cap: 95 }, '99': { eo: 40, own: 40, cap: 0 } }
    });
    const load1 = eo.eoSquadLoad([
        { id: 355, pickPosition: 1, isCaptain: true },
        { id: 99, pickPosition: 2 }
    ], 'league');
    assert.equal(load1.total, 190 * 2 + 40, 'captain still counts twice');
    assert.equal(load1.label, 'L');
});
