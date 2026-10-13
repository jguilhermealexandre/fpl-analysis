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

/* The public half of the same numbers.
 *
 * data/model-summary.json is derived from the gated archive and deliberately
 * is not gated, because fpl-accuracy.html is a public page that has to be able
 * to read it. The pair of assertions below is the line between the two, and it
 * is worth a test of its own: gate the summary and the accuracy page goes blank
 * for every visitor, un-gate the archive and the model's working data — every
 * per-round residual, every correction still being argued about — is one fetch
 * from the open internet.
 *
 * What makes the un-gated file safe is that nothing is in it but six pooled
 * figures and a sentence, and that summarise() in tools/grade-predictions.mjs
 * is the only thing that writes it. */
test('the derived public summary is NOT gated, and the archive it comes from still is', () => {
    assert.equal(adminReason('/data/model-summary.json'), null,
        'gating this blanks the public accuracy page');
    assert.equal(adminReason('/data/model-accuracy.json'), 'data',
        'and un-gating this publishes the working data');
});

test('the public accuracy page reads the summary and never the archive', () => {
    /* The bug this pins shipped. The accuracy page fetched the archive, which
       is admin-gated — so a visitor got the login shell, with a 200 on it,
       which parses as JSON and renders as four dashes. It looked correct to
       whoever was signed in, which is the only person who never saw it.

       The renderer is scripts/accuracy-page.js since it came out of the
       markup, and the page is checked too: a public page that stopped loading
       it would be just as blank, and the test would still pass on the script
       alone. */
    const page = read('fpl-accuracy.html');
    const script = read('scripts/accuracy-page.js');
    assert.match(page, /<script src="\/scripts\/accuracy-page\.min\.js/,
        'the page has to load the renderer it was extracted into');
    assert.match(script, /fetch\('\/data\/model-summary\.json/,
        'the public page must read the public file');
    for (const [where, src] of [['fpl-accuracy.html', page], ['scripts/accuracy-page.js', script]]) {
        assert.equal(/fetch\([^)]*model-accuracy\.json/.test(src), false,
            `${where} cannot fetch an admin-gated file`);
    }
});

test('every field the public renderer reads is one the summary actually carries', () => {
    /* The two files have different shapes, and the renderer was moved from one
       to the other. A field read off the old shape — d.overall.vsEp, as it was
       — is not an error anywhere: it is undefined, and renders as an em dash
       that looks like "no data yet". */
    const script = read('scripts/accuracy-page.js');
    const summary = JSON.parse(read('data/model-summary.json'));
    const used = new Set([...script.matchAll(/\bd\.([A-Za-z]\w*)/g)].map(m => m[1]));
    assert.ok(used.size >= 4, `expected the renderer to read several fields, saw ${[...used]}`);
    for (const key of used) {
        assert.ok(key in summary,
            `scripts/accuracy-page.js reads d.${key}, which is not in data/model-summary.json`);
    }
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

test('and hidden actually hides it, despite the flex on every nav item', () => {
    /* The attribute is only a user-agent display:none, and .v2-nav-item sets
       display:flex — an author rule, which wins. That combination put the
       Admin link in every visitor's sidebar on launch day. The stylesheet has
       to say [hidden] means hidden, explicitly, and keep saying it. */
    /* v2-app.css since the design layer was split: the sidebar is the
       signed-in half of it, and so is the rule that keeps this link out of
       it. Both are behind the same saved-Team-ID question, so the rule is
       still on the page whenever the link it hides is. */
    const css = read('styles/v2-app.css');
    assert.match(css, /\.v2-nav-item\[hidden\]\s*\{\s*display:\s*none\s*!important/,
        'without this rule, display:flex overrides the hidden attribute for everyone');
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
