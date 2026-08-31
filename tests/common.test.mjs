/* Behaviour that has already broken in production once. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

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
