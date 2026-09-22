/* Behaviour that has already broken in production once. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFunction } from './helpers/load.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

const normalisePlayerShape = loadFunction('scripts/common.js', 'normalisePlayerShape');
const fplErrorStatus = loadFunction('scripts/common.js', 'fplErrorStatus');
const isTransientFplError = loadFunction('scripts/common.js', 'isTransientFplError', {
    fplErrorStatus: loadFunction('scripts/common.js', 'fplErrorStatus')
});

test('normalisePlayerShape keeps position and pos in step', () => {
    // Pages disagree on this field name; reading the absent one returns
    // undefined, every comparison is false, and the feature renders empty with
    // no error. That shipped the Favorites tab blank.
    assert.equal(normalisePlayerShape({ pos: 3 }).position, 3);
    assert.equal(normalisePlayerShape({ position: 4 }).pos, 4);
});

test('normalisePlayerShape leaves a genuine disagreement alone', () => {
    const p = normalisePlayerShape({ pos: 2, position: 3 });
    assert.equal(p.pos, 2);
    assert.equal(p.position, 3);
});

test('normalisePlayerShape treats 0 as a value, not as missing', () => {
    // `||` would rewrite it; the guard has to be `== null`.
    assert.equal(normalisePlayerShape({ pos: 0 }).position, 0);
});

test('normalisePlayerShape mutates rather than clones', () => {
    // It runs inside .map() over 600+ players.
    const p = { pos: 1 };
    assert.equal(normalisePlayerShape(p), p);
});

test('normalisePlayerShape survives null and undefined', () => {
    assert.equal(normalisePlayerShape(null), null);
    assert.equal(normalisePlayerShape(undefined), undefined);
});

test('fplErrorStatus reads the status out of the thrown message', () => {
    assert.equal(fplErrorStatus(new Error('HTTP 503')), 503);
    assert.equal(fplErrorStatus(new Error('Failed to fetch')), null);
});

test('an FPL outage is transient, a bad team id is not', () => {
    // The distinction decides whether a valid team id gets cleared. Clearing it
    // during a post-deadline 503 forces a retype on every retry.
    for (const s of [502, 503, 504, 429]) assert.equal(isTransientFplError(new Error(`HTTP ${s}`)), true);
    assert.equal(isTransientFplError(new Error('HTTP 404')), false);
    assert.equal(isTransientFplError(new Error('Failed to fetch')), true, 'a bare network failure is transient');
});

test('escHTML is safe in attribute contexts, not just text', () => {
    // It sits inside 78 title=, data-tooltip=, href=, src= and alt= values. The
    // old textContent round-trip escaped & < > only, so a value with a double
    // quote closed the attribute and everything after it became markup. FPL
    // manager names are user-set and rendered on the League Rivals page.
    const escHTML = loadFunction('scripts/common.js', 'escHTML');
    const payload = 'https://evil/x" onerror="alert(1)';
    assert.ok(!escHTML(payload).includes('"'), 'double quotes must be encoded');
    assert.ok(!escHTML("it's").includes("'"), 'single quotes must be encoded');
    assert.equal(escHTML('<script>'), '&lt;script&gt;');
    assert.equal(escHTML('a & b'), 'a &amp; b', 'no double-encoding');
    assert.equal(escHTML(null), '');
    assert.equal(escHTML(0), '0', 'zero is a value, not an empty string');
    // The whole point: an injected value cannot escape its attribute.
    const rendered = `<img src="${escHTML(payload)}" onerror="fallback()">`;
    assert.equal(rendered.split('"').length, 5, 'exactly two attributes remain');
});


/* ===== The way into the app =====

   There used to be a Team ID field in the landing bar and a login dialog
   behind it, and these tests covered both. The door moved: /dashboard/ is the
   only way in, scripts/dashboard-gate.js decides who gets through, and the ID
   page asks the question. So these cover the new contract instead — and the
   first two are the ones that matter, because both failures are silent. A
   dashboard page that stops loading the gate serves a stranger an empty
   dashboard; a ?next= taken at its word turns an easyfpl.com link into
   somebody else's redirect. */

const APP_PAGES = [
    'index.html',
    'fpl-my-team-analysis.html',
    'fpl-players-analysis.html',
    'fpl-teams-analysis.html',
    'fpl-league-rivals.html',
    'fpl-scouts-desk.html',
    'fpl-news.html',
    'premium.html'
];

test('every page under /dashboard/ loads the gate, in the head', () => {
    for (const page of APP_PAGES) {
        const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
        const tag = html.search(/scripts\/dashboard-gate(\.min)?\.js/);
        assert.ok(tag > -1, `${page} does not load the gate`);

        /* Before the body, or the page has already started drawing itself to
           somebody who is about to be sent away. */
        const head = html.indexOf('</head>');
        assert.ok(tag < head, `${page} loads the gate after </head>`);
    }
});

