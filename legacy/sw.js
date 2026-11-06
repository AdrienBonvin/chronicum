// Replaces the old app's service worker on the old address. It waits like any update (the app
// applies it once the board is free), then empties the caches, removes itself and reloads the
// page, which the server now sends to chronicum.web.app
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      for (const key of await caches.keys()) await caches.delete(key);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: "window" })) {
        client.navigate(client.url).catch(() => undefined);
      }
    })(),
  );
});
