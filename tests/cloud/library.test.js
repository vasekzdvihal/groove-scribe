import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLibrary } from '../../js/cloud/library.js';
import { connectCloud } from '../../js/cloud/firebaseClient.js';
import { initLibraryPanel } from '../../js/cloud/libraryPanel.js';
import { createDirtyState, watchDirty } from '../../js/cloud/dirtyState.js';

vi.mock('../../js/cloud/firebaseClient.js', () => ({
  resolveCloudConfig: () => ({ useEmulator: false, config: {} }),
  connectCloud: vi.fn(),
}));

const START = '?TimeSig=4/4&Div=16&Title=Start&Tempo=80&Measures=1&H=|xxxx|&S=|-O-O|&K=|o-o-|';
const BEAT = '?TimeSig=4/4&Div=16&Title=Beat&Tempo=95&Measures=1&H=|x-x-|&S=|--O-|&K=|o---|';
const SHUFFLE = BEAT.replace('Title=Beat', 'Title=Shuffle').replace('K=|o---|', 'K=|o-o-|');
const UID = 'ana';
const SERVER_TIME = Symbol('server time');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

// A Firestore with one device cache and one server, enough for library.js and the panel.
// Online, the server takes each write at once. Offline, a write stays pending: its row says
// so, its server times read as null, and its promise waits.
function createFakeSdk() {
  /** @type {Map<string, Map<string, {fields: object, order: number, pending: boolean}>>} */
  const collections = new Map([
    ['lessons', new Map()],
    ['grooves', new Map()],
    ['users', new Map()],
  ]);
  const calls = { getDocs: 0, getDocsFromCache: 0, signInWithPopup: 0 };
  let nextId = 0;
  let order = 0;
  let authListener = null;
  let serverHold = null;
  let syncWait = deferred();
  const popups = [];
  const fake = {
    online: true,
    // The next write is refused by the server: the cache drops it again.
    refuseNext: false,
    calls,
    collections,
    popups,
    // The next server list waits until the test lets it go. Its answer is the library as it
    // is when the list starts.
    holdServer() {
      serverHold = deferred();
      return serverHold;
    },
    // The SDK has heard back about every write.
    sync() {
      for (const docs of collections.values()) {
        for (const item of docs.values()) item.pending = false;
      }
      syncWait.resolve();
      syncWait = deferred();
    },
    signIn: (user) => authListener(user),
    hasAuthListener: () => authListener !== null,
    add(collection, id, fields) {
      collections
        .get(collection)
        .set(id, { fields: { ownerId: UID, ...fields }, order: ++order, pending: false });
    },
  };

  function write(ref, update) {
    const docs = collections.get(ref.collection);
    if (fake.refuseNext) {
      fake.refuseNext = false;
      const before = docs.get(ref.id);
      const changed = update(before);
      if (changed) docs.set(ref.id, { ...changed, pending: true });
      return Promise.reject(
        Object.assign(new Error('refused'), { code: 'permission-denied' })
      ).catch((error) => {
        if (before) docs.set(ref.id, before);
        else docs.delete(ref.id);
        throw error;
      });
    }
    const item = update(docs.get(ref.id));
    if (item) {
      item.pending = !fake.online;
      docs.set(ref.id, item);
    } else docs.delete(ref.id);
    return fake.online ? Promise.resolve() : new Promise(() => {});
  }

  function readValue(item, value) {
    if (value !== SERVER_TIME) return value;
    return item.pending ? null : `time ${item.order}`;
  }
  const readFields = (item) =>
    Object.fromEntries(
      Object.entries(item.fields).map(([key, value]) => [key, readValue(item, value)])
    );

  function snapshot({ collection, filters, sortField }, fromCache) {
    const docs = [...collections.get(collection)].filter(([, item]) =>
      filters.every(([field, value]) => item.fields[field] === value)
    );
    const sortValue = ([, item]) => (sortField === 'name' ? item.fields.name : item.order);
    docs.sort((a, b) => (sortValue(a) < sortValue(b) ? -1 : 1));
    return {
      metadata: { fromCache },
      docs: docs.map(([id, item]) => ({
        id,
        ref: { collection, id },
        data: () => readFields(item),
        metadata: { hasPendingWrites: item.pending },
      })),
    };
  }

  fake.sdk = {
    collection: (db, name) => ({ name }),
    doc: (parent, collection, id) =>
      collection === undefined
        ? { collection: parent.name, id: `${parent.name}-${++nextId}` }
        : { collection, id },
    query: (ref, ...parts) => ({
      collection: ref.name,
      filters: parts.filter((part) => part.where).map((part) => part.where),
      sortField: parts.find((part) => part.orderBy)?.orderBy,
    }),
    where: (field, op, value) => ({ where: [field, value] }),
    orderBy: (field) => ({ orderBy: field }),
    serverTimestamp: () => SERVER_TIME,
    async getDocs(query) {
      calls.getDocs += 1;
      const answer = snapshot(query, false);
      const hold = serverHold;
      serverHold = null;
      if (hold) await hold.promise;
      return answer;
    },
    async getDocsFromCache(query) {
      calls.getDocsFromCache += 1;
      return snapshot(query, true);
    },
    getDocsFromServer: async (query) => snapshot(query, false),
    getDoc: async (ref) => ({ exists: () => collections.get(ref.collection).has(ref.id) }),
    setDoc: (ref, fields) => write(ref, () => ({ fields: { ...fields }, order: ++order })),
    updateDoc: (ref, fields) =>
      write(ref, (item) => ({ ...item, fields: { ...item.fields, ...fields } })),
    deleteDoc: (ref) => write(ref, () => null),
    writeBatch: () => {
      const updates = [];
      return {
        update: (ref, fields) => updates.push([ref, fields]),
        commit: async () => {
          for (const [ref, fields] of updates) await fake.sdk.updateDoc(ref, fields);
        },
      };
    },
    waitForPendingWrites: () => syncWait.promise,
    onAuthStateChanged: (auth, listener) => {
      authListener = listener;
    },
    signInWithPopup: () => {
      calls.signInWithPopup += 1;
      const popup = deferred();
      popups.push(popup);
      return popup.promise;
    },
    GoogleAuthProvider: class {},
    signOut: async () => authListener(null),
  };
  return fake;
}

