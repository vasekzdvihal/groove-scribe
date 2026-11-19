import { test, expect } from './fixtures.js';
import { loadGroove } from './helpers.js';

// The popovers, the older menus and the popups by keyboard. A menu or a popover that the
// keyboard opens takes the focus, and gives it back to its button when it closes. A tap opens
// them as before and leaves the focus where it is.

test.use({ viewport: { width: 1024, height: 768 } });

const GROOVE =
  '/index.html?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|x-x-x-x-x-x-x-x-|&S=|----O-------O---|&K=|o-------o-------|';

const focused = (page) => page.locator(':focus');
const focusedId = (page) => page.evaluate(() => document.activeElement?.id ?? '');

async function tabTo(page, selector) {
  const target = page.locator(selector);
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Tab did not reach ${selector}`);
}

test('Enter on a popover button moves focus to its first item, and Escape returns it', async ({
  page,
}) => {
  await loadGroove(page, GROOVE);
  const button = page.locator('#divisionMenuButton');
  await tabTo(page, '#divisionMenuButton');
  await page.keyboard.press('Enter');
  await expect(page.locator('#divisionPopover')).toBeVisible();
  await expect(focused(page)).toHaveId('subdivision_8ths');
  await page.keyboard.press('Escape');
  await expect(page.locator('#divisionPopover')).toBeHidden();
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('a popover item that closes it returns focus to its button', async ({ page }) => {
  await loadGroove(page, GROOVE);
  await tabTo(page, '#divisionMenuButton');
  await page.keyboard.press('Enter');
  await expect(focused(page)).toHaveId('subdivision_8ths');
  await page.keyboard.press('Enter');
  await expect(page.locator('#divisionPopover')).toBeHidden();
  await expect(page.locator('#divisionMenuLabel')).toHaveText('1/8 notes');
  await expect(page.locator('#divisionMenuButton')).toBeFocused();
});

test('Tab out of a popover closes it', async ({ page }) => {
  await loadGroove(page, GROOVE);
  await tabTo(page, '#divisionMenuButton');
  await page.keyboard.press('Enter');
  await expect(focused(page)).toHaveId('subdivision_8ths');
  const popover = page.locator('#divisionPopover');
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    if (!(await popover.evaluate((el) => el.contains(document.activeElement)))) break;
  }
  await expect(popover).toBeHidden();
  await expect(page.locator('#divisionMenuButton')).toHaveAttribute('aria-expanded', 'false');
  // The focus stays where Tab took it.
  expect(await popover.evaluate((el) => el.contains(document.activeElement))).toBe(false);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
});

test('a tap on a popover button does not move focus', async ({ page }) => {
  await loadGroove(page, GROOVE);
  await page.click('#divisionMenuButton');
  const popover = page.locator('#divisionPopover');
  await expect(popover).toBeVisible();
  expect(await popover.evaluate((el) => el.contains(document.activeElement))).toBe(false);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('Stickings opens a menu by keyboard', async ({ page }) => {
  await loadGroove(page, GROOVE);
  const button = page.locator('#stickingsButton');
  await expect(button).toHaveAttribute('aria-haspopup', 'menu');
  await tabTo(page, '#stickingsButton');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await expect(page.locator('#stickingsContextMenu')).toBeVisible();
  await expect(page.locator('#stickingsContextMenu')).toHaveAttribute('role', 'menu');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(focused(page)).toHaveAttribute('role', 'menuitem');
  await expect(focused(page)).toHaveText('Show or Hide stickings');
  await page.keyboard.press('ArrowDown');
  await expect(focused(page)).toHaveText('Reverse stickings R/L');
  await page.keyboard.press('ArrowDown');
  await expect(focused(page)).toHaveText('Show or Hide stickings');
  await page.keyboard.press('Enter');
  await expect(page.locator('#sticking0')).toBeVisible();
  await expect(page.locator('#stickingsContextMenu')).toBeHidden();
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('aria-expanded', 'false');
});

test('the arrow keys in a menu do not change the tempo, and Space picks', async ({ page }) => {
  await loadGroove(page, GROOVE);
  await tabTo(page, '#stickingsButton');
  await page.keyboard.press('Enter');
  await expect(focused(page)).toHaveText('Show or Hide stickings');
  await page.keyboard.press('End');
  await expect(focused(page)).toHaveText('Reverse stickings R/L');
  await page.keyboard.press('Home');
  await expect(focused(page)).toHaveText('Show or Hide stickings');
  await page.keyboard.press('ArrowUp');
  await expect(focused(page)).toHaveText('Reverse stickings R/L');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => window.myGrooveWriter.myGrooveUtils.getTempo())).toBe(80);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press(' ');
  await expect(page.locator('#sticking0')).toBeVisible();
  await expect(page.locator('#stickingsButton')).toBeFocused();
  // Space picked the item. It did not also start the groove.
  expect(await page.evaluate(() => window.myGrooveWriter.myGrooveUtils.isPlaying())).toBe(false);
});

test('Tab closes a menu', async ({ page }) => {
  await loadGroove(page, GROOVE);
  await tabTo(page, '#stickingsButton');
  await page.keyboard.press('Enter');
  await expect(focused(page)).toHaveAttribute('role', 'menuitem');
  await page.keyboard.press('Tab');
  await expect(page.locator('#stickingsContextMenu')).toBeHidden();
  await expect(page.locator('#stickingsButton')).toHaveAttribute('aria-expanded', 'false');
});

test('a tap on Stickings opens the menu and does not move focus', async ({ page }) => {
  await loadGroove(page, GROOVE);
  await page.click('#stickingsButton');
  await expect(page.locator('#stickingsContextMenu')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('Metronome options and its sub-menu work by keyboard', async ({ page }) => {
  await loadGroove(page, GROOVE);
  const anchor = page.locator('#metronomeOptionsAnchor');
  await expect(anchor).toHaveAttribute('aria-haspopup', 'menu');
  await tabTo(page, '#metronomeOptionsAnchor');
  await page.keyboard.press('Enter');
  await expect(page.locator('#metronomeOptionsContextMenu')).toBeVisible();
  await expect(anchor).toHaveAttribute('aria-expanded', 'true');
  await expect(focused(page)).toHaveText('Solo');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await expect(focused(page)).toHaveText('Offset click');
  await page.keyboard.press('Enter');
  const subMenu = page.locator('#metronomeOptionsOffsetClickContextMenu');
  await expect(subMenu).toBeVisible();
  await expect(page.locator('#metronomeOptionsContextMenu')).toBeHidden();
  await expect(focused(page)).toHaveText('Start on "1"');
  await expect(anchor).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(subMenu).toBeHidden();
  await expect(anchor).toBeFocused();
  await expect(anchor).toHaveAttribute('aria-expanded', 'false');
});

test('Help menu items open by keyboard', async ({ page }) => {
  await loadGroove(page, GROOVE);
  const anchor = page.locator('#helpAnchor');
  await expect(anchor).toHaveAttribute('aria-haspopup', 'menu');
  await tabTo(page, '#helpAnchor');
  await page.keyboard.press('Enter');
  await expect(page.locator('#helpContextMenu')).toBeVisible();
  await expect(focused(page)).toHaveAttribute('role', 'menuitem');
  for (let i = 0; i < 5; i++) {
    if ((await focused(page).textContent()) === 'Help') break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(focused(page)).toHaveText('Help');
  await page.keyboard.press('Enter');
  await page.waitForURL(/gscribe_help\.html/);
});

test('Enter on a cell in advanced edit opens the note menu next to the cell', async ({ page }) => {
  // Review Focus 3. A touch screen shows the Note types switch; this test turns it on directly.
  await loadGroove(page, GROOVE);
  await page.evaluate(() => window.myGrooveWriter.toggleAdvancedEdit());
  const cell = page.locator('#snare5');
  await cell.focus();
  await expect(cell).toHaveAttribute('aria-label', /, off$/);
  await page.keyboard.press('Enter');
  const menu = page.locator('#snareContextMenu');
  await expect(menu).toBeVisible();
  const cellBox = await cell.boundingBox();
  const menuBox = await menu.boundingBox();
  expect(Math.abs(menuBox.y - (cellBox.y + cellBox.height))).toBeLessThanOrEqual(60);
  await expect(focused(page)).toHaveText('Off');
  await page.keyboard.press('ArrowDown');
  await expect(focused(page)).toHaveText('Snare Normal');
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  await expect(page.locator('#snare5')).toHaveAttribute('aria-label', /, on$/);
  expect(await focusedId(page)).toBe('snare5');
});

test('the time signature popup takes focus, Escape cancels and returns it', async ({ page }) => {
  await loadGroove(page, GROOVE);
  const popup = page.locator('#timeSigPopup');
  await expect(popup).toHaveAttribute('role', 'dialog');
  await tabTo(page, '#timeLabel');
  await page.keyboard.press('Enter');
  await expect(popup).toBeVisible();
  await expect(focused(page)).toHaveId('timeSigPopupTimeSigTop');
  await page.selectOption('#timeSigPopupTimeSigTop', '3');
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await expect(page.locator('#timeLabel')).toBeFocused();
  await expect(page.locator('#timeLabel')).toHaveAttribute('aria-label', 'Time signature 4/4');
});

test('the share popup closes with its Close button and returns focus to Share', async ({
  page,
}) => {
  await loadGroove(page, GROOVE);
  const popup = page.locator('#fullURLPopup');
  await expect(popup).toHaveAttribute('role', 'dialog');
  await tabTo(page, '#shareSaveButton');
  await page.keyboard.press('Enter');
  await expect(popup).toBeVisible();
  await expect(focused(page)).toHaveId('fullURLPopupTextField');
  const close = page.getByRole('button', { name: 'Close' });
  await expect(close).toHaveId('fullURLPopupCloseButton');
  await page.keyboard.press('Shift+Tab'); // the Embed Code box
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(popup).toBeHidden();
  await expect(page.locator('#shareSaveButton')).toBeFocused();
});

test('Escape closes the share popup and the auto speed up popup', async ({ page }) => {
  await loadGroove(page, GROOVE);
  await tabTo(page, '#shareSaveButton');
  await page.keyboard.press('Enter');
  await expect(page.locator('#fullURLPopup')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#fullURLPopup')).toBeHidden();
  await expect(page.locator('#shareSaveButton')).toBeFocused();

  const speedUp = page.locator('#metronomeAutoSpeedupConfiguration');
  await expect(speedUp).toHaveAttribute('role', 'dialog');
  await expect(speedUp).toHaveAttribute('aria-label', 'Auto speed up');
  await tabTo(page, '#metronomeOptionsAnchor');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await expect(focused(page)).toHaveText('Auto speed up');
  await page.keyboard.press('Enter');
  await expect(speedUp).toBeVisible();
  await expect(focused(page)).toHaveId('metronomeAutoSpeedUpKeepGoingForever');
  await page.keyboard.press('Escape');
  await expect(speedUp).toBeHidden();
  await expect(page.locator('#metronomeOptionsAnchor')).toBeFocused();
});

test('a tap on the time signature opens the popup and does not move focus', async ({ page }) => {
  await loadGroove(page, GROOVE);
  await page.click('#timeLabel');
  await expect(page.locator('#timeSigPopup')).toBeVisible();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
});

test('a menu item shows a focus ring after a key', async ({ page }) => {
  await loadGroove(page, GROOVE);
  await tabTo(page, '#stickingsButton');
  await page.keyboard.press('Enter');
  await expect(focused(page)).toHaveAttribute('role', 'menuitem');
  const ring = await focused(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(ring.style).not.toBe('none');
  expect(ring.width).toBeGreaterThanOrEqual(2);
});

test('the Download menu opens in view by keyboard, and Escape returns focus to More', async ({
  page,
}) => {
  await loadGroove(page, GROOVE);
  await tabTo(page, '#moreButton');
  await page.keyboard.press('Enter');
  await expect(focused(page)).toHaveId('downloadButton');
  await page.keyboard.press('Enter');
  const menu = page.locator('#downloadContextMenu');
  await expect(focused(page)).toHaveText('Download SVG Images');
  const box = await menu.boundingBox();
  const more = await page.locator('#moreButton').boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(more.y + more.height);
  expect(box.x + box.width).toBeLessThanOrEqual(1024);
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(page.locator('#moreButton')).toBeFocused();
});

test('a tap on Download opens the menu below More, in view', async ({ page }) => {
  await loadGroove(page, GROOVE);
  await page.click('#moreButton');
  await page.click('#downloadButton');
  const box = await page.locator('#downloadContextMenu').boundingBox();
  const more = await page.locator('#moreButton').boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(more.y + more.height);
  expect(box.x + box.width).toBeLessThanOrEqual(1024);
});
