/* Why a recommended transfer is recommended.

   This file adds no model — it reports numbers the page already has — so what
   can go wrong here is not arithmetic but assertion: a card that states
   something the data does not support. A blank gameweek averaged in as an easy
   fixture, a flagged player described as nailed, a loss described as a gain.
   Each of those renders exactly as confidently as a correct one, which is why
   they are pinned here rather than left to be noticed on the page.

   The dependencies are stubbed rather than loaded. That is the point of the
   file being a reporting layer: it lets a horizon curve be set to a precise
   shape and the resulting sentence checked, which is not possible when the xP
   engine is deciding what the numbers are. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// The real one, so escaping assertions mean something.
const escHTML = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function load(over = {}) {
    const ctx = {
        console, escHTML,
        // GW4 onward, so a 3-gameweek horizon is [4,5,6].
        xpPlanGWs: (n) => Array.from({ length: n }, (_, i) => 4 + i),
        xpOver: (p, gws) => (p.xpPerGW || 0) * gws.length,
        expectedMinutesModel: (p) => ({ pStart: p.pStart ?? 0.9, expMins: p.expMins ?? 85 }),
        teamFixtures6: {},
        fixtureSwingData: {},
        ...over
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    const f = 'scripts/transfer-rationale.js';
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInContext(ctx);
    return ctx;
}

const player = (name, extra = {}) => ({
    id: extra.id ?? 1, name, team: 'BHA', teamId: 5, position: 3,
    price: 6.0, sellPrice: 6.0, ownership: 12, status: 'a', news: '', ...extra
});

// A move whose per-gameweek edge is constant, so the 3/5/8 deltas are a
// straight multiple and any shape can be dialled in exactly.
const move = (outPer, inPer, extra = {}) => ({
    out: player('Seller', { id: 1, xpPerGW: outPer, ...(extra.out || {}) }),
    in: player('Buyer', { id: 2, teamId: 7, xpPerGW: inPer, ...(extra.in || {}) })
});

const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

test('the three horizons are reported separately', () => {
    const tr = load();
    const r = tr.trRationale(move(1.0, 2.0));
    // Spread first: the arrays come from the vm realm and carry its
    // Object.prototype, which deepStrictEqual counts as a difference.
    assert.deepEqual([...r.horizons.map(h => h.n)], [3, 5, 8], 'three, five and eight');
    // +1.0 per gameweek, so the delta is the horizon.
    assert.deepEqual([...r.horizons.map(h => h.delta)], [3, 5, 8]);
});

test('the shape says whether you are buying a player or renting a run', () => {
    const tr = load();

    /* A constant weekly edge is the baseline the labels are measured against.
       It must come out "steady": the deltas are cumulative, so this move reads
       +3 at three gameweeks and +8 at eight, and a classifier that compares
       those totals directly would call an ordinary upgrade a long-term one. */
    const flat = tr.trRationale(move(1.0, 2.0));
    assert.deepEqual([...flat.horizons.map(h => h.delta)], [3, 5, 8], 'growing totals…');
    assert.equal(flat.shape, 'steady', '…but a flat rate, which is what the label means');
    assert.ok(/a gameweek throughout/.test(text(tr.trRenderCard(flat))), 'and the prose names the rate');

    // Front-loaded: the buyer's advantage is spent by GW6 and the seller then
    // outscores him, so the cumulative edge shrinks.
    const split = load({ xpOver: (p, gws) => gws.reduce((s, g) => s + (g <= 6 ? (p.early || 0) : (p.late || 0)), 0) });
    const fr = split.trRationale({
        out: player('Seller', { id: 1, early: 0, late: 2 }),
        in: player('Buyer', { id: 2, early: 3, late: 0.5 })
    });
    assert.equal(fr.shape, 'fixture-run', 'all the edge is in the near fixtures');
    assert.ok(fr.horizons.find(h => h.n === 3).delta > fr.horizons.find(h => h.n === 8).delta,
        'and the numbers agree with the label');

    const back = split.trRationale({
        out: player('Seller', { id: 1, early: 2, late: 0 }),
        in: player('Buyer', { id: 2, early: 2.5, late: 3 })
    });
    assert.equal(back.shape, 'long-term-upgrade', 'the edge arrives later');
    // Genuine acceleration, not the arithmetic of a longer window.
    const r3 = back.horizons.find(h => h.n === 3), r8 = back.horizons.find(h => h.n === 8);
    assert.ok(r8.delta / 8 > r3.delta / 3, 'more per gameweek later than now');
});

test('a rate that rounds to nothing is not quoted as a rate', () => {
    // Deltas are rounded to a decimal place before the rate is taken, so a
    // marginal move divides 0.1 by three and reads "worth about 0.0 a gameweek".
    const tr = load();
    const r = tr.trRationale(move(1.0, 1.0333));
    assert.equal(r.horizons.find(h => h.n === 3).delta, 0.1, 'a marginal edge');
    assert.equal(r.shape, 'steady');
    const prose = text(tr.trRenderCard(r));
    assert.ok(/close to neutral/.test(prose), prose);
    assert.ok(!/0\.0 a gameweek/.test(prose), 'never quotes a rate of nothing');
});