// The panel shows no times, and a time from the server is not known before its answer.
const TIMES = new Set(['createdAt', 'updatedAt']);
const timeless = (items) =>
  items.map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => !TIMES.has(key))));

describe('createLibrary: a change draws without a read', () => {
  // The patch must give the lists that a read of the cache gives after the write, offline too.
  async function expectPatchMatchesCache(fake, change) {
    const library = createLibrary(fake.sdk, 'db', UID);
    const before = {
      lessons: (await library.listCachedLessons()).items,
      grooves: (await library.listCachedGrooves()).items,
    };
    const written = await change(library);
    const patched = written.patch(before);
    expect(timeless(patched.lessons)).toEqual(timeless((await library.listCachedLessons()).items));
    expect(timeless(patched.grooves)).toEqual(timeless((await library.listCachedGrooves()).items));
    return patched;
  }

  let fake;
  beforeEach(() => {
    fake = createFakeSdk();
    fake.online = false;
    fake.add('lessons', 'l-b', { name: 'Bossa' });
    fake.add('grooves', 'g1', { lessonId: 'l-b', title: 'Beat', query: BEAT, createdAt: 1 });
    fake.add('grooves', 'g2', { lessonId: null, title: 'Shuffle', query: SHUFFLE, createdAt: 2 });
  });

  it('puts a new lesson in name order', async () => {
    const patched = await expectPatchMatchesCache(fake, (library) => library.createLesson('Afro'));
    expect(patched.lessons.map((lesson) => lesson.name)).toEqual(['Afro', 'Bossa']);
    expect(patched.lessons[0].hasPendingWrites).toBe(true);
  });

  it('renames a lesson and sorts again', async () => {
    const patched = await expectPatchMatchesCache(fake, (library) =>
      library.renameLesson('l-b', 'Zouk')
    );
    expect(patched.lessons[0].name).toBe('Zouk');
  });

  it('adds a saved groove last, with the title cut to the stored length', async () => {
    const patched = await expectPatchMatchesCache(fake, (library) =>
      library.saveGroove({ query: BEAT, title: 'x'.repeat(250), lessonId: 'l-b' })
    );
    expect(patched.grooves.at(-1).title).toHaveLength(200);
  });

  it('updates, moves and renames a groove in its place', async () => {
    await expectPatchMatchesCache(fake, (library) =>
      library.updateGroove('g1', { query: SHUFFLE, title: 'New', lessonId: null })
    );
    await expectPatchMatchesCache(fake, (library) => library.moveGroove('g2', 'l-b'));
    const patched = await expectPatchMatchesCache(fake, (library) =>
      library.renameGroove('g2', ' Later ', SHUFFLE)
    );
    expect(patched.grooves.map((groove) => groove.title)).toEqual(['New', 'Later']);
  });

  it('writes a new name into the Title of the stored query, if it has one', async () => {
    const patched = await expectPatchMatchesCache(fake, (library) =>
      library.renameGroove('g1', '100% Funk', BEAT)
    );
    expect(patched.grooves[0].query).toBe(BEAT.replace('Title=Beat', 'Title=100%25%20Funk'));
    const untitled = BEAT.replace('&Title=Beat', '');
    fake.add('grooves', 'g3', { lessonId: null, title: 'Plain', query: untitled, createdAt: 3 });
    const again = await expectPatchMatchesCache(fake, (library) =>
      library.renameGroove('g3', 'Named', untitled)
    );
    expect(again.grooves.at(-1)).toMatchObject({ title: 'Named', query: untitled });
  });

  it('names the item in a refusal of a move, a delete and a lesson rename', async () => {
    const library = createLibrary(fake.sdk, 'db', UID);
    expect(library.moveGroove('g1', null, 'Beat').title).toBe('Beat');
    expect(library.deleteGroove('g2', 'Shuffle').title).toBe('Shuffle');
    expect(library.renameLesson('l-b', 'Samba').title).toBe('Samba');
  });

  it('removes a deleted groove', async () => {
    const patched = await expectPatchMatchesCache(fake, (library) => library.deleteGroove('g1'));
    expect(patched.grooves.map((groove) => groove.id)).toEqual(['g2']);
  });

  it('removes a deleted lesson and keeps its grooves unfiled', async () => {
    fake.online = true;
    const patched = await expectPatchMatchesCache(fake, (library) => library.deleteLesson('l-b'));
    expect(patched.lessons).toEqual([]);
    expect(patched.grooves.map((groove) => groove.lessonId)).toEqual([null, null]);
  });
});

