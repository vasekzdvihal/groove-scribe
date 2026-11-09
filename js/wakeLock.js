// Keeps the screen on while a groove plays, and for a while after it stops.
// A drummer practises from a tablet or phone and pauses between exercises, so the lock
// is released 10 minutes after stop or pause. Play cancels that timer.
// Everything the module touches is injected, so tests need no browser.

export const RELEASE_DELAY_MS = 10 * 60 * 1000;

/**
 * @param {{navigator: any, document: any, setTimeout: Function, clearTimeout: Function}} env
 * @returns {{onPlay: () => void, onStop: () => void}}
 */
export function createWakeLock({ navigator, document, setTimeout, clearTimeout }) {
  let sentinel = null; // the lock we hold
  let requesting = false; // a request is in flight
  let playing = false;
  let timer = null; // pending release timer

  const supported = () => !!(navigator && navigator.wakeLock && navigator.wakeLock.request);
  const wanted = () => playing || timer !== null;

  function drop(lock) {
    try {
      Promise.resolve(lock.release()).catch(() => {});
    } catch {
      // Releasing a lock that is already gone is fine.
    }
  }

  function acquire() {
    if (!supported() || sentinel || requesting) return;
    requesting = true;
    let pending;
    try {
      pending = Promise.resolve(navigator.wakeLock.request('screen'));
    } catch {
      requesting = false;
      return;
    }
    pending.then(
      (lock) => {
        requesting = false;
        if (!wanted()) {
          drop(lock);
          return;
        }
        sentinel = lock;
        if (lock.addEventListener) {
          lock.addEventListener('release', () => {
            if (sentinel === lock) sentinel = null;
          });
        }
      },
      () => {
        // Refused: page hidden, low battery or no gesture. Playback goes on.
        requesting = false;
      }
    );
  }

  function release() {
    if (!sentinel) return;
    const lock = sentinel;
    sentinel = null;
    drop(lock);
  }

  function cancelTimer() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function onPlay() {
    playing = true;
    cancelTimer();
    acquire();
  }

  function onStop() {
    playing = false;
    cancelTimer();
    timer = setTimeout(() => {
      timer = null;
      release();
    }, RELEASE_DELAY_MS);
  }

  // The browser drops the lock when the tab is hidden. Take it again on return.
  if (document && document.addEventListener) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && wanted()) acquire();
    });
  }

  return { onPlay, onStop };
}
