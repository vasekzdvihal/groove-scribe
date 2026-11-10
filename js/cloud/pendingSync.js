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
  let hasPendingRows = false;
  let firstUpdateDone = false;
  // A queued delete leaves no row to mark it, so count every write the server has not answered.
  let unansweredWrites = 0;

  // Only the memory cache loses a queued write when the tab closes.
  function updateLeaveWarning() {
    const canLose = !persistent && isActive() && (hasPendingRows || unansweredWrites > 0);
    if (canLose) window.addEventListener('beforeunload', warnBeforeLeaving);
    else window.removeEventListener('beforeunload', warnBeforeLeaving);
  }

  // In a tab that started after a write was queued, the SDK wait can hang. The cache says when
  // the write is gone, so check it now and then.
  function untilCacheIsClear() {
    return new Promise((resolve) => {
      endCacheCheck = resolve;
      checkTimer = setInterval(async () => {
        try {
          if (unansweredWrites === 0 && !(await readHasPending())) resolve();
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
  // starts the next wait, from changeRan or from the pending row in the update after it.
  async function follow() {
    if (waiting) return;
    waiting = true;
    let confirmed;
    try {
      confirmed = await Promise.race([
        waitForServer().then(() => true),
        untilCacheIsClear().then(() => false),
      ]);
    } catch (error) {
      // The SDK rejects the wait when the user changes. The new session has its own waiter.
      console.warn('Stopped waiting for the sync:', error);
      return;
    } finally {
      clearInterval(checkTimer);
      waiting = false;
    }
    if (!isActive()) return;
    // A write made during the wait is not covered by it.
    if (confirmed && unansweredWrites === 0) writePendingWritesFlag(false);
    await onSynced();
  }

  function update(items) {
    hasPendingRows = items.some(isPending);
    updateLeaveWarning();
    // A delete from an earlier visit shows no row, and only the wait can clear its flag.
    const inherited = !firstUpdateDone && persistent && readPendingWritesFlag();
    firstUpdateDone = true;
    if (hasPendingRows) {
      if (persistent) writePendingWritesFlag(true);
      startSlowTimer();
    } else {
      clearTimeout(slowTimer);
      slowTimer = null;
      slow = false;
    }
    if (hasPendingRows || inherited) follow();
  }

  // A change ran. It may have queued a write that no row shows, such as a delete.
  function changeRan(written) {
    if (persistent) writePendingWritesFlag(true);
    if (written) {
      unansweredWrites += 1;
      const answered = () => {
        unansweredWrites -= 1;
        updateLeaveWarning();
      };
      written.committed.then(answered, answered);
    }
    updateLeaveWarning();
    follow();
  }

  // After a wait that may not have covered everything: a server answer with no pending row and
  // no unanswered write says the device has nothing left to send.
  function forgetIfSynced(...answers) {
    const fromServer = answers.every((answer) => !answer.fromCache);
    if (
      fromServer &&
      unansweredWrites === 0 &&
      !answers.some((answer) => answer.items.some(isPending))
    ) {
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

  return { update, changeRan, isSlow: () => slow, forgetIfSynced, stop };
}
