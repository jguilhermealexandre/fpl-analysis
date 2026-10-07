import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFunction } from './helpers/load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

const twDeriveFreeTransfers = loadFunction('scripts/transfer-engine.js', 'twDeriveFreeTransfers');
const twDiversifySwaps = loadFunction('scripts/transfer-engine.js', 'twDiversifySwaps');

test('free transfers replay from history', () => {
    // FPL never publishes the count, so it is reconstructed. Getting it wrong
    // misprices every hit, and a recommendation that misprices a -4 is worse
    // than no recommendation.
    const rows = [{ event: 1, event_transfers: 0 }, { event: 2, event_transfers: 0 }];
    assert.equal(twDeriveFreeTransfers(rows, [], 5), 2, 'an unused week banks one');
});

test('transfers made are deducted', () => {
    const rows = [{ event: 1, event_transfers: 0 }, { event: 2, event_transfers: 1 }];
    assert.equal(twDeriveFreeTransfers(rows, [], 5), 1);
});

/* This test used to assert 2 — that a wildcard week costs nothing AND still
   banks one. That is where the count came from that told a manager holding four
   free transfers that he held five, and offered him a move on the grounds that
   he was at the cap and would lose one by not spending it.

   A chip week freezes the bank: the chip is that week's free transfer, so the
   week neither spends nor earns. The assertion is rewritten rather than
   relaxed, because the old number was the bug. */
test('a wildcard week freezes the bank rather than rolling it on', () => {
    const rows = [{ event: 1, event_transfers: 0 }, { event: 2, event_transfers: 8 }];
    const chips = [{ event: 2, name: 'wildcard' }];
    assert.equal(twDeriveFreeTransfers(rows, chips, 5), 1, 'eight transfers on a wildcard cost nothing and earn nothing');
});

test('a free hit freezes the bank the same way', () => {
    const rows = [{ event: 1, event_transfers: 0 }, { event: 2, event_transfers: 11 }];
    const chips = [{ event: 2, name: 'freehit' }];
    assert.equal(twDeriveFreeTransfers(rows, chips, 5), 1);
});

test('a triple captain is not a transfer chip', () => {
    // Only the two that hand out transfers freeze the count. Bench Boost and
    // Triple Captain weeks are ordinary weeks.
    const rows = [{ event: 1, event_transfers: 0 }, { event: 2, event_transfers: 0 }];
    assert.equal(twDeriveFreeTransfers(rows, [{ event: 2, name: '3xc' }], 5), 2);
    assert.equal(twDeriveFreeTransfers(rows, [{ event: 2, name: 'bboost' }], 5), 2);
});

test('the reported account replays to the figure FPL itself shows', () => {
    /* A real account, checked against fantasy.premierleague.com on 2026-09-18:
       no transfers all season, Triple Captain in GW3, Wildcard in GW4, and a
       GW5 row already in history from that gameweek's deadline. The official
       site said four. This said five.

       Kept as a fixture because it is the only case to hand that sits BELOW the
       cap with a chip behind it — which is the only shape that can tell a
       frozen bank apart from a rolling one. Every published worked example uses
       a manager already on five, where both models agree. */
    const rows = [1, 2, 3, 4, 5].map(event => ({ event, event_transfers: 0 }));
    const chips = [{ event: 3, name: '3xc' }, { event: 4, name: 'wildcard' }];
    assert.equal(twDeriveFreeTransfers(rows, chips, 5), 4);
});

test('the cap is respected', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ event: i + 1, event_transfers: 0 }));
    assert.equal(twDeriveFreeTransfers(rows, [], 5), 5);
});

test('no history means the opening position', () => {
    assert.equal(twDeriveFreeTransfers([], [], 5), 1);
    assert.equal(twDeriveFreeTransfers(null, null, 5), 1);
});


/* ===== Three ways to spend one transfer =====

   The recommender is deterministic: one squad against one set of data has
   exactly one highest-gain swap, which is why the same two names kept coming
   back. These options are not a fix for that and must not become one — picking
   a worse move at random to look lively would be dishonest. What they do is
   show that the runners-up are usually a different KIND of move, separated by
   what they leave in the bank. */
const cand = (id, price, gain) => ({ in: { id, price }, gain });

/* An array that came out of the sandbox has the sandbox's Array.prototype, and
   node:assert/strict compares prototypes — so deepEqual against a literal here
   fails with "same structure but not reference-equal" however right the values
   are. Copying into a host array is the whole fix; the contents are primitives
   and cross no realm. */