test('a move that is behind early is not described as a gain', () => {
    /* Ratios were the original classifier, and a fraction of a negative number
       is meaningless: at −2 over three gameweeks, "keeps 40% of the edge" is
       satisfied by −0.8 (improving) and by −5 (getting worse) alike. The
       recommender decides on five gameweeks, so being behind at three is a
       legitimate shape and has to be classified by direction. */
    const tr = load({ xpOver: (p, gws) => gws.reduce((s, g) => s + (g <= 6 ? (p.early || 0) : (p.late || 0)), 0) });

    const payNow = tr.trRationale({
        out: player('Seller', { id: 1, early: 3, late: 0 }),
        in: player('Buyer', { id: 2, early: 2, late: 3 })
    });
    assert.ok(payNow.horizons.find(h => h.n === 3).delta < 0, 'genuinely behind at three');
    assert.equal(payNow.shape, 'long-term-upgrade');
    const prose = text(tr.trRenderCard(payNow));
    assert.ok(/costs you/.test(prose), `says it costs you now: ${prose}`);
    assert.ok(!/good now/.test(prose), 'never calls a loss "good now"');

    const justWorse = tr.trRationale({
        out: player('Seller', { id: 1, early: 3, late: 3 }),
        in: player('Buyer', { id: 2, early: 2, late: 1 })
    });
    assert.equal(justWorse.shape, 'fixture-run', 'behind and getting further behind');
    const worseProse = text(tr.trRenderCard(justWorse));
    assert.ok(/gap widens against you/.test(worseProse), `is honest about it: ${worseProse}`);
    assert.ok(!/\bgain\b/.test(worseProse), 'and does not call it a gain');
    assert.ok(!/good now/.test(worseProse), 'nor good now');
});

test('a blank gameweek is not averaged away as an easy fixture', () => {
    /* The failure this prevents: dropping blanks before averaging turns "two
       fixtures and a blank" into a better-looking run than three real ones,
       which is precisely backwards. */
    const tr = load({
        teamFixtures6: {
            5: [{ event: 4, difficulty: 2, opponent: 'LUT', isHome: true },
                { event: 6, difficulty: 2, opponent: 'BUR', isHome: true }],   // GW5 blank
            7: [{ event: 4, difficulty: 2, opponent: 'LUT', isHome: true },
                { event: 5, difficulty: 2, opponent: 'SHU', isHome: false },
                { event: 6, difficulty: 2, opponent: 'BUR', isHome: true }]
        }
    });
    const r = tr.trRationale({
        out: player('Blanker', { id: 1, teamId: 5, xpPerGW: 1 }),
        in: player('Plays', { id: 2, teamId: 7, xpPerGW: 1 })
    });

    const outStrip = r.fixtures.out.strip;
    assert.equal(outStrip.length, 5, 'the strip covers the horizon, not just the fixtures');
    const blank = outStrip.find(f => f.gw === 5);
    assert.equal(blank.blank, true, 'GW5 is reported as a blank');
    assert.equal(blank.difficulty, null, 'and carries no difficulty to average');

    // Both sides average 2.0 over the fixtures they actually have; the blank
    // must not flatter the one that is missing a game.
    assert.equal(r.fixtures.out.avgFdr, 2, 'blanks are excluded from the mean, not counted as easy');
    const html = tr.trRenderCard(r);
    assert.ok(/tr-fx blank/.test(html), 'and the blank is drawn rather than skipped');
    assert.ok(/no fixture/.test(html), 'labelled for what it is');
});

test('a double gameweek is marked and does not lose its second fixture', () => {
    const tr = load({
        teamFixtures6: {
            7: [{ event: 4, difficulty: 2, opponent: 'LUT', isHome: true },
                { event: 4, difficulty: 3, opponent: 'BUR', isHome: false }]
        }
    });
    const r = tr.trRationale(move(1, 2, { in: { teamId: 7 } }));
    const gw4 = r.fixtures.in.strip.find(f => f.gw === 4);
    assert.equal(gw4.double, true, 'two fixtures in one gameweek is a double');
    assert.ok(/tr-fx fdr-2 dbl/.test(tr.trRenderCard(r)), 'and the chip says so');
});

