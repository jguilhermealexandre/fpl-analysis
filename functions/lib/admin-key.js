/* A way into the admin area that does not need an account.
 *
 * WHY THIS EXISTS, WHEN lib/admin.js ALREADY ANSWERS "WHO"
 *
 * It answers it against a Supabase user id, and this site has no way to become
 * a Supabase user. login.html and register.html are still served, but nothing
 * in the product links to them and welcome.html — the page every "Log in"
 * button leads to — says it plainly: "There is no account and no password: a
 * Team ID identifies a page anyone can already see." A gate that requires a
 * session is therefore a gate nobody can pass, including the person it was
 * built for. That is what happened.
 *
 * So the second key is a key. One secret, held in a Cloudflare environment
 * variable called ADMIN_KEY, exchanged once at /unlock for a signed cookie.
 * The id list stays and still works; this is an additional door, not a
 * replacement, and either one opening is enough.
 *
 * WHY A SIGNED COOKIE RATHER THAN THE KEY IN THE COOKIE
 *
 * A cookie holding the key would hand the secret to anything that can read
 * cookies, and would have to be compared against the env var on every request
 * to every gated path. The cookie here carries an expiry and an HMAC of that
 * expiry under the key, so verifying it is one hash and no secret ever leaves
 * the worker. It cannot be extended by its holder — the expiry is inside the
 * signature — and rotating ADMIN_KEY invalidates every cookie ever issued.
 *
 * WHAT IT IS NOT
 *
 * Not secrecy about the admin area's existence: the repository is public and
 * /admin.html is readable in it, as lib/admin.js already says at length. And
 * not a password system — there is one secret, it does not expire, and it is
 * as strong as whatever was pasted into Cloudflare. For a two-page internal
 * dashboard that is the right amount of machinery. If it ever needs to be more
 * than that, Cloudflare Access is the thing to reach for, not this file.
 *
 * FAIL CLOSED, ALWAYS. Every refusal path below returns false. An unset
 * ADMIN_KEY does not mean "no check to run": it means nobody gets in this way,
 * because the alternative is a deploy where a missing variable silently opens
 * the dashboard to the internet. lib/entitlement.js has the story of the last
 * time an unset variable decided an access question.
 */

export const ADMIN_COOKIE = 'easyfpl_admin';

/* Thirty days. Long enough that this is not a weekly chore, short enough that
   a cookie left on a borrowed laptop stops working. */
export const ADMIN_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

/* A key shorter than this is a typo or a placeholder, not a secret, and
   treating it as one would make a one-character ADMIN_KEY look like security. */
const MIN_KEY_LENGTH = 24;

const enc = new TextEncoder();

/* Compare without leaking where the difference is.
 *
 * The length check is deliberately NOT constant time — the length of a secret
 * is not the secret, and padding to hide it would mean comparing a guess
 * against a transformation of the key rather than against the key. Everything
 * after it runs over every byte regardless of what it finds. */
export function timingSafeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export function usableKey(key) {
    return typeof key === 'string' && key.length >= MIN_KEY_LENGTH;
}

const b64url = (bytes) => {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function hmac(key, message) {
    const k = await crypto.subtle.importKey(
        'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message))));
}

/* The signed payload. The expiry is INSIDE it, which is what stops a holder
   editing their own cookie into a permanent one. */
const payload = (expiresAt) => `admin|${expiresAt}`;

export async function signAdminToken(key, expiresAt) {
    if (!usableKey(key)) return null;
    if (!Number.isFinite(expiresAt)) return null;
    const exp = Math.floor(expiresAt);
    return `${exp}.${await hmac(key, payload(exp))}`;
}

/* True only for a token this key signed, for an expiry still in the future.
 *
 * Everything else is false and nothing throws: this runs on the edge against
 * whatever a stranger put in a Cookie header. */
export async function verifyAdminToken(key, token, now) {
    if (!usableKey(key)) return false;                 // fail closed
    if (typeof token !== 'string' || token.length > 512) return false;

    const dot = token.indexOf('.');
    if (dot <= 0 || dot === token.length - 1) return false;

    const expText = token.slice(0, dot);
    if (!/^\d{1,15}$/.test(expText)) return false;     // no signs, no exponents, no padding

    const expiresAt = Number(expText);
    const at = Number.isFinite(now) ? now : Date.now();
    if (!(expiresAt > at)) return false;               // expired, or exactly now

    /* Signature compared last, so an expired cookie costs no hash at all —
       and the expiry it is compared against is the one from the token, so a
       tampered expiry produces a signature that cannot match. */
    const want = await hmac(key, payload(expiresAt));
    return timingSafeEqual(token.slice(dot + 1), want);
}

/* Set-Cookie for a fresh session. HttpOnly so no script can read it, Secure so
   it never travels in clear, SameSite=Strict because the only navigation that
   should carry it is one from this site — a cross-site link into /admin.html
   has no business arriving authenticated. */
export function adminCookieHeader(token, maxAgeMs) {
    return `${ADMIN_COOKIE}=${token}; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}; `
        + 'HttpOnly; Secure; SameSite=Strict';
}

export function clearedAdminCookieHeader() {
    return `${ADMIN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

/* A hint for the sidebar, and nothing else.
 *
 * The cookie above is HttpOnly on purpose, which means the browser cannot see
 * it — so scripts/sidebar-nav.js has no way to know whether to draw the Admin
 * link, and an unlocked admin would get a sidebar without one. This second
 * cookie exists to be read: it holds no key, no signature and no claim. Anyone
 * can set it by hand and the only thing they gain is a link that is refused one
 * click later, exactly as typing /admin.html already is.
 *
 * It is deliberately NOT HttpOnly, and that is the whole point of it; if it
 * ever starts carrying something worth protecting, it has become the wrong
 * mechanism. Lax rather than Strict so the link is drawn when arriving from
 * outside the site too — being cosmetic, it has nothing to leak. */
export const ADMIN_UI_COOKIE = 'easyfpl_admin_ui';

export function adminUiCookieHeader(maxAgeMs) {
    return `${ADMIN_UI_COOKIE}=1; Path=/; Max-Age=${Math.floor(maxAgeMs / 1000)}; Secure; SameSite=Lax`;
}

export function clearedAdminUiCookieHeader() {
    return `${ADMIN_UI_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
}