const host = xs => [...xs];

test('the three options differ by price, not merely by rank', () => {
    // 7.9 is only 0.1 below the 8.0 pick, so it is the same move at the same
    // money and does not count as the cheaper option.
    const picks = twDiversifySwaps([cand(1, 8.0, 5.0), cand(2, 7.9, 4.8), cand(3, 6.0, 4.2), cand(4, 10.0, 3.9)], 3);
    assert.deepEqual(host(picks.map(p => p.in.id)), [1, 3, 4]);
    assert.deepEqual(host(picks.map(p => p.altKind)), ['best', 'cheaper', 'pricier']);
});

test('the best move is always the first option', () => {
    const picks = twDiversifySwaps([cand(1, 8, 5), cand(2, 4, 4.9)], 3);
    assert.equal(picks[0].in.id, 1);
    assert.equal(picks[0].gain, 5, 'and it keeps its own gain, not a blended one');
});

test('no player is offered twice in the same slot', () => {
    const ids = twDiversifySwaps([cand(1, 8, 5), cand(2, 5, 4), cand(3, 11, 3)], 3).map(p => p.in.id);
    assert.equal(new Set(ids).size, ids.length);
});

test('when the band is empty it falls back to the next best rather than padding', () => {
    const picks = twDiversifySwaps([cand(1, 8, 5), cand(2, 8, 4), cand(3, 8, 3)], 3);
    assert.deepEqual(host(picks.map(p => p.altKind)), ['best', 'next', 'next']);
});

test('one candidate is one option, and none is none', () => {
    assert.deepEqual(host(twDiversifySwaps([], 3)), []);
    assert.deepEqual(host(twDiversifySwaps(null, 3)), []);
    assert.equal(twDiversifySwaps([cand(1, 8, 5)], 3).length, 1);
});

/* ===== How many transfers, and the ceiling that used to answer for it =====

   The reported symptom: a manager holding four free transfers was recommended
   exactly two, every week, whatever the squad looked like. It was not a
   judgement. The option set was hard-coded to one move and two, and with four
   banked both cost nothing, the pair's joint gain is never less than the better
   half alone, and both were measured against the same flat 3.0 margin that the
   first move had already covered. n = 2 won by construction.

   Lifting the ceiling alone would have made it answer four. The margin is per
   move now, so each transfer has to add three points of its own — four if it is
   taking a hit, on top of the hit. These tests are mostly about the second half:
   what the planner REFUSES to recommend. */

const twPlanChain = loadFunction('scripts/transfer-engine.js', 'twPlanChain', {
    TW_MIN_FREE_GAIN: 3.0, TW_MIN_HIT_GAIN: 4.0, TW_MAX_PLAN: 5
});

let planUid = 0;
/** A move worth `solo` points on its own. `pos` is the outgoing player's
 *  position — 1 is a goalkeeper, which the friction below cares about. */
const mv = (solo, extra = {}) => {
    planUid++;
    return {
        out: {
            id: `o${planUid}`, status: extra.status || 'a',
            position: extra.pos || 3, teamId: `t${planUid}`
        },
        in: { id: `i${planUid}`, teamId: `t${planUid}` },
        gain: solo, _solo: solo
    };
};
/** Additive by default; `decay` models the double-counting a lineup re-solve
 *  removes — two moves promoting the same bench player into the same eleven. */
const jointGain = decay => ms =>
    ms.reduce((t, m, i) => t + m._solo * (decay ? decay ** i : 1), 0);
const anyLegal = () => true;
const plan = (moves, opts = {}) =>
    twPlanChain(moves, { jointGain: jointGain(opts.decay), legal: opts.legal || anyLegal, ...opts });

test('four free transfers and one good move is one transfer, not two', () => {
    /* The bug, in one line. Under the old rule the pair netted 9.6 against a
       flat 3.0 and beat the single move's 9.0, so it was recommended. */
    assert.equal(plan([mv(9), mv(0.6), mv(0.4), mv(0.2)], { ft: 4 }).depth, 1);
});

test('the bigger plan is still priced and offered, just not recommended', () => {
    /* The card can show a plan the engine did not pick, so the chain has to
       carry it — `depth` is the verdict, not the whole list. */
    const r = plan([mv(9), mv(0.6)], { ft: 4 });
    assert.equal(r.chain.length, 2);
    assert.equal(r.chain[1].net, 9.6);
    assert.equal(r.depth, 1);
});

