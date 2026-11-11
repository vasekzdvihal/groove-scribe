// The library panel in the editor: Google sign-in, lessons, and saved grooves.
//
// On a wide screen the panel stays next to the music until the user hides it. On a narrow
// screen it slides over the editor, and picking a groove closes it.
//
// This module is small and loads with the editor. The page runs the Firebase SDK only when the
// panel opens. It opens by itself only for people who were signed in on this device or who left
// it open, so a shared link does not load the SDK into the page. The service worker still
// precaches the SDK file for offline use.
import { connectCloud, resolveCloudConfig } from './firebaseClient.js';
import { askToDiscard, isAskingToDiscard } from '../discardDialog.js';
import {
  PAGE_START,
  findOpenGroove,
  readRecord,
  rebaseRecord,
  restoreDecision,
  writeRecord,
} from './currentGroove.js';
import { parseGrooveLink } from './grooveLink.js';
import { createLibrary } from './library.js';
import {
  createPendingSync,
  isPending,
  readPendingWritesFlag,
  writePendingWritesFlag,
} from './pendingSync.js';

const LINK_ERRORS = {
  'short-link':
    'This is a short link. Open it in your browser, then paste the full address it opens.',
  'not-a-groove': 'This link does not contain a groove.',
  'too-long': 'This groove is too long to save.',
};
const LAST_LESSON_KEY = 'grooveScribe.lastLesson';
const USER_KEY = 'grooveScribe.user';
const KEEP_OPEN_KEY = 'grooveScribe.libraryOpen';
// Keep the same width in css/library-panel.css.
const DOCKED_QUERY = '(min-width: 1100px)';
const UNFILED = 'unfiled';
const NOT_ON_DEVICE = 'Offline. This library is not on this device yet.';
const LOADING_TEXT = 'Loading…';
const WAITING_TEXT = 'Waiting for the network…';
const WAITING_AFTER_MS = 5000;
const WILL_SYNC_TEXT = 'Will sync';
const KEEP_TAB_TEXT = 'Keep this tab open until online';
const WRITE_REFUSED = 'A change could not be saved. The library shows what is saved.';
const NOTHING_TO_UPDATE = 'Nothing to update. The groove has no changes.';
const NOT_OPEN_TO_UPDATE = 'The saved groove is no longer open. Save it as a new groove.';
const STILL_LOADING = 'The editor is still loading…';
const NOT_STARTED = 'The editor did not finish loading. Reload the page and try again.';
const START_WAIT_MS = 15_000;

const PANEL_HTML = `
  <header class="lp-head">
    <h2 id="lpTitle">My library</h2>
    <button id="lpClose" type="button" aria-label="Close library">✕</button>
  </header>
  <div class="lp-body">
    <p id="lpMessage" role="alert" hidden></p>
    <button id="lpRetry" class="lp-primary" type="button" hidden>Retry</button>
    <p id="lpLoading" hidden>${LOADING_TEXT}</p>
    <section id="lpSignedOut" hidden>
      <p>Sign in to keep your grooves in lessons and open them on any device.</p>
      <button id="lpSignIn" class="lp-primary" type="button">Sign in with Google</button>
    </section>
    <section id="lpLibrary" hidden>
      <div id="lpLessons"></div>
      <details id="lpSaveTool" class="lp-tool">
        <summary>Save current groove</summary>
        <form id="lpSaveForm">
          <label for="lpSaveTitle">Title</label>
          <input id="lpSaveTitle" type="text" maxlength="200">
          <label for="lpSaveLesson">Lesson</label>
          <select id="lpSaveLesson"></select>
          <p id="lpUpdateHint" class="lp-hint" hidden></p>
          <div id="lpSaveButtons" class="lp-save-buttons">
            <button id="lpSaveNew" class="lp-primary" type="submit">Save groove</button>
          </div>
        </form>
      </details>
      <details class="lp-tool">
        <summary>Add a groove link</summary>
        <form id="lpLinkForm">
          <label for="lpLinkUrl">Groove link</label>
          <input id="lpLinkUrl" type="text" autocomplete="off" required>
          <label for="lpLinkTitle">Title</label>
          <input id="lpLinkTitle" type="text" maxlength="200">
          <label for="lpLinkLesson">Lesson</label>
          <select id="lpLinkLesson"></select>
          <button class="lp-primary" type="submit">Add groove</button>
        </form>
      </details>
      <details class="lp-tool">
        <summary>New lesson</summary>
        <form id="lpLessonForm">
          <label for="lpLessonName">Lesson name</label>
          <input id="lpLessonName" type="text" maxlength="200" required>
          <button class="lp-primary" type="submit">Create lesson</button>
        </form>
      </details>
    </section>
  </div>
`;

const byId = (id) => document.getElementById(id);
const grooveName = (groove) => groove.title || 'Untitled groove';
const refusedMessage = (name) =>
  name ? `"${name}" could not be saved. The library shows what is saved.` : WRITE_REFUSED;

function element(tag, properties = {}, children = []) {
  const node = Object.assign(document.createElement(tag), properties);
  node.append(...children);
  return node;
}

function button(textContent, onClick, properties = {}) {
  const node = element('button', { type: 'button', textContent, ...properties });
  node.addEventListener('click', onClick);
  return node;
}

// Browser storage can throw in private windows. The panel works without it.
function readLastLesson() {
  try {
    return localStorage.getItem(LAST_LESSON_KEY);
  } catch {
    return null;
  }
}

