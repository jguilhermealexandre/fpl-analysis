/* The soft 404, and why it cost 2.5 GB in two hours.
 *
 * Cloudflare Pages answers an unmatched path with index.html and a 200. For a
 * navigation that is an SPA fallback. For an asset it is a loop:
 *
 *   1. Every page references its assets relatively — `scripts/x.js`, not
 *      `/scripts/x.js` — so a document served at any path other than its own
 *      re-requests all of them one directory deeper.
 *   2. Those deeper paths do not exist, so each returned another 200 and another
 *      322 KB copy of the dashboard, which gave the next round something to
 *      resolve against.
 *
 * One visitor produced 34,557 requests in an hour that way. The rule that ends
 * it is small — a .js request must never be answered with HTML — and the tests
 * below are mostly about the ORDER it runs in, because the first version of it
 * sat above the admin gate and would have served the admin archive to anybody.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { adminReason } from '../functions/lib/admin.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const MW = fs.readFileSync(path.join(ROOT, 'functions/_middleware.js'), 'utf8');

/* The matcher, lifted from the middleware rather than restated here. A copy
   would drift, and the thing being tested is the exact list of extensions the
   deployed code treats as an asset. */
const ASSET_EXT = new RegExp(
    /const ASSET_EXT = \/(.+)\/i;/.exec(MW)[1], 'i');
const looksLikeAsset = p => ASSET_EXT.test(p);

test('the paths from the incident are recognised as assets', () => {
    // The shape Cloudflare reported, with the repeated segment.
    assert.equal(looksLikeAsset('/assets/fonts/scripts/scripts/scripts/notifications.js'), true);
    assert.equal(looksLikeAsset('/scripts/common.js'), true);
    assert.equal(looksLikeAsset('/styles/common.css'), true);
    assert.equal(looksLikeAsset('/data/bootstrap-static.json'), true);
    assert.equal(looksLikeAsset('/icon-192.png'), true);
});

test('pages are not assets, so the SPA fallback still works', () => {
    /* /dashboard and /squad-analysis are 200 rewrites the product depends on —
       see _redirects. Treating a page path as an asset would 404 both. */
    for (const p of ['/', '/dashboard', '/squad-analysis', '/index.html',
        '/fpl-players-analysis.html', '/admin.html']) {
        assert.equal(looksLikeAsset(p), false, `${p} is a page`);
    }
});

test('the admin gate runs BEFORE the asset check', () => {
    /* The bug this exists to prevent, and it was written before it was caught:
       two of the paths the admin gate protects end in .json, so an asset check
       placed above it returns the file without ever asking who is asking. */
    assert.equal(adminReason('/data/model-accuracy.json'), 'data');
    assert.equal(adminReason('/data/model-log/gw6.json'), 'data');
    assert.equal(looksLikeAsset('/data/model-accuracy.json'), true,
        'which means the asset check would happily serve it');

    const adminAt = MW.indexOf('const admin = adminReason(url.pathname);');
    const assetAt = MW.indexOf('if (looksLikeAsset(url.pathname))');
    assert.ok(adminAt > 0 && assetAt > 0, 'both checks are present');
    assert.ok(adminAt < assetAt,
        'the admin gate must come first, or the admin archive is public');
});

test('a missing asset is refused without paying for an entitlement lookup', () => {
    // A file that is not there is not a paywall question, and the lookup is a
    // network call. It belongs above the premium branch.
    const assetAt = MW.indexOf('if (looksLikeAsset(url.pathname))');
    const premiumAt = MW.indexOf('const reason = PAYWALL_ENABLED');
    assert.ok(assetAt < premiumAt);
});

test('the refusal is empty, cacheable, and says why', () => {
    /* The point of the fix is bandwidth: 322 KB became 0, and the edge is told
       it may answer the next one itself, so a client stuck in a loop stops
       reaching the origin at all. */
    const fn = MW.slice(MW.indexOf('async function assetOrNotFound'),
        MW.indexOf('export async function onRequest'));
    assert.match(fn, /new Response\(null/, 'no body');
    assert.match(fn, /status: 404/);
    assert.match(fn, /Cache-Control[^\n]*max-age=\d+/, 'the edge can serve the next one');
    assert.match(fn, /X-EasyFPL-Reason/, 'debuggable from a header, not a bandwidth bill');
});

test('only an HTML answer is turned into a 404', () => {
    /* A real asset is never HTML — the static handler serves .js as JavaScript.
       So the content type is the whole test, and no list of which files exist
       is needed. Anything that is not HTML passes through untouched, including
       a genuine 404 from the static handler. */
    const fn = MW.slice(MW.indexOf('function isHtml'),
        MW.indexOf('export async function onRequest'));
    assert.match(fn, /text\/html/);
    assert.match(fn, /if \(!isHtml\(res\)\) return res;/,
        'a real asset response is returned exactly as it came');
});
