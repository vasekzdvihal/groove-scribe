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

export function initPopovers() {
  let open = null;

  function close() {
    if (!open) return;
    open.popover.hidden = true;
    open.trigger.setAttribute('aria-expanded', 'false');
    open = null;
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
    });
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
      event.target.closest(
        '#libraryToggle, #ToolBar button, #PlaybackBar button, .tool-popover button'
      )
    ) {
      event.preventDefault();
    }
  });
}

const KNOB_DEGREES_PER_BPM = 6; // so a full turn is 60 BPM
const KNOB_DEAD_RADIUS = 8; // px round the centre where the pointer angle jumps, so it is ignored
const KNOB_TAP_SLOP = 4; // px of movement that a tap can have
const KNOB_SETTLE_MS = 150; // the time the grip takes to settle on the tempo after a drag
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

  // The part of a turn that is not yet a whole BPM. The grip shows it, so it follows the finger.
  let partDegrees = 0;
  const showGrip = () => {
    grip.style.transform = `rotate(${getTempo() * KNOB_DEGREES_PER_BPM + partDegrees}deg)`;
  };
  function show() {
    const tempo = getTempo();
    knob.setAttribute('aria-valuenow', String(tempo));
    knob.setAttribute('aria-valuetext', `${tempo} BPM`);
    number.textContent = String(tempo);
    valueArc.setAttribute('stroke-dasharray', `${tempo - min} 360`);
    showGrip();
  }

  // A drag. The tempo changes only after the pointer has moved round the centre, so a finger
  // that lands on the ring causes no jump, and a tap causes no change.
  let drag = null;
  knob.addEventListener('pointerdown', (event) => {
    if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
    // No mouse events follow, so the tap does not move focus or select text.
    event.preventDefault();
    knob.setPointerCapture(event.pointerId);
    const box = knob.getBoundingClientRect();
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    drag = {
      id: event.pointerId,
      centre,
      start: { x: event.clientX, y: event.clientY },
      angle: pointerAngle(event, centre),
      turned: 0,
      moved: false,
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
      partDegrees += delta;
      // A small margin, so 90 degrees made of many small moves is 15 BPM, not 14.
      const steps = Math.trunc(
        (partDegrees + Math.sign(partDegrees) * 1e-6) / KNOB_DEGREES_PER_BPM
      );
      if (steps) {
        const before = getTempo();
        changeTempo(steps);
        partDegrees -= steps * KNOB_DEGREES_PER_BPM;
        // At the end of the range the grip stops too, and a turn back changes the tempo at once.
        if (getTempo() === before) partDegrees = 0;
      }
      showGrip();
    }
    drag.angle = angle;
  });
  const endDrag = (event, isTap) => {
    if (event.pointerId !== drag?.id) return;
    drag = null;
    knob.classList.remove('is-turning');
    if (partDegrees) {
      knob.classList.add('is-settling');
      window.setTimeout(() => knob.classList.remove('is-settling'), KNOB_SETTLE_MS);
    }
    partDegrees = 0;
    showGrip();
    if (isTap) openTyping(false);
  };
  knob.addEventListener('pointerup', (event) => {
    const isTap = drag && !drag.moved && Math.abs(drag.turned) < KNOB_DEGREES_PER_BPM;
    endDrag(event, isTap);
  });
  knob.addEventListener('pointercancel', (event) => endDrag(event, false));
  knob.addEventListener('lostpointercapture', (event) => endDrag(event, false));
  // A long press on a touch screen must not open a menu.
  knob.addEventListener('contextmenu', (event) => event.preventDefault());

  // One BPM for each notch of a mouse wheel. A trackpad sends many small steps; they add up.
  let wheel = 0;
  knob.addEventListener(
    'wheel',
    (event) => {
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
  tempoField.setAttribute('aria-label', 'Beats per minute');
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