describe('the library panel', () => {
  let fake;
  let dirtyState;
  let editor;
  let started;

  const byId = (id) => document.getElementById(id);
  const savedGrooves = () => [...fake.collections.get('grooves').values()];
  const grooveButton = (title) =>
    [...document.querySelectorAll('.lp-open')].find((node) => node.textContent === title);
  const lessonNames = () =>
    [...document.querySelectorAll('.lp-lesson summary span')].map((node) => node.textContent);

  // The editor: the groove in it is a query. It starts with the default groove until the page
  // has loaded, and it cannot take another groove before that, as the real one.
  function createEditor() {
    let query = '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|----|&S=|----|&K=|----|';
    let loaded = false;
    const watch = watchDirty(dirtyState, () => query);
    return {
      load() {
        query = START;
        loaded = true;
        dirtyState.markStart(query);
      },
      edit(next) {
        query = next;
        watch.changed();
      },
      openGroove(next) {
        if (!loaded) throw new TypeError("Cannot set properties of null (setting 'value')");
        query = next;
        watch.changed();
      },
      currentQuery: () => query,
      currentTitle: () => decodeURIComponent(/Title=([^&]*)/.exec(query)?.[1] ?? ''),
      rename: vi.fn((name) => {
        query = query.replace(/Title=[^&]*/, 'Title=' + encodeURIComponent(name));
        watch.changed();
      }),
      onDirtyChange: (listener) => watch.onDirtyChange(listener),
    };
  }

  // Open the panel, connect, and sign in. The page has loaded unless told otherwise.
  async function openPanel({ user = { uid: UID, displayName: 'Ana' }, load = true } = {}) {
    if (load) editor.load();
    byId('libraryToggle').click();
    await vi.waitFor(() => expect(fake.hasAuthListener()).toBe(true));
    started = fake.signIn(user);
    if (user) await vi.waitFor(() => expect(byId('lpLibrary').hidden).toBe(false));
  }

  // Wait for the first server answer, also when the test holds it.
  const loaded = () => started;

  beforeEach(() => {
    // Node has its own localStorage global, which hides the one of jsdom.
    vi.stubGlobal('localStorage', globalThis.jsdom.window.localStorage);
    localStorage.clear();
    document.body.innerHTML = `
      <div id="upperLeft"></div>
      <a id="helpAnchor"></a>
      <span id="userMenuName"></span>
      <button id="userMenuSignOut"></button>
      <button id="userMenuSignIn"></button>`;
    fake = createFakeSdk();
    vi.mocked(connectCloud).mockResolvedValue({
      sdk: fake.sdk,
      auth: 'auth',
      db: 'db',
      persistent: true,
    });
    dirtyState = createDirtyState();
    editor = createEditor();
    initLibraryPanel({
      search: START,
      editor,
      dirtyState,
      initSaveButton: () => () => {},
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves one groove on a double tap of Save', async () => {
    await openPanel();
    await loaded();
    byId('lpSaveTool').querySelector('summary').click();
    byId('lpSaveNew').click();
    byId('lpSaveNew').click();
    byId('lpSaveForm').dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(grooveButton('Start')).toBeDefined());
    await settle();
    expect(savedGrooves()).toHaveLength(1);
  });

  it('turns the buttons back on while an offline write waits for the server', async () => {
    await openPanel();
    await loaded();
    fake.online = false;
    byId('lpLessonName').value = 'Bossa';
    const create = byId('lpLessonForm').querySelector('button');
    create.click();
    expect(create.disabled).toBe(true);
    await vi.waitFor(() => expect(lessonNames()).toEqual(['Bossa']));
    await settle();
    expect(create.disabled).toBe(false);
  });

  it('opens one sign-in popup on a double tap, and Sign in works again after it closes', async () => {
    await openPanel({ user: null });
    await vi.waitFor(() => expect(byId('lpSignedOut').hidden).toBe(false));
    byId('lpSignIn').click();
    byId('lpSignIn').click();
    expect(fake.calls.signInWithPopup).toBe(1);
    fake.popups[0].reject({ code: 'auth/popup-closed-by-user' });
    await settle();
    byId('lpSignIn').click();
    expect(fake.calls.signInWithPopup).toBe(2);
  });

  it('ignores a slow server answer that arrives after a newer change', async () => {
    fake.add('lessons', 'l-a', { name: 'Afro' });
    const slow = fake.holdServer();
    await openPanel();
    expect(lessonNames()).toEqual(['Afro']);
    byId('lpLessonName').value = 'Bossa';
    byId('lpLessonForm').querySelector('button').click();
    await vi.waitFor(() => expect(lessonNames()).toEqual(['Afro', 'Bossa']));
    // The answer was made before the new lesson.
    slow.resolve();
    await loaded();
    await settle();
    expect(lessonNames()).toEqual(['Afro', 'Bossa']);
  });

  it('keeps "No lesson" in an open form across a redraw', async () => {
    fake.add('lessons', 'l-a', { name: 'Afro' });
    localStorage.setItem('grooveScribe.lastLesson', 'l-a');
    await openPanel();
    await loaded();
    const linkTool = byId('lpLinkLesson').closest('details');
    linkTool.open = true;
    byId('lpLinkLesson').value = '';
    byId('lpLinkLesson').dispatchEvent(new Event('change'));
    byId('lpSaveTool').querySelector('summary').click();
    byId('lpSaveTool').open = true;
    byId('lpSaveLesson').value = '';
    // A new lesson redraws the lists and becomes the open lesson.
    byId('lpLessonName').value = 'Bossa';
    byId('lpLessonForm').querySelector('button').click();
    await vi.waitFor(() => expect(lessonNames()).toEqual(['Afro', 'Bossa']));
    expect(byId('lpLinkLesson').value).toBe('');
    expect(byId('lpSaveLesson').value).toBe('');
  });

  describe('a saved groove that is open', () => {
    beforeEach(() => {
      fake.add('grooves', 'g1', { lessonId: null, title: 'Beat', query: BEAT, createdAt: 1 });
      vi.stubGlobal('prompt', () => 'Fresh');
    });

    async function pickBeat() {
      await openPanel();
      await loaded();
      grooveButton('Beat').click();
      await vi.waitFor(() => expect(editor.currentQuery()).toBe(BEAT));
      byId('libraryToggle').click(); // a pick closes the slide-over panel
    }

    async function renameBeat({ wait = true } = {}) {
      document.querySelector('.lp-more').click();
      [...document.querySelectorAll('.lp-actions button')]
        .find((node) => node.textContent === 'Rename')
        .click();
      if (wait) await vi.waitFor(() => expect(grooveButton('Fresh')).toBeDefined());
      await settle();
    }

    it('takes the new name on a rename, and a clean editor stays clean', async () => {
      await pickBeat();
      await renameBeat();
      expect(editor.rename).toHaveBeenCalledWith('Fresh');
      expect(editor.currentTitle()).toBe('Fresh');
      expect(dirtyState.isDirty(editor.currentQuery())).toBe(false);
      expect(grooveButton('Fresh').getAttribute('aria-current')).toBe('true');
    });

    it('takes the new name on a rename, and keeps the edits of a dirty editor', async () => {
      await pickBeat();
      editor.edit(BEAT.replace('S=|--O-|', 'S=|O-O-|'));
      await renameBeat();
      expect(editor.currentTitle()).toBe('Fresh');
      expect(dirtyState.isDirty(editor.currentQuery())).toBe(true);
    });

    it('stores the new title, and a pick of the renamed groove shows it', async () => {
      await pickBeat();
      await renameBeat();
      const stored = BEAT.replace('Title=Beat', 'Title=Fresh');
      expect(savedGrooves()[0].fields.query).toBe(stored);
      expect(editor.currentQuery()).toBe(stored);
      // Another groove, as from the Grooves menu, then the renamed one again.
      editor.openGroove(START);
      dirtyState.markClean(START);
      byId('libraryToggle').click();
      grooveButton('Fresh').click();
      await vi.waitFor(() => expect(editor.currentTitle()).toBe('Fresh'));
    });

    it('makes the page dirty when the server refuses the rename', async () => {
      await pickBeat();
      fake.refuseNext = true;
      await renameBeat({ wait: false });
      await vi.waitFor(() => expect(byId('lpMessage').textContent).toContain('"Fresh"'));
      expect(dirtyState.isDirty(editor.currentQuery())).toBe(true);
    });

    it('leaves the editor alone on a rename of a groove that is not open', async () => {
      await openPanel();
      await loaded();
      await renameBeat();
      expect(editor.rename).not.toHaveBeenCalled();
      expect(editor.currentQuery()).toBe(START);
    });
  });

  it('reads no list for an edit, and one server list after the sync', async () => {
    fake.add('lessons', 'l-a', { name: 'Afro' });
    fake.add('grooves', 'g1', { lessonId: 'l-a', title: 'Beat', query: BEAT, createdAt: 1 });
    vi.stubGlobal('prompt', () => 'Fresh');
    vi.stubGlobal('confirm', () => true);
    await openPanel();
    await loaded();
    const before = { ...fake.calls };

    byId('lpLessonName').value = 'Bossa';
    byId('lpLessonForm').querySelector('button').click();
    await vi.waitFor(() => expect(lessonNames()).toEqual(['Afro', 'Bossa']));
    const actions = () => [...document.querySelectorAll('.lp-actions button')];
    document.querySelector('.lp-more').click();
    actions()
      .find((node) => node.textContent === 'Rename')
      .click();
    await vi.waitFor(() => expect(grooveButton('Fresh')).toBeDefined());
    document.querySelector('.lp-more').click();
    actions()
      .find((node) => node.textContent === 'Delete')
      .click();
    await vi.waitFor(() => expect(grooveButton('Fresh')).toBeUndefined());
    await settle();
    expect(fake.calls).toEqual(before);

    // The sync reads the server once (one list each) for all the edits before it.
    fake.sync();
    await vi.waitFor(() => expect(fake.calls.getDocs).toBe(before.getDocs + 2));
    await settle();
    expect(fake.calls.getDocs).toBe(before.getDocs + 2);
    expect(fake.calls.getDocsFromCache).toBe(before.getDocsFromCache);
    expect(lessonNames()).toEqual(['Afro', 'Bossa']);
  });

  it('keeps the open lesson open after two redraws in one task', async () => {
    fake.add('grooves', 'g1', { lessonId: null, title: 'Beat', query: BEAT, createdAt: 1 });
    await openPanel();
    await loaded();
    await settle();
    // Each start of the page draws the lists again.
    dirtyState.markStart(START);
    dirtyState.markStart(START);
    await settle();
    expect(document.querySelector('.lp-lesson').open).toBe(true);
  });

  it('waits for the page to load before it opens a picked groove', async () => {
    fake.add('grooves', 'g1', { lessonId: null, title: 'Beat', query: BEAT, createdAt: 1 });
    const errors = [];
    const onError = (event) => errors.push(event.reason);
    window.addEventListener('unhandledrejection', onError);
    try {
      await openPanel({ load: false });
      await loaded();
      grooveButton('Beat').click();
      await settle();
      expect(byId('lpMessage').textContent).toBe('The editor is still loading…');
      editor.load();
      await vi.waitFor(() => expect(editor.currentQuery()).toBe(BEAT));
      await settle();
      expect(errors).toEqual([]);
      expect(dirtyState.isDirty(editor.currentQuery())).toBe(false);
      expect(grooveButton('Beat').getAttribute('aria-current')).toBe('true');
    } finally {
      window.removeEventListener('unhandledrejection', onError);
    }
  });

  it('waits for the page to load before it saves, and saves the loaded groove', async () => {
    await openPanel({ load: false });
    await loaded();
    byId('lpSaveTool').open = true;
    byId('lpSaveNew').click();
    await settle();
    expect(savedGrooves()).toHaveLength(0);
    editor.load();
    await vi.waitFor(() => expect(savedGrooves()).toHaveLength(1));
    expect(savedGrooves()[0].fields.query).toBe(START);
    // The form opened with the empty title of the default groove, and now has the loaded one.
    expect(savedGrooves()[0].fields.title).toBe('Start');
    expect(byId('lpMessage').hidden).toBe(true);
  });

  it('gives up waiting for the editor after 15 s, and the buttons come back', async () => {
    await openPanel({ load: false });
    await loaded();
    vi.useFakeTimers();
    try {
      byId('lpSaveTool').open = true;
      byId('lpSaveNew').click();
      expect(byId('lpSaveNew').disabled).toBe(true);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(byId('lpSaveNew').disabled).toBe(false);
      expect(byId('lpMessage').textContent).toContain('did not finish loading');
      expect(savedGrooves()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('puts focus back on the pressed button when it comes back', async () => {
    await openPanel();
    await loaded();
    const create = byId('lpLessonForm').querySelector('button');
    byId('lpLessonName').value = 'Bossa';
    create.focus();
    create.click();
    // A browser moves focus to the page when a focused button turns disabled. jsdom does not.
    document.body.tabIndex = -1;
    document.body.focus();
    await vi.waitFor(() => expect(create.disabled).toBe(false));
    expect(document.activeElement).toBe(create);
  });

  it('shows "Will sync" on a new row while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    try {
      await openPanel();
      await loaded();
      fake.online = false;
      byId('lpLessonName').value = 'Bossa';
      byId('lpLessonForm').querySelector('button').click();
      await vi.waitFor(() => expect(lessonNames()).toEqual(['Bossa']));
      expect(document.querySelector('.lp-lesson .lp-sync').textContent).toBe('Will sync');
    } finally {
      delete navigator.onLine;
    }
  });

  it('does not bring back a refused new groove with the next change', async () => {
    fake.add('lessons', 'l-a', { name: 'Afro' });
    await openPanel();
    await loaded();
    // The cache read after the refusal is slow, and a newer change is drawn first.
    const realCacheRead = fake.sdk.getDocsFromCache;
    let release;
    const held = new Promise((resolve) => (release = resolve));
    fake.sdk.getDocsFromCache = async (query) => {
      const answer = await realCacheRead(query);
      await held;
      return answer;
    };
    fake.refuseNext = true;
    byId('lpLinkUrl').value = 'https://example.com/' + BEAT;
    byId('lpLinkTitle').value = 'Refused';
    byId('lpLinkForm').querySelector('button').click();
    await vi.waitFor(() => expect(byId('lpMessage').textContent).toContain('"Refused"'));
    byId('lpLessonName').value = 'Bossa';
    byId('lpLessonForm').querySelector('button').click();
    await vi.waitFor(() => expect(lessonNames()).toEqual(['Afro', 'Bossa']));
    expect(grooveButton('Refused')).toBeUndefined();
    release();
  });
});
