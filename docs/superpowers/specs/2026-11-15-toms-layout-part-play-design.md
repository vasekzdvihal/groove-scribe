# Third tom, scoped layout, and part play — design

Date: 2026-11-15. Status: approved by the user on 2026-11-15 (all four sections).

## Why

The user plays from a tablet in the rehearsal room. Three changes make the editor fit that use:

1. Their kit has three toms (high, mid, floor). The grid shows only two rows, both called "Tom".
2. The screen mixes tools for different things in one bar. The user wants each bar to hold one
   kind of tool, in a clear hierarchy: what you pick (left), what you do with it (above the notes),
   the notes, and the metronome (below).
3. To practise a hard spot, the user wants to select part of a groove (one bar of four, or half a
   bar), "like text", and play only that part.

Each part is one PR, in this order: third tom, layout, part play. Part play goes last because its
controls live in the new bars.

## Global constraints (all three parts)

- SVG and MIDI output of a groove stays byte-identical (golden master). Part play builds a
  separate MIDI file only for playback; it never changes the groove, the URL or the saved data.
- Touch targets at least 44 px. Check at 1024x768, 768x1024 and 1440x900.
- All user-facing text is Simplified Technical English.
- Do not edit vendored files (`js/vendor/`, files in `knip.json` `ignore`).
- Do not edit the player markup shared with the embed pages; change it in the editor only
  (`initPlaybackControls` in `js/editorChrome.js`).
- Grid colours change in `css/` and `js/constants.js` together.

---

## Part 1 — Third tom

### Decided by the user

- Rows, top to bottom: Hi-hat, High tom, Mid tom, Snare, Floor tom, Kick (sheet-music order).
- Row labels: "High tom", "Mid tom", "Floor tom". The two "Tom" labels go away.

### Decided by me, shown to the user, no objection

- Mid tom is the existing GrooveScribe "tom 2" lane (MIDI 47). Its ABC and sound do not change.
  Grooves that already have tom 2 notes now show them in the grid.
- The row works like the other tom rows: tap to set or clear, same mute button and label menu.
- The Toms button shows or hides all three rows. A groove with notes in any of the three opens
  with the toms shown.
- The "tom 3" lane (MIDI 45) stays out of the grid. Its notes stay in `class_kept_toms` and play
  as today. `class_kept_toms` then holds only tom 3.

### Left to the builder

- How the row is added to `js/viewHtml.js` and how `groove_writer.js` reads it; follow the tom 1
  and tom 4 code.
- Tests: a unit test that a URL with tom 2 notes shows them in the Mid tom row and round-trips
  unchanged; an e2e test of the row order and labels; the golden master stays green.

---

## Part 2 — Scoped layout

### The layout (user's sketch)

```
┌──────────────────────────── top bar (red) ─────────────────────────────┐
│ logo  [Library] [Permutations] [Grooves]      title         ?  Account │
├──────────────┬─────────────────── groove actions (orange) ─────────────┤
│              │ 4/4  1/16▾ │ Undo Redo │ Toms Stickings▾  Details▾ View │ Save Share ⋯
│  left panel  ├─────────────────────────────────────────────────────────┤
│  (green):    │                                                         │
│  content of  │               sheet music + note grid (blue)            │
│  the chosen  │                                                         │
│  tab         ├─────────────────── metronome (pink) ────────────────────┤
│              │ ▶ 0:00  (80)  CLICK Off 4th 8th 16th ⚙   Swing ▾        │
└──────────────┴─────────────────────────────────────────────────────────┘
```

### Decided by the user

- Top bar: Library, Permutations and Grooves are tabs. No dropdowns on them.
- The left panel shows the content of the selected tab.
- The groove-actions bar above the notes holds Save, Share and View/Edit with the edit tools.
- The bottom bar is the metronome. Save and Share leave it.
- Stickings sits with the edit tools (not in the metronome bar).
- The left panel can be hidden, so the notes get the full width at the kit.

### Decided by me (the user can change these)

- **Tabs and the panel.** Tap a tab: the panel opens on it. Tap the selected tab again: the panel
  closes. The panel also has a close button. The panel remembers open/closed and the last tab
  (localStorage, per device). The existing key `grooveScribe.libraryOpen` keeps its meaning; add
  `grooveScribe.panelTab`.
- **Docked and overlay.** Keep today's rule: at 1100 px and wider the panel docks; below that it is
  an overlay with a backdrop and closes after a pick. The 1100 px value stays in one place in CSS
  and one in JS, as today.
- **When docked, the panel is full height** under the top bar, as in the sketch. The groove-actions
  bar and the metronome bar then start at the panel's right edge. When the panel is closed or an
  overlay, both bars span the full width.
