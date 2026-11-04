// The library panel in the editor: Google sign-in, lessons, and saved grooves.
//
// This module is small and loads with the editor. The Firebase SDK loads only when
// the user opens the panel, so people who open a shared link never download it.
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
  <footer id="lpAccount" hidden></footer>
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

function reportFailure(error) {
  console.error(error);
  showMessage('That did not work. Check your connection and try again.');
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

function renderAccount(user, onSignOut) {
  const photo = user.photoURL
    ? [element('img', { src: user.photoURL, alt: '', referrerPolicy: 'no-referrer' })]
    : [];
  byId('lpAccount').replaceChildren(
    ...photo,
    element('span', { textContent: user.displayName || user.email || 'Signed in' }),
    button('Sign out', onSignOut)
  );
  byId('lpAccount').hidden = false;
}

// Remove everything that belongs to the previous user.
function clearLibrary() {
  byId('lpLibrary').hidden = true;
  byId('lpAccount').hidden = true;
  byId('lpAccount').replaceChildren();
  byId('lpLessons').replaceChildren();
  byId('lpSaveLesson').replaceChildren();
  byId('lpLinkLesson').replaceChildren();
  for (const id of ['lpSaveForm', 'lpLinkForm', 'lpLessonForm']) byId(id).reset();
  showMessage('');
}

function startLibrary({ library, isActive, editor, closePanel }) {
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
      return { ok: false };
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
        editor.openGroove(groove.query);
        closePanel();
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

async function startCloud(search, editor, closePanel) {
  const resolved = resolveCloudConfig({ hostname: location.hostname, search });
  if (!resolved) {
    showMessage('Accounts are not set up on this site yet.');
    return;
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
    clearLibrary();
    byId('lpLoading').hidden = true;
    byId('lpSignedOut').hidden = Boolean(user);
    if (!user) return;

    renderAccount(user, () => sdk.signOut(auth).catch(reportFailure));
    const library = createLibrary(sdk, db, user.uid);
    byId('lpLoading').hidden = false;
    // Attach the form handlers before the library becomes visible.
    await startLibrary({
      library,
      isActive: () => activeUid === user.uid,
      editor,
      closePanel,
    });
    if (activeUid !== user.uid) return;
    byId('lpLoading').hidden = true;
    byId('lpLibrary').hidden = false;
    library.saveProfile(user).catch(reportFailure);
  });
}

/**
 * Add the Library button and the slide-in panel to the editor.
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
    className: 'rightButtons',
    ariaLabel: 'Open library',
  });
  toggle.append(element('i', { className: 'fa fa-bars' }), ' Library');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'libraryPanel');
  byId('upperLeft').prepend(toggle);

  const backdrop = element('div', { id: 'libraryBackdrop' });
  const panel = element('aside', { id: 'libraryPanel', innerHTML: PANEL_HTML, inert: true });
  panel.setAttribute('aria-labelledby', 'lpTitle');
  document.body.append(backdrop, panel);

  let started = null;

  function setOpen(isOpen) {
    panel.classList.toggle('open', isOpen);
    backdrop.classList.toggle('open', isOpen);
    panel.inert = !isOpen;
    toggle.setAttribute('aria-expanded', String(isOpen));
  }

  function closePanel() {
    setOpen(false);
    toggle.focus();
  }

  function openPanel() {
    setOpen(true);
    byId('lpClose').focus();
    started ??= startCloud(search, editor, closePanel).catch((error) => {
      started = null;
      byId('lpLoading').hidden = true;
      reportFailure(error);
    });
  }

  toggle.addEventListener('click', openPanel);
  byId('lpClose').addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);
  // The editor has document-wide hotkeys, such as space for play. Keep them out of the panel.
  panel.addEventListener('keydown', (event) => event.stopPropagation());
  // Listen on the document, because a click on the backdrop can leave focus outside the panel.
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && panel.classList.contains('open')) closePanel();
    },
    true
  );

  if (location.hash === '#library') openPanel();
}
