// Deckmate service worker: shows "your turn" push messages (sent by api/notify.ts) and opens the game on tap.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data ? e.data.text() : '' }; }
  const url = m.url || '/';
  e.waitUntil((async () => {
    // If this very game is open and in front, the page rings its own chime; no extra notification needed.
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (open.some((c) => c.visibilityState === 'visible' && c.focused && new URL(c.url).pathname === new URL(url, self.location.origin).pathname)) return;
    await self.registration.showNotification(m.title || 'Deckmate', {
      body: m.body || 'Du bist am Zug.',
      tag: m.tag || 'deckmate',
      renotify: true,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = open.find((c) => c.url === url) || open[0];
    if (same) { await same.focus(); if (same.url !== url && 'navigate' in same) await same.navigate(url).catch(() => {}); return; }
    await self.clients.openWindow(url);
  })());
});

// The browser replaced the subscription (keys rotated): tell the page on its next visit by dropping a flag.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'deckmate-resubscribe' }))));
});
