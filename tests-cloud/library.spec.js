import { expect, test } from '@playwright/test';

const QUERY = '?TimeSig=4/4&Div=16&Title=Paradiddle&Tempo=95&Measures=1&H=|x-x-|&S=|--O-|&K=|o---|';
const EDITOR = '/index.html?emulator=1';
const DOCUMENTS =
  'http://127.0.0.1:8080/v1/projects/demo-groovescribe/databases/(default)/documents';
const OWNER = { Authorization: 'Bearer owner' };

// Read a collection from the emulator as the owner, past the rules.
async function savedDocs(page, collection) {
  const response = await page.request.get(`${DOCUMENTS}/${collection}`, { headers: OWNER });
  const { documents = [] } = await response.json();
  return documents.map((item) => ({ id: item.name.split('/').pop(), ...item.fields }));
}

async function clearEmulators(request) {
  await request.delete(
    'http://127.0.0.1:8080/emulator/v1/projects/demo-groovescribe/databases/(default)/documents'
  );
  await request.delete('http://127.0.0.1:9099/emulator/v1/projects/demo-groovescribe/accounts', {
    headers: { Authorization: 'Bearer owner' },
  });
}

async function openEditor(page, url = EDITOR) {
  await page.goto(url);
  await page.waitForSelector('#svgTarget svg');
}

const openPanel = (page) => page.getByRole('button', { name: 'Open library' }).click();

const idTokenFor = (address) =>
  JSON.stringify({ sub: address, email: address, email_verified: true });

// Create the emulator account for an address, and add it to the allowlist. Signing in with
// the same credential later reaches this account, so the library finds its allowlist entry.
async function allowAccount(request, address) {
  const response = await request.post(
    'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo',
    {
      data: {
        postBody: `id_token=${idTokenFor(address)}&providerId=google.com`,
        requestUri: 'http://localhost',
        returnIdpCredential: true,
        returnSecureToken: true,
      },
    }
  );
  const { localId } = await response.json();
  await request.patch(
    `http://127.0.0.1:8080/v1/projects/demo-groovescribe/databases/(default)/documents/allowedUsers/${localId}`,
    { headers: { Authorization: 'Bearer owner' }, data: { fields: {} } }
  );
  return localId;
}

// Sign in with an emulator credential. The emulator popup loads apis.google.com and
// unpkg.com, and those requests sometimes hang, so only one test touches the popup.
async function signInWithCredential(page, email) {
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await page.evaluate(async (idToken) => {
    const sdkUrl = '/js/vendor/firebase.js';
    const sdk = await import(sdkUrl);
    await sdk.signInWithCredential(sdk.getAuth(), sdk.GoogleAuthProvider.credential(idToken));
  }, idTokenFor(email));
}

// Every account in these tests is on the allowlist unless a test signs in on its own.
async function signIn(page, email) {
  const uid = await allowAccount(page.request, email);
  await signInWithCredential(page, email);
  await expect(page.locator('#lpLibrary')).toBeVisible();
  return uid;
}

async function signOut(page) {
  await page.getByRole('button', { name: 'Close library' }).click();
  await page.locator('#helpAnchor').click();
  await page.locator('#userMenuSignOut').click();
  await expect(page.locator('#helpAnchor')).toContainText('Sign in');
}

async function signedInPanel(page, email = 'ana@example.com') {
  await openEditor(page);
  await openPanel(page);
  await signIn(page, email);
}

async function createLesson(page, name) {
  await page.locator('summary', { hasText: 'New lesson' }).click();
  await page.getByLabel('Lesson name').fill(name);
  await page.getByRole('button', { name: 'Create lesson' }).click();
  await expect(page.locator('.lp-lesson summary', { hasText: name })).toBeVisible();
}

async function addLink(page, query, title) {
  const tool = page.locator('.lp-tool', { hasText: 'Add a groove link' });
  if (!(await tool.getByLabel('Groove link').isVisible())) await tool.locator('summary').click();
  await tool.getByLabel('Groove link').fill('https://montulli.github.io/GrooveScribe/' + query);
  await tool.getByLabel('Title').fill(title);
  await tool.getByRole('button', { name: 'Add groove' }).click();
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
}

test.beforeEach(({ request }) => clearEmulators(request));

// The panel slides over the editor on this width. The tests at the end cover the docked panel.
test.use({ viewport: { width: 1000, height: 800 } });

test('the editor does not load Firebase until the panel opens', async ({ page }) => {
  const sdkRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('vendor/firebase.js')) sdkRequests.push(request.url());
  });
  await openEditor(page);
  await expect(page.locator('#libraryPanel')).toBeHidden();
  expect(sdkRequests).toEqual([]);

  await openPanel(page);
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  expect(sdkRequests).toHaveLength(1);
});

test('the sign-in button opens the auth popup', async ({ page, context }) => {
  await openEditor(page);
  await openPanel(page);
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('button', { name: 'Sign in with Google' }).click(),
  ]);
  expect(popup.url()).toContain('/emulator/auth/handler');
});

