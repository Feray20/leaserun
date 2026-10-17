// ImmoAdv Service Worker: statische Dateien zwischenspeichern, Seiten netzwerkbasiert mit Offline-Rückfall.
// API-Aufrufe, Kontodaten und Dokumente werden nie zwischengespeichert.
const CACHE = 'immoadv-v92';
const STATIC = ['/', '/src/site.css', '/logo-icon.svg', '/src/app.js', '/src/content.js', '/src/routes.js', '/icon-192.png', '/offline.html'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/app/') || url.pathname.startsWith('/auth') || url.pathname.startsWith('/datenraum') || url.pathname.startsWith('/pruefen')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match(req).then((r) => r || caches.match('/offline.html'))));
    return;
  }
  // Skripte und Styles: zuerst vom Netz, damit nach einem Update nie alte und neue Dateien gemischt werden
  // (das konnte Seiten leer lassen). Der Cache dient nur als Rückfall ohne Verbindung.
  if (url.pathname.startsWith('/src/')) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req).then((hit) => hit || Response.error())));
    return;
  }
  // Bilder ändern sich selten: Cache zuerst, im Hintergrund aktualisieren.
  if (url.pathname.endsWith('.png')) {
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});
