# Accessibility (PR 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A keyboard or screen reader user can write a groove, play it, choose part play beats, use every menu and the side panel lists, and axe finds no serious or critical violation on any page.

**Architecture:** One new module, `js/gridKeyboard.js`, gives the note grid a roving tab stop and arrow keys. The cells get names in `js/viewHtml.js`, and `markNoteOn` keeps the name in step with the note. The other changes go into the modules that own each control: `editorChrome.js` (popovers, the old menus, the dialogs), `sidePanel.js`, `partPlayControl.js`, `grooves.js`, `cloud/libraryPanel.js`. A new `tests-e2e/a11y.spec.js` runs axe (`@axe-core/playwright`) on each page and grows with each task.

**Tech Stack:** Native ES modules, no build step. Vitest (jsdom) for pure helpers. Playwright for e2e and the cloud suite. `@axe-core/playwright`.

**Spec:** There is no spec file. The spec is the approved scope "PR 8 Accessibility" from the user's review-fix plan (T8.1 grid, T8.2 names and contrast, T8.3 structure and focus), plus two deferred minors added since: part play beats by keyboard, and groove lists by keyboard. Audit wording: `groove-scribe/.lavish/site-audit-groovescribe/REPORT.md`, items 7, 8, 32 to 36, the Severity 2 Accessibility row and the Severity 1 lines on carets and the 320 px toolbar.

## Audit items checked against today's code (master 4198c2c)

| Item                                | State today                                                                                                                                                                                                                                                                         | What this plan does |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 7 Grid by keyboard                  | Not fixed. Cells are `div`s with `onClick`. The hook is `renderNoteGrid()` in `groove_writer.js` (about line 4180), not :2745.                                                                                                                                                      | Task 2              |
| 8 Cell state for a screen reader    | Not fixed. `markNoteOn` writes `data-on` only.                                                                                                                                                                                                                                      | Task 2              |
| 32 Focus rings                      | `#libraryToggle` is gone: the side panel tabs are `.tool` buttons with a ring. The tempo knob has a ring. **Still open:** `input[type='range']:focus { outline: none }` in the three `groove_display*.css` files hides the ring on the swing slider (editor) and the embed sliders. | Task 1              |
| 33 Tempo name                       | **Fixed in the editor:** the knob is `role="slider"` with `aria-label="Tempo"`, the field has `aria-label="Beats per minute"`. **Still open:** the embed tempo slider, the embed tempo field and the swing slider (editor and embed) have no name.                                  | Task 1              |
| 34 `lang`                           | **Fixed** on `gscribe_help.html`, `gscribe_about.html`, `profile.html`. **Still open:** `index.html`, `GrooveEmbed.html`.                                                                                                                                                           | Task 1              |
| 35 Blue contrast                    | Not fixed: `#2484c0` is `--bar-selected` and is in six CSS files. Part play already has `--part-blue: #1f73a8`.                                                                                                                                                                     | Task 1              |
| 36 Off `x` and circle border        | Not fixed: `#CCC` and `#999` in CSS and in `groove_writer.js`.                                                                                                                                                                                                                      | Task 1              |
| Sev 2 global Left/Right             | Still there, but the handler is `setupWriterHotKeys` in `groove_writer.js`, and it changes the **tempo**, not the groove. The `editorChrome.js` lines are Escape and the knob's own keys; the knob already stops propagation. The handler also fires on range inputs on purpose.    | Task 2              |
| Sev 2 popovers do not move focus    | Half fixed: `initPopovers` sets `aria-expanded` and Escape returns focus. Open does not move focus in. The old context menus (Stickings, Help/account, Metronome options, note menus) are `li onclick` and cannot be used by keyboard at all.                                       | Task 4              |
| Sev 2 no landmarks or H1            | Help and About are fixed (`header`, `main`, `h1`). `index.html` has none, apart from the side panel, which is already an `aside` with an `h2`.                                                                                                                                      | Task 3              |
| Sev 2 panel after the player        | Still: `sidePanel.js` appends the panel to the end of `body`.                                                                                                                                                                                                                       | Task 3              |
| Sev 1 carets without expanded state | Fixed for the `data-popover` carets. Open for Stickings (`tool-caret`), Help/account and Metronome options.                                                                                                                                                                         | Task 4              |
| Sev 1 toolbar at 320 px             | The bars now scroll sideways by design (no wrap). Probably still open: `#GrooveWriter { min-width: 800px }` in `groove_writer_orange.css` can give the page a sideways scroll, and the grid clips cells (`overflow-x: clip`) below about 450 px.                                    | Task 3              |

