/* "Load these into the transfer planner", which went wrong twice.

   FIRST: it filled the cart and left the wizard on step 1, the plan chooser,
   which renders none of the cart. The button looked inert. And it left
   transferState.strategy null, so the obvious next thing to do was pick a plan
   — and twSetStrategy empties pending on a switch. The button did nothing, and
   then the manager's next click deleted what it had done.

   SECOND: the step was fixed to 4 and the Overview still came up empty, because
   the market pane does not dispatch on the step. It dispatches on
   transferState.mode, and has no step-4 branch — mode 'squad' matched none of
   its cases and fell through to the idle "pick a player" panel.

   Both faults are a pair of values that have to agree, set by hand in one place
   while the rule lived in another. So what is asserted here is the end state:
   where the manager is standing, what mode the pane is in, and that the cart
   survived the trip. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const SRC = 'scripts/transfer-wizard.js';

const TW_STEPS = [
    { n: 1, key: 'plan' }, { n: 2, key: 'swap' },
    { n: 3, key: 'compare' }, { n: 4, key: 'confirm' }
];
const TW_STRATEGIES = [
    { id: 'single' }, { id: 'multi' }, { id: 'wildcard' }, { id: 'freehit' }
];

/** One wizard, wired out of the real functions, with a fresh state each time. */
function wizard(initial = {}) {
    const calls = { render: 0, status: [] };
    const ctx = {
        TW_STEPS, TW_STRATEGIES,
        transferState: {
            pending: [], activeSlot: -1, mode: 'squad', candidateCache: {},
            previewPlayer: null, strategy: null, wildcard: false, sellMode: false,
            step: 1, _stepDir: 0, funnel: null, ...initial
        },
        renderTWAll: () => { calls.render++; },
        updateStatus: (msg, kind) => { calls.status.push([msg, kind]); },
        twRestoringHistory: false,
        // twGoStep writes history inside a try/catch, so no stub is needed; it
        // throws without a document and the catch is the designed behaviour.
        history: undefined, window: undefined
    };

    const bind = name => {
        const fn = loadFunction(SRC, name, ctx);
        ctx[name] = fn;
        return fn;
    };
    bind('twStep');
    bind('twStepUrl');
    bind('twGoStep');
    bind('twStepReachable');
    bind('twSetStrategy');
    bind('twRailGo');
    const twApplyRecommendation = loadFunction(SRC, 'twApplyRecommendation', ctx);
    return { ctx, calls, twApplyRecommendation, state: ctx.transferState };
}

const move = (outId, inId) => ({
    out: { id: outId, name: `out${outId}`, position: 3, price: 7.0, status: 'a' },
    in: { id: inId, name: `in${inId}`, position: 3, price: 7.5 }
});

/* loadFunction gives each function its own context, so twLastRecommendation —
   a module-level `let` in the real file — has to be seeded in the context the
   applier itself was built with. */
function apply(w, moves) {
    w.ctx.twLastRecommendation = { best: { n: moves.length, moves } };
    const fn = loadFunction(SRC, 'twApplyRecommendation', w.ctx);
    fn();
}

test('a loaded plan lands on the Overview, in the mode that renders it', () => {
    /* The second fault. Step 4 alone was not enough: the pane reads mode. */
    const w = wizard();
    apply(w, [move(1, 101), move(2, 102), move(3, 103)]);
    assert.equal(w.state.step, 4, 'the Overview');
    assert.equal(w.state.mode, 'summary', 'and the mode the pane dispatches on');
});

test('the cart survives, with every slot filled', () => {
    const w = wizard();
    apply(w, [move(1, 101), move(2, 102)]);
    assert.equal(w.state.pending.length, 2);
    assert.deepEqual(w.state.pending.map(s => s.soldPlayer.id), [1, 2]);
    assert.deepEqual(w.state.pending.map(s => s.replacement.id), [101, 102]);
    assert.ok(w.state.pending.every(s => s.replacement), 'no open slots');
});

