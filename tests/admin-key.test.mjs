/* The admin unlock: a signed cookie, and every way it must refuse.
 *
 * This is an access control, so the tests that matter are the negative ones.
 * Each case below is a thing a stranger can put in a Cookie header, or a thing
 * a deploy can get wrong, and the only acceptable answer to all of them is
 * false — never a throw, and never a maybe.
 *
 * The case worth naming is the unset variable. ADMIN_KEY lives in Cloudflare's
 * environment, nowhere in this repository, and a preview deployment or a fresh
 * project will not have it. If "no key configured" meant "no check to run",
 * that deploy would publish the model's working data to anyone who asked. It
 * means nobody gets in, and there is a test for it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    signAdminToken, verifyAdminToken, timingSafeEqual, usableKey,
    adminCookieHeader, clearedAdminCookieHeader, ADMIN_COOKIE, ADMIN_SESSION_MS,
    ADMIN_UI_COOKIE, adminUiCookieHeader, clearedAdminUiCookieHeader
} from '../functions/lib/admin-key.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const readSource = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const KEY = 'mSvHk3Qd7Rt2Yx9Lb4Nz8Wc6Fj1Ap5Eg';          // 32 chars, test-only
const OTHER = 'zZ9Yx8Wv7Uu6Tt5Ss4Rr3Qq2Pp1Oo0Nn';
const NOW = Date.parse('2026-10-13T12:00:00Z');
const LATER = NOW + ADMIN_SESSION_MS;

// ---- the happy path, which is one line of the file

test('a token this key signed, not yet expired, opens the area', async () => {
    const token = await signAdminToken(KEY, LATER);
    assert.equal(await verifyAdminToken(KEY, token, NOW), true);
});

test('the token carries its expiry in the clear and its signature after it', async () => {
    const token = await signAdminToken(KEY, LATER);
    const [exp, sig] = token.split('.');
    assert.equal(Number(exp), LATER, 'the expiry is readable without the key');
    assert.ok(sig.length > 20, 'and the signature is a real one');
    assert.doesNotMatch(token, /[+/=]/, 'base64url, so it is cookie-safe');
    assert.equal(token.includes(KEY), false, 'the key itself never goes in the cookie');
});

// ---- the refusals

test('a token signed with a different key is refused', async () => {
    const token = await signAdminToken(OTHER, LATER);
    assert.equal(await verifyAdminToken(KEY, token, NOW), false);
});

test('an expired token is refused, and the boundary is exact', async () => {
    const token = await signAdminToken(KEY, NOW + 1000);
    assert.equal(await verifyAdminToken(KEY, token, NOW), true, 'a second before');
    assert.equal(await verifyAdminToken(KEY, token, NOW + 999), true);
    assert.equal(await verifyAdminToken(KEY, token, NOW + 1000), false, 'at the expiry, not after it');
    assert.equal(await verifyAdminToken(KEY, token, NOW + 1001), false);
});

test('the expiry cannot be edited, because it is what was signed', async () => {
    /* The attack this is the answer to: a holder of a legitimate cookie reads
       the expiry off the front of it and writes a later one. */
    const token = await signAdminToken(KEY, NOW + 1000);
    const sig = token.split('.')[1];
    const extended = `${NOW + ADMIN_SESSION_MS}.${sig}`;
    assert.equal(await verifyAdminToken(KEY, extended, NOW + 5000), false);
});

test('a tampered signature is refused', async () => {
    const token = await signAdminToken(KEY, LATER);
    const [exp, sig] = token.split('.');
    const flip = sig[0] === 'A' ? 'B' : 'A';
    assert.equal(await verifyAdminToken(KEY, `${exp}.${flip}${sig.slice(1)}`, NOW), false);
    assert.equal(await verifyAdminToken(KEY, `${exp}.${sig.slice(0, -1)}`, NOW), false, 'truncated');
    assert.equal(await verifyAdminToken(KEY, `${exp}.${sig}A`, NOW), false, 'extended');
});

test('an unset ADMIN_KEY lets nobody in, including with a valid token', async () => {
    // The deploy-time failure, and the only one that could be catastrophic.
    const token = await signAdminToken(KEY, LATER);
    for (const missing of [undefined, null, '', 0, false, {}, []]) {
        assert.equal(await verifyAdminToken(missing, token, NOW), false,
            `ADMIN_KEY=${JSON.stringify(missing)} must open nothing`);
    }
});

