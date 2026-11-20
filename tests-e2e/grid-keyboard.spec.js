import { test, expect } from './fixtures.js';
import { loadGroove } from './helpers.js';

// The note grid by keyboard: one tab stop, the arrow keys move in it, Space or Enter sets a
// note. A screen reader hears each cell as "<instrument>, <place>, on|off".

test.use({ viewport: { width: 1024, height: 768 } });

const EMPTY =
  '/index.html?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|----------------|&S=|----------------|&K=|----------------|';
const TWO_BARS =
  '/index.html?TimeSig=4/4&Div=16&Tempo=80&Measures=2&H=|x---------------|----------------|&S=|----------------|----------------|&K=|----------------|----------------|';

const focusedId = (page) => page.evaluate(() => document.activeElement?.id ?? '');
const tempo = (page) => page.evaluate(() => window.myGrooveWriter.myGrooveUtils.getTempo());
const isCell = (page) =>
  page.evaluate(() => document.activeElement?.getAttribute('role') === 'gridcell');

// The cells that are the tab stop, and whether each one shows.
const stops = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="gridcell"][tabindex="0"]')].map((cell) => ({
      id: cell.id,
      visible: cell.getClientRects().length > 0,
    }))
  );

async function chooseDivision(page, id) {
  await page.click('#divisionMenuButton');
  await page.click(`#${id}`);
}

async function tabToGrid(page) {
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    if (await isCell(page)) return;
  }
  throw new Error('Tab did not reach the note grid');
}

test('one Tab from the last tool before the grid reaches the grid', async ({ page }) => {
  await loadGroove(page, EMPTY);
  await tabToGrid(page);
  expect(await focusedId(page)).toBe('hi-hat0');
  // The whole grid is one tab stop: the next Tab leaves it, and Shift+Tab comes back.
  await page.keyboard.press('Tab');
  expect(await isCell(page)).toBe(false);
  await page.keyboard.press('Shift+Tab');
  expect(await focusedId(page)).toBe('hi-hat0');
});

test('the arrows move, and Space sets a note', async ({ page }) => {
  await loadGroove(page, EMPTY);
  await page.focus('#hi-hat0');
  await page.keyboard.press('ArrowDown'); // toms and stickings are hidden
  expect(await focusedId(page)).toBe('snare0');
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  expect(await focusedId(page)).toBe('snare4');
  const cell = page.locator('#snare4');
  await expect(cell).toHaveAttribute('aria-label', 'Snare, beat 2, off');
  await page.keyboard.press('Space');
  await expect(cell).toHaveAttribute('aria-label', 'Snare, beat 2, on');
  await expect.poll(() => page.evaluate(() => location.search)).toContain('S=|----O');
  await page.keyboard.press('Enter');
  await expect(cell).toHaveAttribute('aria-label', 'Snare, beat 2, off');
  await expect.poll(() => page.evaluate(() => location.search)).toContain('S=|----------------|');
  // Up goes back to the hi-hat. The ends stop the arrows.
  await page.keyboard.press('ArrowUp');
  expect(await focusedId(page)).toBe('hi-hat4');
  await page.keyboard.press('ArrowUp');
  expect(await focusedId(page)).toBe('hi-hat4');
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowLeft');
  expect(await focusedId(page)).toBe('hi-hat0');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  expect(await focusedId(page)).toBe('kick0');
});

test('a sticking cell turns through its states and says each one', async ({ page }) => {
  await loadGroove(page, EMPTY);
  await page.click('#stickingsButton');
  await page.locator('#stickingsContextMenu li').filter({ hasText: 'Show or Hide' }).click();
  await page.focus('#hi-hat2');
  await page.keyboard.press('ArrowUp');
  expect(await focusedId(page)).toBe('sticking2');
  const cell = page.locator('#sticking2');
  await expect(cell).toHaveAttribute('aria-label', 'Sticking, beat 1 and, off');
  for (const state of ['R', 'L', 'R and L', 'count', 'off']) {
    await page.keyboard.press('Space');
    await expect(cell).toHaveAttribute('aria-label', `Sticking, beat 1 and, ${state}`);
  }
});

test('a loaded sticking says its letter', async ({ page }) => {
  await loadGroove(page, EMPTY.replace('&H=', '&Stickings=|RLBc------------|&H='));
  const names = await page.evaluate(() =>
    [0, 1, 2, 3, 4].map((i) => document.getElementById('sticking' + i).getAttribute('aria-label'))
  );
  expect(names).toEqual([
    'Sticking, beat 1, R',
    'Sticking, beat 1 e, L',
    'Sticking, beat 1 and, R and L',
    'Sticking, beat 1 a, count',
    'Sticking, beat 2, off',
  ]);
});

