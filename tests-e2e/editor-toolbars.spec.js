import { test, expect } from './fixtures.js';

const GROOVE =
  '?TimeSig=4/4&Div=16&Title=Paradiddle&Tempo=80&Measures=1&H=|xxxxxxxxxxxxxxxx|&S=|----O-------O---|&K=|o-------o-------|';

async function openEditor(page, query = GROOVE) {
  await page.goto('/index.html' + query);
  await page.waitForSelector('#svgTarget svg');
}

// Save is the button just before Share, with the same size, shape and colours.
async function expectSaveLikeShare(page) {
  const save = page.locator('#saveButton');
  const share = page.locator('#shareSaveButton');
  await expect(save).toBeVisible();
  await save.scrollIntoViewIfNeeded();
  await share.scrollIntoViewIfNeeded();
  const [saveBox, shareBox] = [await save.boundingBox(), await share.boundingBox()];
  expect(saveBox.y).toBe(shareBox.y);
  expect(saveBox.height).toBe(shareBox.height);
  expect(saveBox.x + saveBox.width).toBeLessThanOrEqual(shareBox.x);
  expect(shareBox.x - (saveBox.x + saveBox.width)).toBeLessThanOrEqual(12);
  // A label that is hidden on one is hidden on the other, so the widths match too.
  expect(Math.abs(saveBox.width - shareBox.width)).toBeLessThanOrEqual(12);
  const look = (locator) =>
    locator.evaluate((node) => {
      const style = getComputedStyle(node);
      const label = node.querySelector('.tool-label');
      return {
        background: style.backgroundColor,
        color: style.color,
        radius: style.borderRadius,
        weight: style.fontWeight,
        label: label ? getComputedStyle(label).display : null,
      };
    });
  expect(await look(save)).toEqual(await look(share));
  const layoutWidth = await page.evaluate(() => document.documentElement.clientWidth);
  for (const box of [saveBox, shareBox]) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(layoutWidth);
  }
}

for (const [name, width, height] of [
  ['tablet landscape', 1180, 820],
  ['tablet portrait', 820, 1180],
  ['desktop', 1280, 720],
]) {
  test.describe(name, () => {
    test.use({ viewport: { width, height }, hasTouch: true });

    test('the bars fit and their buttons are large enough to tap', async ({ page }) => {
      await openEditor(page);
      const report = await page.evaluate(() => {
        const bars = ['#TopNav', '#ToolBar', '#PlaybackBar'].map((id) =>
          document.querySelector(id)
        );
        const buttons = bars
          .flatMap((bar) => [...bar.querySelectorAll('button, .midiPlayImage')])
          .map((el) => ({ id: el.id || el.className, box: el.getBoundingClientRect() }))
          .filter(({ box }) => box.width > 0);
        return {
          overflowing: bars.filter((bar) => bar.scrollWidth > bar.clientWidth).map((bar) => bar.id),
          small: buttons.filter(({ box }) => box.width < 40 || box.height < 40).map(({ id }) => id),
          outside: buttons.filter(({ box }) => box.right > innerWidth).map(({ id }) => id),
          overlapping: buttons
            .filter(({ box }, i) =>
              buttons.some(
                (other, j) =>
                  i < j &&
                  box.left < other.box.right &&
                  other.box.left < box.right &&
                  box.top < other.box.bottom &&
                  other.box.top < box.bottom
              )
            )
            .map(({ id }) => id),
        };
      });
      expect(report).toEqual({ overflowing: [], small: [], outside: [], overlapping: [] });
    });

    test('Save sits next to Share and looks like it', async ({ page }) => {
      await openEditor(page);
      await expectSaveLikeShare(page);
    });

    test('the tempo controls do not overlap the click buttons', async ({ page }) => {
      await openEditor(page);
      const faster = await page.getByRole('button', { name: 'Faster' }).boundingBox();
      const off = await page.locator('#metronomeOff').boundingBox();
      expect(faster.x + faster.width).toBeLessThanOrEqual(off.x);
      const slider = page.locator('input[id^="tempoInput"]');
      if (await slider.isVisible()) {
        const box = await slider.boundingBox();
        expect(box.x + box.width).toBeLessThanOrEqual(off.x);
      }
    });

    test('menus opened from the bars stay on screen', async ({ page }) => {
      await openEditor(page);
      for (const [trigger, menu] of [
        ['#divisionMenuButton', '#divisionPopover'],
        ['#groovesAnchor', '#grooveListWrapper'],
        ['#permutationAnchor', '#permutationContextMenu'],
        ['#stickingsButton', '#stickingsContextMenu'],
        ['#detailsButton', '#detailsPopover'],
        ['#metronomeOptionsAnchor', '#metronomeOptionsContextMenu'],
        ['#swingButton', '#swingPopover'],
        ['#moreButton', '#morePopover'],
        ['#helpAnchor', '#helpContextMenu'],
      ]) {
        await page.click(trigger);
        await expect(page.locator(menu)).toBeVisible();
        const box = await page.locator(menu).boundingBox();
        expect(box.x, menu).toBeGreaterThanOrEqual(0);
        expect(box.y, menu).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, menu).toBeLessThanOrEqual(width);
        expect(box.y + box.height, menu).toBeLessThanOrEqual(height);
        // A click on the music closes any open menu.
        // The older menus start to listen for this click after a short delay.
        await expect(async () => {
          await page.locator('#svgTarget').click({ position: { x: 5, y: 5 } });
          await expect(page.locator(menu)).toBeHidden({ timeout: 200 });
        }).toPass();
      }
    });
  });
}