function writeLastLesson(id) {
  try {
    localStorage.setItem(LAST_LESSON_KEY, id);
  } catch {
    /* the lesson is simply not remembered */
  }
}

function showMessage(text) {
  const message = byId('lpMessage');
  message.textContent = text ?? '';
  message.hidden = !text;
}

// The rules refuse accounts that are not on the allowlist, so this code almost always
// means the account has no access. A rare refused write can show the same message.
const isDenied = (error) => error?.code === 'permission-denied';

function reportFailure(error) {
  console.error(error);
  showMessage(
    isDenied(error)
      ? 'This account does not have access.'
      : 'That did not work. Check your connection and try again.'
  );
}

let waitingTimer = null;

// The Firebase SDK can wait 30 s on a network that hangs. Say why the panel is still empty.
function setLoading(isLoading) {
  const loading = byId('lpLoading');
  if (isLoading && !loading.hidden) return; // already waiting: keep the timer running
  clearTimeout(waitingTimer);
  loading.textContent = LOADING_TEXT;
  loading.hidden = !isLoading;
  if (isLoading) {
    waitingTimer = setTimeout(() => {
      loading.textContent = WAITING_TEXT;
    }, WAITING_AFTER_MS);
  }
}

// Show the Retry button. A click runs the action again and leaves the page as it is.
function showRetry(action) {
  const retry = byId('lpRetry');
  retry.onclick = () => {
    retry.hidden = true;
    showMessage('');
    action();
  };
  retry.hidden = false;
}

// One submit at a time: a double tap on a slow tablet must not save twice. The buttons are off
// until the handler returns. A change returns when it is drawn, also when its write waits
// offline, so they do not stay off until the server answers. A disabled button loses focus, so
// the pressed button gets it back, unless the user has moved on.
function submitOnce(form, handler) {
  let running = false;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (running) return;
    running = true;
    const pressed = event.submitter;
    const buttons = [...form.querySelectorAll('button')];
    for (const node of buttons) node.disabled = true;
    try {
      await handler(event);
    } finally {
      running = false;
      for (const node of buttons) node.disabled = false;
      const focusLost = !document.activeElement || document.activeElement === document.body;
      if (pressed?.isConnected && focusLost) pressed.focus();
    }
  };
}

function lessonOptions(lessons, selectedId) {
  return [
    element('option', { value: '', textContent: 'No lesson', selected: !selectedId }),
    ...lessons.map((lesson) =>
      element('option', {
        value: lesson.id,
        textContent: lesson.name,
        selected: lesson.id === selectedId,
      })
    ),
  ];
}

// The top bar shows the user before the Firebase SDK loads, so a shared link does not need it.
// The name and photo are kept on this device from the last visit.
function readRememberedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

function rememberUser(user) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // Without storage the avatar appears only after the panel has opened.
  }
}

function readKeepOpen() {
  try {
    const saved = localStorage.getItem(KEEP_OPEN_KEY);
    return saved === null ? Boolean(readRememberedUser()) : saved === 'true';
  } catch {
    return false;
  }
}

function writeKeepOpen(keepOpen) {
  try {
    localStorage.setItem(KEEP_OPEN_KEY, String(keepOpen));
  } catch {
    /* the choice lasts until the page closes */
  }
}

function avatarContent(user) {
  const initial = element('span', {
    className: 'userInitial',
    textContent: (user.name || '?').charAt(0).toUpperCase(),
  });
  if (!user.photoURL) return [initial];
  const photo = element('img', { src: user.photoURL, alt: '', referrerPolicy: 'no-referrer' });
  // Show the initial if the photo cannot load, for example when offline.
  photo.addEventListener('error', () => photo.replaceWith(initial), { once: true });
  return [photo];
}

function renderUserMenu(user) {
  const anchor = byId('helpAnchor');
  anchor.classList.toggle('signedIn', Boolean(user));
  if (user) {
    anchor.replaceChildren(...avatarContent(user));
    anchor.setAttribute('aria-label', 'User menu');
  } else {
    anchor.replaceChildren(element('i', { className: 'fa fa-user' }), ' Sign in');
    anchor.setAttribute('aria-label', 'Sign in and help');
  }
  byId('userMenuName').textContent = user?.name ?? '';
  byId('userMenuName').hidden = !user;
  byId('userMenuSignOut').hidden = !user;
  byId('userMenuSignIn').hidden = Boolean(user);
}

// Remove everything that belongs to the previous user.
function clearLibrary() {
  byId('lpLibrary').hidden = true;
  byId('lpLessons').replaceChildren();
  byId('lpSaveLesson').replaceChildren();
  byId('lpLinkLesson').replaceChildren();
  for (const id of ['lpSaveForm', 'lpLinkForm', 'lpLessonForm']) byId(id).reset();
  byId('lpRetry').hidden = true;
  showMessage('');
}

