# Visual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One set of colour tokens, one button style, one font in the grid, the share button loaded on demand, and no dead CSS or icon files.

**Architecture:** A new `css/tokens.css` holds every shared colour and the radius. Each page loads it first. App CSS reads only tokens. A `.btn` family in the same file gives panel, dialog and old popup buttons one shape. The share button library loads on the first opening of the share popup.

**Tech Stack:** Native ES modules, plain CSS custom properties, Vitest, Playwright.

**Spec:** PR 9 of `.lavish/review-fix-plan.html` (items 38-40 of `.lavish/site-audit-groovescribe/REPORT.md`), refined and approved in `.lavish/pr9-visual-system.html` on 2026-11-20. Decisions: D1 = the toolbar blue-grey surfaces everywhere; D2 = 6 px radius on all buttons, popovers and dialogs, including the Help and Sign in pills (round knobs stay round); D3 = keep Font Awesome 4.7.0, delete 4.3.0 and the unused 4.7.0 source files.

## Global Constraints

- SVG and MIDI golden-master output stays byte-identical. Run `npm run test:e2e:verify` on the Mac. Never commit `*-chromium-darwin*` files.
- Note-cell colours do not change: nothing in `js/constants.js`, and no `constant_*_on_color_rgb` value. The grey `#8c8c8c` grid lines and `js/groove_writer.js:164-165` stay.
- No font family inside the SVG.
- Native ES modules, no build step. A new runtime file must be in `scripts/build-www.mjs` `ITEMS` (`css/` is already copied whole) and must be precached when the editor needs it offline.
- Touch targets at least 44 px. Check 1024x768, 768x1024 and 1440x900.
- Size variables (`--bar-top-height`, `--bar-tools-height`, `--bar-playback-height`, `--touch-size`, `--playback-touch`, `--bar-gap`, `--bar-min`, `--bar-height`) stay as they are. Only colour variables move to tokens.
- The white focus ring on Play and all PR 8 accessibility tests stay green. White text on every accent token is at least 4.5:1.
- Smoke PNG baselines may be regenerated only in the Playwright Linux image `mcr.microsoft.com/playwright:v1.61.1-noble`, and only once, at the end of the last task.
- All user-facing text is Simplified Technical English. Commit subjects are one plain imperative sentence.
- Before each commit: `npm run verify:fast`. For `css/`, `js/` or HTML changes also `npm run test:e2e:verify`. Run suites one after another.

## Tokens (exact values)

| Token              | Value                      | Replaces                                                                                                                                                                                                |
| ------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--accent`         | `#1f73a8`                  | `--bar-selected`, `--lp-accent`, `--dd-accent`, `--highlight-color`, `--highlight-color-on-white`, `--side-highlight-bg-color`, `--page-link`, `--lp-current`, literals `#63b1e6`, `#1b6fa8`, `#14689d` |
| `--accent-hover`   | `#1a6493`                  | `#2d97da`, `#68c2ff`, `#005483`                                                                                                                                                                         |
| `--accent-active`  | `#155780`                  | new pressed state                                                                                                                                                                                       |
| `--accent-text`    | `#ffffff`                  | `--lp-accent-text`, `--dd-accent-text` (were dark text on light blue)                                                                                                                                   |
| `--accent-shade`   | `rgba(31, 115, 168, 0.09)` | `--part-shade`                                                                                                                                                                                          |
| `--surface-1`      | `#222a2f`                  | `--bar-playback-bg`, `--lp-bg`, `--dd-bg`                                                                                                                                                               |
| `--surface-2`      | `#2a3238`                  | `--bar-tools-bg`, `--lp-surface`, `--dd-surface`                                                                                                                                                        |
| `--surface-header` | `#243640`                  | `--bar-bg` (pages.css), the header colour                                                                                                                                                               |
| `--text`           | `#eef2f4`                  | `--bar-text`, `--lp-text`, `--dd-text`                                                                                                                                                                  |
| `--text-dim`       | `#b4c0c7`                  | `--bar-dim`, `--lp-muted`, `--dd-muted`                                                                                                                                                                 |
| `--line`           | `#46525a`                  | `--bar-line`, `--lp-border`, `--dd-border`                                                                                                                                                              |
| `--danger`         | `#a8261a`                  | `--bar-danger` (background)                                                                                                                                                                             |
| `--danger-text`    | `#f08a8a`                  | `--lp-danger`, `--dd-danger` (text on dark)                                                                                                                                                             |
| `--radius`         | `6px`                      | radii 4, 5, 8, 22 px on buttons, popovers, menus, dialogs                                                                                                                                               |

