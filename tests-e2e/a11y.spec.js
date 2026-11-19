import { test, expect } from './fixtures.js';
import { axeScan, seriousOrWorse, contrastRatio } from './a11y-helpers.js';

// Accessibility checks. axe runs on every page, then focused tests cover what axe cannot see.

test.use({ viewport: { width: 1024, height: 768 } });

const GROOVE =
  '?TimeSig=4/4&Div=16&Measures=2&H=|x-x-x-x-x-x-x-x-|xxxxxxxxxxxxxxxx|&S=|----O-------O---|--O---O---O---O-|&K=|o-------o-------|o--o--o--o--o---|&Stickings=|R-L-R-L-R-L-R-L-|RLRLRLRLRLRLRLRL|';
// Every sticking and every articulation of every voice, in one groove.
const EVERYTHING =
  '?TimeSig=4/4&Div=16&Tempo=100&Measures=1&Stickings=|RLBrlbc---------|&H=|bBcmnNorRsxX+-o-|&S=|bBdfgOox--------|&K=|oxX--o--x--X--o-|&T1=|x---o-----------|&T4=|--------ox------|';

const PAGES = [
  ['editor', '/index.html'],
  ['editor with a groove', '/index.html' + GROOVE],
  ['help', '/gscribe_help.html'],
  ['about', '/gscribe_about.html'],
  [
    'embed',
    '/GrooveEmbed.html?TimeSig=4/4&Div=16&H=|x-x-x-x-x-x-x-x-|&S=|----O-------O---|&K=|o-------o-------|',
  ],
];

async function waitForPage(page, url) {
  await page.goto(url);
  if (url.includes('GrooveEmbed')) await page.waitForSelector('.GrooveDisplay svg');
  else if (url.includes('/index.html')) await page.waitForSelector('#svgTarget svg');
}

for (const [name, url] of PAGES) {
  test(`${name} has no serious or critical axe violation`, async ({ page }) => {
    await waitForPage(page, url);
    expect(seriousOrWorse(await axeScan(page))).toEqual([]);
  });
}

test('every page says it is in English', async ({ page }) => {
  for (const [, url] of PAGES) {
    await page.goto(url);
    expect(await page.getAttribute('html', 'lang')).toBe('en');
  }
});

test('the embed has a plain title', async ({ page }) => {
  await waitForPage(page, PAGES[4][1]);
  await expect(page).toHaveTitle('Embedded groove');
});

test('the swing slider and the Play control have names', async ({ page }) => {
  await waitForPage(page, '/index.html');
  await page.click('#swingButton');
  await expect(page.getByRole('slider', { name: 'Swing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('the embed sliders and the Play control have names', async ({ page }) => {
  await waitForPage(page, PAGES[4][1]);
  // The embed hides the sliders until the player opens, so test the markup, not the visibility.
  await expect(page.locator('input[type=range][aria-label="Swing"]')).toHaveCount(1);
  await expect(page.locator('input[type=range][aria-label="Tempo"]')).toHaveCount(1);
  await expect(page.locator('input[aria-label="Beats per minute"]')).toHaveCount(1);
  await expect(page.locator('[id^="midiPlayImage"][aria-label="Play"]')).toHaveCount(1);
});

test('Tab reaches Play, and Enter on it plays', async ({ page }) => {
  await waitForPage(page, '/index.html' + GROOVE);
  const play = page.locator('[id^="midiPlayImage"]');
  await expect(play).toHaveClass(/Stopped/);
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    if (await play.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(play).toBeFocused();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => page.evaluate(() => window.myGrooveWriter.myGrooveUtils.isPlaying()))
    .toBe(true);
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.evaluate(() => window.myGrooveWriter.myGrooveUtils.stopMIDI_playback());
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('a range slider shows a focus ring', async ({ page }) => {
  await waitForPage(page, '/index.html');
  await page.click('#swingButton');
  const slider = page.locator('input[id^="swingInput"]');
  await slider.focus();
  await page.keyboard.press('ArrowRight'); // the keyboard makes the focus visible
  const ring = await slider.evaluate((el) => {
    const style = getComputedStyle(el);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(ring.style).not.toBe('none');
  expect(ring.width).toBeGreaterThanOrEqual(2);
});

test('Play shows a focus ring when Tab reaches it', async ({ page }) => {
  await waitForPage(page, '/index.html' + GROOVE);
  const play = page.locator('[id^="midiPlayImage"]');
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    if (await play.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(play).toBeFocused();
  const ring = await play.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      style: style.outlineStyle,
      width: parseFloat(style.outlineWidth),
      colour: style.outlineColor,
    };
  });
  expect(ring.style).not.toBe('none');
  expect(ring.width).toBeGreaterThanOrEqual(3);
  expect(ring.colour).toBe('rgb(255, 255, 255)');
});

test('Enter on Play in the embed plays', async ({ page }) => {
  await waitForPage(page, PAGES[4][1]);
  const play = page.locator('[id^="midiPlayImage"]');
  await expect(play).toHaveClass(/Stopped/);
  await play.focus();
  await page.keyboard.press('Enter');
  await expect(play).toHaveClass(/Playing/);
  await expect(play).toHaveAttribute('aria-label', 'Pause');
  await page.keyboard.press('Enter');
  await expect(play).not.toHaveClass(/Playing/);
});

test('off notes and note borders have 3:1 contrast on white', async ({ page }) => {
  await waitForPage(page, '/index.html' + GROOVE);
  const colours = await page.evaluate(() => {
    const css = (id, prop) => getComputedStyle(document.getElementById(id))[prop];
    return {
      offCross: css('hh_cross1', 'color'),
      circleBorder: css('snare_circle0', 'borderTopColor'),
      offSticking: css('sticking_left0', 'color'),
    };
  });
  const white = 'rgb(255, 255, 255)';
  expect(contrastRatio(colours.offCross, white)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(colours.circleBorder, white)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(colours.offSticking, white)).toBeGreaterThanOrEqual(3);
});

test('a groove URL with stickings and every articulation is the same after a load', async ({
  page,
}) => {
  await waitForPage(page, '/index.html' + EVERYTHING);
  const urlFromGrid = () =>
    page.evaluate(() => {
      const gw = window.myGrooveWriter;
      return gw.myGrooveUtils.getUrlStringFromGrooveData(gw.grooveDataFromClickableUI());
    });
  const first = await urlFromGrid();
  expect(first).toContain('Stickings=|RLBRLBc');
  await page.evaluate((url) => window.myGrooveWriter.loadNewGroove(url), first);
  expect(await urlFromGrid()).toBe(first);
});
