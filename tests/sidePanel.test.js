import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSidePanel } from '../js/sidePanel.js';

// The side panel in the editor: tab buttons in the top bar open one panel on the left. On a wide
// screen the panel is docked next to the music; on a narrow screen it slides over the editor.

const LIBRARY = { id: 'library', label: 'Library', title: 'My library', icon: 'fa fa-bars' };
const PERMUTATIONS = {
  id: 'permutations',
  label: 'Permutations',
  title: 'Permutations',
  icon: 'fa fa-random',
};
const GROOVES = { id: 'grooves', label: 'Grooves', title: 'Grooves', icon: 'fa fa-list' };
const ALL_TABS = [LIBRARY, PERMUTATIONS, GROOVES];

/** A matchMedia stand-in whose `matches` the test sets, with a working change event. */
function fakeMedia(matches) {
  const listeners = new Set();
  const media = {
    matches,
    addEventListener: (type, fn) => type === 'change' && listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
    set(next) {
      media.matches = next;
      for (const fn of listeners) fn({ matches: next });
    },
  };
  return media;
}

/** A localStorage stand-in with the given entries. */
function fakeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    map,
  };
}

let media;
let storage;

function setUp({ docked = true, stored = {} } = {}) {
  media = fakeMedia(docked);
  storage = fakeStorage(stored);
  vi.stubGlobal('matchMedia', () => media);
  vi.stubGlobal('localStorage', storage);
}

const tab = (id) => /** @type {HTMLButtonElement} */ (document.getElementById(`${id}Tab`));
const title = () => document.getElementById('sidePanelTitle')?.textContent;
const bodyOpen = () => document.body.classList.contains('side-panel-open');

