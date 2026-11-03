import { expect, test } from '@playwright/test';

const QUERY = '?TimeSig=4/4&Div=16&Title=Paradiddle&Tempo=95&Measures=1&H=|x-x-|&S=|--O-|&K=|o---|';
const PAGE = '/profile.html?emulator=1';

async function clearEmulators(request) {
  await request.delete(
    'http://127.0.0.1:8080/emulator/v1/projects/demo-groovescribe/databases/(default)/documents'
  );
  await request.delete('http://127.0.0.1:9099/emulator/v1/projects/demo-groovescribe/accounts', {
    headers: { Authorization: 'Bearer owner' },
  });
}

// Sign in with an emulator credential. The emulator popup loads apis.google.com and
// unpkg.com, and those requests sometimes hang, so only one test touches the popup.
async function signIn(page, email) {
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await page.evaluate(async (address) => {
    const sdkUrl = '/js/vendor/firebase.js';
    const sdk = await import(sdkUrl);
    const idToken = JSON.stringify({ sub: address, email: address, email_verified: true });
    await sdk.signInWithCredential(sdk.getAuth(), sdk.GoogleAuthProvider.credential(idToken));
  }, email);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

test.beforeEach(({ request }) => clearEmulators(request));

test('signed-out page offers sign-in and hides the library', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(page.locator('#library')).toBeHidden();
});

test('the sign-in button opens the auth popup', async ({ page }) => {
  await page.goto(PAGE);
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'Sign in with Google' }).click(),
  ]);
  await expect(popup).toHaveURL(/127\.0\.0\.1:9099\/emulator\/auth\/handler/);
});

test('full library flow persists across reload', async ({ page }) => {
  page.on('dialog', (dialog) =>
    dialog.type() === 'prompt' ? dialog.accept('Week 2') : dialog.accept()
  );
  await page.goto(PAGE);
  await signIn(page, 'ana@example.com');
  await expect(page.locator('#account')).toContainText('ana');
  await expect(page.getByText('Your library is empty.')).toBeVisible();

  await page.getByLabel('New lesson').fill('Week 1');
  await page.getByRole('button', { name: 'Create lesson' }).click();
  await expect(page.getByRole('heading', { name: 'Week 1' })).toBeVisible();
  await expect(page.getByText('Your library is empty.')).toBeHidden();

  await page
    .getByLabel('Add a groove link')
    .fill('https://montulli.github.io/GrooveScribe/' + QUERY);
  await expect(page.getByLabel('Title')).toHaveValue('Paradiddle');
  await page.locator('#saveLesson').selectOption({ label: 'Week 1' });
  await page.getByRole('button', { name: 'Save groove' }).click();

  const lesson = page.locator('.lesson', { hasText: 'Week 1' });
  const link = lesson.getByRole('link', { name: 'Paradiddle' });
  await expect(link).toHaveAttribute('href', 'index.html' + QUERY);

  await page.reload();
  await expect(link).toBeVisible();

  await lesson.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('heading', { name: 'Week 2' })).toBeVisible();

  // Deleting the lesson keeps the groove.
  const sectionNamed = (name) =>
    page.locator('.lesson').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await sectionNamed('Week 2')
    .locator('.lesson-header')
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(sectionNamed('Week 2')).toHaveCount(0);
  await expect(sectionNamed('No lesson').getByRole('link', { name: 'Paradiddle' })).toBeVisible();

  await sectionNamed('No lesson')
    .locator('.groove')
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(page.getByRole('link', { name: 'Paradiddle' })).toHaveCount(0);
});

test('a short link gets a clear message and saves nothing', async ({ page }) => {
  await page.goto(PAGE);
  await signIn(page, 'ana@example.com');
  await page.getByLabel('Add a groove link').fill('https://gscribe.com/share/abc');
  await page.getByRole('button', { name: 'Save groove' }).click();
  await expect(page.getByRole('alert')).toContainText('This is a short link');
  await expect(page.locator('.groove')).toHaveCount(0);
});

test('one user cannot see another user library', async ({ page }) => {
  await page.goto(PAGE);
  await signIn(page, 'ana@example.com');
  await page.getByLabel('Add a groove link').fill(QUERY);
  await page.getByRole('button', { name: 'Save groove' }).click();
  await expect(page.getByRole('link', { name: 'Paradiddle' })).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await signIn(page, 'bob@example.com');
  await expect(page.locator('#library')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Paradiddle' })).toHaveCount(0);
});

test('the editor sends the current groove to the library form', async ({ page, context }) => {
  await page.goto('/index.html' + QUERY);
  await page.waitForSelector('#svgTarget svg');
  const [libraryTab] = await Promise.all([
    context.waitForEvent('page'),
    page.evaluate(() => window.myGrooveWriter.helpMenuPopupClick('saveToLibrary')),
  ]);
  await libraryTab.waitForLoadState();
  const incoming = new URL(libraryTab.url()).searchParams.get('save');
  expect(incoming).toContain('Title=Paradiddle');
  expect(incoming).toContain('Div=16');

  await page.goto(`${PAGE}&save=${encodeURIComponent(incoming)}`);
  await signIn(page, 'ana@example.com');
  await expect(page.getByLabel('Add a groove link')).toHaveValue(incoming);
  await expect(page.getByLabel('Title')).toHaveValue('Paradiddle');
  await page.getByRole('button', { name: 'Save groove' }).click();
  await expect(page.getByRole('link', { name: 'Paradiddle' })).toBeVisible();
  await expect(page).not.toHaveURL(/save=/);
});
