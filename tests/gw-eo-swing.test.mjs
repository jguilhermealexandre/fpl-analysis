/* What a gameweek did to your RANK, rather than to your score.

   Rank moves on the gap between what you got and what the field got, and the
   field's holding of a player is his effective ownership — the share of teams
   owning him, counting a captain twice. For one player:

       swing = (your multiplier - EO/100) x his points

   Checked against the real GW5 sample before this was written: the manager's
   biggest single item was Groß, benched, 14 points, 71% EO — a 9.9-point rank
   cost for a player he owned and did not play. Haaland at 186% EO, captained,
   six points, came to +0.9: owned more than once over by the field, so even a
   captained return barely moves you.

   These tests are about the refusals. The formula is three published numbers
   multiplied together and is hard to get wrong; what is easy to get wrong is
   answering at all when the sample cannot support an answer. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const SRC = 'scripts/gameweek-review.js';

/** EO rows keyed by player id, in the shape data/eo.json uses. */
function harness({ event = 5, eoRows = {}, points = {}, players = {} } = {}) {
    const eoData = { metadata: { event, tiers: [{ id: 'top10k', label: 'Top 10k', sampled: 400 }] }, players: eoRows };
    return {
        EO_DEFAULT_TIER: 'top10k',
        eoData,
        eoReady: () => true,
        eoMeta: () => eoData.metadata,
        eoTierLabel: () => 'Top 10k',
        eoResolution: () => 0.25,
        eoFor: (id, tier) => {
            const row = eoRows[String(id)];
            const v = row && row[tier];
            if (!v) return { eo: 0, own: 0, cap: 0, below: true, tier };
            return { eo: v.eo, own: v.own ?? v.eo, cap: v.cap ?? 0, below: !!v.below, tier };
        },
        allPlayersById: players,
        gwPlayerStats: (p) => ({ points: points[p.id] ?? 0 })
    };
}

const load = (stubs) => loadFunction(SRC, 'gwEoSwings', stubs);
const entry = (id, name, multiplier, raw) => ({ player: { id, name }, multiplier, raw });
const eoRow = (eo, extra = {}) => ({ top10k: { eo, ...extra } });

test('a player the field owns more than once over costs you when he scores', () => {
    /* The headline case from the PRD. EO 120, you own him once: the average team
       had 1.2 of him and you had 1, so his goal moves you backwards. */
    const fn = load(harness({ eoRows: { 1: eoRow(120) }, points: { 1: 10 } }));
    const r = fn(5, [entry(1, 'Template', 1, 10)], null);
    assert.equal(r.net, -2, '(1 - 1.2) x 10');
    assert.equal(r.lost.length, 1);
    assert.equal(r.gained.length, 0);
});

test('captaining that same player turns it into a gain', () => {
    const fn = load(harness({ eoRows: { 1: eoRow(120) }, points: { 1: 10 } }));
    assert.equal(fn(5, [entry(1, 'Template', 2, 10)], null).net, 8, '(2 - 1.2) x 10');
});

test('a week where nothing moved renders nothing at all', () => {
    /* Every swing is a multiple of somebody's points, so a round in which nobody
       the sample knows about scored moves no one. The section would otherwise
       announce "worth +0.0 points of ground" above an empty list, and a heading
       with no finding under it reads as broken rather than as a quiet week. */
    const fn = load(harness({
        eoRows: { 1: eoRow(90) }, points: { 1: 0, 2: 0 },
        players: { 2: { id: 2, name: 'Missed' } }
    }));
    assert.equal(fn(5, [entry(1, 'Owned', 1, 0)], null), null);
});

test('a big score you did not own is charged at the full EO', () => {
    const fn = load(harness({
        eoRows: { 1: eoRow(50), 9: eoRow(40) },
        points: { 1: 2, 9: 15 },
        players: { 9: { id: 9, name: 'TheOneYouMissed' } }
    }));
    const r = fn(5, [entry(1, 'Yours', 1, 2)], null);
    // yours: (1 - 0.5) x 2 = +1 ; missed: -(0.4) x 15 = -6
    assert.equal(r.net, -5);
    assert.equal(r.lost[0].player.name, 'TheOneYouMissed');
    assert.equal(r.lost[0].owned, false);
});

test('a blank you did not own moves nobody and is left out', () => {
    const fn = load(harness({
        eoRows: { 1: eoRow(50), 9: eoRow(40) },
        points: { 1: 0, 9: 0 },
        players: { 9: { id: 9, name: 'Blanked' } }
    }));
    assert.equal(fn(5, [entry(1, 'Yours', 1, 0)], null), null, 'nothing to say');
});

/* ---- the refusals ---- */

test('it refuses when the sample is for a different gameweek', () => {
    /* Ownership moves every week. Explaining GW5 with GW6's ownership would be a
       true number about the wrong week, which costs as much trust as a false
       one. */
    const fn = load(harness({ event: 6, eoRows: { 1: eoRow(120) }, points: { 1: 10 } }));
    assert.equal(fn(5, [entry(1, 'Template', 1, 10)], null), null);
});

test('a player below the sample resolution is skipped, not counted as zero', () => {
    /* "No owners" and "fewer than one in four hundred" are different claims, and
       treating the second as the first would charge a manager the full points of
       a player the sample simply cannot see. */
    const fn = load(harness({
        eoRows: { 1: eoRow(120), 9: eoRow(0, { below: true }) },
        points: { 1: 10, 9: 20 },
        players: { 9: { id: 9, name: 'TooRare' } }
    }));
    const r = fn(5, [entry(1, 'Template', 1, 10)], null);
    assert.equal(r.net, -2, 'the unseeable player contributes nothing');
    assert.ok(!r.lost.concat(r.gained).some(x => x.player.name === 'TooRare'));
});

test('it refuses when there is no EO layer at all', () => {
    const base = harness({ eoRows: { 1: eoRow(120) }, points: { 1: 10 } });
    assert.equal(load({ ...base, eoReady: () => false })(5, [entry(1, 'A', 1, 10)], null), null);
    assert.equal(load({ ...base, eoMeta: () => null })(5, [entry(1, 'A', 1, 10)], null), null);
});

test('it reports which tier and how many managers, so the copy can say so', () => {
    const fn = load(harness({ eoRows: { 1: eoRow(120) }, points: { 1: 10 } }));
    const r = fn(5, [entry(1, 'Template', 1, 10)], null);
    assert.equal(r.tierLabel, 'Top 10k');
    assert.equal(r.sampled, 400);
    assert.equal(r.resolution, 0.25);
});

test('the biggest movers come first, by size either way', () => {
    const fn = load(harness({
        eoRows: { 1: eoRow(10), 2: eoRow(150) },
        points: { 1: 2, 2: 12 }
    }));
    const r = fn(5, [entry(1, 'Small', 1, 2), entry(2, 'Huge', 1, 12)], null);
    // Small: (1-0.1)x2 = +1.8 ; Huge: (1-1.5)x12 = -6
    assert.equal(r.lost[0].player.name, 'Huge');
    assert.equal(r.gained[0].player.name, 'Small');
    assert.equal(r.net, -4.2);
});