function startLibrary({
  library,
  uid,
  pageQuery,
  isActive: isSignedIn,
  persistent,
  editor,
  dirtyState,
  afterPick,
  showGrooveOpen,
}) {
  let lessons = [];
  let grooves = [];
  // The saved groove that the editor shows. See findOpenGroove.
  /** @type {import('./currentGroove.js').CurrentGroove | null} */
  let current = null;
  // The id that render highlights.
  let openGrooveId = null;
  // The current groove of the last visit, until a list shows whether it is still current.
  let restoring = readRecord(uid);
  let menuGrooveId = null;
  let openLesson = readLastLesson();
  // The user picked the lesson of the link form. It stays until the groove is added.
  let linkLessonPicked = false;
  // The user typed a title into the save form since it was filled.
  let saveTitleTyped = false;
  // New documents that the server refused. A change drawn before their redraw must not keep them.
  const refusedIds = new Set();
  let stopped = false;

  let drawn = null;
  // Each read and each local change gets a number when it starts. An answer that arrives after
  // a newer one is on screen is out of date, so it is not drawn.
  let lastNumber = 0;
  let drawnNumber = 0;
  const nextNumber = () => ++lastNumber;

  const isActive = () => !stopped && isSignedIn();

  // Replace the lists and draw them. An answer that repeats what is on screen leaves the
  // page alone, unless a change needs a fresh draw. fromServer: the lists are the whole library.
  function draw(nextLessons, nextGrooves, redraw, fromServer = false) {
    const next = JSON.stringify([nextLessons, nextGrooves]);
    lessons = nextLessons;
    grooves = nextGrooves;
    const restored = restoreCurrentGroove(fromServer);
    if (redraw || restored || next !== drawn) render();
    drawn = next;
    sync.update([...lessons, ...grooves]);
  }

  // Draw an answer unless a newer one is on screen. Returns false for an answer that is too old.
  function drawIfNewest(number, nextLessons, nextGrooves, redraw, fromServer) {
    if (number < drawnNumber) return false;
    drawnNumber = number;
    draw(nextLessons, nextGrooves, redraw, fromServer);
    return true;
  }

  const readCached = () => Promise.all([library.listCachedLessons(), library.listCachedGrooves()]);
  const readServer = () => Promise.all([library.listLessons(), library.listGrooves()]);

  const sync = createPendingSync({
    waitForServer: () => library.waitForPendingWrites(),
    readHasPending: async () => {
      const [cachedLessons, cachedGrooves] = await readCached();
      return [...cachedLessons.items, ...cachedGrooves.items].some(isPending);
    },
    persistent,
    isActive,
    onSynced: redrawAfterSync,
    onSlow: render,
  });

  // A tempo raise is not an edit. The record follows it, so a reload still finds the groove.
  const stopRebase = dirtyState.onRebase((before, after) => {
    const stored = readRecord(uid);
    const next = rebaseRecord(stored, before, after);
    if (next !== stored) writeRecord(uid, next);
  });

  // A groove restored before the page marked its start becomes open only then. Draw it. A save
  // form opened before has the title of the default groove: fill it again, unless the user typed.
  const stopStart = dirtyState.onStart(() => {
    if (!isActive()) return;
    render();
    if (byId('lpSaveTool').open && !saveTitleTyped) prefillSaveForm();
  });

  // An edit or an Undo switches an open save form between Update and the plain save.
  const stopDirty = editor.onDirtyChange(() => {
    if (isActive()) render();
  });

  // Another groove, from the Grooves menu for example, closes the open saved groove. Check after
  // the current task: a pick sets the new open groove right after it marks it clean.
  const stopChange = dirtyState.onChange(() =>
    queueMicrotask(() => {
      if (isActive() && (openSavedGroove()?.id ?? null) !== openGrooveId) render();
    })
  );

  // The session is over: nothing may keep running for it.
  function stop() {
    stopped = true;
    sync.stop();
    stopRebase();
    stopStart();
    stopDirty();
    stopChange();
    showGrooveOpen(false);
  }

  // The server has answered every write, so the labels can go. A write from an earlier visit
  // has no promise to report a refusal: a pending row that is gone is the sign.
  // This is the one server read that follows edits: a burst of edits shares it.
  async function redrawAfterSync() {
    const wasPending = [...lessons, ...grooves].filter(isPending);
    const number = nextNumber();
    let lists;
    try {
      lists = await readServer();
    } catch (error) {
      if (!isActive()) return;
      reportFailure(error);
      lists = await readCached().catch(() => null);
    }
    if (!lists || !isActive()) return;
    const [nextLessons, nextGrooves] = lists;
    sync.forgetIfSynced(nextLessons, nextGrooves);
    // A change made during the read is not in the answer, so a missing row says nothing. The
    // next sync checks again.
    if (
      !drawIfNewest(number, nextLessons.items, nextGrooves.items, false, !nextGrooves.fromCache)
    ) {
      return;
    }
    const answer = new Set([...nextLessons.items, ...nextGrooves.items].map((item) => item.id));
    const refused = wasPending.find((item) => !answer.has(item.id));
    if (refused && byId('lpMessage').hidden) {
      showMessage(refusedMessage(refused.title || refused.name));
    }
  }

  // Report a refused write, and draw the library without it. The local cache has already
  // dropped the change when the promise rejects.
  async function reportIfRefused({ committed, id, title, isNew }) {
    try {
      await committed;
    } catch (error) {
      console.error(error);
      if (isNew) refusedIds.add(id);
      if (!isActive()) return;
      showMessage(refusedMessage(title));
      const number = nextNumber();
      try {
        const [nextLessons, nextGrooves] = await readCached();
        if (isActive()) drawIfNewest(number, nextLessons.items, nextGrooves.items);
      } catch (readError) {
        console.warn('The library cache could not be read:', readError);
      }
    }
  }

  // Draw what this device has, before the server answers. A failure here costs nothing: the
  // server answer comes next.
  async function drawCached() {
    const number = nextNumber();
    try {
      const [cachedLessons, cachedGrooves] = await readCached();
      if (!isActive() || (!cachedLessons.items.length && !cachedGrooves.items.length)) return false;
      drawIfNewest(number, cachedLessons.items, cachedGrooves.items);
      return true;
    } catch (error) {
      console.warn('The library cache could not be read:', error);
      return false;
    }
  }

  // Call after markClean: the groove in the editor is now this saved groove.
  function setCurrentGroove(id, savedQuery) {
    restoring = null;
    current = { id, savedQuery, version: dirtyState.cleanVersion() };
    writeRecord(uid, { id, savedQuery, editorQuery: editor.currentQuery() });
    render();
    // A docked panel can have the save form open: it is now about this groove.
    if (byId('lpSaveTool').open) prefillSaveForm();
  }

  // The editor puts the groove of the address in place when the page has loaded. Before that, a
  // pick would be lost and a save would store the wrong groove, so both wait for it, and the
  // panel says why. Resolves to false when the editor does not start within 15 s.
  function pageStarted() {
    if (dirtyState.startVersion() !== null) return Promise.resolve(true);
    showMessage(STILL_LOADING);
    return new Promise((resolve) => {
      const finish = (started) => {
        clearTimeout(timer);
        stopListening();
        if (byId('lpMessage').textContent === STILL_LOADING) {
          showMessage(started ? '' : NOT_STARTED);
        }
        resolve(started);
      };
      const stopListening = dirtyState.onStart(() => finish(true));
      const timer = setTimeout(() => finish(false), START_WAIT_MS);
    });
  }

  // The groove in the editor takes the new name of its saved groove. Its query changed in the
  // library too, so the groove stays open. A clean editor stays clean, unless the server refuses.
  function showNewName(written, wasClean) {
    if (current?.id !== written.id) return;
    const savedQuery = grooves.find((item) => item.id === written.id)?.query;
    if (!savedQuery) return;
    editor.rename(written.title);
    if (!wasClean) {
      // The edits are not saved: Update still saves them over this groove.
      current = { ...current, savedQuery };
      const stored = readRecord(uid);
      if (stored?.id === written.id) writeRecord(uid, { ...stored, savedQuery });
      render();
      return;
    }
    const query = editor.currentQuery();
    dirtyState.markClean(query);
    written.committed.catch(() => dirtyState.forget(query));
    setCurrentGroove(written.id, savedQuery);
  }

  // The saved groove that the editor shows, or null.
  const openSavedGroove = () =>
    findOpenGroove(current, grooves, {
      cleanVersion: dirtyState.cleanVersion(),
      startVersion: dirtyState.startVersion(),
    });

  // After a reload, the groove of the last visit is current if the library still has it as it
  // was, and the page started with it. It stays current until another groove is loaded, also
  // when the panel opens before the page has marked its start. Returns true when it is kept.
  function restoreCurrentGroove(fromServer) {
    if (!restoring) return false;
    const decision = restoreDecision(restoring, grooves, { pageQuery, fromServer });
    if (decision === 'wait') return false;
    if (decision === 'keep') {
      current = { id: restoring.id, savedQuery: restoring.savedQuery, version: PAGE_START };
    } else {
      writeRecord(uid, null);
    }
    restoring = null;
    return decision === 'keep';
  }

  // Run one change and draw it at once, also offline: the lists change as the write changed the
  // cache, so a change reads nothing. Without a change, load from the server. Failures stay on
  // screen. A change makes one write and returns its `queued` result, with the patch for the
  // lists. An answer that a newer one overtook is not drawn, see drawIfNewest.
  async function act(change) {
    showMessage('');
    try {
      if (change) {
        const written = await change();
        reportIfRefused(written);
        sync.changeRan(written);
        // A slow response must not draw into another user's session.
        if (!isActive()) return { ok: false };
        // Only a change closes a menu. A load that finishes must not close one the user opened.
        menuGrooveId = null;
        const kept = (item) => !refusedIds.has(item.id);
        const next = written.patch({
          lessons: lessons.filter(kept),
          grooves: grooves.filter(kept),
        });
        drawIfNewest(nextNumber(), next.lessons, next.grooves, true, false);
        return { ok: true };
      }
      const number = nextNumber();
      const [nextLessons, nextGrooves] = await readServer();
      if (!isActive()) return { ok: false };
      drawIfNewest(number, nextLessons.items, nextGrooves.items, false, !nextGrooves.fromCache);
      return {
        ok: true,
        fromCache: nextLessons.fromCache || nextGrooves.fromCache,
        isEmpty: lessons.length === 0 && grooves.length === 0,
      };
    } catch (error) {
      if (isActive()) reportFailure(error);
      return { ok: false, denied: isDenied(error) };
    }
  }

  function syncLabel(item) {
    if (!isPending(item) || (navigator.onLine && !sync.isSlow())) return [];
    return [
      element('small', {
        className: persistent ? 'lp-sync' : 'lp-sync lp-sync-wide',
        textContent: persistent ? WILL_SYNC_TEXT : KEEP_TAB_TEXT,
      }),
    ];
  }

  function selectLesson(id) {
    openLesson = id;
    writeLastLesson(id);
  }

  function grooveActions(groove) {
    const name = grooveName(groove);
    const move = element(
      'select',
      { ariaLabel: `Lesson for ${name}` },
      lessonOptions(lessons, groove.lessonId)
    );
    move.addEventListener('change', () =>
      act(() => library.moveGroove(groove.id, move.value || null, name))
    );
    const rename = button('Rename', async () => {
      const title = prompt('Groove name', groove.title)?.trim();
      if (!title) return;
      // Ask before the change: its new query no longer matches the open groove until
      // showNewName follows it.
      const wasOpen = openSavedGroove()?.id === groove.id;
      const wasClean = wasOpen && !dirtyState.isDirty(editor.currentQuery());
      const query = grooves.find((item) => item.id === groove.id)?.query ?? groove.query;
      let written = null;
      const renamed = await act(() => (written = library.renameGroove(groove.id, title, query)));
      if (renamed.ok && wasOpen) showNewName(written, wasClean);
    });
    const remove = button(
      'Delete',
      () => {
        if (confirm(`Delete "${name}"?`)) act(() => library.deleteGroove(groove.id, name));
      },
      { className: 'lp-danger' }
    );
    return element('div', { className: 'lp-actions' }, [move, rename, remove]);
  }

  function grooveRow(groove, lessonKey) {
    const name = grooveName(groove);
    const isMenuOpen = menuGrooveId === groove.id;
    const open = button(
      name,
      async () => {
        if (!(await pageStarted())) return;
        if (dirtyState.isDirty(editor.currentQuery()) && !(await askToDiscard())) return;
        if (!isActive()) return;
        selectLesson(lessonKey);
        editor.openGroove(groove.query, name);
        // The editor writes the groove its own way, so its query is the clean one.
        dirtyState.markClean(editor.currentQuery());
        setCurrentGroove(groove.id, groove.query);
        afterPick();
      },
      { className: 'lp-open' }
    );
    if (openGrooveId === groove.id) open.setAttribute('aria-current', 'true');
    const more = button(
      '⋯',
      () => {
        menuGrooveId = isMenuOpen ? null : groove.id;
        render();
      },
      { className: 'lp-more', ariaLabel: `Options for ${name}` }
    );
    more.setAttribute('aria-expanded', String(isMenuOpen));
    return element('li', { className: 'lp-groove' }, [
      open,
      ...syncLabel(groove),
      more,
      ...(isMenuOpen ? [grooveActions(groove)] : []),
    ]);
  }

  function lessonControls(lesson) {
    return element('div', { className: 'lp-actions' }, [
      button('Rename lesson', () => {
        const name = prompt('Lesson name', lesson.name)?.trim();
        if (name) act(() => library.renameLesson(lesson.id, name));
      }),
      button(
        'Delete lesson',
        () => {
          if (confirm(`Delete lesson "${lesson.name}"? Its grooves stay in your library.`)) {
            act(() => library.deleteLesson(lesson.id));
          }
        },
        { className: 'lp-danger' }
      ),
    ]);
  }

  function lessonSection(lesson, lessonGrooves, isOpen) {
    const key = lesson?.id ?? UNFILED;
    const section = element('details', { className: 'lp-lesson', open: isOpen }, [
      element('summary', {}, [
        element('span', { textContent: lesson?.name ?? 'No lesson' }),
        ...(lesson ? syncLabel(lesson) : []),
        element('small', { textContent: String(lessonGrooves.length) }),
      ]),
      lessonGrooves.length
        ? element(
            'ul',
            {},
            lessonGrooves.map((groove) => grooveRow(groove, key))
          )
        : element('p', { className: 'lp-empty', textContent: 'No grooves yet.' }),
      ...(lesson ? [lessonControls(lesson)] : []),
    ]);
    // Keep one lesson open, so that a long library stays short. The event comes after the
    // task: a section that a newer render has replaced must not close the new ones.
    section.addEventListener('toggle', () => {
      if (!section.open || !section.isConnected) return;
      selectLesson(key);
      for (const other of byId('lpLessons').querySelectorAll('.lp-lesson')) {
        if (other !== section) other.open = false;
      }
    });
    return section;
  }

  const updateButton = element('button', {
    id: 'lpUpdate',
    type: 'submit',
    className: 'lp-primary',
    textContent: 'Update groove',
  });

  // A saved groove that is open and has edits can be updated. Otherwise the form has the plain
  // save. Enter in the title presses the first button.
  function refreshSaveForm() {
    const groove = openSavedGroove();
    const canUpdate = Boolean(groove) && dirtyState.isDirty(editor.currentQuery());
    const saveNew = byId('lpSaveNew');
    saveNew.textContent = canUpdate ? 'Save as new' : 'Save groove';
    saveNew.className = canUpdate ? '' : 'lp-primary';
    const hint = byId('lpUpdateHint');
    hint.textContent = canUpdate
      ? `Update saves the changes in "${grooveName(groove)}". Save as new keeps it as it is.`
      : '';
    hint.hidden = !canUpdate;
    byId('lpSaveButtons').replaceChildren(...(canUpdate ? [updateButton, saveNew] : [saveNew]));
    return canUpdate ? groove : null;
  }

  function render() {
    for (const id of ['lpSaveLesson', 'lpLinkLesson']) {
      const select = byId(id);
      const known = lessons.some((lesson) => lesson.id === openLesson);
      // A redraw must not file the groove in another lesson, also when it is "No lesson". The
      // open save form keeps its lesson: Update moves the groove there. The link form follows
      // the open lesson until the user picks one.
      const keep =
        select.options.length > 0 &&
        (id === 'lpSaveLesson' ? byId('lpSaveTool').open : linkLessonPicked);
      const selected = keep ? select.value : select.value || (known && openLesson);
      select.replaceChildren(...lessonOptions(lessons, selected));
    }
    openGrooveId = openSavedGroove()?.id ?? null;
    showGrooveOpen(openGrooveId !== null);
    const known = new Set(lessons.map((lesson) => lesson.id));
    const unfiled = grooves.filter((groove) => !known.has(groove.lessonId));
    const entries = [
      ...lessons.map((lesson) => ({
        lesson,
        key: lesson.id,
        items: grooves.filter((groove) => groove.lessonId === lesson.id),
      })),
      ...(unfiled.length ? [{ lesson: null, key: UNFILED, items: unfiled }] : []),
    ];
    const openKey = entries.some((entry) => entry.key === openLesson)
      ? openLesson
      : entries[0]?.key;
    refreshSaveForm();
    byId('lpLessons').replaceChildren(
      ...(entries.length
        ? entries.map(({ lesson, key, items }) => lessonSection(lesson, items, key === openKey))
        : [
            element('p', {
              className: 'lp-empty',
              textContent: 'Your library is empty. Save a groove or create a lesson.',
            }),
          ])
    );
  }

  function prefillSaveForm() {
    saveTitleTyped = false;
    byId('lpSaveTitle').value = editor.currentTitle();
    const groove = refreshSaveForm();
    if (!groove) {
      // A new groove goes to the open lesson, as the list shows it.
      const known = lessons.some((lesson) => lesson.id === openLesson);
      byId('lpSaveLesson').value = known ? openLesson : '';
      return;
    }
    // Update keeps the library name of the groove, unless the user types another one.
    if (groove.title) byId('lpSaveTitle').value = groove.title;
    // The form starts on the groove's own lesson. Another lesson moves it on Update.
    const known = lessons.some((lesson) => lesson.id === groove.lessonId);
    byId('lpSaveLesson').value = known ? groove.lessonId : '';
  }

  // Fill the form in the click, before it opens. The toggle event comes later, so filling there
  // could overwrite what the user has typed by then. A form opened from code fills on toggle.
  let prefilled = false;
  byId('lpSaveTool').querySelector('summary').onclick = () => {
    if (byId('lpSaveTool').open) return;
    prefillSaveForm();
    prefilled = true;
  };
  byId('lpSaveTool').ontoggle = () => {
    if (byId('lpSaveTool').open && !prefilled) prefillSaveForm();
    prefilled = false;
  };

  submitOnce(byId('lpLessonForm'), async () => {
    const name = byId('lpLessonName').value.trim();
    if (!name) return;
    const created = await act(() => {
      const written = library.createLesson(name);
      selectLesson(written.id);
      return written;
    });
    if (created.ok) byId('lpLessonName').value = '';
  });

  byId('lpSaveTitle').oninput = () => {
    saveTitleTyped = true;
  };

  byId('lpLinkLesson').onchange = () => {
    linkLessonPicked = true;
  };

  byId('lpLinkUrl').oninput = () => {
    const parsed = parseGrooveLink(byId('lpLinkUrl').value);
    if (parsed.ok && !byId('lpLinkTitle').value) byId('lpLinkTitle').value = parsed.title;
  };

  submitOnce(byId('lpLinkForm'), async () => {
    const parsed = parseGrooveLink(byId('lpLinkUrl').value);
    if (!parsed.ok) {
      showMessage(LINK_ERRORS[parsed.reason]);
      return;
    }
    const saved = await act(() =>
      library.saveGroove({
        query: parsed.query,
        title: byId('lpLinkTitle').value.trim(),
        lessonId: byId('lpLinkLesson').value || null,
      })
    );
    if (saved.ok) {
      byId('lpLinkUrl').value = '';
      linkLessonPicked = false;
      byId('lpLinkTitle').value = '';
    }
  });

  // The editor now shows the saved groove, unless the server refuses the write later.
  function afterSave(written, query) {
    dirtyState.markClean(query);
    // A save that the server refuses later did not save the edits.
    written.committed.catch(() => dirtyState.forget(query));
    setCurrentGroove(written.id, query);
    byId('lpSaveTool').open = false;
  }

  async function updateCurrent(groove, query) {
    const lessonId = byId('lpSaveLesson').value || null;
    let written = null;
    const saved = await act(() => {
      written = library.updateGroove(groove.id, {
        query,
        title: byId('lpSaveTitle').value.trim() || groove.title,
        lessonId,
      });
      selectLesson(lessonId ?? UNFILED);
      return written;
    });
    if (saved.ok) afterSave(written, query);
  }

  async function saveAsNew(query) {
    const lessonId = byId('lpSaveLesson').value || null;
    let written = null;
    const saved = await act(() => {
      written = library.saveGroove({ query, title: byId('lpSaveTitle').value.trim(), lessonId });
      selectLesson(lessonId ?? UNFILED);
      return written;
    });
    if (saved.ok) afterSave(written, query);
  }

  submitOnce(byId('lpSaveForm'), async (event) => {
    const pressed = event.submitter;
    if (!(await pageStarted()) || !isActive()) return;
    const parsed = parseGrooveLink(editor.currentQuery());
    if (!parsed.ok) {
      showMessage(LINK_ERRORS[parsed.reason]);
      return;
    }
    if (pressed !== updateButton) {
      await saveAsNew(parsed.query);
      return;
    }
    // The form can be out of date: the groove can be gone, another groove loaded, or the edits
    // undone in the same task as the click, before the form follows them.
    const groove = openSavedGroove();
    const reason = !groove
      ? NOT_OPEN_TO_UPDATE
      : !dirtyState.isDirty(editor.currentQuery()) && NOTHING_TO_UPDATE;
    if (reason) {
      refreshSaveForm();
      showMessage(reason);
      return;
    }
    await updateCurrent(groove, parsed.query);
  });

  return { drawCached, load: () => act(), stop };
}

