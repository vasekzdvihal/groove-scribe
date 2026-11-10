import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connectCloud, resolveCloudConfig } from '../../js/cloud/firebaseClient.js';

vi.mock('../../js/vendor/firebase.js', () => ({
  initializeApp: vi.fn(() => 'app'),
  getAuth: vi.fn(() => 'auth'),
  persistentLocalCache: vi.fn(() => 'persistent cache'),
  persistentMultipleTabManager: vi.fn(() => 'tabs'),
  initializeFirestore: vi.fn(() => 'db'),
}));

const REAL = { projectId: 'real' };

describe('resolveCloudConfig', () => {
  it('returns null when no project is connected', () => {
    expect(resolveCloudConfig({ hostname: 'example.com', search: '' }, null)).toBeNull();
  });

  it('uses the real project by default', () => {
    expect(resolveCloudConfig({ hostname: 'localhost', search: '' }, REAL)).toEqual({
      useEmulator: false,
      config: REAL,
    });
  });

  it('uses the emulator on localhost with ?emulator=1', () => {
    const result = resolveCloudConfig({ hostname: '127.0.0.1', search: '?emulator=1' }, REAL);
    expect(result.useEmulator).toBe(true);
    expect(result.config.projectId).toBe('demo-groovescribe');
  });

  it('ignores ?emulator=1 on a public host', () => {
    expect(resolveCloudConfig({ hostname: 'example.com', search: '?emulator=1' }, REAL)).toEqual({
      useEmulator: false,
      config: REAL,
    });
  });
});

describe('connectCloud', () => {
  const connect = () => connectCloud({ config: REAL, useEmulator: false });

  function setStorage(storage) {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: storage });
  }

  // An IndexedDB that opens, as far as the probe can tell.
  function workingIndexedDb() {
    return {
      open: () => {
        const probe = { result: { close: vi.fn() } };
        queueMicrotask(() => probe.onsuccess());
        return probe;
      },
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    delete navigator.storage;
  });

  describe('a storage probe that never answers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubGlobal('indexedDB', { open: () => ({}) });
    });

    it('falls back to the memory cache after about 3 s', async () => {
      let result;
      connect().then((connected) => (result = connected));
      await vi.dynamicImportSettled();
      await vi.advanceTimersByTimeAsync(2900);
      expect(result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(200);
      expect(result.persistent).toBe(false);
    });
  });

  describe('durable storage', () => {
    it('asks once when the cache is persistent', async () => {
      const persist = vi.fn(async () => true);
      vi.stubGlobal('indexedDB', workingIndexedDb());
      setStorage({ persist });
      expect((await connect()).persistent).toBe(true);
      expect(persist).toHaveBeenCalledOnce();
    });

    it('does not ask for the memory cache', async () => {
      const persist = vi.fn(async () => true);
      setStorage({ persist });
      expect((await connect()).persistent).toBe(false);
      expect(persist).not.toHaveBeenCalled();
    });

    it('works in a browser without navigator.storage', async () => {
      vi.stubGlobal('indexedDB', workingIndexedDb());
      expect((await connect()).persistent).toBe(true);
    });

    it('ignores a refusal', async () => {
      vi.stubGlobal('indexedDB', workingIndexedDb());
      setStorage({ persist: () => Promise.reject(new Error('refused')) });
      await expect(connect()).resolves.toMatchObject({ persistent: true });
    });
  });
});
