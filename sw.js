const CACHE_NAME="oral-hygiene-pwa-v2";
const ASSETS=[
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./assets/figures/figure-01.jpg",
  "./assets/figures/figure-02.jpg",
  "./assets/figures/figure-03.jpg",
  "./assets/figures/figure-04.jpg",
  "./assets/figures/figure-05.jpg",
  "./assets/figures/figure-06.jpg",
  "./assets/figures/figure-07.jpg",
  "./assets/figures/figure-08.jpg",
  "./assets/figures/figure-09.jpg",
  "./assets/figures/figure-10.jpg",
  "./assets/figures/figure-11.jpg",
  "./assets/figures/figure-12.jpg",
  "./assets/figures/figure-13.jpg",
  "./assets/figures/figure-14.jpg",
  "./assets/figures/figure-15.jpg",
  "./assets/figures/figure-16.jpg",
  "./assets/figures/figure-17.jpg",
  "./assets/figures/figure-18.jpg",
  "./assets/figures/figure-19.jpg",
  "./assets/figures/figure-20.jpg",
  "./assets/figures/figure-21.jpg",
  "./assets/figures/figure-22.jpg",
  "./assets/figures/figure-23.jpg",
  "./assets/figures/figure-24.jpg"
];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));return response}).catch(()=>caches.match('./index.html'))))});
