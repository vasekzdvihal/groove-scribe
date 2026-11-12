// Questions before the editor loses notes: "Discard your changes?" when another groove replaces
// unsaved edits, and "Clear all notes?" before Clear all notes. The library panel and the
// Grooves menu both ask the first one, so the questions belong to the page and work without the
// panel. Each question is an in-page dialog, not window.confirm, so it has large buttons and the
// colours of the editor.

const QUESTIONS = {
  discard: {
    id: 'discardDialog',
    title: 'Discard your changes?',
    text: 'The groove in the editor has changes that are not saved.',
    yes: 'Discard changes',
    no: 'Keep editing',
  },
  clearNotes: {
    id: 'clearNotesDialog',
    title: 'Clear all notes?',
    text: 'This removes every note from every measure. Undo brings them back.',
    yes: 'Clear all notes',
    no: 'Keep the notes',
  },
};

/** @type {Map<string, HTMLDialogElement>} */
const dialogs = new Map();

/** @param {{id: string, title: string, text: string, yes: string, no: string}} question */
function createDialog({ id, title, text, yes, no }) {
  const node = document.createElement('dialog');
  node.id = id;
  node.className = 'confirm-dialog';
  node.setAttribute('aria-labelledby', id + 'Title');
  node.setAttribute('aria-describedby', id + 'Text');
  node.innerHTML = `
  <form method="dialog">
    <h2 id="${id}Title">${title}</h2>
    <p id="${id}Text">${text}</p>
    <div class="confirm-actions">
      <button type="submit" class="confirm-danger" value="yes">${yes}</button>
      <button type="submit" class="confirm-primary" value="no" autofocus>${no}</button>
    </div>
  </form>
`;
  // The editor has document-wide hotkeys, such as space for play. Keep them out of the dialog.
  node.addEventListener('keydown', (event) => event.stopPropagation());
  document.body.append(node);
  return node;
}

// The dialog gives focus back to the control that opened it. A control in a menu is hidden by
// then, so focus would fall to the page. Give it to the button that opens that menu instead.
function restoreFocus(returnFocus) {
  const active = document.activeElement;
  const lost = !active || active === document.body || active.getClientRects().length === 0;
  if (lost && returnFocus) returnFocus.focus();
}

/**
 * Show a question and wait for the answer. Escape gives the safe answer.
 *
 * @param {keyof typeof QUESTIONS} name
 * @param {HTMLElement | null | undefined} returnFocus  gets focus after the answer, if the
 *   control that opened the question is hidden
 * @returns {Promise<boolean>} true for the answer that loses notes
 */
function ask(name, returnFocus) {
  let dialog = dialogs.get(name);
  if (!dialog) {
    dialog = createDialog(QUESTIONS[name]);
    dialogs.set(name, dialog);
  }
  const shown = dialog;
  return new Promise((resolve) => {
    shown.addEventListener(
      'close',
      () => {
        restoreFocus(returnFocus);
        resolve(shown.returnValue === 'yes');
      },
      { once: true }
    );
    if (shown.open) return; // already asking: both callers get the one answer
    shown.returnValue = '';
    shown.showModal();
  });
}

/** @returns {boolean} true while the discard question is on screen */
export function isAskingToDiscard() {
  return Boolean(dialogs.get('discard')?.open);
}

/**
 * Ask whether to discard the unsaved changes. Escape means Keep editing.
 *
 * @param {HTMLElement | null} [returnFocus]  for a question opened from a menu: its button
 * @returns {Promise<boolean>} true for Discard changes
 */
export function askToDiscard(returnFocus) {
  return ask('discard', returnFocus);
}

/**
 * Ask before all notes are cleared. Escape means Keep the notes.
 *
 * @param {HTMLElement | null} [returnFocus]  for a question opened from a menu: its button
 * @returns {Promise<boolean>} true for Clear all notes
 */
export function askToClearNotes(returnFocus) {
  return ask('clearNotes', returnFocus);
}
