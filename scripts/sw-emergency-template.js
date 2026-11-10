// Emergency GrooveScribe service worker. `SW_EMERGENCY=1 node scripts/build-www.mjs` writes this
// file to www/sw.js in place of the normal worker. Ship it only to recover from a bad worker.
// This is a classic worker script, not a module.
//
// It has no fetch handler, so every request goes to the network. It takes over at once and
// deletes the precache. It must not unregister itself and must not navigate the pages: the app
// registers the worker on every load, so either one would loop.

const CACHE_PREFIX = 'groove-scribe-precache-';

async function deletePrecaches() {
  const names = await caches.keys();
  const precaches = names.filter((name) => name.startsWith(CACHE_PREFIX));
  await Promise.all(precaches.map((name) => caches.delete(name)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(deletePrecaches().then(() => self.clients.claim()));
});
