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
    /* The cap is the plan's, not one number for everything that is not a chip.
       Single was letting you stage five, which is the opposite of what Single
       says it is. It is deliberately not capped at your free transfers either:
       exceeding them is legal and often right — that is what a hit is for. */
    const table = [
        // strategy      wildcard  sellMode  transfer cap
        ['single', false, false, 1],
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
    tw.managerHistory = { current: [], chips: [] };
    // Picking a plan clears whatever was staged under the old one, so each
    // strategy is priced against a freshly staged three.
    const stage = () => {
        tw.transferState.pending = [1, 2, 3].map(i => ({ soldPlayer: { id: i }, replacement: null }));
    };

    tw.twSetStrategy('single');
    stage();
    const paid = tw.getTWHitCost();
    assert.ok(paid > 0, `three transfers on one free transfer costs points, got ${paid}`);

    tw.twSetStrategy('multi');
    stage();
    assert.equal(tw.getTWHitCost(), paid, 'multi is a way of selecting, not a chip — it still costs');

    for (const chip of ['wildcard', 'freehit']) {
        tw.twSetStrategy(chip);
        stage();
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

test('switching strategy clears the selection rather than carrying it over', () => {
    /* Who you sell is a decision made under one plan. Three players staged for
       a wildcard are not three players you meant to take a −8 hit for, and the
       per-slot filters (a price band, a club list) chosen while spending one
       free transfer are the wrong starting point for a wildcard with the whole
       budget open. So a real switch empties the slots and drops back to the
       squad, and the next read seeds fresh ones.

       This used to be about the horizon the filters carried. They no longer
       carry one — twfGWs() asks twStrategyHorizon() live — and
       tests/transfer-funnel-slots.test.mjs pins the window. */
    const tw = load();
    const stage = () => {
        tw.transferState.pending = [{
            soldPlayer: { id: 1, position: 2 }, replacement: null,
            funnel: { price: 'cheaper', clubs: [1, 14] }
        }];
        tw.transferState.activeSlot = 0;
        tw.transferState.mode = 'funnel';
    };

    stage();
    tw.twSetStrategy('freehit');
    assert.equal(tw.transferState.pending.length, 0, 'the selection made under the old plan is dropped');
    assert.equal(tw.transferState.activeSlot, -1, 'and no slot is left pointing at nothing');
    assert.equal(tw.transferState.mode, 'squad', 'and you land back on the squad to pick again');

    // Re-picking the plan you are already on is not a switch — it must not
    // wipe work in progress.
    stage();
    tw.twSetStrategy('freehit');
    assert.equal(tw.transferState.pending.length, 1, 're-selecting the same plan keeps the selection');
    assert.equal(tw.transferState.pending[0].funnel, null, 'though the search still re-seeds');
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


/* ===== the cap is the plan's, and only the plan's =====

   Two things were conflated in the report that produced this. The cap used to
   be five for everything that was not a chip, so Single — "one transfer at a
   time" — would let you stage five. And the counter read "5 / 1 free", which
   parses as "five allowed, one of them free" rather than "five staged, one of
   them free", so a manager with one free transfer read it as a claim they
   could make five for nothing. */

test('a plan caps at what the plan says, not at a single shared number', () => {
    const tw = load();
    const cap = s => { tw.twSetStrategy(s); return tw.twMaxTransfers(); };
    assert.equal(cap('single'), 1, 'one transfer at a time means one');
    assert.equal(cap('multi'), 5);
    assert.equal(cap('wildcard'), 15, 'a chip is bounded by the squad, not by a rule');
    assert.equal(cap('freehit'), 15);
});

test('having one free transfer does not cap the plan at one', () => {
    /* twFreeTransfers() is stubbed at 1 in load(). Exceeding it costs four
       points a go and is often the right move — refusing it would be the
       wizard inventing a rule the game does not have. The hit is what prices
       it, so that is what has to move, not the cap. */
    const tw = load();
    tw.twSetStrategy('multi');
    assert.equal(tw.twMaxTransfers(), 5, 'still five with one free transfer');
    tw.transferState.pending = [1, 2, 3].map(i => ({ soldPlayer: { id: i }, replacement: null }));
    assert.equal(tw.getTWHitCost(), 8, 'and the two beyond the free one cost 4 each');
});
