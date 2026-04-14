const CACHE_NAME = 'easyfpl-v1';

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
  '/styles/common.css',
  '/styles/players.css',
  '/styles/teams.css',
  '/styles/my-team.css',
  '/styles/wizard.css',
  '/scripts/common.js',
  '/scripts/players-ai.js',
  '/scripts/players-tables.js',
  '/nav.html',
  '/footer.html',
];

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
  const url = new URL(event.request.url);

  // Data files & API calls → network-first, fall back to cache
  if (url.pathname.startsWith('/data/') || url.hostname.includes('workers.dev') || url.hostname.includes('rss2json')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets & pages → cache-first, fall back to network
  if (event.request.method === 'GET' && url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        const networkFetch = fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
        return cached || networkFetch;
      })
    );
    return;
  }
});