test('the panel closes with the close button, the backdrop and Escape', async ({ page }) => {
  await openEditor(page);
  const panel = page.locator('#libraryPanel');
  const toggle = page.getByRole('button', { name: 'Open library' });

  await openPanel(page);
  await expect(panel).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close library' })).toBeFocused();
  await page.getByRole('button', { name: 'Close library' }).click();
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();

  await openPanel(page);
  await expect(panel).toBeVisible();
  await page.locator('#libraryBackdrop').click({ position: { x: 800, y: 300 } });
  await expect(panel).toBeHidden();

  await openPanel(page);
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('the old library address opens the panel', async ({ page }) => {
  await page.goto('/profile.html');
  await expect(page).toHaveURL(/index\.html/);
  await expect(page.locator('#libraryPanel')).toBeVisible();
});

test('full library flow persists across reload', async ({ page }) => {
  await signedInPanel(page);
  await expect(page.getByText('Your library is empty.')).toBeVisible();

  await createLesson(page, 'Week 1');
  await expect(page.getByText('Your library is empty.')).toBeHidden();

  await addLink(page, QUERY, 'Paradiddle');
  await page.goto(EDITOR);
  await page.waitForSelector('#svgTarget svg');
  await openPanel(page);

  // A new groove goes to the open lesson, and the panel remembers that lesson.
  const week = page.locator('.lp-lesson').filter({ hasText: 'Week 1' });
  await expect(week.getByRole('button', { name: 'Paradiddle', exact: true })).toBeVisible();

  // Move the groove out of the lesson and back.
  const lessonSummary = (name) => page.locator('.lp-lesson summary', { hasText: name });
  await page.getByRole('button', { name: 'Options for Paradiddle' }).click();
  await page.getByLabel('Lesson for Paradiddle').selectOption({ label: 'No lesson' });
  await expect(lessonSummary('No lesson')).toBeVisible();
  await lessonSummary('No lesson').click();
  await page.getByRole('button', { name: 'Options for Paradiddle' }).click();
  await page.getByLabel('Lesson for Paradiddle').selectOption({ label: 'Week 1' });
  await expect(lessonSummary('No lesson')).toHaveCount(0);
  await expect(week.getByRole('button', { name: 'Paradiddle', exact: true })).toBeVisible();

  // Rename the groove and the lesson.
  page.once('dialog', (dialog) => dialog.accept('Paradiddle 2'));
  await page.getByRole('button', { name: 'Options for Paradiddle' }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Paradiddle 2', exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept('Week 2'));
  await page.getByRole('button', { name: 'Rename lesson' }).click();
  const renamed = page.locator('.lp-lesson').filter({ hasText: 'Week 2' });
  await expect(renamed).toBeVisible();

  // Deleting the lesson keeps the groove.
  page.once('dialog', (dialog) => dialog.accept());
  await renamed.getByRole('button', { name: 'Delete lesson' }).click();
  await expect(lessonSummary('Week 2')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Paradiddle 2', exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Options for Paradiddle 2' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Your library is empty.')).toBeVisible();
});

test('a lesson lists grooves in the order they were saved', async ({ page }) => {
  await signedInPanel(page);
  for (const title of ['First', 'Second', 'Third']) await addLink(page, QUERY, title);
  await page.goto(EDITOR);
  await page.waitForSelector('#svgTarget svg');
  await openPanel(page);
  await expect(page.locator('.lp-open')).toHaveText(['First', 'Second', 'Third']);
});

test('a short link gets a clear message and saves nothing', async ({ page }) => {
  await signedInPanel(page);
  await page.locator('summary', { hasText: 'Add a groove link' }).click();
  await page.getByLabel('Groove link').fill('https://gscribe.com/share/abc123');
  await page.getByRole('button', { name: 'Add groove' }).click();
  await expect(page.getByRole('alert')).toContainText('short link');
  await expect(page.getByText('Your library is empty.')).toBeVisible();
});

test('an account that is not on the allowlist is told so and sees no library', async ({ page }) => {
  await openEditor(page);
  await openPanel(page);
  await signInWithCredential(page, 'eve@example.com');
  await expect(page.getByRole('alert')).toHaveText('This account does not have access.');
  await expect(page.locator('#lpLibrary')).toBeHidden();
  await expect(page.locator('#lpLoading')).toBeHidden();
  await expect(page.getByText('Your library is empty.')).toBeHidden();
});

test('one user cannot see another user library', async ({ page }) => {
  await signedInPanel(page);
  await addLink(page, QUERY, 'Paradiddle');
  await signOut(page);
  await expect(page.getByRole('button', { name: 'Paradiddle', exact: true })).toHaveCount(0);

  await openPanel(page);
  await signIn(page, 'bob@example.com');
  await expect(page.getByText('Your library is empty.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paradiddle', exact: true })).toHaveCount(0);
});

test('saving the current groove stores what the editor shows', async ({ page }) => {
  await openEditor(page, EDITOR + '&' + QUERY.slice(1));
  await openPanel(page);
  await signIn(page, 'ana@example.com');
  await page.locator('summary', { hasText: 'Save current groove' }).click();
  await expect(page.locator('#lpSaveTitle')).toHaveValue('Paradiddle');
  await page.getByRole('button', { name: 'Save groove' }).click();
  const saved = page.getByRole('button', { name: 'Paradiddle', exact: true });
  await expect(saved).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('button', { name: 'Save groove' })).toBeHidden();
});

// The switch must give the same notation as opening the groove's own link, also when
// the division, time signature and number of measures change.
test('picking a groove draws the same notation as opening its link', async ({ page }) => {
  const grooves = {
    Triplets:
      '?TimeSig=4/4&Div=12&Title=Triplets&Tempo=120&Measures=1&H=|xxxxxxxxxxxx|&S=|---O-----O--|&K=|o-----o-----|',
    'Three four':
      '?TimeSig=3/4&Div=16&Title=Three%20four&Tempo=90&Measures=1&H=|x-x-x-x-x-x-|&S=|----O-------|&K=|o-------o---|',
    'Two bars':
      '?TimeSig=4/4&Div=8&Title=Two%20bars&Tempo=80&Measures=2&H=|xxxxxxxx|xxxxxxxx|&S=|--O---O-|--O---O-|&K=|o---o---|o---o---|',
  };

  const expected = {};
  for (const [title, query] of Object.entries(grooves)) {
    await openEditor(page, '/index.html' + query);
    expected[title] = await page.locator('#svgTarget').innerHTML();
  }

  await signedInPanel(page);
  for (const [title, query] of Object.entries(grooves)) await addLink(page, query, title);

  const titles = Object.keys(grooves);
  for (const title of [...titles, ...titles.slice().reverse()]) {
    await page.getByRole('button', { name: title, exact: true }).click();
    await expect(page.locator('#libraryPanel')).toBeHidden();
    await expect(page.locator('#tuneTitle')).toHaveValue(title);
    await expect(page.locator('#svgTarget')).toHaveJSProperty('innerHTML', expected[title]);
    await expect(page).toHaveURL(new RegExp('Title=' + encodeURIComponent(title)));
    await openPanel(page);
    await expect(page.getByRole('button', { name: title, exact: true })).toHaveAttribute(
      'aria-current',
      'true'
    );
  }
});

test('picking a groove stops playback', async ({ page }) => {
  await signedInPanel(page);
  await addLink(page, QUERY, 'Paradiddle');
  await page.evaluate(() => window.myGrooveWriter.myGrooveUtils.startMIDI_playback());
  await page.waitForFunction(() => window.myGrooveWriter.myGrooveUtils.isPlaying());
  await page.getByRole('button', { name: 'Paradiddle', exact: true }).click();
  await page.waitForFunction(() => !window.myGrooveWriter.myGrooveUtils.isPlaying());
});

test('keys pressed in the panel do not trigger editor hotkeys', async ({ page }) => {
  await signedInPanel(page);
  await page.getByRole('button', { name: 'Close library' }).focus();
  await page.keyboard.down(' ');
  const isPlaying = await page.evaluate(() => window.myGrooveWriter.myGrooveUtils.isPlaying());
  expect(isPlaying).toBe(false);
});

test('the top bar shows the user on the next visit without loading Firebase', async ({ page }) => {
  await signedInPanel(page);
  await page.getByRole('button', { name: 'Close library' }).click();
  await expect(page.locator('#helpAnchor')).toHaveClass(/signedIn/);

  const sdkRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('vendor/firebase.js')) sdkRequests.push(request.url());
  });
  await openEditor(page);
  await expect(page.locator('#helpAnchor')).toHaveClass(/signedIn/);
  await expect(page.locator('#helpAnchor .userInitial')).toHaveText('A');

  await page.locator('#helpAnchor').click();
  await expect(page.locator('#userMenuName')).toHaveText('ana@example.com');
  expect(sdkRequests).toEqual([]);

  // Sign out loads Firebase, and the top bar then shows the signed-out state.
  await page.locator('#userMenuSignOut').click();
  await expect(page.locator('#helpAnchor')).toContainText('Sign in');
  await openEditor(page);
  await expect(page.locator('#helpAnchor')).toContainText('Sign in');
});

test('the sign-in item of the top bar menu opens the panel', async ({ page }) => {
  await openEditor(page);
  await page.locator('#helpAnchor').click();
  await page.locator('#userMenuSignIn').click();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
});

test('the top bar shows the library name of a groove without a title', async ({ page }) => {
  await signedInPanel(page);
  await addLink(
    page,
    '?TimeSig=4/4&Div=16&Tempo=95&Measures=1&H=|x-x-|&S=|--O-|&K=|o---|',
    'No title'
  );
  await page.getByRole('button', { name: 'No title', exact: true }).click();
  await expect(page.locator('#grooveTitleDisplay')).toHaveText('No title');
  await expect(page.locator('#tuneTitle')).toHaveValue('');
});

test.describe('unsaved edits', () => {
  const OTHER =
    '?TimeSig=4/4&Div=8&Title=Rock&Tempo=100&Measures=1&H=|xxxxxxxx|&S=|--O---O-|&K=|o---o---|';
  const discardDialog = (page) => page.getByRole('dialog', { name: 'Discard your changes?' });
  const grooveButton = (page, title) => page.getByRole('button', { name: title, exact: true });

  // The slide-over panel covers the grid, so close it for the edit.
  async function editNote(page) {
    await page.getByRole('button', { name: 'Close library' }).click();
    await page.click('#snare4');
    await openPanel(page);
  }

  test('picking a groove with edits asks first, and Keep editing keeps them', async ({ page }) => {
    await signedInPanel(page);
    await addLink(page, QUERY, 'Paradiddle');
    await editNote(page);
    const edited = page.url();

    await grooveButton(page, 'Paradiddle').click();
    const dialog = discardDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Discard changes' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
    await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#libraryPanel')).toBeVisible();
    expect(page.url()).toBe(edited);

    // Escape means Keep editing, and it leaves the panel open.
    await grooveButton(page, 'Paradiddle').click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('#libraryPanel')).toBeVisible();
    expect(page.url()).toBe(edited);

    await grooveButton(page, 'Paradiddle').click();
    await dialog.getByRole('button', { name: 'Discard changes' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#tuneTitle')).toHaveValue('Paradiddle');
    await expect(page.locator('#libraryPanel')).toBeHidden();
  });

  test('picking a groove without edits does not ask', async ({ page }) => {
    await signedInPanel(page);
    await addLink(page, QUERY, 'Paradiddle');
    await addLink(page, OTHER, 'Rock');
    await grooveButton(page, 'Paradiddle').click();
    await expect(page.locator('#tuneTitle')).toHaveValue('Paradiddle');
    // A picked groove is clean until it is edited.
    await openPanel(page);
    await grooveButton(page, 'Rock').click();
    await expect(page.locator('#tuneTitle')).toHaveValue('Rock');
    await expect(discardDialog(page)).toBeHidden();
  });

  test('a groove from a shared link is clean until it is edited', async ({ page }) => {
    await openEditor(page, EDITOR + '&' + QUERY.slice(1));
    await openPanel(page);
    await signIn(page, 'ana@example.com');
    await addLink(page, OTHER, 'Rock');
    await grooveButton(page, 'Rock').click();
    await expect(page.locator('#tuneTitle')).toHaveValue('Rock');
    await expect(discardDialog(page)).toBeHidden();
  });

  test('a saved groove is clean', async ({ page }) => {
    await signedInPanel(page);
    await addLink(page, OTHER, 'Rock');
    await editNote(page);
    await page.locator('summary', { hasText: 'Save current groove' }).click();
    await page.locator('#lpSaveTitle').fill('Edited');
    await page.getByRole('button', { name: 'Save groove' }).click();
    await expect(grooveButton(page, 'Edited')).toHaveAttribute('aria-current', 'true');
    await grooveButton(page, 'Rock').click();
    await expect(page.locator('#tuneTitle')).toHaveValue('Rock');
    await expect(discardDialog(page)).toBeHidden();
  });

  test('a page with edits asks before it leaves, and a clean page does not', async ({ page }) => {
    const dialogs = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.type());
      dialog.accept();
    });
    await openEditor(page);
    await page.click('#snare4');
    await openEditor(page);
    expect(dialogs).toEqual(['beforeunload']);

    // An edit that is undone leaves the page clean.
    await page.click('#snare4');
    await page.click('#undoButton');
    await openEditor(page);
    expect(dialogs).toEqual(['beforeunload']);
  });
});