test('the note division menu changes the division and shows the choice', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('#divisionMenuLabel')).toHaveText('1/16 notes');
  await expect(page.locator('#subdivision_8ths')).toBeHidden();

  // The default groove has notes, so the switch to triplets asks first. Accept it.
  page.once('dialog', (dialog) => dialog.accept());
  await page.click('#divisionMenuButton');
  await page.click('#subdivision_12ths');
  await expect(page.locator('#divisionPopover')).toBeHidden();
  await expect(page.locator('#divisionMenuLabel')).toHaveText('1/8 triplets');
  expect(await page.evaluate(() => window.myGrooveWriter.notesPerMeasure())).toBe(12);
});

test('the division label follows the groove from the URL', async ({ page }) => {
  await openEditor(page, '?TimeSig=4/4&Div=8&Tempo=80&Measures=1&H=|xxxxxxxx|');
  await expect(page.locator('#divisionMenuLabel')).toHaveText('1/8 notes');
});

test('Escape closes a popover', async ({ page }) => {
  await openEditor(page);
  await page.click('#moreButton');
  await expect(page.locator('#morePopover')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#morePopover')).toBeHidden();
});

test('a second tap on the button closes its popover', async ({ page }) => {
  await openEditor(page);
  await page.click('#swingButton');
  await expect(page.locator('#swingPopover')).toBeVisible();
  await page.click('#swingButton');
  await expect(page.locator('#swingPopover')).toBeHidden();
});

test('the BPM buttons change the tempo by one', async ({ page }) => {
  await openEditor(page);
  const field = page.locator('[id^="tempoTextField"]');
  await expect(field).toHaveValue('80');
  await page.getByRole('button', { name: 'Faster' }).click();
  await expect(field).toHaveValue('81');
  await page.getByRole('button', { name: 'Slower' }).click();
  await page.getByRole('button', { name: 'Slower' }).click();
  await expect(field).toHaveValue('79');
  await expect(page).toHaveURL(/Tempo=79/);
});

test('the swing button shows the swing amount', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('#swingButtonLabel')).toHaveText('Swing 0%');
  await page.click('#swingButton');
  await page.locator('input[id^="swingInput"]').fill('25');
  await expect(page.locator('#swingButtonLabel')).toHaveText('Swing 25%');
  await expect(page.locator('#swingPopover')).toBeVisible();
});

test('the more menu clears the notes, and undo brings them back', async ({ page }) => {
  await openEditor(page);
  const url = page.url();
  await page.click('#moreButton');
  await page.click('#clearAllNotesButton');
  await expect(page.locator('#morePopover')).toBeHidden();
  await expect(page).not.toHaveURL(url);
  await page.click('#undoButton');
  await expect(page).toHaveURL(/H=\|x/);
});

