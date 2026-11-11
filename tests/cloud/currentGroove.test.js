import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  createCurrentGroove,
  findOpenGroove,
  readRecord,
  rebaseRecord,
  restoreDecision,
  writeRecord,
} from '../../js/cloud/currentGroove.js';
import { NOTHING_SAVED, createDirtyState } from '../../js/cloud/dirtyState.js';

const QUERY = '?TimeSig=4/4&Div=16&Title=Beat&Tempo=95&Measures=1&H=|x-x-|&S=|--O-|&K=|o---|';
const EDITED = QUERY.replace('S=|--O-|', 'S=|O-O-|');
const FASTER = QUERY.replace('Tempo=95', 'Tempo=100');
const groove = (query = QUERY) => ({ id: 'g1', query, lessonId: null, title: 'Beat' });
const record = { id: 'g1', savedQuery: QUERY, editorQuery: QUERY };

describe('restoreDecision', () => {
  const clean = (cleanQuery, fromServer = false) => ({ cleanQuery, fromServer });

  it('keeps the groove when the library and the clean groove both still have it', () => {
    expect(
      restoreDecision(record, [groove()], clean('?emulator=1&' + QUERY.slice(1) + '&Debug=1'))
    ).toBe('keep');
  });

  it('drops it when the clean groove is another groove', () => {
    expect(restoreDecision(record, [groove()], clean(EDITED))).toBe('drop');
  });

  it('drops it when a save was refused, so nothing is clean', () => {
    expect(restoreDecision(record, [groove()], clean(NOTHING_SAVED))).toBe('drop');
  });

  it('drops it when the library query changed, for example on another device', () => {
    expect(restoreDecision(record, [groove(EDITED)], clean(QUERY))).toBe('drop');
  });

  it('waits for the server when the cache does not have the groove', () => {
    expect(restoreDecision(record, [], clean(QUERY, false))).toBe('wait');
  });

  it('drops it when the server list does not have the groove', () => {
    expect(restoreDecision(record, [], clean(QUERY, true))).toBe('drop');
  });
});

describe('findOpenGroove', () => {
  it('finds the groove while no other groove was loaded or saved', () => {
    const current = { id: 'g1', savedQuery: QUERY, version: 3 };
    expect(findOpenGroove(current, [groove()], 3)).toEqual(groove());
    expect(findOpenGroove(current, [groove()], 4)).toBeNull();
  });

  it('turns off when the library query changes', () => {
    const current = { id: 'g1', savedQuery: QUERY, version: 3 };
    expect(findOpenGroove(current, [groove(EDITED)], 3)).toBeNull();
  });

  it('turns off when the groove is gone', () => {
    expect(findOpenGroove({ id: 'g1', savedQuery: QUERY, version: 3 }, [], 3)).toBeNull();
  });

  it('has nothing without a current groove', () => {
    expect(findOpenGroove(null, [groove()], 1)).toBeNull();
  });
});

describe('rebaseRecord', () => {
  it('moves the editor query along with a change that is not an edit', () => {
    expect(rebaseRecord(record, QUERY, FASTER)).toEqual({ ...record, editorQuery: FASTER });
  });

  it('leaves a record of another groove alone', () => {
    expect(rebaseRecord(record, EDITED, FASTER)).toBe(record);
    expect(rebaseRecord(null, QUERY, FASTER)).toBeNull();
  });
});

