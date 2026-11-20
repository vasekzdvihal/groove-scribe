// Whether the last input was a key, not a mouse, a pen or a finger. A menu, a popover or a panel
// that a key opens takes the focus. A tap leaves the focus where it is, so the tablet flow stays
// as it was and Space still plays.
let keyboardInput = false;
let inputTracked = false;

/** Starts to follow the input. Safe to call again. */
export function trackInput() {
  if (inputTracked) return;
  inputTracked = true;
  window.addEventListener('keydown', () => (keyboardInput = true), true);
  window.addEventListener('pointerdown', () => (keyboardInput = false), true);
}

/** @returns {boolean} */
export function lastInputWasKeyboard() {
  return keyboardInput;
}
