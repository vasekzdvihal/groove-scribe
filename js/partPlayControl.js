// Part play controls in the editor: the ruler above each bar selects the beats to loop, and the
// chip in the playback bar says what plays, with an × that plays the whole groove again.
//
// The rulers are part of the note grid markup (js/viewHtml.js), and renderNoteGrid() makes them
// again with the grid. So the pointer events are delegated on #measureContainer, which stays.

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

  /** @type {TapState} */
  let state = { range: null, anchor: null };
  /** @type {{ pointerId: number, from: number, to: number, dragged: boolean } | null} */
  let press = null;

  /**
   * Mark the selected beats and the first tap on the rulers.
   * @param {BeatRange | null} range
   */
  function markRulers(range) {
    for (const element of container.querySelectorAll(BEAT)) {
      const beat = Number(/** @type {HTMLElement} */ (element).dataset.beat);
      element.classList.toggle('is-selected', !!range && beat >= range.first && beat <= range.last);
      element.classList.toggle('is-anchor', beat === state.anchor);
    }
  }

  // The writer calls this after each change, also with null while a groove loads. So it uses
  // its argument, and reads the groove shape only for a selection that it has.
  writer.onPartPlayChange = (range) => {
    if (!range) state = { range: null, anchor: null };
    chip.hidden = !range;
    if (label) {
      label.textContent = range ? selectionLabel(range, writer.partPlayShape().numBeats) : '';
    }
    markRulers(range);
  };

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

  container.addEventListener('pointerdown', (event) => {
    if (press || !event.isPrimary || event.button !== 0) return;
    const beat = beatOf(event.target);
    if (beat === null) return;
    event.preventDefault();
    press = { pointerId: event.pointerId, from: beat, to: beat, dragged: false };
    // Moves and the release come here also when the pointer leaves the ruler.
    try {
      container.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer that is gone cannot be captured. Its release or cancel ends the press.
    }
  });

  container.addEventListener('pointermove', (event) => {
    if (!press || event.pointerId !== press.pointerId) return;
    const beat = beatAt(event.clientX, event.clientY);
    if (beat === null || beat === press.to) return;
    press.to = beat;
    press.dragged = true;
    // Show the selection while the pointer moves.
    apply({ type: 'drag', from: press.from, to: press.to });
  });

  /**
   * End a press: a drag keeps what it crossed, a tap goes to the tap state machine.
   * @param {PointerEvent} event
   * @param {boolean} cancelled
   */
  function release(event, cancelled) {
    if (!press || event.pointerId !== press.pointerId) return;
    const done = press;
    press = null;
    if (done.dragged) apply({ type: 'drag', from: done.from, to: done.to });
    else if (!cancelled) apply({ type: 'tap', beat: done.from });
  }
  container.addEventListener('pointerup', (event) => release(event, false));
  container.addEventListener('pointercancel', (event) => release(event, true));

  container.addEventListener('click', (event) => {
    const button = event.target instanceof Element && event.target.closest('.bar-ruler-bar');
    const ruler = button && button.closest('.bar-ruler');
    if (!(ruler instanceof HTMLElement)) return;
    const numBeats = writer.partPlayShape().numBeats;
    apply({ type: 'bar', bar: Number(ruler.dataset.bar), numBeats });
  });

  chip.querySelector('button')?.addEventListener('click', () => writer.setPartPlay(null));

  // renderNoteGrid() makes the rulers again. Mark the selection on the new ones.
  new MutationObserver(() => markRulers(writer.getPartPlay())).observe(container, {
    childList: true,
  });
}
