import { describe, it, expect } from 'vitest';
import {
  NOTHING_SAVED,
  createDirtyState,
  restoredBaseline,
  sameGroove,
  watchDirty,
} from '../../js/cloud/dirtyState.js';

const QUERY = '?TimeSig=4/4&Div=16&Title=Beat&Tempo=95&Measures=1&H=|x-x-|&S=|--O-|&K=|o---|';
const EDITED = QUERY.replace('S=|--O-|', 'S=|O-O-|');

// A tab's sessionStorage. Each test gets its own, so nothing leaks between them.
function createStorage() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

describe('createDirtyState', () => {
  it('is clean before anything is marked', () => {
    expect(createDirtyState(createStorage()).isDirty(QUERY)).toBe(false);
  });

  it('is clean for the marked query and dirty for another', () => {
    const state = createDirtyState(createStorage());
    state.markClean(QUERY);
    expect(state.isDirty(QUERY)).toBe(false);
    expect(state.isDirty(EDITED)).toBe(true);
  });

  it('follows the last marked query', () => {
    const state = createDirtyState(createStorage());
    state.markClean(QUERY);
    state.markClean(EDITED);
    expect(state.isDirty(EDITED)).toBe(false);
    expect(state.isDirty(QUERY)).toBe(true);
  });

  it('compares the groove only, not the flags or the address around it', () => {
    const state = createDirtyState(createStorage());
    state.markClean('https://example.com/index.html' + QUERY + '&Debug=1');
    expect(state.isDirty(QUERY)).toBe(false);
    expect(state.isDirty(QUERY.slice(1))).toBe(false);
  });

  it('moves the clean groove along with a change that is not an edit', () => {
    const state = createDirtyState(createStorage());
    state.markClean(QUERY);
    const faster = QUERY.replace('Tempo=95', 'Tempo=96');
    state.rebase('https://example.com/' + QUERY, faster);
    expect(state.isDirty(faster)).toBe(false);
    expect(state.isDirty(QUERY)).toBe(true);
  });

  it('keeps edits dirty through a change that is not an edit', () => {
    const state = createDirtyState(createStorage());
    state.markClean(QUERY);
    const faster = EDITED.replace('Tempo=95', 'Tempo=96');
    state.rebase(EDITED, faster);
    expect(state.isDirty(faster)).toBe(true);
    expect(state.isDirty(QUERY)).toBe(false);
  });

  it('does nothing on a rebase before anything is marked', () => {
    const state = createDirtyState(createStorage());
    state.rebase(QUERY, EDITED);
    expect(state.isDirty(QUERY)).toBe(false);
    expect(state.isDirty(EDITED)).toBe(false);
  });

  it('forgets a clean groove whose save was refused', () => {
    const state = createDirtyState(createStorage());
    state.markClean(QUERY);
    state.forget(QUERY);
    expect(state.isDirty(QUERY)).toBe(true);
    expect(state.isDirty(EDITED)).toBe(true);
  });

  it('keeps a newer clean groove when an older save is refused', () => {
    const state = createDirtyState(createStorage());
    state.markClean(QUERY);
    state.markClean(EDITED);
    state.forget(QUERY);
    expect(state.isDirty(EDITED)).toBe(false);
  });

  it('compares the raw text of a query that is not a groove link', () => {
    const state = createDirtyState(createStorage());
    state.markClean('?Debug=1');
    expect(state.isDirty('?Debug=1')).toBe(false);
    expect(state.isDirty('?Debug=2')).toBe(true);
  });

  it('changes cleanVersion on each markClean, and not on rebase or forget', () => {
    const state = createDirtyState(createStorage());
    const start = state.cleanVersion();
    state.markClean(QUERY);
    const marked = state.cleanVersion();
    expect(marked).not.toBe(start);
    state.rebase(QUERY, EDITED);
    state.forget(EDITED);
    expect(state.cleanVersion()).toBe(marked);
    state.markClean(QUERY);
    expect(state.cleanVersion()).not.toBe(marked);
  });
});

describe('sameGroove', () => {
  it('compares the groove only, not the flags or the address around it', () => {
    expect(sameGroove('https://example.com/index.html' + QUERY + '&Debug=1', QUERY)).toBe(true);
    expect(sameGroove(QUERY, EDITED)).toBe(false);
  });
});