- **Library tab** holds today's library panel content, unchanged (sign-in, lessons, grooves). It
  exists only where the library exists today (not in grooveDB authoring, not in the Capacitor app).
  Without it, the tabs are Permutations and Grooves.
- **Grooves tab** shows today's groove list as a full-height list in the panel. A tap loads the
  groove with today's unsaved-edits check. The popup goes away.
- **Permutations tab** shows a "None / Kick / Snare" choice and below it today's permutation
  options (moved from above the sheet music into the panel). Opening the tab changes nothing; a
  choice does what the menu item does today. When the time signature is not 4/4, the tab shows
  "Permutations work in 4/4 time only." and no choice.
- **Groove-actions bar** is today's tools bar plus Save, Share and the ⋯ menu at its right end.
  Order: time, division │ Undo, Redo │ Toms, Stickings, Advanced edit │ (space) │ Details,
  View/Edit │ Save, Share, ⋯. Advanced edit keeps its place and behaviour. In view mode the edit
  tools hide as today; Save, Share and ⋯ stay.
- **Metronome bar** keeps its PR 14 sizes: play, time, tempo knob, click, swing. Nothing else.
- **Narrow screens.** Below 768 px the groove-actions bar may scroll sideways, as the playback bar
  does today. The tabs in the top bar may show icons only below 768 px.

### Left to the builder

- How the panel hosts three tab contents (one panel with three sections is the expected shape).
- Update the e2e specs that use `#groovesAnchor`, `#grooveListWrapper`, `#permutationAnchor`,
  `#PermutationOptions`, `#saveButton`, `#shareSaveButton` and the bar geometry
  (`editor-toolbars.spec.js`, `interaction.spec.js`, `functional.spec.js`,
  `unsaved-edits.spec.js`, `smoke.spec.js`) and the cloud tests of the panel.
- Regenerate the smoke PNGs in Docker after the last visual change. The golden master must pass
  without new baselines (it pins the window width; the panel is closed in those tests).
- Update `docs/editor.md` and `docs/library.md`.

### Anti-goals

- The notes must not get less room at the kit than today when the panel is closed.
- No new dropdown for Library, Permutations or Grooves.

---

## Part 3 — Part play

The user asked for: select one bar of four, or half a bar, "like text", and play only that part.
The rest is my design; every point below is my call unless marked.

- **Where you select:** each bar gets a ruler in its header row, the 44 px row that already
  holds the bar's Remove button, so the grid gets no taller. The ruler shows "Bar N" and the beats
  ("1 2 3 4"). Bars wrap onto their own rows on a tablet, so there is one ruler per bar.
  - Drag along a ruler to select beats. The selection snaps to whole beats, so one bar, half a
    bar or any run of beats works.
  - Tap "Bar N" to select that whole bar.
  - Tap a beat, then tap another beat (in the same or another bar) to select everything between
    them. This is how a selection crosses bars on a touch screen.
  - The ruler avoids a conflict with tapping notes in the grid.
- **What you see:** the selected beats get a light shade over the grid columns. The sheet music
  does not change (SVG stays byte-identical).
- **Clearing:** a chip in the metronome bar says what plays, for example "Bar 2, beats 1–2", with
  an × button. Loading another groove, removing or adding a bar, and changing the time signature
  or the division also clear it. Note edits keep it.
- **Playing:** with a selection, Play loops only the selected beats at the current tempo, with
  click and swing as usual.
- **The click keeps the real bar position.** In "bar 2, beats 3–4" the click on beat 3 sounds as
  beat 3, not as beat 1, so you keep your place in the bar. The count-in is one full bar of
  clicks, and the selection starts on its real beat after it. Without a selection, Play plays the whole groove as today.
  Changing the selection while playing takes effect at the next loop.
- **View mode (user):** the rulers hide in view mode, with the rest of the grid. You select in
  edit mode. My call: a selection stays when you switch to view mode, Play still loops it, and
  the chip in the metronome bar shows in both modes, so you can clear it there.
- **Not saved:** the selection is not part of the URL, the library or undo.
- **Permutations:** the ruler is hidden while a permutation is active.
- **Highlight:** the playing note highlight in the grid and the sheet music follows the real
  position inside the selection.

### Left to the builder

- Build the playback MIDI from the selected slots: slice the flat note arrays
  (`index = measure * notesPerMeasure + slot`) and feed them to the existing per-measure builder
  in `js/midiFile.js`; a partial bar is a shorter measure. Map the playback percent back to the
  real note index for `hilight_note` and `highlightNoteInABCSVGFromPercentComplete`.
- Tests: unit tests of the slicing and the percent mapping; an e2e test that selects bar 2 of a
  4-bar groove and checks the highlight never leaves bar 2; the golden master stays green.
