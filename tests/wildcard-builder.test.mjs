/* The wildcard builder.

   The unit tests below pin the pieces whose arithmetic is worth stating once
   and never rederiving — the objective, the pruning proof, the premium
   threshold. The end-to-end tests run the whole search over a synthetic league
   and assert INVARIANTS rather than a squad: which fifteen players are best is
   the model's opinion and will move whenever a constant is retuned, but a
   returned squad being legal, affordable and carrying exactly the premiums its
   plan promised is not an opinion. Those are the assertions that catch a real
   break, and they do not have to be rewritten every time the model improves.

   A note on Sets. Anything crossing into the sandbox has to be built from the
   sandbox's own intrinsics: `new Set()` here produces this realm's Set, and the
   `instanceof Set` guard inside wcBuildPlans would reject it. Hence ctx.Set. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, browserStubs } from './helpers/load.mjs';

const GWS = [4, 5, 6, 7, 8, 9];

/* A league with a shape the real one has: twenty clubs, a long flat middle, and
   a short premium tail among the attackers. Deterministic — no randomness, so a
   failure is always reproducible. */
function synthetic() {
    const players = [];
    let id = 1;
    const add = (teamId, position, price, xp) => {
        players.push({
            id: id++, name: `P${id}`, team: `T${teamId}`, teamId, position,
            price, status: 'a', minutes: 540, starts: 6,
            form: 4, ppg: 4, _xp: xp
        });
    };
    for (let t = 1; t <= 20; t++) {
        add(t, 1, 4.0 + (t % 3) * 0.5, 3.0 + (t % 5) * 0.25);
        for (let i = 0; i < 3; i++) add(t, 2, 4.0 + i * 0.7 + (t % 4) * 0.2, 2.6 + i * 0.4 + (t % 5) * 0.2);
        for (let i = 0; i < 3; i++) add(t, 3, 5.0 + i * 0.8 + (t % 4) * 0.2, 3.0 + i * 0.5 + (t % 5) * 0.22);
        for (let i = 0; i < 2; i++) add(t, 4, 5.0 + i * 1.0 + (t % 4) * 0.2, 3.1 + i * 0.6 + (t % 5) * 0.2);
    }
    // The premium tail: eight attackers clear of the pack on price, so the
    // top-eight threshold lands on 8.0 and the tier is unambiguous.
    const prem = [[13.5, 8.0], [11.5, 7.2], [10.0, 6.5], [9.5, 6.2],
                  [9.0, 6.0], [8.5, 5.8], [8.2, 5.6], [8.0, 5.5]];
    prem.forEach(([price, xp], i) => {
        const p = players.find(x => x.teamId === i + 1 && (x.position === (i % 2 ? 3 : 4)) && x.price < 8);
        p.price = price; p._xp = xp;
    });
    return players;
}

function sandbox(players) {
    const teamAnalysis = {};
    for (let t = 1; t <= 20; t++) teamAnalysis[t] = { formRating: 50, matchesPlayed: 5 };
    const teams = {};
    for (let t = 1; t <= 20; t++) teams[t] = { short_name: `T${t}` };

    const ctx = loadScript('scripts/wildcard-builder.js', browserStubs());
    ctx.allPlayers = players;
    ctx.teamAnalysis = teamAnalysis;
    ctx.teams = teams;
    ctx.minMinutesForCandidate = () => 0;
    ctx.computePlayerGamesPlayed = () => 6;
    ctx.xpPlanGWs = (n) => GWS.slice(0, n === undefined ? 3 : n);
    // Flat across the window, so a player's window total is just his rate times
    // the decay weights — except club 20, which blanks in GW6. That is what
    // makes the per-gameweek re-solve observable at all.
    ctx.projectPlayerPointsForGW = (p, gw) => (p.teamId === 20 && gw === 6 ? 0 : p._xp);
    return ctx;
}

function audit(ctx, r, budget, label) {
    assert.ok(r.ok, `${label}: builder returned ${r.reason}`);
    for (const p of r.plans) {
        const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
        p.squad.forEach(x => counts[x.position]++);
        assert.equal(p.squad.length, 15, `${label}/${p.id}: fifteen players`);
        assert.deepEqual([counts[1], counts[2], counts[3], counts[4]], [2, 5, 5, 3],
            `${label}/${p.id}: legal squad shape`);
        assert.equal(new Set(p.squad.map(x => x.id)).size, 15, `${label}/${p.id}: no duplicates`);
        const worst = Math.max(...Object.values(p.clubs));
        assert.ok(worst <= 3, `${label}/${p.id}: ${worst} from one club`);
        assert.ok(p.spend <= budget + 1e-9, `${label}/${p.id}: spent ${p.spend} of ${budget}`);
        assert.ok(p.bankLeft >= -1e-9, `${label}/${p.id}: negative bank`);
        assert.ok(p.deltaVsBest <= 0,
            `${label}/${p.id}: a constrained plan reported beating the ceiling`);
        assert.ok(p.objective <= r.ceiling + 1e-9, `${label}/${p.id}: objective above the ceiling`);
    }
}

