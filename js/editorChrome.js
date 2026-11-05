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

function tempoButton(label, ariaLabel, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tempoStep';
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);
  button.addEventListener('click', onClick);
  return button;
}

// The embeds share the player markup, so these changes apply to the editor's player only.
export function initPlaybackControls(utils) {
  const player = document.getElementById('midiPlayer');
  const tempoField = player.querySelector('.tempoTextField');
  tempoField.setAttribute('aria-label', 'Beats per minute');
  tempoField.before(tempoButton('−', 'Slower', utils.downTempo));
  tempoField.after(tempoButton('+', 'Faster', utils.upTempo));

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