test('four genuinely good moves are all recommended', () => {
    assert.equal(plan([mv(9), mv(8), mv(7), mv(6)], { ft: 4 }).depth, 4);
});

test('a plan stops at the first move that cannot pay for itself', () => {
    assert.equal(plan([mv(9), mv(8), mv(7), mv(0.5)], { ft: 4 }).depth, 3);
});

test('a hit has to clear the hit and the margin on top of it', () => {
    // Second move costs 4, so it needs stepGain - 4 >= 4.
    assert.equal(plan([mv(9), mv(7.9)], { ft: 1 }).depth, 1);
    assert.equal(plan([mv(9), mv(8.1)], { ft: 1 }).depth, 2);
});

test('a player who cannot play is replaced whatever the margin says', () => {
    assert.equal(plan([mv(9), mv(0.1, { status: 'i' })], { ft: 4 }).depth, 2);
});

test('one injured player does not wave three speculative moves through', () => {
    /* The old filter exempted a whole package if any move in it was forced,
       so an injured starter paid for everything behind him. */
    assert.equal(plan([mv(0.1, { status: 'i' }), mv(0.2), mv(0.3)], { ft: 4 }).depth, 1);
});

test('freeTransfersOnly drops a hit step but keeps a forced one', () => {
    assert.equal(plan([mv(9), mv(20)], { ft: 1, freeTransfersOnly: true }).depth, 1);
    assert.equal(plan([mv(9), mv(0.1, { status: 'i' })], { ft: 1, freeTransfersOnly: true }).depth, 2);
});

test('the first move is the caller\'s, so the flagged tie-break survives', () => {
    /* twBuildRecommendation reorders `moves` so a squad-analysis Sell verdict
       wins a close call. Re-choosing step one by joint gain would undo that. */
    assert.equal(plan([mv(5), mv(9)], { ft: 4 }).chain[0].step._solo, 5);
});

test('every move after the first is chosen by what it adds', () => {
    assert.equal(plan([mv(9), mv(4), mv(7)], { ft: 4 }).chain[1].step._solo, 7);
});

test('two moves claiming the same improvement are not paid twice', () => {
    const r = plan([mv(9), mv(5)], { ft: 4, decay: 0.5 });
    assert.equal(r.chain[1].stepGain, 2.5);
    assert.equal(r.depth, 1, 'half of 5 does not clear 3.0');
});

test('a package that is not legal is never built', () => {
    const r = plan([mv(9), mv(8)], { ft: 4, legal: ms => ms.length < 2 });
    assert.equal(r.chain.length, 1);
});

test('the plan is capped however many transfers are banked', () => {
    const many = Array.from({ length: 9 }, () => mv(20));
    assert.equal(plan(many, { ft: 8 }).chain.length, 5);
});

test('no legal move is no chain and no depth', () => {
    const r = plan([], { ft: 4 });
    assert.equal(r.chain.length, 0);
    assert.equal(r.depth, 0);
});

test('a player is never sold twice in one plan', () => {
    const first = mv(9);
    const sameOut = { out: first.out, in: { id: 'zz', teamId: 'tz' }, gain: 8, _solo: 8 };
    assert.equal(plan([first, sameOut], { ft: 4 }).chain.length, 1);
});

/* ===== Goalkeepers, and the justification that did not survive checking =====

   Managers do not transfer keepers, and the engine kept offering it. The
   tempting explanation — "playing keepers are all much of a muchness, so noise
   clears the margin there more easily than a real upgrade does in attack" — is
   false. Measured on GW6 data over the five-gameweek horizon, the p10-to-p90
   points spread among playing keepers is 21.0 points against 20.0 for
   midfielders. Keepers are not interchangeable.

   What is structural is the price band: playing keepers span £4.5m to £6.1m
   against £4.5m-£11.9m for midfielders, so the transfer moves no money and buys
   a different keeper and nothing else. The rest is a product decision. Either
   way the constant is a preference, so these tests inject the friction rather
   than asserting against whatever TW_GK_FRICTION happens to be. */

const twMoveFriction = loadFunction('scripts/transfer-engine.js', 'twMoveFriction', {
    TW_GK_FRICTION: 3.0
});

const gk = (solo, extra = {}) => mv(solo, { ...extra, pos: 1 });
/** Step one is pinned to moves[0], so the caller owns the ranking — and the
 *  caller applies the same friction. Mirrored here so these exercise the real
 *  pipeline rather than an order production never produces. */
