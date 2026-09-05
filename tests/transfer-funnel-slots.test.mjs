/* Which pending transfer owns which set of market filters.

   The reported symptom was that selecting several players made the wizard
   panel "lose context and only show the most recently clicked player". The
   filters were the cause, and not in the way it sounds: they lived in one
   object shared by every slot, so nothing was lost — the wrong search was
   kept, and the chips at the top described a search you were no longer
   running. That reads identically from the outside and is the opposite bug,
   which is why it is pinned here from both directions: a slot must remember
   its own search, and must not be handed someone else's.

   The competing requirement is real too, and predates this: filling eight
   slots on a wildcard must not mean re-picking the same six clubs eight
   times. Both are asserted below. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load() {
    const ctx = {
        console,
        escHTML: (s) => String(s == null ? '' : s),
        document: { getElementById: () => null, querySelector: () => null },
        transferState: { pending: [], activeSlot: -1, mode: 'squad', funnel: null },
        // Read by twfGWs; nothing here exercises it, but the file expects it.
        xpPlanGWs: (n) => Array.from({ length: n }, (_, i) => 1 + i),
        playersDetailData: null
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    const f = 'scripts/transfer-funnel.js';
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInContext(ctx);
    return ctx;
}

// position: 2 = defender, 4 = forward.
const slot = (id, position, name) => ({
    soldPlayer: { id, position, name, price: 6.0, sellPrice: 6.0 },
    replacement: null
});

// Open a slot the way twSwapPlayer does, then hand back its filters.
function open(ctx, i) {
    ctx.transferState.activeSlot = i;
    return ctx.twfState();
}

test('each slot keeps its own search', () => {
    const ctx = load();
    ctx.transferState.pending = [slot(1, 2, 'Centre-back'), slot(2, 4, 'Striker')];

    const def = open(ctx, 0);
    def.clubs = [1, 14];
    def.price = 'cheaper';
    def.minutes = 'nailed';

    const fwd = open(ctx, 1);
    assert.deepEqual([...fwd.clubs], [], 'a striker search does not start inside the defender\'s club list');
    assert.equal(fwd.price, 'any', 'nor with a price band chosen for someone else');
    assert.equal(fwd.minutes, 'any');

    // And the defender's search is still there when you go back to it — this is
    // the half that makes it a memory rather than a reset.
    fwd.clubs = [7];
    const again = open(ctx, 0);
    assert.deepEqual([...again.clubs], [1, 14], 'the defender search survived the round trip');
    assert.equal(again.price, 'cheaper');
    assert.equal(again.minutes, 'nailed');
});

test('filters are not shared objects', () => {
    // The original defect in one assertion: two slots handed the same reference.
    const ctx = load();
    ctx.transferState.pending = [slot(1, 2, 'A'), slot(2, 4, 'B')];
    assert.notEqual(open(ctx, 0), open(ctx, 1), 'distinct objects per slot');
});

test('a slot of the same position inherits the search', () => {
    /* The wildcard case the shared object existed to serve. Three defenders to
       replace and one strategy: pick the clubs once. */
    const ctx = load();
    ctx.transferState.pending = [slot(1, 2, 'CB one')];
    const first = open(ctx, 0);
    first.clubs = [1, 14, 11];
    first.own = 'diff';
    first.setPiece = 'pens';

    ctx.transferState.pending.push(slot(2, 2, 'CB two'));
    const second = open(ctx, 1);
    assert.deepEqual([...second.clubs], [1, 14, 11], 'same position, same search');
    assert.equal(second.own, 'diff');
    assert.equal(second.setPiece, 'pens');

    // Inherited, not shared: diverging one must not move the other.
    second.own = 'template';
    assert.equal(open(ctx, 0).own, 'diff', 'the first slot is untouched');
});

