/* The paywall, at the edge.
 *
 * Runs in front of every request Cloudflare Pages serves. Almost all of them
 * are free and cost one list lookup; only a premium path pays for a round trip
 * to Supabase, and only a premium path can be refused.
 *
 * WHO DECIDES WHAT "PREMIUM" MEANS
 *
 * Entitlement is `plan = 'premium' and (plan_until is null or plan_until >
 * now())`, and lib/entitlement.js is this runtime's copy of that sentence —
 * see the note there on why three copies exist and what keeps them in step.
 * The browser's auIsPremium() knows the same rule, but only so it can dress
 * the nav: it is never asked here, because a rule evaluated in a browser is a
 * rule the reader can edit.
 *
 * WHO DECIDES WHOSE TOKEN THIS IS
 *
 * Also not this file. There is no JWT verification below, deliberately: the
 * access token is forwarded to Supabase and row level security answers for its
 * own row. A forged or expired token gets a 401 from the people who issued it,
 * which is a stronger check than signature validation written here would be,
 * and there is no key material at the edge to get wrong.
 *
 * FAILING CLOSED
 *
 * If Supabase is unreachable, or the row does not say premium, the request is
 * refused. A paywall that opens when its dependency is down is not a paywall.
 * The cost is that an outage locks out paying readers, which is the right way
 * round: it is visible, temporary, and cannot be exploited. What it must not
 * do is treat OUR OWN missing deployment step as an outage, which is what the
 * database-function version did — see lib/entitlement.js.
 */
import { premiumReason, PAYWALL_ENABLED } from './lib/premium.js';
import { adminReason, isAdminUser } from './lib/admin.js';
import { isPremiumProfile } from './lib/entitlement.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ACCESS_COOKIE, REFRESH_COOKIE } from './lib/supabase.js';

/* Cookies, parsed from the header rather than from anything clever. Values are
   not decoded: a JWT is already URL-safe, and decoding would only widen what a
   crafted cookie could turn into. */
function readCookie(header, name) {
    if (!header) return null;
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        if (part.slice(0, eq).trim() !== name) continue;
        const v = part.slice(eq + 1).trim();
        return v || null;
    }
    return null;
}

/* Why this request is not getting through, not merely that it is not.
 *
 *   premium    the only one that opens anything
 *   free       asked, answered, not entitled
 *   noprofile  signed in, but there is no profiles row — the trigger that
 *              creates one did not run for this user
 *   stale      401/403, so the token is expired or rejected; premium.html can
 *              fix that by refreshing and sending them back
 *   down       anything else, including no answer at all
 *
 * This reads the row rather than calling a database function, and the reason
 * is written up in lib/entitlement.js: the function had to be created by hand,
 * it had not been, and failing closed on it locked out the account that had
 * just been granted premium.
 *
 * No user id is sent and none is needed. Row-level security scopes the select
 * to the caller's own row, so there is no identifier here for anyone to swap
 * for somebody else's — which is exactly the hole that made is_premium(uuid)
 * unsafe to call from the edge in the first place.
 */
async function entitlement(token) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=plan,plan_until&limit=1`, {
        headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${token}`,
            Accept: 'application/json'
        }
    });
    if (res.status === 401 || res.status === 403) return 'stale';
    if (!res.ok) return 'down';

    let rows = null;
    try { rows = await res.json(); } catch { return 'down'; }
    if (!Array.isArray(rows)) return 'down';
    if (!rows.length) return 'noprofile';
    return isPremiumProfile(rows[0], Date.now()) ? 'premium' : 'free';
}

/* Whose token this is, according to the people who issued it.
 *
 * The premium gate never needs to know: row level security answers for the
 * caller's own row, so no identity has to cross this file. The admin gate does
 * need to know, and the tempting shortcut — base64-decode the JWT and read
 * `sub` — is exactly the hole that makes it worthless. A JWT is only an
 * assertion until something checks the signature, and anyone can write one
 * claiming to be an id on the allowlist. So the token goes to Supabase and
 * Supabase says who it belongs to, or rejects it.
 *
 * DELIBERATELY NOT CACHED, unlike the entitlement verdict above. Two people
 * open this area, a handful of times, and each visit costs three round trips
 * instead of one. That is a rounding error against a cache of verified
 * identities, which is a thing worth getting wrong exactly once.
 */
