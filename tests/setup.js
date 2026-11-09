// Global test setup, run once per test file before any tests (see
// vitest.config.js `setupFiles`).
//
// The jsdom environment already provides `window`, `document`, `navigator`,
// `localStorage`, etc. Here we add the few browser APIs the Groove Scribe
// sources touch that jsdom does not implement, so that unmodified production
// code can be loaded and exercised without throwing at import time.

import { vi, beforeEach, afterEach } from 'vitest';

// jsdom does not implement matchMedia; some display code queries it.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// jsdom does not implement scrollTo.
if (!window.scrollTo) {
  window.scrollTo = vi.fn();
}

// Keep every test isolated from any DOM one of its predecessors may have built.
beforeEach(() => {
  document.body.innerHTML = '';
});

// Production code starts timers (a 1 s scrollTo on touch devices, a 100 ms
// context-menu handler, a 300 ms tempo-URL update) that a test rarely waits for.
// A timer that is still pending when the test file ends can fire after Vitest
// has torn down jsdom. `window` is gone by then, so the callback throws
// "window is not defined" and Vitest fails the whole run, at random.
// Record every timer a test starts and cancel the leftovers after each test.
const pendingTimers = { timeouts: new Set(), intervals: new Set() };
const realSetTimeout = globalThis.setTimeout;
const realSetInterval = globalThis.setInterval;
const realClearTimeout = globalThis.clearTimeout;
const realClearInterval = globalThis.clearInterval;

globalThis.setTimeout = function (...args) {
  const id = realSetTimeout.apply(this, args);
  pendingTimers.timeouts.add(id);
  return id;
};
globalThis.setInterval = function (...args) {
  const id = realSetInterval.apply(this, args);
  pendingTimers.intervals.add(id);
  return id;
};

afterEach(() => {
  pendingTimers.timeouts.forEach((id) => realClearTimeout(id));
  pendingTimers.timeouts.clear();
  pendingTimers.intervals.forEach((id) => realClearInterval(id));
  pendingTimers.intervals.clear();
});