test.describe('updating a saved groove', () => {
  const grooveButton = (page, title) => page.getByRole('button', { name: title, exact: true });
  const saveTool = (page) => page.locator('summary', { hasText: 'Save current groove' });
  const updateButton = (page) => page.getByRole('button', { name: 'Update groove' });
  const saveAsNewButton = (page) => page.getByRole('button', { name: 'Save as new' });
  const plainSaveButton = (page) => page.getByRole('button', { name: 'Save groove' });
  const storedQueries = async (page) =>
    (await savedDocs(page, 'grooves')).map((item) => [item.id, item.query.stringValue]);

  // The slide-over panel covers the grid, so it closes for the edit.
  async function editNote(page, note = '#snare4') {
    // A pick closes the panel by itself.
    if (await page.locator('#libraryPanel.open').count()) {
      await page.getByRole('button', { name: 'Close library' }).click();
    }
    await page.click(note);
    await openPanel(page);
  }

  // The editor writes the groove into the address. Keep the emulator flag for the reload.
  const reload = (page) => openEditor(page, EDITOR + '&' + new URL(page.url()).search.slice(1));

  // The editor shows the title in the groove's query, which can differ from the library name.
  async function pickSaved(page, title, editorTitle = title) {
    await grooveButton(page, title).click();
    await expect(page.locator('#tuneTitle')).toHaveValue(editorTitle);
  }

  test('Update changes the open groove, and Save as new adds one', async ({ page }) => {
    await signedInPanel(page);
    await addLink(page, QUERY, 'Paradiddle');
    const [[id, savedQuery]] = await storedQueries(page);
    await pickSaved(page, 'Paradiddle');
    await editNote(page);

    await saveTool(page).click();
    await expect(page.locator('#lpSaveTitle')).toHaveValue('Paradiddle');
    await expect(updateButton(page)).toHaveClass(/lp-primary/);
    await expect(saveAsNewButton(page)).not.toHaveClass(/lp-primary/);
    await expect(plainSaveButton(page)).toHaveCount(0);
    await updateButton(page).click();
    await expect(updateButton(page)).toBeHidden();
    await expect(grooveButton(page, 'Paradiddle')).toHaveAttribute('aria-current', 'true');
    await expect.poll(() => storedQueries(page)).not.toEqual([[id, savedQuery]]);
    const [[updatedId, updatedQuery]] = await storedQueries(page);
    expect(updatedId).toBe(id);
    expect(await storedQueries(page)).toHaveLength(1);

    // The update saved the edits, so the page is clean and the form offers the plain save.
    await saveTool(page).click();
    await expect(plainSaveButton(page)).toBeVisible();
    await expect(updateButton(page)).toHaveCount(0);
    await saveTool(page).click();

    await editNote(page, '#snare8');
    await saveTool(page).click();
    // The form fills the title when it opens. Wait for that before typing over it.
    await expect(page.locator('#lpSaveTitle')).toHaveValue('Paradiddle');
    await page.locator('#lpSaveTitle').fill('Copy');
    await saveAsNewButton(page).click();
    await expect(grooveButton(page, 'Copy')).toHaveAttribute('aria-current', 'true');
    await expect(grooveButton(page, 'Paradiddle')).not.toHaveAttribute('aria-current', 'true');
    await expect.poll(async () => (await storedQueries(page)).length).toBe(2);
    expect(await storedQueries(page)).toContainEqual([id, updatedQuery]);
  });

  test('Update keeps the library name, not the title in the editor', async ({ page }) => {
    await signedInPanel(page);
    await addLink(page, QUERY, 'Library name');
    await pickSaved(page, 'Library name', 'Paradiddle');
    await editNote(page);
    await saveTool(page).click();
    await expect(page.locator('#lpSaveTitle')).toHaveValue('Library name');
    await updateButton(page).click();
    await expect(updateButton(page)).toBeHidden();
    await expect
      .poll(async () => (await savedDocs(page, 'grooves')).map((item) => item.title.stringValue))
      .toEqual(['Library name']);
  });

  test('with no saved groove open, the form has only the plain save', async ({ page }) => {
    await signedInPanel(page);
    await editNote(page);
    await saveTool(page).click();
    await expect(plainSaveButton(page)).toHaveClass(/lp-primary/);
    await expect(updateButton(page)).toHaveCount(0);
    await expect(saveAsNewButton(page)).toHaveCount(0);
  });

  test('a groove from the Grooves menu is not the saved groove', async ({ page }) => {
    await signedInPanel(page);
    await addLink(page, QUERY, 'Paradiddle');
    await pickSaved(page, 'Paradiddle');
    await page.click('#groovesAnchor');
    await page
      .locator('#grooveListWrapper .grooveListLI', { hasText: 'Train Beat' })
      .first()
      .click();
    await editNote(page);
    await saveTool(page).click();
    await expect(plainSaveButton(page)).toBeVisible();
    await expect(updateButton(page)).toHaveCount(0);
  });

  test('after a reload the open groove is still current', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    await signedInPanel(page);
    await addLink(page, QUERY, 'Paradiddle');
    await pickSaved(page, 'Paradiddle');
    await reload(page);
    await openPanel(page);
    await expect(grooveButton(page, 'Paradiddle')).toHaveAttribute('aria-current', 'true');
    await editNote(page);
    await saveTool(page).click();
    await expect(updateButton(page)).toBeVisible();

    // The address now holds the edits, so after a reload it is not the saved groove.
    await reload(page);
    await openPanel(page);
    await expect(grooveButton(page, 'Paradiddle')).toBeVisible();
    await expect(grooveButton(page, 'Paradiddle')).not.toHaveAttribute('aria-current', 'true');
    await editNote(page);
    await saveTool(page).click();
    await expect(plainSaveButton(page)).toBeVisible();
    await expect(updateButton(page)).toHaveCount(0);
  });
});