test('a held Space or Enter sets the note once', async ({ page }) => {
  await loadGroove(page, EMPTY);
  await page.focus('#snare4');
  // Each key alone: two toggles would hide a missed repeat.
  for (const key of [' ', 'Enter']) {
    const seen = await page.evaluate((k) => {
      const cell = document.getElementById('snare4');
      const event = new KeyboardEvent('keydown', {
        key: k,
        repeat: true,
        bubbles: true,
        cancelable: true,
      });
      cell.dispatchEvent(event);
      return event.defaultPrevented;
    }, key);
    expect(seen).toBe(true); // the page keys still do not get it
    await expect(page.locator('#snare4')).toHaveAttribute('aria-label', 'Snare, beat 2, off');
  }
  await expect(page.locator('#snare4')).toHaveAttribute('aria-label', 'Snare, beat 2, off');
  await page.keyboard.press('Space');
  await expect(page.locator('#snare4')).toHaveAttribute('aria-label', 'Snare, beat 2, on');
});

test('Right at the end of bar 1 goes to bar 2', async ({ page }) => {
  await loadGroove(page, TWO_BARS);
  await page.focus('#kick15');
  await expect(page.locator('#kick15')).toHaveAttribute('aria-label', 'Kick, bar 1, beat 4 a, off');
  await page.keyboard.press('ArrowRight');
  expect(await focusedId(page)).toBe('kick16');
  await expect(page.locator('#kick16')).toHaveAttribute('aria-label', 'Kick, bar 2, beat 1, off');
  await page.keyboard.press('ArrowLeft');
  expect(await focusedId(page)).toBe('kick15');
  // A hi-hat that is on says so after a load too.
  await expect(page.locator('#hi-hat0')).toHaveAttribute('aria-label', 'Hi-hat, bar 1, beat 1, on');
});

test('Home, End, Ctrl+Home and Ctrl+End', async ({ page }) => {
  await loadGroove(page, TWO_BARS);
  await page.focus('#snare20');
  await page.keyboard.press('Home');
  expect(await focusedId(page)).toBe('snare16');
  await page.keyboard.press('End');
  expect(await focusedId(page)).toBe('snare31');
  await page.keyboard.press('Control+Home');
  expect(await focusedId(page)).toBe('snare0');
  await page.keyboard.press('Control+End');
  expect(await focusedId(page)).toBe('snare31');
  await page.keyboard.press('ArrowRight');
  expect(await focusedId(page)).toBe('snare31');
});

test('Left and Right in the grid do not change the tempo', async ({ page }) => {
  await loadGroove(page, EMPTY);
  const before = await tempo(page);
  await page.focus('#snare4');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(await tempo(page)).toBe(before);
  expect(await focusedId(page)).toBe('snare5');
});

test('Left and Right outside the grid and inputs still change the tempo', async ({ page }) => {
  await loadGroove(page, EMPTY);
  const before = await tempo(page);
  await page.locator('#svgTarget').click(); // an empty area of the music: focus goes to the page
  await page.keyboard.press('ArrowRight');
  expect(await tempo(page)).toBe(before + 1);
  await page.keyboard.press('ArrowLeft');
  expect(await tempo(page)).toBe(before);
});

test('Left and Right in the tempo field move the caret only', async ({ page }) => {
  await loadGroove(page, EMPTY);
  const before = await tempo(page);
  const field = page.locator('input[aria-label="Beats per minute"]');
  await field.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  expect(await tempo(page)).toBe(before);
});

test('Left and Right on the swing slider do not change the tempo', async ({ page }) => {
  await loadGroove(page, EMPTY);
  const before = await tempo(page);
  await page.click('#swingButton');
  await page.locator('input[type=range][aria-label="Swing"]').focus();
  await page.keyboard.press('ArrowRight');
  expect(await tempo(page)).toBe(before);
});

test('a click on a cell sets the note and leaves Space to Play', async ({ page }) => {
  await loadGroove(page, EMPTY);
  await page.click('#snare4');
  await expect(page.locator('#snare4')).toHaveAttribute('aria-label', 'Snare, beat 2, on');
  // The mouse does not take the focus into the grid, so the page keys still work.
  expect(await isCell(page)).toBe(false);
  // The clicked cell is the tab stop now.
  expect(await stops(page)).toEqual([{ id: 'snare4', visible: true }]);
});

test('Space in the grid sets the note while the groove plays and does not stop it', async ({
  page,
}) => {
  await loadGroove(page, EMPTY);
  // The Play control gets its click handler when the soundfont has loaded.
  await expect(page.locator('[id^="midiPlayImage"]')).toHaveClass(/Stopped/, { timeout: 15000 });
  await page.click('[id^="midiPlayImage"]');
  await expect
    .poll(() => page.evaluate(() => window.myGrooveWriter.myGrooveUtils.isPlaying()))
    .toBe(true);
  await page.focus('#snare4');
  await page.keyboard.press('Space');
  await expect(page.locator('#snare4')).toHaveAttribute('aria-label', 'Snare, beat 2, on');
  await page.keyboard.press('Enter');
  await expect(page.locator('#snare4')).toHaveAttribute('aria-label', 'Snare, beat 2, off');
  expect(await page.evaluate(() => window.myGrooveWriter.myGrooveUtils.isPlaying())).toBe(true);
  expect(await focusedId(page)).toBe('snare4');
  await page.evaluate(() => window.myGrooveWriter.myGrooveUtils.stopMIDI_playback());
});

