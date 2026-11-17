import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildStaffContainerHTML } from '../js/viewHtml.js';
import { initPartPlay } from '../js/partPlayControl.js';

// Part play controls: the ruler above each bar selects beats, and the chip in the playback bar
// says what plays. The tests use the real ruler markup of a 4-bar 4/4 groove in 16ths.

const SHAPE = { numBeats: 4, numberOfMeasures: 4, notesPerMeasure: 16, rulerShown: true };
const CTX = {
  notesPerMeasure: 16,
  numBeatsPerMeasure: 4,
  noteValuePerMeasure: 4,
  numberOfMeasures: 4,
  noteGrouping: 4,
};

/** A writer stand-in with the part play API of GrooveWriter. */
function fakeWriter(shape = SHAPE) {
  let stored = null;
  const writer = {
    onPartPlayChange: null,
    partPlayShape: () => ({ ...shape }),
    getPartPlay: () => (stored ? { ...stored } : null),
    setPartPlay: vi.fn((range) => {
      stored = range ? { ...range } : null;
      if (writer.onPartPlayChange) writer.onPartPlayChange(writer.getPartPlay());
    }),
  };
  return writer;
}

function buildPage(ctx = CTX) {
  let grid = '';
  for (let bar = 1; bar <= ctx.numberOfMeasures; bar++) {
    grid += buildStaffContainerHTML(bar, (bar - 1) * ctx.notesPerMeasure, ctx);
  }
  document.body.innerHTML =
    `<div id="musicalInput"><div id="measureContainer">${grid}</div></div>` +
    '<div id="PlaybackBar"><div id="midiPlayer"></div>' +
    '<span id="partPlayChip" hidden><i class="fa fa-repeat" aria-hidden="true"></i>' +
    '<span class="part-play-label"></span>' +
    '<button type="button" class="part-play-clear" aria-label="Play the whole groove">×</button>' +
    '</span></div>';
}

const beat = (n) => document.querySelector(`.bar-ruler-beat[data-beat="${n}"]`);
const chip = () => document.getElementById('partPlayChip');
const chipLabel = () => chip().querySelector('.part-play-label').textContent;

// The test puts the pointer "over" a beat with clientX = the beat number. elementsFromPoint
// (jsdom has none) answers with that beat.
function pointer(type, n, target = beat(n)) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, isPrimary: true, button: 0, clientX: n, clientY: 0 });
  target.dispatchEvent(event);
}

let writer;

beforeEach(() => {
  buildPage();
  document.elementsFromPoint = (x) => [beat(x)].filter(Boolean);
  writer = fakeWriter();
  initPartPlay(writer);
});

afterEach(() => {
  delete document.elementsFromPoint;
});

describe('the ruler markup', () => {
  it('has a Bar N button and one beat per beat, with global beat numbers', () => {
    const rulers = [...document.querySelectorAll('.bar-ruler')];
    expect(rulers.map((r) => r.dataset.bar)).toEqual(['0', '1', '2', '3']);
    const second = rulers[1];
    expect(second.querySelector('button.bar-ruler-bar').textContent).toBe('Bar 2');
    const beats = [...second.querySelectorAll('.bar-ruler-beat')];
    expect(beats.map((b) => b.dataset.beat)).toEqual(['4', '5', '6', '7']);
    expect(beats.map((b) => b.textContent.trim())).toEqual(['1', '2', '3', '4']);
  });

  it('puts the ruler first in the bar, so the Remove button paints over it', () => {
    const bar = document.getElementById('staff-container2');
    expect(bar.firstElementChild.classList.contains('bar-ruler')).toBe(true);
  });

  it('has a gap between beats where the lanes have a gap between note groups', () => {
    const parts = [...document.querySelector('.bar-ruler-beats').children].map((el) =>
      el.className.replace('bar-ruler-beat', 'beat')
    );
    expect(parts).toEqual([
      'opening_note_space',
      'beat',
      'space_between_note_groups',
      'beat',
      'space_between_note_groups',
      'beat',
      'space_between_note_groups',
      'beat',
      'end_note_space',
    ]);
  });

  it('gives each beat its number of cells, for its width', () => {
    expect(beat(5).style.getPropertyValue('--beat-cells')).toBe('4');
  });

  it('has no ruler when a bar does not split into whole beats', () => {
    const html = buildStaffContainerHTML(1, 0, { ...CTX, notesPerMeasure: 10, noteGrouping: 5 });
    expect(html).not.toContain('bar-ruler');
  });

  it('puts adjacent beats side by side when a note group holds more than one beat', () => {
    // 6/8 in 1/8 notes: six beats of one cell, in two groups of three.
    const html = buildStaffContainerHTML(1, 0, {
      notesPerMeasure: 6,
      numBeatsPerMeasure: 6,
      noteValuePerMeasure: 8,
      numberOfMeasures: 1,
      noteGrouping: 3,
    });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const parts = [...doc.querySelector('.bar-ruler-beats').children].map((el) =>
      el.classList.contains('bar-ruler-beat') ? el.dataset.beat : '|'
    );
    expect(parts).toEqual(['|', '0', '1', '2', '|', '3', '4', '5', '|']);
  });
});