test.describe('without a network', () => {
  // ?sw=1 turns the service worker on for localhost. A real reload then comes up with no
  // network, the way it does for a user in a rehearsal room. A page that stays open would
  // not prove that the cache and the sign-in survive a restart.
  const OFFLINE_EDITOR = EDITOR + '&sw=1';
  const NOT_ON_DEVICE = 'Offline. This library is not on this device yet.';
  const FIRESTORE = /127\.0\.0\.1:8080/;
  const AUTH = /127\.0\.0\.1:9099/;

  const retryButton = (page) => page.getByRole('button', { name: 'Retry' });
  const grooveButton = (page, title) => page.getByRole('button', { name: title, exact: true });

  // Change library.js as the browser receives it, so a test can count or break one call.
  const patchLibrary = (page, patch) =>
    page.route('**/js/cloud/library.js', async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: patch(await response.text()) });
    });

  // Count each list call that settled, with an answer or a refusal, in window.listsAnswered.
  const countListAnswers = (source) =>
    source.replace(
      'export function createLibrary(sdk, db, uid) {',
      'export function createLibrary(realSdk, db, uid) {\n' +
        'const sdk = { ...realSdk, getDocs: async (...args) => {\n' +
        '  try { return await realSdk.getDocs(...args); }\n' +
        '  finally { window.listsAnswered = (window.listsAnswered ?? 0) + 1; }\n' +
        '} };'
    );
  const listsAnswered = (page) => page.waitForFunction(() => window.listsAnswered >= 2);

  const hang = (page, url) => page.route(url, () => {});

  // Hold requests to a server until the test calls the returned function.
  async function hold(page, url) {
    let release;
    const held = new Promise((resolve) => (release = resolve));
    await page.route(url, async (route) => {
      await held;
      await route.continue().catch(() => {}); // the page may have left in the meantime
    });
    return release;
  }

  async function signedInWithWorker(page, email = 'ana@example.com') {
    await openEditor(page, OFFLINE_EDITOR);
    await openPanel(page);
    await signIn(page, email);
  }

  async function workerReady(page) {
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  }

  async function reloadOffline(page) {
    await workerReady(page);
    await page.context().setOffline(true);
    await openEditor(page, OFFLINE_EDITOR);
  }

  test('an offline reload shows the saved grooves', async ({ page }) => {
    await signedInWithWorker(page);
    await createLesson(page, 'Week 1');
    await addLink(page, QUERY, 'Paradiddle');

    await reloadOffline(page);
    await openPanel(page);
    const week = page.locator('.lp-lesson').filter({ hasText: 'Week 1' });
    await expect(week.getByRole('button', { name: 'Paradiddle', exact: true })).toBeVisible();

    // The account must still be known, and nothing may report a failure.
    await expect(page.locator('#helpAnchor')).toHaveClass(/signedIn/);
    await expect(page.locator('#lpLibrary')).toBeVisible();
    await expect(page.locator('#lpMessage')).toBeHidden();
    await expect(retryButton(page)).toBeHidden();
  });

  test('a library that is not on this device says so and Retry loads it', async ({ page }) => {
    await signedInWithWorker(page);

    await reloadOffline(page);
    await openPanel(page);
    await expect(page.getByRole('alert')).toHaveText(NOT_ON_DEVICE);
    await expect(page.getByText('Your library is empty.')).toBeHidden();
    await expect(page.locator('#lpLoading')).toBeHidden();

    await page.context().setOffline(false);
    await retryButton(page).click();
    await expect(page.getByText('Your library is empty.')).toBeVisible();
    await expect(page.getByRole('alert')).toBeHidden();
    await expect(retryButton(page)).toBeHidden();
  });

  test('a failed first load shows Retry, and Retry recovers without a reload', async ({ page }) => {
    const SDK_URL = '**/js/vendor/firebase.js*';
    await page.route(SDK_URL, (route) => route.abort());
    await openEditor(page);
    await openPanel(page);
    await expect(retryButton(page)).toBeVisible();
    await expect(page.locator('#lpLoading')).toBeHidden();

    // A retry that also fails offers Retry again.
    await retryButton(page).click();
    await expect(page.getByRole('alert')).toContainText('did not work');
    await expect(retryButton(page)).toBeVisible();

    await page.unroute(SDK_URL);
    await retryButton(page).click();
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    await expect(page.getByRole('alert')).toBeHidden();
    await expect(retryButton(page)).toBeHidden();
  });

  test('a list that fails shows Retry, and Retry recovers without a reload', async ({ page }) => {
    // A list call rejects for as long as the page sets window.failLists.
    await patchLibrary(page, (source) =>
      source.replace(
        'async function listOwned(ref, sortField, direction) {',
        'async function listOwned(ref, sortField, direction) {\n' +
          "if (window.failLists) throw new Error('Simulated list failure');"
      )
    );
    await page.addInitScript(() => {
      window.failLists = true;
    });
    await openEditor(page);
    await openPanel(page);
    await allowAccount(page.request, 'ana@example.com');
    await signInWithCredential(page, 'ana@example.com');
    await expect(retryButton(page)).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('did not work');
    await expect(page.locator('#lpLibrary')).toBeHidden();

    await page.evaluate(() => {
      window.failLists = false;
    });
    await retryButton(page).click();
    await expect(page.getByText('Your library is empty.')).toBeVisible();
    await expect(retryButton(page)).toBeHidden();
  });

  test('a list that fails after a cached draw keeps the grooves and offers Retry', async ({
    page,
  }) => {
    await patchLibrary(page, (source) =>
      source.replace(
        'async function listOwned(ref, sortField, direction) {',
        'async function listOwned(ref, sortField, direction) {\n' +
          "if (window.failLists) throw new Error('Simulated list failure');"
      )
    );
    await signedInPanel(page);
    await addLink(page, QUERY, 'Paradiddle');

    // Only the next page load has the failing list.
    await page.addInitScript(() => {
      window.failLists = true;
    });
    await openEditor(page);
    await openPanel(page);
    await expect(grooveButton(page, 'Paradiddle')).toBeVisible();
    await expect(page.locator('#lpLibrary')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('did not work');
    await expect(retryButton(page)).toBeVisible();
    await expect(page.locator('#lpLoading')).toBeHidden();
  });

  test('deleting a lesson offline is refused and changes nothing', async ({ page }) => {
    await signedInWithWorker(page);
    await createLesson(page, 'Week 1');
    await addLink(page, QUERY, 'Paradiddle');

    await reloadOffline(page);
    await openPanel(page);
    await expect(grooveButton(page, 'Paradiddle')).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Delete lesson' }).click();
    await expect(page.getByRole('alert')).toContainText('Check your connection');

    await page.context().setOffline(false);
    await openEditor(page, OFFLINE_EDITOR);
    await openPanel(page);
    const week = page.locator('.lp-lesson').filter({ hasText: 'Week 1' });
    await expect(week.getByRole('button', { name: 'Paradiddle', exact: true })).toBeVisible();
  });

  test('two accounts on one device do not see each other offline', async ({ page }) => {
    await signedInWithWorker(page);
    await addLink(page, QUERY, 'Paradiddle');
    await signOut(page);
    await openPanel(page);
    await signIn(page, 'bob@example.com');
    await expect(page.getByText('Your library is empty.')).toBeVisible();

    await reloadOffline(page);
    await openPanel(page);
    await expect(page.getByRole('alert')).toHaveText(NOT_ON_DEVICE);
    await expect(grooveButton(page, 'Paradiddle')).toHaveCount(0);
  });

  // "is missing" passes without a persistent cache too, so it is no TDD evidence. It guards
  // against a regression across SDK bumps, where the SDK's own fallback may change.
  for (const [name, breakStorage] of [
    [
      'is missing',
      () => Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }),
    ],
    [
      'refuses to open',
      () => {
        IDBFactory.prototype.open = () => {
          throw new DOMException('Storage refused', 'UnknownError');
        };
      },
    ],
  ]) {
    test(`sign-in and the library still work when IndexedDB ${name}`, async ({ page }) => {
      await page.addInitScript(breakStorage);
      await openEditor(page);
      await openPanel(page);
      await signIn(page, 'ana@example.com');
      await addLink(page, QUERY, 'Paradiddle');
      await expect(page.locator('#lpMessage')).toBeHidden();
      await expect(retryButton(page)).toBeHidden();
    });
  }

  test('the profile is saved after a server answer and not from the cache', async ({ page }) => {
    await patchLibrary(page, (source) =>
      countListAnswers(source).replace(
        'async saveProfile({ displayName, photoURL }) {',
        'async saveProfile({ displayName, photoURL }) {\n' +
          'window.saveProfileCalls = (window.saveProfileCalls ?? 0) + 1;'
      )
    );
    const profileCalls = () => page.evaluate(() => window.saveProfileCalls ?? 0);

    await signedInPanel(page);
    await addLink(page, QUERY, 'Paradiddle');
    await expect.poll(profileCalls).toBeGreaterThan(0); // the counter works

    await page.route(FIRESTORE, (route) => route.abort());
    await openEditor(page);
    await openPanel(page);
    await expect(grooveButton(page, 'Paradiddle')).toBeVisible();
    await listsAnswered(page);
    expect(await profileCalls()).toBe(0);
  });

  test('a profile save that fails shows no error over the library', async ({ page }) => {
    await patchLibrary(page, (source) =>
      source.replace(
        'async saveProfile({ displayName, photoURL }) {',
        "async saveProfile({ displayName, photoURL }) {\nthrow new Error('Simulated drop');"
      )
    );
    await signedInPanel(page);
    await expect(page.getByText('Your library is empty.')).toBeVisible();
    await expect(page.locator('#lpMessage')).toBeHidden();
    await expect(page.locator('#lpLibrary')).toBeVisible();
  });

  for (const [name, setUp] of [
    ['with a network that hangs', () => {}],
    [
      'when navigator.onLine is false and Firestore hangs',
      (page) =>
        page.addInitScript(() =>
          Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false })
        ),
    ],
  ]) {
    test(`the saved grooves appear from the cache ${name}`, async ({ page }) => {
      await signedInPanel(page);
      await addLink(page, QUERY, 'Paradiddle');

      await setUp(page);
      await hang(page, FIRESTORE);
      await openEditor(page);
      await openPanel(page);
      await expect(grooveButton(page, 'Paradiddle')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('#lpLoading')).toBeHidden();
    });
  }

  test('a slow answer changes the loading text, and the text goes back', async ({ page }) => {
    await signedInPanel(page);
    await addLink(page, QUERY, 'Paradiddle');

    const release = await hold(page, AUTH);
    await openEditor(page);
    await openPanel(page);
    await expect(page.locator('#lpLoading')).toHaveText('Loading…');
    await expect(page.locator('#lpLoading')).toHaveText('Waiting for the network…', {
      timeout: 7000,
    });
    // Until Auth answers there is no user, and no form to write with.
    await expect(page.locator('#lpLibrary')).toBeHidden();

    release();
    await expect(grooveButton(page, 'Paradiddle')).toBeVisible();
    await expect(page.locator('#lpLoading')).toBeHidden();
    await expect(page.locator('#lpLoading')).toHaveText('Loading…');
  });

  test('the server answer updates the list and keeps an open menu', async ({ page }) => {
    const uid = await (async () => {
      await openEditor(page);
      await openPanel(page);
      return signIn(page, 'ana@example.com');
    })();
    await addLink(page, QUERY, 'Paradiddle');

    const release = await hold(page, FIRESTORE);
    await openEditor(page);
    await openPanel(page);
    await expect(grooveButton(page, 'Paradiddle')).toBeVisible();
    await page.getByRole('button', { name: 'Options for Paradiddle' }).click();
    await expect(page.getByLabel('Lesson for Paradiddle')).toBeVisible();

    await page.request.post(`${DOCUMENTS}/grooves`, {
      headers: OWNER,
      data: {
        fields: {
          ownerId: { stringValue: uid },
          lessonId: { nullValue: null },
          title: { stringValue: 'From the server' },
          query: { stringValue: QUERY },
          createdAt: { timestampValue: '2030-01-01T00:00:00Z' },
        },
      },
    });
    release();
    await expect(grooveButton(page, 'From the server')).toBeVisible();
    await expect(page.getByLabel('Lesson for Paradiddle')).toBeVisible();
  });

  test('a server answer for a signed-out user draws nothing', async ({ page }) => {
    await patchLibrary(page, countListAnswers);
    await signedInPanel(page);
    await addLink(page, QUERY, 'Paradiddle');

    const release = await hold(page, FIRESTORE);
    await openEditor(page);
    await openPanel(page);
    await expect(grooveButton(page, 'Paradiddle')).toBeVisible();
    await signOut(page);
    release();
    await listsAnswered(page);
    await openPanel(page);
    await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    await expect(retryButton(page)).toBeHidden();
    await expect(grooveButton(page, 'Paradiddle')).toHaveCount(0);
    await expect(page.locator('#lpLibrary')).toBeHidden();
  });

  test('an account that lost access does not keep the cached library', async ({ page }) => {
    await openEditor(page);
    await openPanel(page);
    const uid = await signIn(page, 'ana@example.com');
    await addLink(page, QUERY, 'Paradiddle');

    await page.request.delete(`${DOCUMENTS}/allowedUsers/${uid}`, { headers: OWNER });
    await openEditor(page);
    await openPanel(page);
    await expect(page.getByRole('alert')).toHaveText('This account does not have access.');
    await expect(page.locator('#lpLibrary')).toBeHidden();
    await expect(grooveButton(page, 'Paradiddle')).toHaveCount(0);
  });

  test.describe('offline writes', () => {
    const WILL_SYNC = 'Will sync';
    const KEEP_TAB = 'Keep this tab open until online';
    const REFUSED = 'A change could not be saved. The library shows what is saved.';
    const refusedSave = (title) =>
      `"${title}" could not be saved. The library shows what is saved.`;
    const PENDING_KEY = 'grooveScribe.pendingWrites';

    const syncLabel = (page, title) =>
      page.locator('.lp-groove', { has: grooveButton(page, title) }).locator('.lp-sync');
    const alert = (page) => page.getByRole('alert');
    const goOffline = (page) => page.context().setOffline(true);
    const goOnline = (page) => page.context().setOffline(false);

    // The flag goes away when the server has answered, also when no label was on screen.
    const synced = (page) =>
      page.waitForFunction((key) => localStorage.getItem(key) === null, PENDING_KEY);

    const changeOwner = (page, path) =>
      page.request.patch(`${DOCUMENTS}/${path}?updateMask.fieldPaths=ownerId`, {
        headers: OWNER,
        data: { fields: { ownerId: { stringValue: 'someone-else' } } },
      });

    // Wait for the panel to be open on a lesson first. The rules refuse a groove in a lesson
    // the caller does not own, and they still let the account read its library.
    async function addRefusedLink(page, title = 'Refused') {
      await addLink(page, QUERY, title);
      await expect(syncLabel(page, title)).toHaveText(WILL_SYNC);
      const [lesson] = await savedDocs(page, 'lessons');
      await changeOwner(page, `lessons/${lesson.id}`);
    }

    const breakIndexedDb = (page) =>
      page.addInitScript(() => {
        IDBFactory.prototype.open = () => {
          throw new DOMException('Storage refused', 'UnknownError');
        };
      });

    const pendingFlag = (page) => page.evaluate((key) => localStorage.getItem(key), PENDING_KEY);

    async function deleteGroove(page, title) {
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: `Options for ${title}` }).click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(grooveButton(page, title)).toHaveCount(0);
    }

    const spyOnSdk = (page, body) =>
      patchLibrary(page, (source) =>
        source.replace(
          'export function createLibrary(sdk, db, uid) {',
          `export function createLibrary(realSdk, db, uid) {\nconst sdk = { ...realSdk, ${body} };`
        )
      );

    test('a save shows at once with the label, and syncs when back online', async ({ page }) => {
      await signedInPanel(page);
      await goOffline(page);
      await addLink(page, QUERY, 'Paradiddle');
      await expect(syncLabel(page, 'Paradiddle')).toHaveText(WILL_SYNC);
      await expect(page.getByLabel('Groove link')).toHaveValue('');
      await expect(alert(page)).toBeHidden();

      await goOnline(page);
      await expect(syncLabel(page, 'Paradiddle')).toHaveCount(0);
      const [saved] = await savedDocs(page, 'grooves');
      expect(saved.title.stringValue).toBe('Paradiddle');
      expect(saved.createdAt.timestampValue).toBeTruthy();
    });

    test('rename, move and delete of a groove draw at once', async ({ page }) => {
      await signedInPanel(page);
      await createLesson(page, 'Week 1');
      await addLink(page, QUERY, 'Paradiddle');
      await addLink(page, QUERY, 'Keeper');
      await goOffline(page);

      page.once('dialog', (dialog) => dialog.accept('Renamed'));
      await page.getByRole('button', { name: 'Options for Paradiddle' }).click();
      await page.getByRole('button', { name: 'Rename', exact: true }).click();
      await expect(grooveButton(page, 'Renamed')).toBeVisible();
      await expect(syncLabel(page, 'Renamed')).toHaveText(WILL_SYNC);

      await page.getByRole('button', { name: 'Options for Renamed' }).click();
      await page.getByLabel('Lesson for Renamed').selectOption({ label: 'No lesson' });
      await expect(page.locator('.lp-lesson summary', { hasText: 'No lesson' })).toBeVisible();

      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Options for Keeper' }).click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(grooveButton(page, 'Keeper')).toHaveCount(0);

      await goOnline(page);
      await expect(page.locator('.lp-sync')).toHaveCount(0);
      await expect.poll(async () => (await savedDocs(page, 'grooves')).length).toBe(1);
      const [renamed] = await savedDocs(page, 'grooves');
      expect(renamed.title.stringValue).toBe('Renamed');
      expect(renamed.lessonId.nullValue).toBe(null);
    });

    test('a new lesson and a groove in it stay linked after the sync', async ({ page }) => {
      await signedInPanel(page);
      await goOffline(page);
      await createLesson(page, 'Offline lesson');
      await expect(page.getByLabel('Lesson name')).toHaveValue('');
      await addLink(page, QUERY, 'Paradiddle');
      const lesson = page.locator('.lp-lesson').filter({ hasText: 'Offline lesson' });
      await expect(lesson.getByRole('button', { name: 'Paradiddle', exact: true })).toBeVisible();
      await expect(lesson.locator('summary .lp-sync')).toHaveText(WILL_SYNC);

      await goOnline(page);
      await expect(page.locator('.lp-sync')).toHaveCount(0);
      const [savedLesson] = await savedDocs(page, 'lessons');
      const [savedGroove] = await savedDocs(page, 'grooves');
      expect(savedLesson.name.stringValue).toBe('Offline lesson');
      expect(savedGroove.lessonId.stringValue).toBe(savedLesson.id);
    });

    test('a reload keeps the queued groove, its label and its sync', async ({ page }) => {
      await signedInWithWorker(page);
      await addLink(page, QUERY, 'Saved online');
      await synced(page);
      await workerReady(page);
      await goOffline(page);
      await addLink(page, QUERY, 'Queued');

      await reloadOffline(page);
      await openPanel(page);
      await expect(grooveButton(page, 'Queued')).toBeVisible();
      await expect(syncLabel(page, 'Queued')).toHaveText(WILL_SYNC);
      await expect(syncLabel(page, 'Saved online')).toHaveCount(0);

      await goOnline(page);
      await expect(syncLabel(page, 'Queued')).toHaveCount(0);
      expect((await savedDocs(page, 'grooves')).map((item) => item.title.stringValue)).toContain(
        'Queued'
      );
    });

    test('a refused save names the groove and takes the label away', async ({ page }) => {
      await signedInPanel(page);
      await createLesson(page, 'Week 1');
      await synced(page);
      await goOffline(page);
      await addRefusedLink(page);

      await goOnline(page);
      await expect(alert(page)).toHaveText(refusedSave('Refused'));
      await expect(page.locator('.lp-sync')).toHaveCount(0);
      await expect(page.locator('.lp-open')).toHaveCount(0);
      expect(await savedDocs(page, 'grooves')).toEqual([]);
    });

    test('a refused save of the current groove leaves the page dirty', async ({ page }) => {
      await signedInPanel(page);
      await createLesson(page, 'Week 1');
      await synced(page);
      await page.getByRole('button', { name: 'Close library' }).click();
      await page.click('#snare4');
      await openPanel(page);
      await goOffline(page);
      await page.locator('summary', { hasText: 'Save current groove' }).click();
      await page.locator('#lpSaveTitle').fill('Refused');
      await page.getByRole('button', { name: 'Save groove' }).click();
      await expect(syncLabel(page, 'Refused')).toHaveText(WILL_SYNC);
      const [lesson] = await savedDocs(page, 'lessons');
      await changeOwner(page, `lessons/${lesson.id}`);

      await goOnline(page);
      await expect(alert(page)).toHaveText(refusedSave('Refused'));
      const dialogs = [];
      page.on('dialog', (dialog) => {
        dialogs.push(dialog.type());
        dialog.accept();
      });
      await openEditor(page);
      expect(dialogs).toEqual(['beforeunload']);
    });

    // Pick the saved groove, edit it, and press Update while offline.
    async function updateOffline(page, title) {
      await grooveButton(page, title).click();
      await expect(page.locator('#tuneTitle')).toHaveValue(title);
      await page.click('#snare4');
      await openPanel(page);
      await goOffline(page);
      await page.locator('summary', { hasText: 'Save current groove' }).click();
      await page.getByRole('button', { name: 'Update groove' }).click();
      await expect(syncLabel(page, title)).toHaveText(WILL_SYNC);
    }

    test('an update shows at once with the label, and syncs when back online', async ({ page }) => {
      await signedInPanel(page);
      await addLink(page, QUERY, 'Paradiddle');
      await synced(page);
      const [before] = await savedDocs(page, 'grooves');
      await updateOffline(page, 'Paradiddle');
      await expect(alert(page)).toBeHidden();

      await goOnline(page);
      await expect(syncLabel(page, 'Paradiddle')).toHaveCount(0);
      const after = await savedDocs(page, 'grooves');
      expect(after.map((item) => item.id)).toEqual([before.id]);
      expect(after[0].query.stringValue).not.toBe(before.query.stringValue);
      expect(after[0].createdAt).toEqual(before.createdAt);
    });

    test('a refused update names the groove and leaves the page dirty', async ({ page }) => {
      await signedInPanel(page);
      await addLink(page, QUERY, 'Paradiddle');
      await synced(page);
      const [groove] = await savedDocs(page, 'grooves');
      await updateOffline(page, 'Paradiddle');
      await changeOwner(page, `grooves/${groove.id}`);

      await goOnline(page);
      await expect(alert(page)).toHaveText(refusedSave('Paradiddle'));
      const dialogs = [];
      page.on('dialog', (dialog) => {
        dialogs.push(dialog.type());
        dialog.accept();
      });
      await openEditor(page);
      expect(dialogs).toEqual(['beforeunload']);
    });

    test('a refused delete says so', async ({ page }) => {
      await signedInPanel(page);
      await addLink(page, QUERY, 'Paradiddle');
      await expect(page.locator('.lp-sync')).toHaveCount(0);
      await goOffline(page);
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Options for Paradiddle' }).click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(grooveButton(page, 'Paradiddle')).toHaveCount(0);

      // A delete leaves no row to compare, so only the write promise can report it.
      const [saved] = await savedDocs(page, 'grooves');
      await changeOwner(page, `grooves/${saved.id}`);
      await goOnline(page);
      await expect(alert(page)).toHaveText(REFUSED);
    });

    test('a queued delete keeps the flag until the server has it', async ({ page }) => {
      await signedInPanel(page);
      await addLink(page, QUERY, 'Paradiddle');
      await synced(page);
      await goOffline(page);
      await deleteGroove(page, 'Paradiddle');
      expect(await pendingFlag(page)).toBe('true');

      await goOnline(page);
      await synced(page);
      expect(await savedDocs(page, 'grooves')).toEqual([]);
    });

    test('a server load does not clear the flag while a delete is queued', async ({ page }) => {
      await patchLibrary(page, countListAnswers);
      await signedInPanel(page);
      await addLink(page, QUERY, 'Paradiddle');
      await synced(page);
      await goOffline(page);
      await deleteGroove(page, 'Paradiddle');

      // The reads answer from the server, but the delete cannot reach it.
      const release = await hold(page, /Firestore\/Write/);
      await goOnline(page);
      await openEditor(page);
      await listsAnswered(page);
      await page.waitForTimeout(500); // time for code that follows the answer
      expect(await pendingFlag(page)).toBe('true');

      release();
      await synced(page);
      expect(await savedDocs(page, 'grooves')).toEqual([]);
    });

    test('a save refused after a reload names the groove', async ({ page }) => {
      await signedInWithWorker(page);
      await createLesson(page, 'Week 1');
      await addLink(page, QUERY, 'Saved online');
      await synced(page);
      await workerReady(page);
      await goOffline(page);
      await addRefusedLink(page);

      await reloadOffline(page);
      await openPanel(page);
      await expect(page.locator('.lp-sync')).toHaveCount(1);

      await goOnline(page);
      await expect(alert(page)).toHaveText(refusedSave('Refused'));
      await expect(page.locator('.lp-sync')).toHaveCount(0);
      await expect(page.locator('.lp-open')).toHaveText(['Saved online']);
    });

    test('losing access while offline is reported and clears the label', async ({ page }) => {
      await openEditor(page);
      await openPanel(page);
      const uid = await signIn(page, 'ana@example.com');
      await goOffline(page);
      await addLink(page, QUERY, 'Paradiddle');

      await page.request.delete(`${DOCUMENTS}/allowedUsers/${uid}`, { headers: OWNER });
      await goOnline(page);
      await expect(alert(page)).toHaveText('This account does not have access.');
      await expect(page.locator('.lp-sync')).toHaveCount(0);
      await expect(grooveButton(page, 'Paradiddle')).toHaveCount(0);
    });

    test('many saves share one waiter, and sign-out drops it', async ({ page }) => {
      await spyOnSdk(
        page,
        `waitForPendingWrites: async (...args) => {
          window.waitsStarted = (window.waitsStarted ?? 0) + 1;
          window.waitsOpen = (window.waitsOpen ?? 0) + 1;
          try { return await realSdk.waitForPendingWrites(...args); }
          finally { window.waitsOpen -= 1; }
        }`
      );
      const waits = () => page.evaluate(() => [window.waitsStarted ?? 0, window.waitsOpen ?? 0]);

      await signedInPanel(page);
      await goOffline(page);
      for (const title of ['One', 'Two', 'Three']) await addLink(page, QUERY, title);
      expect(await waits()).toEqual([1, 1]);

      await signOut(page);
      await expect.poll(waits).toEqual([1, 0]);

      // A waiter that outlived the session would start again here.
      await goOnline(page);
      await expect.poll(waits).toEqual([1, 0]);
    });

    test('a write made during the server read after a sync still syncs', async ({ page }) => {
      await spyOnSdk(
        page,
        `getDocs: async (...args) => {
          if (window.holdReads) {
            window.heldRead ??= new Promise((resolve) => { window.releaseReads = resolve; });
            window.readsHeld = (window.readsHeld ?? 0) + 1;
            await window.heldRead;
          }
          return realSdk.getDocs(...args);
        }`
      );
      await signedInPanel(page);
      await goOffline(page);
      await addLink(page, QUERY, 'First');

      await page.evaluate(() => {
        window.holdReads = true;
      });
      await goOnline(page);
      await page.waitForFunction(() => window.readsHeld >= 2);

      await goOffline(page);
      await addLink(page, QUERY, 'Second');
      await page.evaluate(() => {
        window.holdReads = false;
        window.releaseReads();
      });
      await expect(syncLabel(page, 'Second')).toHaveText(WILL_SYNC);

      await goOnline(page);
      await expect(page.locator('.lp-sync')).toHaveCount(0);
      const titles = (await savedDocs(page, 'grooves')).map((item) => item.title.stringValue);
      expect(titles.sort()).toEqual(['First', 'Second']);
    });

    // In a second tab the SDK wait can hang for a write that an earlier tab queued.
    const hangingWait = (page) =>
      spyOnSdk(page, 'waitForPendingWrites: () => new Promise(() => {})');

    test('a wait that never answers still ends when the cache is clear', async ({ page }) => {
      await hangingWait(page);
      await signedInPanel(page);
      await goOffline(page);
      await addLink(page, QUERY, 'Paradiddle');
      await expect(syncLabel(page, 'Paradiddle')).toHaveText(WILL_SYNC);

      await goOnline(page);
      await expect(syncLabel(page, 'Paradiddle')).toHaveCount(0, { timeout: 12_000 });
    });

    test('sign-out stops the cache check of a wait that never answers', async ({ page }) => {
      await page.addInitScript(() => {
        const realSet = window.setInterval;
        const realClear = window.clearInterval;
        window.syncChecks = new Set();
        window.setInterval = (task, delay, ...rest) => {
          const id = realSet(task, delay, ...rest);
          if (delay === 5000) window.syncChecks.add(id);
          return id;
        };
        window.clearInterval = (id) => {
          window.syncChecks.delete(id);
          realClear(id);
        };
      });
      const checks = () => page.evaluate(() => window.syncChecks.size);
      await hangingWait(page);
      await signedInPanel(page);
      await goOffline(page);
      await addLink(page, QUERY, 'Paradiddle');
      expect(await checks()).toBe(1);

      await signOut(page);
      await expect.poll(checks).toBe(0);
    });

    test('online the label appears only when the sync is slow', async ({ page }) => {
      await signedInPanel(page);
      await synced(page);
      const release = await hold(page, FIRESTORE);
      await addLink(page, QUERY, 'Paradiddle');
      expect(await page.locator('.lp-sync').count()).toBe(0);

      await expect(syncLabel(page, 'Paradiddle')).toHaveText(WILL_SYNC, { timeout: 4000 });
      release();
      await expect(syncLabel(page, 'Paradiddle')).toHaveCount(0);
    });

    test('names over the limit of the rules are cut, and they sync', async ({ page }) => {
      const LONG = 'x'.repeat(250);
      await signedInPanel(page);
      await goOffline(page);

      // The inputs have a maxlength, so set the values directly.
      await page.locator('summary', { hasText: 'New lesson' }).click();
      await page.getByLabel('Lesson name').evaluate((input, value) => {
        input.value = value;
      }, LONG);
      await page.getByRole('button', { name: 'Create lesson' }).click();
      const tool = page.locator('.lp-tool', { hasText: 'Add a groove link' });
      await tool.locator('summary').click();
      await tool.getByLabel('Groove link').fill('https://montulli.github.io/GrooveScribe/' + QUERY);
      await tool.getByLabel('Title').evaluate((input, value) => {
        input.value = `  ${value}`;
      }, LONG);
      await tool.getByRole('button', { name: 'Add groove' }).click();
      await expect(page.locator('.lp-open')).toHaveCount(1);

      await goOnline(page);
      await expect(page.locator('.lp-sync')).toHaveCount(0);
      await expect(alert(page)).toBeHidden();
      const [lesson] = await savedDocs(page, 'lessons');
      const [groove] = await savedDocs(page, 'grooves');
      expect(lesson.name.stringValue).toBe('x'.repeat(200));
      expect(groove.title.stringValue).toBe('x'.repeat(200));

      await synced(page);
      await goOffline(page);
      const longName = 'y'.repeat(250);
      page.once('dialog', (dialog) => dialog.accept(longName));
      await page.getByRole('button', { name: /^Options for/ }).click();
      await page.getByRole('button', { name: 'Rename', exact: true }).click();
      await expect(page.locator('.lp-open')).toHaveText('y'.repeat(200));
      page.once('dialog', (dialog) => dialog.accept(longName));
      await page.getByRole('button', { name: 'Rename lesson' }).click();
      await expect(page.locator('.lp-lesson summary span').first()).toHaveText('y'.repeat(200));

      await goOnline(page);
      await expect(page.locator('.lp-sync')).toHaveCount(0);
      await expect(alert(page)).toBeHidden();
      const [renamedLesson] = await savedDocs(page, 'lessons');
      const [renamedGroove] = await savedDocs(page, 'grooves');
      expect(renamedLesson.name.stringValue).toBe('y'.repeat(200));
      expect(renamedGroove.title.stringValue).toBe('y'.repeat(200));
    });

    test.describe('a queued write on a device that did not open the panel', () => {
      const watchSdk = (page) => {
        const requests = [];
        page.on('request', (request) => {
          if (request.url().includes('vendor/firebase.js')) requests.push(request.url());
        });
        return requests;
      };

      test('is sent without opening the panel', async ({ page }) => {
        await signedInWithWorker(page);
        await synced(page);
        await workerReady(page);
        await goOffline(page);
        await addLink(page, QUERY, 'Queued');

        await page.evaluate(() => {
          // A reload that stays closed: this width does not dock the panel.
          localStorage.setItem('grooveScribe.libraryOpen', 'false');
        });
        const sdkRequests = watchSdk(page);
        // Reload while offline, so the write is still queued when the next visit starts.
        await openEditor(page, OFFLINE_EDITOR);
        await expect.poll(() => sdkRequests.length).toBeGreaterThan(0);
        await expect(page.locator('#libraryPanel')).toBeHidden();
        await goOnline(page);
        await expect
          .poll(async () => (await savedDocs(page, 'grooves')).map((d) => d.title.stringValue))
          .toEqual(['Queued']);
        await synced(page);
      });

      test('and a device with nothing queued imports no SDK on a shared link', async ({ page }) => {
        await signedInWithWorker(page);
        await addLink(page, QUERY, 'Saved online');
        await synced(page);

        // page.on('request') shows what this page asks for, also when the worker answers it.
        // It does not show the downloads of the worker itself, and the worker precaches the
        // SDK file for every visitor. So this proves the page does not load the SDK, not that
        // the device never downloads it.
        const sdkRequests = watchSdk(page);
        await openEditor(page, OFFLINE_EDITOR + '&' + QUERY.slice(1));
        await page.waitForTimeout(1500); // longer than the idle wait the SDK would need
        expect(sdkRequests).toEqual([]);
      });
    });

    test.describe('without IndexedDB', () => {
      test('an offline save keeps the grooves the server sent, and warns', async ({ page }) => {
        await breakIndexedDb(page);
        await openEditor(page);
        await openPanel(page);
        const uid = await signIn(page, 'ana@example.com');
        // This groove only ever comes from a server answer, like an older part of a library.
        await page.request.post(`${DOCUMENTS}/grooves`, {
          headers: OWNER,
          data: {
            fields: {
              ownerId: { stringValue: uid },
              lessonId: { nullValue: null },
              title: { stringValue: 'From the server' },
              query: { stringValue: QUERY },
              createdAt: { timestampValue: '2020-01-01T00:00:00Z' },
            },
          },
        });
        await addLink(page, QUERY, 'Saved online');
        await expect(grooveButton(page, 'From the server')).toBeVisible();

        await goOffline(page);
        await addLink(page, QUERY, 'Queued');
        await expect(grooveButton(page, 'From the server')).toBeVisible();
        await expect(syncLabel(page, 'Queued')).toHaveText(KEEP_TAB);
      });

      test('a reload with a queued write asks first, and loses the write', async ({ page }) => {
        await breakIndexedDb(page);
        await signedInWithWorker(page);
        await workerReady(page);
        await goOffline(page);
        await addLink(page, QUERY, 'Queued');
        await expect(syncLabel(page, 'Queued')).toHaveText(KEEP_TAB);

        const dialogs = [];
        page.on('dialog', (dialog) => {
          dialogs.push(dialog.type());
          dialog.accept();
        });
        await openEditor(page, OFFLINE_EDITOR);
        expect(dialogs).toEqual(['beforeunload']);
        await openPanel(page);
        await expect(grooveButton(page, 'Queued')).toHaveCount(0);
      });

      test('a queued delete asks before the page leaves', async ({ page }) => {
        await breakIndexedDb(page);
        await signedInWithWorker(page);
        await workerReady(page);
        await addLink(page, QUERY, 'Saved online');
        await expect.poll(async () => (await savedDocs(page, 'grooves')).length).toBe(1);
        await expect(page.locator('.lp-sync')).toHaveCount(0);
        await goOffline(page);
        await deleteGroove(page, 'Saved online');

        const dialogs = [];
        page.on('dialog', (dialog) => {
          dialogs.push(dialog.type());
          dialog.accept();
        });
        await openEditor(page, OFFLINE_EDITOR);
        expect(dialogs).toEqual(['beforeunload']);
      });

      test('a delete the server has answered does not ask', async ({ page }) => {
        await breakIndexedDb(page);
        await signedInWithWorker(page);
        await addLink(page, QUERY, 'Saved online');
        await expect.poll(async () => (await savedDocs(page, 'grooves')).length).toBe(1);
        await expect(page.locator('.lp-sync')).toHaveCount(0);
        await deleteGroove(page, 'Saved online');
        await expect.poll(async () => (await savedDocs(page, 'grooves')).length).toBe(0);
        await page.waitForTimeout(500); // time for the answer to reach the page

        const dialogs = [];
        page.on('dialog', (dialog) => {
          dialogs.push(dialog.type());
          dialog.accept();
        });
        await openEditor(page, OFFLINE_EDITOR);
        expect(dialogs).toEqual([]);
      });

      test('a reload with nothing queued does not ask', async ({ page }) => {
        await breakIndexedDb(page);
        await signedInWithWorker(page);
        await addLink(page, QUERY, 'Saved online');
        await expect.poll(async () => (await savedDocs(page, 'grooves')).length).toBe(1);

        const dialogs = [];
        page.on('dialog', (dialog) => {
          dialogs.push(dialog.type());
          dialog.accept();
        });
        await page.waitForFunction(() => !window.document.querySelector('.lp-sync'));
        await openEditor(page, OFFLINE_EDITOR);
        expect(dialogs).toEqual([]);
      });
    });
  });

  test('two tabs both show the library and share the persistent cache', async ({ page }) => {
    const logs = [];
    const watch = (tab) => tab.on('console', (line) => logs.push(line.text()));
    watch(page);
    await signedInPanel(page);
    await addLink(page, QUERY, 'Paradiddle');

    const second = await page.context().newPage();
    watch(second);
    await openEditor(second);
    await openPanel(second);
    await expect(grooveButton(second, 'Paradiddle')).toBeVisible();

    await openEditor(page);
    await openPanel(page);
    await expect(grooveButton(page, 'Paradiddle')).toBeVisible();
    expect(logs.filter((line) => line.includes('Falling back to memory cache'))).toEqual([]);
  });
});

