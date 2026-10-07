/* Where the player card's sections actually end up.

   THE BUG THIS EXISTS FOR. Concerns and Positives were moved in the markup to
   sit under Scout's Take, the verdict and the price meter. The markup was
   correct and shipped, and on screen nothing moved: pdmLayoutBands() physically
   re-parents a named set of sections into one holder after render, and
   PDM_LAYOUT still listed those two in a band beside Routes to Points. Reading
   buildPlayerFullProfileHTML told you the order the HTML is built in, which is
   not the order anybody sees.

   So this asserts the order after the layout pass has run, which is the only
   order that is true. It needs a DOM — the pass is appendChild and insertBefore
   and nothing else — so there is a small one below. It implements exactly what
   the function under test touches and nothing more; the two selector forms it
   uses are '.pdm-body' and '.detail-section[data-accent="x"]'. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFunction } from './helpers/load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

/* ---- the smallest DOM that can be got wrong ---- */

class El {
    constructor(tag) {
        this.tag = tag;
        this.children = [];
        this.parentNode = null;
        this.attrs = {};
        this._class = new Set();
        this._style = {};
        this.style = { setProperty: (k, v) => { this._style[k] = v; } };
    }
    set className(v) { this._class = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get className() { return [...this._class].join(' '); }
    get classList() {
        return {
            add: (...c) => c.forEach(x => this._class.add(x)),
            contains: c => this._class.has(c)
        };
    }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }

    /* Real semantics, and they are the point: appending a node that already has
       a parent MOVES it. A shim that copied instead of moved would let the
       original bug pass. */
    appendChild(c) {
        if (c.parentNode) c.parentNode.removeChild(c);
        c.parentNode = this;
        this.children.push(c);
        return c;
    }
    removeChild(c) {
        const i = this.children.indexOf(c);
        if (i > -1) this.children.splice(i, 1);
        c.parentNode = null;
        return c;
    }
    insertBefore(n, ref) {
        if (n.parentNode) n.parentNode.removeChild(n);
        const i = this.children.indexOf(ref);
        n.parentNode = this;
        if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
        return n;
    }

    matches(sel) {
        const cls = /^\.([a-z-]+)/.exec(sel);
        if (cls && !this._class.has(cls[1])) return false;
        const attr = /\[([a-z-]+)="([^"]+)"\]/.exec(sel);
        if (attr && this.attrs[attr[1]] !== attr[2]) return false;
        return true;
    }
    querySelector(sel) {
        for (const c of this.children) {
            if (c.matches(sel)) return c;
            const hit = c.querySelector(sel);
            if (hit) return hit;
        }
        return null;
    }
}

const section = accent => {
    const el = new El('div');
    el.className = 'detail-section';
    el.setAttribute('data-accent', accent);
    return el;
};

/* The card as buildPlayerFullProfileHTML emits it today: the argument, then the
   evidence, with concerns and positives already lifted in the markup. */
const DOM_ORDER = ['report', 'verdict', 'price', 'concerns', 'positives',
    'stats', 'season', 'routes', 'fixtures'];

function buildHost(order = DOM_ORDER) {
    const host = new El('div');
    const body = new El('div');
    body.className = 'pdm-body';
    host.appendChild(body);
    order.forEach(a => body.appendChild(section(a)));
    return { host, body };
}

/* Flatten to the order a reader sees: the body's children in order, descending
   into the holder and its bands. */
function visualOrder(body) {
    const out = [];
    const walk = el => {
        for (const c of el.children) {
            const accent = c.getAttribute('data-accent');
            if (accent) out.push(accent); else walk(c);
        }
    };
    walk(body);
    return out;
}

const pdmLayoutBands = loadFunction('scripts/player-profile.js', 'pdmLayoutBands', {
    document: { createElement: tag => new El(tag) }
});

/* ---- the order on screen ---- */

test('the argument comes before the evidence', () => {
    /* The whole point of the move: somebody told "Sell" at the top reads why in
       the next breath, not after two full-width stat tables. */
    const { host, body } = buildHost();
    pdmLayoutBands(host);
    assert.deepEqual(visualOrder(body), [
        'report', 'verdict', 'price',
        'concerns', 'positives',
        'season', 'stats', 'routes',
        'fixtures'
    ]);
});

