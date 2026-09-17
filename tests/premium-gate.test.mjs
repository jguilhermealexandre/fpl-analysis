/* The paywall's decision layer.
 *
 * A mistake here is one of two failures, and they point opposite ways: a path
 * that should be refused and is not is a paywall that leaks, and a path that
 * should be served and is not is the site refusing to load for someone who paid
 * nothing and expected nothing. So the tests come in two halves — everything
 * premium must be denied however it is spelled, and everything free must still
 * load.
 *
 * The last three tests are the ones that will actually earn their keep. They do
 * not check the list against itself; they check it against the real pages and
 * the real redirects, so that adding a premium script next season, or a tidy
 * alias for a premium page, fails here rather than quietly opening the gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// fileURLToPath, not URL.pathname: this repo lives under a directory with a
// space in its name, and pathname would hand path.join a percent-encoded string
// that exists nowhere on disk.
import { fileURLToPath } from 'node:url';
import {
    normalisePath, premiumReason, isPremiumPath,
    PREMIUM_PAGES, PREMIUM_SCRIPTS, PREMIUM_ALIASES
} from '../functions/lib/premium.js';

const ROOT = new URL('..', import.meta.url);
const ROOT_DIR = fileURLToPath(ROOT);
const read = f => fs.readFileSync(new URL(f, ROOT), 'utf8');

test('a premium page is refused however the path is spelled', () => {
    /* Each of these resolves to the same file at the origin. Cloudflare Pages
       serves page.html for an extensionless request, so /fpl-teams-analysis is
       the premium page just as surely as /fpl-teams-analysis.html is. */
    for (const p of [
        '/fpl-teams-analysis.html',
        '/fpl-teams-analysis',
        '/fpl-teams-analysis/',
        '//fpl-teams-analysis.html',
        '/FPL-Teams-Analysis.html',
        '/fpl-teams-analysis.html?v=266',
        '/fpl-teams-analysis.html#rankings',
        '/./fpl-teams-analysis.html',
        '/scripts/../fpl-teams-analysis.html',
        '/a/b/../../fpl-teams-analysis.html',
        '/%66pl-teams-analysis.html',
        '/fpl-teams-analysis%2ehtml',
        '/%2566pl-teams-analysis.html'
    ]) {
        assert.equal(premiumReason(p), 'page', p);
    }
});

test('a premium script is refused as the page actually asks for it', () => {
    // Every script on this site is cache-busted, so the query string is the
    // normal case rather than an attack. PREMIUM_SCRIPTS is empty today; this
    // is here so it keeps working the day something is added to it.
    for (const s of PREMIUM_SCRIPTS) {
        assert.equal(premiumReason(s), 'script', s);
        assert.equal(premiumReason(s + '?v=1'), 'script', s);
    }
});

test('a clean URL that REWRITES onto a premium page is refused too', () => {
    /* The difference between a rewrite and a redirect decides whether the gate
       ever sees the real path. _redirects sends /squad-analysis to
       fpl-my-team-analysis.html with a 200, which the static asset layer
       resolves AFTER the middleware has run — so the request reaching the gate
       still says /squad-analysis. Left unlisted it was a door beside the gate,
       and one built months before the gate existed. */
    for (const alias of PREMIUM_ALIASES) {
        assert.equal(premiumReason(alias), 'page', alias);
        assert.equal(premiumReason(alias + '/'), 'page', alias + '/');
        assert.equal(premiumReason(alias + '/anything'), 'page', alias + '/*');
    }
    // A different page that merely starts the same way is not the alias.
    assert.equal(premiumReason('/squad-analysis-notes'), null);
});

test('every alias points at a page that is itself premium', () => {
    /* Otherwise the alias refuses something the real path serves, which is a
       404 for a free feature rather than a gate. */
    const rules = read('_redirects').split('\n').map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));
    for (const alias of PREMIUM_ALIASES) {
        const rule = rules.find(r => r.split(/\s+/)[0] === alias);
        assert.ok(rule, `${alias} is listed as a premium alias but _redirects has no rule for it`);
        const target = rule.split(/\s+/)[1];
        assert.equal(premiumReason(target), 'page',
            `${alias} rewrites to ${target}, which is not premium`);
    }
});

