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


/* ===== The Team ID field in the landing bar =====

   It is the only way in for nearly everyone who uses this site, so the two
   paths out of it both get a test: a good id goes straight through, and
   anything else lands in the box that has room to explain itself. */
function landingField(over = {}) {
    const calls = { entered: null, opened: 0 };
    const input = { value: over.value ?? '', classList: { added: [], add(c) { this.added.push(c); }, remove() {} } };
    const box = { value: '' };
    const fn = loadFunction('scripts/common.js', 'v2SubmitLandingId', {
        document: { getElementById: (id) => (id === 'v2LandingIdInput' ? input : id === 'v2LoginInput' ? box : null) },
        openLoginModal: () => { calls.opened++; },
        v2EnterWithTeam: (id) => { calls.entered = id; }
    });
    return { fn, calls, input, box };
}

test('a real id goes straight in, without opening anything', () => {
    const { fn, calls } = landingField({ value: '2951638' });
    assert.equal(fn({ preventDefault() {} }), false, 'the form must never actually submit');
    assert.equal(calls.entered, '2951638');
    assert.equal(calls.opened, 0, 'no box for an id that is already valid');
});

test('surrounding space is not a typo', () => {
    const { fn, calls } = landingField({ value: '  2951638  ' });
    fn({ preventDefault() {} });
    assert.equal(calls.entered, '2951638');
});

test('a typo opens the box and takes what was typed with it', () => {
    /* The bar has nowhere to put a sentence, so the explanation lives in the
       box — and retyping the id there would be a punishment for a typo. */
    const { fn, calls, input, box } = landingField({ value: '29a51638' });
    fn({ preventDefault() {} });
    assert.equal(calls.entered, null, 'nothing is entered on a bad id');
    assert.equal(calls.opened, 1);
    assert.equal(box.value, '29a51638', 'the box is pre-filled so it can be corrected');
    assert.deepEqual([...input.classList.added], ['is-bad'], 'and the field says which one was wrong');
});

test('an empty field opens the box without marking anything wrong', () => {
    // Pressing Go with nothing typed is a request for help, not a mistake.
    const { fn, calls, input, box } = landingField({ value: '' });
    fn({ preventDefault() {} });
    assert.equal(calls.opened, 1);
    assert.equal(calls.entered, null);
    assert.equal(box.value, '', 'nothing to carry across');
    assert.equal(input.classList.added.length, 0);
});

test('the bar and the box name the same function', () => {
    /* The handler is an inline attribute in a fetch-injected partial, so
       nothing links the two: rename one and the field silently submits the
       form instead. */
    const nav = fs.readFileSync(path.join(ROOT, 'landing-nav.html'), 'utf8');
    const called = /onsubmit="return (\w+)\(event\)"/.exec(nav);
    assert.ok(called, 'the landing form should still submit through a named handler');
    assert.match(fs.readFileSync(path.join(ROOT, 'scripts/common.js'), 'utf8'),
        new RegExp(`function ${called[1]}\\(`), `${called[1]}() is not defined in common.js`);
});

test('exactly one way in is shown at a time', () => {
    /* The field and the fallback button are both in the markup; CSS picks. If
       the pairing rule is lost, a narrow screen shows both or neither. */
    const nav = fs.readFileSync(path.join(ROOT, 'landing-nav.html'), 'utf8');
    assert.match(nav, /class="v2-landing-id"/);
    assert.match(nav, /v2-landing-id-fallback/);
    const css = fs.readFileSync(path.join(ROOT, 'styles/v2-design.css'), 'utf8');
    assert.match(css, /\.v2-landing-login\.v2-landing-id-fallback\s*\{\s*display:\s*none/,
        'the fallback must be hidden by default, at a specificity that beats .v2-landing-login');
    assert.match(css, /@media \(max-width: 560px\)[\s\S]{0,240}\.v2-landing-id\s*\{\s*display:\s*none/,
        'and the field must give way to it on a narrow screen');
});
