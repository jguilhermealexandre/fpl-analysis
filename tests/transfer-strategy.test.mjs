/* Single · Multi · Wildcard · Free Hit.

   These four replaced two independent toggles — "Play wildcard" in the header
   and "Sell mode" over the squad panel — that each had their own on-state and
   described overlapping things. The risk in collapsing them is that the rest
   of the file still reads the old booleans, so the derivation is the thing
   that has to be right: every hit calculation, transfer cap and market pane on
   this screen reads transferState.wildcard or .sellMode, and nothing else sets
   them any more. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load() {
    const ctx = {
        console,
        escHTML: (s) => String(s == null ? '' : s),
        document: { getElementById: () => null, querySelector: () => null },
        transferState: {
            pending: [], activeSlot: -1, mode: 'squad', candidateCache: {},
            previewPlayer: null, strategy: 'single', wildcard: false, sellMode: false, funnel: null
        },
        selectedPlayers: [],
        picksData: { entry_history: { bank: 0 } },
        xpPlanGWs: (n) => Array.from({ length: n }, (_, i) => 4 + i),
        renderTWAll: () => { ctx._renders = (ctx._renders || 0) + 1; },
        updateStatus: () => {},
        // Lives in transfer-engine.js. One free transfer is the ordinary case
        // and the one where a third transfer visibly costs points.
        twFreeTransfers: () => 1,
        twFreeTransfersExact: () => true,
        _renders: 0
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    const f = 'scripts/transfer-wizard.js';
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInContext(ctx);
    return ctx;
}

// `const` at the top level of a classic script does not become a property of
// the vm context the way `function` and `var` do, so the strategy table has to
// be read by evaluating its name inside that context rather than off ctx.
const evalIn = (ctx, expr) => vm.runInContext(expr, ctx);

test('the four strategies derive the flags the rest of the screen reads', () => {
    const tw = load();
    const table = [
        // strategy      wildcard  sellMode  transfer cap
        ['single', false, false, 5],
        ['multi', false, true, 5],
        ['wildcard', true, true, 15],
        ['freehit', true, true, 15]
    ];
    for (const [strategy, wildcard, sellMode, cap] of table) {
        tw.twSetStrategy(strategy);
        assert.equal(tw.transferState.strategy, strategy);
        assert.equal(tw.transferState.wildcard, wildcard, `${strategy}: wildcard flag`);
        assert.equal(tw.transferState.sellMode, sellMode, `${strategy}: multi-select`);
        assert.equal(tw.twMaxTransfers(), cap, `${strategy}: transfer cap`);
    }
});

test('both chips waive the hit and the two ordinary plans do not', () => {
    // getTWHitCost is what puts "−8 pts" on screen. Showing accumulated hits
    // during a wildcard is the single most misleading thing this screen could
    // do, and it is now the strategy that decides it.
    const tw = load();
    tw.transferState.pending = [1, 2, 3].map(i => ({ soldPlayer: { id: i }, replacement: null }));
    tw.managerHistory = { current: [], chips: [] };

    tw.twSetStrategy('single');
    const paid = tw.getTWHitCost();
    assert.ok(paid > 0, `three transfers on one free transfer costs points, got ${paid}`);

    tw.twSetStrategy('multi');
    assert.equal(tw.getTWHitCost(), paid, 'multi is a way of selecting, not a chip — it still costs');

    for (const chip of ['wildcard', 'freehit']) {
        tw.twSetStrategy(chip);
        assert.equal(tw.getTWHitCost(), 0, `${chip} waives the hit`);
    }
});

test('a Free Hit is judged over the one gameweek you keep the squad', () => {
    /* The whole difference between the two chips. A Free Hit squad is handed
       back after this gameweek, so scoring it over a five-gameweek fixture run
       is scoring fixtures you will never own. */
    const tw = load();
    tw.twSetStrategy('wildcard');
    assert.equal(tw.twStrategyHorizon(), 5, 'a wildcard squad is one you keep');
    tw.twSetStrategy('freehit');
    assert.equal(tw.twStrategyHorizon(), 1, 'a free hit squad is one you rent');
});

test('switching strategy re-seeds the slots rather than leaving a stale window', () => {
    // Filters are per-slot and remember a horizon. Going into a Free Hit with
    // five-gameweek filters left on the slots would keep judging fixtures the
    // squad never plays.
    const tw = load();
    tw.transferState.pending = [{ soldPlayer: { id: 1, position: 2 }, replacement: null, funnel: { horizon: 8 } }];
    tw.twSetStrategy('freehit');
    assert.equal(tw.transferState.pending[0].funnel, null, 'the stale window is dropped');
});

test('the old entry points still work', () => {
    // Both were reachable from generated markup; neither should strand anyone
    // in a state the selector cannot show.
    const tw = load();
    tw.twToggleWildcard();
    assert.equal(tw.transferState.strategy, 'wildcard');
    tw.twToggleWildcard();
    assert.equal(tw.transferState.strategy, 'single', 'and toggles back off');

    tw.twToggleSellMode();
    assert.equal(tw.transferState.strategy, 'multi');
    tw.twToggleSellMode();
    assert.equal(tw.transferState.strategy, 'single');
});

test('an unknown strategy is ignored rather than half-applied', () => {
    const tw = load();
    tw.twSetStrategy('wildcard');
    tw.twSetStrategy('banana');
    assert.equal(tw.transferState.strategy, 'wildcard', 'the last real strategy stands');
    assert.equal(tw.transferState.wildcard, true, 'and its flags are untouched');
});

test('every strategy is offered with an explanation', () => {
    // The selector is the only place these are named, so an entry with no
    // tooltip is a mode a manager has to guess at.
    const tw = load();
    const strategies = evalIn(tw, 'TW_STRATEGIES');
    assert.equal(strategies.length, 4);
    for (const s of strategies) {
        assert.ok(s.id && s.label, 'named');
        assert.ok(s.tip && s.tip.length > 30, `${s.id} explains itself: ${s.tip}`);
    }
    assert.deepEqual([...strategies.map(s => s.id)], ['single', 'multi', 'wildcard', 'freehit']);
});