Found while checking, not in the audit (in scope because axe or the scope's "every control by keyboard" needs them):

- The Play control (`.midiPlayImage`) is a `span` with no role and no tab stop, in the editor and the embed. Task 1.
- The add bar and remove bar controls are `span`s; add has `role="button"` but no tab stop. Task 5.
- The Grooves tab rows are `li`s with a click listener, and the list nests `ul` directly in `ul` (axe `list`, serious). Task 6.
- The time signature popup has two unnamed `select`s. The share popup closes with a `span`. Task 4.
- The library has no groove reordering, so there is nothing to reorder by keyboard. Its rows are buttons already. Open: Escape in an open ⋯ menu. Task 6.

## Global Constraints

- SVG and MIDI output stay byte-identical. The golden master (`tests-e2e/golden-master.spec.js`) snapshots only the SVG and the MIDI, not the grid HTML, so ARIA on grid cells is safe. Check it with `npm run test:e2e:verify` on a Mac. Never commit `*-chromium-darwin*` files.
- The Vitest snapshot `tests/groove_writer/__snapshots__/html-generation.test.js.snap` pins the grid markup. A task that changes the markup updates it with `-u` and reads the diff: only the planned attributes may change.
- Grid state is read back from the rendered CSS colour of each cell. A note colour changes in `css/`, in the setters' local colours in `js/groove_writer.js`, and in `js/constants.js` together.
- A new `js/*.js` module goes into the module list in `eslint.config.js`. A module in the `js/main.js` import chain needs a `<link rel="modulepreload">` in `index.html` (`tests/preload.test.js` fails otherwise). `ITEMS` in `scripts/build-www.mjs` copies all of `js/` and `css/`, so a new file there needs no `ITEMS` change.
- `@axe-core/playwright` is not installed today. Task 1 adds it with `npm install --save-dev @axe-core/playwright`, which writes `package.json` and `package-lock.json`.
- Touch targets are at least 44 px. Check UI changes at 1024x768, 768x1024 and 1440x900, plus 320x640 for reflow. No visual change other than the planned colours and focus rings.
- The smoke PNGs (`tests-e2e/smoke.spec.js-snapshots/{home,rock16}-chromium-linux.png`) change with the colours. Make them again once, in Task 6, with the Docker command in `docs/testing.md` (image `mcr.microsoft.com/playwright:v1.61.1-noble`, `--update-snapshots=all`), and look at both PNGs before the commit.
- All user-facing text and every `aria-label` is Simplified Technical English: short, active, plain words.
- Run `npm run verify:fast` before each commit. For `js/`, `css/` or `index.html` changes also run `npm run test:e2e:verify`. For `js/cloud/` also run `npm run test:cloud`. Run the suites one after another, never in parallel (fixed ports).
- Commit subjects are one plain imperative sentence. End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- A wrong doc is worse than none: a task that changes a fact in `docs/editor.md`, `docs/library.md` or `docs/testing.md` fixes that line in the same commit.

## Review Focus

1. Space or Enter on a grid cell while the groove plays: the note changes and playback goes on (the document Space handler in `groove_utils.js` must not see the key). Test in Task 2.
2. The grid is drawn again (a bar added, a new division) or a lane hides (Toms off): exactly one cell keeps `tabindex="0"` and it is visible, so Tab still reaches the grid. Test in Task 2.
3. Advanced edit on: Enter on a cell opens the note menu next to the cell, the arrow keys and Enter pick an item, and focus goes back to the cell. Test in Task 4.
4. The new colours must not break the read-back: a groove with sticking R and every articulation still gives the same URL after a load. Test in Task 1.
5. The panel moves before `main` in the DOM: the overlay panel and its backdrop must still paint above the bars at 1024 px, and the docked layout at 1440 px must not move. Test in Task 3.

---

### Task 1: axe harness, names, `lang`, focus rings and contrast

**Files:**

- Modify: `package.json`, `package-lock.json` (devDependency)
- Create: `tests-e2e/a11y.spec.js`
- Modify: `index.html` (`<html lang="en">`), `GrooveEmbed.html` (`<html lang="en">`, title "Embedded groove")
- Modify: `js/groove_utils.js` (`HTMLForMidiPlayer`, the play state code near the `midiPlayImage` class changes, `AddMidiPlayerToPage`)
- Modify: `js/editorChrome.js` (drop the `aria-label` line for the tempo field: the shared markup now has it)
- Modify: `css/editor-toolbars.css`, `css/pages.css`, `css/part-play.css`, `css/groove_writer.css`, `css/groove_writer_orange.css`, `css/groove_display.css`, `css/groove_display_grey.css`, `css/groove_display_orange.css`
- Modify: `js/constants.js`, `js/groove_writer.js` (local colour constants only)
- Test: `tests-e2e/a11y.spec.js`, `tests/groove_writer/grid-notes.test.js` (existing, must stay green)

**Interfaces:**

- Produces: `tests-e2e/a11y.spec.js` with helpers later tasks reuse:
  - `async function axeScan(page, { include?: string, disableRules?: string[] }): Promise<import('axe-core').Result[]>` — runs `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])` and returns `violations`.
  - `function seriousOrWorse(violations): string[]` — `"<rule id>: <first target>"` for impact `serious` or `critical`.
  - `function contrastRatio(rgbA: string, rgbB: string): number` — WCAG relative luminance ratio of two `rgb(...)` strings.
- Produces: one blue token. `--bar-selected: #1f73a8` in `css/editor-toolbars.css` and `css/pages.css`. `--part-blue` is removed; `css/part-play.css` uses `var(--bar-selected)`. Every other `#2484c0` in `css/` becomes `#1f73a8` (5.16:1 on white; the scope's "about #1f78b0" gives 4.80:1, and one token is simpler).
- Produces: one grey for off symbols and borders: `#8c8c8c` (`rgb(140, 140, 140)`, 3.36:1 on white). It replaces `#CCC`/`#cccccc`/`rgb(204, 204, 204)` for off note symbols and off stickings, and `#999` for note circle borders (`constant_note_border_color_hex`, the `.hh_open`/circle `border-color` rules).
- Produces: `constant_sticking_right_on_color_rgb = 'rgb(31, 115, 168)'` in `js/constants.js`, and `.sticking_right` "on" colour `#1f73a8` wherever the CSS or the setter paints it.
- Produces: shared player markup names: tempo field `aria-label="Beats per minute"`, tempo slider `aria-label="Tempo"`, swing slider `aria-label="Swing"`. The play span gets `role="button" tabindex="0" aria-label="Play"`; the state code sets `aria-label` to `Pause` while it plays and `Play` otherwise; Enter on it calls its click. (Space already plays everywhere.)

- [ ] **Step 1: Add axe**

Run: `npm install --save-dev @axe-core/playwright`
Expected: `package.json` lists `@axe-core/playwright` under `devDependencies`; `git status` shows `package.json` and `package-lock.json` only.

- [ ] **Step 2: Write the failing tests in `tests-e2e/a11y.spec.js`**

Import `test, expect` from `./fixtures.js` and `AxeBuilder` from `@axe-core/playwright`. Scenarios (each at 1024x768 unless named):

```js
const PAGES = [
  ['editor', '/index.html'],
  [
    'editor with a groove',
    '/index.html?TimeSig=4/4&Div=16&Measures=2&H=|x-x-x-x-x-x-x-x-|xxxxxxxxxxxxxxxx|&S=|----O-------O---|--O---O---O---O-|&K=|o-------o-------|o--o--o--o--o---|&Stickings=|R-L-R-L-R-L-R-L-|RLRLRLRLRLRLRLRL|',
  ],
  ['help', '/gscribe_help.html'],
  ['about', '/gscribe_about.html'],
  [
    'embed',
    '/GrooveEmbed.html?TimeSig=4/4&Div=16&H=|x-x-x-x-x-x-x-x-|&S=|----O-------O---|&K=|o-------o-------|',
  ],
];
for (const [name, url] of PAGES) {
  test(`${name} has no serious or critical axe violation`, async ({ page }) => {
    await page.goto(url);
    // wait for #svgTarget svg on editor pages, .GrooveDisplay svg on the embed
    expect(seriousOrWorse(await axeScan(page))).toEqual([]);
  });
}

test('every page says it is in English', async ({ page }) => {
  for (const [, url] of PAGES) {
    await page.goto(url);
    expect(await page.getAttribute('html', 'lang')).toBe('en');
  }
});

test('the swing slider and the Play control have names', async ({ page }) => {
  // editor: open the Swing popover first
  await expect(page.getByRole('slider', { name: 'Swing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('Tab reaches Play, and Enter on it plays', async ({ page }) => {
  // focus via Tab loop until :focus matches [id^="midiPlayImage"]; press Enter;
  // poll myGrooveWriter.myGrooveUtils.isPlaying() === true; name is now "Pause"
});

test('a range slider shows a focus ring', async ({ page }) => {
  // open Swing popover, focus #swingInput* by keyboard
  // getComputedStyle(el).outlineStyle !== 'none' && outlineWidth >= '2px'
});

test('off notes and note borders have 3:1 contrast on white', async ({ page }) => {
  // default groove: an off hi-hat (hh_cross color) and an off snare circle (borderColor)
  expect(contrastRatio(offCrossColor, 'rgb(255, 255, 255)')).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(circleBorderColor, 'rgb(255, 255, 255)')).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(offStickingColor, 'rgb(255, 255, 255)')).toBeGreaterThanOrEqual(3);
});

test('a groove URL with stickings and every articulation is the same after a load', async ({
  page,
}) => {
  // Review Focus 4. Load a URL that has sticking R, L, both, count, hi-hat open/accent/crash,
  // snare accent/ghost/xstick/flam/drag, kick + splash. Read window.location.search after the
  // editor rewrites it, load that, and expect the second search to equal the first.
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx playwright test tests-e2e/a11y.spec.js`
Expected: FAIL. At least `color-contrast` on the editor, `label` on the embed sliders, `html-has-lang` on editor and embed, the `lang` test, the swing name, the Play name, the focus ring and the 3:1 contrast tests. Write the full list of axe rule ids in the commit body; Steps 4 to 6 must clear each one. If a violation is inside `#svgTarget svg`, do not change the SVG: exclude that selector in `axeScan` with a comment that the golden master pins it.

- [ ] **Step 4: `lang`, names and the Play control**

Add `lang="en"` to `index.html` and `GrooveEmbed.html`. Put the names from Interfaces into `HTMLForMidiPlayer`. Make the play span a button as in Interfaces; add the Enter keydown listener in `AddMidiPlayerToPage`, where the player is attached. Remove the now duplicate `tempoField.setAttribute('aria-label', ...)` in `initPlaybackControls`.

- [ ] **Step 5: Colours**

Apply the blue token and the grey from Interfaces. After the change these must print nothing:

Run: `grep -rniE "2484c0|36, ?132, ?192|part-blue" css js index.html gscribe_*.html | grep -v js/vendor`
Expected: no output.

Run: `grep -rniE "#ccc(ccc)?\b|204, ?204, ?204|#999\b" css/groove_writer_orange.css js/groove_writer.js`
Expected: only lines that are not note symbols, sticking symbols or note borders (for example dialog borders). Check each remaining line by hand.

- [ ] **Step 6: Focus rings on range inputs**

In `groove_display.css`, `groove_display_grey.css` and `groove_display_orange.css`, keep `input[type='range']:focus { outline: none }` for the mouse and add `input[type='range']:focus-visible { outline: 2px solid #1f73a8; outline-offset: 2px; }`.

- [ ] **Step 7: Run the tests to see them pass**

Run: `npx playwright test tests-e2e/a11y.spec.js && npx vitest run tests/groove_writer`
Expected: all PASS. If the player markup is in a Vitest snapshot, update it with `-u` and check that the diff is only the new attributes.

- [ ] **Step 8: Look at the UI**

Open `npm run serve` at 1024x768, 768x1024 and 1440x900. The Share button, the selected Off button, the open side panel tab, the docked panel head and the part play chip use the darker blue. Off hi-hats and circle borders are darker grey. Nothing else moves.

- [ ] **Step 9: Full checks and commit**

Run: `npm run verify:fast && npm run test:e2e:verify`
Expected: both exit 0. `test:e2e:verify` reports the two smoke PNGs as skipped on the Mac.

```bash
git add package.json package-lock.json tests-e2e/a11y.spec.js index.html GrooveEmbed.html js/groove_utils.js js/editorChrome.js js/constants.js js/groove_writer.js css/ docs/editor.md
git commit -m "Name the player controls, add lang, and raise the contrast of the blue and the off notes"
```

(Update the "Note grid" colour line in `docs/editor.md` if it names a value.)

---

### Task 2: Keyboard and screen reader note grid

**Files:**

- Create: `js/gridKeyboard.js`
- Create: `tests/gridKeyboard.test.js`
- Create: `tests-e2e/grid-keyboard.spec.js`
- Modify: `js/viewHtml.js` (cell names, roles, `tabindex`, data attributes)
- Modify: `js/groove_writer.js` (`markNoteOn` updates the name; `setupWriterHotKeys` skips arrows in widgets)
- Modify: `js/main.js` (call `initGridKeyboard` once, after the first `renderNoteGrid()`)
- Modify: `css/editor-toolbars.css` (cell focus ring)
- Modify: `index.html` (modulepreload for `js/gridKeyboard.js`), `eslint.config.js` (module list)
- Modify: `tests/groove_writer/__snapshots__/html-generation.test.js.snap` (via `-u`)
- Modify: `tests-e2e/a11y.spec.js` (grid scenario)
- Modify: `docs/editor.md` ("Note grid": keys, names, and that Left/Right change the tempo only outside widgets that use arrows)

**Interfaces:**

- Produces in `js/viewHtml.js`:
  - `export function noteCellName(instrument: 'sticking'|'hh'|'tom1'|'tom2'|'snare'|'tom4'|'kick', index: number, ctx: { notesPerMeasure: number, numBeatsPerMeasure: number, numberOfMeasures: number }): string`
    - Instrument words: `Sticking`, `Hi-hat`, `High tom`, `Mid tom`, `Snare`, `Floor tom`, `Kick`.
    - `bar N, ` follows the instrument only when `numberOfMeasures > 1`.
    - When `beatsPerBarFit`: `beat B` for the first note of a beat; then by notes per beat: 2 → `and`; 3 → `and`, `a`; 4 → `e`, `and`, `a`; other counts → `beat B, note K` (K 1-based in the beat, and K = 1 is plain `beat B`). Example: `Snare, beat 2`, `Hi-hat, beat 1 and`, `Kick, bar 2, beat 4 a`.
    - When the bar does not split into whole beats: `note K` (1-based in the bar), e.g. `Snare, note 5`.
  - Each cell (`.hi-hat`, `.tom`, `.snare`, `.kick`, `.sticking`) gets `role="gridcell" tabindex="-1" data-instrument="<instrument>" data-index="<global index>" data-name="<noteCellName>" aria-label="<noteCellName>, off"`.
  - Each lane container (`.stickings-container`, `.hi-hat-container`, `.toms-container`, `.snare-container`, `.kick-container`) gets `role="row"`.
  - Each `.notes-container` gets `role="grid"` and `aria-label`: `Notes, bar N` for the instrument lanes and `Stickings, bar N` for the sticking lane. So a bar has two grids; together they still have one tab stop (below).
- Produces in `js/gridKeyboard.js`:
  - `export function initGridKeyboard(container: HTMLElement, onToggle: (cell: HTMLElement) => void): void` — `container` is `#measureContainer`. Delegated listeners, so a redraw needs no new call.
  - `export function ownsArrowKeys(target: EventTarget | null): boolean` — true when the target is inside `[role="grid"]`, `[role="slider"]`, `[role="listbox"]`, `[role="menu"]`, `input`, `select`, `textarea` or `[contenteditable]`.
  - `export const LANE_ORDER = ['sticking', 'hh', 'tom1', 'tom2', 'snare', 'tom4', 'kick']`.
- Consumes: `markNoteOn(partId, on)` in `groove_writer.js` already runs for every setter. It now also sets `cell.setAttribute('aria-label', cell.dataset.name + (on ? ', on' : ', off'))` on the parent cell.

Key map (all on the focused cell; each handled key calls `preventDefault()` and `stopPropagation()`):

| Key                  | Effect                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Left / Right         | Same instrument, `data-index` − 1 / + 1. Crosses into the next bar, because indices are global. Stops at the ends. |
| Up / Down            | Same `data-index` in the previous / next **visible** lane of `LANE_ORDER`. Stops at the ends.                      |
| Home / End           | First / last cell of the lane in this bar (the first / last `gridcell` in the parent row).                         |
| Ctrl+Home / Ctrl+End | First / last cell of the instrument in the groove.                                                                 |
| Space / Enter        | `onToggle(cell)`                                                                                                   |

Other keys pass through, so Ctrl+Z still undoes. A cell is visible when `cell.getClientRects().length > 0`.

Roving tab stop: exactly one visible cell has `tabindex="0"`. A focus or a click on a cell makes it the stop. A `MutationObserver` on `container` (`childList`, `subtree`, `attributeFilter: ['style', 'class']`) runs a check in the next animation frame: when the stop is gone or hidden, the first visible hi-hat cell (else the first visible cell) becomes the stop. The check is O(1) when the stop is fine, so playback highlight changes cost nothing.

`onToggle` in `main.js`: `(cell) => myGrooveWriter.noteLeftClick(pointAt(cell), cell.dataset.instrument, Number(cell.dataset.index))`, where `pointAt(cell)` returns `{ clientX, clientY }` at the bottom left of the cell's rect, so the advanced edit menu opens next to the cell.

Global Left/Right: in `setupWriterHotKeys`, `case 37` and `case 39` run only when `!ownsArrowKeys(e.target)`. This also stops the old double step on range inputs.

- [ ] **Step 1: Write the failing unit tests in `tests/gridKeyboard.test.js`**

```js
import { noteCellName } from '../js/viewHtml.js';
import { ownsArrowKeys } from '../js/gridKeyboard.js';
const one = { notesPerMeasure: 16, numBeatsPerMeasure: 4, numberOfMeasures: 1 };
it('names a 16th grid by beat and count', () => {
  expect(noteCellName('snare', 4, one)).toBe('Snare, beat 2');
  expect(noteCellName('hh', 5, one)).toBe('Hi-hat, beat 2 e');
  expect(noteCellName('hh', 6, one)).toBe('Hi-hat, beat 2 and');
  expect(noteCellName('kick', 15, one)).toBe('Kick, beat 4 a');
});
it('adds the bar when the groove has more than one', () => {
  expect(noteCellName('tom4', 16, { ...one, numberOfMeasures: 2 })).toBe(
    'Floor tom, bar 2, beat 1'
  );
});
it('names 8ths and 8th triplets', () => {
  expect(
    noteCellName('snare', 3, { notesPerMeasure: 8, numBeatsPerMeasure: 4, numberOfMeasures: 1 })
  ).toBe('Snare, beat 2 and');
  expect(
    noteCellName('snare', 5, { notesPerMeasure: 12, numBeatsPerMeasure: 4, numberOfMeasures: 1 })
  ).toBe('Snare, beat 2 a');
});
it('uses note numbers for other counts and for bars that do not split into beats', () => {
  expect(
    noteCellName('hh', 2, { notesPerMeasure: 32, numBeatsPerMeasure: 4, numberOfMeasures: 1 })
  ).toBe('Hi-hat, beat 1, note 3');
  expect(
    noteCellName('hh', 4, { notesPerMeasure: 6, numBeatsPerMeasure: 4, numberOfMeasures: 1 })
  ).toBe('Hi-hat, note 5');
});
it('knows which targets use the arrow keys', () => {
  document.body.innerHTML =
    '<div role="grid"><div id="c"></div></div><input id="i"><div id="k" role="slider"></div><button id="b"></button>';
  expect(ownsArrowKeys(document.getElementById('c'))).toBe(true);
  expect(ownsArrowKeys(document.getElementById('i'))).toBe(true);
  expect(ownsArrowKeys(document.getElementById('k'))).toBe(true);
  expect(ownsArrowKeys(document.getElementById('b'))).toBe(false);
});
```

- [ ] **Step 2: Write the failing e2e tests in `tests-e2e/grid-keyboard.spec.js`**

```js
test('one Tab from the last tool before the grid reaches the grid', ...)
  // Tab through; the first focused [role=gridcell] is #hi-hat0; count Tab presses
  // from the grid to the next control after it: exactly 1 (one tab stop).
test('the arrows move, and Space sets a note', ...)
  // focus #hi-hat0; ArrowDown -> #snare0 (toms and stickings are hidden by default); ArrowRight x4 -> #snare4;
  // aria-label 'Snare, beat 2, off'; Space -> aria-label 'Snare, beat 2, on' and the URL S= has
  // a note at index 4; Enter -> 'Snare, beat 2, off'.
test('Right at the end of bar 1 goes to bar 2', ...)  // 2-bar groove: #kick15 -> #kick16
test('Home, End, Ctrl+Home and Ctrl+End', ...)
test('Left and Right in the grid do not change the tempo', ...)
  // read utils.getTempo() before and after ArrowLeft/ArrowRight in the grid: equal.
test('Left and Right outside the grid and inputs still change the tempo', ...)
  // focus body (click on an empty music area): ArrowRight -> tempo + 1.
test('Left and Right in the tempo field move the caret only', ...)
test('Space in the grid sets the note while the groove plays and does not stop it', ...)  // Review Focus 1
test('the grid keeps one visible tab stop after a redraw or a hidden lane', ...)          // Review Focus 2
  // focus #snare4; add a bar; exactly one [role=gridcell][tabindex="0"] and it is visible;
  // show toms, focus #tom1-3, hide toms: the stop moves to a visible cell; Tab still reaches the grid.
test('Ctrl+Z in the grid undoes the last note', ...)
```

Add to `a11y.spec.js`: `test('the note grid has no serious or critical axe violation', ...)` with toms and stickings shown, `include: '#measureContainer'`.

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run tests/gridKeyboard.test.js`
Expected: FAIL, "noteCellName is not a function" / cannot find module `../js/gridKeyboard.js`.

Run: `npx playwright test tests-e2e/grid-keyboard.spec.js`
Expected: FAIL, no `[role=gridcell]`.

- [ ] **Step 4: Implement**

`noteCellName` and the markup in `js/viewHtml.js`; `js/gridKeyboard.js` as in Interfaces; the `markNoteOn` line; the `setupWriterHotKeys` guard; the `main.js` call; the modulepreload link after `js/viewHtml.js`; the `eslint.config.js` entry. Focus ring in `css/editor-toolbars.css`: `#musicalInput [role='gridcell']:focus-visible { outline: 3px solid #1f73a8; outline-offset: -3px; }` (inset, so the ring does not cover the next cell or get cut by `overflow-x: clip`).

- [ ] **Step 5: Update the markup snapshot and check the diff**

Run: `npx vitest run tests/groove_writer/html-generation.test.js -u && git diff --stat tests/groove_writer/__snapshots__/`
Expected: PASS. The snapshot diff adds only `role`, `tabindex`, `data-instrument`, `data-index`, `data-name`, `aria-label` and `aria-label` on the grids.

- [ ] **Step 6: Run the tests to see them pass**

Run: `npx vitest run tests/gridKeyboard.test.js tests/preload.test.js && npx playwright test tests-e2e/grid-keyboard.spec.js tests-e2e/a11y.spec.js`
Expected: all PASS.

- [ ] **Step 7: Full checks and commit**

Run: `npm run verify:fast && npm run test:e2e:verify`
Expected: both exit 0; golden master byte-identical.

```bash
git add js/gridKeyboard.js js/viewHtml.js js/groove_writer.js js/main.js css/editor-toolbars.css index.html eslint.config.js tests/gridKeyboard.test.js tests/groove_writer/__snapshots__ tests-e2e/grid-keyboard.spec.js tests-e2e/a11y.spec.js docs/editor.md
git commit -m "Let the keyboard and screen readers use the note grid"
```

---

### Task 3: Landmarks, one H1, panel tab order and 320 px reflow

**Files:**

- Modify: `index.html` (structure only)
- Modify: `js/sidePanel.js` (where the panel goes in the DOM)
- Modify: `css/editor-toolbars.css` (`.visually-hidden`, `#GrooveWriter { min-width: 0 }`, narrow grid scroll)
- Modify: `GrooveEmbed.html` (`<main>` around the display)
- Modify: `tests/sidePanel.test.js` (placement), `tests-e2e/a11y.spec.js`
- Modify: `docs/editor.md` ("Editor bars": landmarks; "Side panel and tabs": DOM place; the 320 px grid line)

**Interfaces:**

- Produces the editor page outline (ids and classes stay, so CSS and tests keep working):
  ```
  div#GrooveWriter
    div.nonPrintable > header#TopNav           (banner; first child: <h1 class="visually-hidden">Groove Scribe</h1>)
    [div.side-panel-backdrop, aside#sidePanel] (inserted here by sidePanel.js: complementary)
    main#editorMain
      div.nonPrintable > div#ToolBar + the toolbar popovers (#divisionPopover, #detailsPopover, #morePopover)
      div#RightHandContent ... (unchanged)
      the old context menus and popups (unchanged markup, moved inside main)
    div.nonPrintable > section#PlaybackBar[aria-label="Playback"] + #swingPopover
  ```
- `sidePanel.js`: `document.getElementById('TopNav')?.closest('.nonPrintable')?.after(backdrop, panel)`; fall back to `document.body.append(backdrop, panel)` when there is no `#TopNav` (unit tests, other pages).
- `.visually-hidden` is the same rule as `.part-play-status` today. `.part-play-status` keeps its own rule (one home is `css/part-play.css`; no change there).
- `GrooveEmbed.html`: `<main id="embed"></main>`, and the module script calls `GrooveDisplay.AddGrooveDisplayToElementId('embed', location.search, true, true)` on `load` instead of `AddGrooveDisplayToPage`. No `h1`: the embed is a part of another page.
- Below 480 px the grid scrolls sideways inside `#musicalInput` (`overflow-x: auto` there) instead of clipping cells. The page itself never scrolls sideways. Focus on a cell (Task 2) scrolls it into view.

- [ ] **Step 1: Write the failing tests**

In `tests-e2e/a11y.spec.js`:

```js
const LANDMARK_RULES = ['region', 'landmark-one-main', 'landmark-unique', 'landmark-no-duplicate-banner',
  'landmark-banner-is-top-level', 'landmark-main-is-top-level', 'landmark-complementary-is-top-level',
  'page-has-heading-one'];
for (const [name, url] of [['editor', '/index.html'], ['help', '/gscribe_help.html'], ['about', '/gscribe_about.html']]) {
  test(`${name} passes the landmark and heading rules`, async ({ page }) => {
    // also with the Grooves tab open on the editor
    const ids = (await axeScan(page)).map((v) => v.id);
    expect(ids.filter((id) => LANDMARK_RULES.includes(id))).toEqual([]);
  });
}
test('the embed content is in a main landmark', ...)   // 'region' and 'landmark-one-main' only
test('the panel comes before the tools in the tab order', async ({ page }) => {
  // 1440x900, open the Grooves tab (docked). Tab from the start of the page and record the order.
  // index(first element inside #sidePanel) < index(#timeLabel) < index(first gridcell) < index(Play)
});
test('the overlay panel paints above the bars', async ({ page }) => {   // Review Focus 5
  // 1024x768, open Grooves: elementFromPoint at the centre of #sidePanel is inside #sidePanel,
  // and elementFromPoint at the centre of #PlaybackBar is the backdrop.
});
test('the docked panel does not move the layout', ...)
  // 1440x900 Grooves docked: #ToolBar left edge == #sidePanel right edge, as before the change.
for (const size of [[320, 640], [768, 1024], [1024, 768], [1440, 900]]) {
  test(`no sideways page scroll at ${size[0]} px`, async ({ page }) => {
    // documentElement.scrollWidth <= documentElement.clientWidth, with and without the Grooves tab open
  });
}
test('at 320 px every cell of bar 1 can be reached and seen', ...)
  // focus #hi-hat0, press End: #hi-hat15 is focused and its rect is inside the viewport.
```

In `tests/sidePanel.test.js`: `it('puts the panel right after the top bar', ...)` with `document.body.innerHTML = '<div class="nonPrintable"><div id="TopNav"><span id="upperLeft"></span></div></div><main></main>'`, expect `document.querySelector('main').previousElementSibling.id` to be `sidePanel`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx playwright test tests-e2e/a11y.spec.js -g "landmark|tab order|sideways|320|embed content|overlay|docked" && npx vitest run tests/sidePanel.test.js`
Expected: FAIL on `landmark-one-main`, `page-has-heading-one`, `region`, the tab order and the 320 px tests. Note which element gives the sideways scroll at 320 px (`[...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth)`); `#GrooveWriter` with `min-width: 800px` is the expected one. If another element shows up, fix it in the same task.

- [ ] **Step 3: Implement**

The outline from Interfaces; the `sidePanel.js` line; the CSS. `#PlaybackBar` and `#TopNav` change only their tag; check that nothing in `css/` selects them by tag.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx playwright test tests-e2e/a11y.spec.js && npx vitest run tests/sidePanel.test.js`
Expected: all PASS.

- [ ] **Step 5: Look at the UI**

1024x768, 768x1024, 1440x900, 320x640, with the panel closed, docked and overlaid. Pixel-compare with master: nothing moves. At 320 px the grid scrolls sideways inside its area.

- [ ] **Step 6: Full checks and commit**

Run: `npm run verify:fast && npm run test:e2e:verify`
Expected: both exit 0.

```bash
git add index.html GrooveEmbed.html js/sidePanel.js css/editor-toolbars.css tests/sidePanel.test.js tests-e2e/a11y.spec.js docs/editor.md
git commit -m "Add landmarks and a heading, put the side panel before the tools, and stop sideways scroll at 320 px"
```

---

### Task 4: Focus for popovers, menus and popups

**Files:**

- Modify: `js/editorChrome.js` (`initPopovers`; new `initContextMenus`, `initPopups`)
- Modify: `js/main.js` (call the two new functions once, next to `initPopovers()`)
- Modify: `index.html` (`aria-haspopup`/`aria-expanded` on three menu buttons; dialog roles and names on three popups; the share close control becomes a `button`)
- Modify: `css/groove_writer_orange.css` or `css/editor-toolbars.css` (reset for the new close `button`; focus ring for `[role=menuitem]`)
- Create: `tests-e2e/menus-keyboard.spec.js`
- Modify: `tests-e2e/a11y.spec.js` (open menu and open popup scenarios)
- Modify: `docs/editor.md` ("Editor bars": how popovers and menus take focus)

**Interfaces:**

- Produces in `js/editorChrome.js`:
  - `function lastInputWasKeyboard(): boolean` (module private) — set by capture listeners: `keydown` → true, `pointerdown` → false.
  - `initPopovers()` (changed): on open, when `lastInputWasKeyboard()`, focus the first visible focusable element in the popover. When an item with `data-popover-close` closes it, focus goes back to the trigger. A `focusout` to an element outside the popover and its trigger closes it and leaves focus where it went. A pointer open does not move focus (the tablet flow and "a tapped button must not keep focus" stay as they are).
  - `export function initContextMenus(utils): void` — wraps `utils.showContextMenu` and `utils.hideContextMenu` (the same wrap pattern as `utils.tempoUpdate`). On show: the `ul` gets `role="menu"`; each `li` that is not hidden gets `role="menuitem" tabindex="-1"`; `#userMenuName` gets `role="menuitem" aria-disabled="true"` so the signed-in name is read. The opener is `document.activeElement` at show time (when it is not `body`). If the opener has `aria-haspopup`, it gets `aria-expanded="true"`. When `lastInputWasKeyboard()`, focus the first enabled item. Keys in the menu: Up/Down (wrap), Home/End, Enter/Space → `item.click()`, Escape → hide and focus the opener, Tab → hide. On hide: the opener gets `aria-expanded="false"`; if focus was in the menu, it goes back to the opener. A sub-menu (Metronome options → Offset click) keeps the first opener.
  - `export function initPopups(): void` — for `#timeSigPopup`, `#fullURLPopup`, `#metronomeAutoSpeedupConfiguration`: a `MutationObserver` on each popup's `style` sees it open and close. On open: remember the opener (`document.activeElement`), focus the first control (`#timeSigPopupTimeSigTop`; `#fullURLPopupTextField` is focused by the writer already; `#metronomeAutoSpeedUpKeepGoingForever`). Escape closes through the popup's own Cancel/close path (`timeSigPopupClose('cancel')`, `close_FullURLPopup()`, `close_MetronomeAutoSpeedupConfiguration('ok')`). On close, focus goes back to the opener if focus was in the popup or on `body`. No focus trap (non-modal).
- `index.html`:
  - `#stickingsButton`, `#helpAnchor`, `#metronomeOptionsAnchor`: `aria-haspopup="menu" aria-expanded="false"`. Check that `libraryPanel.js` does not remove them when it makes `#helpAnchor` the account button.
  - Popups: `role="dialog"` and `aria-labelledby` the title (`#timeSigPopupTitle`, `#fullURLPopupTitle`); the speed-up popup gets `aria-label="Auto speed up"`.
  - Names: `#timeSigPopupTimeSigTop` `aria-label="Beats in a bar"`, `#timeSigPopupTimeSigBottom` `aria-label="Note value of a beat"`, `#fullURLPopupTextField` `aria-label="Groove link"`.
  - `#fullURLPopupCloseButton` becomes `<button type="button" aria-label="Close">` with the same icon; CSS resets the button (no border, no background, same size and place).

- [ ] **Step 1: Write the failing tests in `tests-e2e/menus-keyboard.spec.js`**

```js
test('Enter on a popover button moves focus to its first item, and Escape returns it', ...)
  // focus #divisionMenuButton by Tab, Enter: :focus is #subdivision_8ths; Escape: :focus is the button,
  // aria-expanded="false".
test('a popover item that closes it returns focus to its button', ...)  // Enter on 1/8 notes
test('Tab out of a popover closes it', ...)
test('a tap on a popover button does not move focus', ...)  // mouse click: :focus is not inside the popover
test('Stickings opens a menu by keyboard', ...)
  // Tab to #stickingsButton (aria-expanded false), Enter: aria-expanded true, :focus has role menuitem
  // "Show or Hide stickings"; ArrowDown -> "Reverse stickings R/L"; ArrowDown wraps to the first;
  // Enter on the first shows the sticking lane; focus is back on #stickingsButton, aria-expanded false.
test('Metronome options and its sub-menu work by keyboard', ...)
  // Offset click opens the second menu; Escape there returns focus to #metronomeOptionsAnchor.
test('Help menu items open by keyboard', ...)  // Enter on Help navigates to gscribe_help.html
test('Enter on a cell in advanced edit opens the note menu next to the cell', ...)  // Review Focus 3
  // turn on advanced edit; focus #snare4; Enter: #snareContextMenu visible, its top within 60 px of
  // the cell's bottom; ArrowDown + Enter picks an item; the cell's aria-label ends with ", on";
  // :focus is #snare4.
test('the time signature popup takes focus, Escape cancels and returns it', ...)
  // Enter on #timeLabel: :focus is #timeSigPopupTimeSigTop; Escape: popup hidden, :focus #timeLabel,
  // time signature unchanged.
test('the share popup closes with its Close button and returns focus to Share', ...)
```

In `a11y.spec.js`: axe with the Stickings menu open, the time signature popup open and the share popup open: `seriousOrWorse` is empty.

- [ ] **Step 2: Run them to see them fail**

Run: `npx playwright test tests-e2e/menus-keyboard.spec.js`
Expected: FAIL; focus stays on the buttons, menus have no `menuitem`.

- [ ] **Step 3: Implement**

As in Interfaces. Keep each function small; the old menus stay in `groove_utils.js`/`groove_writer.js` unchanged apart from the wrap.

- [ ] **Step 4: Run them to see them pass**

Run: `npx playwright test tests-e2e/menus-keyboard.spec.js tests-e2e/a11y.spec.js tests-e2e/editor-toolbars.spec.js`
Expected: all PASS (the toolbar spec guards the existing popover behaviour).

- [ ] **Step 5: Look at the UI**

Open each menu and popup with the mouse and by keyboard at 1024x768 and 768x1024: same place and look as before, a visible ring only after keyboard use.

- [ ] **Step 6: Full checks and commit**

Run: `npm run verify:fast && npm run test:e2e:verify`
Expected: both exit 0.

```bash
git add js/editorChrome.js js/main.js index.html css/ tests-e2e/menus-keyboard.spec.js tests-e2e/a11y.spec.js docs/editor.md
git commit -m "Move focus into popovers, menus and popups opened by keyboard and back on close"
```

---

### Task 5: Part play beats and the bar buttons by keyboard

**Files:**

- Modify: `js/partPlay.js` (`extend` event in `nextSelection`)
- Modify: `js/partPlayControl.js` (keyboard on the ruler beats; `aria-selected`)
- Modify: `js/viewHtml.js` (`barRulerHTML` roles and names; add and remove bar become `button`s)
- Modify: `css/part-play.css` (beat focus ring), `css/editor-toolbars.css` (button reset for the bar buttons)
- Modify: `tests/partPlay.test.js`, `tests/partPlayControl.test.js`, `tests/groove_writer/__snapshots__/html-generation.test.js.snap` (via `-u`)
- Modify: `tests-e2e/part-play.spec.js`, `tests-e2e/a11y.spec.js`
- Modify: `docs/editor.md` ("Part play": the keys; the add and remove bar buttons)

**Interfaces:**

- Produces in `js/partPlay.js`: `RulerEvent` gains `{ type: 'extend', from: number, to: number }`. `nextSelection(state, { type: 'extend', from, to })` returns `{ range: normalizeRange(fixed, to), anchor: null }`, where `fixed` is:
  - `state.anchor` when it is not null;
  - else `state.range.first` when `from === state.range.last`;
  - else `state.range.last` when `from === state.range.first`;
  - else `from`.
- Produces in `barRulerHTML`: `.bar-ruler-beats` gets `role="listbox" aria-multiselectable="true" aria-label="Beats of bar N"`. Each `.bar-ruler-beat` gets `role="option" tabindex="-1" aria-selected="false" aria-label="Bar N, beat B"`. The `.bar-ruler-bar` button keeps its text and title.
- Produces in `partPlayControl.js`: one tab stop across all rulers (roving `tabindex`): the first selected beat, else the last focused beat, else beat 0. `markRulers` also sets `aria-selected` and moves the stop. Keys on a focused beat (handled keys call `preventDefault` and `stopPropagation`):

| Key                      | Effect                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Left / Right             | Focus the previous / next beat, also across bars. No change to the selection.                                   |
| Home / End               | Focus the first / last beat of the groove.                                                                      |
| Enter / Space            | `apply({ type: 'tap', beat })` — the same state machine as a tap, so a second press on the selection clears it. |
| Shift+Left / Shift+Right | Move focus, then `apply({ type: 'extend', from: oldBeat, to: newBeat })`.                                       |

The status region speaks after each key change (`press` is null, so `announce` runs already).

- Produces in `buildStaffContainerHTML`: `#addMeasureButton` is `<button type="button" id="addMeasureButton" aria-label="Add a bar">` (at the limit: `aria-disabled="true"` and `aria-label="Add a bar. The limit is N bars"`). Each `closeMeasureButton[id]` is `<button type="button" aria-label="Remove bar N">`. The empty placeholder stays a `span` with `aria-hidden="true"`. The `title`s stay. CSS resets the buttons so they look and measure as today (44 px) and adds a `:focus-visible` ring.

- [ ] **Step 1: Write the failing unit tests**

`tests/partPlay.test.js`:

```js
describe('nextSelection extend', () => {
  const none = { range: null, anchor: null };
  it('starts a range at the focused beat', () =>
    expect(nextSelection(none, { type: 'extend', from: 3, to: 4 })).toEqual({
      range: { first: 3, last: 4 },
      anchor: null,
    }));
  it('grows from the last beat', () =>
    expect(
      nextSelection(
        { range: { first: 2, last: 5 }, anchor: null },
        { type: 'extend', from: 5, to: 6 }
      ).range
    ).toEqual({ first: 2, last: 6 }));
  it('grows from the first beat', () =>
    expect(
      nextSelection(
        { range: { first: 2, last: 5 }, anchor: null },
        { type: 'extend', from: 2, to: 1 }
      ).range
    ).toEqual({ first: 1, last: 5 }));
  it('shrinks from the last beat', () =>
    expect(
      nextSelection(
        { range: { first: 2, last: 5 }, anchor: null },
        { type: 'extend', from: 5, to: 4 }
      ).range
    ).toEqual({ first: 2, last: 4 }));
  it('keeps a first tap as the fixed end', () =>
    expect(
      nextSelection({ range: { first: 3, last: 3 }, anchor: 3 }, { type: 'extend', from: 3, to: 1 })
    ).toEqual({ range: { first: 1, last: 3 }, anchor: null }));
  it('starts again from a beat outside the range', () =>
    expect(
      nextSelection(
        { range: { first: 2, last: 5 }, anchor: null },
        { type: 'extend', from: 8, to: 9 }
      ).range
    ).toEqual({ first: 8, last: 9 }));
});
```

`tests/partPlayControl.test.js`: `it('marks selected beats with aria-selected and keeps one tab stop', ...)`.

- [ ] **Step 2: Write the failing e2e tests in `tests-e2e/part-play.spec.js`**

```js
test('the ruler beats are one tab stop', ...)
  // FOUR_BARS: Tab from "Bar 1" goes to one beat; the next Tab goes to "Bar 2", not to beat 2.
test('Enter selects a beat, and Enter on another beat selects the beats between', ...)
  // focus beat 0, Enter, Right x5, Enter: shaded == range(0, 23); chip says what plays;
  // #partPlayStatus has the label text.
test('Shift+Right extends the selection across a bar', ...)
  // focus beat 3, Shift+Right x2: selection beats 3..5 (cells 12..23).
test('Enter on the selection clears it', ...)
test('arrow keys on the ruler do not change the tempo, and Space does not play', ...)
test('the add and remove bar buttons work by keyboard', ...)
  // Tab to "Add a bar", Enter: 2 bars; Tab to "Remove bar 2", Enter: 1 bar.
```

`a11y.spec.js`: axe on `FOUR_BARS` with a selection: `seriousOrWorse` empty (checks the listbox and option roles).

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run tests/partPlay.test.js tests/partPlayControl.test.js && npx playwright test tests-e2e/part-play.spec.js`
Expected: FAIL; `extend` returns `{ range: null, anchor: null }`; beats are not focusable.

- [ ] **Step 4: Implement, then update the markup snapshot**

Run: `npx vitest run tests/groove_writer/html-generation.test.js -u`
Expected: PASS. The diff shows only the ruler roles and names and the two `button`s.

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx vitest run tests/partPlay.test.js tests/partPlayControl.test.js && npx playwright test tests-e2e/part-play.spec.js tests-e2e/a11y.spec.js`
Expected: all PASS, also the existing pointer tests.

- [ ] **Step 6: Look at the UI**

1024x768 and 768x1024: the add and remove bar buttons look and sit as before; a ring shows on keyboard focus. The beat ring does not hide the beat number.

- [ ] **Step 7: Full checks and commit**

Run: `npm run verify:fast && npm run test:e2e:verify`
Expected: both exit 0.

```bash
git add js/partPlay.js js/partPlayControl.js js/viewHtml.js css/part-play.css css/editor-toolbars.css tests/partPlay.test.js tests/partPlayControl.test.js tests/groove_writer/__snapshots__ tests-e2e/part-play.spec.js tests-e2e/a11y.spec.js docs/editor.md
git commit -m "Select part play beats and add or remove bars by keyboard"
```

---

### Task 6: Groove lists by keyboard, then smoke screenshots

**Files:**

- Modify: `js/grooves.js` (`arrayAsHTMLList`)
- Modify: `css/editor-toolbars.css` (Grooves list: the heading and the row button look as today's `li`s)
- Modify: `js/cloud/libraryPanel.js` (Escape in an open ⋯ menu)
- Modify: `tests/grooves/*` (existing list test, if it pins the markup), `tests-e2e/a11y.spec.js`, `tests-cloud/library.spec.js`
- Modify: `tests-e2e/smoke.spec.js-snapshots/home-chromium-linux.png`, `rock16-chromium-linux.png` (regenerated)
- Modify: `docs/library.md` ("The panel": Escape in a ⋯ menu), `docs/editor.md` ("Side panel and tabs": the Grooves list), `docs/testing.md` (the a11y suite in the table)

**Interfaces:**

- Produces in `grooves.js`: each group is `<h3 class="grooveListHeader">Rock grooves</h3><ul class="grooveListUL">…</ul>` (no `ul` directly in a `ul`). Each groove is `<li class="grooveListLI" data-groove="…"><button type="button" class="grooveListButton">Name</button></li>`. `main.js` keeps `closest('.grooveListLI')`, so its click code does not change. The old `.grooveListHeaderLI` rules move to `.grooveListHeader` (margin and font reset, same look).
- Produces in `libraryPanel.js`: the window capture `keydown` listener also handles Escape when the target is inside an open row menu or on its ⋯: `openMenu = null`, `render()`, focus goes to that row's ⋯ (through the `data-focus` key `more`), and `stopPropagation()` so an overlay panel stays open.
- Smoke PNGs: made again once here, after the last visual change.

- [ ] **Step 1: Write the failing tests**

`tests-e2e/a11y.spec.js`:

```js
test('the Grooves tab has no serious or critical axe violation', ...)  // was 'list' before
test('a groove in the Grooves tab opens by keyboard', async ({ page }) => {
  // 1024x768: Tab to the Grooves tab, Enter; Tab to the first groove button; Enter:
  // the editor shows that groove (URL changes), the panel closes and focus is on the Grooves tab.
});
```

`tests-cloud/library.spec.js`, in the lesson and groove menu `describe`:

```js
test('Escape in a groove menu closes it, focus goes to ⋯, and the panel stays open', async ({ page }) => {
  // signedInPanel; addLink; open the groove ⋯ (aria-expanded true); focus Rename; Escape:
  // no .lp-actions in the row, ⋯ is focused with aria-expanded false, #sidePanel still open
  // (also at 1024 px, where the panel is an overlay).
});
test('the signed-in library has no serious or critical axe violation', ...)
  // with a lesson open and a groove menu open
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx playwright test tests-e2e/a11y.spec.js -g "Grooves"`
Expected: FAIL (`list` violation; no focusable groove).

Run: `npx firebase emulators:exec --only auth,firestore --project demo-groovescribe 'npx playwright test --config playwright.cloud.config.js -g "Escape in a groove menu|signed-in library has no"'`
Expected: FAIL; Escape closes the overlay panel or leaves the menu open.

- [ ] **Step 3: Implement**

As in Interfaces.

- [ ] **Step 4: Run them to see them pass**

Run the two commands of Step 2 again.
Expected: all PASS.

- [ ] **Step 5: Look at the UI**

The Grooves tab at 1024x768 and 1440x900 looks as before (headings, row height, hover); keyboard focus shows the `#sidePanel :focus-visible` ring.

- [ ] **Step 6: Make the smoke screenshots again**

Run the Docker command from `docs/testing.md` ("Smoke screenshots") with `--update-snapshots=all`.
Expected: two new PNGs. Open both: only the blue and the grey of off notes changed.

- [ ] **Step 7: Full checks and commit**

Run: `npm run verify:fast && npm run test:e2e:verify && npm run test:cloud`
Expected: all exit 0.

```bash
git add js/grooves.js js/cloud/libraryPanel.js css/editor-toolbars.css tests/ tests-e2e/a11y.spec.js tests-cloud/library.spec.js tests-e2e/smoke.spec.js-snapshots/*-chromium-linux.png docs/
git commit -m "Open grooves from the Grooves tab by keyboard and close a library menu with Escape"
```

Then check `git status`: no `*-chromium-darwin*` file is staged or left.

---

## Decisions to confirm

- One blue token `#1f73a8` (the part play blue) for all of `#2484c0`, not a new `#1f78b0`.
- Off symbols, off stickings and note borders all use `#8c8c8c`.
- Cell names say only `on` or `off`, not the articulation (accent, ghost, open). Articulations are in the note menu.
- Each bar has two `role="grid"` elements (notes and stickings) that share one tab stop, because a grid cannot hold the ruler and bar buttons. Up and Down move between them.
- Popovers and menus move focus in only when opened by keyboard. A tap leaves focus where it is, as the "a tapped button must not keep focus" rule needs.
- Popups are non-modal dialogs: no focus trap.
- Below 480 px the grid scrolls sideways inside its area instead of clipping cells.
- The embed gets `lang`, names, a `main` and a focusable Play, but no `h1`. Its metronome menu and expand icons stay mouse-only (not in scope).
- The audit's "Left and Right change the groove" is the tempo; the fix scopes it out of every widget that uses arrows, also range inputs.
