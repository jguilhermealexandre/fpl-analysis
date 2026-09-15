/* The squad pages are for one manager's own team, so a signed-out visitor is
   sent to the landing page — and the link they were following is carried in
   ?next= so signing in takes them there rather than to the dashboard.

   That parameter is the part worth testing. Honouring it as given would make
   our own domain a redirector to anyone else's, which is the classic shape of
   this bug: the link looks like ours, the destination is not. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

/* Pulled out on its own rather than by evaluating the page, which boots a
   dashboard when it loads. Only the URL surface it reads is stubbed. */
function nextFor(search) {
    const html = fs.readFileSync('index.html', 'utf8');
    const src = /function nextAfterSignIn\(\)[\s\S]*?\n {8}\}/.exec(html);
    assert.ok(src, 'nextAfterSignIn() not found in index.html');
    const ctx = vm.createContext({
        URL, URLSearchParams,
        location: { search, origin: 'https://easyfpl.co.uk' }
    });
    new vm.Script(`${src[0]}\n;globalThis.__fn = nextAfterSignIn;`).runInContext(ctx);
    return ctx.__fn();
}

test('no next parameter means no redirect', () => {
    assert.equal(nextFor(''), null);
});

test('a path on this site is carried through, query and hash included', () => {
    assert.equal(nextFor('?next=%2Fsquad-analysis%23transfers'), '/squad-analysis#transfers');
    assert.equal(nextFor('?next=%2Ffpl-league-rivals.html%3Fa%3D1'), '/fpl-league-rivals.html?a=1');
});

test('another origin is refused', () => {
    assert.equal(nextFor('?next=https%3A%2F%2Fevil.example%2Fx'), null);
});

test('a protocol-relative URL is a host, not a path, and is refused', () => {
    /* "//evil.example/x" looks like a path and is not one: the browser reads
       it as a host. Taken at its word this is an open redirect. */
    assert.equal(nextFor('?next=%2F%2Fevil.example%2Fx'), null);
});

test('a backslash variant is refused too', () => {
    assert.equal(nextFor('?next=%2F%5Cevil.example'), null);
});

test('a relative path cannot climb out of the origin', () => {
    // Resolved against the origin, so it can only ever name something here.
    const r = nextFor('?next=..%2F..%2Fetc');
    assert.ok(r === null || r.startsWith('/'), `got ${r}`);
});

test('a malformed value never escapes the origin and never throws', () => {
    /* "%" is not valid percent-encoding, but it is not an error either: it
       resolves against our own origin as the path "/%". That is a 404 here
       and nowhere else, which is the only property that matters. */
    const r = nextFor('?next=%');
    assert.ok(r === null || r.startsWith('/'), `got ${r}`);
    assert.ok(!/^\/\//.test(r || '/'), 'and not a host in disguise');
});
