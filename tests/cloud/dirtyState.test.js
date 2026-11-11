import { describe, it, expect } from 'vitest';
import { createDirtyState, sameGroove } from '../../js/cloud/dirtyState.js';

const QUERY = '?TimeSig=4/4&Div=16&Title=Beat&Tempo=95&Measures=1&H=|x-x-|&S=|--O-|&K=|o---|';
const EDITED = QUERY.replace('S=|--O-|', 'S=|O-O-|');

describe('createDirtyState', () => {
  it('is clean before anything is marked', () => {
    expect(createDirtyState().isDirty(QUERY)).toBe(false);
  });

  it('is clean for the marked query and dirty for another', () => {
    const state = createDirtyState();
    state.markClean(QUERY);
    expect(state.isDirty(QUERY)).toBe(false);
    expect(state.isDirty(EDITED)).toBe(true);
  });

  it('follows the last marked query', () => {
    const state = createDirtyState();
    state.markClean(QUERY);
    state.markClean(EDITED);
    expect(state.isDirty(EDITED)).toBe(false);
    expect(state.isDirty(QUERY)).toBe(true);
  });

  it('compares the groove only, not the flags or the address around it', () => {
    const state = createDirtyState();
    state.markClean('https://example.com/index.html' + QUERY + '&Debug=1');
    expect(state.isDirty(QUERY)).toBe(false);
    expect(state.isDirty(QUERY.slice(1))).toBe(false);
  });

  it('moves the clean groove along with a change that is not an edit', () => {
    const state = createDirtyState();
    state.markClean(QUERY);
    const faster = QUERY.replace('Tempo=95', 'Tempo=96');
    state.rebase('https://example.com/' + QUERY, faster);
    expect(state.isDirty(faster)).toBe(false);
    expect(state.isDirty(QUERY)).toBe(true);
  });

  it('keeps edits dirty through a change that is not an edit', () => {
    const state = createDirtyState();
    state.markClean(QUERY);
    const faster = EDITED.replace('Tempo=95', 'Tempo=96');
    state.rebase(EDITED, faster);
    expect(state.isDirty(faster)).toBe(true);
    expect(state.isDirty(QUERY)).toBe(false);
  });

  it('does nothing on a rebase before anything is marked', () => {
    const state = createDirtyState();
    state.rebase(QUERY, EDITED);
    expect(state.isDirty(QUERY)).toBe(false);
    expect(state.isDirty(EDITED)).toBe(false);
  });

  it('forgets a clean groove whose save was refused', () => {
    const state = createDirtyState();
    state.markClean(QUERY);
    state.forget(QUERY);
    expect(state.isDirty(QUERY)).toBe(true);
    expect(state.isDirty(EDITED)).toBe(true);
  });

  it('keeps a newer clean groove when an older save is refused', () => {
    const state = createDirtyState();
    state.markClean(QUERY);
    state.markClean(EDITED);
    state.forget(QUERY);
    expect(state.isDirty(EDITED)).toBe(false);
  });

  it('compares the raw text of a query that is not a groove link', () => {
    const state = createDirtyState();
    state.markClean('?Debug=1');
    expect(state.isDirty('?Debug=1')).toBe(false);
    expect(state.isDirty('?Debug=2')).toBe(true);
  });

  it('changes cleanVersion on each markClean, and not on rebase or forget', () => {
    const state = createDirtyState();
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
