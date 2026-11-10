// GrooveScribe service worker. scripts/build-www.mjs fills in the two constants and writes
// the result to www/sw.js. This is a classic worker script, not a module.
//
// The app must start and play in a rehearsal room with no network. HTML uses the network
// first, so a deployed page shows at once. Other files come from the cache.
//
// A precached file never changes within a version. The modules link to each other, so a mix of
// two versions can fail to start offline. New content arrives only as a complete new version.
// Files outside the precache are stored on first use and refreshed in the background.

const VERSION = '__VERSION__';
const PRECACHE_FILES = ['__PRECACHE_FILES__'];

const CACHE_PREFIX = 'groove-scribe-precache-';
const CACHE_NAME = CACHE_PREFIX + VERSION;
const PRECACHED_URLS = new Set(
  PRECACHE_FILES.map((path) => new URL(path, self.location.href).href)
);

// A page that does not answer in this time counts as offline. Weak Wi-Fi must not hold up the
// editor when a good copy is on the device.
const NAVIGATION_TIMEOUT_MS = 3000;

// Firebase Hosting keeps /__/ for itself. Sign-in runs through /__/auth/ and must stay live.
const RESERVED_PATH = '/__/';

const RETRY_PARAM = 'retry';

// Firebase Hosting sends Vary. Without ignoreVary a cached file can miss for a request that
// has different headers.
const MATCH_OPTIONS = { ignoreVary: true };

const noop = () => {};

// The opaque check matters for no-cors requests. The redirect check matters because the
// browser refuses a redirected response for a navigation.
function isCacheable(response) {
  return response.ok && response.type === 'basic' && !response.redirected;
}

// Sound, fonts and images have a max-age of 30 days, so a normal fetch could store an old file.
// cache: 'no-cache' asks the server first, so files stay current and an unchanged file costs a
// 304 on each deploy.
const FRESH = 'no-cache';

function fetchFresh(event) {
  return fetch(new Request(event.request, { cache: FRESH }));
}

function fetchAndStore(event, cache, key) {
  const network = fetchFresh(event);
  // Clone here, first in line, so the body is unread even if the page takes the response next.
  const store = (response) => (isCacheable(response) ? cache.put(key, response.clone()) : null);
  event.waitUntil(network.then(store).catch(noop));
  return network;
}

// The groove lives in the query string, and any groove link needs the same page. So a page is
// stored and found under its URL without the query. Only navigations get this treatment.
function pageKey(requestUrl) {
  const url = new URL(requestUrl);
  url.search = '';
  url.hash = '';
  if (url.pathname.endsWith('/')) url.pathname += 'index.html';
  return url.href;
}

async function networkFirst(event) {
  // The Cache object stays valid. Opening it again later could recreate a deleted old cache.
  const cache = await caches.open(CACHE_NAME);
  const key = pageKey(event.request.url);
  const network = PRECACHED_URLS.has(key) ? fetchFresh(event) : fetchAndStore(event, cache, key);
  const timedOut = new Promise((resolve) => setTimeout(resolve, NAVIGATION_TIMEOUT_MS));
  const fresh = await Promise.race([network, timedOut]).catch(noop);
  if (fresh?.ok) return fresh;
  const cached = await cache.match(key, MATCH_OPTIONS);
  // With no copy on the device, the real network result is the only answer left.
  return cached ?? fresh ?? network;
}

// A failed import is retried under a new URL (see firebaseClient.js), but it is the same file.
// Checking first matters: delete() would rewrite the query of every other URL as well.
function assetKey(requestUrl) {
  const url = new URL(requestUrl);
  if (url.searchParams.has(RETRY_PARAM)) url.searchParams.delete(RETRY_PARAM);
  return url.href;
}

async function cacheFirst(event) {
  const cache = await caches.open(CACHE_NAME);
  const key = assetKey(event.request.url);
  const cached = await cache.match(key, MATCH_OPTIONS);
  if (cached && PRECACHED_URLS.has(key)) return cached;
  const network = fetchAndStore(event, cache, key);
  return cached ?? network;
}

function shouldHandle(request) {
  if (request.method !== 'GET' || request.headers.has('range')) return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin && !url.pathname.startsWith(RESERVED_PATH);
}

// All files are fetched before the first write, so a failed fetch stores nothing. A failed
// write removes this version's cache. The worker then stays uninstalled and the active
// version keeps running. The browser tries the install again on a later load.
async function precache() {
  try {
    const entries = await Promise.all(
      PRECACHE_FILES.map(async (path) => {
        const url = new URL(path, self.location.href).href;
        const response = await fetch(new Request(url, { cache: FRESH }));
        if (!isCacheable(response)) {
          throw new Error(`Precache failed for ${url}: status ${response.status}`);
        }
        return [url, response];
      })
    );
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(entries.map(([url, response]) => cache.put(url, response)));
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

async function deleteOldCaches() {
  const names = await caches.keys();
  const old = names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME);
  await Promise.all(old.map((name) => caches.delete(name)));
}

// skipWaiting and clients.claim: a tablet tab can stay open for weeks, so waiting for every
// tab to close would mean an update never arrives. The new version takes over quietly and
// never reloads a page, so a groove that is playing keeps playing.
self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(deleteOldCaches().then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (!shouldHandle(event.request)) return;
  event.respondWith(event.request.mode === 'navigate' ? networkFirst(event) : cacheFirst(event));
});
