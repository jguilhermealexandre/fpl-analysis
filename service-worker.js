/* Bumped to v8 with the shared player profile card: styles/player-profile.css
   and scripts/player-profile.js join the precache list below, and cache.addAll
   is atomic — a device holding the v7 list would never fetch either.

   v7 went with the data-cache key fix below. The bump is the fix for everyone
   already carrying the bug: activate deletes every cache whose name is not this
   one, and that is the only thing that reclaims the entries the old key piled up
   on devices in the wild. */
const CACHE_NAME = 'easyfpl-v8';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/fpl-players-analysis.html',
  '/fpl-teams-analysis.html',
  '/fpl-my-team-analysis.html',
  '/fpl-league-rivals.html',
  '/fpl-news.html',
  '/fpl-faq.html',
  '/fpl-how-it-works.html',
  '/fpl-methodology.html',
  '/fpl-privacy.html',
  '/fpl-contact.html',
  '/styles/docs.css',
  '/styles/common.css',
  '/styles/players.css',
  '/styles/teams.css',
  '/styles/my-team.css',
  '/styles/player-profile.css',
  '/scripts/error-monitor.js',
  '/scripts/common.js',
  '/scripts/xp-engine.js',
  '/scripts/live-gw.js',
  '/scripts/transfer-engine.js',
  '/scripts/players-ai.js',
  '/scripts/players-tables.js',
  '/scripts/player-profile.js',
  '/footer.html',
];

/* The key a data response is stored under, with the cache buster taken off.

   Every /data/ URL arrives carrying ?v=<Date.now()/300000> from common.js, so the
   URL rotates every five minutes even when the bytes behind it do not —
   players-data.json is rewritten every four hours. Keyed on the request exactly
   as it arrived, this cache gained a fresh 2.75 MB entry every five minutes and
   never dropped one, and the offline fallback below could never match anything:
   by the time a fetch failed, the URL it was looking up had already rotated past
   everything stored. Navigations have always been keyed on their pathname for
   this same reason; this brings data requests into line with them.

   Only /data/ is normalised, and that restraint is the point. The other two
   things this branch matches are the FPL proxy and api.rss2json.com, and
   rss2json carries the whole feed identity in the query string: every news feed
   shares the path /v1/api.json and differs only by ?rss_url=. Stripping the
   query there would collapse them onto one key and serve one feed's articles in
   place of another's. */
function dataCacheKey(url) {
  if (!url.pathname.startsWith('/data/')) return url.href;
  const key = new URL(url.href);
  key.searchParams.delete('v');
  return key.href;
}

// Strip the "redirected" flag so cached responses can be served for navigations
function cleanResponse(response) {
  if (response.redirected) {
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  return response;
}

// Install — pre-cache static shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 1) Data files & API calls → network-first, fall back to cache
  if (url.pathname.startsWith('/data/') || url.hostname.includes('workers.dev') || url.hostname.includes('rss2json')) {
    const cacheKey = dataCacheKey(url);
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const safe = cleanResponse(response);
          /* Only a success is worth keeping. data/odds.json is optional and 404s
             when no round is priced, and the proxy can answer 5xx while FPL is
             updating; storing either would hand the fallback below an error to
             serve in place of the last good copy, which is the opposite of the
             job it exists to do. */
          if (safe.ok) {
            const clone = safe.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, clone));
          }
          return safe;
        })
        .catch(() => caches.match(cacheKey))
    );
    return;
  }

  // 2) Navigation requests → network-first, cache by pathname only (strips hash/query)
  if (event.request.mode === 'navigate') {
    const cacheKey = url.origin + url.pathname;
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const safe = cleanResponse(response);
          const clone = safe.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(cacheKey, clone));
          return safe;
        })
        .catch(() => caches.match(cacheKey))
    );
    return;
  }

  // 3) Static assets → cache-first with network update
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const networkFetch = fetch(event.request).then(response => {
          const safe = cleanResponse(response);
          const clone = safe.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return safe;
        });
        return cached || networkFetch;
      })
    );
    return;
  }
});

/* ===== Push notifications =====

   The only mechanic on this site that reaches a manager without him first
   remembering the site exists — which makes it the most valuable thing here
   and the only feature that can lose a user outright. Everything below is
   built to be quiet: one notification per distinct piece of news, collapsed by
   tag so a second one about the same thing replaces the first rather than
   stacking, and never a broadcast. If it is not about your squad it is not
   sent.

   Payloads are produced by the push Worker (see workers/push/). The shape is
   { title, body, tag, url, renotify } and everything is optional except title,
   because a malformed payload must still produce something a person can read
   rather than the browser's own "This site has been updated in the background".

   iOS note: this only ever fires for a home-screen install. Safari has no
   Push API in a normal tab, so the subscribe button is hidden there — see
   scripts/push-alerts.js. */

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }

  const title = data.title || 'EasyFPL';
  const options = {
    body: data.body || '',
    // Collapse on subject. Three price alerts about the same player over an
    // evening should be one notification that updates, not three to dismiss.
    tag: data.tag || 'easyfpl',
    renotify: data.renotify === true,
    data: { url: data.url || '/' },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    timestamp: Date.now()
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  /* Focus an existing tab rather than opening a fourth copy of the dashboard.
     The URL is compared on origin only: a manager who already has the site open
     on the transfers tab should be brought there and navigated, not given a
     duplicate window. */
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.focus();
        if ('navigate' in client) { try { await client.navigate(target); } catch (e) { /* focus is enough */ } }
        return;
      }
    }
    await clients.openWindow(target);
  })());
});

/* A subscription can be rotated by the browser at any time — after a long
   idle, or when the push service reissues an endpoint. Without this the
   subscription silently dies and the manager simply stops hearing from us,
   which is indistinguishable from us having nothing to say. */
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    try {
      const sub = await self.registration.pushManager.subscribe(
        event.oldSubscription ? event.oldSubscription.options : { userVisibleOnly: true });
      await fetch('/api/push/resubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          old: event.oldSubscription ? event.oldSubscription.endpoint : null,
          subscription: sub
        })
      });
    } catch (e) { /* nothing useful to do here; the client re-subscribes on next visit */ }
  })());
});
