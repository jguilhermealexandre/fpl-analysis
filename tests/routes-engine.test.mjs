/* Which ways a player scores, and which of them count.

   Two rules carry this file. A route pays FPL points — if it does not, it is a
   signal, shown and counted at zero, because a route count that includes things
   that pay nothing is not a count of anything. And defensive contribution is
   measured by hit rate, because the two points come off a cliff: ten actions
   pays and nine pays nothing, so an average is the wrong shape of answer and
   would call a player who has never once cleared it a two-point-a-week asset. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const R = 'scripts/routes-engine.js';

const rtRateOverAppearances = loadFunction(R, 'rtRateOverAppearances', {
    RT_RATE_WINDOW: 10, RT_RATE_MIN: 3
});
const rtDefConThreshold = loadFunction(R, 'rtDefConThreshold', {
    DC_THRESHOLD: { 1: Infinity, 2: 10, 3: 12, 4: 12 }
});
const rtDefConHit = loadFunction(R, 'rtDefConHit', { rtDefConThreshold, rtRateOverAppearances });
const rtDefConRoute = loadFunction(R, 'rtDefConRoute', {
    rtDefConHit, RT_DEFCON_FLOOR: 0.30, RT_DEFCON_CEIL: 0.60, DC_POINTS: 2,
    RT_ROUTE_META: { defCon: { label: 'Defensive contribution', color: '#38BDF8' } }
});

/* The engine's own meta and thresholds, injected the way the page supplies
   them. routesFor reaches for teamAnalysis and the projection; neither is
   needed for membership, and both are absent here on purpose — the route rules
   must not depend on a model being loaded. */
