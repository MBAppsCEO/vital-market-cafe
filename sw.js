/* Vital Market Café - service worker: deja abrir la cáscara sin internet */
var V = 'vmc-cascara-1';
var ARCHIVOS = ['./', 'index.html', 'vmc-nucleo.js', 'vmc-shell.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return c.addAll(ARCHIVOS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
/* primero lo guardado (abre al instante y sin internet); en segundo plano se actualiza para la próxima vez */
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(function (c) {
    var red = fetch(e.request).then(function (r) {
      if (r && r.ok) { var cp = r.clone(); caches.open(V).then(function (k) { k.put(e.request, cp); }); }
      return r;
    }).catch(function () { return c; });
    return c || red;
  }));
});
