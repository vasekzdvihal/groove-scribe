import { expect, test } from '@playwright/test';

const QUERY = '?TimeSig=4/4&Div=16&Title=Paradiddle&Tempo=95&Measures=1&H=|x-x-|&S=|--O-|&K=|o---|';
const EDITOR = '/index.html?emulator=1';

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
  await allowAccount(page.request, email);
  await signInWithCredential(page, email);
  await expect(page.locator('#lpLibrary')).toBeVisible();
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