describe('the stored record', () => {
  // Node has its own sessionStorage global, which is undefined without a storage file and hides
  // the one of jsdom.
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', globalThis.jsdom.window.sessionStorage);
    vi.stubGlobal('localStorage', globalThis.jsdom.window.localStorage);
  });
  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is kept per tab, not on the device, so another tab cannot drop it', () => {
    writeRecord('ana', record);
    expect(localStorage.getItem('grooveScribe.currentGroove.ana')).toBeNull();
    expect(sessionStorage.getItem('grooveScribe.currentGroove.ana')).not.toBeNull();
  });

  it('is kept per account', () => {
    writeRecord('ana', record);
    expect(readRecord('ana')).toEqual(record);
    expect(readRecord('bob')).toBeNull();
    writeRecord('ana', null);
    expect(readRecord('ana')).toBeNull();
  });

  it('ignores storage that throws or holds nonsense', () => {
    sessionStorage.setItem('grooveScribe.currentGroove.ana', '{not json');
    expect(readRecord('ana')).toBeNull();
    sessionStorage.setItem('grooveScribe.currentGroove.ana', '{"id":5}');
    expect(readRecord('ana')).toBeNull();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    expect(readRecord('ana')).toBeNull();
    expect(() => writeRecord('ana', record)).not.toThrow();
  });
});