test('the gate is the only copy of the rule', () => {
    /* Six pages each carried their own inline version of this, all of them
       redirecting somewhere the ID page is not. One rule, one file. */
    for (const page of APP_PAGES) {
        const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
        assert.ok(!/location\.replace\('\/\?next=/.test(html),
            `${page} still has its own gate`);
    }
});

test('the ID page will not redirect off the app', () => {
    /* next= is read back off a query string, so it is somebody else's input.
       Anything that is not a path inside /dashboard/ has to collapse to the
       dashboard rather than be followed. */
    const html = fs.readFileSync(path.join(ROOT, 'welcome.html'), 'utf8');
    const src = /function wlNext\(\) \{([\s\S]*?)\n {4}\}/.exec(html);
    assert.ok(src, 'welcome.html should still resolve next= through wlNext()');

    const at = (q) => {
        const f = new Function('q', `
            const location = { search: q };
            const URLSearchParams = globalThis.URLSearchParams;
            ${src[1]}
        `);
        return f(q);
    };
    assert.equal(at('?next=%2Fdashboard%2Fplayers'), '/dashboard/players');
    assert.equal(at('?next=%2Fdashboard'), '/dashboard');
    for (const bad of [
        '?next=https%3A%2F%2Fevil.example%2Fx',
        '?next=%2F%2Fevil.example',
        '?next=%2Ffpl-pricing.html',
        '?next=javascript%3Aalert(1)',
        ''
    ]) {
        assert.equal(at(bad), '/dashboard/', `next=${bad} must not be followed`);
    }
});

test('the landing bar has one way in, and it is the ID page', () => {
    /* The bar used to carry the Team ID field itself, with a fallback button
       for narrow screens — two ways in, three things to keep in step, and the
       page that explains where to find the number was the third. It is a link
       now, and this fails if the field comes back without the rest of it. */
    const nav = fs.readFileSync(path.join(ROOT, 'landing-nav.html'), 'utf8');
    assert.match(nav, /class="v2-landing-login" href="\/dashboard\/login"/,
        'the bar should link to the ID page');
    assert.ok(!/v2-landing-id|v2LandingIdInput/.test(nav),
        'the Team ID field should not be back in the bar');
});

test('the bar and the gate send people to the same page', () => {
    /* Two front doors that drift apart is the failure this prevents: the gate
       is what an app screen uses and the bar is what the marketing page uses,
       and they have to name one page. */
    const nav = fs.readFileSync(path.join(ROOT, 'landing-nav.html'), 'utf8');
    const gate = fs.readFileSync(path.join(ROOT, 'scripts/dashboard-gate.js'), 'utf8');
    assert.match(nav, /href="\/dashboard\/login"/);
    assert.match(gate, /'\/dashboard\/login\?next='/);

    /* And that page is the only thing that writes an id from a form. */
    const welcome = fs.readFileSync(path.join(ROOT, 'welcome.html'), 'utf8');
    assert.match(welcome, /saveTeamId\(raw\)/, 'the ID page should still save the id');

    const common = fs.readFileSync(path.join(ROOT, 'scripts/common.js'), 'utf8');
    assert.ok(!/function v2SubmitLandingId\(|function v2EnterWithTeam\(/.test(common),
        'the landing bar handlers should be gone with the field');
});

test('nothing fetches a relative path', () => {
    /* The one that actually bit.
     *
     * Every app screen is served from /dashboard/, so a relative
     * fetch('data/bootstrap-static.json') resolves to
     * /dashboard/data/bootstrap-static.json. While the /dashboard/* catch-all
     * existed that did not even 404 — it was answered with index.html at 200,
     * so r.ok was true and r.json() threw on the HTML. The dashboard read that
     * as "your team could not be loaded" and put the landing page back, inside
     * the signed-in sidebar, for every Team ID. The catch-all is gone and the
     * same mistake is a plain 404 now, which is louder but still a feature
     * that quietly does nothing.
     *
     * The first version of this test looked only for `fetch(` and stopped
     * reading a path at the first `$`, so it saw neither of the two the
     * Scout's Desk had: DataCache.fetchJSON(`data/articles/index.json?v=...`),
     * which is the same bug through a wrapper and inside a template literal.
     * Both are covered now — the name, and the literal prefix in front of the
     * first interpolation, which is the part that decides what the URL
     * resolves against.
     *
     * The cost of the mistake is entirely out of proportion to how easy it is
     * to make, which is what a test is for. */
    const files = [
        ...fs.readdirSync(ROOT).filter(f => f.endsWith('.html')),
        ...fs.readdirSync(path.join(ROOT, 'scripts')).map(f => `scripts/${f}`)
    ];
    const offenders = [];
    for (const f of files) {
        const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
        for (const m of src.matchAll(/(?:^|[^\w$.])(?:fetch|fetchJSON)\(\s*(['"`])([^'"`]*)/g)) {
            /* Only the text before the first ${...}: everything after it is
               computed, and cannot change what the start of the URL is
               relative to. */
            const url = m[2].split('${')[0];
            if (!url) continue;                       // fully computed, nothing to judge
            if (/^(https?:|\/|\.\.\/)/.test(url)) continue;
            offenders.push(`${f}: ${m[1]}${url}…`);
        }
    }
    assert.deepEqual(offenders, [],
        'these resolve against /dashboard/ on every app screen — make them root-absolute');
});

test('a transient FPL outage does not undress the dashboard', () => {
    /* The id is deliberately kept through a 503 so nobody has to retype it,
       and onTeamIdCleared() must not run when it was kept: it strips
       .has-team, which is what puts the marketing page back underneath a
       sidebar that is still signed in. */
    const src = fs.readFileSync(path.join(ROOT, 'scripts/index-dashboard.js'), 'utf8');
    const block = /const transient = [\s\S]{0,900}?\n {16}\}/.exec(src);
    assert.ok(block, 'the transient-error branch should still be there');
    const cleared = block[0].indexOf('onTeamIdCleared');
    const notTransient = block[0].indexOf('if (!transient)');
    assert.ok(cleared > -1 && notTransient > -1 && cleared > notTransient,
        'onTeamIdCleared() must sit inside the !transient branch');
});
