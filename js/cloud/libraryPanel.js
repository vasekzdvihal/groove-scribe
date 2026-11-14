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
import { askToDiscard, isAskingToDiscard } from '../confirmDialog.js';
import { createCurrentGroove, readRecord } from './currentGroove.js';
import { restoredBaseline, sameGroove } from './dirtyState.js';
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
const NO_CHANGES_HINT = 'No changes. Save groove makes a copy.';
const CHANGED_ELSEWHERE =
  'This groove changed or was deleted on another device. Save groove keeps your changes as a new groove.';
const STILL_LOADING = 'The editor is still loading…';
const NOT_STARTED = 'The editor did not finish loading. Reload the page and try again.';
const START_WAIT_MS = 15_000;
// The longest time a redraw of the list waits for a pointer that is down on it.
const POINTER_WAIT_MAX_MS = 1000;

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
      <div class="lp-tools">
        <button id="lpSaveToolButton" class="lp-tool-button" type="button"
            aria-label="Save current groove" aria-expanded="false" aria-controls="lpSaveTool">
          <i class="fa fa-floppy-o" aria-hidden="true"></i><span>Save</span>
        </button>
        <button id="lpLinkToolButton" class="lp-tool-button" type="button"
            aria-label="Add a groove link" aria-expanded="false" aria-controls="lpLinkTool">
          <i class="fa fa-link" aria-hidden="true"></i><span>Add link</span>
        </button>
        <button id="lpLessonToolButton" class="lp-tool-button" type="button"
            aria-label="New lesson" aria-expanded="false" aria-controls="lpLessonTool">
          <i class="fa fa-plus" aria-hidden="true"></i><span>New lesson</span>
        </button>
      </div>
      <div id="lpSaveTool" class="lp-tool" hidden>
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
      </div>
      <div id="lpLinkTool" class="lp-tool" hidden>
        <form id="lpLinkForm">
          <label for="lpLinkUrl">Groove link</label>
          <input id="lpLinkUrl" type="text" autocomplete="off" required>
          <label for="lpLinkTitle">Title</label>
          <input id="lpLinkTitle" type="text" maxlength="200">
          <label for="lpLinkLesson">Lesson</label>
          <select id="lpLinkLesson"></select>
          <button class="lp-primary" type="submit">Add groove</button>
        </form>
      </div>
      <div id="lpLessonTool" class="lp-tool" hidden>
        <form id="lpLessonForm">
          <label for="lpLessonName">Lesson name</label>
          <input id="lpLessonName" type="text" maxlength="200" required>
          <button class="lp-primary" type="submit">Create lesson</button>
        </form>
      </div>
      <div id="lpLessons"></div>
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

// The tool buttons at the top of the library each show one form below them.
const TOOL_IDS = ['lpSaveTool', 'lpLinkTool', 'lpLessonTool'];
// The event that a tool form gets when it opens. The save form fills itself on it.
const TOOL_OPENED = 'lp-tool-opened';
const toolButton = (toolId) => byId(`${toolId}Button`);
const isToolOpen = (toolId) => !byId(toolId).hidden;

// Show one tool form, or none with null. Only one form is open at a time.
function showTool(openId) {
  for (const id of TOOL_IDS) {
    const wasOpen = isToolOpen(id);
    const isOpen = id === openId;
    byId(id).hidden = !isOpen;
    toolButton(id).setAttribute('aria-expanded', String(isOpen));
    if (isOpen && !wasOpen) byId(id).dispatchEvent(new Event(TOOL_OPENED));
  }
}

