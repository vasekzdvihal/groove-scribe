import { describe, it, expect } from 'vitest';
import { createDirtyState } from '../../js/cloud/dirtyState.js';

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

  it('compares the raw text of a query that is not a groove link', () => {
    const state = createDirtyState();
    state.markClean('?Debug=1');
    expect(state.isDirty('?Debug=1')).toBe(false);
    expect(state.isDirty('?Debug=2')).toBe(true);
  });
});
