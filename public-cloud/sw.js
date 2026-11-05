// Service worker for the clinic web app (cloud build only). Shows push notifications when the app is
// closed or in the background, and opens the right screen when one is clicked (docs/CLOUD-PLAN.md, Phase 3).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

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
