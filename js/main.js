// ES-module entry point for the Groove Scribe authoring app (index.html).
//
// Historically index.html loaded groove_writer/groove_utils/grooves as classic
// <script> tags and built its dynamic DOM at parse time with document.write()
// against the synchronous globals. Under native ES modules (which are deferred),
// that no longer works, so this module owns the bootstrap: it imports the app,
// re-exposes the public API on window for the inline HTML onclick handlers, and
// builds the same dynamic DOM into placeholder containers after parse.

import { GrooveWriter } from './groove_writer.js';
import { GrooveUtils } from './groove_utils.js';
import { grooves } from './grooves.js';
import { initPlaybackControls, initPopovers, initSaveButton } from './editorChrome.js';
import { initLibraryPanel } from './cloud/libraryPanel.js';
import { createDirtyState, restoredBaseline, watchDirty } from './cloud/dirtyState.js';
import { askToClearNotes, askToDiscard } from './confirmDialog.js';
import { createWakeLock } from './wakeLock.js';
import { registerServiceWorker, shouldRegister } from './registerServiceWorker.js';

// Inline HTML handlers (onclick="myGrooveWriter.…") and other consumers still
// reference these as globals, so expose them on window.
window.GrooveWriter = GrooveWriter;
window.GrooveUtils = GrooveUtils;
window.grooves = grooves;

const myGrooveWriter = new GrooveWriter();
window.myGrooveWriter = myGrooveWriter;
const utils = myGrooveWriter.myGrooveUtils;

// Keep the screen on while a groove plays and between exercises. The editor only: the
// embed pages never load this.
const wakeLock = createWakeLock({
  navigator,
  document,
  setTimeout: (...args) => window.setTimeout(...args),
  clearTimeout: (...args) => window.clearTimeout(...args),
});
const callbacks = utils.midiEventCallbacks;
for (const [name, hook] of [
  ['playEvent', wakeLock.onPlay],
  ['pauseEvent', wakeLock.onStop],
  ['stopEvent', wakeLock.onStop],
]) {
  const original = callbacks[name];
  callbacks[name] = function (...args) {
    const result = original.apply(this, args);
    hook();
    return result;
  };
}

// Resolves when Play is ready, or when the sound failed for good. A docked library panel
// waits for this before it starts Firebase, so the SDK does not compete with the sound file.
const soundSettled = new Promise((resolve) => {
  for (const [name, settles] of [
    ['midiInitialized', () => true],
    ['midiInitFailed', (failed) => failed === true],
  ]) {
    const original = callbacks[name];
    callbacks[name] = function (root, ...args) {
      const result = original.call(this, root, ...args);
      if (settles(...args)) resolve();
      return result;
    };
  }
});

// The sound can take minutes to give up on a stalled request. The library waits at most this long.
const LIBRARY_WAIT_FOR_SOUND_MS = 10_000;
const soundOrTimeout = Promise.race([
  soundSettled,
  new Promise((resolve) => setTimeout(resolve, LIBRARY_WAIT_FOR_SOUND_MS)),
]);

// Conditional stylesheets (previously injected via document.write in <head>).
function addStylesheet(href) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.type = 'text/css';
  link.href = href;
  document.head.appendChild(link);
}
if (utils.grooveDBAuthoring) {
  addStylesheet('css/grooveDB_authoring.css');
}
if (utils.debugMode) {
  addStylesheet('css/groove_debug.css');
}