const ranked = moves => moves.slice()
    .sort((a, b) => (b.gain - twMoveFriction(b)) - (a.gain - twMoveFriction(a)));
const planRanked = (moves, opts = {}) => twPlanChain(ranked(moves), {
    jointGain: jointGain(opts.decay), legal: opts.legal || anyLegal,
    friction: twMoveFriction, ...opts
});

test('friction falls on an available keeper and nobody else', () => {
    assert.equal(twMoveFriction(gk(5)), 3.0);
    assert.equal(twMoveFriction(mv(5)), 0, 'outfield moves are free of it');
    assert.equal(twMoveFriction(gk(5, { status: 'i' })), 0, 'an injury is not reluctance');
    assert.equal(twMoveFriction(gk(5, { status: 'd' })), 0);
    assert.equal(twMoveFriction(null), 0);
});

test('a keeper swap has to be worth about twice an outfield one', () => {
    assert.equal(planRanked([mv(4)], { ft: 4 }).depth, 1, 'an outfield move worth 4 is taken');
    assert.equal(planRanked([gk(4)], { ft: 4 }).depth, 0, 'the same number on a keeper is not');
    assert.equal(planRanked([gk(5.9)], { ft: 4 }).depth, 0);
    assert.equal(planRanked([gk(6.1)], { ft: 4 }).depth, 1);
});

test('a keeper who cannot play is replaced on the ordinary margin', () => {
    assert.equal(planRanked([gk(3.5, { status: 'i' })], { ft: 4 }).depth, 1);
});

test('a refused keeper does not cost you the outfield move behind it', () => {
    /* The friction is applied to the RANKING as well as the margin, so a
       keeper that would fail the bar does not get pinned to step one and
       strand a perfectly good move two rows down. */
    const r = planRanked([gk(5), mv(5)], { ft: 4 });
    assert.equal(r.chain[0].step.out.position, 3, 'step one is the outfield move');
    assert.equal(r.depth, 1);
});

test('a clearly better keeper still wins', () => {
    const r = planRanked([gk(12), mv(5)], { ft: 4 });
    assert.equal(r.chain[0].step.out.position, 1);
    assert.ok(r.depth >= 1);
});

test('the friction applies to later steps, not only the first', () => {
    const r = planRanked([mv(9), gk(4), mv(3.5)], { ft: 4 });
    assert.equal(r.chain[1].step.out.position, 3, 'step two prefers the outfield move');
    assert.equal(planRanked([mv(9), gk(4)], { ft: 4 }).depth, 1, 'and refuses the keeper outright');
});

test('a keeper topping the ranking and then failing cannot hide a viable move', () => {
    /* The property that makes pinning step one safe. If the keeper leads after
       friction then gkGain - 3 >= every other gain; if it then fails viability,
       gkGain - 3 < 3, so every other gain is under 3 and none of them would
       have cleared the margin either. Holding is the right answer, not a move
       the friction lost. Swept rather than argued. */
    for (let g = 3.0; g <= 6.0; g += 0.25) {
        for (let o = 0; o <= g - 3.0; o += 0.25) {
            const r = planRanked([gk(g), mv(o)], { ft: 4 });
            if (r.depth === 0) {
                assert.ok(o < 3.0,
                    `held at keeper ${g} while an outfield move worth ${o} was available`);
            }
        }
    }
});

/* ===== The site's own signals, as an input to who to buy =====

   The recommender priced candidates on projected points and nothing else, so
   the site could put a player in its Rising Form section and ignore him when
   choosing a transfer. Both signals are computed on the same page.

   The whole risk here is overreach, so that is what is tested: the boost is
   bounded, it moves the ranking and never the reported points, it cannot
   manufacture a recommendation that the margin would otherwise refuse, and it
   cannot cancel the goalkeeper brake. */

const twMoveBoost = loadFunction('scripts/transfer-engine.js', 'twMoveBoost', {
    TW_SIGNAL_MAX: 1.5
});

const sigMap = pairs => new Map(Object.entries(pairs));
const inMove = (solo, inId, extra = {}) => {
    const m = mv(solo, extra);
    m.in.id = inId;
    return m;
};

test('the boost is zero without a signal to read', () => {
    assert.equal(twMoveBoost(mv(5), null), 0);
    assert.equal(twMoveBoost(mv(5), new Map()), 0);
    assert.equal(twMoveBoost(null, new Map()), 0);
});

