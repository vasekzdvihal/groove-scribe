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
| `npm test`             | Vitest unit suite — **794 pass**                                                                                                                                                                                                                        |
| `npm run test:e2e`     | Playwright golden-master and UI — **110 pass** (on a Mac use `npm run test:e2e:verify`). Byte-identical SVG+MIDI snapshots; this is the real proof that a refactor changed nothing functional. Finishes in <5 min by design.                            |
| `npm run lint`         | ESLint — **0 errors** (~83 SonarJS _warnings_ are an accepted refactor backlog, not failures)                                                                                                                                                           |
| `npm run typecheck`    | `tsc --noEmit` checkJs via JSDoc, compared per file with `scripts/typecheck-baseline.json` (246 known errors). Fails if any file has more errors than its baseline or a new file has errors. After you fix errors, run `npm run typecheck -- --update`. |
| `npm run knip`         | no unused exports/files                                                                                                                                                                                                                                 |
| `npm run format:check` | Prettier clean (`npm run format` to fix)                                                                                                                                                                                                                |
| `npm run verify:fast`  | lint + typecheck + format:check + knip + test. CI's "checks" job runs it. `npm run check` is an alias.                                                                                                                                                  |
| `npm run verify`       | `verify:fast`, then `test:e2e:verify`, `test:rules` and `test:cloud`. Every check in one command (needs Java).                                                                                                                                          |
| `npm run test:rules`   | Firestore security rules against the emulator (needs Java)                                                                                                                                                                                              |
| `npm run test:cloud`   | Library panel in Chromium against the Auth + Firestore emulators (needs Java)                                                                                                                                                                           |

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
`grooves.js` (built-in groove library).

### Tests

- `tests/` — Vitest (jsdom). Subdirs per subject (`groove_utils/`, `groove_writer/`,
  `groove_display/`). Legacy source is loaded via `tests/helpers/` shims. See `tests/README.md`.
- `tests-e2e/` — Playwright (Chromium). `golden-master.spec.js` snapshots SVG+MIDI for a
  groove corpus; `fixtures.js` blocks non-localhost requests for hermetic runs.

### Accounts and library (`js/cloud/`)

- Firebase project `groove-scribe-zdvihal`. Firestore is in `eur3`.
- A push to `master` that passes the tests deploys through `.github/workflows/ci-deploy.yml`.
  There is no stored secret: `scripts/setup-deploy.sh` lets only this repo's `master` deploy.
  `npm run deploy` still works by hand. Keep the Playwright image version in the workflow equal to
  `@playwright/test` in `package-lock.json`, or the golden master runs on a different browser.
- The library is a slide-in panel in the editor (`libraryPanel.js`, `css/library-panel.css`).
  `main.js` passes it a small `editor` object, so the panel never touches editor internals.
  `profile.html` only redirects to `index.html#library`.
- The Firebase SDK loads when the user first opens the panel. The editor page load and the embed
  pages never download it.
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

## Conventions & gotchas

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
  link never loads the Firebase SDK. Below 1100 px it slides over the editor.
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
