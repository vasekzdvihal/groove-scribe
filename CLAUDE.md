# GrooveScribe — project guide for Claude

Browser-based drum-notation editor. Runs client-side with no build step. Accounts
and saved grooves use Firebase; the editor itself still works without it. A groove is encoded in the URL, rendered to sheet music as SVG
(via the vendored `abc2svg`) and played back as MIDI (via `jsmidgen` +
`MIDI.js` soundfonts).

## Running & developing

- **Serve locally:** `npm run serve` (→ http://localhost:8000). You MUST serve
  over HTTP — opening `index.html` via `file://` breaks soundfont loading
  (CORS on the `*-ogg.js` files).
- No compile/bundle: source in `js/` is loaded directly as native ES modules
  (`<script type="module">`). Editing a file = refresh the page.

### Verify loop (run after every change; all must stay green)

| Command                | Expectation                                                                                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`             | Vitest unit suite — **1065 pass**                                                                                                                                                                                                                       |
| `npm run test:e2e`     | Playwright golden-master and UI — **213 pass** (on a Mac use `npm run test:e2e:verify`). Byte-identical SVG+MIDI snapshots; this is the real proof that a refactor changed nothing functional. Finishes in <5 min by design.                            |
| `npm run lint`         | ESLint — **0 errors** (~85 SonarJS _warnings_ are an accepted refactor backlog, not failures)                                                                                                                                                           |
| `npm run typecheck`    | `tsc --noEmit` checkJs via JSDoc, compared per file with `scripts/typecheck-baseline.json` (245 known errors). Fails if any file has more errors than its baseline or a new file has errors. After you fix errors, run `npm run typecheck -- --update`. |
| `npm run knip`         | no unused exports/files                                                                                                                                                                                                                                 |
| `npm run format:check` | Prettier clean (`npm run format` to fix)                                                                                                                                                                                                                |
| `npm run verify:fast`  | lint + typecheck + format:check + knip + test. CI's "checks" job runs it. `npm run check` is an alias.                                                                                                                                                  |
| `npm run verify`       | `verify:fast`, then `test:e2e:verify`, `test:rules` and `test:cloud`. Every check in one command (needs Java).                                                                                                                                          |
| `npm run test:rules`   | Firestore security rules against the emulator — **22 pass** (needs Java)                                                                                                                                                                                |
| `npm run test:cloud`   | Library panel in Chromium against the Auth + Firestore emulators — **101 pass** (needs Java)                                                                                                                                                            |

Standing rule for all refactoring here: **nothing functional may change** —
prove it with the golden-master E2E, not by eyeballing.

## Architecture

### Render pipeline (the mental model)

```
URL query string  ──parse──►  grooveData  ──►  ABC notation ──► SVG  (abc2svg)
   (urlSerialization)         (the contract)   (abcNotation)
                                   │
                                   └──────────►  MIDI file   (midiFile + jsmidgen)
```

`grooveData` is the central data contract (js/grooveData.js: `GrooveData`
@typedef + pure `createGrooveData()` factory). Everything flows through it.

### The three top-level objects

- **GrooveUtils** (`js/groove_utils.js`) — shared core engine. Owns URL↔grooveData,
  ABC + MIDI generation (delegates to the pure modules below), MIDI playback,
  tempo/swing, note-array math. Used by both the editor and the embed viewer.
- **GrooveWriter** (`js/groove_writer.js`) — the interactive **editor** controller:
  the clickable note grid, menus/popups, undo/redo, permutation practice modes,
  hotkeys. Instantiated in `js/main.js` for `index.html`.
- **GrooveDisplay** (`js/groove_display.js`) — read-only **embed** renderer
  (used by the `GrooveEmbed*.html` / `grooveDBTest*.html` pages).

### Module map (`js/`, ours — everything else in `js/` is vendored, don't lint/edit)

Pure / low-coupling core (extracted from the two big files, imported back):

- `constants.js` — all `constant_*` values (ABC tokens, MIDI numbers, grid colors).
- `musicMath.js` — pure time-signature / note-scaling math.
- `noteArrays.js` — note-array ↔ tab/ABC conversions.
- `grooveData.js` — `GrooveData` typedef + factory (see above).
- `urlSerialization.js` — URL ↔ grooveData (fully pure; instance flags passed via a `config` arg).
- `midiFile.js` — grooveData → MIDI (takes a GrooveUtils `gu`).
- `abcNotation.js` — grooveData → ABC (takes `gu`).
- `browserInfo.js` — user-agent / touch probes.
- `permutations.js` — pure permutation-mode note-array generators (+ kick-array merge/filter).
- `viewHtml.js` — pure HTML string builders (staff container, permutation-options menu).
- `gridState.js` — the DOM grid **read** layer: per-cell state (`is_*_on`/`get_*_state`)
  and whole-measure array readers (`get32NoteArrayFromClickableUI`, `muteArrayFromClickableUI`).
  Reads the ambient global `document`; caller state injected via ctx/callbacks.

Entry/support: `main.js` (index.html bootstrap, wires `window.myGrooveWriter` etc.),
`editorChrome.js` (popovers, BPM buttons and swing in the editor's bars),
`wakeLock.js` (keeps the screen on while a groove plays; see the wake lock note below),
`registerServiceWorker.js` (decides whether this page uses the service worker, and registers it),
`cloud/pendingSync.js` (the library's queued-write tracking: the flag, the sync wait, the slow timer
and the leave warning),
`discardDialog.js` (the "Discard your changes?" question; the page owns it, so it works without
the panel),
`cloud/dirtyState.js` (the clean groove: `createDirtyState`, `watchDirty`, and the per-tab baseline
that survives a reload),
`cloud/currentGroove.js` (the saved groove open in the editor: `createCurrentGroove` for one
signed-in session, and its per-tab record),
`grooves.js` (built-in groove library).

### Tests

- `tests/` — Vitest (jsdom). Subdirs per subject (`groove_utils/`, `groove_writer/`,
  `groove_display/`). Legacy source is loaded via `tests/helpers/` shims. See `tests/README.md`.
- `tests-e2e/` — Playwright (Chromium). `golden-master.spec.js` snapshots SVG+MIDI for a
  groove corpus; `fixtures.js` blocks non-localhost requests for hermetic runs. Each run builds
  `www/` and serves it, so the tests see what production deploys. `tests-cloud/` does the same.
  The only addition is `html_examples_and_tests/`, overlaid by `scripts/test-server.py` for two
  embed tests; it is never copied into `www/`. A new runtime file must be added to `ITEMS` in
  `scripts/build-www.mjs`, or the deployed site and the tests will not have it.

### Accounts and library (`js/cloud/`)

- Firebase project `groove-scribe-zdvihal`. Firestore is in `eur3`.
- A push to `master` that passes the tests deploys through `.github/workflows/ci-deploy.yml`.
  There is no stored secret: `scripts/setup-deploy.sh` lets only this repo's `master` deploy.
  `npm run deploy` still works by hand. Keep the Playwright image version in the workflow equal to
  `@playwright/test` in `package-lock.json`, or the golden master runs on a different browser.
- The library is a slide-in panel in the editor (`libraryPanel.js`, `css/library-panel.css`).
  `main.js` passes it a small `editor` object, so the panel never touches editor internals.
  `profile.html` only redirects to `index.html#library`.
- Unsaved edits: `dirtyState.js` keeps the groove that was last loaded or saved. `watchDirty`
  checks once after each URL change (`GrooveWriter.onUrlChange`) and each dirty-state change, and
  `editor.onDirtyChange` reports only real flips. The leave warning is attached only while dirty.
- Rule: any code that replaces the groove in the editor checks `dirtyState.isDirty`, asks with
  `askToDiscard`, and after the load calls `dirtyState.markClean` with the editor's new query.
- Every edit is in the address, so the clean groove is kept per tab in `sessionStorage`, in one
  item with the last address, written from the page's memory (`dirtyState.remember` on each URL
  change and on a `pageshow` from the back-forward cache). `main.js` starts from it after a reload
  (`restoredBaseline`), so a page with edits stays dirty. A new link opened in the same tab is
  another address and starts clean. The record
  of the open saved groove is per tab too, so Update survives a reload and no tab changes another.
