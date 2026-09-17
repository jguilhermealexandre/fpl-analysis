/* The two JavaScript copies of "is this account premium" must agree.
 *
 * There are three copies of the rule in the system — public.is_premium() in
 * Postgres, auIsPremium() in scripts/auth.js, and isPremiumProfile() in
 * functions/lib/entitlement.js — and none of the three can import either of
 * the others: one runs in the database, one is a classic browser script with
 * no module system, one is an ES module in a Worker.
 *
 * Two of them are JavaScript, so two of them can be run side by side here.
 *
 * It matters which way a disagreement would break. The edge copy decides
 * access; the browser copy decides what the sidebar says and whether
 * premium.html bounces someone back to the page they wanted. Drift means the
 * site tells a reader one thing and does another — "Premium user" in the menu
 * over a wall that will not open, or the reverse. That is precisely the shape
 * of the bug this paywall has already produced twice.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';
import { isPremiumProfile } from '../functions/lib/entitlement.js';

const auIsPremium = loadFunction('scripts/auth.js', 'auIsPremium');

/* A fixed clock. Reading Date.now() in the cases would make an expiry test
   that passes today and fails on the day it is written past. */
const NOW = Date.parse('2026-01-15T12:00:00Z');

const CASES = [
    ['a hand-granted account with no expiry', { plan: 'premium', plan_until: null }, true],
    ['the expiry field absent entirely', { plan: 'premium' }, true],
    ['premium until next month', { plan: 'premium', plan_until: '2026-02-01T00:00:00Z' }, true],
    ['premium that lapsed last week', { plan: 'premium', plan_until: '2026-01-08T00:00:00Z' }, false],
    ['premium expiring one second ago', { plan: 'premium', plan_until: '2026-01-15T11:59:59Z' }, false],
    ['a free account', { plan: 'free', plan_until: null }, false],
    ['free with a future date on it anyway', { plan: 'free', plan_until: '2030-01-01T00:00:00Z' }, false],
    ['a plan nobody defined', { plan: 'lifetime', plan_until: null }, false],
    ['a plan that is the wrong case', { plan: 'Premium', plan_until: null }, false],
    ['an unparseable expiry', { plan: 'premium', plan_until: 'soon' }, false],
    ['an empty expiry string, which is not a date but is falsy', { plan: 'premium', plan_until: '' }, true],
    ['no plan field at all', { plan_until: null }, false],
    ['an empty row', {}, false],
    ['no row', null, false],
    ['undefined', undefined, false]
];

test('both copies of the entitlement rule give the same answer', () => {
    for (const [what, profile, expected] of CASES) {
        const edge = isPremiumProfile(profile, NOW);
        assert.equal(edge, expected, `edge disagrees with the spec: ${what}`);
    }
});

test('the browser copy matches the edge copy case for case', () => {
    /* auIsPremium reads Date.now() directly, so the cases with a date near the
       fixed clock cannot be compared against it — every other one can, and the
       two boundary cases are covered by the test above. */
    for (const [what, profile, expected] of CASES) {
        if (profile && profile.plan_until && /^20\d\d-/.test(String(profile.plan_until))) continue;
        assert.equal(auIsPremium(profile), expected, `auIsPremium disagrees: ${what}`);
    }
});

test('an expiry is read against the clock, not ignored', () => {
    // The guard against the rule quietly degrading to "plan === premium".
    const lapsed = { plan: 'premium', plan_until: '2026-01-14T00:00:00Z' };
    const live = { plan: 'premium', plan_until: '2026-01-16T00:00:00Z' };
    assert.equal(isPremiumProfile(lapsed, NOW), false);
    assert.equal(isPremiumProfile(live, NOW), true);
    // And the same row flips as the clock passes it.
    assert.equal(isPremiumProfile(live, Date.parse('2026-01-17T00:00:00Z')), false);
});

test('nothing but the string premium counts as premium', () => {
    for (const plan of ['', 'PREMIUM', 'pro', 'paid', 'true', '1', null, undefined, 0, 1]) {
        assert.equal(isPremiumProfile({ plan, plan_until: null }, NOW), false,
            `${JSON.stringify(plan)} is not the premium plan`);
    }
});
