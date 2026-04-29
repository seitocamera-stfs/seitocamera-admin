// ===========================================
// SeitoCamera Service Worker — Push + Offline
// ===========================================

const CACHE_NAME = 'seitocamera-v1';

// =========================================
// Install — precache shell mínim
// =========================================
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// =========================================
// Activate — netejar caches antics
// =========================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// =========================================
// Push — mostrar notificació nativa
// =========================================
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'SeitoCamera', body: event.data?.text() || '' };
  }

  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    tag: data.tag || 'default',
    data: { url: data.url || '/' },
    vibrate: [200, 100, 200],
    requireInteraction: data.tag === 'urgent',
    actions: [
      { action: 'open', title: 'Obrir' },
      { action: 'dismiss', title: 'Tancar' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'SeitoCamera', options)
  );
});

// =========================================
// Notification click — obrir l'app
// =========================================
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Si ja hi ha una finestra oberta, enfocar-la
      for (const client of clients) {
        if (client.url.includes(self.location.origin)) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Si no, obrir una nova
      return self.clients.openWindow(url);
    })
  );
});

// =========================================
// Fetch — network first, fallback cache
// =========================================
self.addEventListener('fetch', (event) => {
  // Només cache per a GET requests de la mateixa origin
  if (event.request.method !== 'GET') return;

  // No interceptar crides API
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Guardar en cache per offline
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
