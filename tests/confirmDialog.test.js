import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The questions before the editor loses notes. jsdom has no showModal, so the test gives the
// dialog the parts of the browser behaviour that matter here: close() sets open to false at
// once and fires the 'close' event later, as a task.

const proto = /** @type {any} */ (HTMLDialogElement.prototype);

beforeEach(() => {
  vi.resetModules();
  proto.returnValue = '';
  proto.showModal = function () {
    this.open = true;
  };
  proto.close = function (value) {
    if (!this.open) return;
    this.open = false;
    if (value !== undefined) this.returnValue = value;
    setTimeout(() => this.dispatchEvent(new Event('close')), 0);
  };
});

afterEach(() => {
  delete proto.showModal;
  delete proto.close;
  delete proto.returnValue;
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const dialog = () => /** @type {HTMLDialogElement} */ (document.getElementById('discardDialog'));

describe('askToDiscard', () => {
  it('resolves true for Discard changes and false for Escape', async () => {
    const { askToDiscard } = await import('../js/confirmDialog.js');
    const yes = askToDiscard();
    dialog().close('yes');
    expect(await yes).toBe(true);
    const no = askToDiscard();
    dialog().close();
    expect(await no).toBe(false);
  });

  it('gives both callers the one answer while the question is open', async () => {
    const { askToDiscard } = await import('../js/confirmDialog.js');
    const first = askToDiscard();
    const second = askToDiscard();
    dialog().close('yes');
    expect(await Promise.all([first, second])).toEqual([true, true]);
  });

  it('keeps a new question open when the close event of the last one comes late', async () => {
    const { askToDiscard, isAskingToDiscard } = await import('../js/confirmDialog.js');
    const first = askToDiscard();
    dialog().close(); // Escape: the close event is still in the queue
    const second = askToDiscard();
    expect(await first).toBe(false);
    let answered = false;
    second.then(() => (answered = true));
    await tick();
    await tick();
    expect(answered).toBe(false);
    expect(isAskingToDiscard()).toBe(true);
    dialog().close('yes');
    expect(await second).toBe(true);
  });

  it('gives the last question its own answer when a new one opens before its close event', async () => {
    const { askToDiscard } = await import('../js/confirmDialog.js');
    const first = askToDiscard();
    dialog().close('yes');
    const second = askToDiscard();
    expect(await first).toBe(true);
    dialog().close();
    expect(await second).toBe(false);
  });
});
