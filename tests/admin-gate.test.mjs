/* The admin area: who gets in, and what is inside it.
 *
 * Two failure modes, both worth a test each. An internal dashboard served to
 * the public, and the two people it exists for locked out of it. The first is
 * the one that matters, so the path matching below leans on the deny-by-prefix
 * rule rather than on anyone remembering to list a new page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_USER_IDS, isAdminUser, adminReason, isAdminPath } from '../functions/lib/admin.js';
import { isPremiumPath } from '../functions/lib/premium.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---- who

test('only the listed ids are admins', () => {
    for (const id of ADMIN_USER_IDS) assert.equal(isAdminUser(id), true);
    assert.equal(isAdminUser('00000000-0000-0000-0000-000000000000'), false);
    assert.equal(isAdminUser(ADMIN_USER_IDS[0].slice(0, -1)), false, 'a near miss is a miss');
});

test('an id is matched case-insensitively and trimmed, and nothing else is matched at all', () => {
    assert.equal(isAdminUser(ADMIN_USER_IDS[0].toUpperCase()), true);
    assert.equal(isAdminUser(`  ${ADMIN_USER_IDS[0]}  `), true);
    for (const junk of [null, undefined, '', 0, 1, {}, [], true, ADMIN_USER_IDS]) {
        assert.equal(isAdminUser(junk), false, `${JSON.stringify(junk)} is not an admin`);
    }
});

test('the list is frozen, so nothing can push onto it at runtime', () => {
    assert.throws(() => ADMIN_USER_IDS.push('x'), TypeError);
});

// ---- what

test('the admin pages are gated, however they are spelled', () => {
    for (const p of [
        '/admin.html', '/admin', '/admin/', '/ADMIN.HTML', '//admin.html',
        '/admin-model-accuracy.html', '/admin-model-accuracy', '/admin.html?v=314'
    ]) {
        assert.equal(adminReason(p), 'page', `${p} must be gated`);
    }
});

test('a page nobody has written yet is gated by its name alone', () => {
    /* The point of the prefix rule. An admin page added next year and forgotten
       in a list would otherwise be served to the world. */
    assert.equal(adminReason('/admin-anything-at-all.html'), 'page');
    assert.equal(adminReason('/admin/nested/thing'), 'page');
});

test('the data the dashboard draws is gated too', () => {
    assert.equal(adminReason('/data/model-accuracy.json'), 'data');
    assert.equal(adminReason('/data/model-log/gw6.json'), 'data');
    // A page behind a login whose numbers are one fetch away is a screenshot of
    // a gate rather than a gate.
});

test('the rest of the site is untouched', () => {
    for (const p of [
        '/', '/index.html', '/fpl-news.html', '/fpl-scouts-desk.html',
        '/data/odds-calibration.json', '/data/bootstrap-static.json',
        '/scripts/common.js', '/styles/v2-design.css', '/administration.html', '/adminx.html'
    ]) {
        assert.equal(adminReason(p), null, `${p} must not be gated as admin`);
    }
});

test('an unreadable path is refused rather than guessed at', () => {
    assert.equal(adminReason('/admin/%ZZ'), 'unreadable');
    assert.equal(adminReason(null), 'unreadable');
    assert.equal(isAdminPath('/admin/../admin.html'), true, 'traversal resolves to the gated page');
});

test('admin and premium are different questions with no shared paths', () => {
    /* Admin is not the top tier of premium. If these lists ever overlap, one
       gate is answering for the other and the middleware order starts to
       matter — which is exactly the kind of thing nobody notices. */
    for (const p of ['/admin.html', '/admin-model-accuracy.html', '/data/model-accuracy.json']) {
        assert.equal(isPremiumPath(p), false, `${p} is admin, not premium`);
    }
    for (const p of ['/fpl-my-team-analysis.html', '/fpl-league-rivals.html']) {
        assert.equal(isAdminPath(p), false, `${p} is premium, not admin`);
    }
});

// ---- the second copy

test('the browser copy of the allowlist matches the one that decides', () => {
    /* scripts/sidebar-nav.js carries its own list so it can decide whether to
       draw the link. It cannot be handed the deciding copy — it is the browser
       — so the arrangement is the same one entitlement already lives under:
       duplicate, and fail here the moment they disagree. */
    const src = read('scripts/sidebar-nav.js');
    const block = /const SIDEBAR_ADMIN_USER_IDS = \[([\s\S]*?)\]/.exec(src);
    assert.ok(block, 'the browser list should still be called SIDEBAR_ADMIN_USER_IDS');

    const ids = [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    assert.deepEqual(ids, [...ADMIN_USER_IDS],
        'scripts/sidebar-nav.js and functions/lib/admin.js disagree about who is an admin');
});

test('the nav link ships hidden and points at the hub', () => {
    const nav = read('sidebar-nav.html');
    const link = /<a[^>]*id="v2NavAdmin"[^>]*>/.exec(nav);
    assert.ok(link, 'the Admin nav item should exist');
    assert.match(link[0], /\bhidden\b/, 'it must ship hidden, not be hidden later by script');
    assert.match(link[0], /href="admin\.html"/);
});

test('every admin page the repo ships is one the gate already covers', () => {
    /* Reads the directory rather than trusting a list, so a new admin-*.html
       cannot arrive unprotected. */
    const pages = fs.readdirSync(ROOT).filter(f => /^admin.*\.html$/.test(f));
    assert.ok(pages.length >= 2, `expected the hub and at least one subpage, found ${pages.join(', ')}`);
    for (const f of pages) assert.equal(adminReason('/' + f), 'page', `${f} is not gated`);
});

test('the admin pages are marked noindex', () => {
    for (const f of fs.readdirSync(ROOT).filter(x => /^admin.*\.html$/.test(x))) {
        assert.match(read(f), /<meta name="robots" content="noindex/,
            `${f} should not invite a crawler that will only get a 403`);
    }
});
