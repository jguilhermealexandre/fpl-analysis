/* Your market — the panel that replaced three defects in the Transfers column.

   Each test below pins one of them, because all three were the kind that read
   as merely untidy and were actually wrong: a counter that contradicted the
   list beneath it, a rise styled identically to a fall, and two unrelated kinds
   of fact sharing one scannable column. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// price-watch owns the classification; market-panel reads it. Both are classic
// scripts, so they share one context the way the browser gives them one.
function load() {
    const ctx = { console, escHTML: s => String(s == null ? '' : s), document: { getElementById: () => null } };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    for (const f of ['scripts/price-watch.js', 'scripts/market-panel.js']) {
        new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInContext(ctx);
    }
    return ctx;
}
const mk = load();

// progress is the game's own meter: +100 means a rise fires at the next update.
const player = (id, name, price, progress) => ({
    id, name, price, priceProgress: progress, priceProjection: [progress, progress], priceLockedUntil: null
});

test('the summary counts what the panel actually shows', () => {
    // The bug: the counter tallied only full meters while the rows were drawn
    // from anything past 80%, so it read 0 above two visible price rows.
    const m = mk.mkSquadMovers([
        player(1, 'Full riser', 6.0, 105),
        player(2, 'Closing riser', 5.0, 89),
        player(3, 'Closing faller', 4.5, -92)
    ]);
    assert.equal(m.total, 3, 'every row the panel renders is counted');
    assert.equal(m.due, 1, 'one full meter');
    assert.equal(m.closing, 2, 'two closing in');
    assert.equal(m.total, m.due + m.closing, 'the two tiers account for every row');
});

test('only certain moves reach the value figure', () => {
    // "Closing in" is explicitly not a forecast — see price-watch.js on the
    // game's own projection flagging nineteen players to catch four changes.
    const m = mk.mkSquadMovers([
        player(1, 'Rises tonight', 6.0, 100),
        player(2, 'Falls tonight', 7.0, -100),
        player(3, 'Might rise', 5.0, 95),
        player(4, 'Might rise too', 5.0, 96)
    ]);
    assert.equal(m.netDue, 0, 'one up and one down cancel; the two maybes do not count');

    const up = mk.mkSquadMovers([player(1, 'A', 6, 100), player(2, 'B', 6, 101), player(3, 'C', 6, 92)]);
    assert.equal(up.netDue, 0.2, 'two certain rises are worth 0.2, the third is not counted');
});

test('a rise and a fall never render the same', () => {
    // The original defect: both were the same amber "monitor" dot.
    const m = mk.mkSquadMovers([player(1, 'Riser', 6.0, 100), player(2, 'Faller', 6.0, -100)]);
    const html = mk.mkRenderPanel(m);

    const riser = /class="mk-row up[\s\S]*?<\/a>/.exec(html);
    const faller = /class="mk-row down[\s\S]*?<\/a>/.exec(html);
    assert.ok(riser && faller, 'both directions render');
    assert.ok(riser[0].includes('▲') && faller[0].includes('▼'), 'the arrow differs');
    assert.ok(riser[0].includes('Rise due') && faller[0].includes('Drop due'), 'the wording differs');
    // Colour alone is not readable to everyone, so the class is not the only cue —
    // but it must still differ, since the CSS keys the green and red off it.
    assert.ok(!riser[0].includes('mk-row down') && !faller[0].includes('mk-row up'));
});

test('the price shown is the one it is heading to', () => {
    const m = mk.mkSquadMovers([player(1, 'Up', 6.0, 100), player(2, 'Down', 6.0, -100)]);
    const html = mk.mkRenderPanel(m);
    assert.ok(html.includes('£6.0<i>→</i>£6.1'), 'a rise goes up 0.1');
    assert.ok(html.includes('£6.0<i>→</i>£5.9'), 'a drop goes down 0.1');
});

test('a quiet week says so rather than rendering an empty frame', () => {
    const m = mk.mkSquadMovers([player(1, 'Static', 6.0, 3)]);
    assert.equal(m.total, 0, 'below the watch threshold is not a mover');
    assert.match(mk.mkRenderPanel(m), /Nothing in your squad is near a price change/);
});

test('one direction being empty still shows both columns', () => {
    // Half a panel would read as "no data" rather than "nobody is falling".
    const html = mk.mkRenderPanel(mk.mkSquadMovers([player(1, 'Only riser', 6.0, 100)]));
    assert.match(html, /Rising/);
    assert.match(html, /Falling/);
    assert.match(html, /Nobody in your squad is close to a drop/);
});

test('a long list is capped but the count stays honest', () => {
    const many = Array.from({ length: 11 }, (_, i) => player(i + 1, `P${i}`, 5.0, 100 - i));
    const m = mk.mkSquadMovers(many);
    const html = mk.mkRenderPanel(m);
    assert.equal(m.risers.length, 11);
    assert.equal((html.match(/class="mk-row/g) || []).length, 6, 'rows are capped');
    assert.match(html, /\+5 more/, 'and the remainder is disclosed');
    assert.match(html, /<span class="mk-col-n">11<\/span>/, 'the heading counts all of them');
});

test('locked players are not movers', () => {
    // The game zeroes the meter for these anyway, but the lock is authoritative.
    const locked = player(1, 'Locked', 6.0, 100);
    locked.priceLockedUntil = new Date(Date.now() + 3600000).toISOString();
    assert.equal(mk.mkSquadMovers([locked]).total, 0);
});

test('nothing to classify produces an empty summary, not a throw', () => {
    for (const bad of [null, undefined, []]) {
        const m = mk.mkSquadMovers(bad);
        assert.equal(m.total, 0);
        assert.equal(m.netDue, 0);
    }
});
