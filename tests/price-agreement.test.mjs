/* The dashboard and the transfers page must say the same thing about a price.

   They did not. The dashboard read price_change_percent, the game's own meter,
   and the transfers page ran a model written before that field existed: net
   transfers over the owner base, times five hundred, clamped. So one panel
   called Ballard a near-certain drop at −92.5 while the other, at −11.5, said
   no squad player was close to dropping at all.

   The model was not merely miscalibrated. Dividing by a tiny owner base
   saturates the clamp on a handful of transfers, so Matusiwa — three in, two
   out, 0.0% owned — scored a maximum +100 RISE while the game had him at −90.3.

   This file pins the fix as an invariant rather than as an implementation:
   whatever either panel does, they must agree about every player. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

/* Both files in one context, exactly as the page loads them — price-watch.js
   first, because the wizard's tiers now read PW_DUE and PW_CLOSE from it. */
function load() {
    const ctx = {
        console,
        escHTML: (s) => String(s == null ? '' : s),
        document: { getElementById: () => null, querySelector: () => null },
        transferState: { pending: [], activeSlot: -1, mode: 'squad', funnel: null },
        selectedPlayers: [], picksData: { entry_history: { bank: 0 } },
        xpPlanGWs: (n) => Array.from({ length: n }, (_, i) => 4 + i),
        renderTWAll: () => {}, updateStatus: () => {},
        twFreeTransfers: () => 1, twFreeTransfersExact: () => true,
        totalFplPlayers: 10473307
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    for (const f of ['scripts/price-watch.js', 'scripts/transfer-wizard.js']) {
        new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInContext(ctx);
    }
    return ctx;
}
const evalIn = (ctx, expr) => vm.runInContext(expr, ctx);

/* Real figures from bootstrap-static, GW3. `progress` is the game's meter;
   the transfer counts are what the old model was computed from. */
const REAL = [
    { name: 'Ballard', priceProgress: -92.5, ownership: 4.0, transfersIn: 365, transfersOut: 9965 },
    { name: 'Matusiwa', priceProgress: -90.3, ownership: 0.0, transfersIn: 3, transfersOut: 2 },
    { name: 'Groß', priceProgress: 90.0, ownership: 16.0, transfersIn: 30615, transfersOut: 5812 },
    { name: 'Rice', priceProgress: -101.7, ownership: 14.2, transfersIn: 1539, transfersOut: 10627 },
    { name: 'Semenyo', priceProgress: -96.7, ownership: 19.3, transfersIn: 1520, transfersOut: 29694 }
].map((p, i) => ({ id: i + 1, price: 5.0, priceProjection: [p.priceProgress, p.priceProgress], priceLockedUntil: null, ...p }));

test('the transfers page reads the game meter, not a model of it', () => {
    const tw = load();
    for (const p of REAL) {
        assert.equal(tw.priceThresholdPct(p), p.priceProgress, `${p.name} is read straight through`);
    }
});

test('Ballard is a drop on both panels', () => {
    // The exact contradiction that was reported.
    const tw = load();
    const ballard = REAL.find(p => p.name === 'Ballard');

    const dash = tw.pwClassify(ballard);
    assert.ok(dash, 'the dashboard sees him');
    assert.equal(dash.dir, 'fall');

    const page = tw.thresholdState(tw.priceThresholdPct(ballard));
    assert.match(page.short, /Dropping|Sliding/, `the transfers page agrees, got "${page.short}"`);
    assert.notEqual(page.short, 'Safe', 'and never calls him safe again');
});

test('a player nobody owns cannot be conjured into a riser', () => {
    /* Matusiwa: three transfers in, two out, 0.0% ownership. The old model
       divided by an owner base of one and clamped to a maximum rise. */
    const tw = load();
    const m = REAL.find(p => p.name === 'Matusiwa');
    assert.ok(tw.priceThresholdPct(m) < 0, 'he is falling, as the game says');
    assert.equal(tw.thresholdState(tw.priceThresholdPct(m)).cls.startsWith('rise'), false);
});

test('both panels use one set of tiers', () => {
    /* The deeper fix. Two hand-picked pairs of numbers — -80/+90 on one page,
       80/100 on the other — is how they drifted apart in the first place. */
    const tw = load();
    const due = evalIn(tw, 'PW_DUE');
    const close = evalIn(tw, 'PW_CLOSE');

    assert.equal(tw.thresholdState(due).cls, 'rise-imminent');
    assert.equal(tw.thresholdState(-due).cls, 'drop-imminent');
    assert.equal(tw.thresholdState(close).cls, 'rise');
    assert.equal(tw.thresholdState(-close).cls, 'drop');
    /* Short of the watch line the page still has something to say, and what it
       says is which way he is going. It must not promote him to a watch tier. */
    assert.equal(tw.thresholdState(close - 1).cls, 'drift-up');
    assert.equal(tw.thresholdState(-(close - 1)).cls, 'drift-down');
    assert.ok(!/^(rise|drop)/.test(tw.thresholdState(close - 1).cls));
    assert.ok(!/^(rise|drop)/.test(tw.thresholdState(-(close - 1)).cls));
});

test('a player being bought is not described like one being sold', () => {
    /* The whole middle of the meter used to be one word, "Safe". Measured on
       the live feed that was 605 of 659 players sharing a label: 300 of them
       being sold, 164 being bought, 141 genuinely still. An owner opening this
       column wants one thing from it — which way is my player going — and that
       was the thing it threw away. Worse in the selling direction than the
       buying one: a player 60% of the way to a DROP was called safe. */
    const tw = load();
    const up = tw.thresholdState(45);
    const down = tw.thresholdState(-45);
    const flat = tw.thresholdState(0);
    assert.notEqual(up.text, down.text, 'bought and sold cannot read the same');
    assert.notEqual(up.text, 'Safe');
    assert.notEqual(down.text, 'Safe');
    assert.notEqual(up.cls, down.cls, 'nor be coloured the same');
    assert.notEqual(up.cls, flat.cls, 'nor the same as a player who has not moved');
    // Zero is its own answer, and a fifth of the league sits exactly there.
    assert.equal(flat.cls, 'stable');
});

test('every real player is classified the same way by both', () => {
    /* The invariant, stated once over the whole set: if the dashboard shows a
       player as moving, the transfers page must not call him safe, and the
       direction must match. */
    const tw = load();
    for (const p of REAL) {
        const dash = tw.pwClassify(p);
        const page = tw.thresholdState(tw.priceThresholdPct(p));
        /* Agreement is that the two never contradict, not that they say the
           same amount. price-watch returns null below its line and simply omits
           the player; the transfers page still names his direction there, which
           is more, not different. The invariant is therefore about the watch
           tiers — the vocabulary both panels publish — plus a direction check
           that now covers every player rather than only the ones on watch. */
        const isWatch = /^(rise|drop)/.test(page.cls);
        if (!dash) {
            assert.ok(!isWatch, `${p.name}: quiet on the dashboard, not a watch item here`);
        } else {
            assert.ok(isWatch, `${p.name}: the dashboard shows him moving`);
            const pageDir = page.cls.startsWith('rise') ? 'rise' : 'fall';
            assert.equal(pageDir, dash.dir, `${p.name}: same direction`);
            if (dash.tier === 'due') {
                assert.match(page.cls, /imminent/, `${p.name}: a full meter is due on both`);
            }
        }

        // Whatever tier he lands in, the word must not contradict the sign.
        const pct = tw.priceThresholdPct(p);
        const sign = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
        const shown = /up|rise/.test(page.cls) ? 'up'
            : /down|drop/.test(page.cls) ? 'down' : 'flat';
        assert.equal(shown, sign, `${p.name}: ${page.text} against a meter of ${pct}`);
    }
});

test('a missing meter is treated as quiet rather than as a fall', () => {
    // price_change_percent is absent for a player with no data yet, and zero is
    // the honest reading of "nothing has happened".
    const tw = load();
    assert.equal(tw.priceThresholdPct({ id: 9 }), 0);
    assert.equal(tw.priceThresholdPct({ id: 9, priceProgress: null }), 0);
    assert.equal(tw.priceThresholdPct(null), 0);
    assert.equal(tw.thresholdState(0).cls, 'stable');
});

/* ===== When the market actually closes =====

   FPL moved price changes to 00:00 UK for 2026/27 — the Premier League's own
   announcement of the Price Change Predictor says the tool indicates who rises
   and falls "each day at 00:00 UK time". The site had 01:30 UTC hard-coded,
   which is late in winter and, through British Summer Time, the wrong day. */

test('the market closes at midnight in London, not at a fixed UTC hour', () => {
    const tw = load();
    // Mid-September: London is on BST, so midnight there is 23:00 UTC.
    const summer = tw.nextPriceLock(Date.UTC(2026, 8, 5, 12, 0));
    assert.equal(summer.toISOString(), '2026-09-05T23:00:00.000Z');

    // Mid-January: London is on GMT, so midnight is 00:00 UTC.
    const winter = tw.nextPriceLock(Date.UTC(2027, 0, 15, 12, 0));
    assert.equal(winter.toISOString(), '2027-01-16T00:00:00.000Z');
});

test('it is always the next one, never one that has passed', () => {
    const tw = load();
    // 23:30 UTC in summer is 00:30 London — midnight has just gone, so the
    // answer is tomorrow's.
    const justAfter = tw.nextPriceLock(Date.UTC(2026, 8, 5, 23, 30));
    assert.equal(justAfter.toISOString(), '2026-09-06T23:00:00.000Z');
    assert.ok(justAfter.getTime() > Date.UTC(2026, 8, 5, 23, 30), 'strictly in the future');

    // And ten minutes before it, it is ten minutes away.
    const justBefore = tw.nextPriceLock(Date.UTC(2026, 8, 5, 22, 50));
    assert.equal(justBefore.getTime() - Date.UTC(2026, 8, 5, 22, 50), 10 * 60 * 1000);
});

test('the clocks changing does not move the deadline by an hour', () => {
    /* BST ends at 02:00 on 25 October 2026. The offset on the evening before
       is not the offset at the midnight being computed, which is why it is
       recomputed at the target. */
    const tw = load();
    const acrossChange = tw.nextPriceLock(Date.UTC(2026, 9, 24, 12, 0));
    assert.equal(acrossChange.toISOString(), '2026-10-24T23:00:00.000Z', 'still BST that night');

    const after = tw.nextPriceLock(Date.UTC(2026, 9, 25, 12, 0));
    assert.equal(after.toISOString(), '2026-10-26T00:00:00.000Z', 'GMT from the next night on');
});