- Update reads the server first while online, and does not write over a change from another
  device. The panel reads the library again when the tab becomes visible and when the network
  returns.
- The Save button next to Share opens the panel at its save form, or at the sign-in. It says
  Saved only while the editor shows an open saved groove unchanged, and its save is safe on this
  device (persistent cache or no pending write). The panel shows the button,
  so the native app and GrooveDB authoring, which have no panel, do not show it.
- The page runs the Firebase SDK when the panel connects. The editor page load does not import
  it, the embed pages never download it, and the service worker precaches the file for offline use.
- A saved groove is its URL query string. `grooveLink.js` keeps only known groove parameters.
- `allowedUsers/{uid}` documents are the access list. They are added by hand in the Firebase
  console. A new person needs one document with their Auth UID.
- `lessons` and `grooves` are top-level documents with an `ownerId`, private to the owner in
  `firestore.rules`. This lets sharing arrive later without a data migration.
- `js/vendor/firebase.js` is generated: run `npm run vendor:firebase` after a Firebase bump, and
  add new SDK functions to `scripts/firebase-entry.js`.
- `index.html?emulator=1` on localhost uses the emulators. Tests sign in with an emulator
  credential because the emulator popup loads external scripts and sometimes hangs.
- Golden-master baselines are Linux-only. On macOS Playwright writes new `*-chromium-darwin*`
  files and reports a failure. To verify there, run `npm run test:e2e:verify`. It compares those
  files with the Linux baselines byte for byte, skips the two smoke PNGs that differ on a Mac,
  deletes the darwin files, and exits non-zero on any real failure or difference. On Linux it runs
  plain Playwright. Never commit darwin files.
