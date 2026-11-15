# Offline: service worker and library writes

How the app works with no network, and how to recover when a service worker release goes wrong.

## Service worker

- `scripts/sw-template.js` becomes `www/sw.js` when `build-www.mjs` runs. The worker precaches
  from `www/`. A new runtime file must match `PRECACHED` in `build-www.mjs`, or it is not
  available offline.
- `registerServiceWorker.js` registers the worker on production HTTPS. On localhost, `?sw=1` opts
  in, so cached files never hide an edit during development. The native app does not use it.
- Precached files never change within a version: a new version arrives complete. Pages come from
  the network first; other files come from the cache.
- The worker fetches with `cache: 'no-cache'`, so an unchanged file costs a 304 on each deploy. A
  `retry` query (a retried SDK import) finds the same cached file.
- Keep `cleanUrls` out of `firebase.json`. A redirect on one precached file fails the install on
  every device.
- The worker precaches the SDK file for every visitor, once per version. `page.on('request')` in
  Playwright does not see the worker's own downloads.

## Firestore cache

Firestore uses the persistent cache with many tabs when a small IndexedDB probe opens within 3 s.
Otherwise it uses the memory cache. The persistent cache also asks once for durable storage.

## Offline writes

Code: `pendingSync.js`, `libraryPanel.js`.

- A change draws from the cache at once and shows "Will sync".
- `grooveScribe.pendingWrites` in localStorage loads the SDK on the next visit, so queued writes
  go out with the panel closed.
- A change sets the flag before the cache read. Only the end of the sync wait, or a clean server
  answer after it, clears the flag. An unrelated server load cannot clear it.
- A queued delete has no row, so writes are counted in session state.
- In memory mode, a queued write of any kind warns before the page leaves.
- `deleteLesson` needs the server and is refused offline.

## Recovery from a bad service worker

- Never roll Hosting back to a release from before the first service worker release, and never
  deploy without `/sw.js`. When its update check gets a 404, the browser keeps the old worker, so
  a bad worker then stays on every device.
- To recover, ship the emergency worker. The predeploy build reads `SW_EMERGENCY`:

  ```bash
  SW_EMERGENCY=1 npx firebase deploy --only hosting --project groove-scribe-zdvihal
  ```

  It writes a `www/sw.js` with no fetch handler that deletes the precache, so every request goes
  to the network. It must not unregister or navigate: the app registers the worker on every load,
  and that would loop.

- The next normal deploy brings the normal worker back. Hold merges to `master` until the bad
  worker is fixed. This is a production write: ask the user first.
