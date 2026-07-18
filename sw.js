const CACHE_NAME = 'oral-hygiene-pwa-v5.0.0';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './base-questions.js',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(CORE.map(url => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isImage = request.destination === 'image' || /\/assets\/figures\//.test(url.pathname) || /\/icons\//.test(url.pathname);
  if (isImage) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
        return response;
      } catch (_) {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(request, { cache: 'no-cache' });
      if (response.ok) (await caches.open(CACHE_NAME)).put(request, response.clone());
      return response;
    } catch (_) {
      return (await caches.match(request)) || (request.mode === 'navigate' ? await caches.match('./index.html') : new Response('', { status: 504, statusText: 'Offline' }));
    }
  })());
});
