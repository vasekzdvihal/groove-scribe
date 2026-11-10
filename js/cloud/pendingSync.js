// Follows the writes that wait for the server: the flag that reloads the SDK on the next visit,
// the wait for the sync, the slow timer, and the warning before a memory-only write is lost.

const PENDING_WRITES_KEY = 'grooveScribe.pendingWrites';
const SYNC_SLOW_AFTER_MS = 1500;
const SYNC_CHECK_EVERY_MS = 5000;

export const isPending = (item) => item.hasPendingWrites;

// The SDK sends queued writes only after it loads. This flag loads it on the next visit, also
// when the panel stays closed. Queued writes in the memory cache do not reach the next visit.
export function readPendingWritesFlag() {
  try {
    return localStorage.getItem(PENDING_WRITES_KEY) !== null;
  } catch {
    return false;
  }
}

export function writePendingWritesFlag(isSet) {
  try {
    if (isSet) localStorage.setItem(PENDING_WRITES_KEY, 'true');
    else localStorage.removeItem(PENDING_WRITES_KEY);
  } catch {
    /* the queued writes wait until the panel opens */
  }
}

function warnBeforeLeaving(event) {
  event.preventDefault();
  event.returnValue = '';
}

/**
 * @param {object} options
 * @param {function(): Promise<unknown>} options.waitForServer  Settles when the server has
 *        answered every write queued so far.
 * @param {function(): Promise<boolean>} options.readHasPending  Does the cache show a queued write?
 * @param {boolean} options.persistent  Queued writes survive the tab.
 * @param {function(): boolean} options.isActive  Is this session still the current one?
 * @param {function(): Promise<void>} options.onSynced  Runs when the wait ends.
 * @param {function(): void} options.onSlow  Runs when the sync takes long enough to mention.
 */
export function createPendingSync({
  waitForServer,
  readHasPending,
  persistent,
  isActive,
  onSynced,
  onSlow,
}) {
  let waiting = false;
  let slow = false;
  let slowTimer = null;
  let checkTimer = null;
  let endCacheCheck = null;

  // In a tab that started after a write was queued, the SDK wait can hang. The cache says when
  // the write is gone, so check it now and then.
  function untilCacheIsClear() {
    return new Promise((resolve) => {
      endCacheCheck = resolve;
      checkTimer = setInterval(async () => {
        try {
          if (!(await readHasPending())) resolve();
        } catch (error) {
          console.warn('The library cache could not be read:', error);
        }
      }, SYNC_CHECK_EVERY_MS);
    });
  }

  // On a good connection the sync ends before anyone can read the label.
  function startSlowTimer() {
    if (slowTimer || slow) return;
    slowTimer = setTimeout(() => {
      slowTimer = null;
      slow = true;
      onSlow();
    }, SYNC_SLOW_AFTER_MS);
  }

  // One waiter per session. The wait covers every write queued so far. A write queued later
  // shows as a pending row in the update after it, and that starts the next wait.
  async function follow() {
    if (waiting) return;
    waiting = true;
    startSlowTimer();
    try {
      await Promise.race([waitForServer(), untilCacheIsClear()]);
    } catch (error) {
      // The SDK rejects the wait when the user changes. The new session has its own waiter.
      console.warn('Stopped waiting for the sync:', error);
      return;
    } finally {
      clearInterval(checkTimer);
      waiting = false;
    }
    if (isActive()) await onSynced();
  }

  function update(items) {
    const pending = items.some(isPending);
    // Only the memory cache loses a queued write when the tab closes.
    if (pending && !persistent) window.addEventListener('beforeunload', warnBeforeLeaving);
    else window.removeEventListener('beforeunload', warnBeforeLeaving);
    if (pending) {
      if (persistent) writePendingWritesFlag(true);
      follow();
    } else {
      clearTimeout(slowTimer);
      slowTimer = null;
      slow = false;
    }
  }

  // A server answer with no pending row: the device has nothing left to send.
  function forgetIfSynced(...answers) {
    const fromServer = answers.every((answer) => !answer.fromCache);
    if (fromServer && !answers.some((answer) => answer.items.some(isPending))) {
      writePendingWritesFlag(false);
    }
  }

  // The session is over: nothing may keep running for it.
  function stop() {
    clearInterval(checkTimer);
    clearTimeout(slowTimer);
    endCacheCheck?.();
    window.removeEventListener('beforeunload', warnBeforeLeaving);
  }

  return { update, isSlow: () => slow, forgetIfSynced, stop };
}