test('everything free still loads', () => {
    /* The expensive failure. Most of this site is public data, stylesheets and
       images; if the gate defaulted to denying, it would take the site down
       rather than protect it. */
    for (const p of [
        '/', '/index.html', '/dashboard', '/squad-analysis',
        '/fpl-my-team-analysis.html', '/fpl-players-analysis.html',
        '/fpl-news.html', '/fpl-scouts-desk.html', '/fpl-faq.html', '/fpl-privacy.html',
        '/scripts/common.js', '/scripts/xp-engine.js?v=266',
        '/scripts/transfer-engine.js', '/scripts/price-watch.js',
        '/scripts/eo-layer.js', '/scripts/odds-panel.js',
        '/data/bootstrap-static.json', '/data/injuries.json',
        '/styles/common.css', '/favicon.svg', '/manifest.json', '/service-worker.js'
    ]) {
        assert.equal(isPremiumPath(p), false, p);
    }
});

test('a path that cannot be read is refused rather than served', () => {
    /* Bypasses in this area come from two layers disagreeing about how to read a
       malformed escape. Nothing we serve has a percent in its name, so an
       unreadable path is refused rather than compared as a literal. */
    assert.equal(premiumReason('/a%ZZb'), 'unreadable');
    assert.equal(premiumReason('/x%00.html'), 'unreadable');
    assert.equal(isPremiumPath('/a%ZZb'), true, 'unreadable must deny, not allow');
    assert.equal(normalisePath(null), null);
    assert.equal(normalisePath(''), null);
});

test('the normaliser resolves a path the way the origin would', () => {
    assert.equal(normalisePath('/'), '/index.html');
    assert.equal(normalisePath('/foo'), '/foo.html', 'an extensionless segment is a page');
    assert.equal(normalisePath('/data/x.json'), '/data/x.json', 'a file keeps its extension');
    assert.equal(normalisePath('//a//b//'), '/a/b.html');
});

/* ------------------------------------------------------------------------
   The three that check the list against reality rather than against itself.
   ------------------------------------------------------------------------ */

test('every gated file actually exists', () => {
    // A typo in the list is an ungated feature that looks gated.
    for (const p of [...PREMIUM_PAGES, ...PREMIUM_SCRIPTS]) {
        const onDisk = path.join(ROOT_DIR, p.replace(/^\//, ''));
        assert.ok(fs.existsSync(onDisk), `${p} is in the paywall list but not in the repo`);
    }
});

test('no premium script is loaded by a page free readers can open', () => {
    /* The invariant that matters next season. Refusing a script that the free
       dashboard or Squad Analysis needs would break them for everyone, and the
       only way to know is to read the pages rather than trust the list.

       Every page below is free to open, so none of them may so much as
       reference a script the gate refuses. */
    /* Every page a signed-out or free reader can open. My Team and All Players
       used to be on this list with an exception carved out for them; they are
       premium now, which is what made the scripts gateable at all — nothing
       free loads one, so refusing one cannot break anything free. */
    const freePages = [
        'index.html', 'fpl-scouts-desk.html', 'fpl-news.html',
        'fpl-faq.html', 'fpl-how-it-works.html', 'fpl-contact.html',
        'fpl-privacy.html', 'fpl-methodology.html',
        'premium.html', 'login.html', 'register.html', 'reset-password.html'
    ];
    for (const page of freePages) {
        const html = read(page);
        for (const s of PREMIUM_SCRIPTS) {
            const file = s.replace('/scripts/', '');
            assert.ok(!html.includes(`scripts/${file}`),
                `${page} loads ${file}, which the paywall refuses — gating it breaks a free page`);
        }
    }
});

test('no redirect quietly opens a premium page', () => {
    /* _redirects is processed by the static asset layer; a Pages Function sees
       the path the reader asked for. So a rewrite from an ungated source to a
       premium destination is a door beside the gate, and it would be an easy
       one to add without noticing. */
    const rules = read('_redirects')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
        .map(l => l.split(/\s+/));

    for (const [from, to] of rules) {
        if (!to) continue;
        const dest = normalisePath(to.replace(/\*$/, ''));
        const destIsPremium = PREMIUM_PAGES.includes(dest);
        if (!destIsPremium) continue;
        assert.ok(isPremiumPath(from.replace(/\*$/, '')),
            `${from} rewrites to the premium page ${to} but is not itself refused`);
    }
});