async function verifiedUserId(token) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${token}`,
            Accept: 'application/json'
        }
    });
    // Supabase answers 403 with bad_jwt for a malformed or expired token, and
    // 401 for a missing one. Both mean "sign in again", neither means "no".
    if (res.status === 401 || res.status === 403) return { verdict: 'stale' };
    if (!res.ok) return { verdict: 'down' };

    let body = null;
    try { body = await res.json(); } catch { return { verdict: 'down' }; }
    const id = body && typeof body.id === 'string' ? body.id : null;
    return id ? { verdict: 'ok', id } : { verdict: 'down' };
}

/* An honest refusal.
 *
 * 403 and not 404. Pretending the page is not there would be obscurity rather
 * than access control, and it cannot work anyway: the repository is public, so
 * /admin.html is readable in the source tree regardless. What it WOULD achieve
 * is sending the two people the area exists for to debug a missing page when
 * their session has simply lapsed. */
function adminRefusal(reason) {
    if (reason === 'data') {
        return new Response('Not yours.\n', {
            status: 403,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store' }
        });
    }
    return new Response(
        '<!doctype html><meta charset="utf-8"><title>Restricted</title>'
        + '<meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<meta name="robots" content="noindex,nofollow">'
        + '<style>body{font:16px/1.6 system-ui,sans-serif;margin:12vh auto;max-width:34rem;padding:0 1.5rem;'
        + 'color:#100F0F;background:#EAEAE8}a{color:#065F46}@media(prefers-color-scheme:dark)'
        + '{body{color:#F2F2F0;background:#15191F}a{color:#00E57D}}</style>'
        + '<h1>Restricted</h1><p>This part of EasyFPL is not open to your account.</p>'
        + '<p><a href="/">Back to your dashboard</a></p>',
        {
            status: 403,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' }
        }
    );
}

/* The admin area: a verified identity on a short list, and nothing else.
 *
 * Note what is NOT consulted here — the plan. Admin is not the top tier of
 * premium, it is a different question, and wiring it to entitlement would mean
 * anyone who ever pays inherits it. */
async function adminGate(request, next, url, reason) {
    if (reason === 'unreadable') {
        return new Response('Bad request', { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }

    const cookies = request.headers.get('Cookie');
    const token = readCookie(cookies, ACCESS_COOKIE);
    const toLogin = () => new Response(null, {
        status: 302,
        headers: {
            Location: `/login.html?next=${encodeURIComponent(url.pathname + url.search)}`,
            'Cache-Control': 'private, no-store'
        }
    });

    /* No access token — lapsed, or never signed in on this browser. Both go to
       sign-in rather than to a refusal: the edge cannot run the refresh, and a
       reader who is about to become an admin one redirect from now should not
       be told they are not one. */
    if (!token) return toLogin();

    let who;
    try { who = await verifiedUserId(token); } catch { who = { verdict: 'down' }; }

    if (who.verdict === 'ok') {
        return isAdminUser(who.id) ? uncacheable(await next()) : adminRefusal(reason);
    }
    if (who.verdict === 'stale') return toLogin();
    return adminRefusal(reason);       // unreachable is not permission
}

/* One answer per token, briefly, and only when the answer was yes.
 *
 * Six of the gated paths are scripts on one page, so a premium reader was
 * paying for seven round trips to Supabase to open Squad Analysis. Caching the
 * verdict collapses that to one.
 *
 * Deliberately asymmetric. A cached "premium" costs at most a minute of access
 * after a downgrade, which nobody is harmed by. A cached "free" would be a
 * minute of an upgrade appearing not to work — and after the afternoon this
 * paywall has already cost, an upgrade has to take effect the moment it is
 * made. So no is never remembered.
 *
 * Keyed on a hash of the token, never the token: a cache key is not a secret
 * store, and anything that can enumerate keys should not thereby be able to
 * replay a session. */
const VERDICT_TTL = 60;

async function verdictKey(token) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    return new Request(`https://entitlement.easyfpl.invalid/${hex}`);
}

