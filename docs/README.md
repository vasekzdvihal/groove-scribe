# docs/

Topic docs for agents and developers. `AGENTS.md` at the root is the always-loaded map. These
pages load on demand: read the one for the area you change before you change it.

- [`architecture.md`](architecture.md) — render pipeline, the three top-level objects, module
  patterns, the extraction rule and the paused refactor.
- [`testing.md`](testing.md) — the test suites, the golden master on a Mac, smoke screenshots in
  the Linux image, test servers and ports.
- [`editor.md`](editor.md) — editor bars and the tempo knob, the note grid, sound loading, wake
  lock, Help and About.
- [`library.md`](library.md) — accounts, lessons and grooves in Firestore, unsaved edits, the open
  saved groove, the library panel.
- [`offline.md`](offline.md) — the service worker, the Firestore cache, offline writes, and how to
  recover from a bad worker.
- [`operations.md`](operations.md) — CI and deploy, the hosting cache, the access list, and data
  tasks in production.
- [`mobile.md`](mobile.md) — Android and iOS builds with Capacitor.

## How we write these docs

The model is the one in Newton.N2 (`docs/how-we-document.md` there):

- `AGENTS.md` is the single source. `CLAUDE.md` and `GEMINI.md` hold only `@AGENTS.md`.
- `AGENTS.md` holds what every session needs: identity, commands, the rules that break things, and
  this map. Depth goes here, in `docs/`. A procedure you trigger goes in a skill.
- One home per fact. Link to it from other places; do not copy it.

Rules for each page:

- **Patterns over instances.** Write the rule that covers many files ("every `set_*_state` setter
  calls `markNoteOn`"), not a file list. Point at the code for detail that changes.
- **No counts, no line numbers.** They are wrong after the next PR. Say "all pass", not "1073 pass".
- **Write a fact when a real task needed it.** Do not write docs in advance for work nobody did.
- **Say the why** when a rule looks odd ("the slider stays, hidden, because `groove_utils.js` reads
  the tempo from it").
- **A wrong doc is worse than none.** When a change makes a line false, fix the line in the same PR.
- Simplified Technical English: short sentences, active voice, one statement per sentence.
