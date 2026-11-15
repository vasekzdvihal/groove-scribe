# Editor

The editor page (`index.html`): its bars, the tempo knob, the note grid, sound and the screen
lock. Read this before you change editor UI.

## Editor bars

- `css/editor-toolbars.css` overrides older rules that other pages still load.
- View mode writes `display: block` or `none` on every `.edit-block`. A `.edit-block` button must
  not need another display value: put its layout on an inner `.tool-in` span.
- The player markup is shared with the embed pages. `initPlaybackControls` in
  `js/editorChrome.js` changes it in the editor only. Never edit the shared markup for an
  editor-only change.
- The playback bar is the main control from the drum stool, so it is bigger than the rest: the
  bar is 96 px (`--bar-playback-height`) and its controls are 56 px tall (`--playback-touch`).
  Below 1001 px and below 768 px the controls get narrower, not lower, so the bar fits down to
  680 px. Below that it scrolls sideways.
- `groove_writer.css` sets `transition: all` on old buttons. A control whose size changes with
  the window width must limit its transition to colours, or tests measure it mid-change.

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
- The grid has rows only for toms 1 and 4. A loaded groove keeps toms 2 and 3 in
  `class_kept_toms`, valid for one bar layout, with the same visibility rule as toms 1 and 4.
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
