// Does the editor show changes that are not saved? The editor is clean when its groove is the
// groove that was last loaded or saved.
import { parseGrooveLink } from './grooveLink.js';

// The clean groove after a refused save: no query is equal to it.
const NOTHING_SAVED = Symbol('nothing saved');

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
 * Before the first markClean, nothing is dirty.
 *
 * @returns {{markClean: function(string): void, isDirty: function(string): boolean,
 *            rebase: function(string, string): void, forget: function(string): void,
 *            cleanVersion: function(): number, markStart: function(string): void,
 *            startVersion: function(): (number | null),
 *            onRebase: function(function(string, string): void): function(): void,
 *            onStart: function(function(): void): function(): void}}
 *   markClean takes the query that was loaded or saved. isDirty takes the query of the groove
 *   in the editor now. rebase takes the query before and after a change that is not an edit,
 *   such as the tempo that the metronome raises: a clean editor stays clean. forget takes the
 *   query of a save that the server refused. cleanVersion changes on each markClean, so a
 *   caller can tell that another groove was loaded or saved since its own markClean.
 *   markStart is the markClean for the groove the page starts with, and startVersion is its
 *   cleanVersion, or null before it. onRebase listens to each rebase, and onStart to markStart.
 *   Both return the call that stops listening.
 */
export function createDirtyState() {
  /** @type {string | symbol | null} */
  let clean = null;
  let version = 0;
  /** @type {number | null} */
  let start = null;
  const rebaseListeners = new Set();
  const startListeners = new Set();
  const listen = (listeners, listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  function markClean(query) {
    clean = normalise(query);
    version += 1;
  }
  return {
    markClean,
    markStart(query) {
      markClean(query);
      start = version;
      for (const listener of startListeners) listener();
    },
    cleanVersion: () => version,
    startVersion: () => start,
    onRebase: (listener) => listen(rebaseListeners, listener),
    onStart: (listener) => listen(startListeners, listener),
    isDirty(query) {
      return clean !== null && normalise(query) !== clean;
    },
    rebase(before, after) {
      if (clean !== null && normalise(before) === clean) clean = normalise(after);
      for (const listener of rebaseListeners) listener(before, after);
    },
    forget(query) {
      if (clean !== null && normalise(query) === clean) clean = NOTHING_SAVED;
    },
  };
}
