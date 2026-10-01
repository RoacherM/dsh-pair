// DSH phone app service worker: app-shell cache + Web Push.
const CACHE = 'dsh-pair-muotcpyh';
const SHELL = ['/', '/app.js?v=muotcpyh', '/app.css?v=muotcpyh', '/manifest.webmanifest', '/icon-180.png', '/icon-192.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/v1/')) return;
  // Network first (so updates land), cache as the offline fallback.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && (url.pathname === '/' || SHELL.includes(url.pathname + url.search))) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((hit) => hit ?? caches.match('/'))));
});

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data?.json() ?? {}; } catch { data = { title: 'DSH', body: e.data?.text() ?? '' }; }
  e.waitUntil(self.registration.showNotification(data.title ?? 'DSH', {
    body: data.body ?? '', tag: data.tag, renotify: Boolean(data.urgent), icon: '/icon-192.png', badge: '/icon-192.png',
    data: { sessionId: data.sessionId, pendingId: data.pendingId },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { sessionId } = e.notification.data ?? {};
  const target = sessionId ? `/?s=${encodeURIComponent(sessionId)}` : '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if ('focus' in client) { client.postMessage({ open: { sessionId } }); return client.focus(); }
    }
    return self.clients.openWindow(target);
  }));
});
