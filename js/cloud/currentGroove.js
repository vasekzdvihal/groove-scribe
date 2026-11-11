// The saved groove that is open in the editor. The library panel offers Update for it.
//
// A record on this device keeps it for a reload: the id, the query the groove has in the
// library, and the query the editor showed. A reload trusts the record only when both still
// match. One record per account, so another account on this device never sees it.
import { sameGroove } from './dirtyState.js';

const recordKey = (uid) => `grooveScribe.currentGroove.${uid}`;

/** The version of a restored groove: the cleanVersion of the groove the page started with. */
export const PAGE_START = 'page start';

/**
 * @typedef {{id: string, savedQuery: string, editorQuery: string}} CurrentRecord
 * @typedef {{id: string, savedQuery: string, version: number | typeof PAGE_START}} CurrentGroove
 */

/**
 * Browser storage can throw in private windows. Without it, a reload just has no current groove.
 * @param {string} uid
 * @returns {CurrentRecord | null}
 */
export function readRecord(uid) {
  try {
    const saved = JSON.parse(localStorage.getItem(recordKey(uid)));
    return typeof saved?.id === 'string' ? saved : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} uid
 * @param {CurrentRecord | null} record  null removes it.
 */
export function writeRecord(uid, record) {
  try {
    if (record) localStorage.setItem(recordKey(uid), JSON.stringify(record));
    else localStorage.removeItem(recordKey(uid));
  } catch {
    /* after a reload, the groove is simply not the current one */
  }
}

/**
 * A change that is not an edit, such as a tempo raise, moves the query the editor shows.
 * @param {CurrentRecord | null} record
 * @param {string} before
 * @param {string} after
 * @returns {CurrentRecord | null}  the same record if it is about another groove
 */
export function rebaseRecord(record, before, after) {
  return record && sameGroove(record.editorQuery, before)
    ? { ...record, editorQuery: after }
    : record;
}

/**
 * What to do with the record of the last visit, once a list of grooves is there.
 * @param {CurrentRecord} record
 * @param {{id: string, query: string}[]} grooves
 * @param {{pageQuery: string, fromServer: boolean}} options  pageQuery is the query the page
 *        started with. A list from the server has the whole library, a cached one may not.
 * @returns {'keep' | 'drop' | 'wait'}
 */
export function restoreDecision(record, grooves, { pageQuery, fromServer }) {
  const groove = grooves.find((item) => item.id === record.id);
  if (!groove) return fromServer ? 'drop' : 'wait';
  return sameGroove(groove.query, record.savedQuery) && sameGroove(pageQuery, record.editorQuery)
    ? 'keep'
    : 'drop';
}

/**
 * The saved groove that the editor shows, or null. It stops being open when another groove is
 * loaded or saved, when it leaves the library, and when its library query changes, for example
 * on another device.
 * @param {CurrentGroove | null} current
 * @param {{id: string, query: string}[]} grooves
 * @param {{cleanVersion: number, startVersion: number | null}} versions  from the dirty state
 */
export function findOpenGroove(current, grooves, { cleanVersion, startVersion }) {
  if (!current) return null;
  const version = current.version === PAGE_START ? startVersion : current.version;
  if (version === null || version !== cleanVersion) return null;
  const groove = grooves.find((item) => item.id === current.id);
  return groove && sameGroove(groove.query, current.savedQuery) ? groove : null;
}

/**
 * Track the saved groove that the editor shows, for one signed-in session. It keeps the record
 * of this device in step, and restores the groove of the last visit once a list is there.
 *
 * @param {object} options
 * @param {string} options.uid  The signed-in user.
 * @param {string} options.pageQuery  The query the page started with.
 * @param {ReturnType<typeof import('./dirtyState.js').createDirtyState>} options.dirtyState
 * @param {{currentQuery: function(): string, rename: function(string): void}} options.editor
 * @param {function(): {id: string, query: string}[]} options.grooves  The grooves on screen.
 * @param {function(): boolean} options.isActive  False once the session is over.
 * @param {function(): void} options.onStart  Runs when the page marks its start.
 * @param {function(): void} options.onCleanChange  Runs after the current task when the clean
 *        groove changed, for example when the Grooves menu loaded another groove.
 */
export function createCurrentGroove({
  uid,
  pageQuery,
  dirtyState,
  editor,
  grooves,
  isActive,
  onStart,
  onCleanChange,
}) {
  // The saved groove that the editor shows. See findOpenGroove.
  /** @type {CurrentGroove | null} */
  let current = null;
  // The current groove of the last visit, until a list shows whether it is still current.
  let restoring = readRecord(uid);

  // A tempo raise is not an edit. The record follows it, so a reload still finds the groove.
  const stopRebase = dirtyState.onRebase((before, after) => {
    const stored = readRecord(uid);
    const next = rebaseRecord(stored, before, after);
    if (next !== stored) writeRecord(uid, next);
  });

  // A groove restored before the page marked its start becomes open only then.
  const stopStart = dirtyState.onStart(() => {
    if (isActive()) onStart();
  });

  // Check after the current task: a pick sets the new open groove right after it marks it clean.
  const stopChange = dirtyState.onChange(() =>
    queueMicrotask(() => {
      if (isActive()) onCleanChange();
    })
  );

  /** The saved groove that the editor shows, or null. */
  const open = () =>
    findOpenGroove(current, grooves(), {
      cleanVersion: dirtyState.cleanVersion(),
      startVersion: dirtyState.startVersion(),
    });

  /** Call after markClean: the groove in the editor is now this saved groove. */
  function set(id, savedQuery) {
    restoring = null;
    current = { id, savedQuery, version: dirtyState.cleanVersion() };
    writeRecord(uid, { id, savedQuery, editorQuery: editor.currentQuery() });
  }

  /**
   * After a reload, the groove of the last visit is current if the library still has it as it
   * was, and the page started with it. It stays current until another groove is loaded, also
   * when the panel opens before the page has marked its start.
   * @param {boolean} fromServer  The grooves on screen are the whole library.
   * @returns {boolean} true when it is kept
   */
  function restore(fromServer) {
    if (!restoring) return false;
    const decision = restoreDecision(restoring, grooves(), { pageQuery, fromServer });
    if (decision === 'wait') return false;
    if (decision === 'keep') {
      current = { id: restoring.id, savedQuery: restoring.savedQuery, version: PAGE_START };
    } else {
      writeRecord(uid, null);
    }
    restoring = null;
    return decision === 'keep';
  }

  /**
   * The groove in the editor takes the new name of its saved groove. Its query changed in the
   * library too, so the groove stays open. A clean editor stays clean, unless the server refuses.
   * @param {{id: string, title: string, committed: Promise<unknown>}} written  the rename
   * @param {boolean} wasClean  the editor had no edits when the rename started
   * @returns {'clean' | 'edits' | null}  null when the renamed groove is not the open one
   */
  function followRename(written, wasClean) {
    if (current?.id !== written.id) return null;
    const savedQuery = grooves().find((item) => item.id === written.id)?.query;
    if (!savedQuery) return null;
    editor.rename(written.title);
    if (!wasClean) {
      // The edits are not saved: Update still saves them over this groove.
      current = { ...current, savedQuery };
      const stored = readRecord(uid);
      if (stored?.id === written.id) writeRecord(uid, { ...stored, savedQuery });
      return 'edits';
    }
    const query = editor.currentQuery();
    dirtyState.markClean(query);
    written.committed.catch(() => dirtyState.forget(query));
    set(written.id, savedQuery);
    return 'clean';
  }

  // The session is over: nothing may keep running for it.
  function stop() {
    stopRebase();
    stopStart();
    stopChange();
  }

  return { open, set, restore, followRename, stop };
}
