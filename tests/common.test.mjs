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
        const tag = html.indexOf('scripts/dashboard-gate.js');
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

test('the landing bar and the ID page agree on one handler', () => {
    /* The handler is an inline attribute in a fetch-injected partial, so
       nothing links the two: rename one and the field silently submits the
       form to nowhere. */
    const nav = fs.readFileSync(path.join(ROOT, 'landing-nav.html'), 'utf8');
    const called = /onsubmit="return (\w+)\(event\)"/.exec(nav);
    assert.ok(called, 'the landing form should submit through a named handler');
    assert.match(fs.readFileSync(path.join(ROOT, 'scripts/common.js'), 'utf8'),
        new RegExp(`function ${called[1]}\\(`), `${called[1]}() is not defined in common.js`);
});

test('exactly one way in is shown at a time', () => {
    /* The field and the narrow-screen fallback are both in the markup; CSS
       picks. If the pairing rule is lost, a narrow screen shows both or
       neither. */
    const nav = fs.readFileSync(path.join(ROOT, 'landing-nav.html'), 'utf8');
    assert.match(nav, /class="v2-landing-id"/);
    assert.match(nav, /v2-landing-id-fallback/);
    const css = fs.readFileSync(path.join(ROOT, 'styles/v2-design.css'), 'utf8');
    assert.match(css, /\.v2-landing-login\.v2-landing-id-fallback\s*\{\s*display:\s*none/,
        'the fallback must be hidden by default, at a specificity that beats .v2-landing-login');
    assert.match(css, /@media \(max-width: 560px\)[\s\S]{0,240}\.v2-landing-id\s*\{\s*display:\s*none/,
        'and the field must give way to it on a narrow screen');
});

test('both ways in lead to the same place', () => {
    /* The bar is a shortcut past the ID page, not a second copy of it: the
       fallback link and the gate must point at the same page, or there are two
       different front doors to keep in step. */
    const nav = fs.readFileSync(path.join(ROOT, 'landing-nav.html'), 'utf8');
    assert.match(nav, /class="v2-landing-login v2-landing-id-fallback" href="\/dashboard\/login"/,
        'the narrow-screen fallback should link to the ID page');

    const gate = fs.readFileSync(path.join(ROOT, 'scripts/dashboard-gate.js'), 'utf8');
    assert.match(gate, /'\/dashboard\/login\?next='/, 'the gate should send people to the same page');

    /* And a good id skips it entirely, landing in the app rather than back on
       the page the field is on. */
    const common = fs.readFileSync(path.join(ROOT, 'scripts/common.js'), 'utf8');
    const enter = /function v2EnterWithTeam\(teamId\) \{([\s\S]*?)\n\}/.exec(common);
    assert.ok(enter, 'v2EnterWithTeam() should still exist');
    assert.match(enter[1], /location\.href = '\/dashboard\/'/,
        'a saved id should open the dashboard');
});
