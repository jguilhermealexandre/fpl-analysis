/* Web Push encryption and VAPID.

   This is the code with the worst failure mode on the site. A push service
   returns 201 Created for a correctly formed request whose payload the browser
   cannot decrypt, so getting it wrong produces no error anywhere — just a
   notification that never arrives, indistinguishable from having nothing to
   say. Nothing else here fails that quietly.

   The first test is the one that matters. It runs the implementation against
   RFC 8291's own worked example — the specification's keys, the specification's
   salt, and a byte-for-byte comparison against the body the specification says
   must come out. A round trip against itself would not do: two halves written
   from the same misreading agree perfectly with each other and with nothing
   else in the world.

   Node 20 has the same Web Crypto the Worker runs on, so this exercises the
   real thing rather than a port of it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, hkdf, vapidHeader, b64urlToBytes, bytesToB64url } from '../workers/push/src/webpush.js';

/* RFC 8291 section 5, verbatim. */
const RFC = {
    plaintext: 'When I grow up, I want to be a watermelon',
    uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
    asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
    asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
    body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml'
        + 'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT'
        + 'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
};

// A P-256 pair from the raw public point plus the private scalar, which is how
// both the RFC and every VAPID generator distribute keys.
async function importPair(publicB64, privateB64, usages) {
    const pub = b64urlToBytes(publicB64);
    const jwk = {
        kty: 'EC', crv: 'P-256',
        x: bytesToB64url(pub.slice(1, 33)),
        y: bytesToB64url(pub.slice(33, 65)),
        d: privateB64, ext: true
    };
    return {
        privateKey: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, usages),
        publicKey: await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
    };
}

test('it reproduces the RFC 8291 worked example byte for byte', async () => {
    /* The whole point of this file. Same keys, same salt, same plaintext as the
       specification — so the output either equals what the specification says
       or the implementation is wrong, with no room for a shared misreading. */
    const ephemeral = await importPair(RFC.asPublic, RFC.asPrivate, ['deriveBits']);
    const body = await encrypt(RFC.plaintext, RFC.uaPublic, RFC.authSecret, {
        ephemeral, salt: b64urlToBytes(RFC.salt)
    });
    assert.equal(bytesToB64url(body), RFC.body);
});

test('the body is laid out the way a receiver expects to read it', async () => {
    // salt(16) ‖ record size(4) ‖ key id length(1) ‖ sender public key(65).
    // A receiver parses these by offset, so a wrong length here is unreadable
    // even when every key is right.
    const ephemeral = await importPair(RFC.asPublic, RFC.asPrivate, ['deriveBits']);
    const body = await encrypt(RFC.plaintext, RFC.uaPublic, RFC.authSecret, {
        ephemeral, salt: b64urlToBytes(RFC.salt)
    });
    assert.deepEqual([...body.slice(0, 16)], [...b64urlToBytes(RFC.salt)], 'salt leads');
    assert.equal(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096, 'record size');
    assert.equal(body[20], 65, 'an uncompressed P-256 point is 65 bytes');
    assert.deepEqual([...body.slice(21, 86)], [...b64urlToBytes(RFC.asPublic)], 'then the sender key');
});

test('a browser could actually decrypt it', async () => {
    /* The receiver half, written from the specification rather than by reusing
       the sender's steps in reverse. Uses a fresh random salt and a fresh
       ephemeral key, so it covers the production path that the fixed-vector
       test deliberately does not. */
    const ua = await importPair(RFC.uaPublic, RFC.uaPrivate, ['deriveBits']);
    const message = JSON.stringify({ title: 'News on your squad', body: 'Saka is doubtful' });
    const body = await encrypt(message, RFC.uaPublic, RFC.authSecret);

    const salt = body.slice(0, 16);
    const idLen = body[20];
    const asPublic = body.slice(21, 21 + idLen);
    const ciphertext = body.slice(21 + idLen);

    const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));

    const enc = new TextEncoder();
    const cat = (...a) => {
        const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0));
        let at = 0; for (const x of a) { out.set(x, at); at += x.length; }
        return out;
    };
    const prk = await hkdf(b64urlToBytes(RFC.authSecret), shared,
        cat(enc.encode('WebPush: info\0'), b64urlToBytes(RFC.uaPublic), asPublic), 32);
    const cek = await hkdf(salt, prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
    const nonce = await hkdf(salt, prk, enc.encode('Content-Encoding: nonce\0'), 12);

    const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext));

    assert.equal(plain[plain.length - 1], 0x02, 'the last record is delimited');
    assert.equal(new TextDecoder().decode(plain.slice(0, -1)), message);
});

