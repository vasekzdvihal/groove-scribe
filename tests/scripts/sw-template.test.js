import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import vm from 'node:vm';
import { renderServiceWorker } from '../../scripts/build-www.mjs';

// Runs the real generated worker against small fakes of the Cache and fetch APIs. The e2e
// spec proves the happy paths in Chromium. These tests cover what a browser test cannot
// force: a failed precache, an opaque response, a hung network.

const ORIGIN = 'https://app.test';
const url = (path) => `${ORIGIN}/${path}`;
const CURRENT = 'groove-scribe-precache-v2';
const OLD = 'groove-scribe-precache-v1';
const FILES = ['index.html', 'js/main.js'];

function response(body, overrides = {}) {
  return {
    body,
    ok: true,
    status: 200,
    type: 'basic',
    redirected: false,
    clone() {
      return this;
    },
    ...overrides,
  };
}

function makeCache() {
  const entries = new Map();
  const keyOf = (request) => (typeof request === 'string' ? request : request.url);
  return {
    entries,
    match: async (request) => entries.get(keyOf(request)),
    put: async (request, value) => {
      entries.set(keyOf(request), value);
    },
  };
}

function makeWorld() {
  const stores = new Map();
  const world = {
    stores,
    listeners: {},
    requests: [],
    respond: (request) => {
      throw new Error(`unexpected fetch: ${request.url}`);
    },
    skipWaiting: vi.fn(async () => {}),
    claim: vi.fn(async () => {}),
    open(name) {
      if (!stores.has(name)) stores.set(name, makeCache());
      return stores.get(name);
    },
  };
  class FakeRequest {
    constructor(input, init = {}) {
      this.url = typeof input === 'string' ? input : input.url;
      this.mode = input.mode;
      this.method = input.method ?? 'GET';
      this.cache = init.cache;
    }
  }
  const sandbox = {
    URL,
    Request: FakeRequest,
    setTimeout: (...args) => setTimeout(...args),
    fetch: async (request) => {
      world.requests.push(request);
      return world.respond(request);
    },
    caches: {
      open: async (name) => world.open(name),
      delete: async (name) => stores.delete(name),
      keys: async () => [...stores.keys()],
    },
  };
  sandbox.self = {
    location: new URL(url('sw.js')),
    addEventListener: (type, listener) => {
      world.listeners[type] = listener;
    },
    skipWaiting: world.skipWaiting,
    clients: { claim: world.claim },
  };
  vm.runInNewContext(renderServiceWorker('v2', FILES), sandbox);
  return world;
}

/** Fires an install or activate event and resolves with its waitUntil outcome. */
function lifecycle(world, type) {
  let done;
  world.listeners[type]({
    waitUntil: (promise) => {
      done = promise;
    },
  });
  return done;
}

/** Fires a fetch event. `handled` is false when the worker leaves the request to the browser. */
function dispatchFetch(world, request) {
  const event = {
    request: { method: 'GET', mode: 'no-cors', ...request },
    pending: [],
    handled: false,
    respondWith(promise) {
      event.handled = true;
      event.result = promise;
    },
    waitUntil(promise) {
      event.pending.push(promise);
    },
  };
  world.listeners.fetch(event);
  return event;
}

const navigate = (world, path) => dispatchFetch(world, { url: url(path), mode: 'navigate' });
const settled = (event) => Promise.all(event.pending);

describe('install', () => {
  let world;
  beforeEach(() => {
    world = makeWorld();
    world.open(OLD).entries.set(url('index.html'), response('old'));
  });

  it('stores every file, bypasses the HTTP cache, then takes over', async () => {
    world.respond = (request) => response(`new ${request.url}`);
    await lifecycle(world, 'install');
    expect([...world.stores.get(CURRENT).entries.keys()]).toEqual(FILES.map(url));
    expect(world.requests.map((request) => request.cache)).toEqual(['reload', 'reload']);
    expect(world.skipWaiting).toHaveBeenCalledOnce();
  });

  it.each([
    ['a network error', () => Promise.reject(new TypeError('offline'))],
    ['a 404', () => response('nope', { ok: false, status: 404 })],
    ['a redirect', () => response('portal', { redirected: true })],
    ['an opaque response', () => response('', { ok: false, status: 0, type: 'opaque' })],
  ])('leaves no new cache and does not take over after %s', async (_name, fail) => {
    world.respond = (request) => (request.url.endsWith('main.js') ? fail() : response('ok'));
    await expect(lifecycle(world, 'install')).rejects.toBeDefined();
    expect(world.stores.has(CURRENT)).toBe(false);
    expect(world.stores.has(OLD)).toBe(true);
    expect(world.skipWaiting).not.toHaveBeenCalled();
  });
});

describe('activate', () => {
  it('deletes older versions of this cache only, then claims the pages', async () => {
    const world = makeWorld();
    for (const name of [OLD, CURRENT, 'some-other-cache']) world.open(name);
    await lifecycle(world, 'activate');
    expect([...world.stores.keys()]).toEqual([CURRENT, 'some-other-cache']);
    expect(world.claim).toHaveBeenCalledOnce();
  });
});