test('the boost scales across the whole 0-100 range and stops at the cap', () => {
    const m = inMove(5, 'X');
    assert.equal(twMoveBoost(m, sigMap({ X: { rising: 0, patch: 0 } })), 0);
    assert.equal(twMoveBoost(m, sigMap({ X: { rising: 100, patch: 100 } })), 1.5);
    assert.equal(twMoveBoost(m, sigMap({ X: { rising: 50, patch: 50 } })), 0.75);
});

test('a player measurable on one signal is averaged over one, not halved', () => {
    /* Four gameweeks in, "no purple patch yet" is a fact about the calendar,
       not about the player, and must not read as a zero. */
    const m = inMove(5, 'X');
    assert.equal(twMoveBoost(m, sigMap({ X: { rising: 100, patch: null } })), 1.5);
    assert.equal(twMoveBoost(m, sigMap({ X: { rising: null, patch: 100 } })), 1.5);
});

test('a score outside its range is clamped rather than trusted', () => {
    const m = inMove(5, 'X');
    assert.equal(twMoveBoost(m, sigMap({ X: { rising: 999, patch: 999 } })), 1.5);
    assert.equal(twMoveBoost(m, sigMap({ X: { rising: -50, patch: -50 } })), 0);
});

test('the signal belongs to the player coming in, not the one going out', () => {
    const m = inMove(5, 'IN');
    assert.equal(twMoveBoost(m, sigMap({ IN: { rising: 100, patch: 100 } })), 1.5);
    assert.equal(twMoveBoost(m, sigMap({ [m.out.id]: { rising: 100, patch: 100 } })), 0);
});

test('a signal cannot manufacture a recommendation the margin would refuse', () => {
    /* 2.0 is under TW_MIN_FREE_GAIN. The margin is tested on the unadjusted
       gain, so even a maximal boost must leave this a hold. */
    const m = inMove(2.0, 'X');
    const S = sigMap({ X: { rising: 100, patch: 100 } });
    const r = plan([m], { ft: 4, boost: x => twMoveBoost(x, S) });
    assert.equal(r.depth, 0);
});

test('a signal cannot cancel the goalkeeper brake', () => {
    const g = inMove(4.0, 'K', { pos: 1 });
    const S = sigMap({ K: { rising: 100, patch: 100 } });
    const r = plan([g], {
        ft: 4, friction: twMoveFriction, boost: x => twMoveBoost(x, S)
    });
    assert.equal(r.depth, 0, 'friction 3.0 outweighs a 1.5 cap');
});

test('the boost never reaches the figures the card prints', () => {
    const m = inMove(9, 'X');
    const S = sigMap({ X: { rising: 100, patch: 100 } });
    const r = plan([m], { ft: 4, boost: x => twMoveBoost(x, S) });
    assert.equal(r.chain[0].gross, 9, 'gross is the real projection');
    assert.equal(r.chain[0].net, 9, 'and so is net');
});

test('a signal does reorder two candidates the engine rates similarly', () => {
    const a = inMove(5.0, 'A');
    const b = inMove(5.4, 'B');
    const S = sigMap({ A: { rising: 100, patch: 100 } });
    const rank = m => m.gain + twMoveBoost(m, S);
    const first = [a, b].sort((x, y) => rank(y) - rank(x))[0];
    assert.equal(first.in.id, 'A', '6.5 against 5.4');
});

test('the constants stay in the order the design depends on', () => {
    /* TW_SIGNAL_MAX has to sit below both the margin a transfer must clear and
       the keeper brake, or the two tests above stop meaning anything. Read from
       source so raising one without the other fails here. */
    const src = fs.readFileSync(path.join(ROOT, 'scripts/transfer-engine.js'), 'utf8');
    const num = name => {
        const m = new RegExp(`${name}\\s*=\\s*([0-9.]+)`).exec(src);
        assert.ok(m, `${name} should be findable`);
        return parseFloat(m[1]);
    };
    assert.ok(num('TW_SIGNAL_MAX') < num('TW_MIN_FREE_GAIN'),
        'a signal must not outrun the margin a transfer has to clear');
    assert.ok(num('TW_SIGNAL_MAX') < num('TW_GK_FRICTION'),
        'a signal must not cancel the goalkeeper brake');
});

/* ===== One answer to "can this player be recommended" =====

   Four surfaces offer a replacement and they disagreed about doubts. Step 1,
   the draft and Squad Analysis accepted status 'd' outright; the wizard's quick
   picks refused every one. So a doubtful player was a valid recommendation on
   one screen and invisible on the next, with nothing on screen to explain it.

   The threshold is not a new opinion: rfEvaluate() in scripts/form-trend.js
   already blocks Rising Form below 75% with the reasoning that a flagged doubt
   "is not a transfer to plan around". Same number, one rule. */

