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
  only. While part play has a selection, the part play chip shows in it too (see "Part play").

Rules:

- Landmarks: the top bar is a `<header>` (banner) with the page `<h1>` in it. The `<h1>` is
  `.visually-hidden`: screen readers find it, but it takes no room. The tools bar and its
  popovers, the music, and the old menus and popups are in `<main id="editorMain">`. The playback
  bar and the Swing popover after it are in `<section class="nonPrintable" aria-label="Playback">`.
  The popover is not inside `#PlaybackBar`: that bar can scroll sideways and would clip it. Each
  bar is in its own `.nonPrintable` box. All three bars and the music are `position: fixed`, so this outline
  does not change the layout. Keep new content inside a landmark: axe checks it
  (`tests-e2e/a11y.spec.js`).
- The page never scrolls sideways, also at 320 px. `#GrooveWriter` has no minimum width.
- `css/editor-toolbars.css` overrides older rules that other pages still load. It holds the bar
  sizes (`--bar-*`, `--touch-size`, `--playback-touch`). The colours are in
  `css/tokens.css`.
- `css/tokens.css` holds the colours, the 6 px corner radius (`--radius`) and the focus ring
  colour (`--focus-ring`). It also has the one button shape: `.btn`, `.btn-primary` and
  `.btn-danger`. Use them for a button in the side panel, a dialog or a popup. A tool in a bar is
  a `.tool` with the same corners. Every button has 6 px corners and is at least 44 px tall. Only
  round controls, such as the tempo knob and the avatar, stay round.
  `tests-e2e/visual-system.spec.js` checks it.
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
- Space plays or stops the groove (`setupHotKeys` in `js/groove_utils.js`), except on a control
  that uses Space itself: a button, a link, a field, a select, a menu item, a tab, a grid cell.
  There Space presses or types, as on any page. A range slider and the page itself (nothing
  focused, as after a tap) still play. Play is a `role="button"` span: it handles Enter and Space
  itself.
- So a tap must not leave the focus on a button. The `mousedown` guard in `initPopovers` stops
  the buttons of the bars, the popovers, Help (`#helpAnchor`), the popups, the old menu items,
  the part play rulers and the add and remove bar buttons from taking the focus. Fields and
  selects take it as usual. A popup that a tap opened and closed also drops the focus that the
  editor put into it (the share link).
- Popovers, the old menus and the popups take the focus only when a key opened them
  (`lastInputWasKeyboard()` in `js/editorChrome.js`). A tap opens them as before and leaves the
  focus where it is, so Space still plays on the tablet.
  - A popover (`initPopovers`) gives the focus to its first shown control. Escape, or an item with
    `data-popover-close`, gives it back to the button. Tab out of the popover closes it. A tap
    that closes it moves the focus out of the hidden popover to the page, not to the button.
  - The old menus (`.noteContextMenu > ul`) are ARIA menus (`initContextMenus`, which wraps
    `showContextMenu` and `hideContextMenu`). The first item gets the focus. Up and Down wrap,
    Home and End go to the ends, Enter or Space picks, Escape closes, Tab closes and goes on. When
    the menu closes, the focus goes back to the control that had it: a menu button
    (`aria-haspopup="menu"`, with `aria-expanded`) or a note cell in Note types mode. A sub-menu
    (Offset click) keeps the first menu button.
  - The Download menu opens below ⋯ (`#moreButton`), for a tap and for a key: Download is in
    that popover, which closes.
  - The time signature, share and auto speed-up popups are non-modal dialogs (`initPopups`).
    The first control gets the focus. Escape presses their own Cancel or close button. On close,
    the focus goes back to the control that opened them. There is no focus trap.
- The share popup loads the share button library (`js/share-button.min.js` and its CSS) when it
  opens for the first time, not with the editor (`js/shareButtonLoader.js`). Until it loads,
  SHARE is hidden but keeps its place (`.share-pending`), so COPY does not move.
- `groove_writer_orange.css` sets `transition: all` on old buttons. A control whose size changes
  with the window width must limit its transition to colours, or tests measure it mid-change.

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
  button. A pick by keyboard (Enter on a groove) or Escape closes the panel and puts focus on the
  tab. After a tap, `close()` moves the focus out of the panel to the page, so Space plays instead
  of pressing the tab (`close()` in `js/sidePanel.js` looks at the last input, a pointer or a key,
  from `js/inputModality.js`). A permutation choice keeps the panel open, because its options show
  in the same panel. Docked, both picks move focus out of the panel. Escape closes the overlay
  panel, but not when it is pressed in an old menu (`.noteContextMenu`) or a popup
  (`[role="dialog"]`): it closes that menu or popup only.
