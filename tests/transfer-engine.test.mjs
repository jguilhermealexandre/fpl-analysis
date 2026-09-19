import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

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

test('the three options differ by price, not merely by rank', () => {
    // 7.9 is only 0.1 below the 8.0 pick, so it is the same move at the same
    // money and does not count as the cheaper option.
    const picks = twDiversifySwaps([cand(1, 8.0, 5.0), cand(2, 7.9, 4.8), cand(3, 6.0, 4.2), cand(4, 10.0, 3.9)], 3);
    assert.deepEqual(picks.map(p => p.in.id), [1, 3, 4]);
    assert.deepEqual(picks.map(p => p.altKind), ['best', 'cheaper', 'pricier']);
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
    assert.deepEqual(picks.map(p => p.altKind), ['best', 'next', 'next']);
});

test('one candidate is one option, and none is none', () => {
    assert.deepEqual(twDiversifySwaps([], 3), []);
    assert.deepEqual(twDiversifySwaps(null, 3), []);
    assert.equal(twDiversifySwaps([cand(1, 8, 5)], 3).length, 1);
});
