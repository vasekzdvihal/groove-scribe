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
  await page.getByRole('dialog').getByRole('button', { name: 'Clear all notes' }).click();
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
      .map(({ cell }) => {
        // The bars at the top and bottom of the screen cover cells that are scrolled out of view.
        cell.scrollIntoView({ block: 'center' });
        const box = cell.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {
          id: cell.id,
          width: box.width,
          height: box.height,
          // relative to the bar, because the page scrolls between cells
          top: Math.round(box.top - cell.closest('.staff-container').getBoundingClientRect().top),
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

// The left edge of the first cell of the first bar in each row of bars.
function rowStarts(page) {
  return page.evaluate(() => {
    const starts = new Map();
    for (const bar of document.querySelectorAll('#musicalInput .staff-container')) {
      const top = Math.round(bar.getBoundingClientRect().top);
      const left = Math.round(bar.querySelector('.hi-hat').getBoundingClientRect().left);
      starts.set(top, Math.min(starts.get(top) ?? Infinity, left));
    }
    return [...starts.values()];
  });
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
      const starts = await rowStarts(page);
      expect(starts).toHaveLength(3);
      expect(new Set(starts).size).toBe(1);
      // A bar that is cut off at the right edge does not count as a row that fits.
      expect(await horizontalOverflow(page)).toEqual({ page: 0, grid: 0 });
    });

    test('shown stickings line up with the note columns', async ({ page }) => {
      await openEditor(page, grid(16, 1));
      await page.click('#stickingsButton');
      await page.locator('#stickingsContextMenu li').filter({ hasText: 'Show or Hide' }).click();
      const columns = await page.evaluate(() =>
        [...document.querySelectorAll('#musicalInput .sticking')].map((cell, i) => {
          const box = cell.getBoundingClientRect();
          const note = document.getElementById('hi-hat' + i).getBoundingClientRect();
          return {
            id: cell.id,
            left: Math.round(box.left - note.left),
            width: Math.round(box.width - note.width),
            tall: box.height >= 44,
          };
        })
      );
      expect(columns).toHaveLength(16);
      expect(columns.filter((c) => c.left !== 0 || c.width !== 0 || !c.tall)).toEqual([]);
    });
  });
}

test.describe('finger-size notes, 1/8 notes on a landscape tablet', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  for (const bars of [2, 4]) {
    test(`${bars} bars sit two to a row, with 44 px cells`, async ({ page }) => {
      await openEditor(page, grid(8, bars));
      const rows = await page.evaluate(() => {
        const tops = [...document.querySelectorAll('#musicalInput .staff-container')].map((bar) =>
          Math.round(bar.getBoundingClientRect().top)
        );
        return [...new Set(tops)].map((top) => tops.filter((t) => t === top).length);
      });
      expect(rows).toEqual(Array(bars / 2).fill(2));
      const cells = await measureCells(page);
      expect(cells).toHaveLength(8 * bars * 3);
      expect(small(cells, (c) => c.width < 44 || c.height < 44)).toEqual([]);
      expect(missed(cells)).toEqual([]);
      expect(new Set(await rowStarts(page)).size).toBe(1);
    });
  }

  test('Remove measure is a 44 px target that covers no cell', async ({ page }) => {
    await openEditor(page, grid(8, 2));
    const remove = await page.evaluate(() =>
      [...document.querySelectorAll('#musicalInput .closeMeasureButton[id]')].map((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        const cells = [...document.querySelectorAll('#musicalInput :is(.hi-hat, .snare, .kick)')];
        return {
          big: box.width >= 44 && box.height >= 44,
          hitsItself: button.contains(hit),
          overlaps: cells.some((cell) => {
            const c = cell.getBoundingClientRect();
            return (
              box.left < c.right && c.left < box.right && box.top < c.bottom && c.top < box.bottom
            );
          }),
        };
      })
    );
    expect(remove).toEqual(Array(2).fill({ big: true, hitsItself: true, overlaps: false }));
  });
});

