# Scoped Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Library, Permutations and Grooves become tabs in the top bar that open one left panel. Save, Share and ⋯ move to the bar above the notes. The bottom bar holds the metronome only.

**Architecture:** A new editor module `js/sidePanel.js` owns the tabs, the panel, open/close, the tab memory, and the switch between docked and overlay. It exists in every editor mode. `js/cloud/libraryPanel.js` stops owning a panel: it fills the Library section of the side panel. The Grooves list and the permutation options move into their own sections. CSS docks the panel at full height under the top bar, and starts the tools bar and the playback bar at its right edge.

**Tech Stack:** Native ES modules, no build. Vitest (jsdom), Playwright (`tests-e2e/`, `tests-cloud/`).

**Spec:** `docs/superpowers/specs/2026-11-15-toms-layout-part-play-design.md`, Part 2.

## Global Constraints

- SVG and MIDI output stay byte-identical (golden master, no new baselines). Never commit `*-chromium-darwin*` files.
- Touch targets are at least 44 px. Check at 1024x768, 768x1024 and 1440x900.
- User-facing text is Simplified Technical English.
- Do not edit vendored files. Do not edit the player markup shared with the embed pages. Editor-only player changes go through `initPlaybackControls` in `js/editorChrome.js`.
- A new `js/*.js` module goes into the module list in `eslint.config.js` and into `ITEMS` in `scripts/build-www.mjs`.
- The docked/overlay breakpoint stays 1100 px, in one CSS place and one JS constant.
- The playback bar keeps the PR 14 sizes (`--bar-playback-height` 96 px, `--playback-touch` 56 px).
- No dropdown for Library, Permutations or Grooves.
- When the panel is closed, the notes get at least the room they have today.
- Copy, verbatim: tab labels `Library`, `Permutations`, `Grooves`. Panel titles `My library`, `Permutations`, `Grooves`. Close button label `Close panel`. Permutations message `Permutations work in 4/4 time only.`
- Ids that stay: `#libraryPanel` (now the Library section), `#grooveListWrapper`, `#PermutationOptions`, `#saveButton`, `#shareSaveButton`, `#moreButton`. Ids that go: `#libraryToggle`, `#libraryBackdrop`, `#lpClose`, `#lpTitle`, `#groovesAnchor`, `#permutationAnchor`, `#permutationContextMenu`. New ids: `#sidePanel`, `#sidePanelBackdrop`, `#sidePanelTitle`, `#sidePanelClose`, `#libraryTab`, `#permutationsTab`, `#groovesTab`, `#permutationsPanel`, `#groovesPanel`.
- Storage: `grooveScribe.libraryOpen` keeps its meaning (the docked panel is open), and is read and written only by `sidePanel.js` from now on. New key: `grooveScribe.panelTab` (the last tab). Every storage access is in try/catch.

## Review Focus

1. **A user who had the docked library open** opens the page after the update: the panel opens on the Library tab, as before (key `grooveScribe.libraryOpen`, no `panelTab` saved yet). Test in Task 1.
2. **Turning the tablet** while the panel is open: docked → overlay closes it, and back to docked restores it. Today's `followScreenWidth` rule. Test in Task 1.
3. **grooveDB authoring and the native app** have no library: the tabs are Permutations and Grooves, and nothing throws. Test in Task 1.
4. **Space plays while the docked panel is open:** after a pick in the docked panel, focus leaves the panel. In overlay mode, a pick closes the panel and focus goes to its tab. Test in Tasks 1 and 3.
5. **A groove with unsaved edits:** a pick in the Grooves tab still asks first, then loads. Test in Task 3.

---

### Task 1: The side panel shell, with the Grooves tab

**Files:**