- The Grooves tab is a heading (`h3.grooveListHeader`) and a list (`ul.grooveListUL`) per
  group. Each groove is a `li.grooveListLI[data-groove]` with a `button.grooveListButton`, so the
  keyboard reaches it. The button fills the row and looks like the old plain row. `main.js`
  handles the click through `closest('.grooveListLI')`. A tapped groove button must not keep
  focus (`tapNoFocus` in `js/editorChrome.js`), or Space would press it again instead of playing.
- In the DOM the panel (`#sidePanel`, after its backdrop) is right after the top bar's
  `.nonPrintable` box, before `<main>`. So the tab order is the tabs, the panel, then the tools,
  the grid and the playback bar. A page without `#TopNav` gets the panel at the end of `<body>`.
  The panel and the backdrop paint above the bars because of their `z-index`, not their place
  in the DOM.
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

- The grid reads cell state from the inline colour that the setters write. The setters write the
  hex form; the browser gives rgb back; `gridState.js` compares it with `constant_*_on_color_rgb`
  in `js/constants.js`. A colour changes in the CSS and in `constants.js` together.
- Every note setter calls `markNoteOn`. It writes `data-on` on the cell, and the CSS draws off
  notes smaller: a cue for "on" that is not colour. It also ends the cell's `aria-label` with
  ", on" or ", off".
- `set_sticking_state` does not call `markNoteOn`. A sticking state is a letter, not on or off,
  and the shrink cue leaves the stickings out. It ends the name with the state instead:
  "Sticking, beat 1, R", "L", "R and L", "count" or "off".
- Each bar has two ARIA grids: "Stickings, bar N" and "Notes, bar N". A lane is a `row`, a cell a
  `gridcell` with `data-instrument`, a global `data-index` and `data-name` from `noteCellName()`
  in `js/viewHtml.js`: "Snare, beat 2", "Hi-hat, beat 1 and", "Kick, bar 2, beat 4 a". The bar
  shows only in a groove with more than one bar. A bar that does not split into whole beats
  counts notes: "Snare, note 5".
- `js/gridKeyboard.js` is the keyboard. All grids together are one tab stop: one visible cell
  has `tabindex="0"`. Left and Right move in the lane and cross into the next bar. Up and Down
  move to the next shown lane. Home and End go to the ends of the lane in the bar, Ctrl+Home
  and Ctrl+End to the ends of the groove. Space and Enter act as a click on the cell. The page
  keys do not see these keys, so Space in the grid does not stop playback. Other keys pass
  through: Ctrl+Z still undoes.
- A click does not move the focus into the grid, so Space still plays after a click. The
  clicked cell becomes the tab stop. A held Space or Enter sets the note once.
- In Note types mode, Space or Enter on a cell opens the note menu just below the cell
  (`NOTE_MENU_LIFT` in `js/main.js`), so the menu does not cover it. A tap opens it at the tap,
  as before.
- After a redraw or a hidden lane, the first shown hi-hat cell becomes the tab stop. When a key
  in the grid started the change (Ctrl+Z, Ctrl+Y), the focus stays in the grid: it goes to the
  same cell, else to the hi-hat at the same place, else to the first shown hi-hat. A change that
  a mouse or a finger started gives no focus to the grid.
- Left and Right change the tempo everywhere on the page, except in a widget that uses the
  arrow keys: the grid, a slider, a list box, a menu, a field (`ownsArrowKeys()`).
- `renderNoteGrid()` owns the `--notes` and `--groups` custom properties on `#measureContainer`.
  The grid CSS sizes the cells and the bars from them.
- The grid has rows for toms 1, 2 and 4: High, Mid and Floor tom, in sheet-music order. A loaded
  groove keeps tom 3 in `class_kept_toms`, valid for one bar layout, with the same visibility
  rule as the other toms.
- `#measureContainer` has a `min-width` of one bar with the smallest cells (`--cell-min`). Where
  a bar does not fit (1/16 notes below 480 px, 1/32 notes below 768 px), the grid scrolls
  sideways in `#musicalInput`. No cell is cut off, and a cell that gets the keyboard focus scrolls
  into view. Where a bar fits, the `min-width` does nothing.
- The label column is 100 px wide on a wide screen, so "Floor tom" fits on one line. Narrower
  columns let a tom name go onto two lines.
- The metronome auto speed-up rewrites the newest undo step instead of adding one.

## Part play

Play can loop some of the beats only. `js/partPlay.js` holds the pure helpers,
`js/partPlayControl.js` the rulers and the chip, `css/part-play.css` their styles. The writer API
is `setPartPlay`, `getPartPlay`, `partPlayShape` and `onPartPlayChange` in `groove_writer.js`.

- How to select: each bar has a ruler in its 44 px header row, with "Bar N" over the labels and
  one beat over the cells of each beat. Drag along a ruler to select beats. Tap "Bar N" to select
  the bar. Tap a beat, then tap another beat, also in another bar, to select all beats between
  them. The selected cells get a light shade, lighter than the playhead.
