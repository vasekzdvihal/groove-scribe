import { test, expect } from './fixtures.js';
import { contrastRatio } from './a11y-helpers.js';

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
      for (const node of root.querySelectorAll('button, [role="button"], share-button')) {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        if (!node.getClientRects().length || style.visibility === 'hidden') continue;
        if (style.borderRadius === '50%' || node.closest('.tempoKnob, [role="gridcell"]')) continue;
        // Add a bar and Remove have no fill. Their corners stay square, so the whole 44 px box
        // takes a tap. Only their focus ring is round.
        if (node.matches('.closeMeasureButton, #addMeasureButton')) continue;
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

      // The bar buttons above and beside the grid: the bar ruler, Add a bar and Remove. The note
      // cells keep their own shape.
      await page.click('#addMeasureButton');
      await expect(page.locator('.closeMeasureButton[id]').first()).toBeVisible();
      expect.soft(await buttonsOffShape(page, '#musicalInput')).toEqual([]);
      expect.soft(await radius('#helpLink')).toBe('6px');
      expect.soft(await radius('#helpAnchor')).toBe('6px');

      // The side panel: Library, then Grooves. On the hermetic e2e server the Library tab shows
      // only the signed-out text and Sign in, so this pass checks little there.
      // tests-cloud/library.spec.js "every library button has one shape" checks the real panel.
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

// The popover items have an accent focus ring on white. A selected item is filled with the
// accent, so its ring must change colour to show.
test('a selected popover item shows its focus ring', async ({ page }) => {
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');
  await page.focus('#divisionMenuButton');
  await page.keyboard.press('Enter');
  await expect(page.locator('#divisionPopover')).toBeVisible();
  const selected = page.locator('#subdivision_16ths');
  await expect(selected).toHaveClass(/buttonSelected/);
  await selected.focus();
  const ring = await selected.evaluate((node) => {
    const style = getComputedStyle(node);
    return { outline: style.outlineColor, style: style.outlineStyle, fill: style.backgroundColor };
  });
  expect(ring.style).not.toBe('none');
  expect(contrastRatio(ring.outline, ring.fill)).toBeGreaterThanOrEqual(3);
});

// The note key in Details is a checkbox. The keyboard reaches it, and its focus ring shows on
// the plain label and on the checked (accent) label.
test('the note key shows its focus ring, on and off', async ({ page }) => {
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');
  await page.focus('#detailsButton');
  await page.keyboard.press('Enter');
  await expect(page.locator('#detailsPopover')).toBeVisible();
  const box = page.locator('#showLegend');
  for (let i = 0; i < 10; i++) {
    if (await box.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(box).toBeFocused();
  const ring = () =>
    page.locator('#LegendLabel').evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        outline: style.outlineColor,
        style: style.outlineStyle,
        fill: style.backgroundColor,
      };
    });
  for (const checked of [false, true]) {
    if (checked) await page.keyboard.press('Space');
    await expect(box).toBeChecked({ checked });
    const now = await ring();
    expect(now.style, `checked: ${checked}`).not.toBe('none');
    expect(contrastRatio(now.outline, now.fill), `checked: ${checked}`).toBeGreaterThanOrEqual(3);
  }
});

// The grid text is Lato like the rest of the editor. It does not keep the old Times New Roman.
test('the grid text uses Lato', async ({ page }) => {
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');
  for (const selector of ['.hh-label', '.sticking_count', '.sticking_left', '.notes-container']) {
    const family = await page
      .locator(selector)
      .first()
      .evaluate((node) => getComputedStyle(node).fontFamily);
    expect(family, selector).toMatch(/^"?Lato"?,/);
  }
});
