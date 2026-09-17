/* What is behind the paywall, and how a request path is judged against it.
 *
 * One list, read by the edge middleware that enforces it and by the page that
 * dresses the nav around it, so the two cannot disagree about what a reader is
 * entitled to. Pure: no request, no environment, no Supabase. That is what lets
 * it be tested exhaustively, which matters more here than anywhere else in the
 * codebase — a mistake in this file is either a paywall that leaks or a free
 * page that refuses to load.
 *
 * WHAT IS ACTUALLY GATEABLE, AND WHAT IS NOT
 *
 * Three pages are wholly premium and can simply be refused.
 *
 * Three features — the Transfer Wizard, the Lineup Wizard and GW Draft — live
 * on a page a free reader needs, because Squad Analysis is on it too. They are
 * gateable anyway because each is carried by scripts that no free page loads.
 * Refusing those scripts is a real gate: the code never reaches the browser.
 *
 * Four features are NOT here, and their absence is deliberate. Routes to
 * Points, Rising Form, Purple Patch and Recommendations render from inline
 * markup inside fpl-players-analysis.html, which free readers need for All
 * Players and Charts. There is no separate file to refuse, so they are hidden
 * client-side and that is cosmetic rather than a gate. Extracting them into
 * their own script would make them enforceable; until then this file must not
 * pretend otherwise.
 *
 * WHAT MUST NEVER BE LISTED
 *
 * Anything a free page loads. transfer-engine.js, xp-engine.js, price-watch.js,
 * eo-layer.js and odds-panel.js are all pulled in by the free dashboard: gating
 * them would break it. The wizard PAGES are premium, the projection engine is
 * not, and the test suite checks that distinction against the real pages rather
 * than trusting this comment.
 */

/* Canonical paths, lowercase, with the extension the file actually has. The
   normaliser below is what makes matching them safe. */
export const PREMIUM_PAGES = Object.freeze([
    '/fpl-teams-analysis.html',
    '/fpl-league-rivals.html',
    '/season-vault-d845fb.html'
]);

export const PREMIUM_SCRIPTS = Object.freeze([
    // Transfer Wizard
    '/scripts/transfer-wizard.js',
    '/scripts/transfer-funnel.js',
    '/scripts/transfer-rationale.js',
    '/scripts/wildcard-builder.js',
    // Lineup Wizard
    '/scripts/lineup-wizard.js',
    '/scripts/lineup-store.js',
    // GW Draft
    '/scripts/draft-planner.js'
]);

/* Hidden, not refused. Listed so the page and this file still share one
   vocabulary, and so the gap is visible rather than forgotten. */
export const SOFT_SECTIONS = Object.freeze([
    { page: '/fpl-players-analysis.html', hash: 'routes', label: 'Routes to Points' },
    { page: '/fpl-players-analysis.html', hash: 'rising', label: 'Rising Form' },
    { page: '/fpl-players-analysis.html', hash: 'purple-patch', label: 'Purple Patch' },
    { page: '/fpl-players-analysis.html', hash: 'recommendations', label: 'Recommendations' }
]);

const PAGES = new Set(PREMIUM_PAGES);
const SCRIPTS = new Set(PREMIUM_SCRIPTS);

/* A request path reduced to the one spelling the lists above use.
 *
 * Every step here exists because a gate that matches on the raw path is a gate
 * with a door beside it:
 *
 *   ?v=266            every script on this site is cache-busted, so the query
 *                     string is the normal case rather than an attack.
 *   /page             Cloudflare Pages serves page.html for an extensionless
 *                     request, so /fpl-teams-analysis is the premium page.
 *   /page/            and again with a trailing slash.
 *   //page.html       a doubled slash is the same file to the origin.
 *   %2e, %6C          percent-encoding hides the spelling from a plain compare.
 *   ..                traversal, in case a path arrives unnormalised.
 *   MiXeD case        belt and braces; asset paths here are lowercase anyway.
 *
 * Returns null when the path cannot be understood, and callers treat that as
 * premium — an unreadable path is not an argument for serving the file. */
export function normalisePath(raw) {
    if (typeof raw !== 'string' || !raw) return null;

    let p = raw;
    // Drop anything the origin would not use to pick a file.
    p = p.split('#')[0].split('?')[0];

    /* Decode repeatedly: a single pass leaves %252e as %2e, which decodes again
       at some other layer. Bounded, so a crafted input cannot spin. */
    for (let i = 0; i < 3; i++) {
        if (!/%[0-9a-f]{2}/i.test(p)) break;
        try {
            const next = decodeURIComponent(p);
            if (next === p) break;
            p = next;
        } catch {
            return null;   // malformed escape: not a path we can reason about
        }
    }

    /* A percent that survived the loop is not an escape this code understands —
       "%ZZ", or a stray "%" at the end. Nothing we serve has one in its name, and
       the whole family of bypasses in this area comes from two layers disagreeing
       about how to read a malformed escape. So it is refused rather than compared
       as a literal: no file here is worth the ambiguity. */
    if (p.indexOf('%') > -1) return null;

    // A null byte or a backslash is never part of a path we serve.
    if (p.indexOf('\0') > -1 || p.indexOf('\\') > -1) return null;

    p = p.toLowerCase().replace(/\/{2,}/g, '/');
    if (p[0] !== '/') p = '/' + p;

    // Resolve . and .. rather than rejecting: the runtime may have left them.
    const out = [];
    for (const seg of p.split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') { out.pop(); continue; }
        out.push(seg);
    }
    p = '/' + out.join('/');

    if (p === '/') return '/index.html';

    /* An extensionless last segment is a page request, which Pages resolves by
       appending .html. A segment WITH a dot is a file — .json, .css, .js — and
       is left alone. */
    const last = out[out.length - 1] || '';
    if (last.indexOf('.') < 0) p += '.html';

    return p;
}

/* Why this path is premium, or null if it is not.
 *
 * The lists are an allowlist of what is paid for, so anything unlisted is free:
 * the site is mostly public data, stylesheets and images, and defaulting those
 * to "denied" would take the whole site down rather than protect it. The risk
 * that runs the other way — a new premium script nobody added here — is covered
 * by a test that reads the real pages instead of trusting the list. */
export function premiumReason(pathname) {
    const p = normalisePath(pathname);
    if (p === null) return 'unreadable';
    if (PAGES.has(p)) return 'page';
    if (SCRIPTS.has(p)) return 'script';
    return null;
}

export function isPremiumPath(pathname) {
    return premiumReason(pathname) !== null;
}