/* ===== the objective ===== */

test('a gameweek is worth the eleven, plus the captain again, plus a discounted bench', () => {
    const ctx = sandbox(synthetic());
    const mk = (pos, xp) => ({ id: Math.random(), pos, xp: [xp] });
    const squad = [
        mk(1, 3), mk(1, 2),
        mk(2, 5), mk(2, 4), mk(2, 3), mk(2, 2), mk(2, 1),
        mk(3, 6), mk(3, 5), mk(3, 4), mk(3, 3), mk(3, 2),
        mk(4, 7), mk(4, 6), mk(4, 5)
    ];
    const scratch = { 1: [], 2: [], 3: [], 4: [] };
    /* 3-4-3 is the best shape here: 3 + (5+4+3) + (6+5+4+3) + (7+6+5) = 51.
       The captain is the best man in that eleven, so 7 goes on again. What is
       left is one defender on 2, one on 1, one midfielder on 2 — five points of
       outfield bench at 0.12 — and the reserve keeper on 2 at 0.05. */
    assert.equal(ctx.wcGwValue(squad, 0, scratch), 51 + 7 + 0.12 * 5 + 0.05 * 2);
});

test('a squad that cannot field an eleven is not a squad worth nothing', () => {
    const ctx = sandbox(synthetic());
    const mk = (pos, xp) => ({ id: Math.random(), pos, xp: [xp] });
    // One keeper, so no legal fifteen and no legal eleven either.
    const squad = [mk(1, 3), mk(2, 5), mk(2, 4), mk(2, 3), mk(2, 2), mk(2, 1),
                   mk(3, 6), mk(3, 5), mk(3, 4), mk(3, 3), mk(3, 2),
                   mk(4, 7), mk(4, 6), mk(4, 5), mk(4, 4)];
    assert.equal(ctx.wcGwValue(squad, 0, { 1: [], 2: [], 3: [], 4: [] }), null,
        'null, not zero — the caller has to be able to tell it apart from a bad squad');
});

test('the window decays, so a distant gameweek counts for less', () => {
    const ctx = sandbox(synthetic());
    const w = ctx.wcWeights(6);
    assert.equal(w[0], 1);
    assert.ok(w[5] < w[0] && w[5] > 0.6, `last weight ${w[5]} should be a discount, not a dismissal`);
    for (let i = 1; i < 6; i++) assert.ok(w[i] < w[i - 1], 'monotonically decreasing');
});

/* ===== the pool ===== */

test('pruning keeps a player until three clubmates dominate him', () => {
    const ctx = sandbox(synthetic());
    const e = (id, teamId, cost, w) => ({ id, pos: 3, teamId, cost, w, price: cost / 10 });
    // B is dearer and worse than A. One dominator is not enough to drop him:
    // three players from a club can be owned, so A alone could be in the squad
    // already and B still needed.
    const two = ctx.wcParetoPrune([e(1, 7, 50, 10), e(2, 7, 60, 8), e(3, 7, 55, 9)]);
    assert.ok(two.some(x => x.id === 2), 'two dominators is not enough to drop him');

    // A third dominator is: all three cannot be beaten into the squad at once.
    const four = ctx.wcParetoPrune([e(1, 7, 50, 10), e(2, 7, 60, 8), e(3, 7, 55, 9), e(4, 7, 52, 8.5)]);
    assert.ok(!four.some(x => x.id === 2), 'three dominators makes him provably unnecessary');
    assert.ok(four.some(x => x.id === 1), 'the dominant player is always kept');
});

test('pruning never compares across clubs, because the swap it justifies would breach the cap', () => {
    const ctx = sandbox(synthetic());
    const e = (id, teamId, cost, w) => ({ id, pos: 3, teamId, cost, w, price: cost / 10 });
    // Three players who would dominate id 4 on price and points, all at other
    // clubs. Dropping him would be wrong: swapping him for any of them moves a
    // player between clubs and can breach the three-per-club limit.
    const kept = ctx.wcParetoPrune([e(1, 1, 50, 10), e(2, 2, 50, 10), e(3, 3, 50, 10), e(4, 9, 60, 8)]);
    assert.ok(kept.some(x => x.id === 4), 'a player is only ever dominated by his own clubmates');
});