test('concerns and positives are a two-column band, not a stack', () => {
    const { host, body } = buildHost();
    pdmLayoutBands(host);
    const holder = body.children.find(c => c.className.includes('pdm-layout'));
    assert.ok(holder, 'the holder should exist');
    const band = holder.children[0];
    assert.ok(band.className.includes('pdm-bands'), 'the first row should be a band');
    assert.equal(band._style['--pdm-cols'], '2', 'two columns, so it does not inherit thirds');
    assert.equal(band.children.length, 2);
    assert.deepEqual(band.children.map(c => c.children[0].getAttribute('data-accent')),
        ['concerns', 'positives']);
});

test('season, stats and routes each take a full-width row', () => {
    const { host, body } = buildHost();
    pdmLayoutBands(host);
    const holder = body.children.find(c => c.className.includes('pdm-layout'));
    const fulls = holder.children.filter(c => c.className.includes('pdm-full'));
    assert.deepEqual(fulls.map(c => c.getAttribute('data-accent')),
        ['season', 'stats', 'routes']);
});

test('the holder lands where the first managed section was, after the price meter', () => {
    /* The anchor is derived from PDM_LAYOUT rather than written out a second
       time. A hand-maintained fallback chain is a second copy of the order, and
       a second copy is what put these sections in the wrong place to begin
       with. */
    const { host, body } = buildHost();
    pdmLayoutBands(host);
    const idx = body.children.findIndex(c => c.className.includes('pdm-layout'));
    const before = body.children.slice(0, idx).map(c => c.getAttribute('data-accent'));
    assert.deepEqual(before, ['report', 'verdict', 'price']);
});

/* ---- degrading ---- */

test('a player with no concerns still gets the rest in order', () => {
    const { host, body } = buildHost(
        ['report', 'verdict', 'price', 'positives', 'stats', 'season', 'routes']);
    pdmLayoutBands(host);
    assert.deepEqual(visualOrder(body),
        ['report', 'verdict', 'price', 'positives', 'season', 'stats', 'routes']);
});

test('a player with neither concerns nor positives is unaffected', () => {
    const { host, body } = buildHost(
        ['report', 'verdict', 'price', 'stats', 'season', 'routes', 'fixtures']);
    pdmLayoutBands(host);
    assert.deepEqual(visualOrder(body),
        ['report', 'verdict', 'price', 'season', 'stats', 'routes', 'fixtures']);
});

test('nothing this layout manages means nothing is moved', () => {
    const { host, body } = buildHost(['report', 'verdict', 'price', 'fixtures']);
    pdmLayoutBands(host);
    assert.deepEqual(visualOrder(body), ['report', 'verdict', 'price', 'fixtures']);
    assert.ok(!body.children.some(c => c.className.includes('pdm-layout')),
        'no holder should be inserted when there is nothing to put in it');
});

test('a missing body is survivable', () => {
    const host = new El('div');
    assert.doesNotThrow(() => pdmLayoutBands(host));
});

/* ---- the guard against the next drift ---- */

test('every section PDM_LAYOUT names is one the markup actually emits', () => {
    /* PDM_LAYOUT is the visual order and buildPlayerFullProfileHTML is the
       markup. They are two lists and they have already fallen out of step once.
       A name here that the markup never emits is a silently dropped row. */
    const src = fs.readFileSync(path.join(ROOT, 'scripts/player-profile.js'), 'utf8');
    const layout = /const PDM_LAYOUT = \[([\s\S]*?)\];/.exec(src);
    assert.ok(layout, 'PDM_LAYOUT should still be findable');
    const named = [...layout[1].matchAll(/'([a-z]+)'/g)].map(m => m[1]);
    assert.ok(named.length >= 4, 'the layout should still name its sections');
    for (const accent of named) {
        assert.ok(src.includes(`data-accent="${accent}"`),
            `PDM_LAYOUT names "${accent}" but no section is emitted with that accent`);
    }
});
