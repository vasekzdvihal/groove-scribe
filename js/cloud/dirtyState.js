// Does the editor show changes that are not saved? The editor is clean when its groove is the
// groove that was last loaded or saved.
import { parseGrooveLink } from './grooveLink.js';

// Compare the groove only: flags such as Debug, and the address around the query, do not count.
function normalise(query) {
  const parsed = parseGrooveLink(query);
  return parsed.ok ? parsed.query : String(query ?? '');
}

/**
 * @returns {{markClean: function(string): void, isDirty: function(string): boolean}}
 *          markClean takes the query that was loaded or saved. isDirty takes the query of the
 *          groove in the editor now. Before the first markClean, nothing is dirty.
 */
export function createDirtyState() {
  let clean = null;
  return {
    markClean(query) {
      clean = normalise(query);
    },
    isDirty(query) {
      return clean !== null && normalise(query) !== clean;
    },
  };
}