test('the premium tier is the dearest attackers, not a share of the pool', () => {
    const ctx = sandbox(synthetic());
    const at = price => ({ pos: 4, price });
    const tier = [15, 12, 10, 9.5, 9, 8.6, 8.3, 8.1].map(at);
    const filler = Array.from({ length: 200 }, () => at(5.0));
    // The threshold must not move when two hundred cheap attackers become
    // eligible, which is exactly what a percentile would do over a season.
    assert.equal(ctx.wcPremiumThreshold(tier), 8.1);
    assert.equal(ctx.wcPremiumThreshold(tier.concat(filler)), 8.1,
        'a bigger pool must not redefine what a premium is');
    // Clamped at both ends so a freak market cannot produce a nonsense tier.
    assert.equal(ctx.wcPremiumThreshold(Array.from({ length: 8 }, () => at(20))), 11.5);
    assert.equal(ctx.wcPremiumThreshold(Array.from({ length: 8 }, () => at(4.5))), 8.0);
    // Defenders are not in the conversation, whatever they cost.
    assert.equal(ctx.wcIsPremium({ pos: 2, price: 12 }, 8.0), false);
    assert.equal(ctx.wcIsPremium({ pos: 4, price: 8.0 }, 8.0), true);
});

/* ===== the nudges ===== */

test('form is a nudge with a hard ceiling, not a lever', () => {
    const ctx = sandbox(synthetic());
    assert.equal(ctx.wcFormMultiplier({ ppg: 5, form: 5 }), 1, 'at his season average, no adjustment');
    assert.equal(ctx.wcFormMultiplier({ ppg: 1.0, form: 8 }), 1, 'a ratio over a tiny base is noise');
    assert.equal(ctx.wcFormMultiplier({ ppg: 5, form: 20 }), 1.12, 'a player on fire is capped at +12%');
    assert.equal(ctx.wcFormMultiplier({ ppg: 5, form: 0 }), 0.88, 'and a player in the cold at -12%');
});

test('team form reads recent results only, and stays inside eight per cent', () => {
    const ctx = sandbox(synthetic());
    ctx.teamAnalysis = { 1: { formRating: 100, matchesPlayed: 10 }, 2: { formRating: 0, matchesPlayed: 10 },
                         3: { formRating: 50, matchesPlayed: 10 }, 4: { formRating: 100, matchesPlayed: 0 } };
    assert.equal(ctx.wcTeamFormMultiplier({ teamId: 1 }), 1.08);
    assert.equal(ctx.wcTeamFormMultiplier({ teamId: 2 }), 0.92);
    assert.equal(ctx.wcTeamFormMultiplier({ teamId: 3 }), 1);
    assert.equal(ctx.wcTeamFormMultiplier({ teamId: 4 }), 1, 'no matches played is no evidence');
    assert.equal(ctx.wcTeamFormMultiplier({ teamId: 99 }), 1, 'an unknown club is neutral, not zero');
});

/* ===== end to end ===== */

test('three plans come back, each legal and carrying exactly the premiums it promised', () => {
    const ctx = sandbox(synthetic());
    const r = ctx.wcBuildPlans({ budget: 100.0, horizon: 6 });
    audit(ctx, r, 100.0, 'base');

    assert.deepEqual(r.plans.map(p => p.id), ['spread', 'single', 'double']);
    assert.equal(r.horizon, 6);
    assert.equal(r.gws.length, 6);

    const want = { spread: 0, single: 1, double: 2 };
    for (const p of r.plans) {
        assert.equal(p.premiums.length, want[p.id], `${p.id}: premium count`);
        // The count the report claims has to match what the squad actually
        // holds, or the whole premise of the three plans is a label.
        const byPrice = p.squad.filter(x => (x.position === 3 || x.position === 4)
            && x.price >= r.premiumFloor).length;
        assert.equal(byPrice, want[p.id], `${p.id}: premiums by price disagree with the report`);
    }
});

test('the plans differ from each other, or they are one plan printed three times', () => {
    const ctx = sandbox(synthetic());
    const r = ctx.wcBuildPlans({ budget: 100.0, horizon: 6 });
    const [spread, single, double] = r.plans.map(p => new Set(p.squad.map(x => x.id)));
    const shared = (x, y) => [...x].filter(id => y.has(id)).length;
    /* The ends of the ladder are where the constraint bites hardest, so they
       carry the stricter bound. But `distinct` claims every pair differs, and
       an assertion that only ever looks at the ends cannot fail when the middle
       plan is a copy of one of them — which is the shape this would take if the
       premium search quietly returned the same combo twice. */
    assert.ok(shared(spread, double) < 14, `no-premium and two-premium share ${shared(spread, double)}/15`);
    assert.ok(shared(spread, single) < 15, 'no-premium and one-premium are the same fifteen players');
    assert.ok(shared(single, double) < 15, 'one-premium and two-premium are the same fifteen players');
    assert.equal(r.distinct, true);
});

