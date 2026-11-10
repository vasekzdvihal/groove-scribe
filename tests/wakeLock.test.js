import { describe, it, expect, vi } from 'vitest';
import { createWakeLock, RELEASE_DELAY_MS } from '../js/wakeLock.js';

const flush = () => new Promise((r) => setImmediate(r));

function setup({ supported = true, request } = {}) {
  const timers = [];
  const sentinels = [];
  const docListeners = {};
  const document = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => (docListeners[type] = fn),
  };
  const makeSentinel = () => {
    const listeners = {};
    const s = {
      released: false,
      addEventListener: (t, fn) => (listeners[t] = fn),
      release: vi.fn(async () => {
        s.released = true;
        listeners.release?.();
      }),
      // The browser releases the lock by itself, for example when the tab is hidden.
      browserRelease() {
        s.released = true;
        listeners.release?.();
      },
    };
    sentinels.push(s);
    return s;
  };
  const navigator = supported
    ? { wakeLock: { request: vi.fn(request ?? (async () => makeSentinel())) } }
    : {};
  const wl = createWakeLock({
    navigator,
    document,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms, cleared: false });
      return timers.length - 1;
    },
    clearTimeout: (id) => {
      if (timers[id]) timers[id].cleared = true;
    },
  });
  const pending = () => timers.filter((t) => !t.cleared);
  const hide = () => ((document.visibilityState = 'hidden'), docListeners.visibilitychange());
  const show = () => ((document.visibilityState = 'visible'), docListeners.visibilitychange());
  return { wl, navigator, sentinels, timers, pending, hide, show };
}

describe('wake lock', () => {
  it('acquires on play', async () => {
    const t = setup();
    t.wl.onPlay();
    await flush();
    expect(t.navigator.wakeLock.request).toHaveBeenCalledWith('screen');
  });

  it('releases 10 minutes after stop, not before', async () => {
    const t = setup();
    t.wl.onPlay();
    await flush();
    t.wl.onStop();
    expect(t.pending()).toHaveLength(1);
    expect(t.pending()[0].ms).toBe(10 * 60 * 1000);
    expect(RELEASE_DELAY_MS).toBe(600000);
    expect(t.sentinels[0].release).not.toHaveBeenCalled();
    t.pending()[0].fn();
    expect(t.sentinels[0].release).toHaveBeenCalledOnce();
  });

  it('keeps the lock when play starts again inside the window', async () => {
    const t = setup();
    t.wl.onPlay();
    await flush();
    t.wl.onStop();
    t.wl.onPlay();
    await flush();
    expect(t.pending()).toHaveLength(0);
    expect(t.sentinels[0].release).not.toHaveBeenCalled();
    expect(t.navigator.wakeLock.request).toHaveBeenCalledOnce();
  });

  it('does not request twice for two quick plays', async () => {
    const t = setup();
    t.wl.onPlay();
    t.wl.onPlay();
    await flush();
    expect(t.navigator.wakeLock.request).toHaveBeenCalledOnce();
  });

  it('acquires again on return to the tab while playing', async () => {
    const t = setup();
    t.wl.onPlay();
    await flush();
    t.hide();
    t.sentinels[0].browserRelease();
    t.show();
    await flush();
    expect(t.navigator.wakeLock.request).toHaveBeenCalledTimes(2);
  });

  it('acquires again on return inside the 10 minute window, not after it', async () => {
    const t = setup();
    t.wl.onPlay();
    await flush();
    t.wl.onStop();
    t.sentinels[0].browserRelease();
    t.show();
    await flush();
    expect(t.navigator.wakeLock.request).toHaveBeenCalledTimes(2);
    t.pending()[0].fn(); // window ends
    t.sentinels[1].browserRelease();
    t.show();
    await flush();
    expect(t.navigator.wakeLock.request).toHaveBeenCalledTimes(2);
  });

  it('does not re-acquire on return when never played', async () => {
    const t = setup();
    t.show();
    await flush();
    expect(t.navigator.wakeLock.request).not.toHaveBeenCalled();
  });

  it('treats a release by the browser as released, so play can request again', async () => {
    const t = setup();
    t.wl.onPlay();
    await flush();
    t.sentinels[0].browserRelease();
    t.wl.onPlay();
    await flush();
    expect(t.navigator.wakeLock.request).toHaveBeenCalledTimes(2);
  });

  it('is silent when a request is rejected', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const t = setup({
      request: async () => {
        throw new DOMException('hidden', 'NotAllowedError');
      },
    });
    expect(() => t.wl.onPlay()).not.toThrow();
    await flush();
    t.wl.onStop();
    t.wl.onPlay();
    await flush();
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(t.navigator.wakeLock.request).toHaveBeenCalledTimes(2);
  });

  it('is silent when request throws at once', () => {
    const t = setup({
      request: () => {
        throw new Error('nope');
      },
    });
    expect(() => t.wl.onPlay()).not.toThrow();
  });

  it('releases a lock that arrives after the window ended', async () => {
    let resolve;
    const t = setup({ request: () => new Promise((r) => (resolve = r)) });
    t.wl.onPlay();
    t.wl.onStop();
    t.pending()[0].fn();
    const late = { release: vi.fn(async () => {}), addEventListener() {} };
    resolve(late);
    await flush();
    expect(late.release).toHaveBeenCalledOnce();
  });

  it('does nothing when unsupported', async () => {
    const t = setup({ supported: false });
    expect(() => {
      t.wl.onPlay();
      t.wl.onStop();
      t.pending()[0].fn();
      t.show();
    }).not.toThrow();
  });
});