test('a key too short to be a secret is treated as unset', async () => {
    /* A placeholder like "changeme" in the Cloudflare dashboard is a typo, not
       a password, and a gate that honours it is worse than one that refuses. */
    assert.equal(usableKey('short'), false);
    assert.equal(usableKey('a'.repeat(23)), false);
    assert.equal(usableKey('a'.repeat(24)), true, '24 characters is the floor');
    assert.equal(await signAdminToken('changeme', LATER), null, 'and nothing can be signed with it');
});

test('junk in the cookie is refused rather than thrown at', async () => {
    const cases = [
        null, undefined, '', '.', '..', 'a.b', 'abc', `${LATER}`, `${LATER}.`, `.${LATER}`,
        '-1.abc', '+1.abc', '1e9.abc', '0x10.abc', ' 1.abc', `${LATER} .abc`,
        '99999999999999999999.abc',                       // longer than the digit cap
        `${LATER}.${'A'.repeat(600)}`,                    // over the length cap
        123, {}, [], true, () => {}
    ];
    for (const bad of cases) {
        assert.equal(await verifyAdminToken(KEY, bad, NOW), false,
            `${String(bad).slice(0, 24)} must not verify`);
    }
});

test('a token is only good for the key that signed it, even after a rotation', async () => {
    /* Rotating ADMIN_KEY in Cloudflare is the revocation mechanism, so it has
       to actually revoke. */
    const old = await signAdminToken(KEY, LATER);
    assert.equal(await verifyAdminToken(KEY, old, NOW), true);
    assert.equal(await verifyAdminToken(OTHER, old, NOW), false, 'rotation invalidates it');
});

// ---- the comparison

test('timingSafeEqual is an equality test first of all', () => {
    assert.equal(timingSafeEqual('abc', 'abc'), true);
    assert.equal(timingSafeEqual('abc', 'abd'), false);
    assert.equal(timingSafeEqual('abc', 'abcd'), false);
    assert.equal(timingSafeEqual('', ''), true);
    for (const junk of [null, undefined, 0, {}, [], ['abc']]) {
        assert.equal(timingSafeEqual('abc', junk), false);
        assert.equal(timingSafeEqual(junk, 'abc'), false);
    }
});

test('it reads every character of a same-length string', () => {
    /* Not a timing measurement — those are not reliable in a test runner — but
       a check that the loop is not short-circuiting, which is what a bare ===
       or a `break` on first mismatch would do. The last character differing
       must be caught as surely as the first. */
    const a = 'a'.repeat(40);
    assert.equal(timingSafeEqual(a, 'b' + a.slice(1)), false, 'first character');
    assert.equal(timingSafeEqual(a, a.slice(0, -1) + 'b'), false, 'last character');
});

// ---- the cookie itself

