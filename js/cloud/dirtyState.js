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

/**
 * Before the first markClean, nothing is dirty.
 *
 * @returns {{markClean: function(string): void, isDirty: function(string): boolean,
 *            rebase: function(string, string): void, forget: function(string): void}}
 *   markClean takes the query that was loaded or saved. isDirty takes the query of the groove
 *   in the editor now. rebase takes the query before and after a change that is not an edit,
 *   such as the tempo that the metronome raises: a clean editor stays clean. forget takes the
 *   query of a save that the server refused.
 */
export function createDirtyState() {
  /** @type {string | symbol | null} */
  let clean = null;
  return {
    markClean(query) {
      clean = normalise(query);
    },
    isDirty(query) {
      return clean !== null && normalise(query) !== clean;
    },
    rebase(before, after) {
      if (clean !== null && normalise(before) === clean) clean = normalise(after);
    },
    forget(query) {
      if (clean !== null && normalise(query) === clean) clean = NOTHING_SAVED;
    },
  };
}