test('the user menu holds help and about, not undo and redo', async ({ page }) => {
  await openEditor(page);
  await page.click('#helpAnchor');
  const menu = page.locator('#helpContextMenu');
  await expect(menu).toContainText('Help');
  await expect(menu).toContainText('About');
  await expect(menu).not.toContainText('Undo');
  await expect(menu).not.toContainText('Redo');
});

test('view mode hides the edit tools and edit mode shows them again', async ({ page }) => {
  await openEditor(page);
  const edit = ['#timeLabel', '#divisionMenuButton', '#undoButton', '#showHideTomsButton'];
  for (const id of edit) await expect(page.locator(id)).toBeVisible();

  await page.click('#view-edit-switch');
  for (const id of edit) await expect(page.locator(id)).toBeHidden();
  await expect(page.locator('#musicalInput')).toBeHidden();
  await expect(page.locator('#groovesAnchor')).toBeVisible();
  await expect(page.locator('#view-edit-switch')).toHaveText('Edit mode');

  await page.click('#view-edit-switch');
  for (const id of edit) await expect(page.locator(id)).toBeVisible();
  await expect(page.locator('#view-edit-switch')).toHaveText('View mode');
});

test('the top bar shows the title and follows edits', async ({ page }) => {
  await openEditor(page);
  await expect(page.locator('#grooveTitleDisplay')).toHaveText('Paradiddle');
  await page.click('#detailsButton');
  await page.locator('#tuneTitle').fill('New name');
  await page.locator('#tuneTitle').blur();
  await expect(page.locator('#grooveTitleDisplay')).toHaveText('New name');
  await expect(page.locator('#detailsPopover')).toBeVisible();
});

test('a groove without a title shows a placeholder', async ({ page }) => {
  await openEditor(page, '');
  await expect(page.locator('#grooveTitleDisplay')).toHaveText('Untitled groove');
});

test('space after a tap on a tool does not press that tool again', async ({ page }) => {
  await openEditor(page);
  const toms = page.locator('#showHideTomsButton');
  await toms.click();
  await expect(toms).toHaveClass(/ClickToHide/);
  await page.keyboard.press('Space');
  await expect(toms).toHaveClass(/ClickToHide/);
  await page.evaluate(() => window.myGrooveWriter.myGrooveUtils.stopMIDI_playback());
});

test('printing shows only the music', async ({ page }) => {
  await openEditor(page);
  await page.emulateMedia({ media: 'print' });
  for (const id of ['#TopNav', '#ToolBar', '#PlaybackBar']) {
    await expect(page.locator(id)).toBeHidden();
  }
  const box = await page.locator('#svgTarget').boundingBox();
  expect(box.y).toBeLessThan(10);
});

test('GrooveDB authoring mode still loads', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openEditor(page, '?GDB_Author=1');
  await expect(page.locator('#permutationAnchor')).toBeHidden();
  expect(errors).toEqual([]);
});

// A phone lays out the page 980 px wide (see index.html). A narrow desktop window does not,
// and neither does an iPad app in Slide Over or a narrow Split View.
for (const [name, isMobile, width, height] of [
  ['phone', true, 390, 844],
  ['narrow window', false, 390, 844],
  ['iPad Slide Over', false, 375, 1024],
]) {
  test.describe(name, () => {
    test.use({ viewport: { width, height }, hasTouch: true, isMobile });

    test('Save, Share and More can be reached', async ({ page }) => {
      await openEditor(page);
      await expectSaveLikeShare(page);
      const more = page.locator('#moreButton');
      await more.scrollIntoViewIfNeeded();
      const box = await more.boundingBox();
      const layoutWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(box.x + box.width).toBeLessThanOrEqual(layoutWidth);
    });
  });
}

test('Save has a name and a focus ring, and a fresh groove is not called saved', async ({
  page,
}) => {
  await openEditor(page);
  const save = page.locator('#saveButton');
  await expect(save).toHaveAccessibleName('Save');
  await expect(save).toHaveText('Save');
  await save.focus();
  const outline = await save.evaluate((node) => getComputedStyle(node).outlineStyle);
  expect(outline).toBe('solid');
});

test('Save stays in view mode', async ({ page }) => {
  await openEditor(page);
  await page.click('#view-edit-switch');
  await expect(page.locator('#saveButton')).toBeVisible();
});
