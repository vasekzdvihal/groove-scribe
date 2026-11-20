import { test, expect } from './fixtures.js';

// The editor has one set of colours (css/tokens.css). The primary buttons of the toolbars, the
// side panel and the confirm dialog share one accent.

test.use({ viewport: { width: 1024, height: 768 } });

const GROOVE =
  '?TimeSig=4/4&Div=16&Measures=1&H=|xxxxxxxxxxxxxxxx|&S=|----O-------O---|&K=|o-------o-------|';
const ACCENT = 'rgb(31, 115, 168)';
const WHITE = 'rgb(255, 255, 255)';

const look = (locator) =>
  locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, color: style.color };
  });

test('primary buttons share one accent (the library button: CSS only)', async ({ page }) => {
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');

  // A toolbar tool that is on: the open side panel tab.
  const tab = page.locator('#upperLeft .panel-tab', { hasText: 'Grooves' });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(0, 0);
  expect((await look(tab)).background).toBe(ACCENT);

  // The library CSS for its primary button. The hermetic test server blocks Firebase, so the
  // Library tab does not start here. A stand-in button in a library section checks the CSS only.
  // tests-cloud/library.spec.js checks the real Sign in with Google button.
  await page.evaluate(() => {
    const section = document.createElement('section');
    section.id = 'libraryPanel';
    section.innerHTML =
      '<button id="lpSignIn" class="lp-primary" type="button">Sign in with Google</button>';
    document.getElementById('sidePanel').append(section);
  });
  const signIn = page.getByRole('button', { name: 'Sign in with Google' });
  expect(await look(signIn)).toEqual({ background: ACCENT, color: WHITE });

  // The primary button of the confirm dialog.
  await page.keyboard.press('Escape');
  await page.click('#moreButton');
  await page.click('#clearAllNotesButton');
  const dialog = page.getByRole('dialog', { name: 'Clear all notes?' });
  await expect(dialog).toBeVisible();
  const keep = dialog.getByRole('button', { name: 'Keep the notes' });
  expect(await look(keep)).toEqual({ background: ACCENT, color: WHITE });
});
