// Behavior for the editor's bars: small popover menus, the tempo knob, and swing.
// The other menus are the older context menus, opened by GrooveWriter.

// The bars are fixed to the screen, so a popover uses screen coordinates. A toolbar that
// scrolls sideways on a narrow screen cannot clip it this way.
function placePopover(popover, trigger) {
  const margin = 4;
  const rect = trigger.getBoundingClientRect();
  const opensUpward = rect.top > window.innerHeight / 2;
  const left = Math.min(rect.left, window.innerWidth - popover.offsetWidth - margin);
  popover.style.left = Math.max(margin, left) + 'px';
  popover.style.top =
    (opensUpward ? rect.top - popover.offsetHeight - margin : rect.bottom + margin) + 'px';
}

// Whether the last input was a key, not a mouse, a pen or a finger. A menu or a popover that a
// key opens takes the focus. A tap leaves the focus where it is, so the tablet flow stays as it
// was and Space still plays.
let keyboardInput = false;
let inputTracked = false;

function trackInput() {
  if (inputTracked) return;
  inputTracked = true;
  window.addEventListener('keydown', () => (keyboardInput = true), true);
  window.addEventListener('pointerdown', () => (keyboardInput = false), true);
}

/** @returns {boolean} */
function lastInputWasKeyboard() {
  return keyboardInput;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** @param {Element} container @returns {HTMLElement | undefined} */
function firstFocusable(container) {
  return /** @type {HTMLElement[]} */ ([...container.querySelectorAll(FOCUSABLE)]).find(
    (el) => el.getClientRects().length > 0
  );
}

export function initPopovers() {
  trackInput();
  let open = null;

  function close() {
    if (!open) return;
    const { popover, trigger } = open;
    // A key used the popover: the focus goes back to its button. A tap left the focus outside.
    const hadFocus = popover.contains(document.activeElement);
    popover.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    open = null;
    if (hadFocus) trigger.focus();
  }

  for (const trigger of document.querySelectorAll('[data-popover]')) {
    const popover = document.getElementById(trigger.dataset.popover);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', popover.id);
    trigger.addEventListener('click', () => {
      const wasOpen = open?.popover === popover;
      close();
      if (wasOpen) return;
      popover.hidden = false;
      placePopover(popover, trigger);
      trigger.setAttribute('aria-expanded', 'true');
      open = { popover, trigger };
      if (lastInputWasKeyboard()) firstFocusable(popover)?.focus();
    });
    // Tab out of the popover closes it. The focus stays where Tab took it.
    const closeOnFocusAway = (/** @type {FocusEvent} */ event) => {
      const to = event.relatedTarget;
      if (open?.popover !== popover || !(to instanceof Node)) return;
      if (!popover.contains(to) && !trigger.contains(to)) close();
    };
    popover.addEventListener('focusout', closeOnFocusAway);
    trigger.addEventListener('focusout', closeOnFocusAway);
  }

  document.addEventListener('click', (event) => {
    if (!open) return;
    const stayedInside =
      open.trigger.contains(event.target) ||
      (open.popover.contains(event.target) && !event.target.closest('[data-popover-close]'));
    if (!stayedInside) close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !open) return;
    const { trigger } = open;
    close();
    trigger.focus();
  });

  // Space plays the groove. A tapped button must not keep focus, or space would press it again.
  document.addEventListener('mousedown', (event) => {
    if (
      event.target.closest('.panel-tab, #ToolBar button, #PlaybackBar button, .tool-popover button')
    ) {
      event.preventDefault();
    }
  });
}

/** @param {Element} menu @returns {HTMLElement[]} the items that show */
function markMenuItems(menu) {
  menu.setAttribute('role', 'menu');
  const items = [];
  for (const item of /** @type {HTMLElement[]} */ ([...menu.children])) {
    if (item.tagName !== 'LI') continue;
    if (item.hidden) {
      item.removeAttribute('role');
      item.removeAttribute('tabindex');
      continue;
    }
    item.setAttribute('role', 'menuitem');
    item.setAttribute('tabindex', '-1');
    items.push(item);
  }
  return items;
}

const isEnabled = (/** @type {HTMLElement} */ item) =>
  item.getAttribute('aria-disabled') !== 'true';

/** @param {Element | null} active @returns {HTMLElement | null} the focus, unless it is nowhere */
const focusedControl = (active) =>
  active instanceof HTMLElement && active !== document.body ? active : null;

