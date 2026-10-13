/* /unlock?k=… — the one place the admin key is exchanged for a cookie.
 *
 * WHY IT IS NOT UNDER /admin
 *
 * lib/admin.js denies by prefix: anything spelled /admin, /admin-* or
 * /admin/* is gated without being named, which is what stops an admin page
 * added next year being served to the world. An unlock endpoint inside that
 * prefix would have to be an exception to the rule, and the rule's whole value
 * is that it has none. So the door is outside the building.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not say whether a key was wrong, whether one was configured, or
 * whether this site has an admin area at all. Every outcome but success is the
 * same 403 — same body, same headers — because the only information a visitor
 * can get from this endpoint by guessing is the thing it exists to protect.
 *
 * It also does not accept the key in a header, a POST body or a path segment.
 * One way in, so there is one thing to reason about.
 */
import {
    usableKey, timingSafeEqual, signAdminToken, adminCookieHeader,
    clearedAdminCookieHeader, adminUiCookieHeader, clearedAdminUiCookieHeader,
    ADMIN_SESSION_MS
} from './lib/admin-key.js';

/* Two cookies, so two Set-Cookie headers — which an object literal cannot
   express, since its keys are unique. Headers.append can. */
function cookieHeaders(extra, ...cookies) {
    const h = new Headers(extra);
    for (const c of cookies) h.append('Set-Cookie', c);
    return h;
}

/* Identical for every refusal. Built fresh each time because a Response body
   can only be read once. */
const refuse = () => new Response(
    '<!doctype html><meta charset="utf-8"><title>Not found</title>'
    + '<meta name="robots" content="noindex,nofollow">'
    + '<style>body{font:16px/1.6 system-ui,sans-serif;margin:12vh auto;max-width:34rem;padding:0 1.5rem}</style>'
    + '<h1>Nothing here</h1><p>That did not work.</p>',
    {
        status: 403,
        /* A refused unlock must never leave a half-working cookie behind, and
           clearing on the way out means "it stopped working" is fixed by trying
           again rather than by clearing cookies by hand. Both cookies go: a
           stale hint would draw a link to a page that refuses. */
        headers: cookieHeaders(
            {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'private, no-store'
            },
            clearedAdminCookieHeader(), clearedAdminUiCookieHeader()
        )
    }
);

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    if (request.method !== 'GET') return refuse();

    /* Sign out: a deliberate, keyless way to drop the cookie. Listed before
       the key check so it works whether or not ADMIN_KEY is configured. */
    if (url.searchParams.get('out') === '1') {
        return new Response(null, {
            status: 302,
            headers: cookieHeaders(
                { Location: '/', 'Cache-Control': 'private, no-store' },
                clearedAdminCookieHeader(), clearedAdminUiCookieHeader()
            )
        });
    }

    const key = env && env.ADMIN_KEY;
    const given = url.searchParams.get('k');
    if (!usableKey(key) || typeof given !== 'string') return refuse();
    if (!timingSafeEqual(given, key)) return refuse();

    const token = await signAdminToken(key, Date.now() + ADMIN_SESSION_MS);
    if (!token) return refuse();

    /* 302 straight to the dashboard, and the key goes no further than this
       request: it is in the URL that was just typed and in nothing the browser
       keeps afterwards. The Location carries no query of its own, so the key
       cannot ride along in a Referer. */
    return new Response(null, {
        status: 302,
        headers: cookieHeaders(
            {
                Location: '/admin.html',
                'Cache-Control': 'private, no-store',
                'Referrer-Policy': 'no-referrer'
            },
            adminCookieHeader(token, ADMIN_SESSION_MS),
            adminUiCookieHeader(ADMIN_SESSION_MS)
        )
    });
}