test.describe('finger-size notes, the symbols in the grid', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true });

  test('1/32 circles keep a gap to their neighbours', async ({ page }) => {
    await openEditor(page, grid(32, 1));
    const gaps = await page.evaluate(() =>
      [0, 1, 2].map((i) => {
        const a = document.getElementById('snare_circle' + i).getBoundingClientRect();
        const b = document.getElementById('snare_circle' + (i + 1)).getBoundingClientRect();
        return Math.round(b.left - a.right);
      })
    );
    expect(gaps.filter((gap) => gap < 3)).toEqual([]);
  });

  test('snare and kick sit the same distance under the line above, and the highlight stops at the kick line', async ({
    page,
  }) => {
    await openEditor(page, grid(16, 1));
    const layout = await page.evaluate(() => {
      const box = (id) => document.getElementById(id).getBoundingClientRect();
      const lineBottom = (lane) => lane.getBoundingClientRect().bottom; // the line is the lane's bottom border
      const hh = document.querySelector('#musicalInput .hi-hat-container');
      const snare = document.querySelector('#musicalInput .snare-container');
      const kick = document.querySelector('#musicalInput .kick-container');
      const kickLine =
        kick.getBoundingClientRect().top +
        parseFloat(getComputedStyle(kick).backgroundPositionY) +
        3;
      // Note 1 is off in both lanes, so both circles have the same off size.
      return {
        snare: Math.round(box('snare_circle1').top - lineBottom(hh)),
        kick: Math.round(box('kick_circle1').top - lineBottom(snare)),
        highlightEnd: Math.round(box('bg-highlight0').bottom - kickLine),
      };
    });
    expect(layout.kick).toBe(layout.snare);
    expect(layout.highlightEnd).toBe(0);
  });
});

test.describe('finger-size notes, desktop with 1/8 notes', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the rows of a wrapped grid all start at the same left edge', async ({ page }) => {
    await openEditor(page, grid(8, 3));
    // 3 bars of 1/8 notes: two in the first row, one in the second.
    const starts = await rowStarts(page);
    expect(starts).toHaveLength(2);
    expect(new Set(starts).size).toBe(1);
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

// Controls (audit item 31 and the Severity 2 and 1 rows).
test.describe('controls', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  const isOff = (locator) => locator.evaluate((node) => node.getAttribute('aria-disabled'));
  const opacity = (locator) => locator.evaluate((node) => Number(getComputedStyle(node).opacity));

  test('Undo and Redo are off when there is nothing to undo or redo', async ({ page }) => {
    await openEditor(page);
    const undo = page.locator('#undoButton');
    const redo = page.locator('#redoButton');
    expect([await isOff(undo), await isOff(redo)]).toEqual(['true', 'true']);
    expect(await opacity(undo)).toBeLessThan(1);
    expect(await opacity(redo)).toBeLessThan(1);

    await page.click('#snare1');
    expect([await isOff(undo), await isOff(redo)]).toEqual(['false', 'true']);
    expect(await opacity(undo)).toBe(1);

    await undo.click();
    expect([await isOff(undo), await isOff(redo)]).toEqual(['true', 'false']);
    expect(await opacity(redo)).toBe(1);

    await redo.click();
    expect([await isOff(undo), await isOff(redo)]).toEqual(['false', 'true']);

    // A loaded groove can be undone, so Undo is on after a load too. The Grooves menu and the
    // library open a groove with loadNewGroove.
    await undo.click();
    await page.evaluate(() =>
      window.myGrooveWriter.loadNewGroove('?TimeSig=4/4&Div=8&Tempo=90&Measures=1&H=|x-x-x-x-|')
    );
    expect([await isOff(undo), await isOff(redo)]).toEqual(['false', 'true']);
  });

  test('Clear all notes is apart from Download, and asks first in the page', async ({ page }) => {
    page.on('dialog', (dialog) => {
      throw new Error('window dialog: ' + dialog.message());
    });
    await openEditor(page);
    const order = await page
      .locator('#morePopover > *')
      .evaluateAll((nodes) => nodes.map((node) => node.id || node.className));
    const at = order.indexOf('clearAllNotesButton');
    expect(order[at - 1]).not.toBe('downloadButton');
    expect(order[at + 1]).not.toBe('downloadButton');

    const start = page.url();
    const dialog = page.getByRole('dialog', { name: 'Clear all notes?' });
    await page.click('#moreButton');
    await page.click('#clearAllNotesButton');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep the notes' }).click();
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(start);
    expect((await grooveData(page)).hhOn).toBe(16);

    await page.click('#moreButton');
    await page.click('#clearAllNotesButton');
    await dialog.getByRole('button', { name: 'Clear all notes' }).click();
    await expect(dialog).toBeHidden();
    expect(await grooveData(page)).toMatchObject({ hhOn: 0, snareOn: 0, kickOn: 0 });
  });

  test('Download names the formats it makes', async ({ page }) => {
    await openEditor(page);
    await expect(page.locator('#downloadButton')).toHaveText(/SVG.*PNG.*MIDI/);
  });

  test('the click buttons are at least 44 px in both directions', async ({ page }) => {
    await openEditor(page);
    const sizes = await page.locator('#metronomeContainer .metronomeButton').evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { id: node.id, small: box.width < 44 || box.height < 44, height: box.height };
      })
    );
    expect(sizes).toHaveLength(5);
    expect(sizes.filter((size) => size.small)).toEqual([]);
  });

  test('a note that is on differs from one that is off in size, not only in colour', async ({
    page,
  }) => {
    await openEditor(page);
    const size = (id) =>
      page.locator('#' + id).evaluate((node) => Math.round(node.getBoundingClientRect().width));
    const cue = async () => ({
      snareOn: await size('snare_circle4'),
      snareOff: await size('snare_circle1'),
      kickOn: await size('kick_circle0'),
      kickOff: await size('kick_circle1'),
      on: await page.locator('#snare1').getAttribute('data-on'),
    });
    const before = await cue();
    expect(before.snareOff).toBeLessThan(before.snareOn);
    expect(before.kickOff).toBeLessThan(before.kickOn);
    expect(before.on).toBeNull();

    // The note setters keep the cue: an edit, an undo and Clear all notes.
    await page.click('#snare1');
    expect(await cue()).toMatchObject({ snareOff: before.snareOn, on: '' });
    await page.click('#undoButton');
    expect(await cue()).toMatchObject({ snareOff: before.snareOff, on: null });
    await page.evaluate(() => window.myGrooveWriter.clearAllNotes());
    expect(await cue()).toMatchObject({ snareOn: before.snareOff, kickOn: before.kickOff });
    expect(await page.locator('#musicalInput [data-on]').count()).toBe(0);
  });

  test('the touch note-type switch says what it does', async ({ page }) => {
    await openEditor(page);
    const button = page.locator('#advancedEditAnchor');
    await expect(button).toHaveText('Note types');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  test('no empty band under the note grid', async ({ page }) => {
    await openEditor(page);
    const band = await page.evaluate(() => {
      const input = document.getElementById('musicalInput');
      const add = document.getElementById('addMeasureButton').getBoundingClientRect();
      return {
        below: Math.round(input.getBoundingClientRect().bottom - add.bottom),
        line: getComputedStyle(input).borderBottomWidth,
      };
    });
    expect(band.below).toBeLessThanOrEqual(8);
    expect(band.line).toBe('0px');
  });
});