test('the grid keeps one visible tab stop after a redraw or a hidden lane', async ({ page }) => {
  await loadGroove(page, EMPTY);
  await page.focus('#snare4');
  expect(await stops(page)).toEqual([{ id: 'snare4', visible: true }]);

  // A redraw (a bar added) makes new cells: the first hi-hat is the stop again.
  await page.click('#addMeasureButton');
  await expect(page.locator('#hi-hat16')).toBeAttached();
  await expect.poll(() => stops(page)).toEqual([{ id: 'hi-hat0', visible: true }]);

  // A new division draws the grid again too. The focus was in the grid and no click took it
  // out, so the focus and the stop go to the same cell in the new grid.
  await page.focus('#kick3');
  await page.evaluate(() => window.myGrooveWriter.changeDivision(8));
  await expect(page.locator('#kick15')).toBeAttached(); // 2 bars of 1/8 notes
  await expect(page.locator('#kick16')).not.toBeAttached();
  await expect.poll(() => stops(page)).toEqual([{ id: 'kick3', visible: true }]);
  expect(await focusedId(page)).toBe('kick3');

  // From the mouse, a new division takes the focus out of the grid: the first hi-hat is the stop.
  await chooseDivision(page, 'subdivision_16ths');
  await expect(page.locator('#kick31')).toBeAttached();
  await expect.poll(() => stops(page)).toEqual([{ id: 'hi-hat0', visible: true }]);
  expect(await isCell(page)).toBe(false);

  // A tom lane that hides takes its stop with it: the stop moves to a cell that shows.
  await page.click('#showHideTomsButton');
  await page.focus('#tom1-3');
  expect(await stops(page)).toEqual([{ id: 'tom1-3', visible: true }]);
  await page.click('#showHideTomsButton');
  await expect.poll(() => stops(page)).toEqual([{ id: 'hi-hat0', visible: true }]);

  // Tab still reaches the grid.
  await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.blur());
  await tabToGrid(page);
  expect(await focusedId(page)).toBe('hi-hat0');
});

test('Ctrl+Z in the grid undoes the last note', async ({ page }) => {
  await loadGroove(page, EMPTY);
  await page.focus('#snare4');
  await page.keyboard.press('Space');
  await expect(page.locator('#snare4')).toHaveAttribute('aria-label', 'Snare, beat 2, on');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#snare4')).toHaveAttribute('aria-label', 'Snare, beat 2, off');
  await expect.poll(() => page.evaluate(() => location.search)).toContain('S=|----------------|');
});

test('the focus stays in the grid when Ctrl+Z draws the grid again', async ({ page }) => {
  await loadGroove(page, EMPTY);
  await page.click('#addMeasureButton');
  await expect(page.locator('#snare16')).toBeAttached();
  await page.focus('#snare4');
  await page.keyboard.press('Control+z'); // takes back the added bar: a redraw
  await expect(page.locator('#snare16')).not.toBeAttached();
  await expect.poll(() => focusedId(page)).toBe('snare4');
  expect(await stops(page)).toEqual([{ id: 'snare4', visible: true }]);
  // Redo draws the second bar again, and the focus stays too.
  await page.keyboard.press('Control+y');
  await expect(page.locator('#snare16')).toBeAttached();
  await expect.poll(() => focusedId(page)).toBe('snare4');
  expect(await stops(page)).toEqual([{ id: 'snare4', visible: true }]);
});

test('the focus goes to the hi-hat when Ctrl+Z hides the stickings lane', async ({ page }) => {
  await loadGroove(page, EMPTY);
  await page.click('#stickingsButton');
  await page.locator('#stickingsContextMenu li').filter({ hasText: 'Show or Hide' }).click();
  await page.focus('#sticking3');
  await page.keyboard.press('Control+z'); // takes back the shown stickings
  await expect(page.locator('#sticking3')).toBeHidden();
  await expect.poll(() => focusedId(page)).toBe('hi-hat3');
  expect(await stops(page)).toEqual([{ id: 'hi-hat3', visible: true }]);
});

test('a hidden stickings lane takes its stop with it', async ({ page }) => {
  await loadGroove(page, EMPTY);
  await page.click('#stickingsButton');
  await page.locator('#stickingsContextMenu li').filter({ hasText: 'Show or Hide' }).click();
  await page.focus('#sticking3');
  expect(await stops(page)).toEqual([{ id: 'sticking3', visible: true }]);
  await page.click('#stickingsButton');
  await page.locator('#stickingsContextMenu li').filter({ hasText: 'Show or Hide' }).click();
  await expect(page.locator('#sticking3')).toBeHidden();
  await expect.poll(() => stops(page)).toEqual([{ id: 'hi-hat0', visible: true }]);
  // A redraw that the mouse starts does not take the focus into the grid.
  expect(await isCell(page)).toBe(false);
});
