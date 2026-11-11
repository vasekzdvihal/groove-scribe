import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  PAGE_START,
  createCurrentGroove,
  findOpenGroove,
  readRecord,
  rebaseRecord,
  restoreDecision,
  writeRecord,
} from '../../js/cloud/currentGroove.js';
import { createDirtyState } from '../../js/cloud/dirtyState.js';

const QUERY = '?TimeSig=4/4&Div=16&Title=Beat&Tempo=95&Measures=1&H=|x-x-|&S=|--O-|&K=|o---|';
const EDITED = QUERY.replace('S=|--O-|', 'S=|O-O-|');
const FASTER = QUERY.replace('Tempo=95', 'Tempo=100');
const groove = (query = QUERY) => ({ id: 'g1', query, lessonId: null, title: 'Beat' });
const record = { id: 'g1', savedQuery: QUERY, editorQuery: QUERY };

describe('restoreDecision', () => {
  const page = (pageQuery, fromServer = false) => ({ pageQuery, fromServer });

  it('keeps the groove when the library and the page both still have it', () => {
    expect(
      restoreDecision(record, [groove()], page('?emulator=1&' + QUERY.slice(1) + '&Debug=1'))
    ).toBe('keep');
  });

  it('drops it when the page started with an edited groove', () => {
    expect(restoreDecision(record, [groove()], page(EDITED))).toBe('drop');
  });

  it('drops it when the library query changed, for example on another device', () => {
    expect(restoreDecision(record, [groove(EDITED)], page(QUERY))).toBe('drop');
  });

  it('waits for the server when the cache does not have the groove', () => {
    expect(restoreDecision(record, [], page(QUERY, false))).toBe('wait');
  });

  it('drops it when the server list does not have the groove', () => {
    expect(restoreDecision(record, [], page(QUERY, true))).toBe('drop');
  });
});

describe('findOpenGroove', () => {
  const versions = (cleanVersion, startVersion = null) => ({ cleanVersion, startVersion });

  it('finds the groove while no other groove was loaded or saved', () => {
    const current = { id: 'g1', savedQuery: QUERY, version: 3 };
    expect(findOpenGroove(current, [groove()], versions(3))).toEqual(groove());
    expect(findOpenGroove(current, [groove()], versions(4))).toBeNull();
  });

  it('turns off when the library query changes', () => {
    const current = { id: 'g1', savedQuery: QUERY, version: 3 };
    expect(findOpenGroove(current, [groove(EDITED)], versions(3))).toBeNull();
  });

  it('turns off when the groove is gone', () => {
    expect(findOpenGroove({ id: 'g1', savedQuery: QUERY, version: 3 }, [], versions(3))).toBeNull();
  });

  it('follows the page start for a restored groove', () => {
    const current = { id: 'g1', savedQuery: QUERY, version: PAGE_START };
    // The page has not marked its start yet.
    expect(findOpenGroove(current, [groove()], versions(0, null))).toBeNull();
    expect(findOpenGroove(current, [groove()], versions(1, 1))).toEqual(groove());
    // Another groove was loaded after the start.
    expect(findOpenGroove(current, [groove()], versions(2, 1))).toBeNull();
  });

  it('has nothing without a current groove', () => {
    expect(findOpenGroove(null, [groove()], versions(1))).toBeNull();
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
  // Node has its own localStorage global, which is undefined without a storage file and hides
  // the one of jsdom.
  beforeEach(() => vi.stubGlobal('localStorage', globalThis.jsdom.window.localStorage));
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is kept per account', () => {
    writeRecord('ana', record);
    expect(readRecord('ana')).toEqual(record);
    expect(readRecord('bob')).toBeNull();
    writeRecord('ana', null);
    expect(readRecord('ana')).toBeNull();
  });

  it('ignores storage that throws or holds nonsense', () => {
    localStorage.setItem('grooveScribe.currentGroove.ana', '{not json');
    expect(readRecord('ana')).toBeNull();
    localStorage.setItem('grooveScribe.currentGroove.ana', '{"id":5}');
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
  beforeEach(() => vi.stubGlobal('localStorage', globalThis.jsdom.window.localStorage));
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  // The editor holds a query. A rename writes the new title into it, as the real one does.
  function setUp({ pageQuery = QUERY, list = [groove()] } = {}) {
    const dirtyState = createDirtyState();
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
      pageQuery,
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
    const { dirtyState, tracker } = setUp();
    expect(tracker.restore(true)).toBe(true);
    // The panel opened before the page marked its start.
    expect(tracker.open()).toBeNull();
    dirtyState.markStart(QUERY);
    expect(tracker.open()).toEqual(groove());
  });

  it('drops the record when the page started with another groove', () => {
    writeRecord('ana', record);
    const { tracker } = setUp({ pageQuery: EDITED });
    expect(tracker.restore(true)).toBe(false);
    expect(readRecord('ana')).toBeNull();
  });

  it('waits for the server before it drops a groove the cache does not have', () => {
    writeRecord('ana', record);
    const { tracker, list } = setUp({ list: [] });
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
