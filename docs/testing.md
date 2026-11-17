# Testing

All suites must stay green after every change. Run them one after another: they use fixed ports.

## The suites

| Command                   | What it checks                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `npm test`                | Vitest unit suite (jsdom), `tests/`. See [`../tests/README.md`](../tests/README.md).                                 |
| `npm run test:e2e`        | Playwright, `tests-e2e/`: golden master (byte-identical SVG and MIDI) plus UI tests. Linux only.                     |
| `npm run test:e2e:verify` | The same on a Mac. See "Golden master on a Mac" below.                                                               |
| `npm run test:cloud`      | The library panel in Chromium against the Auth and Firestore emulators, `tests-cloud/`. Needs Java.                  |
| `npm run test:rules`      | `firestore.rules` against the Firestore emulator, `tests-rules/`. Needs Java.                                        |
| `npm run lint`            | ESLint: 0 errors. SonarJS warnings are an accepted backlog.                                                          |
| `npm run typecheck`       | `tsc` checkJs via JSDoc, compared per file with `scripts/typecheck-baseline.json`. Fails if a file gets more errors. |
| `npm run knip`            | No unused exports or files.                                                                                          |
| `npm run format:check`    | Prettier. `npm run format` fixes it.                                                                                 |
| `npm run verify:fast`     | lint + typecheck + format:check + knip + Vitest. CI's "Lint and unit tests" job.                                     |
| `npm run verify`          | `verify:fast`, then `test:e2e:verify`, `test:rules`, `test:cloud`.                                                   |

After you fix type errors, run `npm run typecheck -- --update` to lower the baseline.

## What the e2e and cloud tests serve

- Each run builds `www/` (`scripts/build-www.mjs`) and serves it, so the tests see what production
  deploys. A runtime file missing from `ITEMS` in `build-www.mjs` is missing in the tests too.
- `scripts/test-server.py` adds `html_examples_and_tests/` on top for two embed tests. That folder
  never goes into `www/`.
- `tests-e2e/fixtures.js` blocks every request that does not go to localhost, so runs are hermetic.
- `tests-e2e/fixtures.js` also drops a mouseenter that carries Ctrl or Alt. On a Mac, Chrome
  sends a mouseenter by itself when the element under a still mouse changes (a dialog closes),
  and it takes the modifier keys from the real keyboard. A Ctrl held in a terminal during a run
  then painted a note under the mouse (`noteOnMouseEnter`) and failed a test now and then.
- `npm run test:e2e` uses port 8010 and `npm run test:cloud` uses 8001. `reuseExistingServer` is
  false, so a busy port fails the run. Stop the other process first.

## Golden master

- `tests-e2e/golden-master.spec.js` snapshots the SVG and MIDI of a groove corpus
  (`tests-e2e/corpus.js`). Byte-identical output is the proof that a change kept the music.
- The SVG scales to the `#svgTarget` width. The spec pins a 1208 px wide window, so the baselines
  stay valid when the bars change. Change that width only to re-baseline.
- The CI jobs run in the Playwright Docker image. Its version in `ci-deploy.yml` must equal
  `@playwright/test` in `package-lock.json`, or the browser differs from the baselines.

## Golden master on a Mac

The baselines are Linux-only. On macOS, Playwright writes `*-chromium-darwin*` files and reports
a failure. `npm run test:e2e:verify` handles this: it compares the darwin files with the Linux
baselines byte for byte, skips the two smoke PNGs (they differ on a Mac), deletes the darwin
files, and exits non-zero on a real failure or difference. Never commit darwin files.

## Smoke screenshots

`tests-e2e/smoke.spec.js-snapshots/{home,rock16}-chromium-linux.png` go stale after a visual
change. Make them again in the Linux image after the last visual change of a PR:

```bash
docker run --rm -v "$PWD":/src:ro -v "$PWD/tests-e2e/smoke.spec.js-snapshots":/out \
  mcr.microsoft.com/playwright:v1.61.1-noble bash -c '
  mkdir -p /work && cd /src &&
  tar --exclude=node_modules --exclude=www --exclude=test-results --exclude=.git -cf - . | tar -xf - -C /work &&
  cd /work && npm ci --silent &&
  npx playwright test tests-e2e/smoke.spec.js --update-snapshots=all --workers=1;
  cp tests-e2e/smoke.spec.js-snapshots/*-chromium-linux.png /out/'
```

- Use `--update-snapshots=all`. The spec allows `maxDiffPixelRatio: 0.02`, so plain
  `--update-snapshots` keeps a PNG that changed by less than 2%.
- Use the image version from `ci-deploy.yml`. Look at both PNGs before you commit them.

## Cloud tests

- `index.html?emulator=1` on localhost connects to the emulators.
- Tests sign in with an emulator credential, not the popup: the emulator popup loads external
  scripts and sometimes hangs.
