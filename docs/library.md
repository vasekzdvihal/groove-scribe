# Accounts and library

Google sign-in and the lesson library (`js/cloud/`, `css/library-panel.css`, `firestore.rules`).
Read this before you change anything in `js/cloud/`. For the offline side, see
[`offline.md`](offline.md).

## Data model

- Firebase project `groove-scribe-zdvihal`. Firestore is in `eur3`.
- A saved groove is its URL query string. `grooveLink.js` keeps only known groove parameters.
- `lessons` and `grooves` are top-level collections. Each document has an `ownerId` and is private
  to its owner in `firestore.rules`. Sharing can come later without a data migration.
- `users/{uid}` is the profile. The panel writes it on the first online open (`saveProfile`).
- `allowedUsers/{uid}` is the access list. The rules check that the document exists; clients
  cannot read it. To add a person, see [`operations.md`](operations.md).

## Loading the SDK

- `js/vendor/firebase.js` is generated. After a Firebase bump run `npm run vendor:firebase`. Add
  new SDK functions to `scripts/firebase-entry.js`.
- The page runs the SDK only when the panel connects. The editor page load does not import it and
  the embed pages never download it.
- The panel opens by itself only for people who were signed in on the device or left it open. A
  shared link does not load the SDK into the page.

## The panel

- The library is the Library tab of the side panel (see [`editor.md`](editor.md)).
  `libraryPanel.js` fills its section, `#libraryPanel`. `js/sidePanel.js` owns open and close,
  the docked or overlay switch, and the memory of the docked panel (`grooveScribe.libraryOpen`).
- `main.js` passes `libraryPanel.js` a small `editor` object, so the library never touches editor
  internals. `profile.html` only redirects to `index.html#library`.
- The library connects the first time its tab is shown. A panel that opens by itself waits for
  Play to be ready and an idle moment before it connects. Queued offline writes connect while
  the panel is closed.
- The three tools (Save, Add link, New lesson) are buttons in a sticky row at the top. Each opens
  one form (`showTool`).
- Lessons sort in natural order ("Week 2" before "Week 10"). Lessons and grooves have a ⋯ menu;
  only one menu is open at a time. Escape in an open menu, or on its ⋯, closes it and puts focus
  on the ⋯ of its row. A window listener in `startLibrary` does this before the side panel hears
  the key, so an overlay panel stays open.
- `render()` replaces every row. It puts focus back through `data-focus` keys, and it waits while
  a pointer is down on the list or on a tool form, so a redraw never eats a tap.

## Unsaved edits

- `dirtyState.js` keeps the groove that was last loaded or saved. `watchDirty` checks once after
  each URL change (`GrooveWriter.onUrlChange`) and each dirty-state change.
  `editor.onDirtyChange` reports only real flips. The leave warning is attached only while dirty.
- **Rule:** code that replaces the groove in the editor checks `dirtyState.isDirty`, asks with
  `askToDiscard`, and after the load calls `dirtyState.markClean` with the editor's new query.
- Every edit is in the address, so the clean groove is kept per tab in `sessionStorage`, in one
  item with the last address (`dirtyState.remember` on each URL change and on a `pageshow` from
  the back-forward cache). After a reload `main.js` starts from it (`restoredBaseline`), so a page
  with edits stays dirty. A new link in the same tab is another address and starts clean.

## The open saved groove

- `currentGroove.js` keeps the saved groove that is open in the editor, per signed-in session,
  with a per-tab record. Update survives a reload, and no tab changes another.
- The record also holds the groove name, so the top bar shows it early after a reload. Sign-out
  and a dropped restore clear it.
- Update reads the server first while online and does not write over a change from another
  device. The panel reads the library again when the tab becomes visible and when the network
  returns.

## Save button

- Save, Share and ⋯ are at the end of the tools bar, above the notes. Save opens the Library tab
  at its save form, or at the sign-in.
- It says Saved only while the editor shows an open saved groove unchanged and its save is safe
  on this device (persistent cache, or no pending write).
- The library shows the button. The native app and GrooveDB authoring have no library, so they
  do not show it.
