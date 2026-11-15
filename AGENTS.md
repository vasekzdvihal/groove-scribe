# AGENTS.md — GrooveScribe

Personal fork of GrooveScribe, a browser drum-notation editor. A groove lives in the URL. The app
renders it to sheet music (SVG, vendored `abc2svg`) and plays it as MIDI. Native ES modules, no
build step. Google sign-in and a Firestore lesson library run on Firebase project
`groove-scribe-zdvihal`. The main user plays from a tablet in the rehearsal room.

## Commands

npm (`package-lock.json`). Full list in `package.json`.

```bash
npm run serve            # http://localhost:8000. Use HTTP: file:// breaks the soundfont load
npm run verify:fast      # lint + typecheck + format:check + knip + Vitest. Run before each commit
npm run test:e2e:verify  # Playwright golden master + UI, on a Mac (Linux: npm run test:e2e)
npm run test:cloud       # library panel against the Auth + Firestore emulators (needs Java)
npm run test:rules       # Firestore security rules against the emulator (needs Java)
npm run typecheck -- --update   # after you fix type errors: lower the per-file baseline
```

Run the suites one after another, never in parallel: they use fixed ports.

## Code Style

- Style is enforced by ESLint and Prettier (`npm run lint:fix`, `npm run format`). Follow the
  configured rules; do not override or disable them. SonarJS warnings are an accepted backlog.
- A new `js/*.js` module goes into the module list in `eslint.config.js`. A new runtime file goes
  into `ITEMS` in `scripts/build-www.mjs`, or the deploy and the tests do not have it.
- All user-facing text is Simplified Technical English: short sentences, active voice, plain words.
- Touch targets are at least 44 px. Check UI changes at 1024x768, 768x1024 and 1440x900.

## Architecture

- URL → `grooveData` (`js/grooveData.js`, the central contract) → ABC → SVG, and → MIDI.
  Details: `docs/architecture.md`.
- `GrooveUtils` is the shared engine. `GrooveWriter` is the editor (`index.html`, wired in
  `js/main.js`). `GrooveDisplay` is the read-only embed (`GrooveEmbed*.html`).
- **Most work is in the editor chrome and the library panel** (`js/editorChrome.js`,
  `js/cloud/`, `css/`). All of `js/vendor/` and the third-party files in `js/` (listed in
  `knip.json` `ignore`) are vendored: do not edit them.

## Gotchas

- IMPORTANT: SVG and MIDI output must stay byte-identical. The golden master proves it, not your
  eyes. Its baselines are Linux-only: never commit `*-chromium-darwin*` files.
- Grid state is read back from the rendered CSS colour of each cell. A note colour changes in
  `css/` and `js/constants.js` together, or the grid stops reading its own state.
- IMPORTANT: every `firebase`/`gcloud` command takes `--project groove-scribe-zdvihal`. The same
  account holds company projects: never touch them.
- A merge to `master` deploys to production (`.github/workflows/ci-deploy.yml`). The user merges.
  Write to production (Firestore, Auth, Hosting) only with the user's approval for that step.

## Workflow

1. Work on a `feat/`, `fix/` or `chore/` branch in its own worktree, never on `master`.
2. Write the test first. Fix any lint error, failing test or flaky test you see, also when you did
   not cause it.
3. Run `npm run verify:fast`. For `js/`, `css/` or `index.html` changes also run
   `npm run test:e2e:verify`; for `js/cloud/` also `npm run test:cloud`.
4. Commit subjects are one plain imperative sentence ("Add a tempo knob ..."). Open the PR with
   `gh ... --repo vasekzdvihal/groove-scribe`.

## Map

- `docs/README.md` — index of the docs and how to write them. Read before you add a doc.
- `docs/architecture.md` — render pipeline, top-level objects, module patterns, refactor rules.
- `docs/testing.md` — the suites, the golden master on a Mac, smoke screenshots, test servers.
- `docs/editor.md` — editor bars, tempo knob, note grid, sound, wake lock. Read before editor UI work.
- `docs/library.md` — accounts, lessons, grooves, unsaved edits, the panel. Read before `js/cloud/` work.
- `docs/offline.md` — service worker, offline writes, recovery from a bad worker.
- `docs/operations.md` — deploy, hosting cache, access list and other production tasks.
- `docs/mobile.md` — Capacitor builds for Android and iOS.
- `tests/README.md` — how Vitest loads the app source.
