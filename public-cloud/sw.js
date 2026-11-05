// Service worker for the clinic web app (cloud build only). Shows push notifications when the app is
// closed or in the background, and opens the right screen when one is clicked (docs/CLOUD-PLAN.md, Phase 3).
// It also keeps the app itself on the device, so the phone/browser app opens without a connection (Phase 2):
// the records are already in the browser's own database.
const SHELL = 'clinic-shell-v1';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/health') return;
  if (req.mode === 'navigate') {
    // The page: fresh from the server when it answers (so updates arrive), the kept copy when it doesn't.
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put('/', res.clone()));
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error())),
    );
    return;
  }
  // Scripts, styles, fonts, icons: their names change with every version, so a kept copy is always right.
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && (url.pathname.startsWith('/assets/') || /\.(png|webmanifest|woff2?)$/.test(url.pathname))) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { title: 'Animal Care Clinic', body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // The app is open and on screen: it shows its own toast; just tell it to refresh the bell.
      const visible = wins.find((w) => w.visibilityState === 'visible' && w.focused);
      if (visible) {
        visible.postMessage({ type: 'notify' });
        return;
      }
      await self.registration.showNotification(d.title || 'Animal Care Clinic', {
        body: d.body || '',
        tag: d.tag || d.id || undefined,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: d.url || '/', id: d.id },
      });
    })(),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const w = wins.find((c) => new URL(c.url).origin === self.location.origin);
      if (w) {
        await w.focus();
        w.postMessage({ type: 'open', url, id: e.notification.data && e.notification.data.id });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
