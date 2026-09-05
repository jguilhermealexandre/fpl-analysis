/* Web Push, on Web Crypto only.

   Two specifications, both implemented here rather than pulled in, because the
   dependency-free constraint that governs the site governs this too and the
   alternative is a Node-oriented library plus a bundler.

     RFC 8292 (VAPID)             — an ES256 JWT identifying the sender.
     RFC 8291 (Message Encryption) — aes128gcm, keyed by ECDH against the
                                     subscriber's public key.

   WARNING. Everything in this file either works completely or fails silently:
   a push service returns 201 Created for a correctly formed request whose
   payload the browser cannot decrypt, and the only symptom is a notification
   that never arrives. It cannot be verified without a live subscription and a
   real push service, so it has not been — see the README for the one-command
   check to run after deploying, and do that before trusting it. */

const b64urlToBytes = (s) => {
    const padded = (s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(padded);
    return Uint8Array.from(raw, c => c.charCodeAt(0));
};

const bytesToB64url = (bytes) => {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const concat = (...arrays) => {
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const a of arrays) { out.set(a, at); at += a.length; }
    return out;
};

const utf8 = (s) => new TextEncoder().encode(s);

async function hkdf(salt, ikm, info, length) {
    const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
    return new Uint8Array(bits);
}

/* The VAPID private key is distributed as a raw 32-byte scalar, which is what
   every generator emits and what Web Crypto refuses to import. Wrapping it as
   a JWK with the matching public coordinates is the standard way round it. */
async function importVapidKey(publicKeyB64, privateKeyB64) {
    const pub = b64urlToBytes(publicKeyB64);          // 65 bytes, uncompressed point
    const d = b64urlToBytes(privateKeyB64);           // 32-byte scalar
    return crypto.subtle.importKey('jwk', {
        kty: 'EC', crv: 'P-256',
        x: bytesToB64url(pub.slice(1, 33)),
        y: bytesToB64url(pub.slice(33, 65)),
        d: bytesToB64url(d),
        ext: true
    }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

async function vapidHeader(endpoint, publicKey, privateKey, subject) {
    const aud = new URL(endpoint).origin;
    const header = bytesToB64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const body = bytesToB64url(utf8(JSON.stringify({
        aud,
        // Twelve hours. The spec allows 24; shorter limits the damage if a
        // signed token ever leaks out of a log.
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: subject
    })));
    const signingInput = utf8(`${header}.${body}`);
    const key = await importVapidKey(publicKey, privateKey);
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, signingInput);
    return `vapid t=${header}.${body}.${bytesToB64url(sig)}, k=${publicKey}`;
}

/* aes128gcm, per RFC 8291 section 3.4.

   The body layout is salt(16) ‖ record size(4) ‖ key id length(1) ‖ the
   sender's public key(65) ‖ ciphertext, and the plaintext carries a single
   0x02 delimiter byte before encryption to mark the last record. */
async function encrypt(payload, p256dhB64, authB64) {
    const uaPublic = b64urlToBytes(p256dhB64);
    const authSecret = b64urlToBytes(authB64);

    const ephemeral = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));

    const uaKey = await crypto.subtle.importKey(
        'raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256));

    // The key-derivation info string binds the secret to both parties, which is
    // what stops a captured payload being replayed at a different subscriber.
    const prk = await hkdf(
        authSecret, shared,
        concat(utf8('WebPush: info\0'), uaPublic, asPublic),
        32);

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const cek = await hkdf(salt, prk, utf8('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, prk, utf8('Content-Encoding: nonce\0'), 12);

    const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
    const plaintext = concat(utf8(payload), new Uint8Array([0x02]));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce }, aesKey, plaintext));

    const recordSize = new Uint8Array(4);
    new DataView(recordSize.buffer).setUint32(0, 4096);

    return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/* Send one notification.

   Returns the push service's status rather than throwing on a rejection,
   because 404 and 410 are not errors — they are the service telling us this
   subscription is dead, which is information the caller needs in order to stop
   trying. Anything else is a transient failure and the subscription is kept. */
export async function sendPush(subscription, payload, vapid) {
    const body = await encrypt(
        typeof payload === 'string' ? payload : JSON.stringify(payload),
        subscription.keys.p256dh, subscription.keys.auth);

    const res = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
            'Authorization': await vapidHeader(
                subscription.endpoint, vapid.publicKey, vapid.privateKey, vapid.subject),
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            'TTL': '3600',
            // Nothing here is worth waking a phone that is asleep; these are
            // things to see next time it is picked up.
            'Urgency': 'normal'
        },
        body
    });

    return { status: res.status, gone: res.status === 404 || res.status === 410 };
}