test.describe('docked on a wide screen', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  const musicLeft = (page) =>
    page.locator('#RightHandContent').evaluate((node) => node.getBoundingClientRect().left);
  const svgWidth = (page) =>
    page
      .locator('#svgTarget svg')
      .first()
      .evaluate((node) => node.getBoundingClientRect().width);

  test('a first visit stays closed and does not load Firebase', async ({ page }) => {
    const sdkRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('vendor/firebase.js')) sdkRequests.push(request.url());
    });
    await openEditor(page);
    await expect(page.locator('#libraryPanel')).toBeHidden();
    expect(await musicLeft(page)).toBe(0);
    expect(sdkRequests).toEqual([]);
  });

  test('the panel sits next to the music and redraws it to fit', async ({ page }) => {
    await openEditor(page);
    const wideSvg = await svgWidth(page);
    await openPanel(page);
    await expect(page.locator('#libraryPanel')).toBeVisible();
    expect(await musicLeft(page)).toBe(300);
    await expect.poll(() => svgWidth(page)).toBeLessThan(wideSvg);
    await expect(page.locator('#libraryBackdrop')).toBeHidden();

    await page.getByRole('button', { name: 'Hide library' }).click();
    await expect(page.locator('#libraryPanel')).toBeHidden();
    expect(await musicLeft(page)).toBe(0);
    await expect.poll(() => svgWidth(page)).toBe(wideSvg);
  });

  test('picking a groove keeps the panel open and space plays it', async ({ page }) => {
    await signedInPanel(page);
    await addLink(page, QUERY, 'Paradiddle');
    await page.getByRole('button', { name: 'Paradiddle', exact: true }).click();
    await expect(page.locator('#tuneTitle')).toHaveValue('Paradiddle');
    await expect(page.locator('#libraryPanel')).toBeVisible();
    await page.keyboard.press(' ');
    await page.waitForFunction(() => window.myGrooveWriter.myGrooveUtils.isPlaying());
    await expect(page.locator('#libraryPanel')).toBeVisible();
  });

  test('picking a groove with edits asks first in the docked panel', async ({ page }) => {
    await signedInPanel(page);
    await addLink(page, QUERY, 'Paradiddle');
    await page.click('#snare4');
    await page.getByRole('button', { name: 'Paradiddle', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Discard your changes?' });
    await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('#tuneTitle')).not.toHaveValue('Paradiddle');

    await page.getByRole('button', { name: 'Paradiddle', exact: true }).click();
    await dialog.getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.locator('#tuneTitle')).toHaveValue('Paradiddle');
    await expect(page.locator('#libraryPanel')).toBeVisible();
  });

  test('Escape does not hide it', async ({ page }) => {
    await openEditor(page);
    await openPanel(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#libraryPanel')).toBeVisible();
  });

  test('it comes back after a reload until the user hides it', async ({ page }) => {
    await signedInPanel(page);
    await page.reload();
    await expect(page.locator('#libraryPanel')).toBeVisible();

    await page.getByRole('button', { name: 'Hide library' }).click();
    await page.reload();
    await page.waitForSelector('#svgTarget svg');
    await expect(page.locator('#libraryPanel')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open library' })).toBeVisible();
  });

  test('a signed-in user gets it open by default', async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem('grooveScribe.user', JSON.stringify({ name: 'Ana' }))
    );
    await openEditor(page);
    await expect(page.locator('#libraryPanel')).toBeVisible();
  });

  test.describe('a device that was signed in connects by itself', () => {
    const rememberUser = (page) =>
      page.addInitScript(() =>
        localStorage.setItem('grooveScribe.user', JSON.stringify({ name: 'Ana' }))
      );
    const watchSdk = (page) => {
      const requests = [];
      page.on('request', (request) => {
        if (request.url().includes('vendor/firebase.js')) requests.push(request.url());
      });
      return requests;
    };

    test('without a click, once Play is ready', async ({ page }) => {
      const sdkRequests = watchSdk(page);
      await rememberUser(page);
      await openEditor(page);
      await expect(page.locator('#libraryPanel')).toBeVisible();
      await expect.poll(() => sdkRequests.length).toBeGreaterThan(0);
      await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    });

    test('and still connects where requestIdleCallback is missing', async ({ page }) => {
      const sdkRequests = watchSdk(page);
      await rememberUser(page);
      await page.addInitScript(() => {
        delete window.requestIdleCallback;
      });
      await openEditor(page);
      await expect.poll(() => sdkRequests.length).toBeGreaterThan(0);
      await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
    });

    test('but not before Play is ready', async ({ page }) => {
      const sdkRequests = watchSdk(page);
      let releaseSound;
      const held = new Promise((resolve) => (releaseSound = resolve));
      await page.route('**/soundfont/gunshot-*.js', async (route) => {
        await held;
        await route.continue();
      });
      await rememberUser(page);
      await page.goto(EDITOR);
      await page.waitForSelector('#svgTarget svg');
      await expect(page.locator('#libraryPanel')).toBeVisible();
      await page.waitForTimeout(1500); // longer than the idle wait the SDK would need
      expect(sdkRequests).toEqual([]);

      releaseSound();
      await expect.poll(() => sdkRequests.length).toBeGreaterThan(0);
    });

    test('and does not wait for a sound request that never answers', async ({ page }) => {
      const sdkRequests = watchSdk(page);
      await page.route('**/soundfont/gunshot-*.js', () => {}); // never answers
      await rememberUser(page);
      await page.goto(EDITOR);
      await page.waitForSelector('#svgTarget svg');
      await expect(page.locator('#libraryPanel')).toBeVisible();
      expect(sdkRequests).toEqual([]);

      // The cap is 10 s. The sound would need up to 193 s to give up.
      await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible({
        timeout: 20_000,
      });
      expect(sdkRequests.length).toBeGreaterThan(0);
    });
  });

  test('turning a tablet hides it and turning back restores it', async ({ page }) => {
    await openEditor(page);
    await openPanel(page);
    await page.setViewportSize({ width: 820, height: 1180 });
    await expect(page.locator('#libraryPanel')).toBeHidden();
    await expect(page.locator('#libraryBackdrop')).toBeHidden();
    expect(await musicLeft(page)).toBe(0);

    await page.setViewportSize({ width: 1180, height: 820 });
    await expect(page.locator('#libraryPanel')).toBeVisible();
    expect(await musicLeft(page)).toBe(300);
  });

  test('bars that do not fit next to the panel go to the next line', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await openEditor(
      page,
      EDITOR + '&Measures=2&H=|x-x-x-x-|x-x-x-x-|&S=|--O---O-|--O---O-|&K=|o---o---|o---o---|'
    );
    await openPanel(page);
    const grid = page.locator('#musicalInput');
    expect(await grid.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    const tops = await page
      .locator('.staff-container')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().top));
    expect(tops[1]).toBeGreaterThan(tops[0]);
  });

  test('toolbar menus open above the panel', async ({ page }) => {
    await openEditor(page);
    await openPanel(page);
    await page.locator('#divisionMenuButton').click();
    const popover = page.locator('#divisionPopover');
    await expect(popover).toBeVisible();
    const onTop = await popover.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + 10, rect.top + 10);
      return node.contains(hit);
    });
    expect(onTop).toBe(true);
  });
});
