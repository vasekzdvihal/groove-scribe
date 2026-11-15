# Editor

The editor page (`index.html`): its bars, the tempo knob, the note grid, sound and the screen
lock. Read this before you change editor UI.

## Editor bars

Each bar holds the controls for what is next to it:

- The top bar (`#TopNav`): the logo, the side panel tabs, the groove title, Help and the account
  button. It always has the full width.
- The tools bar (`#ToolBar`), above the notes: the edit tools, then Details and the View mode
  switch, then the groove actions Save, Share and ⋯ (`#moreButton`). The groove actions stay in
  view mode.
- The playback bar (`#PlaybackBar`), below the notes: play, the tempo knob, the click and swing
  only.

Rules:

- `css/editor-toolbars.css` overrides older rules that other pages still load. It holds the bar
  tokens (`--bar-*`, `--touch-size`, `--playback-touch`).
- View mode writes `display: block` or `none` on every `.edit-block`. A `.edit-block` button must
  not need another display value: put its layout on an inner `.tool-in` span.
- The player markup is shared with the embed pages. `initPlaybackControls` in
  `js/editorChrome.js` changes it in the editor only. Never edit the shared markup for an
  editor-only change.
- The playback bar is the main control from the drum stool, so it is bigger than the rest: the
  bar is 96 px (`--bar-playback-height`) and its controls are 56 px tall (`--playback-touch`).
  Below 1001 px and below 768 px the controls get narrower, not lower, so the bar fits down to
  680 px. Below that it scrolls sideways.
- The playback controls sit in the middle of the bar as one group, at every width. Auto margins
  on the first and the last control centre them; they become 0 when the bar scrolls, so the first
  control stays in reach (`justify-content: center` would cut it off).
- The tools bar fits from 768 px up. Below 1200 px Undo, Redo, Save and Share show only their
  icons (their `aria-label` keeps the name), and from 1000 px down the tools sit closer together.
  Narrower than 768 px, the bar scrolls sideways and does not wrap. A tool that gets focus
  scrolls into view (`initBarScroll` in `js/editorChrome.js`).
- Two filled buttons side by side keep at least 4 px between them, so a focus ring does not
  touch the next button.
- `groove_writer.css` sets `transition: all` on old buttons. A control whose size changes with
  the window width must limit its transition to colours, or tests measure it mid-change.

## Side panel and tabs

- `js/sidePanel.js` owns the side panel: the tabs in `#upperLeft`, the panel `#sidePanel`, open
  and close, the docked or overlay switch, and what it remembers (`grooveScribe.libraryOpen` for
  the docked panel, `grooveScribe.panelTab` for the last tab). `css/side-panel.css` styles it.
- The tabs are Library, Permutations and Grooves. GrooveDB authoring and the native app have no
  library, so they have no Library tab. A tab is a toggle button (`aria-pressed`), not a menu.
- Below 768 px the tabs show only their icons. Below 480 px the logo hides too.
- From 1100 px wide (`DOCKED_QUERY`, and one `@media` block in `css/side-panel.css`) the panel
  docks. It runs from the top bar to the bottom of the screen. The tools bar, the music and the
  playback bar start at its right edge (`body.side-panel-open`). Its head is as tall as the tools
  bar, so both end on one line. The docked panel is not a dialog: focus stays on the page, and
  Space still plays.
- The docked panel takes 300 px (`--side-panel-width`) from the tools bar. So in the same
  `@media` block the tools bar gets its narrow rules at other widths: icons only below 1430 px,
  closer tools from 1230 px down. These limits are the measured width of the fullest tools bar
  plus 300 px (the comment in `css/side-panel.css` has the numbers). Measure again when a tool
  is added to the bar.
- Below 1100 px the panel slides over the editor like a dialog, with a backdrop and a Close panel
  button. A groove picked in the Grooves tab closes the panel and puts focus on the tab. A
  permutation choice keeps the panel open, because its options show in the same panel. Docked,
  both picks move focus out of the panel.
- Turning a tablet from docked to overlay closes the panel. Back to docked, a panel that the user
  left open comes back.

## Tempo knob

- `initPlaybackControls` replaces the BPM label, the −/+ buttons and the slider with a round knob
  (`role="slider"`). The embeds keep their slider.
- The old slider stays in the page, hidden, because `groove_utils.js` reads the tempo from it.
- The knob wraps `utils.tempoUpdate`. Every tempo change (the knob, typing, a loaded groove,
  undo, auto speed-up) must go through it, so the knob, playback and the dirty state stay in step.
- Turn: 6° per BPM. The value arc covers 30–300 BPM over 270°. A tap (click) on the number opens
  typing.

## Note grid

- Grid state is read back from the rendered CSS colour. The setters paint the hex form; the
  browser gives rgb back; `gridState.js` compares it with `constant_*_on_color_rgb` in
  `js/constants.js`. A colour changes in the CSS and in `constants.js` together.
- Every `set_*_state` setter calls `markNoteOn`. It writes `data-on` on the cell, and the CSS
  draws off notes smaller: a cue for "on" that is not colour.
- `renderNoteGrid()` owns the `--notes` and `--groups` custom properties on `#measureContainer`.
  The grid CSS sizes the cells and the bars from them.
- The grid has rows for toms 1, 2 and 4: High, Mid and Floor tom, in sheet-music order. A loaded
  groove keeps tom 3 in `class_kept_toms`, valid for one bar layout, with the same visibility
  rule as the other toms.
- The label column is 100 px wide on a wide screen, so "Floor tom" fits on one line. Narrower
  columns let a tom name go onto two lines.
- The metronome auto speed-up rewrites the newest undo step instead of adding one.

## Sound

- `index.html` preloads the sound file. `groove_utils.js` retries a failed or stalled download:
  waits of 1, 3 and 9 s, a 45 s stall timer that ends with the download, then a 30 s decode timer.
- The docked library waits for the sound, but never more than 10 s (`main.js`).

## Wake lock

`js/wakeLock.js` runs in the editor only. Play takes a screen wake lock. Stop or pause starts a
10 minute timer, and the lock is released when it ends. Play again before then keeps the lock.

## Help and About

Help and About open in the same tab, so the editor address keeps the groove.
`js/backToEditor.js` makes "Back to the editor" go back in the history.