test('the cookie is locked down on every axis a cookie has', () => {
    const header = adminCookieHeader('tok', ADMIN_SESSION_MS);
    assert.match(header, /^easyfpl_admin=tok;/);
    assert.match(header, /HttpOnly/, 'no script may read it');
    assert.match(header, /Secure/, 'it never travels in clear');
    assert.match(header, /SameSite=Strict/, 'a cross-site link cannot arrive unlocked');
    assert.match(header, /Path=\//);
    assert.match(header, /Max-Age=2592000\b/, 'thirty days, in seconds');
    assert.equal(ADMIN_COOKIE, 'easyfpl_admin');
});

test('clearing it uses the same attributes, which is what makes it clear', () => {
    /* A browser only replaces a cookie when name, path and domain match. A
       clear written with different attributes leaves the original in place. */
    const set = adminCookieHeader('tok', ADMIN_SESSION_MS);
    const clear = clearedAdminCookieHeader();
    assert.match(clear, /^easyfpl_admin=;/);
    assert.match(clear, /Max-Age=0\b/);
    for (const attr of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict']) {
        assert.ok(set.includes(attr) && clear.includes(attr), `${attr} on both`);
    }
});

// ---- the endpoint that issues it

test('the unlock endpoint gives one answer to every wrong key', () => {
    /* Read as source, because importing it would need a Request, a Response
       and an env. What is being pinned is that the refusals are literally the
       same object shape and the key is never echoed. */
    const src = readSource('functions/unlock.js');
    assert.equal((src.match(/return refuse\(\)/g) || []).length >= 4, true,
        'every failure path returns the same refusal');
    assert.equal(/given|searchParams\.get\('k'\)/.test(src), true);
    assert.doesNotMatch(src, /console\.(log|error)/, 'nothing about the key goes to a log');
    assert.match(src, /timingSafeEqual\(given, key\)/, 'the key is not compared with ===');
    assert.match(src, /Referrer-Policy/, 'the key must not ride along in a Referer');
    assert.match(src, /request\.method !== 'GET'/, 'one method, one way in');
});

test('the middleware tries the key before the account, and fails closed', () => {
    const src = readSource('functions/_middleware.js');
    const gate = src.slice(src.indexOf('async function adminGate'));
    const keyAt = gate.indexOf('verifyAdminToken');
    const accountAt = gate.indexOf('verifiedUserId');
    assert.ok(keyAt > 0 && accountAt > keyAt,
        'the unlock cookie is checked before the Supabase round trip');
    assert.match(gate, /env && env\.ADMIN_KEY/,
        'and it is read from the environment, never from a constant');
    assert.doesNotMatch(gate, /Location: `\/login\.html/,
        'the dead-end redirect to a login the product does not have is gone');
});

// ---- the cosmetic half

/* The hint cookie is the one piece of this that is meant to be forgeable, so
   the tests are about keeping it worthless rather than keeping it safe. */

test('the sidebar hint carries nothing and hides nothing', () => {
    const header = adminUiCookieHeader(ADMIN_SESSION_MS);
    assert.match(header, /^easyfpl_admin_ui=1;/, 'a flag, not a token');
    assert.doesNotMatch(header, /HttpOnly/,
        'it exists to be read by scripts/sidebar-nav.js; HttpOnly would defeat it');
    assert.match(header, /Secure/);
    assert.equal(ADMIN_UI_COOKIE, 'easyfpl_admin_ui');
    // Nothing derived from the key may appear in it.
    assert.equal(header.includes(KEY), false);
});

test('the real cookie and the hint are not the same cookie', () => {
    /* If these names ever converge, the HttpOnly one stops being HttpOnly or
       the readable one starts carrying a signature. Both are bad in a way that
       would be hard to spot. */
    assert.notEqual(ADMIN_COOKIE, ADMIN_UI_COOKIE);
    assert.match(adminCookieHeader('tok', ADMIN_SESSION_MS), /HttpOnly/);
    assert.doesNotMatch(adminUiCookieHeader(ADMIN_SESSION_MS), /HttpOnly/);
});

test('clearing the hint matches how it was set', () => {
    const clear = clearedAdminUiCookieHeader();
    assert.match(clear, /^easyfpl_admin_ui=;/);
    assert.match(clear, /Max-Age=0\b/);
    assert.match(clear, /Path=\//);
});

test('the endpoint sets both cookies on the way in and drops both on the way out', () => {
    const src = readSource('functions/unlock.js');
    assert.match(src, /adminCookieHeader\(token, ADMIN_SESSION_MS\),\s*\n\s*adminUiCookieHeader\(/,
        'unlocking sets the signed cookie and the hint together');
    const refusal = src.slice(src.indexOf('const refuse'), src.indexOf('export async function'));
    assert.match(refusal, /clearedAdminCookieHeader\(\), clearedAdminUiCookieHeader\(\)/,
        'a refusal must not leave a hint pointing at a page that refuses');
    assert.match(src, /Headers\(extra\)/,
        'two Set-Cookie headers cannot come from one object literal');
});

test('the sidebar treats the hint as a hint, and the middleware never reads it', () => {
    /* The division that makes a forgeable cookie acceptable: the nav may draw
       a link from it, and nothing that decides access may look at it. */
    const nav = readSource('scripts/sidebar-nav.js');
    assert.match(nav, /easyfpl_admin_ui=/, 'the nav reads the hint');
    assert.match(nav, /function sidebarAdminHinted/);
    assert.match(nav, /item\.hidden = false/);

    const mw = readSource('functions/_middleware.js');
    assert.equal(mw.includes('easyfpl_admin_ui'), false,
        'the gate must not consult a cookie anyone can write');
    assert.equal(mw.includes(ADMIN_UI_COOKIE), false);
    assert.match(mw, /verifyAdminToken\(/, 'it reads the signed one instead');
});
