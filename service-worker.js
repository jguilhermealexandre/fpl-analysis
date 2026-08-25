const CACHE_NAME = 'easyfpl-v4';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/fpl-players-analysis.html',
  '/fpl-teams-analysis.html',
  '/fpl-my-team-analysis.html',
  '/fpl-transfer-wizard.html',
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
  '/styles/wizard.css',
  '/scripts/common.js',
  '/scripts/xp-engine.js',
  '/scripts/live-gw.js',
  '/scripts/players-ai.js',
  '/scripts/players-tables.js',
  '/nav.html',
  '/footer.html',
];

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
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const safe = cleanResponse(response);
          const clone = safe.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return safe;
        })
        .catch(() => caches.match(event.request))
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
