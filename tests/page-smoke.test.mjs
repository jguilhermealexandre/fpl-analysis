/* Every page still loads.

   The suite had no test that ran a page. Everything else here is logic-level,
   and `check:inline` only proves the inline blocks parse — a page whose scripts
   parse perfectly and then throw a ReferenceError on the first line of the first
   inline block is indistinguishable, to CI, from a healthy one. The symptom in a
   browser is a blank page.

   That is not hypothetical. Two of the commits behind this file are "Un-break
   the squad table, and catch the way I broke it" and "Fix the price strip I
   broke, and add the check that would have caught it". This is the check for the
   class those belong to, and it is the one that covers adding a script to a page
   — a new global colliding with an existing one, or an engine reaching for
   context the host does not define, both land here rather than in production.

   What it deliberately does NOT do is assert anything rendered. There is no real
   DOM, so a passing test means "the page's JavaScript executes top to bottom
   without throwing", not "the page looks right". That is a low bar which nothing
   was previously clearing. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pages } from '../tools/page-scripts.mjs';

/* fileURLToPath rather than import.meta.dirname, which needs Node 20.11. This
   file is the one place a contributor on an older Node is most likely to run
   first, and failing there for a reason unrelated to the page is a bad trade. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* An element that answers anything. getElementById returns one of these rather
   than null because on a real page the element exists — returning null makes
   pages that reasonably skip a guard look broken, and pushes the test into
   asserting markup, which is not what it is for. */
function element() {
    const el = {
        style: { setProperty() {}, removeProperty() {} },
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        dataset: {}, children: [], parentNode: null,
        appendChild() {}, removeChild() {}, remove() {}, insertAdjacentHTML() {},
        setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
        addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
        querySelector: () => null, querySelectorAll: () => [], closest: () => null,
        getBoundingClientRect: () => ({ height: 0, width: 0, top: 0, left: 0, bottom: 0, right: 0 }),
        focus() {}, blur() {}, click() {}, scrollIntoView() {},
        innerHTML: '', textContent: '', value: '', checked: false
    };
    return el;
}

function browserContext() {
    const store = new Map();
    const ctx = {
        console: { log() {}, warn() {}, error() {}, info() {}, debug() {}, table() {}, group() {}, groupEnd() {} },
        document: {
            getElementById: () => element(), querySelector: () => element(), querySelectorAll: () => [],
            createElement: () => element(), createDocumentFragment: () => element(),
            addEventListener() {}, removeEventListener() {},
            body: element(), documentElement: element(), head: element(),
            readyState: 'complete', title: '', cookie: ''
        },
        localStorage: {
            getItem: k => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => store.set(k, String(v)),
            removeItem: k => store.delete(k), clear: () => store.clear()
        },
        sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        navigator: { userAgent: 'node-test', sendBeacon: () => true, serviceWorker: { register: () => Promise.resolve() } },
        location: { pathname: '/', hash: '', search: '', href: 'https://easyfpl.com/', origin: 'https://easyfpl.com', reload() {} },
        history: { replaceState() {}, pushState() {} },
        // Never resolves to real data: this is a load test, not a data test.
        fetch: () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
        setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
        requestAnimationFrame: () => 0, cancelAnimationFrame() {}, queueMicrotask,
        IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
        ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
        MutationObserver: class { observe() {} disconnect() {} },
        Chart: class { constructor() {} destroy() {} update() {} static register() {} },
        indexedDB: { open: () => ({ addEventListener() {}, onsuccess: null, onerror: null, onupgradeneeded: null }) },
        matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
        AbortSignal: { timeout: () => null },
        URL, URLSearchParams, Math, JSON, Date, Promise, Intl,
        parseFloat, parseInt, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
        alert() {}, confirm: () => false, scrollTo() {}, getComputedStyle: () => ({ position: 'static', getPropertyValue: () => '' }),
        structuredClone: v => JSON.parse(JSON.stringify(v))
    };
    ctx.window = ctx;
    ctx.globalThis = ctx;
    ctx.self = ctx;
    ctx.addEventListener = () => {};
    ctx.removeEventListener = () => {};
    return ctx;
}

/* One vm.Script for the whole page, never one per file. Each unit's top-level
   `let` is script-scoped, so evaluating them separately would hide every
   cross-file reference the page depends on — the same reason tests/helpers
   documents. */
function loadPage(name, units) {
    const source = units.scripts.map(read).join('\n') + '\n' + units.inline;
    const ctx = browserContext();
    vm.createContext(ctx);
    new vm.Script(source, { filename: name }).runInContext(ctx);
    return ctx;
}

const site = pages(ROOT);

for (const [name, units] of Object.entries(site)) {
    test(`${name} loads without throwing`, () => {
        assert.doesNotThrow(() => loadPage(name, units));
    });
}

test('the players page runs the shared projection, not one of its own', () => {
    const ctx = loadPage('fpl-players-analysis.html', site['fpl-players-analysis.html']);
    // The engine reached the page.
    for (const fn of ['xpOver', 'xpEngineReady', 'xpBuildPlayers', 'xpBuildPositionAverages', 'xpBuildTeamFixtures']) {
        assert.equal(typeof ctx[fn], 'function', `${fn} missing — xp-engine.js is not on this page`);
    }
    // And the model it replaced did not survive alongside it.
    assert.equal(typeof ctx.calculateMultiGWxPts, 'undefined',
        'calculateMultiGWxPts is back; the page has two projections again');
    assert.equal(typeof ctx.paXP5, 'function', 'the page lost its projection wrapper');
});

test('the squad page and the players page share one projection', () => {
    const a = loadPage('fpl-my-team-analysis.html', site['fpl-my-team-analysis.html']);
    const b = loadPage('fpl-players-analysis.html', site['fpl-players-analysis.html']);
    assert.equal(typeof a.projectPlayerPointsDetailed, 'function');
    assert.equal(typeof b.projectPlayerPointsDetailed, 'function');
    // Same source file, so same implementation — this asserts the wiring, not the maths.
    assert.equal(a.projectPlayerPointsDetailed.length, b.projectPlayerPointsDetailed.length);
});