// Escape in an open tool form closes it, and focus goes back to its button. Returns true when
// it closed a form.
function closeToolOf(target) {
  const toolId = TOOL_IDS.find((id) => isToolOpen(id) && byId(id).contains(target));
  if (!toolId) return false;
  showTool(null);
  toolButton(toolId).focus();
  return true;
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
    const tool = form.closest('.lp-tool');
    const toolWasOpen = Boolean(tool && !tool.hidden);
    const buttons = [...form.querySelectorAll('button')];
    for (const node of buttons) node.disabled = true;
    try {
      await handler(event);
    } finally {
      running = false;
      for (const node of buttons) node.disabled = false;
      const focusLost = !document.activeElement || document.activeElement === document.body;
      // A save closes its form. Focus then goes to the button that opens the form.
      const target = toolWasOpen && tool.hidden ? toolButton(tool.id) : pressed;
      if (target?.isConnected && focusLost) target.focus();
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

// A reload shows the name of the open groove before the Firebase SDK loads: the tab kept it
// with the record of the open groove. The name shows only when the page has the clean groove
// of that record. The library decides later, and a groove that is not open any more loses it.
function nameGrooveOfLastVisit(uid, search, editor) {
  const record = uid ? readRecord(uid) : null;
  const clean = restoredBaseline(search);
  if (record?.name && typeof clean === 'string' && sameGroove(record.editorQuery, clean)) {
    editor.setNameWhenUntitled(record.name);
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
    anchor.replaceChildren(
      element('i', { className: 'fa fa-user' }),
      ' ',
      element('span', { className: 'signin-label', textContent: 'Sign in' })
    );
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
  isActive: isSignedIn,
  persistent,
  editor,
  dirtyState,
  afterPick,
  showGrooveSaved,
}) {
  let lessons = [];
  let grooves = [];
  // The id that render highlights.
  let openGrooveId = null;
  // The one ⋯ menu that is open, as a menuKey of a lesson or a groove, or null.
  let openMenu = null;
  let openLesson = readLastLesson();
  // The lesson that the user closed. A redraw keeps it closed until a lesson opens.
  let closedLesson = null;
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
    const wasRestoring = currentGroove.isRestoring();
    const restored = currentGroove.restore(fromServer);
    // A dropped record needs a draw too: it takes the name of the last visit off the top bar.
    const decided = wasRestoring && !currentGroove.isRestoring();
    if (redraw || restored || decided || next !== drawn) render();
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

  // Read the server and draw the answer, unless a newer one is on screen. It does not touch
  // the message. On a network that hangs, the SDK answers from the cache.
  async function readLatest() {
    const number = nextNumber();
    const [nextLessons, nextGrooves] = await readServer();
    if (!isActive()) return;
    drawIfNewest(number, nextLessons.items, nextGrooves.items, false, !nextGrooves.fromCache);
  }

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

  const currentGroove = createCurrentGroove({
    uid,
    dirtyState,
    editor,
    grooves: () => grooves,
    isActive,
    // A groove restored before the page marked its start becomes open only then. Draw it. A
    // save form opened before has the title of the default groove: fill it again, unless the
    // user typed.
    onStart() {
      render();
      if (isToolOpen('lpSaveTool') && !saveTitleTyped) prefillSaveForm();
    },
    // Another groove, from the Grooves menu for example, closes the open saved groove.
    onCleanChange() {
      if ((openSavedGroove()?.id ?? null) !== openGrooveId) render();
    },
  });

  // An edit or an Undo switches an open save form between Update and the plain save.
  const stopDirty = editor.onDirtyChange(() => {
    if (isActive()) render();
  });

  // Another tab or device can change the library. Read it again when the user comes back to
  // the tab and when the network returns, so a stale "Saved" and stale lists do not stay, for
  // example in a rehearsal room. One read at a time. A failure keeps what is on screen.
  let refreshing = false;
  async function refresh() {
    if (document.visibilityState !== 'visible' || refreshing || !isActive()) return;
    refreshing = true;
    try {
      await readLatest();
    } catch (error) {
      console.warn('The library could not be read again:', error);
    } finally {
      refreshing = false;
    }
  }
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('online', refresh);

  // A redraw replaces every row of the list. A click that started on a row before a redraw ends
  // on a new button, so the browser sends no click and the pick is lost. A redraw comes when a
  // server answer arrives or the editor turns clean or dirty, at any moment. While the pointer
  // is down on the list, the redraw waits until the click has run.
  let pointerDown = false;
  let renderWaits = false;
  let pointerTimer = 0;
  function onPointerDown() {
    pointerDown = true;
    clearTimeout(pointerTimer);
    // A pointerup that never arrives must not stop the list from drawing.
    pointerTimer = setTimeout(onPointerEnd, POINTER_WAIT_MAX_MS);
  }
  function onPointerEnd() {
    if (!pointerDown) return;
    pointerDown = false;
    clearTimeout(pointerTimer);
    // The click comes after the pointerup, in the same task. Draw after it.
    if (renderWaits) {
      setTimeout(() => {
        if (renderWaits && isActive()) render();
      }, 0);
    }
  }
  byId('lpLessons').addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointerup', onPointerEnd, true);
  document.addEventListener('pointercancel', onPointerEnd, true);

  // The session is over: nothing may keep running for it.
  function stop() {
    stopped = true;
    clearTimeout(pointerTimer);
    byId('lpLessons').removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointerup', onPointerEnd, true);
    document.removeEventListener('pointercancel', onPointerEnd, true);
    byId('lpSaveTool').removeEventListener(TOOL_OPENED, prefillSaveForm);
    sync.stop();
    currentGroove.stop();
    stopDirty();
    document.removeEventListener('visibilitychange', refresh);
    window.removeEventListener('online', refresh);
    showGrooveSaved(false);
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

  // Draw a new open groove. A docked panel can have the save form open: it is now about it.
  function showCurrentGroove() {
    render();
    if (isToolOpen('lpSaveTool')) prefillSaveForm();
  }

  // Call after markClean: the groove in the editor is now this saved groove.
  function setCurrentGroove(id, savedQuery, name) {
    currentGroove.set(id, savedQuery, name);
    showCurrentGroove();
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

  // The groove in the editor takes the new name of its saved groove. See followRename.
  function showNewName(written, wasClean) {
    const followed = currentGroove.followRename(written, wasClean);
    if (followed === 'clean') showCurrentGroove();
    else if (followed) render();
  }

  // The saved groove that the editor shows, or null.
  const openSavedGroove = () => currentGroove.open();

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
        openMenu = null;
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
    closedLesson = null;
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

  // A ⋯ button opens its menu and closes any other one. The redraw replaces the button, so
  // focus goes to the new one: a keyboard user can press it again.
  function moreButton(key, label) {
    const isMenuOpen = openMenu === key;
    const more = button(
      '⋯',
      () => {
        openMenu = isMenuOpen ? null : key;
        render();
        const next = [...byId('lpLessons').querySelectorAll('.lp-more')].find(
          (node) => node.dataset.menu === key
        );
        const focusLost = !document.activeElement || document.activeElement === document.body;
        if (next && focusLost) next.focus();
      },
      { className: 'lp-more', ariaLabel: `Options for ${label}` }
    );
    more.dataset.menu = key;
    more.setAttribute('aria-expanded', String(isMenuOpen));
    return more;
  }

  function grooveRow(groove, lessonKey) {
    const name = grooveName(groove);
    const menuKey = `groove:${groove.id}`;
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
        setCurrentGroove(groove.id, groove.query, name);
        afterPick();
      },
      { className: 'lp-open' }
    );
    if (openGrooveId === groove.id) open.setAttribute('aria-current', 'true');
    return element('li', { className: 'lp-groove' }, [
      open,
      ...syncLabel(groove),
      moreButton(menuKey, name),
      ...(openMenu === menuKey ? [grooveActions(groove)] : []),
    ]);
  }

  function lessonActions(lesson) {
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

  // Open or close a lesson. Keep one lesson open, so that a long library stays short.
  function setLessonOpen(section, isOpen) {
    section.querySelector('.lp-lesson-toggle').setAttribute('aria-expanded', String(isOpen));
    section.querySelector('.lp-lesson-body').hidden = !isOpen;
  }

  // The heading of a lesson: the name opens and closes it, and ⋯ opens its menu. ⋯ is not
  // inside the name button, so it does not open or close the lesson.
  function lessonSection(lesson, lessonGrooves, isOpen) {
    const key = lesson?.id ?? UNFILED;
    const name = lesson?.name ?? 'No lesson';
    const menuKey = `lesson:${key}`;
    const bodyId = `lpLessonBody-${key}`;
    const toggle = element('button', { type: 'button', className: 'lp-lesson-toggle' }, [
      element('span', { textContent: name }),
    ]);
    toggle.setAttribute('aria-controls', bodyId);
    const head = element('div', { className: 'lp-lesson-head' }, [
      toggle,
      ...(lesson ? syncLabel(lesson) : []),
      ...(lesson ? [moreButton(menuKey, name)] : []),
      element('small', { className: 'lp-count', textContent: String(lessonGrooves.length) }),
    ]);
    const body = element('div', { id: bodyId, className: 'lp-lesson-body' }, [
      lessonGrooves.length
        ? element(
            'ul',
            {},
            lessonGrooves.map((groove) => grooveRow(groove, key))
          )
        : element('p', { className: 'lp-empty', textContent: 'No grooves yet.' }),
    ]);
    const section = element('section', { className: 'lp-lesson' }, [
      head,
      ...(lesson && openMenu === menuKey ? [lessonActions(lesson)] : []),
      body,
    ]);
    setLessonOpen(section, isOpen);
    // A tap anywhere on the heading but ⋯ opens or closes the lesson, as the name does.
    head.addEventListener('click', (event) => {
      if (event.target.closest('.lp-more')) return;
      const opens = toggle.getAttribute('aria-expanded') !== 'true';
      setLessonOpen(section, opens);
      if (!opens) {
        closedLesson = key;
        return;
      }
      selectLesson(key);
      for (const other of byId('lpLessons').querySelectorAll('.lp-lesson')) {
        if (other !== section) setLessonOpen(other, false);
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
  // save. Enter in the title presses the first button. An open groove without edits, for
  // example after a tap on "Saved", says why there is no Update.
  function refreshSaveForm() {
    const groove = openSavedGroove();
    const canUpdate = Boolean(groove) && dirtyState.isDirty(editor.currentQuery());
    const saveNew = byId('lpSaveNew');
    saveNew.textContent = canUpdate ? 'Save as new' : 'Save groove';
    saveNew.className = canUpdate ? '' : 'lp-primary';
    const hint = byId('lpUpdateHint');
    if (canUpdate) {
      hint.textContent = `Update saves the changes in "${grooveName(groove)}". Save as new keeps it as it is.`;
    } else {
      hint.textContent = groove ? NO_CHANGES_HINT : '';
    }
    hint.hidden = !hint.textContent;
    byId('lpSaveButtons').replaceChildren(...(canUpdate ? [updateButton, saveNew] : [saveNew]));
    return canUpdate ? groove : null;
  }

  function render() {
    // See onPointerDown: a click on the list is in progress.
    if (pointerDown) {
      renderWaits = true;
      return;
    }
    renderWaits = false;
    for (const id of ['lpSaveLesson', 'lpLinkLesson']) {
      const select = byId(id);
      const known = lessons.some((lesson) => lesson.id === openLesson);
      // A redraw must not file the groove in another lesson, also when it is "No lesson". The
      // open save form keeps its lesson: Update moves the groove there. The link form follows
      // the open lesson until the user picks one.
      const keep =
        select.options.length > 0 &&
        (id === 'lpSaveLesson' ? isToolOpen('lpSaveTool') : linkLessonPicked);
      const selected = keep ? select.value : select.value || (known && openLesson);
      select.replaceChildren(...lessonOptions(lessons, selected));
    }
    const openGroove = openSavedGroove();
    openGrooveId = openGroove?.id ?? null;
    // The top bar names the open groove while its address has no title. Until the library has
    // decided about the groove of the last visit, the name from that visit stays.
    if (openGroove) editor.setNameWhenUntitled(grooveName(openGroove));
    else if (!currentGroove.isRestoring()) editor.setNameWhenUntitled('');
    // Without a persistent cache, a write that waits is lost when the tab closes: not saved yet.
    showGrooveSaved(Boolean(openGroove) && (persistent || !isPending(openGroove)));
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
        ? entries.map(({ lesson, key, items }) =>
            lessonSection(lesson, items, key === openKey && key !== closedLesson)
          )
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

  // The save form fills itself when it opens, from its button or from code. The event comes
  // in the same task, so the user cannot have typed yet.
  byId('lpSaveTool').addEventListener(TOOL_OPENED, prefillSaveForm);

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

  // The editor now shows the saved groove, unless the server refuses the write later. The
  // stored query has the library title in it, which can differ from the title in the editor.
  // The editor takes the stored name, a typed one or the library name of an Updated groove, so
  // "Saved" never shows over an old title. The renamed groove is the clean one.
  function afterSave(written, query) {
    let clean = query;
    if (written.title !== editor.currentTitle()) {
      editor.rename(written.title);
      clean = editor.currentQuery();
    }
    dirtyState.markClean(clean);
    // A save that the server refuses later did not save the edits.
    written.committed.catch(() => dirtyState.forget(clean));
    setCurrentGroove(written.id, written.query, written.title);
    if (isToolOpen('lpSaveTool')) showTool(null);
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
    if (!(await stillOnServer(groove))) return;
    // An edit can come during the server read: Update saves the groove as it is now.
    const latest = parseGrooveLink(editor.currentQuery());
    await updateCurrent(openSavedGroove(), latest.ok ? latest.query : parsed.query);
  });

  // Another device can have changed the groove since this device read it. Online, read the
  // server first: Update must not write over that change. The new list closes the groove, and
  // the form offers the plain save. Offline, the write waits, and the last writer wins after the
  // sync. Returns true when Update can write.
  async function stillOnServer(groove) {
    if (!navigator.onLine) return true;
    try {
      await readLatest();
    } catch (error) {
      if (isActive()) reportFailure(error);
      return false;
    }
    if (!isActive()) return false;
    if (openSavedGroove()?.id === groove.id) return true;
    showMessage(CHANGED_ELSEWHERE);
    return false;
  }

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
// library: afterPick, libraryShown, signedOut, and showGrooveSaved (see startLibrary).
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
      uid: user.uid,
    };
    rememberUser(shownUser);
    renderUserMenu(shownUser);
    clearLibrary();
    byId('lpSignedOut').hidden = Boolean(user);
    if (!user) {
      setLoading(false);
      // No user: no library groove is open, and the name of the last visit is not true.
      editor.setNameWhenUntitled('');
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
      isActive: () => activeUid === user.uid,
      persistent,
      editor,
      dirtyState,
      afterPick: hooks.afterPick,
      showGrooveSaved: hooks.showGrooveSaved,
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
 *          setNameWhenUntitled: function(string): void,
 *          onDirtyChange: function(function(boolean): void): function(): void}} options.editor
 * @param {ReturnType<typeof import('./dirtyState.js').createDirtyState>} options.dirtyState  Knows the groove that was last loaded or saved. The caller marks
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
  // The editor shows a saved groove, and the save is safe on this device.
  let grooveSaved = false;

  function showSaveForm() {
    if (!wantsSaveForm || byId('lpLibrary').hidden) return;
    wantsSaveForm = false;
    // The form fills itself when it opens.
    showTool('lpSaveTool');
    // A docked panel is not a dialog: focus stays on the page, so space still plays.
    if (!docked.matches) toolButton('lpSaveTool').focus();
    byId('lpSaveTool').scrollIntoView({ block: 'nearest' });
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
  const drawSaveButton = () => showSaved(grooveSaved && !editorDirty);

  function connect() {
    started ??= startCloud(search, editor, dirtyState, {
      afterPick: () => {
        if (!docked.matches) closePanel();
      },
      libraryShown: showSaveForm,
      signedOut: showSignIn,
      showGrooveSaved: (isSaved) => {
        grooveSaved = isSaved;
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

  const remembered = readRememberedUser();
  renderUserMenu(remembered);
  nameGrooveOfLastVisit(remembered?.uid, search, editor);
  byId('userMenuSignIn').addEventListener('click', openPanel);
  byId('userMenuSignOut').addEventListener('click', signOut);
  toggle.addEventListener('click', () => {
    if (panel.classList.contains('open')) closePanel();
    else openPanel();
  });
  byId('lpClose').addEventListener('click', closePanel);
  for (const id of TOOL_IDS) {
    toolButton(id).addEventListener('click', () => {
      showTool(isToolOpen(id) ? null : id);
      if (isToolOpen(id)) byId(id).scrollIntoView({ block: 'nearest' });
    });
  }
  backdrop.addEventListener('click', closePanel);
  // The editor has document-wide hotkeys, such as space for play. Keep them out of the panel.
  panel.addEventListener('keydown', (event) => event.stopPropagation());
  // Listen on the document, because a click on the backdrop can leave focus outside the panel.
  document.addEventListener(
    'keydown',
    (event) => {
      // Escape in the dialog means Keep editing. It must not also close the panel.
      if (isAskingToDiscard()) return;
      // Escape in a tool form closes the form only.
      if (event.key === 'Escape' && closeToolOf(event.target)) return;
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
