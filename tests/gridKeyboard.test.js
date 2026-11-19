import { describe, it, expect } from 'vitest';
import { buildStaffContainerHTML, noteCellName } from '../js/viewHtml.js';
import { LANE_ORDER, ownsArrowKeys } from '../js/gridKeyboard.js';

// The note grid speaks to screen readers through the cell names, and the arrow keys belong to
// the grid and to the other widgets that use them, not to the tempo.

const one = { notesPerMeasure: 16, numBeatsPerMeasure: 4, numberOfMeasures: 1 };

describe('noteCellName', () => {
  it('names a 16th grid by beat and count', () => {
    expect(noteCellName('snare', 4, one)).toBe('Snare, beat 2');
    expect(noteCellName('hh', 5, one)).toBe('Hi-hat, beat 2 e');
    expect(noteCellName('hh', 6, one)).toBe('Hi-hat, beat 2 and');
    expect(noteCellName('kick', 15, one)).toBe('Kick, beat 4 a');
  });

  it('adds the bar when the groove has more than one', () => {
    expect(noteCellName('tom4', 16, { ...one, numberOfMeasures: 2 })).toBe(
      'Floor tom, bar 2, beat 1'
    );
    expect(noteCellName('kick', 31, { ...one, numberOfMeasures: 2 })).toBe('Kick, bar 2, beat 4 a');
  });

  it('names every instrument', () => {
    const names = ['sticking', 'hh', 'tom1', 'tom2', 'snare', 'tom4', 'kick'].map((instrument) =>
      noteCellName(instrument, 0, one)
    );
    expect(names).toEqual([
      'Sticking, beat 1',
      'Hi-hat, beat 1',
      'High tom, beat 1',
      'Mid tom, beat 1',
      'Snare, beat 1',
      'Floor tom, beat 1',
      'Kick, beat 1',
    ]);
  });

  it('names 4ths, 8ths and 8th triplets', () => {
    expect(
      noteCellName('snare', 1, { notesPerMeasure: 4, numBeatsPerMeasure: 4, numberOfMeasures: 1 })
    ).toBe('Snare, beat 2');
    expect(
      noteCellName('snare', 3, { notesPerMeasure: 8, numBeatsPerMeasure: 4, numberOfMeasures: 1 })
    ).toBe('Snare, beat 2 and');
    expect(
      noteCellName('snare', 4, { notesPerMeasure: 12, numBeatsPerMeasure: 4, numberOfMeasures: 1 })
    ).toBe('Snare, beat 2 and');
    expect(
      noteCellName('snare', 5, { notesPerMeasure: 12, numBeatsPerMeasure: 4, numberOfMeasures: 1 })
    ).toBe('Snare, beat 2 a');
  });

  it('uses note numbers for other counts and for bars that do not split into beats', () => {
    expect(
      noteCellName('hh', 2, { notesPerMeasure: 32, numBeatsPerMeasure: 4, numberOfMeasures: 1 })
    ).toBe('Hi-hat, beat 1, note 3');
    expect(
      noteCellName('hh', 8, { notesPerMeasure: 32, numBeatsPerMeasure: 4, numberOfMeasures: 1 })
    ).toBe('Hi-hat, beat 2');
    expect(
      noteCellName('hh', 4, { notesPerMeasure: 6, numBeatsPerMeasure: 4, numberOfMeasures: 1 })
    ).toBe('Hi-hat, note 5');
    expect(
      noteCellName('hh', 10, { notesPerMeasure: 6, numBeatsPerMeasure: 4, numberOfMeasures: 2 })
    ).toBe('Hi-hat, bar 2, note 5');
  });
});

describe('ownsArrowKeys', () => {
  it('knows which targets use the arrow keys', () => {
    document.body.innerHTML =
      '<div role="grid"><div id="c"></div></div><input id="i"><div id="k" role="slider"></div>' +
      '<div role="listbox"><div id="o" role="option"></div></div>' +
      '<div role="menu"><div id="m" role="menuitem"></div></div>' +
      '<select id="s"></select><textarea id="t"></textarea><div id="e" contenteditable></div>' +
      '<button id="b"></button>';
    for (const id of ['c', 'i', 'k', 'o', 'm', 's', 't', 'e']) {
      expect(ownsArrowKeys(document.getElementById(id)), id).toBe(true);
    }
    expect(ownsArrowKeys(document.getElementById('b'))).toBe(false);
    expect(ownsArrowKeys(document.body)).toBe(false);
    expect(ownsArrowKeys(null)).toBe(false);
    expect(ownsArrowKeys(document)).toBe(false);
  });
});

describe('LANE_ORDER', () => {
  it('is the order of the lanes in the grid, so Up and Down go to the lane on screen', () => {
    document.body.innerHTML = buildStaffContainerHTML(1, 0, { ...one, noteGrouping: 4 });
    const lanes = [...document.querySelectorAll('[role="row"]')].map((row) =>
      row.querySelector('[role="gridcell"]')?.getAttribute('data-instrument')
    );
    expect(lanes).toEqual(LANE_ORDER);
  });
});
