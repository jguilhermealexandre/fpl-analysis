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
 * WHAT CHANGED, AND WHY IT MADE EVERYTHING SIMPLER
 *
 * The free plan used to include Squad Analysis, All Players and Charts, which
 * put paid features on pages free readers needed. That is what forced the asset
 * gate, and the asset gate could not be enforced: transfer-wizard.js also holds
 * the price-pressure model the squad table renders, lineup-wizard.js holds the
 * scorer the pitch's Auto-Optimize runs, and fourteen unguarded call sites
 * reached across. Refusing those files would have thrown a ReferenceError in
 * the middle of a free feature.
 *
 * Free is now the dashboard, the Scout's Desk and the News Hub. Every page that
 * loads a wizard script is itself premium, so the entanglement is gone: no free
 * page loads one, and no free page loads anything that calls into one. Both
 * gates are real, and the scripts are refused as well as the pages — a page
 * gate someone finds a way around should not hand over the models too.
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

/* ===== The paywall is currently OFF =====
 *
 * Every page and script below is served to everyone, signed in or not. Nothing
 * else has changed: the lists, the normaliser, premiumReason() and every test
 * over them still describe exactly what WOULD be gated, and the nav still says
 * Premium to the accounts that have it. The only thing this flag does is stop
 * _middleware.js asking the question.
 *
 * It is a flag rather than a deletion because this is meant to be reverted.
 * Turning the paywall back on is one word here — no lists to rebuild, no
 * redirects to rewire, no tests to rewrite. A test asserts the current value so
 * flipping it is always deliberate and never a silent side effect of an edit.
 *
 * Checked before switching this off: nothing gates premium content in the
 * browser. premium.html's auIsPremium() calls only dress the refusal page,
 * which is now unreachable, and common.js uses it for the sidebar label alone.
 * The edge was the whole paywall, so this flag is the whole switch. */
export const PAYWALL_ENABLED = false;

/* Canonical paths, lowercase, with the extension the file actually has. The
   normaliser below is what makes matching them safe. */
export const PREMIUM_PAGES = Object.freeze([
    '/fpl-my-team-analysis.html',
    '/fpl-players-analysis.html',
    '/fpl-teams-analysis.html',
    '/fpl-league-rivals.html',
    '/season-vault-d845fb.html'
]);

/* Clean URLs that _redirects REWRITES onto a premium page, rather than
   redirecting to one.
 *
 * The difference decides whether this file ever sees them. A 301 makes the
 * browser ask again for the real path, which is matched above. A 200 rewrite is
 * resolved by the static asset layer AFTER the middleware has run, so the
 * request that reaches here still says /squad-analysis — a spelling that is not
 * in any list and would have been served. A door beside the gate, and one built
 * months before the gate existed.
 *
 * Prefixes, because the rewrite is /squad-analysis/* too. */
export const PREMIUM_ALIASES = Object.freeze(['/squad-analysis']);

export const PREMIUM_SCRIPTS = Object.freeze([
    // Transfer Wizard
    '/scripts/transfer-wizard.js',
    '/scripts/transfer-funnel.js',
    '/scripts/transfer-rationale.js',
    // Lineup Wizard
    '/scripts/lineup-wizard.js',
    /* lineup-store.js is NOT here, and that is the interesting entry.
     *
     * It is not a feature. It is twenty lines of localStorage plus pure
     * functions over an arrangement, and the free dashboard now reads it — the
     * armband warnings there have to agree with the choice made on Squad
     * Analysis, and they cannot if the reader of that choice is behind the
     * paywall. Gating the store would not protect the Lineup Wizard, which is
     * gated on its own file; it would only stop the dashboard knowing who the
     * captain is. */
    // GW Draft
    '/scripts/draft-planner.js'
]);

/* Four sections of fpl-players-analysis.html that were hidden client-side
   because there was no file to refuse. That page is wholly premium now, so
   they are behind the page gate like everything else on it and this list has
   nothing left to describe. Kept, empty, because the moment any part of that
   page goes back to being free the problem comes back with it. */
export const SOFT_SECTIONS = Object.freeze([]);

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
    /* normalisePath has already appended .html to an extensionless request, so
       /squad-analysis arrives as /squad-analysis.html and /squad-analysis/x as
       /squad-analysis/x.html. Both are the rewrite, and both are the page. */
    for (const alias of PREMIUM_ALIASES) {
        if (p === alias + '.html' || p.startsWith(alias + '/')) return 'page';
    }
    return null;
}

export function isPremiumPath(pathname) {
    return premiumReason(pathname) !== null;
}
