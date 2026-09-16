/* Starring a club changes the ORDER of what you see and never the contents.
   That distinction is the whole feature: a reader who stars Arsenal still
   wants to know their rival's striker is injured, just not first. These tests
   exist to stop the sort quietly becoming a filter, and to pin the stability
   that makes it safe to apply on top of an existing ranking. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load(stored) {
    const src = fs.readFileSync('scripts/common.js', 'utf8');
    const i = src.indexOf('/* ===== FAVOURITE CLUBS =====');
    const block = i >= 0 ? [src.slice(i)] : null;
    assert.ok(block, 'favourite clubs block not found in common.js');
    let store = stored;
    const ctx = vm.createContext({
        localStorage: {
            getItem: () => store,
            setItem: (_k, v) => { store = v; }
        },
        JSON, Array, Number
    });
    new vm.Script(block[0] + `
        ;globalThis.__api = { favClubsRead, favClubsHas, favClubsToggle, favClubsSort };
        ;globalThis.__store = () => store;`).runInContext(ctx);
    return ctx.__api;
}

/* [...x] on every array that crosses back: an array built inside the vm
   realm has a different Array.prototype, so deepEqual compares structurally
   equal values as different objects. Documented in tests/helpers/load.mjs. */
test('no stored favourites reads as none', () => {
    assert.deepEqual([...load(null).favClubsRead()], []);
});

test('unparseable storage is treated as none rather than throwing', () => {
    assert.deepEqual([...load('not json').favClubsRead()], []);
});

test('a stored value that is not a list is treated as none', () => {
    assert.deepEqual([...load('{"a":1}').favClubsRead()], []);
});

test('toggling adds then removes', () => {
    const api = load(null);
    assert.equal(api.favClubsToggle(7), true);
    assert.equal(api.favClubsHas(7), true);
    assert.equal(api.favClubsToggle(7), false);
    assert.equal(api.favClubsHas(7), false);
});

test('ids stored as strings still match', () => {
    const api = load('["3"]');
    assert.equal(api.favClubsHas(3), true);
});

test('sorting lifts starred clubs and keeps everyone else', () => {
    const api = load('[2]');
    const rows = [{ t: 1 }, { t: 2 }, { t: 3 }];
    const out = api.favClubsSort(rows, r => r.t);
    assert.deepEqual(out.map(r => r.t), [2, 1, 3]);
    assert.equal(out.length, rows.length, 'nothing may be dropped');
});

test('the incoming order survives inside each group', () => {
    const api = load('[4,1]');
    // Ranked 1..6 by some measure; 4 and 1 are starred.
    const rows = [1, 2, 3, 4, 5, 6].map(t => ({ t }));
    assert.deepEqual(api.favClubsSort(rows, r => r.t).map(r => r.t), [1, 4, 2, 3, 5, 6]);
});

test('no favourites returns the list untouched', () => {
    const api = load('[]');
    const rows = [{ t: 9 }, { t: 8 }];
    assert.equal(api.favClubsSort(rows, r => r.t), rows);
});

test('an item with no club still sorts, behind the starred ones', () => {
    const api = load('[5]');
    const rows = [{ t: undefined }, { t: 5 }];
    assert.deepEqual(api.favClubsSort(rows, r => r.t).map(r => r.t), [5, undefined]);
});