const RT_ROUTE_META = {
    goals: { label: 'Goals', color: '#F87171' },
    assists: { label: 'Assists', color: '#60A5FA' },
    cleanSheet: { label: 'Clean sheets', color: '#34D399' },
    defCon: { label: 'Defensive contribution', color: '#38BDF8' },
    saves: { label: 'Saves', color: '#A78BFA' },
    bonus: { label: 'Bonus', color: '#FBBF24' },
    penalties: { label: 'Penalties', color: '#F472B6' },
    appearance: { label: 'Appearance', color: '#94A3B8' },
    creativity: { label: 'Creativity', color: '#FB923C' }
};
const rtFixtureFactor = () => 1;
const routesFor = loadFunction(R, 'routesFor', {
    RT_POS: { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' },
    RT_ROUTE_META, rtDefConRoute, rtDefConHit, rtFixtureFactor,
    rtPointSources: () => null
});

// A match he played, with `dc` defensive actions in it.
const m = (dc, over = {}) => ({ minutes: 90, defensive_contribution: dc, ...over });

const player = (over = {}) => ({
    id: 1, position: 2, price: 5.0,
    history: [m(12), m(11), m(3), m(2)],
    l5: { games: 4, minutes: 360, xG: 0.2, xA: 0.2, goals: 0, assists: 0, cleanSheets: 1,
        bonus: 0.4, saves: 0, creativity: 20, goalsConceded: 4, defCon: 28 },
    season: { games: 4, minutes: 360, xG: 0.2, xA: 0.2, goals: 0, assists: 0, cleanSheets: 1,
        bonus: 0.4, saves: 0, creativity: 20, goalsConceded: 4, defCon: 28 },
    ...over
});

const keys = r => r.routes.map(x => x.key);

test('defensive contribution is a route when he actually clears the threshold', () => {
    const r = routesFor(player());
    assert.ok(keys(r).includes('defCon'), 'two of four is above the bar');
    const dc = r.routes.find(x => x.key === 'defCon');
    assert.equal(dc.detail, '10+ in 2 of 4', 'the sample is stated, not just the rate');
    assert.equal(dc.ptWeight, 2);
});

test('a high average that never clears the line is not a route', () => {
    /* The whole reason this is a hit rate. Nine actions every week averages 9.0
       — higher than a man who alternates 4 and 15 — and pays nothing at all,
       while the alternating one banks it every other week. An average cannot
       tell those two apart and would rank the wrong one first. */
    const steady = routesFor(player({ history: [m(9), m(9), m(9), m(9)] }));
    assert.equal(keys(steady).includes('defCon'), false, 'nine is not ten');

    const lumpy = routesFor(player({ history: [m(4), m(15), m(4), m(15)] }));
    assert.ok(keys(lumpy).includes('defCon'), 'cleared it in half his matches');
});

test('goalkeepers cannot score it and are not asked', () => {
    const gk = routesFor(player({ position: 1, history: [m(99), m(99), m(99)] }));
    assert.equal(keys(gk).includes('defCon'), false);
    assert.equal(rtDefConHit({ position: 1, history: [m(99), m(99), m(99)] }), null,
        'no rate is offered for a player the rule does not apply to');
});

test('forwards are eligible on the rare occasion one qualifies', () => {
    // Nobody in the league currently does. That is a fact about this season, not
    // a reason to write the position out of the rule.
    const quiet = routesFor(player({ position: 4, history: [m(5), m(6), m(4), m(5)] }));
    assert.equal(keys(quiet).includes('defCon'), false);

    const holding = routesFor(player({ position: 4, history: [m(13), m(14), m(3), m(12)] }));
    assert.ok(keys(holding).includes('defCon'), 'three of four at the forward threshold');
    assert.equal(holding.routes.find(x => x.key === 'defCon').detail, '12+ in 3 of 4');
});

test('a rate needs enough appearances to be a rate', () => {
    // Two of two is 100% and means nothing. Below the minimum there is no claim
    // to make, in either direction.
    assert.equal(rtDefConHit({ position: 2, history: [m(15), m(15)] }), null);
    const hit = rtDefConHit({ position: 2, history: [m(15), m(15), m(15)] });
    assert.equal(hit.rate, 1);
    assert.equal(hit.n, 3);
});

test('a row he did not play is not a match he failed to clear it in', () => {
    // FPL writes a row for an unused substitute. Counting it would put a zero in
    // the numerator and a one in the denominator for a game he watched.
    const hit = rtDefConHit({ position: 2, history: [m(15), m(15), m(0, { minutes: 0 }), m(15)] });
    assert.equal(hit.n, 3, 'three appearances, not four rows');
    assert.equal(hit.rate, 1);
});

test('creativity is a signal, not a route', () => {
    /* It is an ICT index component and pays nothing. A creative midfielder is
       paid through assists, which is already its own route — counting both
       credits the same expected points twice and calls a one-route player a
       two-route player. */
    const r = routesFor(player({ position: 3, l5: { ...player().l5, creativity: 200 },
        season: { ...player().season, creativity: 200 } }));
    assert.equal(keys(r).includes('creativity'), false);
    assert.equal(r.signals.length, 1);
    assert.equal(r.signals[0].key, 'creativity');
    assert.ok(r.signals[0].note, 'a signal has to say why it does not count');
    // And it must not reach the composite through the back door.
    const without = routesFor(player({ position: 3, l5: { ...player().l5, creativity: 0 },
        season: { ...player().season, creativity: 0 } }));
    assert.equal(r.routeCount, without.routeCount);
    assert.equal(r.compositeScore, without.compositeScore);
});

test('the composite counts strength against what the route pays', () => {
    // A route worth 6 points a go outranks one worth 2 at the same strength.
    // Otherwise "three routes" says nothing about how many points they are.
    const r = routesFor(player());
    const byHand = r.routes.reduce((s, x) => s + x.strength * x.ptWeight, 0);
    assert.equal(Math.round(r.compositeScore / r.nailedMultiplier * 1e6) / 1e6,
        Math.round(byHand * 1e6) / 1e6);
});

test('a player with nothing gets no routes rather than a floor', () => {
    const empty = routesFor(player({
        history: [], l5: { games: 4, minutes: 0 }, season: { games: 4, minutes: 0 }
    }));
    assert.equal(empty.routeCount, 0);
    assert.equal(empty.compositeScore, 0);
    assert.equal(empty.defConHit, null);
});
