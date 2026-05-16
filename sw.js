// sw.js — Service Worker for GardenAI PWA

const CACHE_NAME = 'gardenai-v72';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/camera.js',
  './js/ai.js',
  './js/ui.js',
  './js/migration.js',
  './icons/icon-512.png'
];

// Install — cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — cache first for assets, network first for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip all cross-origin requests (Firebase, Groq, Gemini, Fonts, CDN)
  if (url.origin !== self.location.origin) {
    return;
  }

  // Skip Google Fonts — network first (legacy, kept for safety)
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return resp;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache first for app assets, ignore query params
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then(cached => cached || fetch(event.request))
  );
});
