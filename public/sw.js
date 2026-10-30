// Service Worker de ¡Pilas!: notificaciones nativas + funcionamiento sin conexión.
// - Navegación: red primero, con la última página guardada como respaldo offline.
// - /assets/* (archivos con hash, inmutables): caché primero.
// - Nunca se cachean peticiones a /api ni a otros orígenes (IA): pueden llevar claves y datos personales.
// Nueva versión de caché: obliga a descargar los iconos y el manifiesto con la nueva marca
const CACHE_NAME = 'pilas-v4';
const APP_SHELL = ['/', '/index.html', '/theme-init.js', '/manifest.json', '/favicon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Páginas (SPA): red primero; sin conexión se sirve el index guardado
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put('/index.html', copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Frases grabadas del coach: el manifiesto, red primero (cambia al regenerar); los audios, caché primero
  if (url.pathname.startsWith('/coach-voice/')) {
    const isManifest = url.pathname.endsWith('/manifest.json');
    const fromNetwork = () =>
      fetch(request).then((res) => {
        if (res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => undefined);
        }
        return res;
      });
    event.respondWith(
      isManifest
        ? fromNetwork().catch(() => caches.match(request).then((r) => r || Response.error()))
        : caches.match(request).then((cached) => cached || fromNetwork())
    );
    return;
  }

  // Recursos con hash del build: inmutables, caché primero
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE_NAME).then((c) => c.put(request, copy)).catch(() => undefined);
            }
            return res;
          })
      )
    );
  }
});

// Manejo del clic en la notificación del sistema
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Si la ventana ya está abierta, enfocarla
      for (const client of windowClients) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      // Si no, abrir una nueva ventana
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