- Create: `js/sidePanel.js`. Add it to `eslint.config.js` and to `ITEMS` in `scripts/build-www.mjs`.
- Create: `css/side-panel.css`, linked in `index.html` after `css/editor-toolbars.css`, and added to `ITEMS`. It holds the panel, backdrop, header and tab rules, moved from `css/library-panel.css` (the `#libraryPanel` position, size, transition and dock rules, renamed to `#sidePanel`; `--library-width` becomes `--side-panel-width: 300px`). The `--lp-*` colour tokens move to `#sidePanel`, so every tab uses them.
- Modify: `js/main.js`: create the side panel before `initLibraryPanel`. Move the groove list into the Grooves section. Call `start` once, after the library has registered.
- Modify: `index.html`: remove `#groovesAnchor`. `#grooveListWrapper` moves into the Grooves section (`sidePanel.section('grooves')`).
- Modify: `css/editor-toolbars.css` (about lines 1127–1160): `#grooveListWrapper` is no longer a popup. It fills its section, with no fixed height and no z-index.
- Test: `tests/sidePanel.test.js` (new), plus updates to the e2e specs that use `#groovesAnchor`: `editor-toolbars`, `interaction`, `functional`, `unsaved-edits` and `smoke`.

**Interfaces:**

- Produces: `createSidePanel({ tabs })`. `tabs` is `Array<{ id: 'library'|'permutations'|'grooves', label: string, title: string, icon: string }>`, in display order. It returns:
  - `section(id) → HTMLElement`: ids `libraryPanel`, `permutationsPanel`, `groovesPanel`.
  - `show(id, { byUser = true } = {})`: opens the panel on that tab.
  - `close()`
  - `toggle(id)`: shows the tab, or closes the panel when that tab is already shown.
  - `isOpen() → boolean`
  - `activeTab() → string | null`: null when the panel is closed.
  - `isDocked() → boolean`
  - `onShow(fn: (id, { byUser: boolean }) => void)`: called each time a tab becomes visible.
  - `afterPick()`: in overlay mode, closes the panel and focuses the tab. When docked, it blurs focus inside the panel.
  - `start({ defaultOpen: boolean, defaultTab: string })`: applies the stored state once. When docked, it opens if `grooveScribe.libraryOpen` is `'true'`, or if nothing is stored and `defaultOpen` is true. The tab is `grooveScribe.panelTab` when that is a known tab, else `defaultTab`. It calls `onShow` with `byUser: false`.
- Panel open sets `body.side-panel-open` and dispatches `resize` (the music redraws to its width). A tab button has `aria-controls="sidePanel"` and `aria-pressed` (true while that tab is shown). Keydown inside the panel stops propagation, so the editor hotkeys stay out. Escape closes an overlay panel. Docked, focus stays on the page.

- [ ] **Step 1: Write the failing tests** in `tests/sidePanel.test.js`. Stub `matchMedia` with a controllable `matches` and a `change` event, and stub `localStorage`.
  - `it('puts one tab button per tab in #upperLeft, in order')`: labels `Library`, `Permutations`, `Grooves`.
  - `it('toggle opens a tab, and toggle on the shown tab closes the panel')`: check `aria-pressed`, `#sidePanelTitle` text, `body.side-panel-open` and `activeTab()`.
  - `it('start opens the docked panel on the stored tab')`: `libraryOpen = 'true'` and `panelTab = 'grooves'` give the Grooves tab open.
  - `it('start keeps an old library user on the Library tab')`: `libraryOpen = 'true'` and no `panelTab` give Library (Review Focus 1).
  - `it('start opens nothing in overlay mode')`
  - `it('closes on a turn to overlay and comes back on a turn to docked')` (Review Focus 2).
  - `it('works without a library tab')`: with tabs Permutations and Grooves only, a stored `panelTab = 'library'` falls back to `defaultTab` (Review Focus 3).
  - `it('afterPick closes the overlay and focuses the tab, and blurs when docked')` (Review Focus 4).
  - `it('survives storage that throws')`
- [ ] **Step 2: Run** `npx vitest run tests/sidePanel.test.js`. Expected: FAIL, because the module does not exist.
- [ ] **Step 3: Implement** `js/sidePanel.js`, `css/side-panel.css` and the Grooves move. The groove click handler in `main.js` (about line 167) stays delegated on `#grooveListWrapper`. It keeps the unsaved-edits ask. After the load it calls `sidePanel.afterPick()`. It no longer hides a popup.
- [ ] **Step 4: Update the e2e specs** that opened the Grooves popup, so they open `#groovesTab`. Add `test('the Grooves tab lists the grooves and a pick loads one')` and `test('a pick with unsaved edits asks first')` to `tests-e2e/unsaved-edits.spec.js` (Review Focus 5).
- [ ] **Step 5: Run** `npx vitest run` and `npm run test:e2e:verify`. Expected: all pass, and the golden master too.
- [ ] **Step 6: Commit** with `npm run verify:fast` green. Message: "Add a side panel with tabs, and move the groove list into it".

