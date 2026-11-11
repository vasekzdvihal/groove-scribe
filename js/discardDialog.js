// The question before the editor loses changes that are not saved. The library panel and the
// Grooves menu both ask it, so it belongs to the page and works without the panel.

const DIALOG_HTML = `
  <form method="dialog">
    <h2 id="discardDialogTitle">Discard your changes?</h2>
    <p id="discardDialogText">The groove in the editor has changes that are not saved.</p>
    <div class="discard-actions">
      <button type="submit" class="discard-danger" value="discard">Discard changes</button>
      <button type="submit" class="discard-primary" value="keep" autofocus>Keep editing</button>
    </div>
  </form>
`;

/** @type {HTMLDialogElement | null} */
let dialog = null;

function createDialog() {
  const node = document.createElement('dialog');
  node.id = 'discardDialog';
  node.setAttribute('aria-labelledby', 'discardDialogTitle');
  node.setAttribute('aria-describedby', 'discardDialogText');
  node.innerHTML = DIALOG_HTML;
  // The editor has document-wide hotkeys, such as space for play. Keep them out of the dialog.
  node.addEventListener('keydown', (event) => event.stopPropagation());
  document.body.append(node);
  return node;
}

/** @returns {boolean} true while the question is on screen */
export function isAskingToDiscard() {
  return Boolean(dialog?.open);
}

/**
 * Ask whether to discard the unsaved changes. Escape means Keep editing.
 *
 * @returns {Promise<boolean>} true for Discard changes
 */
export function askToDiscard() {
  dialog ??= createDialog();
  const shown = dialog;
  return new Promise((resolve) => {
    shown.addEventListener('close', () => resolve(shown.returnValue === 'discard'), {
      once: true,
    });
    if (shown.open) return; // already asking: both callers get the one answer
    shown.returnValue = '';
    shown.showModal();
  });
}
