/* The service worker's data cache.

   Nothing checked this file before. `npm run lint` reaches scripts, tools, tests
   and workers; `check:globals` only knows about files a page pulls in with
   <script src>. service-worker.js is in neither set, and it is the one file on
   the site whose mistakes outlive a deploy — a bad cache entry sits on a device
   until something evicts it.

   All of this pins down a single decision: which URL a data response is filed
   under. Getting that wrong is invisible in every way that usually gets noticed.
   The page still renders, the numbers are still right, and the only symptoms are
   a Cache Storage quota climbing for weeks and an offline mode that quietly
   never engages. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers/load.mjs';

const ORIGIN = 'https://easyfpl.com';
const RSS = 'https://api.rss2json.com/v1/api.json?rss_url=';

/** A response stub. Only the members the worker actually touches. */
const body = (text, { ok = true, status = 200 } = {}) => ({
    text, ok, status, redirected: false,
    clone() { return { ...this, clone: this.clone }; }
});

/** A Cache Storage that remembers exactly what it was keyed on, since the key is
 *  the entire subject here. */
function fakeCaches() {
    const stores = new Map();
    const keyOf = req => (typeof req === 'string' ? req : req.url);
    return {
        stores,
        open(name) {
            if (!stores.has(name)) stores.set(name, new Map());
            const store = stores.get(name);
            return Promise.resolve({
                addAll: urls => (urls.forEach(u => store.set(u, body(u))), Promise.resolve()),
                put: (req, res) => (store.set(keyOf(req), res), Promise.resolve()),
                match: req => Promise.resolve(store.get(keyOf(req)))
            });
        },
        keys: () => Promise.resolve([...stores.keys()]),
        delete: name => Promise.resolve(stores.delete(name)),
        match(req) {
            for (const store of stores.values()) {
                const hit = store.get(keyOf(req));
                if (hit) return Promise.resolve(hit);
            }
            return Promise.resolve(undefined);
        }
    };
}

/* Deliberately not asserting the cache's name anywhere. CACHE_NAME is meant to
   be bumped whenever the precache list changes, and a test that pins it would
   fail on the next honest bump. */
const keys = caches => [...caches.stores.values()].flatMap(s => [...s.keys()]);

function boot(fetchImpl) {
    const caches = fakeCaches();
    const ctx = {
        console, URL, caches,
        fetch: fetchImpl,
        location: { origin: ORIGIN },
        clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]) },
        skipWaiting() {},
        registration: { showNotification: () => Promise.resolve() },
        __listeners: {},
        addEventListener(type, fn) { (this.__listeners[type] ||= []).push(fn); }
    };
    ctx.self = ctx;
    loadScript('service-worker.js', ctx);
    return { ctx, caches };
}

/** Drive the fetch handler and hand back whatever it answered with. */
function fetchEvent(ctx, url, extra = {}) {
    let answered;
    ctx.__listeners.fetch[0]({
        request: { url, method: 'GET', mode: 'no-cors', ...extra },
        respondWith(promise) { answered = promise; }
    });
    return answered;
}

/* The worker writes to the cache in a promise it does not return, so the write
   is still in flight when respondWith settles. Let the microtasks drain. */
const settled = () => new Promise(resolve => setImmediate(resolve));

test('the same feed five minutes later occupies one entry, not two', async () => {
    const { ctx, caches } = boot(req => Promise.resolve(body(req.url)));

    await fetchEvent(ctx, `${ORIGIN}/data/bootstrap-static.json?v=5512340`);
    await settled();
    await fetchEvent(ctx, `${ORIGIN}/data/bootstrap-static.json?v=5512341`);
    await settled();

    assert.deepEqual(keys(caches), [`${ORIGIN}/data/bootstrap-static.json`],
        'the five-minute buster must not reach the cache key');
});

test('a feed stored before the network dropped is served after it drops', async () => {
    let online = true;
    const { ctx } = boot(() => (online
        ? Promise.resolve(body('last good round'))
        : Promise.reject(new Error('offline'))));

    await fetchEvent(ctx, `${ORIGIN}/data/event-live.json?v=5512340`);
    await settled();

    online = false;
    // A later bucket: the URL has rotated, the bytes behind it have not.
    const answer = await fetchEvent(ctx, `${ORIGIN}/data/event-live.json?v=5512399`);

    assert.ok(answer, 'the fallback found nothing to serve');
    assert.equal(answer.text, 'last good round');
});

test('news feeds differing only in the query keep separate entries', async () => {
    const { ctx, caches } = boot(req => Promise.resolve(body(req.url.includes('bbc') ? 'bbc' : 'sky')));

    await fetchEvent(ctx, `${RSS}https%3A%2F%2Fbbc.co.uk%2Frss`);
    await settled();
    await fetchEvent(ctx, `${RSS}https%3A%2F%2Fsky.com%2Frss`);
    await settled();

    assert.equal(keys(caches).length, 2,
        'rss2json puts the feed identity in the query — every feed shares one path');
});

test('offline, each news feed still gets its own articles back', async () => {
    let online = true;
    const { ctx } = boot(req => (online
        ? Promise.resolve(body(req.url.includes('bbc') ? 'bbc' : 'sky'))
        : Promise.reject(new Error('offline'))));

    await fetchEvent(ctx, `${RSS}https%3A%2F%2Fbbc.co.uk%2Frss`);
    await settled();
    await fetchEvent(ctx, `${RSS}https%3A%2F%2Fsky.com%2Frss`);
    await settled();

    online = false;
    assert.equal((await fetchEvent(ctx, `${RSS}https%3A%2F%2Fbbc.co.uk%2Frss`)).text, 'bbc');
    assert.equal((await fetchEvent(ctx, `${RSS}https%3A%2F%2Fsky.com%2Frss`)).text, 'sky');
});

test('a 404 does not evict the last good copy', async () => {
    let priced = true;
    const { ctx, caches } = boot(() => Promise.resolve(priced
        ? body('odds for the round')
        : body('not found', { ok: false, status: 404 })));

    await fetchEvent(ctx, `${ORIGIN}/data/odds.json?v=5512340`);
    await settled();

    // data/odds.json is optional and 404s when no round is priced.
    priced = false;
    await fetchEvent(ctx, `${ORIGIN}/data/odds.json?v=5512341`);
    await settled();

    const stored = [...caches.stores.values()][0].get(`${ORIGIN}/data/odds.json`);
    assert.equal(stored.text, 'odds for the round', 'an error response overwrote a good one');
});

test('an error response is still handed to the page, just not stored', async () => {
    const { ctx, caches } = boot(() => Promise.resolve(body('nope', { ok: false, status: 404 })));

    const answer = await fetchEvent(ctx, `${ORIGIN}/data/odds.json?v=5512340`);
    await settled();

    assert.equal(answer.status, 404, 'the page has its own fallback and needs to see this');
    assert.deepEqual(keys(caches), []);
});