describe('the page start', () => {
  it('has no start version until markStart, then the version of that mark', () => {
    const state = createDirtyState(createStorage());
    expect(state.startVersion()).toBeNull();
    state.markStart(QUERY);
    expect(state.isDirty(QUERY)).toBe(false);
    expect(state.startVersion()).toBe(state.cleanVersion());
    state.markClean(EDITED);
    expect(state.startVersion()).not.toBe(state.cleanVersion());
  });

  it('tells listeners about each rebase until they stop listening', () => {
    const state = createDirtyState(createStorage());
    const calls = [];
    const stop = state.onRebase((before, after) => calls.push([before, after]));
    state.rebase(QUERY, EDITED);
    stop();
    state.rebase(EDITED, QUERY);
    expect(calls).toEqual([[QUERY, EDITED]]);
  });

  it('tells listeners when the page start is marked', () => {
    const state = createDirtyState(createStorage());
    const calls = [];
    const stop = state.onStart(() => calls.push(state.startVersion()));
    state.markClean(QUERY);
    state.markStart(QUERY);
    stop();
    state.markStart(QUERY);
    expect(calls).toEqual([2]);
  });
});

describe('onChange', () => {
  it('tells listeners after each markClean, markStart, rebase and forget', () => {
    const state = createDirtyState(createStorage());
    const calls = [];
    const stop = state.onChange(() => calls.push(state.startVersion()));
    state.markClean(QUERY);
    state.markStart(QUERY);
    state.rebase(QUERY, EDITED);
    state.forget(EDITED);
    stop();
    state.markClean(QUERY);
    // markStart tells them after the start version is set.
    expect(calls).toEqual([null, 2, 2, 2]);
  });
});

describe('watchDirty', () => {
  // Run the checks by hand, so a test sees each one.
  function setUp() {
    const state = createDirtyState(createStorage());
    const editor = { query: QUERY };
    const queued = [];
    const watch = watchDirty(
      state,
      () => editor.query,
      (task) => queued.push(task)
    );
    const calls = [];
    watch.onDirtyChange((dirty) => calls.push(dirty));
    const flush = () => queued.splice(0).forEach((task) => task());
    return { state, editor, watch, calls, flush, queued };
  }

  it('tells listeners when an edit makes the editor dirty, and when Undo makes it clean', () => {
    const { state, editor, watch, calls, flush } = setUp();
    state.markStart(QUERY);
    flush();
    expect(calls).toEqual([]);
    editor.query = EDITED;
    watch.changed();
    flush();
    expect(calls).toEqual([true]);
    editor.query = QUERY;
    watch.changed();
    flush();
    expect(calls).toEqual([true, false]);
  });

  it('does not tell listeners about a change that keeps the dirty value', () => {
    const { state, editor, watch, calls, flush } = setUp();
    state.markStart(QUERY);
    editor.query = EDITED;
    watch.changed();
    flush();
    editor.query = EDITED.replace('Tempo=95', 'Tempo=96');
    watch.changed();
    flush();
    expect(calls).toEqual([true]);
  });

  it('checks after markClean, rebase and forget', () => {
    const { state, editor, calls, flush } = setUp();
    state.markStart(QUERY);
    editor.query = EDITED;
    state.markClean(EDITED);
    flush();
    expect(calls).toEqual([]);
    state.forget(EDITED);
    flush();
    expect(calls).toEqual([true]);
    state.markClean(EDITED);
    flush();
    expect(calls).toEqual([true, false]);
    const faster = EDITED.replace('Tempo=95', 'Tempo=96');
    editor.query = faster;
    state.rebase(EDITED, faster);
    flush();
    expect(calls).toEqual([true, false]);
  });

  it('makes one check for several changes in one task, so a pick does not flicker', () => {
    const { state, editor, watch, calls, flush, queued } = setUp();
    state.markStart(QUERY);
    flush();
    // A pick: the editor loads another groove, then marks it clean.
    editor.query = EDITED;
    watch.changed();
    state.markClean(EDITED);
    expect(queued).toHaveLength(1);
    flush();
    expect(calls).toEqual([]);
  });

  it('has no dirty getter: callers listen with onDirtyChange', () => {
    const { watch } = setUp();
    expect(Object.keys(watch).sort()).toEqual(['changed', 'onDirtyChange']);
  });

  it('stops telling a listener that stopped listening', () => {
    const { state, editor, watch, flush } = setUp();
    const calls = [];
    const stop = watch.onDirtyChange((dirty) => calls.push(dirty));
    state.markStart(QUERY);
    stop();
    editor.query = EDITED;
    watch.changed();
    flush();
    expect(calls).toEqual([]);
  });
});