- Test servers use fixed ports: `npm run test:e2e` uses 8010 and `npm run test:cloud` uses 8001.
  `reuseExistingServer` is false, so a busy port fails the run. Stop the other process first.

### Service worker and offline library

- `scripts/sw-template.js` becomes `www/sw.js` when `build-www.mjs` runs. The worker precaches from
  `www/`, so a new runtime file must match `PRECACHED` in `build-www.mjs` or it is not available
  offline.
- `registerServiceWorker.js` registers the worker on production HTTPS. On localhost, `?sw=1` opts
  in, so cached files never hide an edit during development. The native app does not use it.
- Precached files never change within a version: a new version arrives complete. Pages use the
  network first, and the other files come from the cache. The worker fetches with
  `cache: 'no-cache'`, so an unchanged file costs a 304 on each deploy. A `retry` query (a retried
  SDK import) finds the same cached file.
- Keep `cleanUrls` out of `firebase.json`. A redirect on one precached file fails the install on
  every device.
- The page runs the SDK only when the panel connects, but the worker precaches the SDK file for
  every visitor, once per version. `page.on('request')` does not see the worker's own downloads.
- Firestore uses the persistent cache and many tabs when a small IndexedDB probe opens within 3 s.
  Otherwise it uses the memory cache. The persistent cache also asks for durable storage once.
- Offline write rules (`pendingSync.js`, `libraryPanel.js`): a change draws from the cache at
  once and shows "Will sync". `grooveScribe.pendingWrites` in localStorage loads the SDK on the
  next visit, so queued writes go out with the panel closed. A change sets the flag before the
  cache read. Only the end of the sync wait or a clean server answer after it clears the flag, so
  an unrelated server load cannot. A queued delete has no row, so writes are counted in session
  state. In memory mode a queued write of any kind warns before the page leaves. `deleteLesson`
  needs the server and is refused offline.

### Recovery from a bad service worker

- Never roll back Hosting to a release from before the first service worker release, and never
  deploy without `/sw.js`. The browser keeps a worker when its update check gets a 404, so a
  bad worker then stays on every device.
- To recover, ship the emergency worker. The predeploy build reads `SW_EMERGENCY`:

  ```
  SW_EMERGENCY=1 npx firebase deploy --only hosting --project groove-scribe-zdvihal
  ```

  It writes a `www/sw.js` that has no fetch handler and deletes the precache, so every request
  goes to the network. It must not unregister or navigate: the app registers the worker on every
  load, and that would loop. A later normal deploy brings the normal worker back, so hold merges
  to `master` until the bad worker is fixed.