describe('selecting on the ruler', () => {
  it('selects the beats of a drag', () => {
    pointer('pointerdown', 6);
    pointer('pointermove', 9);
    pointer('pointerup', 9);
    expect(writer.setPartPlay).toHaveBeenLastCalledWith({ first: 6, last: 9 });
  });

  it('selects backwards too', () => {
    pointer('pointerdown', 9);
    pointer('pointermove', 6);
    pointer('pointerup', 6);
    expect(writer.setPartPlay).toHaveBeenLastCalledWith({ first: 6, last: 9 });
  });

  it('keeps the beats crossed before a cancel', () => {
    pointer('pointerdown', 6);
    pointer('pointermove', 7);
    pointer('pointercancel', 7);
    expect(writer.getPartPlay()).toEqual({ first: 6, last: 7 });
  });

  it('shows the drag while the pointer moves', () => {
    pointer('pointerdown', 6);
    pointer('pointermove', 8);
    expect(writer.getPartPlay()).toEqual({ first: 6, last: 8 });
  });

  it('selects from one tap to the next', () => {
    pointer('pointerdown', 6);
    pointer('pointerup', 6);
    expect(writer.getPartPlay()).toEqual({ first: 6, last: 6 });
    expect(beat(6).classList.contains('is-anchor')).toBe(true);
    pointer('pointerdown', 9);
    pointer('pointerup', 9);
    expect(writer.setPartPlay).toHaveBeenLastCalledWith({ first: 6, last: 9 });
    expect(beat(6).classList.contains('is-anchor')).toBe(false);
  });

  it('starts again after a tap closed a range', () => {
    for (const n of [6, 9, 2]) {
      pointer('pointerdown', n);
      pointer('pointerup', n);
    }
    expect(writer.getPartPlay()).toEqual({ first: 2, last: 2 });
  });

  it('a move inside the same beat is a tap', () => {
    pointer('pointerdown', 6);
    pointer('pointermove', 6);
    pointer('pointerup', 6);
    expect(writer.getPartPlay()).toEqual({ first: 6, last: 6 });
  });

  it('keeps the last beat when the pointer leaves the ruler', () => {
    pointer('pointerdown', 6);
    pointer('pointermove', 8);
    document.elementsFromPoint = () => [];
    pointer('pointermove', 99, beat(8));
    pointer('pointerup', 99, beat(8));
    expect(writer.getPartPlay()).toEqual({ first: 6, last: 8 });
  });

  it('a drag reaches a beat under the Remove button', () => {
    const remove = document.getElementById('closeMeasureButton2');
    document.elementsFromPoint = (x) => (x === 7 ? [remove, beat(7)] : [beat(x)]);
    pointer('pointerdown', 5);
    pointer('pointermove', 7, remove);
    pointer('pointerup', 7, remove);
    expect(writer.getPartPlay()).toEqual({ first: 5, last: 7 });
  });

  it('a tap on the Remove button selects nothing', () => {
    const remove = document.getElementById('closeMeasureButton2');
    pointer('pointerdown', 7, remove);
    pointer('pointerup', 7, remove);
    expect(writer.setPartPlay).not.toHaveBeenCalled();
  });

  it('"Bar 2" selects the whole bar', () => {
    document.querySelector('.bar-ruler[data-bar="1"] .bar-ruler-bar').click();
    expect(writer.setPartPlay).toHaveBeenLastCalledWith({ first: 4, last: 7 });
  });

  it('marks the selected beats on the ruler', () => {
    pointer('pointerdown', 6);
    pointer('pointermove', 9);
    pointer('pointerup', 9);
    const marked = [...document.querySelectorAll('.bar-ruler-beat.is-selected')].map(
      (b) => b.dataset.beat
    );
    expect(marked).toEqual(['6', '7', '8', '9']);
  });

  it('marks the ruler again after the grid is drawn again', async () => {
    document.querySelector('.bar-ruler[data-bar="1"] .bar-ruler-bar').click();
    const container = document.getElementById('measureContainer');
    container.innerHTML = container.innerHTML.replaceAll('is-selected', '');
    await Promise.resolve();
    expect(beat(5).classList.contains('is-selected')).toBe(true);
  });

  it('does not pass a range that does not fit the groove', () => {
    writer.partPlayShape = () => ({ ...SHAPE, numberOfMeasures: 2 });
    pointer('pointerdown', 6);
    pointer('pointermove', 9);
    pointer('pointerup', 9);
    expect(writer.setPartPlay.mock.calls.every(([r]) => r.last < 8)).toBe(true);
  });

  it('forgets the first tap when the writer clears the selection', () => {
    pointer('pointerdown', 6);
    pointer('pointerup', 6);
    writer.onPartPlayChange(null);
    pointer('pointerdown', 9);
    pointer('pointerup', 9);
    expect(writer.setPartPlay).toHaveBeenLastCalledWith({ first: 9, last: 9 });
  });
});

describe('the chip', () => {
  it('is hidden without a selection', () => {
    expect(chip().hidden).toBe(true);
  });

  it('says what plays', () => {
    pointer('pointerdown', 6);
    pointer('pointermove', 9);
    pointer('pointerup', 9);
    expect(chip().hidden).toBe(false);
    expect(chipLabel()).toBe('Bar 2 beat 3 – bar 3 beat 2');
  });

  it('× plays the whole groove again and hides the chip', () => {
    writer.setPartPlay({ first: 4, last: 7 });
    chip().querySelector('button').click();
    expect(writer.setPartPlay).toHaveBeenLastCalledWith(null);
    expect(chip().hidden).toBe(true);
    expect(document.querySelectorAll('.bar-ruler-beat.is-selected')).toHaveLength(0);
  });

  it('hides when the writer clears the selection, without reading the groove', () => {
    writer.setPartPlay({ first: 4, last: 7 });
    writer.partPlayShape = () => {
      throw new Error('read during a load');
    };
    writer.onPartPlayChange(null);
    expect(chip().hidden).toBe(true);
  });
});
