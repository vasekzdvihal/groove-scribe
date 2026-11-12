// Behavior for the editor's bars: small popover menus, the BPM + and - buttons, and swing.
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

const HOLD_DELAY = 400; // ms before a held - or + starts to repeat
const HOLD_REPEAT = 80; // ms between repeats
const HOLD_FAST_AFTER = 1000; // ms of holding, after which each repeat is 5 BPM

/**
 * A - or + button. A click steps by one. Held down, it repeats, and after a second it steps
 * by 5, so a big tempo change needs no long row of taps.
 *
 * @param {string} label
 * @param {string} ariaLabel
 * @param {function(number): void} step  changes the tempo by this many steps
 */
function tempoButton(label, ariaLabel, step) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tempoStep';
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);

  let delay = 0;
  let repeat = 0;
  // true after a hold, so the click at the end of the hold adds no step
  let held = false;
  const stop = () => {
    clearTimeout(delay);
    clearInterval(repeat);
  };
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    stop();
    held = false;
    const start = Date.now();
    delay = window.setTimeout(() => {
      repeat = window.setInterval(() => {
        held = true;
        step(Date.now() - start > HOLD_FAST_AFTER ? 5 : 1);
      }, HOLD_REPEAT);
    }, HOLD_DELAY);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    button.addEventListener(type, stop);
  }
  // A long press on a touch screen must not open a menu.
  button.addEventListener('contextmenu', (event) => event.preventDefault());
  button.addEventListener('click', (event) => {
    // A click from the keyboard (detail 0) always steps.
    const endsHold = held && event.detail !== 0;
    held = false;
    if (!endsHold) step(1);
  });
  return button;
}

// The tempo field takes a typed number. A tap selects the old number, so typing replaces it.
// Enter or a tap elsewhere applies it. groove_utils.js reads the field on change.
function initTempoField(utils, player, tempoField) {
  const slider = /** @type {HTMLInputElement} */ (player.querySelector('.tempoInput'));
  const min = Number(slider.min);
  const max = Number(slider.max);
  tempoField.setAttribute('inputmode', 'numeric');
  tempoField.setAttribute('enterkeyhint', 'done');
  tempoField.setAttribute('autocomplete', 'off');

  let justFocused = false;
  tempoField.addEventListener('focus', () => {
    tempoField.select();
    justFocused = true;
  });
  // The mouseup of the tap that focused the field would undo the selection.
  tempoField.addEventListener('mouseup', (event) => {
    if (justFocused) event.preventDefault();
    justFocused = false;
  });
  tempoField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') tempoField.blur();
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
  return (delta) => utils.setTempo(Math.min(max, Math.max(min, utils.getTempo() + delta)));
}

// The embeds share the player markup, so these changes apply to the editor's player only.
export function initPlaybackControls(utils) {
  const player = document.getElementById('midiPlayer');
  const tempoField = player.querySelector('.tempoTextField');
  tempoField.setAttribute('aria-label', 'Beats per minute');
  const changeTempo = initTempoField(utils, player, tempoField);
  tempoField.before(tempoButton('−', 'Slower', (steps) => changeTempo(-steps)));
  tempoField.after(tempoButton('+', 'Faster', (steps) => changeTempo(steps)));

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