- How to clear: as with selected text, tap the selection again. A tap on a selected beat, or on
  "Bar N" of the selected bar, clears it. A tap outside the selection starts a new one.
- The Remove bar button sits over the right end of the last beat. Tap the last beat to the left
  of it. A drag looks through the button, so it also reaches a last beat that is too narrow to
  tap (one cell, as in 6/8 in 1/8 notes).
- By keyboard: the beats of each bar are a `listbox` ("Beats of bar N") of `option`s ("Bar N,
  beat B", with `aria-selected`). All the rulers together are one tab stop: the focused beat,
  else the first selected beat, else the last focused beat, else beat 0. On a focused beat:
  - Left and Right move the focus to the previous or next beat, also into the next bar. They do
    not change the selection or the tempo.
  - Home and End move the focus to the first or the last beat of the groove.
  - Enter and Space act as a tap (the same state machine), so a press on the selection clears it.
    Space does not play there. A held key acts once.
  - Shift+Left and Shift+Right move the focus and move that end of the selection with it
    (`extend` in `nextSelection`). The other end, or a first tap, stays. From a beat outside the
    selection they start a new one.
  - The status region speaks each change. Every beat is reachable, also a last beat under the
    Remove bar button: its focus ring goes over the button.
- Add a bar (`#addMeasureButton`) and Remove bar N (`.closeMeasureButton[id]`) are `button`s that
  look as the old spans did. The title of each is the same as its name. At the limit, Add a bar
  keeps its tab stop with `aria-disabled` and says "You can have 10 bars at most". A key press on
  either moves the focus to the new Add a bar button after the grid is drawn again, and
  `#barStatus` (a hidden live region next to `#partPlayStatus`) says "Bar N added" or "Bar N
  removed". A tap leaves no focus (the `mousedown` guard) and says nothing, so Space still plays.
- The rulers show in edit mode only. They hide while a permutation is active, and when a bar does
  not split into whole beats.
- The chip is in the playback bar while there is a selection, in view mode too. It says what
  plays. Its × plays the whole groove again. It never covers the music:
  - When the bar has room, the chip sits in the row of controls, after the tempo knob.
  - When the bar has no room, `placeChip()` gives the bar the class `has-chip-row`. An example is
    a long label at 1024 px or narrower. The chip then gets its own row at the top of the bar. The
    bar is 56 px taller (`--bar-playback-height` 152 px), so the music ends above it.
  - `placeChip()` runs again when the bar or the chip changes size.
- A screen reader hears the selection from `#partPlayStatus`, a hidden live region next to the
  chip. It changes when a press ends, not at each beat that a drag crosses. The chip label is not
  live.
- With the count-in on, the count-in clicks one full bar and then the beats before the selection
  in its bar. The playhead is off for the full bar, then shows each of those beats on its cells
  (`countInPercent`). Without a selection the playhead sweeps the groove, as before.
- A press on a ruler ends at its release anywhere on the page, at a cancel, or at a lost
  pointer capture. A drag keeps the last beat it crossed. A new press replaces a press that never
  ended.
- What clears the selection: a tap on it, the chip's ×, another groove, a bar added or removed, a new time
  signature or division, and a permutation. Note edits keep it.
- The selection is never saved: not in the URL, the library or the undo steps.
- `renderNoteGrid()` makes the rulers again with the grid, so the pointer and key events are
  delegated on `#measureContainer`. `onPartPlayChange(null)` can come while a groove loads, so the
  listener reads only its argument.

## Sound

- `index.html` preloads the sound file. `groove_utils.js` retries a failed or stalled download:
  waits of 1, 3 and 9 s, a 45 s stall timer that ends with the download, then a 30 s decode timer.
- The docked library waits for the sound, but never more than 10 s (`main.js`).
- The drum samples live in `soundfont/gunshot-ogg.js` and `gunshot-mp3.js`, keyed by note name
  (MIDI 47 is `"B2"`). An empty slot plays silence. Put every new sample into both files, from
  `soundfont/NewDrumSamples/`, without an ID3 tag. `tests/soundfont.test.js` checks that each
  note in `js/constants.js` has a sample.
- Toms: High tom (48) is "10 Tom", Mid tom (47) and the hidden tom 3 (45) are "Rack Tom", Floor
  tom (43) is "Floor Tom".

## Wake lock

`js/wakeLock.js` runs in the editor only. Play takes a screen wake lock. Stop or pause starts a
10 minute timer, and the lock is released when it ends. Play again before then keeps the lock.

## Help and About

Help and About open in the same tab, so the editor address keeps the groove.
`js/backToEditor.js` makes "Back to the editor" go back in the history.
