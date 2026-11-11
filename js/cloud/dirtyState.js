// Does the editor show changes that are not saved? The editor is clean when its groove is the
// groove that was last loaded or saved.
import { parseGrooveLink } from './grooveLink.js';

/** The clean groove after a refused save: no query is equal to it. */
export const NOTHING_SAVED = Symbol('nothing saved');

// Each tab keeps its clean groove for a reload. Every edit is in the address, so without it a
// reload, or iPad Safari bringing back a tab it dropped, would count the edits as clean.
const CLEAN_KEY = 'grooveScribe.cleanGroove';
// The address the tab showed last. A new link opened in the same tab is another page.
const ADDRESS_KEY = 'grooveScribe.address';

// sessionStorage can be missing or throw, for example in a private window. Then a reload
// starts clean, as before.
function tabStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function readItem(storage, key) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeItem(storage, key, value) {
  try {
    storage?.setItem(key, value);
  } catch {
    /* a reload starts clean */
  }
}

/**
 * Remember the address the tab shows. Call after each change of the address.
 * @param {string} query
 * @param {Storage | null} [storage]
 */
export function rememberAddress(query, storage = tabStorage()) {
  writeItem(storage, ADDRESS_KEY, String(query ?? ''));
}

/**
 * The clean groove this tab had before a reload, if the page shows the address the tab showed
 * last. Read it before the editor rewrites the address.
 * @param {string} pageQuery  the query the page started with
 * @param {Storage | null} [storage]
 * @returns {string | typeof NOTHING_SAVED | null}  null when the tab has none for this page
 */
export function restoredBaseline(pageQuery, storage = tabStorage()) {
  const address = readItem(storage, ADDRESS_KEY);
  if (address === null || !sameGroove(address, pageQuery)) return null;
  try {
    const saved = JSON.parse(readItem(storage, CLEAN_KEY));
    if (typeof saved?.clean === 'string') return saved.clean;
    return saved && saved.clean === null ? NOTHING_SAVED : null;
  } catch {
    return null;
  }
}

// Compare the groove only: flags such as Debug, and the address around the query, do not count.
function normalise(query) {
  const parsed = parseGrooveLink(query);
  return parsed.ok ? parsed.query : String(query ?? '');
}

/** Are two queries the same groove? Flags and the address around the query do not count. */
export function sameGroove(a, b) {
  return normalise(a) === normalise(b);
}

/**
 * Before the first markClean, nothing is dirty. The clean groove is kept in the tab's storage,
 * see restoredBaseline.
 *
 * @param {Storage | null} [storage]  the tab's sessionStorage
 *
 * @returns {{markClean: function(string): void, isDirty: function(string): boolean,
 *            rebase: function(string, string): void, forget: function(string): void,
 *            cleanVersion: function(): number,
            cleanQuery: function(): (string | symbol | null),
            markStart: function(string | symbol): void,
 *            startVersion: function(): (number | null),
 *            onRebase: function(function(string, string): void): function(): void,
 *            onStart: function(function(): void): function(): void,
 *            onChange: function(function(): void): function(): void}}
 *   markClean takes the query that was loaded or saved. isDirty takes the query of the groove
 *   in the editor now. rebase takes the query before and after a change that is not an edit,
 *   such as the tempo that the metronome raises: a clean editor stays clean. forget takes the
 *   query of a save that the server refused. cleanVersion changes on each markClean, so a
 *   caller can tell that another groove was loaded or saved since its own markClean.
 *   cleanQuery is the clean groove: a query, NOTHING_SAVED, or null before the first mark.
 *   markStart is the markClean for the groove the page starts with, and startVersion is its
 *   cleanVersion, or null before it. It also takes NOTHING_SAVED, from restoredBaseline. onRebase listens to each rebase, onStart to markStart, and
 *   onChange to each markClean, markStart, rebase and forget. Each returns the call that stops
 *   listening.
 */
export function createDirtyState(storage = tabStorage()) {
  /** @type {string | symbol | null} */
  let clean = null;
  let version = 0;
  /** @type {number | null} */
  let start = null;
  const rebaseListeners = new Set();
  const startListeners = new Set();
  const changeListeners = new Set();
  const listen = (listeners, listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const changed = () => {
    for (const listener of changeListeners) listener();
  };
  // A refused save is kept as null: JSON has no symbol.
  const save = () =>
    writeItem(
      storage,
      CLEAN_KEY,
      JSON.stringify({ clean: clean === NOTHING_SAVED ? null : clean })
    );
  function setClean(query) {
    clean = query === NOTHING_SAVED ? NOTHING_SAVED : normalise(query);
    version += 1;
    save();
  }
  return {
    markClean(query) {
      setClean(query);
      changed();
    },
    markStart(query) {
      setClean(query);
      start = version;
      for (const listener of startListeners) listener();
      changed();
    },
    cleanVersion: () => version,
    cleanQuery: () => clean,
    startVersion: () => start,
    onRebase: (listener) => listen(rebaseListeners, listener),
    onStart: (listener) => listen(startListeners, listener),
    onChange: (listener) => listen(changeListeners, listener),
    isDirty(query) {
      return clean !== null && normalise(query) !== clean;
    },
    rebase(before, after) {
      if (clean !== null && normalise(before) === clean) {
        clean = normalise(after);
        save();
      }
      for (const listener of rebaseListeners) listener(before, after);
      changed();
    },
    forget(query) {
      if (clean !== null && normalise(query) === clean) {
        clean = NOTHING_SAVED;
        save();
      }
      changed();
    },
  };
}

/**
 * Tell listeners when the editor turns dirty or clean.
 *
 * The caller calls changed after each change of the groove in the editor. The dirty state
 * calls it itself after its own changes. A check runs once after the current task, so a pick,
 * which loads a groove and then marks it clean, does not look dirty for a moment.
 *
 * @param {ReturnType<typeof createDirtyState>} dirtyState
 * @param {function(): string} currentQuery  the query of the groove in the editor now
 * @param {function(function(): void): void} [schedule]  runs the check later
 * @returns {{changed: function(): void,
 *            onDirtyChange: function(function(boolean): void): function(): void}}
 *   onDirtyChange returns the call that stops listening.
 */
export function watchDirty(dirtyState, currentQuery, schedule = queueMicrotask) {
  const listeners = new Set();
  let dirty = false;
  let scheduled = false;
  function check() {
    scheduled = false;
    const next = dirtyState.isDirty(currentQuery());
    if (next === dirty) return;
    dirty = next;
    for (const listener of listeners) listener(dirty);
  }
  function changed() {
    if (scheduled) return;
    scheduled = true;
    schedule(check);
  }
  dirtyState.onChange(changed);
  return {
    changed,
    onDirtyChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