Light page colours in `pages.css` (`--page-text`, `--page-dim`, `--page-bg`, `--page-soft`, `--page-line`) may stay as page-local light tokens; only `--page-link` becomes `--accent`. Embed-only layout colours in `groove_display_orange.css` (`--header-bg-*`, `--bpm-bg-color`, `--side-bg-color`, `--bottom-bg-color`, `--note-overlay-bg-color`) may stay; their blue highlight variables become `--accent`.

## Review Focus

1. The panel's primary buttons change from light blue with dark text to `--accent` with white text: check contrast and the focus ring on the dark surface.
2. The embed (`GrooveEmbed.html`, loaded through `js/groove_display.js`) must load `tokens.css` and Font Awesome 4.7.0, and its play/repeat/expand hovers must still show.
3. The share popup offline: the lazily loaded script and CSS must be precached, and the popup must work on the second opening without a second load.
4. Hover-only colours: an old hover blue that is replaced must not leave a hover with no visible change (check `#2d97da` and `#68c2ff` sites).
5. Help and About pages (`gscribe_help.html`, `gscribe_about.html`) keep their look apart from the link colour.

---

### Task 1: Tokens

**Files:**

- Create: `css/tokens.css`
- Modify: `css/editor-toolbars.css`, `css/side-panel.css`, `css/library-panel.css`, `css/confirm-dialog.css`, `css/pages.css`, `css/part-play.css`, `css/groove_display_orange.css`, `css/groove_display.css`, `css/groove_writer_orange.css`, `index.html`, `gscribe_help.html`, `gscribe_about.html`, `js/groove_display.js` (load `../css/tokens.css` before the other CSS)
- Test: `tests/css-tokens.test.js` (new), `tests-e2e/visual-system.spec.js` (new)

**Interfaces:**

- Produces: the token names in the table above. Tasks 2-5 use only these names.

- [ ] **Step 1: Write the failing Vitest** `tests/css-tokens.test.js`, reading every `css/*.css` except `share-button.min.css`, `groove_writer.css` and `groove_display_grey.css` (deleted in Task 5):
  - `it('uses no retired blue')`: none of `#2d97da`, `#68c2ff`, `#63b1e6`, `#1b6fa8`, `#005483`, `#14689d` appears (case-insensitive).
  - `it('defines no panel, dialog or bar colour variables')`: no definition matching `/--(lp|dd)-[a-z-]+\s*:/`, and no `--bar-(text|dim|tools-bg|playback-bg|line|selected|danger|bg)\s*:`.
  - `it('defines every token once, in tokens.css')`: each token name from the table is defined in `css/tokens.css` with the exact value, and nowhere else.
  - `it('loads tokens.css before any other app stylesheet')`: in `index.html`, `gscribe_help.html` and `gscribe_about.html` the first `css/` stylesheet link is `css/tokens.css`; `js/groove_display.js` loads `../css/tokens.css` before `../css/groove_display.css`.