const IDLE_TIMEOUT_MS = 3000;

// Run a task when the browser is idle, and after 3 s at the latest. Safari has no
// requestIdleCallback, so a plain timer stands in.
function whenIdle(task) {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(task, { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(task, 1);
  }
}

// Connect to Firebase, and return the sign-out action. The hooks tell the page about the
// library: afterPick, libraryShown, signedOut, and showGrooveOpen (see startLibrary).
async function startCloud(search, editor, dirtyState, hooks) {
  const resolved = resolveCloudConfig({ hostname: location.hostname, search });
  if (!resolved) {
    showMessage('Accounts are not set up on this site yet.');
    return null;
  }
  setLoading(true);
  const { sdk, auth, db, persistent } = await connectCloud(resolved);

  // One popup at a time. The button comes back when the popup closes, also without a sign-in.
  const signIn = byId('lpSignIn');
  signIn.onclick = async () => {
    if (signIn.disabled) return;
    signIn.disabled = true;
    showMessage('');
    try {
      await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider());
    } catch (error) {
      if (error.code !== 'auth/popup-closed-by-user') reportFailure(error);
    } finally {
      signIn.disabled = false;
    }
  };

  let activeUid = null;
  let currentSession = null;

  sdk.onAuthStateChanged(auth, async (user) => {
    activeUid = user?.uid ?? null;
    currentSession?.stop();
    currentSession = null;
    const shownUser = user && {
      name: user.displayName || user.email || 'Signed in',
      photoURL: user.photoURL,
    };
    rememberUser(shownUser);
    renderUserMenu(shownUser);
    clearLibrary();
    byId('lpSignedOut').hidden = Boolean(user);
    if (!user) {
      setLoading(false);
      // Queued writes wait for the next sign-in of their user, and that loads the SDK anyway.
      writePendingWritesFlag(false);
      hooks.signedOut();
      return;
    }

    const library = createLibrary(sdk, db, user.uid);
    // Attach the form handlers before the library becomes visible.
    const session = startLibrary({
      library,
      uid: user.uid,
      pageQuery: search,
      isActive: () => activeUid === user.uid,
      persistent,
      editor,
      dirtyState,
      afterPick: hooks.afterPick,
      showGrooveOpen: hooks.showGrooveOpen,
    });

    currentSession = session;

    async function showWhenLoaded() {
      setLoading(true);
      const drewCached = await session.drawCached();
      if (activeUid !== user.uid) return;
      if (drewCached) {
        setLoading(false);
        byId('lpLibrary').hidden = false;
        hooks.libraryShown();
      }
      const loaded = await session.load();
      if (activeUid !== user.uid) return;
      setLoading(false);
      // A refused account sees the message only, and the forms stay hidden. The cached list
      // may be on screen already, so take it away.
      if (loaded.denied) {
        byId('lpLibrary').hidden = true;
        byId('lpLessons').replaceChildren();
        return;
      }
      // An empty answer from the cache says nothing about the library on the server.
      const notOnDevice = loaded.ok && loaded.fromCache && loaded.isEmpty;
      if (notOnDevice) showMessage(NOT_ON_DEVICE);
      if (!loaded.ok || notOnDevice) {
        showRetry(showWhenLoaded);
        return;
      }
      byId('lpLibrary').hidden = false;
      hooks.libraryShown();
      // Offline, the profile would only queue another write for later. The next online load
      // saves it. A failure here must not show an error over a library that works.
      if (!loaded.fromCache) library.saveProfile(user).catch(console.error);
    }
    await showWhenLoaded();
  });

  return { signOut: () => sdk.signOut(auth) };
}