const twPlayerAvailable = loadFunction('scripts/transfer-engine.js', 'twPlayerAvailable', {
    TW_DOUBT_FLOOR: 75
});

const who = (o = {}) => ({ status: 'a', chanceNextRound: null, ...o });

test('a fit player can be recommended', () => {
    assert.equal(twPlayerAvailable(who()), true);
});

test('injured, suspended and unavailable cannot', () => {
    for (const status of ['i', 's', 'u']) {
        assert.equal(twPlayerAvailable(who({ status })), false, status);
    }
});

test('a doubt at 75% or better can, below it cannot', () => {
    assert.equal(twPlayerAvailable(who({ status: 'd', chanceNextRound: 75 })), true);
    assert.equal(twPlayerAvailable(who({ status: 'd', chanceNextRound: 100 })), true);
    assert.equal(twPlayerAvailable(who({ status: 'd', chanceNextRound: 50 })), false);
    assert.equal(twPlayerAvailable(who({ status: 'd', chanceNextRound: 0 })), false);
});

test('a doubt FPL has not put a number on still passes', () => {
    /* The flag without a figure is how FPL marks a knock it has no update on.
       Refusing those would drop players who are fit. */
    assert.equal(twPlayerAvailable(who({ status: 'd', chanceNextRound: null })), true);
});

test('no player is not a player', () => {
    assert.equal(twPlayerAvailable(null), false);
    assert.equal(twPlayerAvailable(undefined), false);
});

/* ===== The team-context nudge, out of the projection =====

   It used to be added inside twXPCached, which put it inside lwScore, inside
   twSquadValue, and therefore inside the gain/gross/net figures the card prints
   as "xP". On GW Draft — the one surface that asks for it — the number labelled
   xP was xP plus up to 2.5 points of something else. It is a ranking adjustment
   now, so every surface reports pure xP. */

const twTeamContextNudge = loadFunction('scripts/transfer-engine.js', 'twTeamContextNudge', {
    teamAnalysis: {
        hot: { matchesPlayed: 5, formRating: 100, attackPower: 100, defensePower: 100, fixtureScore: 100 },
        cold: { matchesPlayed: 5, formRating: 0, attackPower: 0, defensePower: 0, fixtureScore: 0 },
        mid: { matchesPlayed: 5, formRating: 50, attackPower: 50, defensePower: 50, fixtureScore: 50 },
        unplayed: { matchesPlayed: 0, formRating: 100, attackPower: 100, defensePower: 100, fixtureScore: 100 }
    }
});

test('the nudge stays inside its clamp at both extremes', () => {
    const hot = twTeamContextNudge({ teamId: 'hot', position: 4 });
    const cold = twTeamContextNudge({ teamId: 'cold', position: 4 });
    assert.equal(hot, 2.5);
    assert.equal(cold, -2.5);
});

test('an average team is worth nothing either way', () => {
    assert.equal(twTeamContextNudge({ teamId: 'mid', position: 4 }), 0);
});

test('a club that has not played is not read as cold', () => {
    /* Every component is measured against 50, so a club with no matches would
       otherwise score whatever its unset fields happen to say. */
    assert.equal(twTeamContextNudge({ teamId: 'unplayed', position: 4 }), 0);
    assert.equal(twTeamContextNudge({ teamId: 'nosuchteam', position: 4 }), 0);
});

test('swapping inside one club is neutral', () => {
    /* The nudge is applied as in-minus-out now, which is the faithful
       translation of adding it to both ends inside the projection. Two players
       at the same club therefore cancel. */
    const a = twTeamContextNudge({ teamId: 'hot', position: 4 });
    const b = twTeamContextNudge({ teamId: 'hot', position: 4 });
    assert.equal(a - b, 0);
});

test('the widest the nudge can move a ranking is twice its clamp', () => {
    /* Worth knowing and worth watching: 5.0 is wider than TW_MIN_FREE_GAIN, so
       at the extremes this can outrank a move the projection prefers. That was
       equally true while it lived inside the projection — this test records the
       bound rather than changing it, because retuning it is a product decision
       and not part of making the surfaces agree. */
    const delta = twTeamContextNudge({ teamId: 'hot', position: 4 })
        - twTeamContextNudge({ teamId: 'cold', position: 4 });
    assert.equal(delta, 5.0);
});
