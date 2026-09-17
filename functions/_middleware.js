/* The paywall, at the edge.
 *
 * Runs in front of every request Cloudflare Pages serves. Almost all of them
 * are free and cost one list lookup; only a premium path pays for a round trip
 * to Supabase, and only a premium path can be refused.
 *
 * WHO DECIDES WHAT "PREMIUM" MEANS
 *
 * Not this file. Entitlement is `plan = 'premium' and (plan_until is null or
 * plan_until > now())`, and that sentence is written once, in
 * supabase/schema.sql, as public.is_premium(). This calls the is_premium_me()
 * wrapper over it and believes the boolean. The browser's auIsPremium() knows
 * the same rule, but only so it can dress the nav — it is never asked here,
 * because a rule evaluated in a browser is a rule the reader can edit.
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
 * If Supabase is unreachable, or answers anything but `true`, the request is
 * refused. A paywall that opens when its dependency is down is not a paywall.
 * The cost of that choice is that an outage locks out paying readers, which is
 * the right way round: it is visible, temporary, and cannot be exploited.
 */
import { premiumReason } from './lib/premium.js';
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

async function isPremium(token) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_premium_me`, {
        method: 'POST',
        headers: {
            apikey: SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: '{}'
    });
    if (!res.ok) return false;
    /* Strictly true. A PostgREST scalar comes back as bare JSON, and anything
       that is not the boolean true — null, a string, an error object shaped
       like a success — is not an entitlement. */
    return (await res.json()) === true;
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

function refuse(reason, url, hasSession) {
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
        ? `/premium.html?from=${encodeURIComponent(where)}`
        : `/login.html?next=${encodeURIComponent(where)}`;
    return new Response(null, {
        status: 302,
        headers: { Location: to, 'Cache-Control': 'private, no-store' }
    });
}

export async function onRequest(context) {
    const { request, next } = context;
    const url = new URL(request.url);

    const reason = premiumReason(url.pathname);
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

    let allowed = false;
    try {
        allowed = await isPremium(token);
    } catch (e) {
        allowed = false;                 // unreachable is not permission
    }

    return allowed ? uncacheable(await next()) : refuse(reason, url, hasSession);
}
