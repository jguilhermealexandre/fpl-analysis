/* Remembering a lineup.

   The dangerous failure here is not losing an arrangement — that is annoying
   and obvious. It is restoring the wrong one: last gameweek's eleven, or
   another team's, or one containing a player who has since been transferred
   out. All three look exactly like a lineup picked on purpose, and the first
   sign of trouble is a score. So most of this file is about refusing. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load() {
    const ctx = {
        console,
        localStorage: {
            _d: {},
            getItem(k) { return k in this._d ? this._d[k] : null; },
            setItem(k, v) { this._d[k] = String(v); },
            removeItem(k) { delete this._d[k]; }
        }
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    const f = 'scripts/lineup-store.js';
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInContext(ctx);
    return ctx;
}

const T0 = Date.UTC(2026, 8, 5, 12, 0);

// Fifteen players: ids 1-11 starting, 12-15 on the bench.
function squadOf(ids) { return ids.map(id => ({ id, name: `P${id}` })); }
function stateOf(over = {}) {
    const all = squadOf(Array.from({ length: 15 }, (_, i) => i + 1));
    return {
        squad: all,
        xi: all.slice(0, 11),
        bench: all.slice(11),
        captain: 1, viceCaptain: 2,
        excluded: new Set(),
        ...over
    };
}

test('an arrangement captures decisions and not derived facts', () => {
    /* Formation is a fact about which eleven are picked, so storing it would
       give two sources of truth that can disagree. Bench order is a decision —
       it is what the auto-substitutions run through — so it is kept. */
    const ls = load();
    const a = ls.lsArrangement(stateOf({ excluded: new Set([15]) }));
    assert.deepEqual([...a.xi], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.deepEqual([...a.bench], [12, 13, 14, 15]);
    assert.equal(a.captain, 1);
    assert.equal(a.vice, 2);
    assert.deepEqual([...a.excluded], [15]);
    assert.ok(!('formation' in a), 'derived, so not stored');
});

test('a saved lineup comes back for the same team and gameweek', () => {
    const ls = load();
    const saved = ls.lsArrangement(stateOf({ captain: 7 }));
    assert.equal(ls.lsSave('4089628', 4, saved), true);

    const back = ls.lsLoad('4089628', 4, T0);
    assert.ok(back);
    assert.equal(back.captain, 7);
    assert.deepEqual([...back.xi], [...saved.xi]);
});

test('it expires when the gameweek rolls over', () => {
    /* The whole reason this has a key at all. GW4's eleven restored into GW5 is
       a shape chosen against fixtures that have already been played, and it
       would look identical to one picked deliberately. */
    const ls = load();
    ls.lsSave('4089628', 4, ls.lsArrangement(stateOf()));
    assert.ok(ls.lsLoad('4089628', 4, T0), 'still the same gameweek');
    assert.equal(ls.lsLoad('4089628', 5, T0), null, 'the round moved on');
    assert.equal(ls.lsLoad('4089628', 3, T0), null, 'and it does not go backwards either');
});

test('another team never gets your lineup', () => {
    // The team id is switchable on this site, so this is reachable rather than
    // theoretical.
    const ls = load();
    ls.lsSave('4089628', 4, ls.lsArrangement(stateOf()));
    assert.equal(ls.lsLoad('999999', 4, T0), null);
    assert.ok(ls.lsLoad(4089628, 4, T0), 'and a numeric id is the same id');
});

test('a very old arrangement is dropped even if the keys match', () => {
    // A backstop for a season ending, or an id going missing, while something
    // is still in storage.
    const ls = load();
    ls.lsSave('4089628', 4, ls.lsArrangement(stateOf()));
    assert.equal(ls.lsLoad('4089628', 4, T0 + 40 * 86400000), null);
});

test('nothing saved is not an error', () => {
    const ls = load();
    assert.equal(ls.lsLoad('4089628', 4, T0), null);
    ls.localStorage.setItem('easyfpl_lineup', 'not json at all');
    assert.equal(ls.lsLoad('4089628', 4, T0), null, 'and neither is corruption');
});

test('applying puts back the eleven, the bench order and the armband', () => {
    const ls = load();
    const saved = ls.lsArrangement(stateOf({ captain: 5, viceCaptain: 9 }));
    // Something else entirely is on the pitch now.
    const state = stateOf({
        xi: squadOf([5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
        bench: squadOf([1, 2, 3, 4]),
        captain: 12, viceCaptain: 13
    });
    assert.equal(ls.lsApply(state, saved), true);
    assert.deepEqual([...state.xi.map(p => p.id)], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    assert.deepEqual([...state.bench.map(p => p.id)], [12, 13, 14, 15], 'bench order restored, not just membership');
    assert.equal(state.captain, 5);
    assert.equal(state.viceCaptain, 9);
});

test('a transferred-out player is not smuggled back into the XI', () => {
    /* The one that would actually cost points: an eleven naming somebody who is
       no longer in the squad. Ten players would be fielded and the eleventh
       slot would be whatever the renderer made of undefined. */
    const ls = load();
    const saved = ls.lsArrangement(stateOf());
    const shrunk = stateOf();
    shrunk.squad = shrunk.squad.filter(p => p.id !== 7);
    assert.equal(ls.lsApply(shrunk, saved), false, 'refused rather than applied short');
    assert.deepEqual([...shrunk.xi.map(p => p.id)], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        'and the state is left exactly as it was');
});

test('an armband on somebody no longer starting is dropped, not moved', () => {
    // Silently reassigning it would be a decision the manager did not make.
    const ls = load();
    const saved = ls.lsArrangement(stateOf());
    saved.captain = 14;          // now a bench player in the saved eleven
    saved.vice = 15;
    const state = stateOf();
    assert.equal(ls.lsApply(state, saved), true);
    assert.equal(state.captain, null);
    assert.equal(state.viceCaptain, null);
});

test('a bench player the save did not know about still ends up on the bench', () => {
    // A squad can gain a player between sessions; he has to land somewhere legal.
    const ls = load();
    const saved = ls.lsArrangement(stateOf());
    saved.bench = [12, 13];      // an older save, before two arrived
    const state = stateOf();
    assert.equal(ls.lsApply(state, saved), true);
    assert.deepEqual([...state.bench.map(p => p.id)], [12, 13, 14, 15],
        'known order first, the rest after');
});

test('two identical arrangements are recognised as the same decision', () => {
    // An undo button offered for a no-op is a button that looks broken.
    const ls = load();
    const a = ls.lsArrangement(stateOf());
    const b = ls.lsArrangement(stateOf());
    assert.equal(ls.lsSame(a, b), true);

    assert.equal(ls.lsSame(a, ls.lsArrangement(stateOf({ captain: 3 }))), false, 'armband counts');
    assert.equal(ls.lsSame(a, ls.lsArrangement(stateOf({ bench: squadOf([13, 12, 14, 15]) }))), false,
        'and so does bench order, because auto-subs run through it');
    assert.equal(ls.lsSame(a, null), false);
});

test('clearing removes it', () => {
    const ls = load();
    ls.lsSave('4089628', 4, ls.lsArrangement(stateOf()));
    ls.lsClear();
    assert.equal(ls.lsLoad('4089628', 4, T0), null);
});

test('a malformed state saves nothing rather than something broken', () => {
    const ls = load();
    assert.equal(ls.lsArrangement(null), null);
    assert.equal(ls.lsArrangement({}), null);
    assert.equal(ls.lsSave('1', 4, null), false);
    assert.equal(ls.lsApply(stateOf(), null), false);
    assert.equal(ls.lsApply(null, { xi: [1] }), false);
});
