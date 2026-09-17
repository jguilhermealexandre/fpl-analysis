/* ============================================
   EasyFPL — accounts.

   Supabase owns the part that would be dangerous to own: the email, the bcrypt
   hash, the confirmation and reset tokens. This file is the client half — it
   posts credentials to them, keeps the session they hand back, and hands the
   access token to the edge so the paywall can read it.

   NO SDK, ON PURPOSE. The site has no bundler and 333 inline onclick handlers;
   dropping a hundred kilobytes of @supabase/supabase-js onto every page from a
   CDN to make six HTTPS calls would be the largest dependency here by a wide
   margin. The auth endpoints are plain REST and are called as such.

   COOKIES, NOT LOCALSTORAGE. This is the part that is easy to get wrong and
   expensive to change later. The paywall runs in a Cloudflare Pages Function at
   the edge, and a Function cannot read localStorage — it only ever sees the
   request. So the session has to travel on the request, which means a cookie.
   Storing it in localStorage would work perfectly for the browser and leave the
   gate unable to tell a subscriber from a stranger.

   Two cookies rather than one:

     easyfpl_at   the access token. Short-lived, sent on every request, and the
                  only one the edge reads.
     easyfpl_rt   the refresh token. Longer-lived, used by this file alone.

   Split because a cookie is capped near 4KB and both tokens plus JSON plus
   encoding gets uncomfortably close to it; and because the middleware should
   parse one value with one meaning rather than pick a field out of a blob.

   NOT HttpOnly, and that is a judgement rather than an oversight. The browser
   has to put the access token in an Authorization header to talk to Supabase at
   all, so script must be able to read it. HttpOnly would also buy less here than
   it looks: this site's CSP carries 'unsafe-inline' because of those 333
   handlers, so script injected into a page could simply make the authenticated
   calls itself rather than bothering to steal anything. The honest defence is
   short token lifetimes and the same-site flag below.

   Prefix au*.
   ============================================ */

const AU_URL = 'https://qlipcnedxchcsbpihscp.supabase.co';

/* Publishable, and meant to be here. It identifies the project and nothing
   else: every table it can reach is behind row-level security, and profiles
   revokes it entirely — an anonymous caller asking for that table gets
   "permission denied", which is the first thing this key was checked against.
   The SECRET key is a different object and must never appear in this repo. */
const AU_KEY = 'sb_publishable_RDHHDWaiUEJ3Gf8LOcvevg_VazVsHDu';

const AU_AT = 'easyfpl_at';
const AU_RT = 'easyfpl_rt';

/* Refresh this long before the token actually expires. Sixty seconds covers a
   slow request and a clock that disagrees with Supabase's by a little; without
   a margin, a token that passes the check here can still be expired by the time
   it arrives. */
const AU_SKEW_MS = 60_000;

// ----------------------------------------------------------------- cookies

/* One cookie out of a document.cookie string.
 *
 * Split on '; ' rather than ',' — a cookie VALUE may contain a comma, and the
 * header joins pairs with a semicolon. Returns null rather than '' for absent,
 * so "present but empty" stays distinguishable from "not there".
 */
function auReadCookie(jar, name) {
    if (typeof jar !== 'string' || !jar || !name) return null;
    for (const part of jar.split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        if (part.slice(0, eq).trim() !== name) continue;
        const raw = part.slice(eq + 1).trim();
        try { return decodeURIComponent(raw); } catch { return raw; }
    }
    return null;
}

/* The Set-Cookie value for one token.
 *
 * SameSite=Lax rather than Strict: a confirmation or reset link arrives by
 * email, and Strict would drop the cookie on that first navigation from the
 * mail client, so the reader would land signed out on the page that just
 * confirmed them.
 *
 * Secure only on https, so the file:// and localhost cases a developer uses are
 * not silently broken by a cookie the browser refuses to set.
 */
