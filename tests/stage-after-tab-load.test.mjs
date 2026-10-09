/* Staging work into a tab whose script arrives on the click.

   My Team fetches four of its six tabs' scripts on first use, so switchTab()
   returns a promise and the tab's renderer runs from its .then(). Anything that
   switches tab and then stages state into it has to run on the far side of that
   promise — because the renderer it is waiting for REPLACES the state it is
   staging into. renderTransferWizard() assigns transferState wholesale.

   This is a regression test rather than a unit test. The bug it pins was not
   written: it was introduced in another file. tmSellBeforeDrop() was correct
   when switchTab was synchronous, and carried a comment explaining why its
   ordering mattered; deferred tab scripts made switchTab async and silently
   inverted that ordering. And it only broke the FIRST use in a session, since
   switchTab does no loading once the tab has rendered — so clicking it twice,
   which is what anybody checking would do, showed it working.

   Two callers stage into a tab. Both are checked here, because the failure is
   invisible in the product — a staged slot simply is not there — and the next
   person to add a third has something to copy. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFunction } from './helpers/load.mjs';

/* A switchTab that behaves like the real one: it hands back a promise, and the
   tab's renderer — which resets the state — runs from the .then(), never
   synchronously. Returns null on the warm path, as the real one does when there
   is nothing left to load. */
function tabHarness({ cold = true } = {}) {
    const state = { pending: [], strategy: null, resetCount: 0 };
    const order = [];
    const ctx = {
        get transferState() { return state; },
        set transferState(v) { Object.assign(state, v); },
        order
    };

    ctx.switchTab = () => {
        order.push('switchTab');
        if (!cold) { order.push('render'); reset(); return null; }
        return Promise.resolve().then(() => { order.push('render'); reset(); });
    };
    function reset() {
        // What renderTransferWizard() does on its first run, and the whole hazard.
        state.pending = [];
        state.strategy = null;
        state.resetCount++;
    }
    ctx.twSetStrategy = (s) => { order.push('setStrategy'); state.strategy = s; };
    ctx.twSwapPlayer = (id) => { order.push('swap'); state.pending.push({ id }); };
    return { ctx, state, order };
}

test('tmSellBeforeDrop stages the player AFTER the wizard has rendered', async () => {
    const { ctx, state, order } = tabHarness({ cold: true });
    const fn = loadFunction('scripts/transfer-wizard.js', 'tmSellBeforeDrop', {
        switchTab: ctx.switchTab,
        twSetStrategy: ctx.twSetStrategy,
        twSwapPlayer: ctx.twSwapPlayer,
        transferState: state
    });

    fn(42);
    // Nothing staged yet: the wizard has not been drawn.
    assert.deepEqual(order, ['switchTab'], 'staging must not happen synchronously');

    // Let the loader's promise settle, twice — switchTab's .then() schedules
    // ours, so one turn is not enough.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(order, ['switchTab', 'render', 'setStrategy', 'swap'],
        'the reset has to land before the staging, not after it');
    assert.equal(state.pending.length, 1, 'the slot survives');
    assert.equal(state.pending[0].id, 42);
    assert.equal(state.strategy, 'single');
});

test('and still works when the tab is already loaded', async () => {
    /* The warm path, which is the one that always worked and is why the cold
       one went unnoticed. switchTab returns null here, so Promise.resolve(null)
       has to be what the caller handles. */
    const { ctx, state, order } = tabHarness({ cold: false });
    const fn = loadFunction('scripts/transfer-wizard.js', 'tmSellBeforeDrop', {
        switchTab: ctx.switchTab,
        twSetStrategy: ctx.twSetStrategy,
        twSwapPlayer: ctx.twSwapPlayer,
        transferState: state
    });

    fn(7);
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(order, ['switchTab', 'render', 'setStrategy', 'swap']);
    assert.equal(state.pending.length, 1, 'one slot, not zero and not two');
    assert.equal(state.pending[0].id, 7);
});

test('the source itself never stages outside a .then()', () => {
    /* The two tests above pass against stubs. This one reads the files, because
       the regression came from switchTab changing shape in a THIRD file — and a
       caller added beside these two would be wrong in exactly the way a stub
       cannot see. */
    for (const [file, name] of [
        ['scripts/transfer-wizard.js', 'tmSellBeforeDrop'],
        ['scripts/panels-and-tabs.js', 'planTransferFromPanel']
    ]) {
        const body = functionSource(fs.readFileSync(file, 'utf8'), name);
        assert.ok(body, `${name} should be findable in ${file}`);
        assert.match(body, /Promise\.resolve\(\s*switchTab\(/,
            `${name} must wait for switchTab's promise before staging into the tab`);
    }
});

// One function's text, by brace depth.
function functionSource(src, name) {
    const i = src.search(new RegExp(`function\\s+${name}\\s*\\(`));
    if (i < 0) return null;
    let depth = 0;
    for (let k = src.indexOf('{', i); k < src.length; k++) {
        if (src[k] === '{') depth++;
        else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
    }
    return null;
}
