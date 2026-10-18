// 주아방 웹앱: 화면 파일을 저장해 두고, 인터넷이 되면 항상 새것을 먼저 받는다.
const CACHE = 'juabang-v1';
const SHELL = ['./', 'index.html', 'style.css', 'js/main.js', 'js/audio.js', 'js/lyrics.js', 'js/library.js', 'icon.svg', 'icon-512.png', 'manifest.webmanifest'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request)));
});