/**
 * Add the Library button and the panel to the editor.
 *
 * @param {object} options
 * @param {string} options.search  The URL query at page start, before the editor rewrites it.
 * @param {Promise<void>} [options.whenReady]  Settles when Play is ready. A panel that opens
 *        by itself waits for it before it starts Firebase.
 * @param {{openGroove: function(string, string): void, currentQuery: function(): string,
 *          currentTitle: function(): string, rename: function(string): void,
 *          onDirtyChange: function(function(boolean): void): function(): void}} options.editor
 * @param {{markClean: function(string): void, isDirty: function(string): boolean,
 *          forget: function(string): void, cleanVersion: function(): number,
 *          startVersion: function(): (number | null),
 *          onRebase: function(function(string, string): void): function(): void,
 *          onStart: function(function(): void): function(): void,
 *          onChange: function(function(): void): function(): void}}
 *        options.dirtyState  Knows the groove that was last loaded or saved. The caller marks
 *        the groove that the page starts with, with markStart.
 * @param {function(function(): void): function(boolean): void} options.initSaveButton  Shows
 *        the Save button of the editor with a click action, and returns the call that shows
 *        whether the groove is saved.
 */
export function initLibraryPanel({
  search,
  editor,
  dirtyState,
  initSaveButton,
  whenReady = Promise.resolve(),
}) {
  const toggle = element('button', {
    id: 'libraryToggle',
    type: 'button',
    className: 'tool tool-filled',
    ariaLabel: 'Open library',
  });
  const toggleContent = element('span', { className: 'tool-in' });
  toggleContent.append(element('i', { className: 'fa fa-bars' }), 'Library');
  toggle.append(toggleContent);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'libraryPanel');
  byId('upperLeft').prepend(toggle);

  const backdrop = element('div', { id: 'libraryBackdrop' });
  const panel = element('aside', { id: 'libraryPanel', innerHTML: PANEL_HTML, inert: true });
  panel.setAttribute('aria-labelledby', 'lpTitle');
  document.body.append(backdrop, panel);

  const docked = window.matchMedia(DOCKED_QUERY);
  let keepOpen = readKeepOpen();
  let started = null;

  function setOpen(isOpen) {
    panel.classList.toggle('open', isOpen);
    backdrop.classList.toggle('open', isOpen);
    document.body.classList.toggle('library-open', isOpen);
    panel.inert = !isOpen;
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Hide library' : 'Open library');
    // A docked panel changes the width of the music, and the music draws to that width.
    window.dispatchEvent(new Event('resize'));
  }

  function rememberDockedChoice(isOpen) {
    if (!docked.matches) return;
    keepOpen = isOpen;
    writeKeepOpen(isOpen);
  }

  function closePanel() {
    // A docked panel is not a dialog. Focus stays on the page, so space still plays.
    const moveFocus = !docked.matches || panel.contains(document.activeElement);
    wantsSaveForm = false;
    rememberDockedChoice(false);
    setOpen(false);
    if (moveFocus) toggle.focus();
  }

  // The Save button asks for the save form. The library shows it when the user is signed in.
  let wantsSaveForm = false;
  let editorDirty = false;
  let grooveOpen = false;

  function showSaveForm() {
    if (!wantsSaveForm || byId('lpLibrary').hidden) return;
    wantsSaveForm = false;
    const tool = byId('lpSaveTool');
    // A form opened from code fills itself on toggle.
    tool.open = true;
    const summary = tool.querySelector('summary');
    summary.focus();
    summary.scrollIntoView({ block: 'nearest' });
  }

  // Signed out, the Save button leads to the sign-in. The form follows after the sign-in.
  function showSignIn() {
    if (wantsSaveForm && panel.classList.contains('open')) byId('lpSignIn').focus();
  }

  function openSaveForm() {
    wantsSaveForm = true;
    if (panel.classList.contains('open')) connect();
    else openPanel();
    showSaveForm();
    if (!byId('lpSignedOut').hidden) showSignIn();
  }

  const showSaved = initSaveButton(openSaveForm);
  const drawSaveButton = () => showSaved(grooveOpen && !editorDirty);

  function connect() {
    started ??= startCloud(search, editor, dirtyState, {
      afterPick: () => {
        if (!docked.matches) closePanel();
      },
      libraryShown: showSaveForm,
      signedOut: showSignIn,
      showGrooveOpen: (isOpen) => {
        grooveOpen = isOpen;
        drawSaveButton();
      },
    }).catch((error) => {
      started = null;
      setLoading(false);
      reportFailure(error);
      showRetry(connect);
      return null;
    });
    return started;
  }

  function openPanel() {
    rememberDockedChoice(true);
    setOpen(true);
    if (!docked.matches) byId('lpClose').focus();
    connect();
  }

  // Turning a tablet changes the mode. A docked panel comes back when the tablet turns back.
  function followScreenWidth() {
    const isOpen = docked.matches && keepOpen;
    setOpen(isOpen);
    if (isOpen) connect();
  }

  async function signOut() {
    const cloud = await connect();
    try {
      await cloud?.signOut();
    } catch (error) {
      console.error(error);
    }
  }

  renderUserMenu(readRememberedUser());
  byId('userMenuSignIn').addEventListener('click', openPanel);
  byId('userMenuSignOut').addEventListener('click', signOut);
  toggle.addEventListener('click', () => {
    if (panel.classList.contains('open')) closePanel();
    else openPanel();
  });
  byId('lpClose').addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);
  // The editor has document-wide hotkeys, such as space for play. Keep them out of the panel.
  panel.addEventListener('keydown', (event) => event.stopPropagation());
  // Listen on the document, because a click on the backdrop can leave focus outside the panel.
  document.addEventListener(
    'keydown',
    (event) => {
      // Escape in the dialog means Keep editing. It must not also close the panel.
      if (isAskingToDiscard()) return;
      if (event.key === 'Escape' && panel.classList.contains('open') && !docked.matches) {
        closePanel();
      }
    },
    true
  );

  // Edits that are not saved are a reason to ask, apart from the writes that pendingSync guards.
  // Each reason has its own listener, so neither one removes the other. The listener is there
  // only while the page has edits: Firefox keeps a page without one in its back-forward cache.
  function warnAboutEdits(event) {
    event.preventDefault();
    event.returnValue = '';
  }
  editor.onDirtyChange((dirty) => {
    editorDirty = dirty;
    if (dirty) window.addEventListener('beforeunload', warnAboutEdits);
    else window.removeEventListener('beforeunload', warnAboutEdits);
    drawSaveButton();
  });

  docked.addEventListener('change', followScreenWidth);
  // A write queued on an earlier visit goes out when the SDK loads, also with the panel closed.
  if (readPendingWritesFlag()) whenReady.then(() => whenIdle(connect));
  if (location.hash === '#library') openPanel();
  else if (docked.matches && keepOpen) {
    // The panel opens at once, but it has nothing to show until Firebase is there. Play comes
    // first: connect when the sound is ready and the browser has nothing better to do.
    setOpen(true);
    setLoading(true);
    whenReady.then(() =>
      whenIdle(() => {
        if (panel.classList.contains('open')) connect();
        else setLoading(false); // hidden while it waited: it connects on the next open
      })
    );
  }
}
