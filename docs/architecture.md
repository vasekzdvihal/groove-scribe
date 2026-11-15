# Architecture

How a groove becomes sheet music and sound, and where the code for each step lives.

## Render pipeline

```
URL query string  ──parse──►  grooveData  ──►  ABC notation ──► SVG  (abc2svg)
   (urlSerialization)         (the contract)   (abcNotation)
                                   │
                                   └──────────►  MIDI file   (midiFile + jsmidgen)
```

`grooveData` is the central data contract: the `GrooveData` typedef and the pure
`createGrooveData()` factory in `js/grooveData.js`. Everything flows through it. A saved or shared
groove is only its URL query string.

## The three top-level objects

- **GrooveUtils** (`js/groove_utils.js`) — the shared engine: URL ↔ grooveData, ABC and MIDI
  generation (it delegates to the pure modules), MIDI playback, tempo and swing. The editor and
  the embeds both use it.
- **GrooveWriter** (`js/groove_writer.js`) — the editor controller: the clickable note grid,
  menus and popups, undo and redo, permutation practice modes, hotkeys. `js/main.js` creates it
  for `index.html` and exposes `window.myGrooveWriter`.
- **GrooveDisplay** (`js/groove_display.js`) — the read-only embed renderer for the
  `GrooveEmbed*.html` pages.

## Module patterns

- **Pure core modules** were cut out of the two big files and are imported back: constants,
  music math, note arrays, URL serialization, ABC and MIDI builders, permutations, HTML string
  builders. They take a `gu` (GrooveUtils) or a `config` argument instead of reading globals.
- **`js/gridState.js` is the grid read layer.** It reads each cell's state from the DOM. The note
  setters (`set_*_state`, still in GrooveWriter) are the write side.
- **Editor-only modules** start from `js/main.js`: `editorChrome.js` (bars, popovers, tempo
  knob, swing), `wakeLock.js`, `confirmDialog.js` (the in-page "Discard your changes?" and
  "Clear all notes?" questions), `registerServiceWorker.js`. The embeds never load them.
- **`js/cloud/`** is the library: Firebase client, Firestore reads and writes, the panel, unsaved
  edits and the open saved groove. See [`library.md`](library.md).
- **Vendored code** (`abc2svg`, `jsmidgen`, `pablo`, MIDI.js, share button, `js/vendor/`) is not
  ours. Its globals are `Midi`, `MIDI`, `Abc`, `Share`, `ShareButton`, `Pablo`: do not redefine
  them.
- **`js/abc2svg-1.js` has three local security edits**: no `%%beginjs`, no `%%beginsvg` style
  copy, no `%%beginml`. A new abc2svg version must keep them.

## Native modules

- `js/` loads as native ES modules. There is no bundler: edit a file and refresh the page.
- Modules run deferred, so there is no parse-time `document.write`. `main.js` and the inline
  module scripts build the DOM.
- Use `import.meta.url` to find a script's own path. `document.currentScript` is null in modules.
- In `eslint.config.js`, app source counts as classic script unless the file is in the module
  list. `tsconfig.json` `include` lists only the big files; small modules are checked through
  their imports.

## Refactoring rules

- **Nothing functional may change in a refactor.** The golden master proves it (see
  [`testing.md`](testing.md)).
- **Extraction pattern:** move the code to a new module and leave a delegating wrapper with the
  same name in the old file, so call sites stay the same.
- The split of GrooveWriter is paused. What is left is mostly controller, event handler and DOM
  write code. If it starts again, the next cuts are the UI → grooveData bridge
  (`grooveDataFromClickableUI`, `createMidiUrlFromClickableUI`; it needs a context object) or the
  note setters (`set_*_state`, the write side of `gridState.js`).