test('the plan is set before the cart, so the switch cannot wipe it', () => {
    /* The first fault. twSetStrategy empties pending on an actual switch, so
       setting the strategy after filling the cart deleted it. */
    const w = wizard();
    apply(w, [move(1, 101), move(2, 102), move(3, 103)]);
    assert.equal(w.state.strategy, 'multi');
    assert.equal(w.state.pending.length, 3, 'the cart was not emptied by the switch');
});

test('one transfer is a single plan, several is multi', () => {
    const one = wizard();
    apply(one, [move(1, 101)]);
    assert.equal(one.state.strategy, 'single');

    const many = wizard();
    apply(many, [move(1, 101), move(2, 102)]);
    assert.equal(many.state.strategy, 'multi');
});

test('loading over an existing plan replaces it rather than appending', () => {
    const w = wizard({ strategy: 'single', pending: [{ soldPlayer: { id: 9 }, replacement: { id: 99 } }] });
    apply(w, [move(1, 101), move(2, 102)]);
    assert.equal(w.state.pending.length, 2);
    assert.ok(!w.state.pending.some(s => s.soldPlayer.id === 9), 'the old pick is gone');
});

test('re-loading the same size of plan does not empty the cart', () => {
    /* strategy is already 'multi', so twSetStrategy sees no switch and must not
       throw the work away — the guard inside it is `switched`. */
    const w = wizard({ strategy: 'multi' });
    apply(w, [move(1, 101), move(2, 102)]);
    assert.equal(w.state.pending.length, 2);
});

test('nothing to load is a no-op, not a reset', () => {
    const w = wizard({ strategy: 'single', pending: [{ soldPlayer: { id: 9 }, replacement: { id: 99 } }], step: 2 });
    w.ctx.twLastRecommendation = { best: { n: 0, moves: [] } };
    loadFunction(SRC, 'twApplyRecommendation', w.ctx)();
    assert.equal(w.state.step, 2, 'the manager is not moved');
    assert.equal(w.state.pending.length, 1, 'and keeps what they had');

    const none = wizard({ step: 2 });
    none.ctx.twLastRecommendation = null;
    loadFunction(SRC, 'twApplyRecommendation', none.ctx)();
    assert.equal(none.state.step, 2);
});

test('the Overview is reachable by the wizard\'s own rule', () => {
    /* twRailGo refuses an unreachable step, so if this ever stopped being true
       the button would silently leave the manager on step 1 again. */
    const w = wizard();
    apply(w, [move(1, 101), move(2, 102)]);
    const reachable = loadFunction(SRC, 'twStepReachable', {
        TW_STEPS, transferState: w.state
    });
    assert.equal(reachable(4), true);
});

test('the engine can never hand over a plan bigger than the wizard allows', () => {
    /* TW_MAX_PLAN in the engine and TW_PLAN_CAP.multi here are two numbers that
       have to agree; a recommendation larger than the cap would be loaded and
       then refused by the next thing that checked. */
    const engine = loadFunction('scripts/transfer-engine.js', 'twPlanChain', {
        TW_MIN_FREE_GAIN: 3.0, TW_MIN_HIT_GAIN: 4.0, TW_MAX_PLAN: 5
    });
    const many = Array.from({ length: 9 }, (_, i) => ({
        out: { id: i, status: 'a', position: 3, teamId: `t${i}` },
        in: { id: 100 + i, teamId: `t${i}` }, gain: 20, _solo: 20
    }));
    const longest = engine(many, {
        ft: 8, jointGain: ms => ms.length * 20, legal: () => true
    }).chain.length;

    const src = loadFunction(SRC, 'twMaxTransfers', {
        transferState: { wildcard: false, strategy: 'multi' },
        TW_PLAN_CAP: { single: 1, multi: 5, wildcard: 15, freehit: 15 }
    });
    assert.ok(longest <= src(), `engine can plan ${longest}, wizard allows ${src()}`);
});
