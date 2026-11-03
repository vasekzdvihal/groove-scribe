// The library page: Google sign-in, profile, lessons, and saved grooves.
import { connectCloud, resolveCloudConfig } from './firebaseClient.js';
import { parseGrooveLink } from './grooveLink.js';
import { createLibrary } from './library.js';

const LINK_ERRORS = {
  'short-link':
    'This is a short link. Open it in your browser, then paste the full address it opens.',
  'not-a-groove': 'This link does not contain a groove.',
  'too-long': 'This groove is too long to save.',
};

const byId = (id) => document.getElementById(id);

function element(tag, properties = {}, children = []) {
  const node = Object.assign(document.createElement(tag), properties);
  node.append(...children);
  return node;
}

function showMessage(text) {
  const message = byId('message');
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
  const signOutButton = element('button', { type: 'button', textContent: 'Sign out' });
  signOutButton.addEventListener('click', onSignOut);
  const photo = user.photoURL
    ? [element('img', { src: user.photoURL, alt: '', referrerPolicy: 'no-referrer' })]
    : [];
  byId('account').replaceChildren(
    ...photo,
    element('span', { textContent: user.displayName || user.email || 'Signed in' }),
    signOutButton
  );
}

// Remove everything that belongs to the previous user.
function clearLibrary() {
  byId('library').hidden = true;
  byId('account').replaceChildren();
  byId('lessons').replaceChildren();
  byId('saveLesson').replaceChildren();
  byId('saveForm').reset();
  byId('lessonForm').reset();
  showMessage('');
}

function startLibrary(library, isActive) {
  let lessons = [];
  let grooves = [];

  // Run one change, then redraw from the server. Failures stay on screen.
  async function act(change) {
    showMessage('');
    try {
      await change?.();
      const [nextLessons, nextGrooves] = await Promise.all([
        library.listLessons(),
        library.listGrooves(),
      ]);
      // A slow response must not draw into another user's session.
      if (!isActive()) return false;
      lessons = nextLessons;
      grooves = nextGrooves;
      render();
      return true;
    } catch (error) {
      if (isActive()) reportFailure(error);
      return false;
    }
  }

  function grooveRow(groove) {
    const move = element(
      'select',
      { ariaLabel: `Lesson for ${groove.title || 'Untitled groove'}` },
      lessonOptions(lessons, groove.lessonId)
    );
    move.addEventListener('change', () =>
      act(() => library.moveGroove(groove.id, move.value || null))
    );
    const remove = element('button', {
      type: 'button',
      className: 'danger',
      textContent: 'Delete',
    });
    remove.addEventListener('click', () => {
      if (confirm(`Delete "${groove.title || 'Untitled groove'}"?`)) {
        act(() => library.deleteGroove(groove.id));
      }
    });
    return element('li', { className: 'groove' }, [
      element('a', {
        href: 'index.html' + groove.query,
        textContent: groove.title || 'Untitled groove',
      }),
      move,
      remove,
    ]);
  }

  function lessonSection(lesson, lessonGrooves) {
    const heading = element('h2', { textContent: lesson?.name ?? 'No lesson' });
    const controls = [];
    if (lesson) {
      const rename = element('button', { type: 'button', textContent: 'Rename' });
      rename.addEventListener('click', () => {
        const name = prompt('Lesson name', lesson.name)?.trim();
        if (name) act(() => library.renameLesson(lesson.id, name));
      });
      const remove = element('button', {
        type: 'button',
        className: 'danger',
        textContent: 'Delete',
      });
      remove.addEventListener('click', () => {
        if (confirm(`Delete lesson "${lesson.name}"? Its grooves stay in your library.`)) {
          act(() => library.deleteLesson(lesson.id));
        }
      });
      controls.push(rename, remove);
    }
    const body = lessonGrooves.length
      ? element('ul', { className: 'groove-list' }, lessonGrooves.map(grooveRow))
      : element('p', { className: 'empty', textContent: 'No grooves yet.' });
    return element('section', { className: 'lesson' }, [
      element('div', { className: 'lesson-header' }, [heading, ...controls]),
      body,
    ]);
  }

  function render() {
    const select = byId('saveLesson');
    select.replaceChildren(...lessonOptions(lessons, select.value));
    const known = new Set(lessons.map((lesson) => lesson.id));
    const unfiled = grooves.filter((groove) => !known.has(groove.lessonId));
    const sections = [
      ...lessons.map((lesson) =>
        lessonSection(
          lesson,
          grooves.filter((groove) => groove.lessonId === lesson.id)
        )
      ),
      ...(unfiled.length ? [lessonSection(null, unfiled)] : []),
    ];
    byId('lessons').replaceChildren(
      ...(sections.length
        ? sections
        : [
            element('p', {
              className: 'empty',
              textContent: 'Your library is empty. Add a groove link or create a lesson.',
            }),
          ])
    );
  }

  byId('lessonForm').onsubmit = async (event) => {
    event.preventDefault();
    const name = byId('lessonName').value.trim();
    if (!name) return;
    if (await act(() => library.createLesson(name))) byId('lessonName').value = '';
  };

  byId('grooveLink').oninput = () => {
    const parsed = parseGrooveLink(byId('grooveLink').value);
    if (parsed.ok && !byId('grooveTitle').value) byId('grooveTitle').value = parsed.title;
  };

  byId('saveForm').onsubmit = async (event) => {
    event.preventDefault();
    const parsed = parseGrooveLink(byId('grooveLink').value);
    if (!parsed.ok) {
      showMessage(LINK_ERRORS[parsed.reason]);
      return;
    }
    const saved = await act(() =>
      library.saveGroove({
        query: parsed.query,
        title: byId('grooveTitle').value.trim(),
        lessonId: byId('saveLesson').value || null,
      })
    );
    if (saved) {
      byId('grooveLink').value = '';
      byId('grooveTitle').value = '';
    }
  };

  return act();
}

// A groove sent from the editor waits in the form until the user picks a lesson.
function prefillFromUrl() {
  const params = new URLSearchParams(location.search);
  const incoming = params.get('save');
  if (!incoming) return;
  byId('grooveLink').value = incoming;
  byId('grooveLink').dispatchEvent(new Event('input'));
  params.delete('save');
  const rest = params.toString();
  history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
}

async function start() {
  const resolved = resolveCloudConfig(location);
  if (!resolved) {
    showMessage('Accounts are not set up on this site yet.');
    return;
  }
  const { sdk, auth, db } = await connectCloud(resolved);

  byId('signIn').addEventListener('click', async () => {
    showMessage('');
    try {
      await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider());
    } catch (error) {
      if (error.code !== 'auth/popup-closed-by-user') reportFailure(error);
    }
  });

  let activeUid = null;

  sdk.onAuthStateChanged(auth, (user) => {
    activeUid = user?.uid ?? null;
    clearLibrary();
    byId('signedOut').hidden = Boolean(user);
    if (!user) return;

    renderAccount(user, () => sdk.signOut(auth).catch(reportFailure));
    const library = createLibrary(sdk, db, user.uid);
    // Attach the form handlers before the library becomes visible.
    startLibrary(library, () => activeUid === user.uid);
    prefillFromUrl();
    byId('library').hidden = false;
    library.saveProfile(user).catch(reportFailure);
  });
}

start().catch(reportFailure);
