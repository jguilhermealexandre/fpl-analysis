/* The one card on the page that reloads itself on every click.
 *
 * A player photo and a club badge each render an <img> that removes itself if
 * the request fails, uncovering the initials or the club's short name. That is
 * the right picture — but it is arrived at by a failed round trip, and a 404
 * is not cached the way a 200 is. So on a page that re-renders on every click,
 * the one player the photo library has never heard of blinks every single
 * time: his face goes empty, the requests fail again, the initials come back,
 * while everyone else is served from cache and never moves.
 *
 * Measured on the GW Draft with every image failing, that was 38 requests per
 * re-render, for ever. Remembering the failures for the page load takes it to
 * nought after the first.
 *
 * These tests hold the mechanism in place: a memo consulted before the <img>
 * is written, and an onerror that fills it. They are read out of the shipped
 * source rather than restated, so a rewrite that drops either half fails here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'scripts/common.js'), 'utf8');

function lift(name) {
    const open = src.indexOf(`function ${name}(`);
    assert.ok(open > -1, `${name} not found in common.js`);
    let depth = 0, i = src.indexOf('{', open);
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) break;
    }
    return src.slice(open, i + 1);
}

test('a player photo is not written again once both URLs have failed', () => {
    const body = lift('playerPhotoHTML');
    assert.match(body, /PLAYER_PHOTO_MISSING\.has\(/,
        'playerPhotoHTML must check the memo before emitting an <img>');
    assert.match(body, /playerPhotoMissing\(/,
        'the final onerror must record the failure, or the memo never fills');
    // The check has to come before the <img> is built, not after.
    assert.ok(body.indexOf('PLAYER_PHOTO_MISSING.has(') < body.indexOf('<img'),
        'the memo is consulted after the <img> is written — which does nothing');
});

test('a club badge is not written again once it has failed', () => {
    const body = lift('v2CrestHTML');
    assert.match(body, /CREST_MISSING\.has\(/,
        'v2CrestHTML must check the memo before emitting an <img>');
    assert.match(body, /crestMissing\(/,
        'the onerror must record the failure');
});

test('the memos are per page load, not persisted', () => {
    /* A photo that is missing today can be published tomorrow, so writing one
       off in localStorage would hide a face that had come back. The Set is
       deliberately in module scope and nowhere else. */
    for (const name of ['PLAYER_PHOTO_MISSING', 'CREST_MISSING']) {
        const decl = new RegExp(`const ${name} = new Set\\(\\);`);
        assert.match(src, decl, `${name} should be a plain module-scope Set`);
        const persisted = new RegExp(`(localStorage|sessionStorage)[^\\n]*${name}`);
        assert.doesNotMatch(src, persisted, `${name} must not be persisted across visits`);
    }
});

test('neither image is lazy', () => {
    /* A lazy <img> that is re-created starts unloaded however warm the cache
       is: the browser re-runs its in-viewport check before it will look at the
       bytes. On a 30px avatar that is all cost and no saving, and it is the
       other half of the same flicker — see the note in playerPhotoHTML. */
    for (const name of ['playerPhotoHTML', 'v2CrestHTML']) {
        /* The emitted markup only. Both functions carry notes that mention an
           <img> and the word "lazy" — reading the whole body would be testing
           the prose, which is how this assertion failed the first time. */
        const body = lift(name);
        const markup = body.slice(body.search(/<img\b[^>]*\bsrc=/));
        assert.ok(markup.startsWith('<img'), `could not find the <img> ${name} emits`);
        assert.doesNotMatch(markup, /loading="lazy"/, `${name} emits a lazy image`);
    }
});
