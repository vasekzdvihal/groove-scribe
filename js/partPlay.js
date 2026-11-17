// Part play: pure helpers for the beat selection above the bars.
//
// A selection is a BeatRange: global beat indices, inclusive, 0-based.
// Global beat = barIndex * numBeats + beatInBar.

/**
 * @typedef {{ first: number, last: number }} BeatRange
 * @typedef {{ range: BeatRange | null, anchor: number | null }} TapState
 * @typedef {{ type: 'tap', beat: number }
 *   | { type: 'drag', from: number, to: number }
 *   | { type: 'bar', bar: number, numBeats: number }
 *   | { type: 'clear' }} RulerEvent
 */

/**
 * Tell if a bar splits into whole beats.
 * @param {number} notesPerMeasure
 * @param {number} numBeats
 * @returns {boolean}
 */
export function beatsPerBarFit(notesPerMeasure, numBeats) {
  return numBeats > 0 && notesPerMeasure % numBeats === 0;
}

/**
 * Order two beats into a range.
 * @param {number} a
 * @param {number} b
 * @returns {BeatRange}
 */
export function normalizeRange(a, b) {
  return { first: Math.min(a, b), last: Math.max(a, b) };
}

/**
 * Tell if a range lies inside the groove.
 * @param {BeatRange} range
 * @param {number} numBeats
 * @param {number} numberOfMeasures
 * @returns {boolean}
 */
export function rangeFits(range, numBeats, numberOfMeasures) {
  return range.first >= 0 && range.last < numBeats * numberOfMeasures;
}

/**
 * Split a range into one slot span per bar. `from` is inclusive, `to` is exclusive.
 * @param {BeatRange} range
 * @param {number} numBeats
 * @param {number} slotsPerBar
 * @returns {Array<{ bar: number, from: number, to: number }>}
 */
export function barRanges(range, numBeats, slotsPerBar) {
  const slotsPerBeat = slotsPerBar / numBeats;
  const firstBar = Math.floor(range.first / numBeats);
  const lastBar = Math.floor(range.last / numBeats);
  const spans = [];
  for (let bar = firstBar; bar <= lastBar; bar++) {
    const firstBeat = bar === firstBar ? range.first - bar * numBeats : 0;
    const lastBeat = bar === lastBar ? range.last - bar * numBeats : numBeats - 1;
    spans.push({ bar, from: firstBeat * slotsPerBeat, to: (lastBeat + 1) * slotsPerBeat });
  }
  return spans;
}

/**
 * Map a position inside the part (0..1) to a position inside the groove (0..1).
 * @param {number} p
 * @param {BeatRange} range
 * @param {number} numBeats
 * @param {number} numberOfMeasures
 * @returns {number}
 */
export function groovePercent(p, range, numBeats, numberOfMeasures) {
  return (range.first + p * (range.last - range.first + 1)) / (numBeats * numberOfMeasures);
}

/**
 * Map a position inside the count-in (0..1) to a position inside the groove (0..1). The
 * count-in clicks one full bar and then the lead beats: the beats before the selection in its
 * bar. The full bar gives -1, which clears the playhead. Each lead beat shows on its own beat.
 * @param {number} p
 * @param {BeatRange} range
 * @param {number} numBeats
 * @param {number} numberOfMeasures
 * @returns {number}
 */
export function countInPercent(p, range, numBeats, numberOfMeasures) {
  const lead = range.first % numBeats;
  const clicks = p * (numBeats + lead);
  if (clicks < numBeats) return -1;
  const firstBar = Math.floor(range.first / numBeats);
  return (firstBar * numBeats + clicks - numBeats) / (numBeats * numberOfMeasures);
}

/**
 * Name a selection for the user, with 1-based bars and beats.
 * @param {BeatRange} range
 * @param {number} numBeats
 * @returns {string}
 */
export function selectionLabel(range, numBeats) {
  const firstBar = Math.floor(range.first / numBeats);
  const lastBar = Math.floor(range.last / numBeats);
  const firstBeat = (range.first % numBeats) + 1;
  const lastBeat = (range.last % numBeats) + 1;
  if (firstBeat === 1 && lastBeat === numBeats) {
    return firstBar === lastBar ? `Bar ${firstBar + 1}` : `Bars ${firstBar + 1}–${lastBar + 1}`;
  }
  if (firstBar === lastBar) {
    return range.first === range.last
      ? `Bar ${firstBar + 1}, beat ${firstBeat}`
      : `Bar ${firstBar + 1}, beats ${firstBeat}–${lastBeat}`;
  }
  return `Bar ${firstBar + 1} beat ${firstBeat} – bar ${lastBar + 1} beat ${lastBeat}`;
}

/**
 * The ruler state machine. A first tap sets an anchor. A second tap closes the range. As with
 * selected text, a tap on the selection clears it: on the anchor, inside a closed range, or on
 * "Bar N" of the bar that is the selection.
 * @param {TapState} state
 * @param {RulerEvent} event
 * @returns {TapState}
 */
export function nextSelection(state, event) {
  const none = { range: null, anchor: null };
  switch (event.type) {
    case 'tap': {
      const { range, anchor } = state;
      if (anchor !== null) {
        return event.beat === anchor
          ? none
          : { range: normalizeRange(anchor, event.beat), anchor: null };
      }
      if (range && event.beat >= range.first && event.beat <= range.last) return none;
      return { range: { first: event.beat, last: event.beat }, anchor: event.beat };
    }
    case 'drag':
      return { range: normalizeRange(event.from, event.to), anchor: null };
    case 'bar': {
      const first = event.bar * event.numBeats;
      const last = first + event.numBeats - 1;
      if (state.range?.first === first && state.range.last === last) return none;
      return { range: { first, last }, anchor: null };
    }
    default:
      return none;
  }
}