/** @param {HTMLElement} element  focus it, or the element that a redraw put in its place */
function focusBack(element) {
  let target = element.isConnected ? element : element.id && document.getElementById(element.id);
  // An item of a popover that has closed (Download in ⋯): the popover button gets the focus.
  const popover = target?.closest('.tool-popover');
  if (popover instanceof HTMLElement && popover.hidden) {
    target = document.querySelector(`[data-popover="${popover.id}"]`);
  }
  if (target instanceof HTMLElement) target.focus();
}

/**
 * The older menus (GrooveWriter's context menus) by keyboard: the ARIA menu pattern.
 * @param {{ showContextMenu: (menu: HTMLElement) => void,
 *   hideContextMenu: (menu?: HTMLElement | false) => void,
 *   visible_context_menu: HTMLElement | false }} utils
 */
export function initContextMenus(utils) {
  trackInput();
  // The signed-in name is the first item of the user menu. A screen reader reads it, but it
  // does nothing.
  document.getElementById('userMenuName')?.setAttribute('aria-disabled', 'true');
  const menus = document.querySelectorAll('.noteContextMenu > ul');
  menus.forEach(markMenuItems);

  // The focus goes back here when the menu closes. A tap gives none: the focus stays as it was.
  /** @type {HTMLElement | null} */
  let opener = null;
  // The menu button that says the menu is open (aria-expanded).
  /** @type {Element | null} */
  let trigger = null;
  // The menu button of the click that is running now. A tap does not focus a toolbar button.
  /** @type {Element | null} */
  let clickedTrigger = null;
  document.addEventListener(
    'click',
    (event) => {
      clickedTrigger =
        event.target instanceof Element ? event.target.closest('[aria-haspopup="menu"]') : null;
      setTimeout(() => (clickedTrigger = null));
    },
    true
  );

  const hide = utils.hideContextMenu;
  utils.hideContextMenu = function (contextMenu) {
    const shown = utils.visible_context_menu || contextMenu;
    const hadFocus = shown instanceof Element && shown.contains(document.activeElement);
    hide.call(utils, contextMenu);
    trigger?.setAttribute('aria-expanded', 'false');
    const back = opener;
    opener = trigger = null;
    if (hadFocus && back) focusBack(back);
  };

  const show = utils.showContextMenu;
  utils.showContextMenu = function (contextMenu) {
    const active = document.activeElement;
    const previous = utils.visible_context_menu;
    // A sub-menu (Offset click) opens from an item of a menu. It keeps the first opener.
    const kept = previous && previous.contains(active) ? { opener, trigger } : null;
    show.call(utils, contextMenu);
    if (kept) {
      ({ opener, trigger } = kept);
    } else {
      opener = focusedControl(active);
      trigger = clickedTrigger ?? (opener?.matches('[aria-haspopup="menu"]') ? opener : null);
    }
    trigger?.setAttribute('aria-expanded', 'true');
    const items = markMenuItems(contextMenu);
    if (lastInputWasKeyboard()) items.find(isEnabled)?.focus({ preventScroll: true });
  };

  /** @param {KeyboardEvent} event */
  function onMenuKey(event) {
    const menu = /** @type {HTMLElement} */ (event.currentTarget);
    const items = /** @type {HTMLElement[]} */ ([
      ...menu.querySelectorAll(':scope > [role="menuitem"]'),
    ]);
    const item = event.target instanceof Element ? event.target.closest('[role="menuitem"]') : null;
    const at = items.indexOf(/** @type {HTMLElement} */ (item));
    const count = items.length;
    const moveTo = (/** @type {number} */ index) => items[(index + count) % count]?.focus();
    switch (event.key) {
      case 'ArrowDown':
        moveTo(at + 1);
        break;
      case 'ArrowUp':
        moveTo(at < 0 ? -1 : at - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(-1);
        break;
      case 'Enter':
      case ' ':
        if (!event.repeat && item instanceof HTMLElement && isEnabled(item)) {
          item.click();
          // A tap closes the menu with a click on the page, which waits a moment after it
          // opens. A key closes it now.
          if (utils.visible_context_menu === menu) utils.hideContextMenu(menu);
        }
        break;
      case 'Escape':
        utils.hideContextMenu(menu);
        break;
      case 'Tab':
        // Close and let Tab go on from the menu button.
        utils.hideContextMenu(menu);
        return;
      default:
        return;
    }
    // The page keys must not see a menu key: Space would play, Left would slow the tempo.
    event.preventDefault();
    event.stopPropagation();
  }
  menus.forEach((menu) => menu.addEventListener('keydown', onMenuKey));
}

// The popups of the editor. Each one closes with its own Cancel or close button, which Escape
// presses. They are not modal: Tab can leave them.
const POPUPS = [
  ['timeSigPopup', 'timeSigPopupTimeSigTop', 'timeSigPopupCancel'],
  ['fullURLPopup', 'fullURLPopupTextField', 'fullURLPopupCloseButton'],
  [
    'metronomeAutoSpeedupConfiguration',
    'metronomeAutoSpeedUpKeepGoingForever',
    'metronomeAutoSpeedupConfigurationCloseButton',
  ],
];

/**
 * Follows one popup as it opens and closes. The editor shows and hides it with its style.
 * @param {HTMLElement} popup
 * @param {HTMLElement} first  the control that gets the focus
 * @param {(open: boolean) => void} onChange
 */
function watchPopup(popup, first, onChange) {
  let isOpen = false;
  /** @type {HTMLElement | null} */
  let opener = null;
  // Where the focus came from when the editor put it into the popup itself (the share link).
  /** @type {HTMLElement | null} */
  let cameFrom = null;
  popup.addEventListener('focusin', (event) => {
    const from = event.relatedTarget;
    if (!isOpen && from instanceof HTMLElement && !popup.contains(from)) cameFrom = from;
  });

  function opened() {
    const active = document.activeElement;
    opener = popup.contains(active) ? cameFrom : focusedControl(active);
    if (lastInputWasKeyboard() && !popup.contains(active)) first.focus();
  }

  function closed() {
    const active = document.activeElement;
    // The focus was in the popup, or nowhere: it goes back. A focus that moved on stays.
    if (opener && (!focusedControl(active) || popup.contains(active))) focusBack(opener);
    opener = cameFrom = null;
  }

  new MutationObserver(() => {
    const nowOpen = getComputedStyle(popup).display !== 'none';
    if (nowOpen === isOpen) return;
    isOpen = nowOpen;
    if (nowOpen) opened();
    else closed();
    onChange(nowOpen);
  }).observe(popup, { attributes: true, attributeFilter: ['style'] });
}

export function initPopups() {
  trackInput();
  /** @type {{ popup: HTMLElement, close: HTMLElement }[]} the open popups, the newest last */
  const shown = [];
  for (const [popupId, firstId, closeId] of POPUPS) {
    const popup = document.getElementById(popupId);
    const first = document.getElementById(firstId);
    const close = document.getElementById(closeId);
    if (!popup || !first || !close) continue;
    watchPopup(popup, first, (open) => {
      const at = shown.findIndex((entry) => entry.popup === popup);
      if (at >= 0) shown.splice(at, 1);
      if (open) shown.push({ popup, close });
    });
  }

  // Escape closes the newest popup that has the focus, or any popup when the focus is nowhere.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const active = document.activeElement;
    const entry = shown.findLast(({ popup }) => !focusedControl(active) || popup.contains(active));
    if (!entry) return;
    event.preventDefault();
    entry.close.click();
  });
}