beforeEach(() => {
  document.body.innerHTML = '<div id="TopNav"><span id="upperLeft"></span></div>';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createSidePanel', () => {
  it('puts one tab button per tab in #upperLeft, in order', () => {
    setUp();
    createSidePanel({ tabs: ALL_TABS });
    const buttons = [...document.querySelectorAll('#upperLeft button')];
    expect(buttons.map((button) => button.textContent.trim())).toEqual([
      'Library',
      'Permutations',
      'Grooves',
    ]);
    expect(buttons.map((button) => button.id)).toEqual([
      'libraryTab',
      'permutationsTab',
      'groovesTab',
    ]);
    for (const button of buttons) {
      expect(button.getAttribute('aria-controls')).toBe('sidePanel');
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(button.className).toBe('tool tool-filled panel-tab');
    }
    expect(tab('grooves').querySelector('i')?.className).toBe('fa fa-list');
  });

  it('puts the panel right after the top bar', () => {
    // In the editor the panel comes before the tools in the tab order: right after the top bar,
    // before <main>.
    document.body.innerHTML =
      '<div class="nonPrintable"><div id="TopNav"><span id="upperLeft"></span></div></div><main></main>';
    setUp();
    createSidePanel({ tabs: ALL_TABS });
    expect(document.querySelector('main')?.previousElementSibling?.id).toBe('sidePanel');
    expect(document.getElementById('sidePanel')?.previousElementSibling?.id).toBe(
      'sidePanelBackdrop'
    );
  });

  it('gives each tab its own section', () => {
    setUp();
    const panel = createSidePanel({ tabs: ALL_TABS });
    expect(panel.section('library').id).toBe('libraryPanel');
    expect(panel.section('permutations').id).toBe('permutationsPanel');
    expect(panel.section('grooves').id).toBe('groovesPanel');
    expect(document.getElementById('sidePanel')?.contains(panel.section('grooves'))).toBe(true);
    expect(document.getElementById('sidePanelClose')?.getAttribute('aria-label')).toBe(
      'Close panel'
    );
  });

  it('toggle opens a tab, and toggle on the shown tab closes the panel', () => {
    setUp();
    const panel = createSidePanel({ tabs: ALL_TABS });
    const resizes = vi.fn();
    window.addEventListener('resize', resizes);

    panel.toggle('grooves');
    expect(panel.isOpen()).toBe(true);
    expect(panel.activeTab()).toBe('grooves');
    expect(title()).toBe('Grooves');
    expect(tab('grooves').getAttribute('aria-pressed')).toBe('true');
    expect(tab('library').getAttribute('aria-pressed')).toBe('false');
    expect(bodyOpen()).toBe(true);
    expect(panel.section('grooves').hidden).toBe(false);
    expect(panel.section('library').hidden).toBe(true);
    expect(resizes).toHaveBeenCalledTimes(1);

    panel.toggle('library');
    expect(panel.activeTab()).toBe('library');
    expect(title()).toBe('My library');
    expect(tab('grooves').getAttribute('aria-pressed')).toBe('false');
    expect(tab('library').getAttribute('aria-pressed')).toBe('true');
    expect(panel.section('grooves').hidden).toBe(true);

    panel.toggle('library');
    expect(panel.isOpen()).toBe(false);
    expect(panel.activeTab()).toBeNull();
    expect(tab('library').getAttribute('aria-pressed')).toBe('false');
    expect(bodyOpen()).toBe(false);
    window.removeEventListener('resize', resizes);
  });

  it('a click on a tab button toggles its tab, and the close button closes the panel', () => {
    setUp();
    const panel = createSidePanel({ tabs: ALL_TABS });
    tab('grooves').click();
    expect(panel.activeTab()).toBe('grooves');
    document.getElementById('sidePanelClose')?.click();
    expect(panel.isOpen()).toBe(false);
  });

  it('remembers the docked choice and the last tab', () => {
    setUp();
    const panel = createSidePanel({ tabs: ALL_TABS });
    panel.show('grooves');
    expect(storage.map.get('grooveScribe.libraryOpen')).toBe('true');
    expect(storage.map.get('grooveScribe.panelTab')).toBe('grooves');
    panel.close();
    expect(storage.map.get('grooveScribe.libraryOpen')).toBe('false');
  });

  it('calls onShow each time a tab becomes visible', () => {
    setUp();
    const panel = createSidePanel({ tabs: ALL_TABS });
    const shown = vi.fn();
    panel.onShow(shown);
    panel.show('grooves');
    panel.show('grooves');
    panel.show('library', { byUser: false });
    expect(shown.mock.calls).toEqual([
      ['grooves', { byUser: true }],
      ['library', { byUser: false }],
    ]);
  });

  it('start opens the docked panel on the stored tab', () => {
    setUp({ stored: { 'grooveScribe.libraryOpen': 'true', 'grooveScribe.panelTab': 'grooves' } });
    const panel = createSidePanel({ tabs: ALL_TABS });
    const shown = vi.fn();
    panel.onShow(shown);
    panel.start({ defaultOpen: false, defaultTab: 'library' });
    expect(panel.activeTab()).toBe('grooves');
    expect(shown).toHaveBeenCalledWith('grooves', { byUser: false });
  });

  it('start keeps an old library user on the Library tab', () => {
    setUp({ stored: { 'grooveScribe.libraryOpen': 'true' } });
    const panel = createSidePanel({ tabs: ALL_TABS });
    panel.start({ defaultOpen: false, defaultTab: 'library' });
    expect(panel.activeTab()).toBe('library');
  });

  it('start opens by default only when nothing is stored', () => {
    setUp();
    const opens = createSidePanel({ tabs: ALL_TABS });
    opens.start({ defaultOpen: true, defaultTab: 'grooves' });
    expect(opens.activeTab()).toBe('grooves');

    document.body.innerHTML = '<span id="upperLeft"></span>';
    setUp({ stored: { 'grooveScribe.libraryOpen': 'false' } });
    const staysClosed = createSidePanel({ tabs: ALL_TABS });
    staysClosed.start({ defaultOpen: true, defaultTab: 'grooves' });
    expect(staysClosed.isOpen()).toBe(false);
  });

  it('start opens nothing in overlay mode', () => {
    setUp({
      docked: false,
      stored: { 'grooveScribe.libraryOpen': 'true', 'grooveScribe.panelTab': 'grooves' },
    });
    const panel = createSidePanel({ tabs: ALL_TABS });
    const shown = vi.fn();
    panel.onShow(shown);
    panel.start({ defaultOpen: true, defaultTab: 'grooves' });
    expect(panel.isOpen()).toBe(false);
    expect(shown).not.toHaveBeenCalled();
    expect(bodyOpen()).toBe(false);
  });

  it('closes on a turn to overlay and comes back on a turn to docked', () => {
    setUp();
    const panel = createSidePanel({ tabs: ALL_TABS });
    panel.start({ defaultOpen: false, defaultTab: 'grooves' });
    panel.show('permutations');
    const shown = vi.fn();
    panel.onShow(shown);

    media.set(false);
    expect(panel.isOpen()).toBe(false);
    expect(panel.isDocked()).toBe(false);
    expect(bodyOpen()).toBe(false);
    // The turn is not a choice of the user: the docked panel stays remembered as open.
    expect(storage.map.get('grooveScribe.libraryOpen')).toBe('true');

    media.set(true);
    expect(panel.activeTab()).toBe('permutations');
    expect(shown).toHaveBeenCalledWith('permutations', { byUser: false });
  });

  it('stays closed on a turn to docked when the docked panel was closed', () => {
    setUp();
    const panel = createSidePanel({ tabs: ALL_TABS });
    panel.start({ defaultOpen: false, defaultTab: 'grooves' });
    media.set(false);
    // An overlay panel that opens and closes does not change the docked choice.
    panel.show('grooves');
    panel.close();
    media.set(true);
    expect(panel.isOpen()).toBe(false);
  });

  it('works without a library tab', () => {
    setUp({ stored: { 'grooveScribe.panelTab': 'library' } });
    const panel = createSidePanel({ tabs: [PERMUTATIONS, GROOVES] });
    expect([...document.querySelectorAll('#upperLeft button')].map((b) => b.id)).toEqual([
      'permutationsTab',
      'groovesTab',
    ]);
    panel.start({ defaultOpen: true, defaultTab: 'grooves' });
    expect(panel.activeTab()).toBe('grooves');
    expect(document.getElementById('libraryPanel')).toBeNull();
  });

  // The library panel owns grooveScribe.libraryOpen until the library is a tab of the side panel.
  it('does not touch grooveScribe.libraryOpen without a library tab', () => {
    setUp({ stored: { 'grooveScribe.libraryOpen': 'true', 'grooveScribe.panelTab': 'grooves' } });
    const getItem = vi.spyOn(storage, 'getItem');
    const setItem = vi.spyOn(storage, 'setItem');
    const panel = createSidePanel({ tabs: [PERMUTATIONS, GROOVES] });
    panel.start({ defaultOpen: false, defaultTab: 'grooves' });
    // The stored value is the library's: the docked panel starts closed.
    expect(panel.isOpen()).toBe(false);
    panel.show('grooves');
    panel.close();
    const keys = (spy) => spy.mock.calls.map(([key]) => key);
    expect(keys(getItem)).not.toContain('grooveScribe.libraryOpen');
    expect(keys(setItem)).not.toContain('grooveScribe.libraryOpen');
    expect(storage.map.get('grooveScribe.libraryOpen')).toBe('true');
    expect(storage.map.get('grooveScribe.panelTab')).toBe('grooves');
  });

  it('without a library tab, a docked panel the user left open comes back after a turn', () => {
    setUp();
    const panel = createSidePanel({ tabs: [PERMUTATIONS, GROOVES] });
    panel.start({ defaultOpen: false, defaultTab: 'grooves' });
    panel.show('grooves');
    media.set(false);
    expect(panel.isOpen()).toBe(false);
    media.set(true);
    expect(panel.activeTab()).toBe('grooves');
  });

  it('afterPick closes the overlay and focuses the tab, and blurs when docked', () => {
    setUp({ docked: false });
    const panel = createSidePanel({ tabs: ALL_TABS });
    panel.show('grooves');
    // An overlay panel is a dialog: focus goes into it.
    expect(document.activeElement?.id).toBe('sidePanelClose');
    // A key picked the item, so the focus goes back to the tab.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    panel.afterPick();
    expect(panel.isOpen()).toBe(false);
    expect(document.activeElement).toBe(tab('grooves'));

    media.set(true);
    panel.show('grooves');
    // A docked panel is not a dialog: focus stays on the page.
    expect(document.activeElement).toBe(tab('grooves'));
    const item = document.createElement('button');
    panel.section('grooves').append(item);
    item.focus();
    panel.afterPick();
    expect(panel.activeTab()).toBe('grooves');
    expect(document.activeElement).toBe(document.body);
  });

  it('Escape closes an overlay panel, but not a docked one', () => {
    setUp({ docked: false });
    const panel = createSidePanel({ tabs: ALL_TABS });
    panel.show('grooves');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.isOpen()).toBe(false);

    media.set(true);
    panel.show('grooves');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.isOpen()).toBe(true);
  });

  it('keeps the editor hotkeys out of the panel', () => {
    setUp();
    const panel = createSidePanel({ tabs: ALL_TABS });
    panel.show('grooves');
    const hotkey = vi.fn();
    document.addEventListener('keydown', hotkey);
    panel
      .section('grooves')
      .dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    document.removeEventListener('keydown', hotkey);
    expect(hotkey).not.toHaveBeenCalled();
  });

  it('a click on the backdrop closes the panel', () => {
    setUp({ docked: false });
    const panel = createSidePanel({ tabs: ALL_TABS });
    panel.show('grooves');
    document.getElementById('sidePanelBackdrop')?.click();
    expect(panel.isOpen()).toBe(false);
  });

  it('survives storage that throws', () => {
    setUp();
    const broken = () => {
      throw new Error('storage is off');
    };
    vi.stubGlobal('localStorage', { getItem: broken, setItem: broken, removeItem: broken });
    const panel = createSidePanel({ tabs: ALL_TABS });
    expect(() => panel.start({ defaultOpen: true, defaultTab: 'grooves' })).not.toThrow();
    expect(panel.activeTab()).toBe('grooves');
    expect(() => panel.toggle('library')).not.toThrow();
    expect(panel.activeTab()).toBe('library');
    expect(() => panel.close()).not.toThrow();
    expect(panel.isOpen()).toBe(false);
  });
});