- [ ] **Step 2: Write the failing e2e** `tests-e2e/visual-system.spec.js`, `test('primary buttons share one accent')`: at 1024x768, the computed background of the selected Grid/notation tool (or any `aria-pressed=true` toolbar tool), the panel "Sign in with Google" button, and the confirm dialog primary button are all `rgb(31, 115, 168)`; the panel button text is `rgb(255, 255, 255)`.
- [ ] **Step 3: Run both; they fail** for the expected reasons.
- [ ] **Step 4: Implement.** Add `css/tokens.css` (`:root` block only). Replace every old variable use with the token. Delete the old colour variable definitions. Replace hover literals with `--accent-hover`. Add pressed states (`:active`) with `--accent-active` only where a hover already exists. Link `tokens.css` first in the three pages and load it first in the embed.
- [ ] **Step 5: Run** `npm run verify:fast` and `npm run test:e2e:verify`. Everything passes except the smoke PNGs (allowed to differ until Task 5). The PR 8 contrast tests pass.
- [ ] **Step 6: Commit** "Move the editor colours into one set of tokens".

### Task 2: One button

**Files:**

- Modify: `css/tokens.css` (add `.btn`, `.btn-primary`, `.btn-danger`), `css/side-panel.css`, `css/library-panel.css`, `css/confirm-dialog.css`, `css/part-play.css`, `css/groove_writer_orange.css`, `css/editor-toolbars.css`, and the HTML/JS that renders those buttons (`index.html`, `js/cloud/libraryPanel.js`, `js/editorChrome.js`, `js/sidePanel.js`, `js/partPlayControl.js` as needed)
- Test: `tests-e2e/visual-system.spec.js`

**Interfaces:**

- Consumes: tokens from Task 1.
- Produces: `.btn` (base: `border-radius: var(--radius)`, `min-height: var(--touch-size)`, Lato 600, neutral `--surface-2` fill, `--text`, 1px `--line` border), `.btn-primary` (`--accent` fill, `--accent-text`, hover `--accent-hover`, active `--accent-active`), `.btn-danger` (`--danger` fill, white text).

- [ ] **Step 1: Write the failing e2e** `test('every button has one shape')` at 1024x768 and 768x1024: open in turn the toolbars, the side panel (Library and Grooves), the confirm dialog (trigger it the way existing tests do, e.g. New with unsaved edits), the share popup (`#fullURLPopup`) and the time signature popup (`#timeSigPopup`). For each visible `button` and `[role=button]` inside them, excluding the tempo knob, round icon controls (`border-radius: 50%`) and grid cells, assert computed `border-radius` is `6px` and the bounding box height is at least 44. Also assert `#helpLink` and the Sign in control have radius `6px` (D2).
- [ ] **Step 2: Run; it fails.**
- [ ] **Step 3: Implement.** Add the classes. Put them on panel, dialog, part-play chip and old popup buttons; remove their old per-button colour, border and radius rules. Toolbar `.tool`: keep its layout on the inner `.tool-in` (AGENTS.md rule), change its radius to `var(--radius)`. Popovers, context menus and dialogs take `var(--radius)`. Keep `tests-e2e/editor-toolbars.spec.js` "Save and Share look the same" green.
- [ ] **Step 4: Run** `npm run verify:fast` and `npm run test:e2e:verify` (smoke PNGs may still differ). Take before/after screenshots at the three sizes into the SDD workspace and look at them; fix anything that looks off.
- [ ] **Step 5: Commit** "Give every button one shape".

### Task 3: Lato in the grid

**Files:**

- Modify: `css/groove_writer_orange.css` (`.notes-container` at about line 385, and the `#musicalInput` wrapper)
- Test: `tests-e2e/visual-system.spec.js`

- [ ] **Step 1: Write the failing e2e** `test('the grid text uses Lato')`: on the default groove, the computed `font-family` of a row name (`.hh-label`), a count cell in the count row, and a sticking cell all start with `Lato`.
- [ ] **Step 2: Run; it fails** on the count or sticking cell (Times New Roman).
- [ ] **Step 3: Implement.** Set `font-family: 'Lato', Calibri, sans-serif` on `#musicalInput`. Remove the Times New Roman declaration from `.notes-container`. Do not touch `#svgTarget` or anything inside the SVG.
- [ ] **Step 4: Run** `npm run test:e2e:verify`; the golden master is byte-identical. Check that the count and sticking text still fit in their cells at 768x1024 (1/32 groove too).
- [ ] **Step 5: Commit** "Show the grid text in Lato".