// A bar that scrolls sideways on a narrow screen brings a tool that gets focus fully into view,
// with the room that scroll-padding gives for its focus ring. Chrome does not scroll a bar inside
// a fixed element for focus by itself.
export function initBarScroll() {
  for (const id of ['ToolBar', 'PlaybackBar']) {
    document.getElementById(id)?.addEventListener('focusin', (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }
}

const KNOB_DEGREES_PER_BPM = 6; // so a full turn is 60 BPM
const KNOB_DEAD_RADIUS = 8; // px round the centre where the pointer angle jumps, so it is ignored
const KNOB_TAP_SLOP = 4; // px of movement that a tap can have
const KNOB_SETTLE_MS = 150; // the time the grip takes to settle on the arc end after a drag
const KNOB_WHEEL_NOTCH = 50; // px of wheel movement for 1 BPM, for a trackpad that sends small steps
const KNOB_KEY_STEPS = {
  ArrowUp: 1,
  ArrowRight: 1,
  ArrowDown: -1,
  ArrowLeft: -1,
  PageUp: 10,
  PageDown: -10,
};
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgElement(name, attributes) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

// The angle of the pointer round the centre, in degrees: 0 at the top, clockwise. Near the
// centre a small move makes a large change of angle, so there it is null.
function pointerAngle(event, centre) {
  const x = event.clientX - centre.x;
  const y = event.clientY - centre.y;
  if (Math.hypot(x, y) < KNOB_DEAD_RADIUS) return null;
  return (Math.atan2(x, -y) * 180) / Math.PI;
}

/**
 * The tempo knob. A finger or the mouse turns it like an endless wheel: clockwise is faster,
 * 6 degrees is 1 BPM. The grip mark turns with the finger. The arc shows where the tempo is in
 * its range. A tap, or Enter, opens the number for typing in the tempo field.
 *
 * @param {object} options
 * @param {number} options.min
 * @param {number} options.max
 * @param {function(): number} options.getTempo
 * @param {function(number): void} options.changeTempo  changes the tempo by this many BPM
 * @param {function(number): void} options.setTempo
 * @param {function(boolean): void} options.openTyping  true when the keyboard opened it
 */
function tempoKnob({ min, max, getTempo, changeTempo, setTempo, openTyping }) {
  const knob = document.createElement('div');
  knob.className = 'tempoKnob';
  knob.tabIndex = 0;
  knob.setAttribute('role', 'slider');
  knob.setAttribute('aria-label', 'Tempo');
  knob.setAttribute('aria-valuemin', String(min));
  knob.setAttribute('aria-valuemax', String(max));

  // pathLength 360 makes one unit of dash one degree. The rotation puts the start of the circle
  // at the lower left, so the 270 degree range has its gap at the bottom.
  const range = max - min;
  const ring = { cx: 28, cy: 28, r: 24, pathLength: 360, transform: 'rotate(135 28 28)' };
  const svg = svgElement('svg', {
    class: 'tempoKnobRing',
    viewBox: '0 0 56 56',
    'aria-hidden': 'true',
  });
  svg.append(
    svgElement('circle', { ...ring, class: 'tempoKnobTrack', 'stroke-dasharray': `${range} 360` }),
    svgElement('circle', { ...ring, class: 'tempoKnobValueArc' })
  );
  const valueArc = svg.lastChild;
  const grip = svgElement('g', { class: 'tempoKnobGrip' });
  grip.append(svgElement('circle', { cx: 28, cy: 4, r: 3 }));
  svg.append(grip);

  const number = document.createElement('span');
  number.className = 'tempoKnobNumber';
  const caption = document.createElement('span');
  caption.className = 'tempoKnobCaption';
  caption.textContent = 'BPM';
  const face = document.createElement('span');
  face.className = 'tempoKnobFace';
  face.setAttribute('aria-hidden', 'true');
  face.append(number, caption);
  knob.append(svg, face);

  // At rest the grip sits at the end of the value arc, so the knob shows one value. While a
  // finger turns the knob, the grip turns with the finger; when it lifts, the grip settles back.
  const arcEnd = (tempo) => -135 + ((tempo - min) * 270) / range;
  let gripNow = 0;
  const showGrip = (angle) => {
    gripNow = angle;
    grip.style.transform = `rotate(${angle}deg)`;
  };
  let settleTimer = 0;
  const stopSettling = () => {
    clearTimeout(settleTimer);
    knob.classList.remove('is-settling');
  };
  // The grip goes back to the arc end the short way, however many turns the finger made.
  const settleGrip = () => {
    const target = arcEnd(getTempo());
    const offset = ((((gripNow - target) % 360) + 540) % 360) - 180;
    if (Math.abs(offset) < 0.5) return showGrip(target);
    showGrip(target + offset);
    grip.getBoundingClientRect(); // applies the start angle before the transition starts
    knob.classList.add('is-settling');
    showGrip(target);
    settleTimer = window.setTimeout(stopSettling, KNOB_SETTLE_MS);
  };

  let drag = null;
  function show() {
    const tempo = getTempo();
    knob.setAttribute('aria-valuenow', String(tempo));
    knob.setAttribute('aria-valuetext', `${tempo} BPM`);
    number.textContent = String(tempo);
    valueArc.setAttribute('stroke-dasharray', `${tempo - min} 360`);
    if (!drag) showGrip(arcEnd(tempo));
  }

  // A drag. The tempo changes only after the pointer has moved round the centre, so a finger
  // that lands on the ring causes no jump, and a tap causes no change.
  // true from the pointer up of a tap until its click. iOS opens the keyboard only for a focus
  // inside a click, so the click opens typing.
  let tapPending = false;
  knob.addEventListener('pointerdown', (event) => {
    if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
    // No mouse events follow, so the tap does not move focus or select text.
    event.preventDefault();
    knob.setPointerCapture(event.pointerId);
    stopSettling();
    tapPending = false;
    const box = knob.getBoundingClientRect();
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    drag = {
      id: event.pointerId,
      centre,
      start: { x: event.clientX, y: event.clientY },
      angle: pointerAngle(event, centre),
      turned: 0,
      moved: false,
      tempo: getTempo(),
      grip: gripNow,
      // The part of the turn that is not yet a whole BPM. The grip shows it.
      part: 0,
    };
    knob.classList.add('is-turning');
  });
  knob.addEventListener('pointermove', (event) => {
    if (event.pointerId !== drag?.id) return;
    const { centre, start } = drag;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > KNOB_TAP_SLOP)
      drag.moved = true;
    const angle = pointerAngle(event, centre);
    if (angle === null) {
      drag.angle = null;
      return;
    }
    if (drag.angle !== null) {
      // The shortest way from the last angle, so a turn past the top does not jump 360 degrees.
      const delta = ((angle - drag.angle + 540) % 360) - 180;
      drag.turned += delta;
      drag.part += delta;
      // A small margin, so 90 degrees made of many small moves is 15 BPM, not 14.
      const steps = Math.trunc((drag.part + Math.sign(drag.part) * 1e-6) / KNOB_DEGREES_PER_BPM);
      if (steps) {
        changeTempo(steps);
        drag.part -= steps * KNOB_DEGREES_PER_BPM;
      }
      // At the end of the range the grip stops, and a turn back changes the tempo at once.
      const tempo = getTempo();
      if ((tempo >= max && drag.part > 0) || (tempo <= min && drag.part < 0)) drag.part = 0;
      showGrip(drag.grip + (tempo - drag.tempo) * KNOB_DEGREES_PER_BPM + drag.part);
    }
    drag.angle = angle;
  });
  const endDrag = (event) => {
    if (event.pointerId !== drag?.id) return;
    drag = null;
    knob.classList.remove('is-turning');
    settleGrip();
  };
  knob.addEventListener('pointerup', (event) => {
    tapPending = !!drag && !drag.moved && Math.abs(drag.turned) < KNOB_DEGREES_PER_BPM;
    endDrag(event);
  });
  knob.addEventListener('pointercancel', endDrag);
  knob.addEventListener('lostpointercapture', endDrag);
  knob.addEventListener('click', () => {
    if (tapPending) openTyping(false);
    tapPending = false;
  });
  // A long press on a touch screen must not open a menu.
  knob.addEventListener('contextmenu', (event) => event.preventDefault());

  // One BPM for each notch of a mouse wheel. A trackpad sends many small steps; they add up.
  let wheel = 0;
  knob.addEventListener(
    'wheel',
    (event) => {
      // A sideways or Shift wheel has no deltaY. It must not change the tempo.
      if (event.deltaY === 0) return;
      event.preventDefault();
      const notch = event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL;
      wheel =
        notch || Math.abs(event.deltaY) >= KNOB_WHEEL_NOTCH ? event.deltaY : wheel + event.deltaY;
      if (notch || Math.abs(wheel) >= KNOB_WHEEL_NOTCH) {
        changeTempo(wheel < 0 ? 1 : -1);
        wheel = 0;
      }
    },
    { passive: false }
  );

  knob.addEventListener('keydown', (event) => {
    const step = KNOB_KEY_STEPS[event.key];
    if (step) changeTempo(step);
    else if (event.key === 'Home') setTempo(min);
    else if (event.key === 'End') setTempo(max);
    else if (event.key === 'Enter') openTyping(true);
    else return;
    event.preventDefault();
    // The editor's own Left and Right keys change the tempo too. They must not add a step.
    event.stopPropagation();
  });

  return { knob, show };
}

// The tempo field takes a typed number. A tap selects the old number, so typing replaces it.
// Enter or a tap elsewhere applies it, and Escape keeps the old tempo. groove_utils.js reads the
// field on change.
function initTempoField(utils, player, tempoField) {
  const slider = /** @type {HTMLInputElement} */ (player.querySelector('.tempoInput'));
  const min = Number(slider.min);
  const max = Number(slider.max);
  tempoField.setAttribute('inputmode', 'numeric');
  tempoField.setAttribute('enterkeyhint', 'done');
  tempoField.setAttribute('autocomplete', 'off');

  // A tap selects the whole tempo, so typing replaces it. iOS Safari can ignore a selection made
  // in the focus handler, so the field selects again just after it.
  const selectAll = () => tempoField.setSelectionRange(0, tempoField.value.length);
  // true from a focus until the mouseup of the tap that focused the field. That mouseup would
  // undo the selection.
  let justFocused = false;
  // The second selection waits one tick. A key in between cancels it, so it never selects
  // what the user has started to type.
  let reselect = 0;
  tempoField.addEventListener('focus', () => {
    selectAll();
    reselect = window.setTimeout(() => {
      if (document.activeElement === tempoField) selectAll();
    }, 0);
    justFocused = true;
  });
  // A tap in a field that already has focus (from a key or a script) places the caret.
  tempoField.addEventListener('pointerdown', () => {
    if (document.activeElement === tempoField) justFocused = false;
  });
  tempoField.addEventListener('mouseup', (event) => {
    if (justFocused) event.preventDefault();
    justFocused = false;
  });
  tempoField.addEventListener('blur', () => (justFocused = false));
  tempoField.addEventListener('keydown', (event) => {
    clearTimeout(reselect);
    justFocused = false;
    if (event.key === 'Escape') {
      // The old value back, so the blur causes no change.
      tempoField.value = String(utils.getTempo());
      // An open popover must not also close on this key.
      event.stopPropagation();
    }
    if (event.key === 'Enter' || event.key === 'Escape') tempoField.blur();
  });
  // Runs before the change handler of groove_utils.js, which is on the field itself.
  player.addEventListener(
    'change',
    (event) => {
      if (event.target !== tempoField) return;
      const typed = parseInt(tempoField.value, 10);
      tempoField.value = String(
        Number.isNaN(typed) ? utils.getTempo() : Math.min(max, Math.max(min, typed))
      );
    },
    true
  );
  const setTempo = (tempo) => utils.setTempo(Math.min(max, Math.max(min, tempo)));
  return { min, max, setTempo, changeTempo: (delta) => setTempo(utils.getTempo() + delta) };
}

// The embeds share the player markup, so these changes apply to the editor's player only.
// The knob replaces the - and + buttons and the range slider. The slider stays in the page,
// hidden, because groove_utils.js keeps the tempo in it.
export function initPlaybackControls(utils) {
  const player = document.getElementById('midiPlayer');
  const tempoField = player.querySelector('.tempoTextField');
  const tempo = initTempoField(utils, player, tempoField);

  const holder = document.createElement('span');
  holder.className = 'tempoKnobHolder';
  let typingFromKeys = false;
  const { knob, show } = tempoKnob({
    ...tempo,
    getTempo: () => utils.getTempo(),
    openTyping(fromKeys) {
      typingFromKeys = fromKeys;
      holder.classList.add('is-typing');
      tempoField.value = String(utils.getTempo());
      tempoField.focus();
    },
  });
  tempoField.addEventListener('blur', () => {
    holder.classList.remove('is-typing');
    if (typingFromKeys) knob.focus();
    typingFromKeys = false;
  });
  tempoField.before(holder);
  holder.append(knob, tempoField);
  player.classList.add('has-tempo-knob');

  // Every tempo change goes through tempoUpdate: the knob, a typed tempo, a loaded groove, undo
  // and the metronome speed-up. It also writes the tempo field.
  const tempoUpdate = utils.tempoUpdate;
  utils.tempoUpdate = function (newTempo) {
    tempoUpdate.call(utils, newTempo);
    show();
  };
  show();

  const swingRow = player.querySelector('.swingRow');
  document.getElementById('swingPopover').append(swingRow);

  const swingOutput = swingRow.querySelector('.swingOutput');
  const swingLabel = document.getElementById('swingButtonLabel');
  const showSwing = () => {
    const amount = swingOutput.textContent.match(/\d+%/)?.[0];
    swingLabel.textContent = amount ? 'Swing ' + amount : 'Swing';
  };
  new MutationObserver(showSwing).observe(swingOutput, { childList: true, characterData: true });
  showSwing();
}

/**
 * Show the Save button next to Share. It says Saved while the editor shows a saved groove
 * without changes. A new groove is not saved anywhere, so it says Save.
 *
 * @param {function(): void} onClick
 * @returns {function(boolean): void}  shows whether the groove is saved
 */
export function initSaveButton(onClick) {
  const button = document.getElementById('saveButton');
  const icon = button.querySelector('.fa');
  const label = button.querySelector('.tool-label');
  button.addEventListener('click', onClick);
  button.hidden = false;
  return function showSaved(saved) {
    const text = saved ? 'Saved' : 'Save';
    label.textContent = text;
    // The label is hidden on a narrow screen, so the name must not come from it.
    button.setAttribute('aria-label', text);
    icon.className = saved ? 'fa fa-check' : 'fa fa-floppy-o';
  };
}
