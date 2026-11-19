import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    '</span><span id="partPlayStatus" role="status"></span></div>';
}

const beat = (n) => document.querySelector(`.bar-ruler-beat[data-beat="${n}"]`);
const chip = () => document.getElementById('partPlayChip');
const chipLabel = () => chip().querySelector('.part-play-label').textContent;
const status = () => document.getElementById('partPlayStatus');

/** Count the changes of the status text, as a screen reader hears them. */
function statusChanges() {
  const heard = [];
  new MutationObserver(() => heard.push(status().textContent)).observe(status(), {
    childList: true,
    characterData: true,
    subtree: true,
  });
  return heard;
}

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

  it('ends a drag on a release outside the grid, and takes the next press', () => {
    // No pointer capture: the release goes to the element under the pointer.
    const outside = document.getElementById('midiPlayer');
    pointer('pointerdown', 6);
    pointer('pointermove', 8);
    pointer('pointerup', 99, outside);
    expect(writer.getPartPlay()).toEqual({ first: 6, last: 8 });
    pointer('pointerdown', 2);
    pointer('pointerup', 2);
    expect(writer.getPartPlay()).toEqual({ first: 2, last: 2 });
  });

  it('ends a drag when the grid loses the pointer capture', () => {
    pointer('pointerdown', 6);
    pointer('pointermove', 9);
    pointer('lostpointercapture', 9, document.getElementById('measureContainer'));
    expect(writer.getPartPlay()).toEqual({ first: 6, last: 9 });
    // The press is over: a later move changes nothing.
    pointer('pointermove', 11);
    expect(writer.getPartPlay()).toEqual({ first: 6, last: 9 });
  });

  it('a new press replaces a press that never ended', () => {
    pointer('pointerdown', 6);
    pointer('pointermove', 8);
    // The release was lost. The next press, with a new pointer id, starts again.
    for (const type of ['pointerdown', 'pointerup']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { pointerId: 2, isPrimary: true, button: 0, clientX: 3, clientY: 0 });
      beat(3).dispatchEvent(event);
    }
    expect(writer.getPartPlay()).toEqual({ first: 3, last: 3 });
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

describe('the ruler by keyboard', () => {
  const tabStops = () =>
    [...document.querySelectorAll('.bar-ruler-beat[tabindex="0"]')].map((b) => b.dataset.beat);
  const selected = () =>
    [...document.querySelectorAll('.bar-ruler-beat[aria-selected="true"]')].map(
      (b) => b.dataset.beat
    );
  /** Press a key on the focused element, as the browser does. */
  function press(key, options = {}) {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    document.activeElement.dispatchEvent(event);
    return event;
  }

  it('names the beats and lists them per bar', () => {
    const list = document.querySelector('.bar-ruler[data-bar="1"] .bar-ruler-beats');
    expect(list.getAttribute('role')).toBe('listbox');
    expect(list.getAttribute('aria-multiselectable')).toBe('true');
    expect(list.getAttribute('aria-label')).toBe('Beats of bar 2');
    expect(beat(6).getAttribute('role')).toBe('option');
    expect(beat(6).getAttribute('aria-label')).toBe('Bar 2, beat 3');
    expect(beat(6).getAttribute('aria-selected')).toBe('false');
  });

  it('marks selected beats with aria-selected and keeps one tab stop', () => {
    expect(tabStops()).toEqual(['0']);
    pointer('pointerdown', 6);
    pointer('pointermove', 9);
    pointer('pointerup', 9);
    expect(selected()).toEqual(['6', '7', '8', '9']);
    expect(tabStops()).toEqual(['6']);
    writer.setPartPlay(null);
    expect(selected()).toEqual([]);
    expect(tabStops()).toEqual(['0']);
  });

  it('keeps the tab stop on the focused beat when a key changes the selection', () => {
    beat(3).focus();
    press('ArrowRight', { shiftKey: true });
    expect(writer.setPartPlay).toHaveBeenLastCalledWith({ first: 3, last: 4 });
    expect(tabStops()).toEqual(['4']);
  });

  it('keeps the tab stop on the last focused beat, also after a redraw', async () => {
    beat(10).focus();
    expect(tabStops()).toEqual(['10']);
    const container = document.getElementById('measureContainer');
    container.innerHTML = container.innerHTML.replace('tabindex="0"', 'tabindex="-1"');
    await Promise.resolve();
    expect(tabStops()).toEqual(['10']);
  });

  it('moves the focus with the arrow keys, across bars, and Home and End', () => {
    beat(3).focus();
    const right = press('ArrowRight');
    expect(right.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(beat(4));
    press('ArrowLeft');
    press('ArrowLeft');
    expect(document.activeElement).toBe(beat(2));
    press('End');
    expect(document.activeElement).toBe(beat(15));
    press('ArrowRight');
    expect(document.activeElement).toBe(beat(15));
    press('Home');
    expect(document.activeElement).toBe(beat(0));
    expect(writer.setPartPlay).not.toHaveBeenCalled();
    expect(tabStops()).toEqual(['0']);
  });

  it('selects with Enter and Space as with taps, and clears on the selection', () => {
    beat(2).focus();
    press('Enter');
    expect(writer.setPartPlay).toHaveBeenLastCalledWith({ first: 2, last: 2 });
    press('ArrowRight');
    press('ArrowRight');
    press(' ');
    expect(writer.setPartPlay).toHaveBeenLastCalledWith({ first: 2, last: 4 });
    expect(status().textContent).toBe('Bar 1 beat 3 – bar 2 beat 1');
    press('Enter');
    expect(writer.setPartPlay).toHaveBeenLastCalledWith(null);
  });

  it('ignores a held Enter', () => {
    beat(2).focus();
    press('Enter');
    press('Enter', { repeat: true });
    expect(writer.setPartPlay).toHaveBeenCalledTimes(1);
  });

  it('extends the selection with Shift and the arrow keys', () => {
    beat(3).focus();
    press('ArrowRight', { shiftKey: true });
    press('ArrowRight', { shiftKey: true });
    expect(document.activeElement).toBe(beat(5));
    expect(writer.setPartPlay).toHaveBeenLastCalledWith({ first: 3, last: 5 });
    press('ArrowLeft', { shiftKey: true });
    expect(writer.setPartPlay).toHaveBeenLastCalledWith({ first: 3, last: 4 });
    expect(status().textContent).toBe('Bar 1 beat 4 – bar 2 beat 1');
  });

  it('keeps other keys and the keys of other elements for the page', () => {
    beat(3).focus();
    expect(press('a').defaultPrevented).toBe(false);
    document.querySelector('.bar-ruler-bar').focus();
    expect(press('ArrowRight').defaultPrevented).toBe(false);
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

describe('the status for screen readers', () => {
  it('speaks a drag over 4 beats once, when the press ends', async () => {
    const heard = statusChanges();
    pointer('pointerdown', 6);
    for (const n of [7, 8, 9]) pointer('pointermove', n);
    expect(chipLabel()).toBe('Bar 2 beat 3 – bar 3 beat 2');
    await Promise.resolve();
    expect(heard).toEqual([]);
    pointer('pointerup', 9);
    await Promise.resolve();
    expect(heard).toEqual(['Bar 2 beat 3 – bar 3 beat 2']);
  });

  it('speaks a tap, Bar N and a selection that the writer sets', () => {
    pointer('pointerdown', 6);
    pointer('pointerup', 6);
    expect(status().textContent).toBe('Bar 2, beat 3');
    document.querySelector('.bar-ruler[data-bar="0"] .bar-ruler-bar').click();
    expect(status().textContent).toBe('Bar 1');
    writer.setPartPlay(null);
    expect(status().textContent).toBe('');
  });

  it('is the only live text: the chip label is not live', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    const chipHtml = /<span id="partPlayChip"[\s\S]*?<\/button><\/span>/.exec(html)?.[0] ?? '';
    expect(chipHtml).toContain('part-play-label');
    expect(chipHtml).not.toContain('aria-live');
    expect(html).toMatch(/<span id="partPlayStatus"[^>]*role="status"/);
  });
});

describe('the part blue', () => {
  // White beat numbers (15 px bold) sit on the part blue, the --bar-selected token: WCAG AA wants 4.5:1.
  const luminance = (hex) => {
    const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = channels.map((c) =>
      c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  it('has a contrast of 4.5:1 or more with white text', () => {
    const css = readFileSync(join(process.cwd(), 'css/editor-toolbars.css'), 'utf8');
    const blue = /--bar-selected:\s*(#[0-9a-f]{6})/i.exec(css)?.[1];
    expect(blue).toBeDefined();
    const contrast = 1.05 / (luminance(blue) + 0.05);
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });
});
