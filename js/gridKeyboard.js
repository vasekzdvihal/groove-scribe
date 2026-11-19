// The note grid by keyboard (the ARIA grid pattern).
//
// The cells come from viewHtml.js with role="gridcell", tabindex="-1", data-instrument and a
// global data-index. The whole grid is one tab stop: exactly one visible cell has tabindex="0".
// The arrow keys move between the cells, and Space or Enter sets the note of the cell.
// Listeners are delegated to the container, so a redraw of the grid needs no new call.

/** The lanes from top to bottom, as the grid shows them. */
export const LANE_ORDER = ['sticking', 'hh', 'tom1', 'tom2', 'snare', 'tom4', 'kick'];

// The widgets that use the arrow keys themselves. The page-wide Left and Right (tempo) keys
// must not run in them.
const ARROW_OWNERS =
  '[role="grid"], [role="slider"], [role="listbox"], [role="menu"], [role="menubar"], ' +
  'input, select, textarea, [contenteditable]:not([contenteditable="false"])';

/**
 * True when the target of a key event is in a widget that uses the arrow keys.
 * @param {EventTarget | null} target
 * @returns {boolean}
 */
export function ownsArrowKeys(target) {
  return target instanceof Element && target.closest(ARROW_OWNERS) !== null;
}

/** @param {Element | null} cell */
function isVisible(cell) {
  return cell !== null && cell.getClientRects().length > 0;
}

/**
 * Lets the keyboard use the note grid.
 * @param {HTMLElement} container  #measureContainer
 * @param {(cell: HTMLElement) => void} onToggle  sets or clears the note of the cell
 */
export function initGridKeyboard(container, onToggle) {
  /** @type {HTMLElement | null} */
  var stop = null;

  /** @param {string} instrument @param {number} index @returns {HTMLElement | null} */
  function cellAt(instrument, index) {
    return container.querySelector(
      '[role="gridcell"][data-instrument="' + instrument + '"][data-index="' + index + '"]'
    );
  }

  /** @param {string} selector @returns {HTMLElement[]} */
  function cellsMatching(selector) {
    return Array.from(container.querySelectorAll('[role="gridcell"]' + selector));
  }

  /** @param {HTMLElement} cell */
  function makeStop(cell) {
    if (stop === cell) return;
    if (stop) stop.setAttribute('tabindex', '-1');
    // A cell made by a redraw may have the old tabindex="0" from no one: clear all to be sure.
    container.querySelectorAll('[role="gridcell"][tabindex="0"]').forEach(function (other) {
      if (other !== cell) other.setAttribute('tabindex', '-1');
    });
    cell.setAttribute('tabindex', '0');
    stop = cell;
  }

  /** @param {HTMLElement | null} cell */
  function moveTo(cell) {
    if (!cell || !isVisible(cell)) return;
    makeStop(cell);
    cell.focus();
  }

  // The same note in the next shown lane up (step -1) or down (step 1), or null at the end.
  /** @param {HTMLElement} cell @param {number} step */
  function cellInNextLane(cell, step) {
    var index = Number(cell.dataset.index);
    for (
      var lane = LANE_ORDER.indexOf(cell.dataset.instrument || '') + step;
      lane >= 0 && lane < LANE_ORDER.length;
      lane += step
    ) {
      var next = cellAt(LANE_ORDER[lane], index);
      if (isVisible(next)) return next;
    }
    return null;
  }

  // Home and End: the ends of the lane in this bar (the parent row). With Ctrl: of the groove.
  /** @param {KeyboardEvent} e @param {HTMLElement} cell */
  function laneEnd(e, cell) {
    var cells = e.ctrlKey
      ? cellsMatching('[data-instrument="' + cell.dataset.instrument + '"]')
      : cellsMatching('').filter(function (other) {
          return other.parentElement === cell.parentElement;
        });
    return (e.key === 'Home' ? cells[0] : cells[cells.length - 1]) || null;
  }

  // The cell that the key moves to (null at an end), or undefined when it is not a grid key.
  /** @param {KeyboardEvent} e @param {HTMLElement} cell @returns {HTMLElement | null | undefined} */
  function target(e, cell) {
    var instrument = cell.dataset.instrument || '';
    var index = Number(cell.dataset.index);
    switch (e.key) {
      case 'ArrowLeft':
        return cellAt(instrument, index - 1);
      case 'ArrowRight':
        return cellAt(instrument, index + 1);
      case 'ArrowUp':
        return cellInNextLane(cell, -1);
      case 'ArrowDown':
        return cellInNextLane(cell, 1);
      case 'Home':
      case 'End':
        return laneEnd(e, cell);
      default:
        return undefined;
    }
  }

  container.addEventListener('keydown', function (e) {
    var cell = e.target instanceof HTMLElement ? e.target : null;
    if (!cell || cell.getAttribute('role') !== 'gridcell' || e.altKey || e.metaKey) return;
    if (e.key === ' ' || e.key === 'Enter') {
      if (e.ctrlKey || e.shiftKey) return;
      onToggle(cell);
    } else {
      // Ctrl goes with Home and End only, so Ctrl and an arrow is not a grid key.
      if (e.ctrlKey && e.key !== 'Home' && e.key !== 'End') return;
      var next = target(e, cell);
      if (next === undefined) return; // other keys pass through: Ctrl+Z still undoes
      moveTo(next);
    }
    // The page keys must not see a grid key: Space would stop playback, Left would slow it.
    e.preventDefault();
    e.stopPropagation();
  });

  container.addEventListener('focusin', function (e) {
    var cell = e.target instanceof HTMLElement ? e.target : null;
    if (cell && cell.getAttribute('role') === 'gridcell') makeStop(cell);
  });

  // A mouse or a touch on a cell makes it the stop, but does not take the focus into the grid
  // when it is not there yet. Space then still plays and the arrows still change the tempo, as
  // before. When the focus is in the grid already, it follows the click.
  container.addEventListener('mousedown', function (e) {
    var cell = e.target instanceof Element ? e.target.closest('[role="gridcell"]') : null;
    if (!(cell instanceof HTMLElement)) return;
    makeStop(cell);
    if (!container.contains(document.activeElement)) {
      e.preventDefault();
      // As before the cells took focus, a click on the grid takes the focus from a field.
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }
  });

  // After a redraw or a hidden lane, the stop can be gone. Check in the next frame. When the
  // stop is fine, the check is one test, so the playback highlight costs nothing.
  var checkPending = false;
  function checkStop() {
    checkPending = false;
    if (stop && stop.isConnected && isVisible(stop)) return;
    var first =
      cellsMatching('[data-instrument="hh"]').find(isVisible) || cellsMatching('').find(isVisible);
    if (first) makeStop(first);
  }
  new MutationObserver(function () {
    if (checkPending) return;
    checkPending = true;
    requestAnimationFrame(checkStop);
  }).observe(container, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
  checkStop();
}