test('every plan is measured against the best squad found, and none beats it', () => {
    const ctx = sandbox(synthetic());
    const r = ctx.wcBuildPlans({ budget: 100.0, horizon: 6 });
    /* Not equality. The unconstrained search is free to build a squad no plan
       is allowed to — three premiums, most often — so the ceiling can sit above
       all three. What must never happen is a plan reported above it, which is
       what makes a delta positive and the label a lie. */
    assert.ok(r.ceiling >= Math.max(...r.plans.map(p => p.objective)) - 1e-9,
        'the ceiling is the best of everything found, including the constrained runs');
    for (const p of r.plans) {
        assert.equal(p.deltaVsBest, Math.round((p.objective - r.ceiling) * 10) / 10);
    }
    // And when it does sit above them, the report has to say why.
    assert.ok(Number.isInteger(r.ceilingPremiums), 'the ceiling reports its own premium count');
    if (r.ceiling > Math.max(...r.plans.map(p => p.objective)) + 1e-9) {
        assert.ok(r.ceilingPremiums > 2,
            'a ceiling no plan reaches must be explained by a premium count no plan allows');
    }
});

test('a budget that cannot carry two premiums returns the plans that fit, not a crash', () => {
    const ctx = sandbox(synthetic());
    // Comfortable, marginal, and too tight for a premium at all.
    for (const budget of [100, 85, 75]) {
        const r = ctx.wcBuildPlans({ budget, horizon: 3 });
        audit(ctx, r, budget, `£${budget}m`);
        assert.ok(r.plans.length >= 1, `£${budget}m: at least one plan`);
    }
});

test('a banned player is in no plan, and a locked one is in every plan that can hold him', () => {
    const players = synthetic();
    const ctx = sandbox(players);
    const top = players.filter(p => p.price >= 8).sort((a, b) => b.price - a.price);

    const banned = new ctx.Set([top[0].id, top[1].id]);
    const rBan = ctx.wcBuildPlans({ budget: 100.0, horizon: 3, banIds: banned });
    audit(ctx, rBan, 100.0, 'ban');
    for (const p of rBan.plans) {
        assert.ok(p.squad.every(x => x.id !== top[0].id && x.id !== top[1].id),
            `${p.id}: a banned player was selected`);
    }

    const locked = new ctx.Set([top[0].id]);
    const rLock = ctx.wcBuildPlans({ budget: 100.0, horizon: 3, lockIds: locked });
    audit(ctx, rLock, 100.0, 'lock');
    for (const p of rLock.plans) {
        assert.ok(p.squad.some(x => x.id === top[0].id), `${p.id}: the locked player is missing`);
    }
    // Locking a premium makes a no-premium plan a contradiction. It is dropped
    // rather than quietly returned with the lock ignored.
    assert.ok(!rLock.plans.some(p => p.id === 'spread'),
        'a no-premium plan cannot honour a locked premium and must not pretend to');
});

test('a one-gameweek horizon is a Free Hit, and still returns legal squads', () => {
    const ctx = sandbox(synthetic());
    const r = ctx.wcBuildPlans({ budget: 100.0, horizon: 1 });
    audit(ctx, r, 100.0, 'freehit');
    assert.equal(r.horizon, 1);
    for (const p of r.plans) assert.equal(p.byGw.length, 1);
});

test('the budget can be derived from a squad and a bank', () => {
    const players = synthetic();
    const ctx = sandbox(players);
    const squad = players.slice(0, 15).map(p => ({ ...p, sellPrice: p.price }));
    const value = squad.reduce((s, p) => s + p.sellPrice, 0);
    const r = ctx.wcBuildPlans({ squad, bank: 2.5, horizon: 3 });
    if (r.ok) {
        assert.equal(r.budget, value + 2.5);
        audit(ctx, r, value + 2.5, 'derived');
        // A squad was supplied, so each plan can say how much of it changes.
        for (const p of r.plans) assert.ok(p.changes >= 0 && p.changes <= 15);
    }
});

test('impossible inputs are refused rather than half-answered', () => {
    const ctx = sandbox(synthetic());
    assert.equal(ctx.wcBuildPlans({ budget: 0 }).ok, false);
    assert.equal(ctx.wcBuildPlans({}).ok, false);
    assert.equal(ctx.wcBuildPlans({ budget: 20 }).ok, false, 'a budget no legal fifteen fits');
    ctx.allPlayers = [];
    assert.equal(ctx.wcBuildPlans({ budget: 100 }).reason, 'thin-pool');
});