async function cachedEntitlement(token) {
    /* caches.default is present in production and absent in some local
       runtimes. Without it this is simply uncached, which is slower and
       equally correct — never a reason to skip the check. */
    const store = typeof caches !== 'undefined' && caches.default ? caches.default : null;
    if (!store) return entitlement(token);

    let key = null;
    try {
        key = await verdictKey(token);
        const hit = await store.match(key);
        if (hit) return 'premium';
    } catch { /* a cache that misbehaves must not decide anything */ }

    const verdict = await entitlement(token);
    if (verdict === 'premium' && key) {
        try {
            await store.put(key, new Response('premium', {
                headers: { 'Cache-Control': `max-age=${VERDICT_TTL}` }
            }));
        } catch { /* best effort; the next request just asks again */ }
    }
    return verdict;
}

/* A premium page that was allowed through must not sit in a shared cache,
   where the next reader to ask for it would be served the paid copy without
   ever reaching this code. Vary is belt to that braces. */
function uncacheable(res) {
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'private, no-store, must-revalidate');
    out.headers.set('Vary', 'Cookie');
    return out;
}

function refuse(reason, url, hasSession, verdict) {
    if (reason === 'unreadable') {
        return new Response('Bad request', { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }

    if (reason === 'script') {
        /* Never HTML. The browser asked for JavaScript and will try to parse
           whatever comes back as JavaScript, so an error page here is a syntax
           error in the console instead of a missing feature. An empty module
           leaves the feature's globals undefined, which is what the page is
           expected to cope with. */
        return new Response('/* EasyFPL Premium — this script is not part of the free plan. */\n', {
            status: 403,
            headers: {
                'Content-Type': 'application/javascript; charset=utf-8',
                'Cache-Control': 'private, no-store'
            }
        });
    }

    /* A page. Where it goes depends on what is missing — an account, or a
       plan — because "sign in" is useless advice to someone already signed in
       and "upgrade" is useless to someone who is not. */
    const where = url.pathname + url.search;
    const to = hasSession
        ? `/premium.html?from=${encodeURIComponent(where)}&why=${encodeURIComponent(verdict || 'free')}`
        : `/login.html?next=${encodeURIComponent(where)}`;
    return new Response(null, {
        status: 302,
        headers: { Location: to, 'Cache-Control': 'private, no-store' }
    });
}

/* One host, and it is the bare one.
 *
 * easyfpl.com and www.easyfpl.com both answered 200 with byte-identical HTML —
 * the entire site existed twice, with no redirect between the two and no
 * canonical tag on most pages to break the tie. Google had to guess which was
 * real, and whatever links the site earns were being split across both.
 *
 * 301 rather than 302: this is permanent, and a permanent redirect is the
 * signal that consolidates the two into one. Done here rather than in a
 * Cloudflare dashboard rule so it lives in the repo with everything else that
 * decides what a URL means — and so it is visible to whoever reads this file
 * next, which a dashboard setting is not.
 *
 * Query and hash are carried over; the path is untouched. */
function canonicalHost(url) {
    if (url.hostname !== 'www.easyfpl.com') return null;
    const to = new URL(url.toString());
    to.hostname = 'easyfpl.com';
    return new Response(null, {
        status: 301,
        headers: { Location: to.toString(), 'Cache-Control': 'public, max-age=3600' }
    });
}


/* ===== The soft 404, and the 2.5 GB it cost =====

   Cloudflare Pages answers an unmatched path with index.html and a 200. For a
   navigation that is a defensible SPA fallback. For an ASSET it is a trap, and
   on 19 September it ran away: one visitor in Poland produced 34,557 requests in
   an hour — forty times the whole site's normal traffic — for paths like

       /assets/fonts/scripts/scripts/scripts/.../notifications.js

   Every one of them returned 200 and the full 322 KB dashboard. Two site
   properties combined to make that possible:

     1. Every asset on every page is referenced RELATIVELY (`scripts/x.js`, not
        `/scripts/x.js`) — 270 of them. A document served at any path other than
        the one it was written for re-requests all of them one directory deeper.
     2. Those deeper paths do not exist, so each came back as another 200 and
        another copy of the page, which gave the next round something to resolve
        against.

   A `.js` request answered with an HTML document is never correct. Nothing can
   execute it, nothing can cache it usefully, and the only thing it can do is
   feed the next iteration. So this turns that case into a real 404 with an empty
   body: the loop has nothing to chew on and the 322 KB goes away.

   Navigations are deliberately untouched — /dashboard and /squad-analysis are
   200 rewrites that the product depends on (see _redirects), and deciding which
   HTML paths are real needs a file list this has no way to read.

   Cached at the edge for a day so a client stuck in a loop stops reaching the
   origin at all. */
const ASSET_EXT = /\.(?:js|mjs|css|json|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|txt|xml|webmanifest)$/i;

function looksLikeAsset(pathname) {
    return ASSET_EXT.test(pathname);
}

/* A response is the fallback page if it is HTML. A real asset never is — the
   static handler serves .js as JavaScript and .css as CSS — so the content type
   is enough, and it does not need a list of which files exist. */
function isHtml(res) {
    const t = res.headers.get('Content-Type') || '';
    return t.includes('text/html');
}

async function assetOrNotFound(next) {
    const res = await next();
    if (!isHtml(res)) return res;
    return new Response(null, {
        status: 404,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=86400',
            // Names the decision, so this is debuggable from a response header
            // rather than from a bandwidth bill.
            'X-EasyFPL-Reason': 'asset-path-not-found'
        }
    });
}

export async function onRequest(context) {
    const { request, next } = context;
    const url = new URL(request.url);

    const toApex = canonicalHost(url);
    if (toApex) return toApex;


    /* Admin first, and separately from premium. The two ask different
       questions — "is this account paid" against "is this account one of two
       people" — and the admin paths are not premium paths, so neither list can
       answer for the other. */
    const admin = adminReason(url.pathname);
    if (admin) return adminGate(request, next, url, admin);

    /* After the admin gate, and the order is load-bearing. Two of the paths
       adminReason() protects are .json — /data/model-accuracy.json and
       /data/model-log/* — so an asset check placed above it would hand the
       admin archive to anyone who asked. It goes here instead: past the gate,
       and still ahead of the entitlement lookup, which a missing file has no
       business paying for. */
    if (looksLikeAsset(url.pathname)) return assetOrNotFound(next);

    /* The paywall is off — see PAYWALL_ENABLED in lib/premium.js. The lists and
       the matcher are untouched and still tested; this is the one place that
       stops asking, so turning it back on is one word in that file. */
    const reason = PAYWALL_ENABLED ? premiumReason(url.pathname) : null;
    if (!reason) return next();          // the ordinary case, and it costs nothing

    const cookies = request.headers.get('Cookie');
    const token = readCookie(cookies, ACCESS_COOKIE);

    /* An access token lives about an hour and scripts/auth.js renews it in the
       browser. A navigation that arrives just after it lapsed carries a dead
       token, and refusing outright would bounce a paying reader off a page they
       are entitled to. Treating the refresh cookie as evidence of a session is
       what sends them to premium.html instead, which CAN renew — see the retry
       there. It is not evidence of entitlement, and is never used as such. */
    const hasSession = !!(token || readCookie(cookies, REFRESH_COOKIE));

    if (!token) return refuse(reason, url, hasSession);

    let verdict;
    try {
        verdict = await cachedEntitlement(token);
    } catch {
        verdict = 'down';                // unreachable is not permission
    }

    return verdict === 'premium'
        ? uncacheable(await next())
        : refuse(reason, url, hasSession, verdict);
}
