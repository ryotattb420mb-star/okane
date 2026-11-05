// おかね帳 Service Worker — オフラインでも起動できるようにファイルを保存
const VERSION = 'v1.0.0';
const SHELL = `shell-${VERSION}`;
const OCR = 'ocr-v6';
const SHELL_FILES = [
  './', './index.html', './css/app.css', './js/app.js', './js/logic.js', './js/db.js', './js/ocr.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== OCR).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/vendor/')) {
    // 文字認識のファイル（大きい・変わらない）：保存済みを優先
    e.respondWith(caches.open(OCR).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // アプリ本体：通信できれば最新、できなければ保存済み
  e.respondWith((async () => {
    const c = await caches.open(SHELL);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(req, { signal: ctrl.signal, cache: 'no-cache' });
      clearTimeout(t);
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch {
      return (await c.match(req, { ignoreSearch: true })) || (await c.match('./index.html')) || Response.error();
    }
  })());
});
