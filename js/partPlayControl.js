// Part play controls in the editor: the ruler above each bar selects the beats to loop, and the
// chip in the playback bar says what plays, with an × that plays the whole groove again.
//
// The rulers are part of the note grid markup (js/viewHtml.js), and renderNoteGrid() makes them
// again with the grid. So the pointer and key events are delegated on #measureContainer, which
// stays.
//
// By keyboard the beats of each bar are a listbox. All the rulers together are one tab stop
// (a roving tabindex): the focused beat, else the first selected beat, else the last focused
// beat, else beat 0.

import { nextSelection, rangeFits, selectionLabel } from './partPlay.js';

/**
 * @typedef {import('./partPlay.js').BeatRange} BeatRange
 * @typedef {import('./partPlay.js').TapState} TapState
 * @typedef {import('./partPlay.js').RulerEvent} RulerEvent
 * @typedef {{
 *   setPartPlay: (range: BeatRange | null) => void,
 *   getPartPlay: () => BeatRange | null,
 *   partPlayShape: () => { numBeats: number, numberOfMeasures: number, notesPerMeasure: number,
 *     rulerShown: boolean },
 *   onPartPlayChange: ((range: BeatRange | null) => void) | null,
 * }} PartPlayWriter
 */

const BEAT = '.bar-ruler-beat';

/**
 * The beat number of a ruler beat, or null.
 * @param {EventTarget | null} target
 * @returns {number | null}
 */
function beatOf(target) {
  const beat = target instanceof Element ? target.closest(BEAT) : null;
  return beat instanceof HTMLElement ? Number(beat.dataset.beat) : null;
}

/**
 * The beat under a point. It looks through the Remove button, so a drag reaches the end of the
 * last beat under it.
 * @param {number} x
 * @param {number} y
 * @returns {number | null}
 */
function beatAt(x, y) {
  for (const element of document.elementsFromPoint(x, y)) {
    const beat = beatOf(element);
    if (beat !== null) return beat;
  }
  return null;
}

/**
 * Connect the rulers and the chip to the writer.
 * @param {PartPlayWriter} writer
 */