describe('fetch: requests the worker must not touch', () => {
  it.each([
    ['a POST', { url: url('js/main.js'), method: 'POST' }],
    ['a cross-origin request', { url: 'https://firestore.googleapis.com/v1/x' }],
    ['Firebase sign-in', { url: url('__/auth/handler?x=1'), mode: 'navigate' }],
    ['the Firebase auth iframe', { url: url('__/auth/iframe') }],
  ])('leaves %s to the browser', (_name, request) => {
    const world = makeWorld();
    expect(dispatchFetch(world, request).handled).toBe(false);
  });
});

describe('fetch: navigations use the network first', () => {
  let world;
  beforeEach(() => {
    world = makeWorld();
    world.open(CURRENT).entries.set(url('index.html'), response('cached page'));
  });

  it('returns the fresh page and stores it without the groove query', async () => {
    world.respond = () => response('fresh page');
    const event = navigate(world, 'index.html?TimeSig=4/4');
    expect((await event.result).body).toBe('fresh page');
    await settled(event);
    expect(world.requests[0].cache).toBe('reload');
    expect([...world.stores.get(CURRENT).entries.keys()]).toEqual([url('index.html')]);
    expect(world.stores.get(CURRENT).entries.get(url('index.html')).body).toBe('fresh page');
  });

  it.each(['index.html?TimeSig=4/4&H=|x|', 'index.html', ''])(
    'serves the cached page offline for "%s"',
    async (path) => {
      world.respond = () => Promise.reject(new TypeError('offline'));
      expect((await navigate(world, path).result).body).toBe('cached page');
    }
  );

  it('serves the cached page and stores nothing on a server error', async () => {
    world.respond = () => response('error page', { ok: false, status: 503 });
    const event = navigate(world, 'index.html');
    expect((await event.result).body).toBe('cached page');
    await settled(event);
    expect(world.stores.get(CURRENT).entries.get(url('index.html')).body).toBe('cached page');
  });

  describe('when the network hangs', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('serves the cached page after the timeout', async () => {
      world.respond = () => new Promise(() => {});
      const event = navigate(world, 'index.html');
      await vi.advanceTimersByTimeAsync(3000);
      expect((await event.result).body).toBe('cached page');
    });
  });

  it('fails like the network when the page is not cached', async () => {
    world.stores.get(CURRENT).entries.clear();
    world.respond = () => Promise.reject(new TypeError('offline'));
    await expect(navigate(world, 'index.html').result).rejects.toThrow('offline');
  });
});

describe('fetch: other files use the cache and refresh in the background', () => {
  let world;
  const asset = url('js/main.js');
  const fetchAsset = () => dispatchFetch(world, { url: asset });
  const stored = () => world.stores.get(CURRENT).entries.get(asset)?.body;

  beforeEach(() => {
    world = makeWorld();
    world.open(CURRENT).entries.set(asset, response('cached'));
  });

  it('returns the cached file and stores the refreshed one', async () => {
    world.respond = () => response('refreshed');
    const event = fetchAsset();
    expect((await event.result).body).toBe('cached');
    await settled(event);
    expect(world.requests[0].cache).toBe('reload');
    expect(stored()).toBe('refreshed');
  });

  it('keeps the response and the cached file when the refresh fails', async () => {
    world.respond = () => Promise.reject(new TypeError('offline'));
    const event = fetchAsset();
    expect((await event.result).body).toBe('cached');
    await expect(settled(event)).resolves.toBeDefined();
    expect(stored()).toBe('cached');
  });

  it.each([
    ['a 404', () => response('nope', { ok: false, status: 404 })],
    ['an opaque response', () => response('', { ok: false, status: 0, type: 'opaque' })],
    ['a redirect', () => response('portal', { redirected: true })],
  ])('does not store %s', async (_name, fail) => {
    world.respond = fail;
    const event = fetchAsset();
    await event.result;
    await settled(event);
    expect(stored()).toBe('cached');
  });

  it('keeps the response when the cache cannot store the refreshed file', async () => {
    world.respond = () => response('refreshed');
    world.stores.get(CURRENT).put = () => Promise.reject(new Error('quota'));
    const event = fetchAsset();
    expect((await event.result).body).toBe('cached');
    await expect(settled(event)).resolves.toBeDefined();
  });

  it('fetches and stores a file that is not cached yet', async () => {
    world.stores.get(CURRENT).entries.clear();
    world.respond = () => response('from network');
    const event = fetchAsset();
    expect((await event.result).body).toBe('from network');
    await settled(event);
    expect(stored()).toBe('from network');
  });

  it('treats a query string as a different file', async () => {
    world.respond = () => response('other');
    const event = dispatchFetch(world, { url: `${asset}?v=2` });
    expect((await event.result).body).toBe('other');
  });

  it('fails like the network when the file is not cached', async () => {
    world.stores.get(CURRENT).entries.clear();
    world.respond = () => Promise.reject(new TypeError('offline'));
    await expect(fetchAsset().result).rejects.toThrow('offline');
  });
});
