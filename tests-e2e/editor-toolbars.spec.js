import { test, expect } from './fixtures.js';
import { grooveData } from './helpers.js';

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

// Note cells are large enough for a finger on a tablet (audit item 27).
const lane = (notes, bars, pattern) => `|${Array(bars).fill(pattern.slice(0, notes)).join('|')}|`;
const grid = (div, bars, extra = '') =>
  `?TimeSig=4/4&Div=${div}&Tempo=80&Measures=${bars}` +
  `&H=${lane(div, bars, 'x-'.repeat(16))}&S=${lane(div, bars, '-'.repeat(32))}` +
  `&K=${lane(div, bars, 'o' + '-'.repeat(31))}${extra}`;
const withToms = (div, bars) =>
  `&T1=${lane(div, bars, '-'.repeat(32))}&T4=${lane(div, bars, '-'.repeat(32))}`;

// The box of every note cell that is shown, and the element at the centre of each one.
function measureCells(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#musicalInput :is(.hi-hat, .tom, .snare, .kick)')]
      .map((cell) => ({ cell, box: cell.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 0 && box.height > 0)
      .map(({ cell, box }) => {
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {
          id: cell.id,
          width: box.width,
          height: box.height,
          top: Math.round(box.top),
          bar: cell.closest('.staff-container').id,
          hitsItself: !!hit && cell.contains(hit),
        };
      })
  );
}

// Short failure lists: the cells that are too small, and the cells a tap at the centre misses.
const small = (cells, isSmall) =>
  cells.filter(isSmall).map((c) => `${c.id} ${c.width.toFixed(1)}x${c.height.toFixed(1)}`);
const missed = (cells) => cells.filter((c) => !c.hitsItself).map((c) => c.id);

// The left edge of the first cell of each bar.
function barLefts(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#musicalInput .staff-container')].map((bar) =>
      Math.round(bar.querySelector('.hi-hat').getBoundingClientRect().left)
    )
  );
}

// Nothing makes the page scroll sideways, and the bars fit inside the note grid.
function horizontalOverflow(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const input = document.getElementById('musicalInput');
    return {
      page: root.scrollWidth - root.clientWidth,
      grid: input.scrollWidth - input.clientWidth,
    };
  });
}

for (const [name, width, height] of [
  ['tablet landscape', 1024, 768],
  ['tablet portrait', 768, 1024],
  ['desktop', 1440, 900],
]) {
  test.describe(`finger-size notes, ${name}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true });

    for (const [groove, query] of [
      ['1/16 notes with toms', grid(16, 1, withToms(16, 1))],
      ['1/8 notes', grid(8, 2)],
    ]) {
      test(`every cell is at least 44 px and a tap at its centre hits it (${groove})`, async ({
        page,
      }) => {
        await openEditor(page, query);
        const cells = await measureCells(page);
        // hi-hat, two toms, snare and kick in every column
        expect(cells).toHaveLength(query.includes('T1=') ? 16 * 5 : 8 * 2 * 3);
        expect(small(cells, (c) => c.width < 44 || c.height < 44)).toEqual([]);
        expect(missed(cells)).toEqual([]);
        expect(await horizontalOverflow(page)).toEqual({ page: 0, grid: 0 });
      });
    }

    test('1/32 notes are 44 px tall, and a bar stays on one line', async ({ page }) => {
      await openEditor(page, grid(32, 2));
      const cells = await measureCells(page);
      expect(cells).toHaveLength(32 * 2 * 3);
      expect(small(cells, (c) => c.height < 44)).toEqual([]);
      expect(missed(cells)).toEqual([]);
      for (const bar of ['staff-container1', 'staff-container2']) {
        const lanes = new Set(cells.filter((c) => c.bar === bar).map((c) => c.top));
        // One line of hi-hat, one of snare, one of kick: the bar did not split.
        expect(lanes.size, bar).toBe(3);
      }
      expect((await horizontalOverflow(page)).page).toBe(0);
    });

    test('the rows of a wrapped grid all start at the same left edge', async ({ page }) => {
      await openEditor(page, grid(16, 3));
      const lefts = await barLefts(page);
      expect(lefts).toHaveLength(3);
      expect(new Set(lefts).size).toBe(1);
    });
  });
}

test.describe('finger-size notes, desktop with 1/8 notes', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the rows of a wrapped grid all start at the same left edge', async ({ page }) => {
    await openEditor(page, grid(8, 3));
    const lefts = await barLefts(page);
    expect(lefts).toHaveLength(3);
    expect(new Set(lefts).size).toBe(1);
  });
});

test.describe('finger-size notes, reading the grid back', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true });

  test('taps on the larger cells still write the notes into the URL', async ({ page }) => {
    await openEditor(
      page,
      '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|----------------|&S=|----------------|&K=|----------------|'
    );
    await page.locator('#hi-hat0').tap();
    await page.locator('#snare4').tap();
    await page.locator('#kick8').tap();
    const written =
      '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|x---------------|&S=|----O-----------|&K=|--------o-------|';
    await expect(page).toHaveURL((url) => url.search === written);
    expect(await grooveData(page)).toMatchObject({ hhOn: 1, snareOn: 1, kickOn: 1 });
  });
});

test('Save stays in view mode', async ({ page }) => {
  await openEditor(page);
  await page.click('#view-edit-switch');
  await expect(page.locator('#saveButton')).toBeVisible();
});