export function initPartPlay(writer) {
  const container = document.getElementById('measureContainer');
  const chip = document.getElementById('partPlayChip');
  if (!container || !chip) return;
  const label = chip.querySelector('.part-play-label');
  const status = document.getElementById('partPlayStatus');

  /** @type {TapState} */
  let state = { range: null, anchor: null };
  /** @type {{ pointerId: number, from: number, to: number, dragged: boolean } | null} */
  let press = null;
  /** The beat that had the focus last, for the tab stop. */
  let lastFocused = 0;

  /**
   * Mark the selected beats and the first tap on the rulers, and put the tab stop on the first
   * selected beat, else on the beat that had the focus last, else on beat 0. A beat that has
   * the focus keeps the tab stop, or Shift+Tab would go back into the ruler.
   * @param {BeatRange | null} range
   */
  function markRulers(range) {
    const beats = /** @type {HTMLElement[]} */ ([...container.querySelectorAll(BEAT)]);
    const focused = beats.find((element) => element === document.activeElement);
    let stop = range && !focused ? range.first : lastFocused;
    if (!beats.some((element) => Number(element.dataset.beat) === stop)) stop = 0;
    for (const element of beats) {
      const beat = Number(element.dataset.beat);
      const selected = !!range && beat >= range.first && beat <= range.last;
      element.classList.toggle('is-selected', selected);
      element.classList.toggle('is-anchor', beat === state.anchor);
      setAttribute(element, 'aria-selected', String(selected));
      setAttribute(element, 'tabindex', beat === stop ? '0' : '-1');
    }
  }

  /**
   * Set an attribute only when it changes, so the screen reader hears no change that is none.
   * @param {Element} element
   * @param {string} name
   * @param {string} value
   */
  function setAttribute(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  // The writer calls this after each change, also with null while a groove loads. So it uses
  // its argument, and reads the groove shape only for a selection that it has.
  writer.onPartPlayChange = (range) => {
    if (!range) state = { range: null, anchor: null };
    chip.hidden = !range;
    const text = range ? selectionLabel(range, writer.partPlayShape().numBeats) : '';
    if (label) label.textContent = text;
    // A drag changes the selection on each beat it crosses. The status waits for the release.
    if (!press) announce(text);
    markRulers(range);
    placeChip();
  };

  /**
   * Tell a screen reader what plays. The status is a live region: each change is spoken.
   * @param {string} text
   */
  function announce(text) {
    if (status && status.textContent !== text) status.textContent = text;
  }

  // The chip sits in the row of the playback controls while they all fit. Else the bar gets a
  // row of its own for the chip (CSS: has-chip-row), so the bar never scrolls and the chip never
  // covers the music. Try the row of controls first; both changes happen before a paint.
  const bar = chip.parentElement;
  function placeChip() {
    if (!bar) return;
    bar.classList.remove('has-chip-row');
    if (!chip.hidden && bar.scrollWidth > bar.clientWidth + 0.5) {
      bar.classList.add('has-chip-row');
    }
  }
  // A new width (a turned tablet, the docked panel) or a label in a font that loaded late.
  if (bar && typeof ResizeObserver === 'function') {
    const resize = new ResizeObserver(placeChip);
    resize.observe(bar);
    resize.observe(chip);
  }

  /**
   * Apply a ruler event. A range that does not fit the groove is not passed on: the writer
   * would clear a good selection for it.
   * @param {RulerEvent} event
   */
  function apply(event) {
    const next = nextSelection(state, event);
    const shape = writer.partPlayShape();
    if (next.range && !rangeFits(next.range, shape.numBeats, shape.numberOfMeasures)) return;
    state = next;
    writer.setPartPlay(next.range);
  }

  // A press that never got its release (a lost pointer) does not block the next one: a new
  // primary press replaces it. A drag shows live, so the old press has nothing to finish.
  container.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    const beat = beatOf(event.target);
    if (beat === null) return;
    event.preventDefault();
    press = { pointerId: event.pointerId, from: beat, to: beat, dragged: false };
    // Moves and the release come to the grid also when the pointer leaves the ruler.
    try {
      container.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer that is gone cannot be captured. The listeners on the document still see it.
    }
  });

  /**
   * End a press: a drag keeps the last beat it crossed, a tap goes to the tap state machine.
   * @param {PointerEvent} event
   * @param {boolean} cancelled  a cancel or a lost capture: no tap
   */
  function release(event, cancelled) {
    if (!press || event.pointerId !== press.pointerId) return;
    const done = press;
    press = null;
    if (done.dragged) apply({ type: 'drag', from: done.from, to: done.to });
    else if (!cancelled) apply({ type: 'tap', beat: done.from });
    // The drag showed its last range already, so the writer may not call back again.
    announce(label?.textContent ?? '');
  }

  // On the document, not the grid: without a capture the release can happen anywhere.
  document.addEventListener('pointermove', (event) => {
    if (!press || event.pointerId !== press.pointerId) return;
    const beat = beatAt(event.clientX, event.clientY);
    if (beat === null || beat === press.to) return;
    press.to = beat;
    press.dragged = true;
    // Show the selection while the pointer moves.
    apply({ type: 'drag', from: press.from, to: press.to });
  });
  document.addEventListener('pointerup', (event) => release(event, false));
  document.addEventListener('pointercancel', (event) => release(event, true));
  // After a pointerup the press is over already, so this ends only a capture that was lost.
  container.addEventListener('lostpointercapture', (event) => release(event, true));

  container.addEventListener('click', (event) => {
    const button = event.target instanceof Element && event.target.closest('.bar-ruler-bar');
    const ruler = button && button.closest('.bar-ruler');
    if (!(ruler instanceof HTMLElement)) return;
    const numBeats = writer.partPlayShape().numBeats;
    apply({ type: 'bar', bar: Number(ruler.dataset.bar), numBeats });
  });

  chip.querySelector('button')?.addEventListener('click', () => writer.setPartPlay(null));

  // A focused beat takes the tab stop, so Tab comes back to it.
  container.addEventListener('focusin', (event) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches(BEAT)) return;
    lastFocused = Number(event.target.dataset.beat);
    for (const element of container.querySelectorAll(BEAT)) {
      setAttribute(element, 'tabindex', element === event.target ? '0' : '-1');
    }
  });

  /**
   * The beat element of a beat number, or null.
   * @param {number} beat
   * @returns {HTMLElement | null}
   */
  function beatElement(beat) {
    return container.querySelector(BEAT + '[data-beat="' + beat + '"]');
  }

  // The keys on a focused beat. The page keys (tempo on the arrows, Play on Space) do not run.
  container.addEventListener('keydown', (event) => {
    if (!(event.target instanceof HTMLElement) || !event.target.matches(BEAT)) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const beat = Number(event.target.dataset.beat);
    const beats = /** @type {HTMLElement[]} */ ([...container.querySelectorAll(BEAT)]);
    const last = beats.length ? Number(beats[beats.length - 1].dataset.beat) : 0;
    /** @type {number | null} */
    let to = null;
    switch (event.key) {
      case 'ArrowLeft':
        to = Math.max(beat - 1, 0);
        break;
      case 'ArrowRight':
        to = Math.min(beat + 1, last);
        break;
      case 'Home':
        if (event.shiftKey) return;
        to = 0;
        break;
      case 'End':
        if (event.shiftKey) return;
        to = last;
        break;
      case 'Enter':
      case ' ':
        if (event.shiftKey) return;
        event.preventDefault();
        event.stopPropagation();
        // A held key would select and clear again and again.
        if (!event.repeat) apply({ type: 'tap', beat });
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    beatElement(to)?.focus();
    if (event.shiftKey && to !== beat) apply({ type: 'extend', from: beat, to });
  });

  // renderNoteGrid() makes the rulers again. Mark the selection on the new ones.
  new MutationObserver(() => markRulers(writer.getPartPlay())).observe(container, {
    childList: true,
  });
  markRulers(writer.getPartPlay());
}
