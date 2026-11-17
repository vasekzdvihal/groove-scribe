import { describe, it, expect } from 'vitest';
import {
  beatsPerBarFit,
  normalizeRange,
  rangeFits,
  barRanges,
  groovePercent,
  countInPercent,
  selectionLabel,
  nextSelection,
} from '../js/partPlay.js';

describe('beatsPerBarFit', () => {
  it('accepts a bar that divides into whole beats', () => {
    expect(beatsPerBarFit(16, 4)).toBe(true);
  });
  it('rejects a bar that does not divide into whole beats', () => {
    expect(beatsPerBarFit(3, 6)).toBe(false);
  });
});

describe('normalizeRange', () => {
  it('orders the two beats', () => {
    expect(normalizeRange(9, 6)).toEqual({ first: 6, last: 9 });
    expect(normalizeRange(6, 9)).toEqual({ first: 6, last: 9 });
  });
});

describe('rangeFits', () => {
  it('rejects a range past the last bar', () => {
    expect(rangeFits({ first: 6, last: 9 }, 4, 2)).toBe(false);
  });
  it('accepts a range inside the groove', () => {
    expect(rangeFits({ first: 6, last: 7 }, 4, 2)).toBe(true);
  });
});

describe('barRanges', () => {
  it('splits a range over two bars', () => {
    expect(barRanges({ first: 6, last: 9 }, 4, 32)).toEqual([
      { bar: 1, from: 16, to: 32 },
      { bar: 2, from: 0, to: 16 },
    ]);
  });
  it('covers a whole bar', () => {
    expect(barRanges({ first: 4, last: 7 }, 4, 32)).toEqual([{ bar: 1, from: 0, to: 32 }]);
  });
  it('handles six beats per bar', () => {
    expect(barRanges({ first: 3, last: 5 }, 6, 24)).toEqual([{ bar: 0, from: 12, to: 24 }]);
  });
});

describe('groovePercent', () => {
  it('maps the part start to the groove position', () => {
    expect(groovePercent(0, { first: 4, last: 7 }, 4, 4)).toBe(0.25);
  });
  it('maps the part middle', () => {
    expect(groovePercent(0.5, { first: 4, last: 7 }, 4, 4)).toBe(0.375);
  });
  it('stays inside the part before its end', () => {
    expect(groovePercent(0.999, { first: 4, last: 7 }, 4, 4)).toBeLessThan(0.5);
  });
});

describe('countInPercent', () => {
  // 4/4, 4 bars, the selection starts on beat 3 of bar 2: the count-in clicks 4 + 2 times.
  const range = { first: 6, last: 7 };
  it('clears the playhead during the count-in bar', () => {
    for (const click of [0, 1, 2, 3]) expect(countInPercent(click / 6, range, 4, 4)).toBe(-1);
  });
  it('shows each lead beat on its own beat in the bar of the selection', () => {
    expect(countInPercent(4 / 6, range, 4, 4)).toBeCloseTo(4 / 16);
    expect(countInPercent(5 / 6, range, 4, 4)).toBeCloseTo(5 / 16);
  });
  it('clears the playhead for the whole count-in when the selection starts a bar', () => {
    expect(countInPercent(0.99, { first: 4, last: 7 }, 4, 4)).toBe(-1);
  });
});

describe('selectionLabel', () => {
  it('names one bar', () => {
    expect(selectionLabel({ first: 4, last: 7 }, 4)).toBe('Bar 2');
  });
  it('names several bars', () => {
    expect(selectionLabel({ first: 4, last: 11 }, 4)).toBe('Bars 2–3');
  });
  it('names one beat', () => {
    expect(selectionLabel({ first: 6, last: 6 }, 4)).toBe('Bar 2, beat 3');
  });
  it('names beats in one bar', () => {
    expect(selectionLabel({ first: 6, last: 7 }, 4)).toBe('Bar 2, beats 3–4');
  });
  it('names beats across bars', () => {
    expect(selectionLabel({ first: 6, last: 9 }, 4)).toBe('Bar 2 beat 3 – bar 3 beat 2');
  });
});

describe('nextSelection', () => {
  const empty = { range: null, anchor: null };

  it('sets an anchor on the first tap', () => {
    expect(nextSelection(empty, { type: 'tap', beat: 5 })).toEqual({
      range: { first: 5, last: 5 },
      anchor: 5,
    });
  });
  it('extends to a range on the second tap', () => {
    const state = nextSelection(empty, { type: 'tap', beat: 5 });
    expect(nextSelection(state, { type: 'tap', beat: 2 })).toEqual({
      range: { first: 2, last: 5 },
      anchor: null,
    });
  });
  it('clears the selection when the second tap hits the anchor', () => {
    const state = nextSelection(empty, { type: 'tap', beat: 5 });
    expect(nextSelection(state, { type: 'tap', beat: 5 })).toEqual(empty);
  });
  it('clears a range on a tap inside it', () => {
    const state = { range: { first: 2, last: 5 }, anchor: null };
    expect(nextSelection(state, { type: 'tap', beat: 2 })).toEqual(empty);
    expect(nextSelection(state, { type: 'tap', beat: 4 })).toEqual(empty);
    expect(nextSelection(state, { type: 'tap', beat: 5 })).toEqual(empty);
  });
  it('starts a new range on a tap outside a range', () => {
    const state = { range: { first: 2, last: 5 }, anchor: null };
    expect(nextSelection(state, { type: 'tap', beat: 6 })).toEqual({
      range: { first: 6, last: 6 },
      anchor: 6,
    });
  });
  it('selects the dragged range', () => {
    expect(nextSelection(empty, { type: 'drag', from: 7, to: 3 })).toEqual({
      range: { first: 3, last: 7 },
      anchor: null,
    });
  });
  it('selects a whole bar', () => {
    expect(nextSelection(empty, { type: 'bar', bar: 1, numBeats: 4 })).toEqual({
      range: { first: 4, last: 7 },
      anchor: null,
    });
  });
  it('clears the bar on a second tap of the same bar', () => {
    const state = nextSelection(empty, { type: 'bar', bar: 1, numBeats: 4 });
    expect(nextSelection(state, { type: 'bar', bar: 1, numBeats: 4 })).toEqual(empty);
  });
  it('selects the whole bar on a tap of a bar that is partly selected', () => {
    const state = { range: { first: 4, last: 5 }, anchor: null };
    expect(nextSelection(state, { type: 'bar', bar: 1, numBeats: 4 })).toEqual({
      range: { first: 4, last: 7 },
      anchor: null,
    });
  });
  it('clears the selection', () => {
    const state = { range: { first: 1, last: 2 }, anchor: 1 };
    expect(nextSelection(state, { type: 'clear' })).toEqual({ range: null, anchor: null });
  });
});