test('every message uses a fresh salt and a fresh key', async () => {
    /* Reusing either would let two payloads be XORed against each other, and
       nothing about the output would look wrong. */
    const a = await encrypt('same text', RFC.uaPublic, RFC.authSecret);
    const b = await encrypt('same text', RFC.uaPublic, RFC.authSecret);
    assert.notDeepEqual([...a.slice(0, 16)], [...b.slice(0, 16)], 'different salt');
    assert.notDeepEqual([...a.slice(21, 86)], [...b.slice(21, 86)], 'different ephemeral key');
    assert.notDeepEqual([...a], [...b], 'and so a different body');
});

/* ===== VAPID ===== */

test('the VAPID header is a JWT this key actually signed', async () => {
    /* An unverifiable signature is rejected by the push service with a 401 and
       no payload is ever delivered — a loud failure rather than a silent one,
       but only once it is in front of a real service. Checking it here means
       importVapidKey building the wrong JWK is caught at commit time. */
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicKey = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;

    const header = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc123',
        publicKey, privateKey, 'mailto:hello@easyfpl.com');

    assert.match(header, /^vapid t=/, 'the scheme the spec requires');
    const [, token] = /t=([^,]+)/.exec(header);
    const [h, b, sig] = token.split('.');

    const verifier = await crypto.subtle.importKey('raw', b64urlToBytes(publicKey),
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier,
        b64urlToBytes(sig), new TextEncoder().encode(`${h}.${b}`));
    assert.equal(ok, true, 'the signature verifies against the key it advertises');

    assert.deepEqual(JSON.parse(new TextDecoder().decode(b64urlToBytes(h))), { typ: 'JWT', alg: 'ES256' });
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(b)));
    assert.equal(claims.aud, 'https://fcm.googleapis.com', 'audience is the origin, not the full endpoint');
    assert.equal(claims.sub, 'mailto:hello@easyfpl.com');
    const hours = (claims.exp - Math.floor(Date.now() / 1000)) / 3600;
    assert.ok(hours > 0 && hours <= 24, `expiry inside the 24h the spec allows, got ${hours.toFixed(1)}h`);
});

test('the advertised key is the one that signed', async () => {
    // k= and the signature come from different places in the code; if they ever
    // disagree the push service rejects everything with a 401.
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicKey = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;
    const header = await vapidHeader('https://push.example/x', publicKey, privateKey, 'mailto:a@b.c');
    assert.match(header, new RegExp(`k=${publicKey.replace(/[-]/g, '\\-')}$`));
});

test('the audience is per push service, not per endpoint', async () => {
    // Two endpoints on one service must produce the same aud, or a token cannot
    // be reasoned about at all.
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicKey = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;
    const aud = async (url) => {
        const h = await vapidHeader(url, publicKey, privateKey, 'mailto:a@b.c');
        const b = /t=[^.]+\.([^.]+)\./.exec(h)[1];
        return JSON.parse(new TextDecoder().decode(b64urlToBytes(b))).aud;
    };
    assert.equal(await aud('https://push.example/one'), await aud('https://push.example/two'));
    assert.notEqual(await aud('https://push.example/one'), await aud('https://other.example/one'));
});

test('the README key generation produces keys this code can import', async () => {
    /* The setup instructions and the importer are written in different places
       and can drift. A key pair that generates cleanly and then cannot be used
       to sign is the kind of thing only discovered mid-deploy. */
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const publicKey = bytesToB64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    const privateKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d;

    assert.equal(b64urlToBytes(publicKey).length, 65, 'uncompressed P-256 point');
    assert.equal(b64urlToBytes(publicKey)[0], 0x04, 'and tagged as uncompressed');
    assert.equal(b64urlToBytes(privateKey).length, 32, 'a 32-byte scalar');

    const header = await vapidHeader('https://push.example/x', publicKey, privateKey, 'mailto:a@b.c');
    assert.match(header, /^vapid t=.+\..+\..+, k=.+$/);
});

test('base64url survives a round trip on every byte value', async () => {
    // Padding and the -/_ substitutions are where hand-rolled base64 goes wrong,
    // and a key that decodes to the wrong bytes fails silently.
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    for (let len = 0; len <= 8; len++) {
        const slice = all.slice(0, len);
        assert.deepEqual([...b64urlToBytes(bytesToB64url(slice))], [...slice], `length ${len}`);
    }
    assert.deepEqual([...b64urlToBytes(bytesToB64url(all))], [...all]);
    assert.doesNotMatch(bytesToB64url(all), /[+/=]/, 'url-safe alphabet, no padding');
});
