// KE30minutos  sw.js  版 0.4.1  基づく仕様書：KE30minutos_仕様書_v0.4.1.md
// 役割：オフラインで動くようにキャッシュする。更新はボタンを押したときだけ切り替える（ルールブック3-12。install で skipWaiting() を呼ばない）
const CACHE_VERSION = 'ke30minutos-v0.4.1';
const ASSETS = ['./', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'js/config.js', 'js/util.js', 'js/store.js', 'js/engine.js', 'js/media.js',
  'js/library.js', 'js/planner.js', 'js/records.js', 'js/drive.js', 'js/sync.js', 'js/driveimport.js', 'js/backup.js', 'js/session.js', 'js/player.js', 'js/ui.js', 'js/app.js',
  'js/worklet/ke30-processor.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.indexOf('ke30minutos-') === 0 && k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // 自分のサイトのGETだけ扱う。GAS（script.google.com）など他のサイトへの通信と、POSTには触らない
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});

// ボタンが押されたときだけ新しい版に切り替える
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
