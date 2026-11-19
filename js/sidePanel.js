// The side panel in the editor: tab buttons in the top bar open one panel on the left, with one
// section for each tab.
//
// On a wide screen the panel is docked next to the music and stays open until the user closes
// it. It is not a dialog: focus stays on the page, so space still plays. On a narrow screen the
// panel slides over the editor, like a dialog. Turning a tablet closes an overlay panel, and a
// docked panel that the user left open comes back when the tablet turns back.
import { isAskingToDiscard } from './confirmDialog.js';

// The docked panel is open. The key is older than the side panel: the library panel used it.
// The side panel uses it only when it has a Library tab. Without one, the key is not used, and
// the docked choice lasts until the page closes.
const KEEP_OPEN_KEY = 'grooveScribe.libraryOpen';
// The tab the panel showed last.
const TAB_KEY = 'grooveScribe.panelTab';
// Keep the same width in css/side-panel.css.
const DOCKED_QUERY = '(min-width: 1100px)';

function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the choice lasts until the page closes */
  }
}

/**
 * @typedef {'library' | 'permutations' | 'grooves'} TabId
 * @typedef {{ id: TabId, label: string, title: string, icon: string }} Tab
 */

function tabButton(tab) {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = `${tab.id}Tab`;
  button.className = 'tool tool-filled panel-tab';
  // The label hides on a narrow screen, so the button keeps its name here.
  button.setAttribute('aria-label', tab.label);
  button.setAttribute('aria-controls', 'sidePanel');
  button.setAttribute('aria-pressed', 'false');
  const content = document.createElement('span');
  content.className = 'tool-in';
  const icon = document.createElement('i');
  icon.className = tab.icon;
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'panel-tab-label';
  label.textContent = tab.label;
  content.append(icon, label);
  button.append(content);
  return button;
}

/**
 * Build the side panel and its tab buttons. Call `start` once, after every tab has registered
 * its `onShow` listener.
 *
 * @param {{ tabs: Tab[] }} options  the tabs, in display order
 */