// Replace a placeholder element with real markup (exact replacement, no wrapper).
function replaceSlot(id, html) {
  const el = document.getElementById(id);
  if (el) el.outerHTML = html;
}
// Fill a container element's contents (matches document.write into that element).
function fillContainer(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

// Conditional toolbar buttons.
if (!utils.grooveDBAuthoring) {
  replaceSlot(
    'viewEditSwitchSlot',
    '<button type="button" class="tool" onclick="myGrooveWriter.swapViewEditMode();">' +
      '<span class="tool-in"><span id="view-edit-switch">Edit mode</span></span></button>'
  );
}
if (utils.is_touch_device()) {
  replaceSlot(
    'advancedEditSlot',
    '<button type="button" class="tool edit-block" id="advancedEditAnchor" aria-pressed="false" ' +
      'onclick="event.preventDefault(); myGrooveWriter.toggleAdvancedEdit()">' +
      '<span class="tool-in">Note types</span></button>'
  );
}

// Dynamic content regions previously built with document.write.
fillContainer('PermutationOptions', myGrooveWriter.HTMLforPermutationOptions());

myGrooveWriter.renderNoteGrid();

fillContainer('grooveListWrapper', grooves.getGroovesAsHTML());

const editor = {
  openGroove(query, name) {
    utils.stopMIDI_playback();
    myGrooveWriter.loadNewGroove(query, name);
  },
  currentQuery: () => utils.getUrlStringFromGrooveData(myGrooveWriter.grooveDataFromClickableUI()),
  currentTitle: () => document.getElementById('tuneTitle').value.trim(),
  // A groove renamed in the library shows its new name. A groove with no title in its address
  // keeps it that way: the name shows in the top bar only, and the music stays the same.
  rename(name) {
    const title = /** @type {HTMLInputElement} */ (document.getElementById('tuneTitle'));
    if (!title.value.trim()) {
      myGrooveWriter.setNameWhenUntitled(name);
      return;
    }
    title.value = name;
    myGrooveWriter.refresh_ABC();
  },
  // Calls the listener with true when the groove gets unsaved edits, and with false when it
  // is clean again. Returns the call that stops listening.
  onDirtyChange: (listener) => dirtyWatch.onDirtyChange(listener),
};

// The groove that was last loaded or saved. The Grooves menu and the library panel ask before
// they replace edits.
const dirtyState = createDirtyState();
// After a reload the address holds the edits, so the tab's own clean groove is the start. Read
// it now: the editor rewrites the URL on load.
const baseline = restoredBaseline(window.location.search);
// A change that is not an edit, such as the tempo that the metronome raises, keeps a clean
// editor clean.
myGrooveWriter.onChangeWithoutEdit = (before, after) => dirtyState.rebase(before, after);
// Each change of the URL can make the editor dirty or clean again, for example an Undo.
const dirtyWatch = watchDirty(dirtyState, editor.currentQuery);
myGrooveWriter.onUrlChange = () => {
  dirtyState.remember(window.location.search);
  dirtyWatch.changed();
};

// A groove from the Grooves menu replaces the one in the editor, so it asks first too.
document.getElementById('grooveListWrapper')?.addEventListener('click', async (event) => {
  const item = event.target instanceof Element && event.target.closest('.grooveListLI');
  if (!item) return;
  // Close the menu now, so it does not stay open behind the question.
  if (utils.visible_context_menu) utils.hideContextMenu(utils.visible_context_menu);
  if (
    dirtyState.isDirty(editor.currentQuery()) &&
    !(await askToDiscard(document.getElementById('groovesAnchor')))
  )
    return;
  myGrooveWriter.loadNewGroove(item.getAttribute('data-groove'));
  dirtyState.markClean(editor.currentQuery());
});

// Clear all notes asks first, so a wrong tap in the More menu does not lose the groove.
document.getElementById('clearAllNotesButton')?.addEventListener('click', async () => {
  if (await askToClearNotes(document.getElementById('moreButton'))) myGrooveWriter.clearAllNotes();
});

// The library panel needs a Google sign-in popup, which the native app shell does not
// support yet, and GrooveDB authoring has its own save flow.
if (!utils.grooveDBAuthoring && !window.Capacitor) {
  initLibraryPanel({
    // Read now: the editor rewrites the URL on load.
    search: window.location.search,
    whenReady: soundOrTimeout,
    editor,
    dirtyState,
    // The panel shows the button: without the library there is nothing to save to.
    initSaveButton,
  });
}

// Read the location now: the editor rewrites the URL on load, and that drops ?sw=1.
if ('serviceWorker' in navigator && shouldRegister(window.location, Boolean(window.Capacitor))) {
  registerServiceWorker(navigator.serviceWorker, soundOrTimeout);
}

initPopovers();

// Back can bring this page out of the back-forward cache after another page in the tab wrote
// the tab's storage. Write this page's own address and clean groove again.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) dirtyState.remember(window.location.search);
});

// Initialize the notes/player once the page has fully loaded (matches the
// original window.onload handler).
window.addEventListener('load', function () {
  myGrooveWriter.runsOnPageLoad();
  // The groove the page starts with, from a link or the default, is clean until it is edited.
  // A reloaded page keeps the clean groove it had, also signed out.
  dirtyState.markStart(baseline ?? editor.currentQuery());
  dirtyState.remember(window.location.search);
  initPlaybackControls(utils);
});