test('a fitness flag outranks the minutes model', () => {
    /* The model reads history; the flag is the club saying something about
       Saturday. A player who started every game until he pulled a hamstring
       still scores "nailed" on history alone. */
    const tr = load();
    const r = tr.trRationale(move(1, 2, {
        in: { pStart: 0.97, expMins: 89, status: 'd', news: 'Knock - 75% chance of playing' }
    }));
    assert.equal(r.risk.in.label, 'nailed', 'the model still reports what it sees');
    assert.equal(r.risk.in.flagged, true, 'but the flag is recorded alongside it');

    const html = tr.trRenderCard(r);
    assert.ok(/Knock - 75% chance/.test(html), 'with the club\'s own words');

    // Both players share the Minutes row, and the seller is legitimately
    // nailed — so the sides have to be checked apart or the assertion passes
    // on the wrong one.
    const row = /Minutes<\/span>\s*<span class="tr-vals">([\s\S]*?)<\/span>\s*<\/div>/.exec(html);
    assert.ok(row, 'the minutes row renders');
    const [seller, buyer] = row[1].split('→');
    assert.ok(/>nailed</.test(seller), 'the unflagged side reports what the model saw');
    assert.ok(/tr-risk bad/.test(buyer) && />flagged</.test(buyer), 'the flagged side reports the flag');
    assert.ok(!/nailed/.test(buyer), 'never labelled nailed while flagged');
});

test('money that does not add up is reported as unaffordable', () => {
    const tr = load();
    const r = tr.trRationale(move(1, 2, { in: { price: 9.5 } }), { bank: 0.5 });
    assert.equal(r.money.affordable, false, '6.0 sold plus 0.5 banked does not buy 9.5');
    assert.equal(r.money.bankAfter, -3, 'and the shortfall is the number');

    const html = tr.trRenderCard(r);
    assert.ok(/tr-vals bad/.test(html), 'flagged in the markup');
    assert.ok(/£3.0m more than selling/.test(html), `states the shortfall: ${text(html)}`);
    assert.ok(!/left in the bank/.test(html), 'and never claims money is left over');
});

test('selling price is used rather than list price', () => {
    // The difference is real money: a player bought at 5.0 and now worth 6.0
    // sells for 5.5, and using 6.0 invents half a million pounds.
    const tr = load();
    const r = tr.trRationale(move(1, 2, { out: { price: 6.0, sellPrice: 5.5 } }), { bank: 0 });
    assert.equal(r.money.sellPrice, 5.5);
    assert.equal(r.money.bankAfter, -0.5, 'the buy is 6.0 against 5.5 raised');
});

test('the ownership line stands on its own in both directions', () => {
    /* It read "taking 1.3pp away from it" where "it" was the template, a word
       that only appeared in the other branch. */
    const tr = load();
    const differential = text(tr.trRenderCard(tr.trRationale(move(1, 2, {
        out: { ownership: 40 }, in: { ownership: 4 }
    }))));
    assert.ok(/less owned/.test(differential), differential);
    assert.ok(/gains rank/.test(differential), 'says what a differential does to you');
    assert.ok(!/away from it\b/.test(differential), 'no dangling pronoun');

    const template = text(tr.trRenderCard(tr.trRationale(move(1, 2, {
        out: { ownership: 4 }, in: { ownership: 40 }
    }))));
    assert.ok(/more owned/.test(template) && /follows the field/.test(template), template);

    const same = text(tr.trRenderCard(tr.trRationale(move(1, 2, {
        out: { ownership: 20 }, in: { ownership: 20.4 }
    }))));
    assert.ok(/much the same share/.test(same), 'a rounding-error difference is not a story');
});

test('the header can be suppressed for a card that already has one', () => {
    // The recommendation panel draws its own out → in line; two of them stacked
    // read as two different moves rather than one move explained twice.
    const tr = load();
    const r = tr.trRationale(move(1, 2));
    assert.ok(/tr-move/.test(tr.trRenderCard(r)), 'present by default');
    assert.ok(!/tr-move/.test(tr.trRenderCard(r, { header: false })), 'and gone on request');
    assert.ok(/tr-horizons/.test(tr.trRenderCard(r, { header: false })), 'the evidence stays either way');
});

test('names are escaped', () => {
    const tr = load();
    const r = tr.trRationale(move(1, 2, { out: { name: '<img src=x onerror=alert(1)>' } }));
    const html = tr.trRenderCard(r);
    assert.ok(!/<img/.test(html), 'no tag survives into the markup');
    assert.ok(html.includes('&lt;img'), 'it is shown as text instead');
});

test('a missing xP engine degrades instead of throwing', () => {
    /* These are separate script tags. Any of them can be absent on a page that
       loads this one, and a card that throws takes the whole recommendation
       panel down with it. */
    const tr = load({ xpOver: undefined, xpPlanGWs: undefined, expectedMinutesModel: undefined });
    const r = tr.trRationale(move(1, 2));
    assert.deepEqual([...r.horizons], [], 'nothing to report about horizons');
    assert.equal(r.shape, null, 'and no shape claimed');
    assert.equal(r.risk.in.label, 'unknown', 'rather than a guess');
    const html = tr.trRenderCard(r);
    assert.ok(html.includes('tr-card'), 'the card still renders');
    assert.ok(!/undefined|NaN/.test(html), `with no debris: ${text(html)}`);
});

test('a malformed move produces nothing rather than half a card', () => {
    const tr = load();
    assert.equal(tr.trRationale(null), null);
    assert.equal(tr.trRationale({ out: player('Only one') }), null, 'a move needs both sides');
    assert.equal(tr.trRenderCard(null), '', 'and renders to nothing');
});