test('inheriting resets the things that never transfer', () => {
    const ctx = load();
    ctx.transferState.pending = [slot(1, 2, 'CB one')];
    const first = open(ctx, 0);
    first.clubs = [5];
    first.search = 'Gvardiol';
    first.step = 2;

    ctx.transferState.pending.push(slot(2, 2, 'CB two'));
    const second = open(ctx, 1);
    assert.deepEqual([...second.clubs], [5], 'the strategy carries');
    assert.equal(second.search, '', 'a name typed for one player is never the start for another');
    assert.equal(second.step, 1, 'and you land on Narrow so the inherited filters are visible');
});

test('the most recent same-position slot is the one inherited from', () => {
    const ctx = load();
    ctx.transferState.pending = [slot(1, 2, 'CB one'), slot(2, 2, 'CB two')];
    open(ctx, 0).clubs = [1];
    open(ctx, 1).clubs = [9, 10];

    ctx.transferState.pending.push(slot(3, 2, 'CB three'));
    assert.deepEqual([...open(ctx, 2).clubs], [9, 10], 'the latest search, not the oldest');
});

test('horizon and sort follow you everywhere', () => {
    // How you read the market, not who you are looking for.
    const ctx = load();
    ctx.transferState.pending = [slot(1, 2, 'CB'), slot(2, 4, 'ST')];
    open(ctx, 0);
    ctx.twfSetHorizon(8);
    ctx.twfSetSort('form');

    const fwd = open(ctx, 1);
    assert.equal(fwd.horizon, 8, 'a different position still reads over the same window');
    assert.equal(fwd.sort, 'form');
});

test('resetting clears the active slot and no other', () => {
    const ctx = load();
    ctx.transferState.pending = [slot(1, 2, 'CB'), slot(2, 4, 'ST')];
    open(ctx, 0).clubs = [1, 2];
    const fwd = open(ctx, 1);
    fwd.clubs = [7];
    fwd.own = 'diff';

    ctx.twfResetFilters();
    assert.deepEqual([...ctx.twfState().clubs], [], 'the striker search is cleared');
    assert.equal(ctx.twfState().own, 'any');
    assert.deepEqual([...open(ctx, 0).clubs], [1, 2], 'the defender search is not');
});

test('reset writes through to the slot rather than to the screen', () => {
    /* twfResetFilters used to reassign transferState.funnel. With the filters
       living on the slot that would have left the slot's own object untouched
       and reset something nothing was reading. */
    const ctx = load();
    ctx.transferState.pending = [slot(1, 2, 'CB')];
    const f = open(ctx, 0);
    f.clubs = [3, 4];
    ctx.twfResetFilters();
    assert.deepEqual([...f.clubs], [], 'the object the slot holds is the one that was reset');
    assert.equal(ctx.transferState.pending[0].funnel, f, 'and it is still the slot\'s object');
});

test('a removed slot takes its filters with it', () => {
    // Slots are addressed by index, so a stale funnel left behind would be
    // inherited by whichever transfer landed on that index next.
    const ctx = load();
    ctx.transferState.pending = [slot(1, 2, 'CB'), slot(2, 4, 'ST')];
    open(ctx, 0).clubs = [1, 2, 3];
    open(ctx, 1);

    ctx.transferState.pending.splice(0, 1);          // twRemoveSlot
    ctx.transferState.pending.push(slot(3, 2, 'New CB'));
    assert.deepEqual([...open(ctx, 1).clubs], [], 'the departed defender left nothing behind');
});

test('filters can be read with no slot selected', () => {
    // The summary and comparison panes do exactly this.
    const ctx = load();
    ctx.transferState.pending = [];
    ctx.transferState.activeSlot = -1;
    const s = ctx.twfState();
    assert.ok(s && typeof s.horizon === 'number', 'a usable object rather than a throw');
    assert.equal(ctx.twfState(), s, 'and a stable one');
});

test('an explicit slot index can be asked for', () => {
    const ctx = load();
    ctx.transferState.pending = [slot(1, 2, 'CB'), slot(2, 4, 'ST')];
    open(ctx, 0).clubs = [6];
    ctx.transferState.activeSlot = 1;
    assert.deepEqual([...ctx.twfState(0).clubs], [6], 'reads the slot asked for, not the active one');
});