---

### Task 2: The library in the side panel

**Files:**

- Modify: `js/cloud/libraryPanel.js`:
  - `initLibraryPanel` takes a new `sidePanel` option.
  - It puts the library body (today's `PANEL_HTML`, without its `lp-head` header) into `sidePanel.section('library')`.
  - It removes its own toggle, backdrop, `setOpen`, `docked`, `keepOpen`, `readKeepOpen`, `writeKeepOpen`, `followScreenWidth` and the Escape handler. `sidePanel.js` owns all of these now.
  - `openPanel()` becomes `sidePanel.show('library')`. `closePanel()` becomes `sidePanel.close()`. `panel.classList.contains('open')` becomes `sidePanel.activeTab() === 'library'`. `afterPick` uses `sidePanel.afterPick()`. Focus rules that read `docked.matches` read `sidePanel.isDocked()`.
  - `connect()` runs on `onShow('library', …)`. With `byUser: false` (the panel opened by itself at start), it keeps today's wait: `setLoading(true)`, then `whenReady` → `whenIdle` → connect if Library is still shown.
  - The `#library` hash calls `sidePanel.show('library')`.
  - Export `hasRememberedUser() → boolean` for `main.js` (`defaultOpen`).
- Modify: `js/main.js`: pass `sidePanel` to `initLibraryPanel`, and call `sidePanel.start({ defaultOpen: hasRememberedUser(), defaultTab: 'library' })`. Without the library, the call is `start({ defaultOpen: false, defaultTab: 'grooves' })`.
- Modify: `js/editorChrome.js:60`: change `#libraryToggle` to `.panel-tab` in the selector.
- Modify: `css/library-panel.css`: only the library content rules stay. The position, dock, transition and print rules moved in Task 1.
- Test: `tests/cloud/library.test.js` (`libraryToggle` becomes `libraryTab`), `tests-cloud/*.spec.js` (`#libraryPanel.open` becomes `#libraryPanel:visible` or `#libraryTab[aria-pressed="true"]`, and `#libraryBackdrop` becomes `#sidePanelBackdrop`), and `tests/cloud/*` for the moved open state.

**Interfaces:**

- Consumes: the Task 1 `createSidePanel` API.
- Produces: `initLibraryPanel({ search, editor, dirtyState, initSaveButton, whenReady, sidePanel })` and `hasRememberedUser()`.

- [ ] **Step 1: Update the tests first.** `tests/cloud/library.test.js` builds a side panel and passes it in. Add:
  - `it('connects when the Library tab is shown, not before')`
  - `it('Save opens the Library tab and the save form')`
  - `it('a docked panel that opens by itself waits for the sound before it connects')`
- [ ] **Step 2: Run** `npx vitest run tests/cloud/`. Expected: FAIL.
- [ ] **Step 3: Implement the changes listed under Files.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run test:cloud` and `npm run test:e2e:verify`. Expected: all pass.
- [ ] **Step 5: Commit**: "Show the library as a tab of the side panel".

---

### Task 3: The Permutations tab

**Files:**

- Modify: `js/groove_writer.js`:
  - `permutationAnchorClick` (about line 788) and the `#permutationAnchor` handling go away.
  - `setupPermutationMenu` (about line 998) redraws the Permutations section instead of enabling the anchor.
  - `permutationPopupClick(type)` (about line 1022) stays the action. It no longer selects an anchor button: it marks the chosen choice button with `aria-pressed`.
- Modify: `js/viewHtml.js`: add `buildPermutationChoiceHTML(activeType, isFourFour)`. In 4/4 it returns three buttons, `None`, `Kick`, `Snare`, each calling `myGrooveWriter.permutationPopupClick('none' | 'kick_16ths' | 'snare_16ths')`. Otherwise it returns `<p>Permutations work in 4/4 time only.</p>`.
- Modify: `index.html`: remove `#permutationAnchor` and `#permutationContextMenu`. `#PermutationOptions` moves from `#RightHandContent` into the Permutations section, below the choice. `main.js` puts them there.
- Modify: CSS: remove the `#permutationAnchor` and `#permutationContextMenu` rules in `css/editor-toolbars.css`, `css/groove_writer_orange.css`, `css/groove_writer.css` and `css/groove_debug.css`. Style the choice buttons and the options for the dark panel (`--lp-*` tokens, 44 px targets).
- Test: `tests/groove_writer/menus-popups.test.js`, `tests/groove_writer/html-generation.test.js` and the other tests that use `permutationAnchor` (11 places), `tests-e2e/interaction.spec.js` (4 places).

**Interfaces:**

- Consumes: `sidePanel.section('permutations')` (Task 1).
- Produces: `buildPermutationChoiceHTML(activeType: string, isFourFour: boolean) → string`.

- [ ] **Step 1: Write the failing tests.**
  - `it('shows None, Kick and Snare in 4/4, and marks the active one')`
  - `it('shows the 4/4 message in 3/4')`
  - `it('Kick permutation from the tab collapses to one bar and shows its options in the panel')`
  - e2e: `test('the Permutations tab sets a kick permutation and back to None')`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement the changes listed under Files.**
- [ ] **Step 4: Run** `npx vitest run` and `npm run test:e2e:verify`. Expected: all pass.
- [ ] **Step 5: Commit**: "Move permutations into a tab of the side panel".

---

### Task 4: Scoped bars

**Files:**

- Modify: `index.html`: move the `.tool-group` with `#saveButton` and `#shareSaveButton`, and `#moreButton`, from `#PlaybackBar` to the end of `#ToolBar`, after `#viewEditSwitchSlot`, with a `.tool-sep` before them. `#PlaybackBar` keeps `#midiPlayer`, the click group and `#swingButton`.
- Modify: `css/side-panel.css` and `css/editor-toolbars.css`:
  - At 1100 px and wider, with `body.side-panel-open`: `#sidePanel` has `top: var(--bar-top-height)` and `bottom: 0`. `#ToolBar`, `#PlaybackBar` and `#RightHandContent` have `left: var(--side-panel-width)`.
  - Closed or overlay: all three span the full width, as today.
  - Below 768 px: `#ToolBar` scrolls sideways (`overflow-x: auto`, no wrap), as `#PlaybackBar` does, and the tab labels hide (icon only, `aria-label` keeps the name).
  - The PR 14 compact rules for Save and Share (≥1200 `min-width: 104px`, and the ≤1000 and ≤767 blocks) move to the tools-bar selectors.
- Modify: `js/editorChrome.js`: the popover code places popovers by their button. Check that `morePopover` still opens inside the window from its new place at the top. If it opens off-screen, open it downwards.
- Test: `tests-e2e/editor-toolbars.spec.js`. Update the bar-geometry tests (about lines 59, 240, 694–734, 761 and 905) and the `playback bar size at WxH` tests. Add:
  - `test('the docked panel runs from the top bar to the bottom, and both bars start at its edge')` at 1440x900.
  - `test('with the panel closed the bars and the music use the full width')`
  - `test('Save, Share and ⋯ sit in the tools bar and stay in view mode')`
  - `test('the playback bar holds play, tempo, click and swing only')`
  - `test('the tools bar fits or scrolls at 768x1024 and 1024x768, with 44 px targets')`
- Modify: `docs/editor.md` (the bars, the side panel, the tabs), `docs/library.md` (the library is a tab, and `sidePanel.js` owns open/close), and `AGENTS.md` Map if a new doc is needed (not expected).

- [ ] **Step 1: Write the failing e2e tests listed under Files.**
- [ ] **Step 2: Run** `npx playwright test tests-e2e/editor-toolbars.spec.js`. Expected: FAIL in the new tests.
- [ ] **Step 3: Implement the changes listed under Files.**
- [ ] **Step 4: Run** `npm run test:e2e:verify`, `npm run test:cloud` and `npx vitest run`. Expected: all pass, and the golden master too.
- [ ] **Step 5: Look at the screens.** Take screenshots at 1024x768, 768x1024 and 1440x900, each with the panel closed and with each tab open, signed out. Check the alignment, the separators, the focus rings, and that nothing overlaps. Fix what looks off.
- [ ] **Step 6: Regenerate the smoke PNGs** in Docker (`docs/testing.md`) and look at both.
- [ ] **Step 7: Commit**: "Scope the bars: groove actions above the notes, the metronome below".
