// The library panel in the editor: Google sign-in, lessons, and saved grooves.
//
// On a wide screen the panel stays next to the music until the user hides it. On a narrow
// screen it slides over the editor, and picking a groove closes it.
//
// This module is small and loads with the editor. The Firebase SDK loads only when the panel
// opens. It opens by itself only for people who were signed in on this device or who left it
// open, so people who open a shared link never download the SDK.
import { connectCloud, resolveCloudConfig } from './firebaseClient.js';
import { parseGrooveLink } from './grooveLink.js';
import { createLibrary } from './library.js';

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

const PANEL_HTML = `
  <header class="lp-head">
    <h2 id="lpTitle">My library</h2>
    <button id="lpClose" type="button" aria-label="Close library">✕</button>
  </header>
  <div class="lp-body">
    <p id="lpMessage" role="alert" hidden></p>
    <p id="lpLoading" hidden>Loading…</p>
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
          <button class="lp-primary" type="submit">Save groove</button>
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

// The top bar shows the user before the Firebase SDK loads, so people who open a shared
// link never download it. The name and photo are kept on this device from the last visit.
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
  showMessage('');
}

function startLibrary({ library, isActive, editor, afterPick }) {
  let lessons = [];
  let grooves = [];
  let currentGrooveId = null;
  let menuGrooveId = null;
  let openLesson = readLastLesson();

  // Run one change, then redraw from the server. Failures stay on screen.
  async function act(change) {
    showMessage('');
    try {
      const result = await change?.();
      const [nextLessons, nextGrooves] = await Promise.all([
        library.listLessons(),
        library.listGrooves(),
      ]);
      // A slow response must not draw into another user's session.
      if (!isActive()) return { ok: false };
      lessons = nextLessons;
      grooves = nextGrooves;
      menuGrooveId = null;
      render();
      return { ok: true, result };
    } catch (error) {
      if (isActive()) reportFailure(error);
      return { ok: false, denied: isDenied(error) };
    }
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
      act(() => library.moveGroove(groove.id, move.value || null))
    );
    const rename = button('Rename', () => {
      const title = prompt('Groove name', groove.title)?.trim();
      if (title) act(() => library.renameGroove(groove.id, title));
    });
    const remove = button(
      'Delete',
      () => {
        if (confirm(`Delete "${name}"?`)) act(() => library.deleteGroove(groove.id));
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
      () => {
        currentGrooveId = groove.id;
        selectLesson(lessonKey);
        render();
        editor.openGroove(groove.query, name);
        afterPick();
      },
      { className: 'lp-open' }
    );
    if (currentGrooveId === groove.id) open.setAttribute('aria-current', 'true');
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
    // Keep one lesson open, so that a long library stays short.
    section.addEventListener('toggle', () => {
      if (!section.open) return;
      selectLesson(key);
      for (const other of byId('lpLessons').querySelectorAll('.lp-lesson')) {
        if (other !== section) other.open = false;
      }
    });
    return section;
  }

  function render() {
    for (const id of ['lpSaveLesson', 'lpLinkLesson']) {
      const select = byId(id);
      const known = lessons.some((lesson) => lesson.id === openLesson);
      select.replaceChildren(...lessonOptions(lessons, select.value || (known && openLesson)));
    }
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

  byId('lpSaveTool').ontoggle = () => {
    if (byId('lpSaveTool').open) byId('lpSaveTitle').value = editor.currentTitle();
  };

  byId('lpLessonForm').onsubmit = async (event) => {
    event.preventDefault();
    const name = byId('lpLessonName').value.trim();
    if (!name) return;
    const created = await act(async () => {
      const id = await library.createLesson(name);
      selectLesson(id);
      return id;
    });
    if (created.ok) byId('lpLessonName').value = '';
  };

  byId('lpLinkUrl').oninput = () => {
    const parsed = parseGrooveLink(byId('lpLinkUrl').value);
    if (parsed.ok && !byId('lpLinkTitle').value) byId('lpLinkTitle').value = parsed.title;
  };

  byId('lpLinkForm').onsubmit = async (event) => {
    event.preventDefault();
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
      byId('lpLinkTitle').value = '';
    }
  };

  byId('lpSaveForm').onsubmit = async (event) => {
    event.preventDefault();
    const parsed = parseGrooveLink(editor.currentQuery());
    if (!parsed.ok) {
      showMessage(LINK_ERRORS[parsed.reason]);
      return;
    }
    const lessonId = byId('lpSaveLesson').value || null;
    const saved = await act(async () => {
      const id = await library.saveGroove({
        query: parsed.query,
        title: byId('lpSaveTitle').value.trim(),
        lessonId,
      });
      currentGrooveId = id;
      selectLesson(lessonId ?? UNFILED);
      return id;
    });
    if (saved.ok) byId('lpSaveTool').open = false;
  };

  return act();
}

// Connect to Firebase, and return the sign-out action.
async function startCloud(search, editor, afterPick) {
  const resolved = resolveCloudConfig({ hostname: location.hostname, search });
  if (!resolved) {
    showMessage('Accounts are not set up on this site yet.');
    return null;
  }
  byId('lpLoading').hidden = false;
  const { sdk, auth, db } = await connectCloud(resolved);

  byId('lpSignIn').onclick = async () => {
    showMessage('');
    try {
      await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider());
    } catch (error) {
      if (error.code !== 'auth/popup-closed-by-user') reportFailure(error);
    }
  };

  let activeUid = null;

  sdk.onAuthStateChanged(auth, async (user) => {
    activeUid = user?.uid ?? null;
    const shownUser = user && {
      name: user.displayName || user.email || 'Signed in',
      photoURL: user.photoURL,
    };
    rememberUser(shownUser);
    renderUserMenu(shownUser);
    clearLibrary();
    byId('lpLoading').hidden = true;
    byId('lpSignedOut').hidden = Boolean(user);
    if (!user) return;

    const library = createLibrary(sdk, db, user.uid);
    byId('lpLoading').hidden = false;
    // Attach the form handlers before the library becomes visible.
    const started = await startLibrary({
      library,
      isActive: () => activeUid === user.uid,
      editor,
      afterPick,
    });
    if (activeUid !== user.uid) return;
    byId('lpLoading').hidden = true;
    // A refused account sees the message only, and the forms stay hidden.
    if (started.denied) return;
    byId('lpLibrary').hidden = false;
    library.saveProfile(user).catch(reportFailure);
  });

  return { signOut: () => sdk.signOut(auth) };
}

/**
 * Add the Library button and the panel to the editor.
 *
 * @param {object} options
 * @param {string} options.search  The URL query at page start, before the editor rewrites it.
 * @param {{openGroove: function(string): void, currentQuery: function(): string,
 *          currentTitle: function(): string}} options.editor
 */
export function initLibraryPanel({ search, editor }) {
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
    rememberDockedChoice(false);
    setOpen(false);
    if (moveFocus) toggle.focus();
  }

  function connect() {
    started ??= startCloud(search, editor, () => {
      if (!docked.matches) closePanel();
    }).catch((error) => {
      started = null;
      byId('lpLoading').hidden = true;
      reportFailure(error);
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
      if (event.key === 'Escape' && panel.classList.contains('open') && !docked.matches) {
        closePanel();
      }
    },
    true
  );

  docked.addEventListener('change', followScreenWidth);
  if (location.hash === '#library') openPanel();
  else if (docked.matches && keepOpen) followScreenWidth();
}
