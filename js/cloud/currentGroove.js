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