describe('createCurrentGroove', () => {
  beforeEach(() => vi.stubGlobal('sessionStorage', globalThis.jsdom.window.sessionStorage));
  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  // The editor holds a query. A rename writes the new title into it, as the real one does.
  function setUp({
    pageQuery = QUERY,
    list = [groove()],
    dirtyState = createDirtyState(null),
  } = {}) {
    const editor = {
      query: pageQuery,
      currentQuery: () => editor.query,
      rename: vi.fn((name) => {
        editor.query = editor.query.replace(/Title=[^&]*/, `Title=${name}`);
      }),
    };
    const calls = { start: 0, change: 0 };
    let active = true;
    const tracker = createCurrentGroove({
      uid: 'ana',
      dirtyState,
      editor,
      grooves: () => list,
      isActive: () => active,
      onStart: () => (calls.start += 1),
      onCleanChange: () => (calls.change += 1),
    });
    const end = () => (active = false);
    return { dirtyState, editor, tracker, calls, end, list };
  }

  it('opens a groove that was set, and closes it when another groove is loaded', () => {
    const { dirtyState, tracker } = setUp();
    dirtyState.markStart(QUERY);
    expect(tracker.open()).toBeNull();
    dirtyState.markClean(QUERY);
    tracker.set('g1', QUERY);
    expect(tracker.open()).toEqual(groove());
    expect(readRecord('ana')).toEqual(record);
    dirtyState.markClean(EDITED);
    expect(tracker.open()).toBeNull();
  });

  it('restores the groove of the last visit when the page started with it', () => {
    writeRecord('ana', record);
    const dirtyState = createDirtyState(null);
    dirtyState.markStart(QUERY);
    const { tracker } = setUp({ dirtyState });
    expect(tracker.restore(true)).toBe(true);
    expect(tracker.open()).toEqual(groove());
  });

  it('decides when the page marks its start, if the panel opened before', () => {
    writeRecord('ana', record);
    const { dirtyState, tracker, calls } = setUp();
    expect(tracker.restore(true)).toBe(false);
    expect(tracker.open()).toBeNull();
    dirtyState.markStart(QUERY);
    expect(tracker.open()).toEqual(groove());
    expect(calls.start).toBe(1);
  });

  it('keeps it after a reload of a page with edits: the clean groove is the saved one', () => {
    writeRecord('ana', record);
    const dirtyState = createDirtyState(null);
    // The tab kept its clean groove, so the page starts dirty.
    dirtyState.markStart(QUERY);
    const { tracker, editor } = setUp({ pageQuery: EDITED, dirtyState });
    expect(tracker.restore(true)).toBe(true);
    expect(tracker.open()).toEqual(groove());
    expect(dirtyState.isDirty(editor.query)).toBe(true);
  });

  it('drops the record when the page started with another groove', () => {
    writeRecord('ana', record);
    const dirtyState = createDirtyState(null);
    dirtyState.markStart(EDITED);
    const { tracker } = setUp({ pageQuery: EDITED, dirtyState });
    expect(tracker.restore(true)).toBe(false);
    expect(readRecord('ana')).toBeNull();
  });

  it('keeps it in a later session on the same page, when the clean groove is still the same', () => {
    const { dirtyState, tracker, editor } = setUp({ pageQuery: EDITED });
    dirtyState.markStart(EDITED);
    // The first session opened the saved groove. The user signs out and in again.
    editor.query = QUERY;
    dirtyState.markClean(QUERY);
    tracker.set('g1', QUERY);
    tracker.stop();
    const later = setUp({ pageQuery: EDITED, dirtyState });
    expect(later.tracker.restore(true)).toBe(true);
    expect(later.tracker.open()).toEqual(groove());
  });

  it('keeps it when a change that is not an edit came before the list', () => {
    writeRecord('ana', record);
    const dirtyState = createDirtyState(null);
    dirtyState.markStart(QUERY);
    const { tracker } = setUp({ dirtyState });
    dirtyState.rebase(QUERY, FASTER);
    expect(tracker.restore(true)).toBe(true);
  });

  it('waits for the server before it drops a groove the cache does not have', () => {
    writeRecord('ana', record);
    const dirtyState = createDirtyState(null);
    dirtyState.markStart(QUERY);
    const { tracker, list } = setUp({ list: [], dirtyState });
    expect(tracker.restore(false)).toBe(false);
    expect(readRecord('ana')).toEqual(record);
    list.push(groove());
    expect(tracker.restore(false)).toBe(true);
  });

  it('moves the record along with a change that is not an edit', () => {
    const { dirtyState, tracker } = setUp();
    dirtyState.markStart(QUERY);
    tracker.set('g1', QUERY);
    dirtyState.rebase(QUERY, FASTER);
    expect(readRecord('ana')).toEqual({ ...record, editorQuery: FASTER });
  });

  it('follows a rename of the open groove, and a clean editor stays clean', () => {
    const { dirtyState, editor, tracker, list } = setUp();
    dirtyState.markStart(QUERY);
    tracker.set('g1', QUERY);
    const renamed = QUERY.replace('Title=Beat', 'Title=Fresh');
    list[0] = { ...groove(renamed), title: 'Fresh' };
    const written = { id: 'g1', title: 'Fresh', committed: Promise.resolve() };
    expect(tracker.followRename(written, true)).toBe('clean');
    expect(editor.rename).toHaveBeenCalledWith('Fresh');
    expect(dirtyState.isDirty(editor.query)).toBe(false);
    expect(tracker.open()?.id).toBe('g1');
  });

  it('follows a rename and keeps the edits of a dirty editor', () => {
    const { dirtyState, editor, tracker, list } = setUp();
    dirtyState.markStart(QUERY);
    tracker.set('g1', QUERY);
    editor.query = EDITED;
    const renamed = QUERY.replace('Title=Beat', 'Title=Fresh');
    list[0] = { ...groove(renamed), title: 'Fresh' };
    const written = { id: 'g1', title: 'Fresh', committed: Promise.resolve() };
    expect(tracker.followRename(written, false)).toBe('edits');
    expect(dirtyState.isDirty(editor.query)).toBe(true);
    expect(tracker.open()?.id).toBe('g1');
    expect(readRecord('ana')?.savedQuery).toBe(renamed);
  });

  it('ignores a rename of a groove that is not open', () => {
    const { editor, tracker } = setUp();
    const written = { id: 'g1', title: 'Fresh', committed: Promise.resolve() };
    expect(tracker.followRename(written, true)).toBeNull();
    expect(editor.rename).not.toHaveBeenCalled();
  });

  it('tells the panel about the start and about clean changes until it stops', async () => {
    const { dirtyState, tracker, calls } = setUp();
    dirtyState.markStart(QUERY);
    await Promise.resolve();
    expect(calls).toEqual({ start: 1, change: 1 });
    tracker.stop();
    dirtyState.markStart(QUERY);
    dirtyState.rebase(QUERY, FASTER);
    await Promise.resolve();
    expect(calls).toEqual({ start: 1, change: 1 });
  });

  it('tells nothing to a session that is over', async () => {
    const { dirtyState, calls, end } = setUp();
    end();
    dirtyState.markStart(QUERY);
    await Promise.resolve();
    expect(calls).toEqual({ start: 0, change: 0 });
  });
});
