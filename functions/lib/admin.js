/* Who may see the admin area, and which paths are in it.
 *
 * Pure, like lib/premium.js and for the same reason: a mistake here is either an
 * internal dashboard served to the public or an admin locked out of their own
 * site, and both are cheaper to catch in a test than in production.
 *
 * HOW THE GATE ACTUALLY DECIDES
 *
 * Not from this file. The list below is compared against a user id that
 * Supabase returned for a token it verified — see verifiedUserId() in
 * _middleware.js. Nothing the browser sends is trusted as an identity, which is
 * the whole difference between this and reading `sub` out of an unverified JWT:
 * anyone can mint a JWT claiming to be an id on this list, and nobody can make
 * Supabase agree.
 *
 * WHY THE IDS ARE CONSTANTS AND NOT AN ENVIRONMENT VARIABLE
 *
 * Same argument lib/supabase.js makes about the publishable key. A Supabase
 * user id is an identifier, not a credential — knowing one grants nothing,
 * because the check is "did Supabase say this token belongs to that id". An env
 * var nobody sets is a gate that locks out the two people it exists for, and
 * this codebase has already paid for one of those (see lib/entitlement.js on
 * the is_premium_me() afternoon).
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not hide anything. The repository is public, so /admin.html is
 * readable in the source tree whatever this file says, and the data it renders
 * is committed alongside it. The control here is access to the LIVE page and
 * its data over HTTP, not secrecy about their existence — which is why the
 * refusal below is an honest 403 rather than a 404 pretending the page is not
 * there. If the underlying numbers ever need to be confidential, the repository
 * has to stop being public; no edge rule can do it for them.
 */
import { normalisePath } from './premium.js';

export const ADMIN_USER_IDS = Object.freeze([
    '2072e895-0395-43c9-b839-c9a25b2102b0',
    '20987bc9-ea9b-4149-ac84-06a4e7251fee'
]);

export function isAdminUser(id) {
    if (typeof id !== 'string' || !id) return false;
    const want = id.trim().toLowerCase();
    return ADMIN_USER_IDS.some(known => known === want);
}

/* Why this path is in the admin area, or null if it is not.
 *
 * DENY BY PREFIX, which is the opposite of how lib/premium.js works and
 * deliberately so. Premium is an allowlist because the site is mostly public
 * and defaulting to "denied" would take it down. Here the default has to run
 * the other way: an admin page somebody adds next year and forgets to list
 * would be served to the world, and the whole point of the area is that it is
 * not. Anything spelled /admin, /admin-* or /admin/* is in, without being
 * named.
 *
 * The data files are gated too. A dashboard behind a login whose JSON is one
 * fetch away is a screenshot of a gate rather than a gate — and these two files
 * ARE the dashboard; the page is only a drawing of them. */
export function adminReason(pathname) {
    const p = normalisePath(pathname);
    if (p === null) return 'unreadable';

    if (p === '/admin.html' || p.startsWith('/admin-') || p.startsWith('/admin/')) return 'page';

    // normalisePath leaves a segment with a dot in it alone, so these arrive
    // spelled exactly as they are served.
    if (p === '/data/model-accuracy.json') return 'data';
    if (p.startsWith('/data/model-log/')) return 'data';

    return null;
}

export function isAdminPath(pathname) {
    return adminReason(pathname) !== null;
}
