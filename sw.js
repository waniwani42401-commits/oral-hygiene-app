const VERSION = '9.0.0';
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});
// v9では保存容量を圧迫しないよう、アプリ本体や画像をCache Storageへ複製しません。