## Conventions & gotchas

- **Hosted files and the cache:** `fonts/` holds the Lato font files, served from our own host.
  Firebase Hosting caches `soundfont/`, `font-awesome/`, `images/` and `fonts/` for 30 days
  (`firebase.json`). A changed file in one of these folders needs a new file name, and every
  reference must point to the new name. Same name, same bytes for 30 days.
- **Wake lock:** `js/wakeLock.js` runs in the editor only, not in the embeds. Play takes a screen
  wake lock. Stop or pause starts a 10 minute timer, and the lock is released when it ends.
  Playing again before then keeps the lock.
- **Sound loading:** `index.html` preloads the sound file, and `groove_utils.js` retries a failed
  or stalled download (1, 3 and 9 s waits, 45 s stall timer that ends with the download, then a 30 s decode timer).
  The docked library waits for the sound, but never more than 10 s (`main.js`).

- **Adding a new `js/*.js` ES module:** add it to the module-files list in
  `eslint.config.js` (else "import/export only allowed with sourceType: module").
  App source is otherwise treated as classic scripts. `tsconfig.json` `include` lists
  only the big files; small modules are checked transitively.
- **Editor bars:** `css/editor-toolbars.css` overrides older rules that other pages still load.
  View mode writes `display: block` or `none` on every `.edit-block`, so a `.edit-block` button
  must not need another display value: put its layout on an inner `.tool-in` span. The player
  markup is shared with the embeds, so `initPlaybackControls` changes it in the editor only.
- **Library panel:** from 1100 px wide it docks next to the music and moves `#RightHandContent`. It
  opens by itself only for people who were signed in on the device or left it open, so a shared
  link does not load the Firebase SDK into the page. Below 1100 px it slides over the editor.
- **Toms 2 and 3 and auto speed-up:** the grid has rows only for toms 1 and 4. A loaded groove keeps toms 2 and 3 in `class_kept_toms`, valid for one bar layout, with the same visibility rule as toms 1 and 4. The metronome auto speed-up rewrites the newest undo step instead of adding one.
- **Golden master width:** the SVG scales to `#svgTarget` width. The spec pins a 1208 px wide
  window, so the baselines stay valid when bars change. Change that value only to re-baseline.
- **`js/abc2svg-1.js` has three local edits** (no `%%beginjs`, no `%%beginsvg` style copy, no
  `%%beginml`) for security. Any future version must keep them.
- **Native modules run deferred**, so parse-time `document.write` is gone — DOM is built
  in `main.js` / inline module scripts. Use `import.meta.url` (not `document.currentScript`,
  which is null in modules) for locating the script's own path.
- Extraction pattern used throughout: move code to a new module, leave a **same-name
  delegating wrapper** in the original file so call sites stay untouched; verify byte-identical
  output via the golden master.
- Grid state is read back from **rendered CSS color** — the note setters (still in GrooveWriter)
  paint a cell, the `gridState` readers compare its color against the shared
  `constant_*_on_color_rgb` values in `constants.js` (setters paint the hex form; the browser
  normalizes it to rgb on readback).
- Vendored globals (don't redefine): `Midi`, `MIDI`, `Abc`, `Share`, `ShareButton`, `Pablo`.

## Refactor status (strangler-fig, ES-module migration)

Steps 1–3 complete: native ESM (no build); pure core extracted; `grooveData` contract
formalized. **Step 4 (decomposing GrooveWriter) is paused** with the high-value cuts done —
`permutations.js`, `viewHtml.js`, and the full `gridState.js` read layer are extracted, taking
`groove_writer.js` from ~5,800 → ~3,870 lines. The remainder is mostly irreducible
controller/event-handler/DOM-write glue. If resumed, candidate cuts: the UI→grooveData
**bridge** (`grooveDataFromClickableUI` / `createMidiUrlFromClickableUI` — top-of-graph, needs a
ctx-bag) or the note **setters** (`set_*_state`, the DOM-**write** counterpart to `gridState`).