describe('the clean groove of the tab', () => {
  const OTHER = QUERY.replace('Tempo=95', 'Tempo=60');

  it('survives a reload, so a page with edits stays dirty', () => {
    const storage = createStorage();
    const state = createDirtyState(storage);
    state.remember(QUERY);
    state.markStart(QUERY);
    state.remember(EDITED);
    const baseline = restoredBaseline(EDITED, storage);
    expect(sameGroove(baseline, QUERY)).toBe(true);
    const after = createDirtyState(storage);
    after.markStart(baseline);
    expect(after.isDirty(EDITED)).toBe(true);
    expect(after.isDirty(QUERY)).toBe(false);
  });

  it('follows markClean, rebase and forget', () => {
    const storage = createStorage();
    const state = createDirtyState(storage);
    const faster = QUERY.replace('Tempo=95', 'Tempo=96');
    state.remember(faster);
    state.markClean(QUERY);
    state.rebase(QUERY, faster);
    expect(sameGroove(restoredBaseline(faster, storage), faster)).toBe(true);
    state.forget(faster);
    expect(restoredBaseline(faster, storage)).toBe(NOTHING_SAVED);
    const after = createDirtyState(storage);
    after.markStart(NOTHING_SAVED);
    expect(after.isDirty(faster)).toBe(true);
  });

  it('is not used for another address, such as a new link opened in the same tab', () => {
    const storage = createStorage();
    const state = createDirtyState(storage);
    state.markStart(QUERY);
    state.remember(EDITED);
    expect(restoredBaseline(OTHER, storage)).toBeNull();
    // Flags around the groove do not count.
    expect(sameGroove(restoredBaseline(EDITED + '&Debug=1', storage), QUERY)).toBe(true);
  });

  it('is null in a tab that has none', () => {
    expect(restoredBaseline(QUERY, createStorage())).toBeNull();
  });

  // Page A, then page B in the same tab, then Back: the back-forward cache brings page A back
  // with its own memory. Page B wrote the tab's storage last.
  it('belongs to the page that wrote the address, after Back restores an older page', () => {
    const storage = createStorage();
    const pageA = createDirtyState(storage);
    pageA.remember(QUERY);
    pageA.markStart(QUERY);
    const pageB = createDirtyState(storage);
    pageB.remember(OTHER);
    pageB.markStart(OTHER);
    // Back to A, which shows again, then an edit and a reload.
    pageA.remember(QUERY);
    expect(sameGroove(restoredBaseline(QUERY, storage), QUERY)).toBe(true);
    pageA.remember(EDITED);
    const baseline = restoredBaseline(EDITED, storage);
    expect(sameGroove(baseline, QUERY)).toBe(true);
    expect(sameGroove(baseline, OTHER)).toBe(false);
  });

  it('writes the address and the clean groove as one item', () => {
    const storage = createStorage();
    const pageA = createDirtyState(storage);
    pageA.remember(QUERY);
    pageA.markStart(QUERY);
    const pageB = createDirtyState(storage);
    pageB.remember(OTHER);
    pageB.markClean(OTHER);
    // A rebase on A after Back writes A's own address with A's clean groove.
    const faster = QUERY.replace('Tempo=95', 'Tempo=96');
    pageA.rebase(QUERY, faster);
    expect(restoredBaseline(OTHER, storage)).toBeNull();
  });

  it('works without storage, and with storage that throws', () => {
    const throwing = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      removeItem: () => {},
    };
    for (const storage of [null, throwing]) {
      const state = createDirtyState(storage);
      expect(() => state.markStart(QUERY)).not.toThrow();
      expect(() => state.remember(QUERY)).not.toThrow();
      expect(restoredBaseline(QUERY, storage)).toBeNull();
    }
  });

  it('tells the clean query', () => {
    const state = createDirtyState(createStorage());
    expect(state.cleanQuery()).toBeNull();
    state.markClean('https://example.com/' + QUERY);
    expect(sameGroove(state.cleanQuery(), QUERY)).toBe(true);
    state.forget(QUERY);
    expect(state.cleanQuery()).toBe(NOTHING_SAVED);
  });
});