export function createSidePanel({ tabs }) {
  const docked = window.matchMedia(DOCKED_QUERY);
  const byTab = new Map(tabs.map((tab) => [tab.id, tab]));
  const storesKeepOpen = byTab.has('library');

  const backdrop = document.createElement('div');
  backdrop.id = 'sidePanelBackdrop';

  const panel = document.createElement('aside');
  panel.id = 'sidePanel';
  panel.inert = true;
  panel.setAttribute('aria-labelledby', 'sidePanelTitle');

  const head = document.createElement('header');
  head.className = 'side-panel-head';
  const title = document.createElement('h2');
  title.id = 'sidePanelTitle';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.id = 'sidePanelClose';
  closeButton.setAttribute('aria-label', 'Close panel');
  closeButton.textContent = '✕';
  head.append(title, closeButton);
  panel.append(head);

  const buttons = new Map();
  const sections = new Map();
  for (const tab of tabs) {
    const section = document.createElement('section');
    section.id = `${tab.id}Panel`;
    section.className = 'side-panel-section';
    section.hidden = true;
    panel.append(section);
    sections.set(tab.id, section);

    const button = tabButton(tab);
    button.addEventListener('click', () => toggle(tab.id));
    document.getElementById('upperLeft')?.append(button);
    buttons.set(tab.id, button);
  }
  // In the editor the panel goes right after the top bar, before <main>: the tab order is the
  // tabs, the panel, then the tools. A page without the top bar gets it at the end.
  const topBar = document.getElementById('TopNav')?.closest('.nonPrintable');
  if (topBar) topBar.after(backdrop, panel);
  else document.body.append(backdrop, panel);

  /** @type {TabId | null} */
  let shownTab = null;
  // The tab to show when the panel opens by itself, also while it is closed.
  /** @type {TabId} */
  let lastTab = tabs[0]?.id;
  // The docked panel is open, or comes back when the screen gets wide again.
  let keepOpen = false;
  const showListeners = [];

  function draw() {
    const isOpen = shownTab !== null;
    panel.classList.toggle('open', isOpen);
    backdrop.classList.toggle('open', isOpen);
    document.body.classList.toggle('side-panel-open', isOpen);
    panel.inert = !isOpen;
    for (const [id, button] of buttons) {
      button.setAttribute('aria-pressed', String(id === shownTab));
    }
    for (const [id, section] of sections) section.hidden = id !== shownTab;
    title.textContent = isOpen ? byTab.get(shownTab).title : '';
  }

  function setShown(id) {
    const wasOpen = shownTab !== null;
    shownTab = id;
    draw();
    // A docked panel changes the width of the music, and the music draws to that width.
    if (wasOpen !== (id !== null)) window.dispatchEvent(new Event('resize'));
  }

  function rememberDockedChoice(isOpen) {
    if (!docked.matches) return;
    keepOpen = isOpen;
    if (storesKeepOpen) writeStored(KEEP_OPEN_KEY, String(isOpen));
  }

  function reveal(id, byUser) {
    const becomesVisible = shownTab !== id;
    lastTab = id;
    setShown(id);
    if (becomesVisible) for (const listener of showListeners) listener(id, { byUser });
  }

  /**
   * Open the panel on a tab.
   * @param {TabId} id
   * @param {{ byUser?: boolean }} [options]  byUser is false when the page opens it by itself
   */
  function show(id, { byUser = true } = {}) {
    if (!byTab.has(id)) return;
    if (byUser) {
      rememberDockedChoice(true);
      writeStored(TAB_KEY, id);
    }
    reveal(id, byUser);
    // An overlay panel is a dialog: focus goes into it.
    if (byUser && !docked.matches) closeButton.focus();
  }

  function close() {
    if (shownTab === null) return;
    const button = buttons.get(shownTab);
    // A docked panel is not a dialog. Focus stays on the page, so space still plays.
    const moveFocus = !docked.matches || panel.contains(document.activeElement);
    rememberDockedChoice(false);
    setShown(null);
    if (moveFocus) button.focus();
  }

  /** @param {TabId} id  shows that tab, or closes the panel when that tab is shown */
  function toggle(id) {
    if (shownTab === id) close();
    else show(id);
  }

  // After a pick in a tab, the user goes back to the music. An overlay panel closes. A docked
  // panel stays, but gives focus back to the page, so space plays.
  function afterPick() {
    if (!docked.matches) close();
    else if (panel.contains(document.activeElement)) {
      /** @type {HTMLElement} */ (document.activeElement).blur();
    }
  }

  function followScreenWidth() {
    if (docked.matches && keepOpen) reveal(lastTab, false);
    else setShown(null);
  }

  /**
   * Apply the stored state once. A docked panel opens when the user left it open, or when
   * nothing is stored (always so without a Library tab) and defaultOpen is true. An overlay
   * panel stays closed.
   * @param {{ defaultOpen: boolean, defaultTab: TabId }} options
   */
  function start({ defaultOpen, defaultTab }) {
    const stored = storesKeepOpen ? readStored(KEEP_OPEN_KEY) : null;
    keepOpen = stored === null ? defaultOpen : stored === 'true';
    const storedTab = /** @type {TabId} */ (readStored(TAB_KEY));
    if (byTab.has(storedTab)) lastTab = storedTab;
    else if (byTab.has(defaultTab)) lastTab = defaultTab;
    if (docked.matches && keepOpen) reveal(lastTab, false);
  }

  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  // The editor has document-wide hotkeys, such as space for play. Keep them out of the panel.
  panel.addEventListener('keydown', (event) => event.stopPropagation());
  // Listen on the document, because a click on the backdrop can leave focus outside the panel.
  document.addEventListener(
    'keydown',
    (event) => {
      // Escape in the dialog means Keep editing. It must not also close the panel.
      if (isAskingToDiscard()) return;
      if (event.key === 'Escape' && shownTab !== null && !docked.matches) close();
    },
    true
  );
  docked.addEventListener('change', followScreenWidth);
  draw();

  return {
    /** @param {TabId} id @returns {HTMLElement} */
    section: (id) => sections.get(id),
    show,
    close,
    toggle,
    isOpen: () => shownTab !== null,
    activeTab: () => shownTab,
    isDocked: () => docked.matches,
    /** @param {(id: TabId, options: { byUser: boolean }) => void} listener */
    onShow: (listener) => showListeners.push(listener),
    afterPick,
    start,
  };
}
