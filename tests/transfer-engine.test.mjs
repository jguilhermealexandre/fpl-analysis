import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const twDeriveFreeTransfers = loadFunction('scripts/transfer-engine.js', 'twDeriveFreeTransfers');

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

test('a wildcard week costs nothing', () => {
    const rows = [{ event: 1, event_transfers: 0 }, { event: 2, event_transfers: 8 }];
    const chips = [{ event: 2, name: 'wildcard' }];
    assert.equal(twDeriveFreeTransfers(rows, chips, 5), 2, 'eight transfers on a wildcard still bank one');
});

test('the cap is respected', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ event: i + 1, event_transfers: 0 }));
    assert.equal(twDeriveFreeTransfers(rows, [], 5), 5);
});

test('no history means the opening position', () => {
    assert.equal(twDeriveFreeTransfers([], [], 5), 1);
    assert.equal(twDeriveFreeTransfers(null, null, 5), 1);
});