// Every item of the tool bar and the playback bar is in view, without sideways scroll, and no
// item covers another. Note types shows only on a touch screen, so both kinds are checked.
for (const [width, height] of [
  [1024, 768],
  [768, 1024],
  [1440, 900],
]) {
  for (const hasTouch of [true, false]) {
    test.describe(`bar items at ${width}x${height}${hasTouch ? ' with touch' : ''}`, () => {
      test.use({ viewport: { width, height }, hasTouch });

      test('every item is in view and covers no other', async ({ page }) => {
        await openEditor(page);
        const report = await page.evaluate(() => {
          const result = {};
          for (const id of ['ToolBar', 'PlaybackBar']) {
            const bar = document.getElementById(id);
            const edge = bar.getBoundingClientRect();
            const items = [
              ...bar.querySelectorAll(
                'button, input, .tempoLabel, #metronomeLabel, .MIDIPlayTime, .midiPlayImage'
              ),
            ]
              .filter(
                (node) =>
                  node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden'
              )
              .filter((node) => !node.closest('.tool-popover, .swingRow'))
              .map((node) => ({
                name: node.id || node.className,
                box: node.getBoundingClientRect(),
              }))
              .filter(({ box }) => box.width > 0);
            result[id] = {
              scroll: bar.scrollWidth - bar.clientWidth,
              outside: items
                .filter(({ box }) => box.left < edge.left || box.right > edge.right + 0.5)
                .map(({ name }) => name),
              overlapping: items.flatMap((a, i) =>
                items
                  .slice(i + 1)
                  .filter(
                    (b) =>
                      a.box.left < b.box.right - 0.5 &&
                      b.box.left < a.box.right - 0.5 &&
                      a.box.top < b.box.bottom - 0.5 &&
                      b.box.top < a.box.bottom - 0.5
                  )
                  .map((b) => `${a.name} / ${b.name}`)
              ),
            };
          }
          return result;
        });
        const clean = { scroll: 0, outside: [], overlapping: [] };
        expect(report).toEqual({ ToolBar: clean, PlaybackBar: clean });
      });
    });
  }
}