function auCookieString(name, value, maxAgeSeconds, isHttps) {
    const bits = [
        `${name}=${encodeURIComponent(value)}`,
        'Path=/',
        'SameSite=Lax',
        `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
    ];
    if (isHttps) bits.push('Secure');
    return bits.join('; ');
}

// ----------------------------------------------------------------- session

/* Is this session good for another request?
 *
 * `at` is the moment of expiry in milliseconds. Anything missing is not a
 * session — an absent expiry is treated as expired rather than as forever,
 * because the failure that matters is believing a dead token is alive.
 */
function auIsFresh(session, now) {
    if (!session || !session.accessToken || !session.expiresAt) return false;
    const t = typeof now === 'number' ? now : Date.now();
    return session.expiresAt - AU_SKEW_MS > t;
}

/* What Supabase returns, reduced to what is stored.
 *
 * expires_in is seconds from now; expires_at, when present, is unix seconds.
 * Prefer the absolute one — it does not drift if the response sat in a queue —
 * and fall back to computing it.
 */
function auSessionFrom(body, now) {
    if (!body || !body.access_token) return null;
    const t = typeof now === 'number' ? now : Date.now();
    const expiresAt = body.expires_at
        ? body.expires_at * 1000
        : t + (Number(body.expires_in) || 3600) * 1000;
    return {
        accessToken: body.access_token,
        refreshToken: body.refresh_token || null,
        expiresAt,
        userId: (body.user && body.user.id) || null,
        email: (body.user && body.user.email) || null
    };
}

function auLoadSession() {
    if (typeof document === 'undefined') return null;
    const at = auReadCookie(document.cookie, AU_AT);
    if (!at) return null;
    const claims = auDecodeClaims(at);
    if (!claims) return null;
    return {
        accessToken: at,
        refreshToken: auReadCookie(document.cookie, AU_RT),
        expiresAt: (claims.exp || 0) * 1000,
        userId: claims.sub || null,
        email: claims.email || null
    };
}

function auSaveSession(session) {
    if (typeof document === 'undefined' || !session) return;
    const https = typeof location === 'undefined' || location.protocol === 'https:';
    const ttl = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000));
    document.cookie = auCookieString(AU_AT, session.accessToken, ttl, https);
    if (session.refreshToken) {
        // Thirty days. The refresh token is what keeps someone signed in across
        // visits; the access token above is deliberately short.
        document.cookie = auCookieString(AU_RT, session.refreshToken, 30 * 86400, https);
    }
}

function auClearSession() {
    if (typeof document === 'undefined') return;
    const https = typeof location === 'undefined' || location.protocol === 'https:';
    document.cookie = auCookieString(AU_AT, '', 0, https);
    document.cookie = auCookieString(AU_RT, '', 0, https);
}

/* The claims out of a JWT, WITHOUT verifying it.
 *
 * Read this carefully: nothing here is trusted. The browser uses these claims
 * to decide what to draw — a name in the corner, which nav rows to show — and
 * drawing the wrong thing is a cosmetic fault. Every decision that matters is
 * made at the edge, where the signature is actually checked against Supabase's
 * public key. A forged token gets you a misleading menu and a 403.
 */
function auDecodeClaims(token) {
    try {
        const part = String(token).split('.')[1];
        if (!part) return null;
        const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
        const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
        const json = decodeURIComponent(
            atob(pad).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
        );
        return JSON.parse(json);
    } catch {
        return null;
    }
}

// -------------------------------------------------------------------- calls

async function auPost(path, body, token) {
    const res = await fetch(`${AU_URL}/auth/v1/${path}`, {
        method: 'POST',
        headers: {
            'apikey': AU_KEY,
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body || {})
    });
    let data = null;
    try { data = await res.json(); } catch { /* 204s and empty bodies */ }
    return { ok: res.ok, status: res.status, data };
}

/* Everything below returns { ok, error } rather than throwing, because every
   caller is a form that has to put a sentence in front of someone. */

async function auSignUp(email, password) {
    const r = await auPost('signup', {
        email,
        password,
        options: { emailRedirectTo: auRedirectTo('/signed-in.html') }
    });
    if (!r.ok) return { ok: false, error: auMessage(r) };

    /* With confirmations on — which this project has — signup returns a user and
       no session. Nobody is signed in until they click the link.

       And it returns the same thing for an address that already has an account,
       with one difference: `identities` comes back empty. That is Supabase
       refusing to confirm or deny, and it is the right behaviour — a signup form
       that says "already registered" will tell a stranger which addresses out of
       a list belong to your users.

       So this reads the signal to know what happened, and says the same sentence
       either way. The cost is a reader who forgot they had an account waiting for
       an email that is not coming, which is why the wording points at signing in
       as well. */
    const already = !!(r.data && r.data.user
        && Array.isArray(r.data.user.identities) && r.data.user.identities.length === 0);

    const session = auSessionFrom(r.data, Date.now());
    if (session) auSaveSession(session);
    return { ok: true, needsConfirmation: !session, already, email };
}

async function auSignIn(email, password) {
    const r = await auPost('token?grant_type=password', { email, password });
    if (!r.ok) return { ok: false, error: auMessage(r) };
    const session = auSessionFrom(r.data, Date.now());
    if (!session) return { ok: false, error: 'That did not return a session. Try again.' };
    auSaveSession(session);
    return { ok: true, session };
}

async function auResetPassword(email) {
    const r = await auPost('recover', {
        email,
        options: { redirectTo: auRedirectTo('/reset-password.html') }
    });
    /* Deliberately the same answer either way. Supabase does not reveal whether
       an address has an account, and neither does this — telling a stranger
       which of a list of emails is registered here is the classic way a sign-up
       form leaks its user list. */
    return { ok: true, sent: true, hadError: !r.ok };
}

async function auSignOut() {
    const s = auLoadSession();
    if (s) await auPost('logout', {}, s.accessToken);
    auClearSession();
    return { ok: true };
}

/* Trade the refresh token for a new access token. Returns null when the refresh
   token is gone or refused, and clears the session in that case: a session that
   cannot be refreshed is over, and leaving the dead cookie in place would make
   every later call fail in a way nobody can explain. */
async function auRefresh() {
    const s = auLoadSession();
    if (!s || !s.refreshToken) return null;
    const r = await auPost('token?grant_type=refresh_token', { refresh_token: s.refreshToken });
    if (!r.ok) { auClearSession(); return null; }
    const next = auSessionFrom(r.data, Date.now());
    if (!next) { auClearSession(); return null; }
    auSaveSession(next);
    return next;
}

/* The session a caller should use, refreshed if it is about to lapse. */
async function auSession() {
    const s = auLoadSession();
    if (auIsFresh(s, Date.now())) return s;
    return auRefresh();
}

function auRedirectTo(path) {
    if (typeof location === 'undefined') return path;
    return location.origin + path;
}

/* Supabase's error bodies are not one shape. Pull out something a person can
   read, and never surface a raw status code to a reader. */
function auMessage(r) {
    const d = r && r.data;
    const raw = (d && (d.msg || d.message || d.error_description || d.error)) || '';
    /* Reached only when Supabase is configured to answer plainly rather than to
       obfuscate. Kept deliberately vague anyway, so the form cannot be used to
       test whether an address is registered here. */
    if (/already registered|already been registered/i.test(raw)) {
        return 'If that address is new, check your email. If it already has an account, sign in instead.';
    }
    if (/invalid login credentials/i.test(raw)) {
        return 'That email and password do not match.';
    }
    if (/email not confirmed/i.test(raw)) {
        return 'Check your email and click the link before signing in.';
    }
    /* Passed through rather than flattened. Supabase answers "Password should
       be at least 12 characters." and the number is the useful part — the rule
       lives in the project's settings, so restating it here would be a second
       copy that drifts the day it is changed. */
    if (/password should be at least/i.test(raw)) return raw;
    if (r && r.status === 429) {
        return 'Too many attempts. Wait a minute and try again.';
    }
    return raw || 'Something went wrong. Try again.';
}
