/* global self, clients, URL */
// Imported by the Workbox service worker (vite.config.ts → workbox.importScripts).
// Shows the "Mis asignaciones" reminders and opens the app on tap.

const FALLBACK_URL = '/mis-asignaciones';

/** Only same-origin paths: never "//host" or "/\host", which browsers treat as another site. */
function safePath(value) {
  if (typeof value !== 'string' || value[0] !== '/') return FALLBACK_URL;
  return value[1] === '/' || value[1] === '\\' ? FALLBACK_URL : value;
}

self.addEventListener('push', (event) => {
  let data;
  try {
    data = (event.data && event.data.json()) || {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Territorios';
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/icon-192.png',
    lang: 'es-AR',
    data: { url: safePath(data.url) },
  };
  if (typeof data.tag === 'string' && data.tag) options.tag = data.tag;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ('navigate' in client) await client.navigate(target).catch(() => {});
        return;
      }
      await clients.openWindow(target);
    })(),
  );
});
