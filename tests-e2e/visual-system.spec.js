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
      '<button id="lpSignIn" class="btn btn-primary" type="button">Sign in with Google</button>';
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

// Every button has one shape (D2): 6 px corners and a 44 px touch target. Round controls (the
// tempo knob, an avatar) stay round, and the note grid keeps its own cells.
async function buttonsOffShape(page, rootSelector) {
  return page.locator(rootSelector).evaluateAll((roots) => {
    const offenders = [];
    for (const root of roots) {
      for (const node of root.querySelectorAll('button, [role="button"]')) {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        if (!node.getClientRects().length || style.visibility === 'hidden') continue;
        if (style.borderRadius === '50%' || node.closest('.tempoKnob, #musicalInput')) continue;
        if (style.borderRadius !== '6px' || box.height < 44) {
          const name = node.id || node.getAttribute('aria-label') || node.textContent.trim();
          offenders.push(`${name}: ${style.borderRadius}, ${Math.round(box.height)} px`);
        }
      }
    }
    return offenders;
  });
}

for (const [width, height] of [
  [1024, 768],
  [768, 1024],
]) {
  test.describe(`at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('every button has one shape', async ({ page }) => {
      await page.goto('/index.html' + GROOVE);
      await page.waitForSelector('#svgTarget svg');
      const radius = (selector) =>
        page.locator(selector).evaluate((node) => getComputedStyle(node).borderRadius);

      // The toolbars. The Help link and the Sign in control are buttons too.
      expect.soft(await buttonsOffShape(page, '#TopNav, #ToolBar, #PlaybackBar')).toEqual([]);
      expect.soft(await radius('#helpLink')).toBe('6px');
      expect.soft(await radius('#helpAnchor')).toBe('6px');

      // The side panel: Library, then Grooves.
      for (const name of ['Library', 'Grooves']) {
        await page.locator('#upperLeft .panel-tab', { hasText: name }).click();
        await expect(page.locator('#sidePanel')).toBeVisible();
        expect.soft(await buttonsOffShape(page, '#sidePanel'), name).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(page.locator('#sidePanel')).toBeHidden();
      }

      // A .btn with the hidden attribute stays hidden, such as Retry in the library.
      const shownHidden = await page
        .locator('.btn[hidden]')
        .evaluateAll((nodes) => [
          nodes.length,
          nodes.filter((node) => getComputedStyle(node).display !== 'none').map((node) => node.id),
        ]);
      expect(shownHidden[0]).toBeGreaterThan(0);
      expect(shownHidden[1]).toEqual([]);

      // The confirm dialog.
      await page.click('#moreButton');
      await page.click('#clearAllNotesButton');
      const dialog = page.getByRole('dialog', { name: 'Clear all notes?' });
      await expect(dialog).toBeVisible();
      expect.soft(await buttonsOffShape(page, '.confirm-dialog[open]')).toEqual([]);
      await dialog.getByRole('button', { name: 'Keep the notes' }).click();
      await expect(dialog).toBeHidden();

      // The share popup.
      await page.click('#shareSaveButton');
      await expect(page.locator('#fullURLPopup')).toBeVisible();
      expect.soft(await buttonsOffShape(page, '#fullURLPopup')).toEqual([]);
      await page.click('#fullURLPopupCloseButton');
      await expect(page.locator('#fullURLPopup')).toBeHidden();

      // The time signature popup.
      await page.click('#timeLabel');
      await expect(page.locator('#timeSigPopup')).toBeVisible();
      expect.soft(await buttonsOffShape(page, '#timeSigPopup')).toEqual([]);
    });
  });
}