### Task 4: Share button on demand

**Files:**

- Modify: `index.html` (remove the eager `share-button.min.css` link and `share-button.min.js` script; keep or create the `<share-button>` element as the library requires), `js/groove_writer.js` (`root.show_FullURLPopup`, about line 3802), `scripts/build-www.mjs` (precache `js/share-button.min.js`; `css/share-button.min.css` is already precached by the `css/*.css` pattern)
- Test: `tests-e2e/visual-system.spec.js`, `tests/scripts/build-www.test.js`

**Interfaces:**

- Produces: `loadShareButton(): Promise<void>` — a module-private helper in `js/groove_writer.js` (or a new small module `js/shareButtonLoader.js` added to `eslint.config.js`) that injects the CSS link and the script once and resolves when the script has loaded; later calls return the same promise.

- [ ] **Step 1: Write the failing e2e** `test('the share button loads only with the share popup')`: record requests; after page load there is no request for `share-button.min`. Open the share popup the way existing share tests do; exactly one request each for the JS and CSS, and the share control renders inside `#shareButtonContainer`. Close and open again: no new request.
- [ ] **Step 2: Write the failing Vitest** in `tests/scripts/build-www.test.js`: the precache list contains `js/share-button.min.js` and `css/share-button.min.css`.
- [ ] **Step 3: Run both; they fail.**
- [ ] **Step 4: Implement** `loadShareButton()`; `show_FullURLPopup` awaits it before `new ShareButton(...)`. Keep the URL field and Copy working before the library arrives. If the load fails (offline and not cached), the popup still opens with the URL and Copy, and no error reaches the console as an uncaught exception.
- [ ] **Step 5: Run** `npm run verify:fast`, `npm run test:e2e:verify` and the offline tests.
- [ ] **Step 6: Commit** "Load the share button only when the share popup opens".

### Task 5: Dead files and smoke baselines

**Files:**

- Delete: `css/groove_writer.css`, `css/groove_display_grey.css`, `font-awesome/4.3.0/`, and in `font-awesome/4.7.0/` everything except `css/font-awesome.min.css` and the `fonts/` files the CSS references (keep woff2 and woff; delete `less/`, `scss/`, `css/font-awesome.css`, eot, ttf, svg, otf, HELP-US-OUT.txt). Keep the font licence text if one exists.
- Modify: `js/groove_display.js:114` (load `../font-awesome/4.7.0/css/font-awesome.min.css`), comments that name the deleted CSS files, `tests/groove_display/loading.test.js`, `tests/scripts/build-www.test.js`, `tests/firebase-config.test.js` as needed
- Regenerate: `tests-e2e/smoke.spec.js-snapshots/*-chromium-linux.png` in Docker

- [ ] **Step 1: Write the failing tests.** Build test: `www/` has no `css/groove_writer.css`, no `css/groove_display_grey.css`, no `font-awesome/4.3.0`. Loading test: the embed requests `font-awesome/4.7.0/css/font-awesome.min.css`.
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement** the deletions and the embed path change. `@font-face` in `font-awesome.min.css` lists eot/svg/ttf fallbacks: deleting those files is fine for modern browsers, but check the embed and editor icons render in Chromium and WebKit e2e projects (whichever exist).
- [ ] **Step 4: Run** `npm run verify:fast` (knip clean) and `npm run test:e2e:verify`.
- [ ] **Step 5: Regenerate the smoke PNGs** in `mcr.microsoft.com/playwright:v1.61.1-noble` exactly as `docs/testing.md` describes. Look at both new PNGs and compare them with the old ones; the only differences are the colours, radii and grid font from Tasks 1-3.
- [ ] **Step 6: Update docs:** `docs/editor.md` (tokens, `.btn`, share button on demand) and the AGENTS.md note colour line if it names a file that moved.
- [ ] **Step 7: Commit** "Delete unused CSS and icon files, and update the smoke screenshots".
