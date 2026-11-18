import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures.js';

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

// Runs axe with the WCAG A and AA rules and the best-practice rules. Returns the violations.
// The sheet music SVG is not scanned: abc2svg draws it, and the golden master pins its output.
export async function axeScan(page, { include, disableRules = [] } = {}) {
  let builder = new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .exclude('#svgTarget svg')
    .disableRules(disableRules);
  if (include) builder = builder.include(include);
  return (await builder.analyze()).violations;
}

// "<rule id>: <first target>" for each violation that is serious or critical.
export function seriousOrWorse(violations) {
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes[0].target.join(' ')}`);
}

function luminance(rgb) {
  const [r, g, b] = rgb
    .match(/[\d.]+/g)
    .slice(0, 3)
    .map(Number)
    .map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// The WCAG contrast ratio of two 'rgb(r, g, b)' strings.
export function contrastRatio(rgbA, rgbB) {
  const [a, b] = [luminance(rgbA), luminance(rgbB)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

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
