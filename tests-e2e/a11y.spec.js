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
  if (url.includes('GrooveEmbed')) await page.waitForSelector('.svgTarget svg');
  else if (url.includes('/index.html')) await page.waitForSelector('#svgTarget svg');
}

for (const [name, url] of PAGES) {
  test(`${name} has no serious or critical axe violation`, async ({ page }) => {
    await waitForPage(page, url);
    expect(seriousOrWorse(await axeScan(page))).toEqual([]);
  });
}

test('the note grid has no serious or critical axe violation', async ({ page }) => {
  await waitForPage(page, '/index.html' + GROOVE);
  // The groove shows its stickings. Show the toms too, so every lane is scanned.
  await page.click('#showHideTomsButton');
  await expect(page.locator('#tom1-0')).toBeVisible();
  await expect(page.locator('#sticking0')).toBeVisible();
  expect(seriousOrWorse(await axeScan(page, { include: '#measureContainer' }))).toEqual([]);
});

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

// Landmarks and headings. The side panel comes before the tools in the DOM, so the panel is
// before <main> in the tab order too.
const LANDMARK_RULES = [
  'region',
  'landmark-one-main',
  'landmark-unique',
  'landmark-no-duplicate-banner',
  'landmark-banner-is-top-level',
  'landmark-main-is-top-level',
  'landmark-complementary-is-top-level',
  'page-has-heading-one',
];

const landmarkViolations = async (page) =>
  (await axeScan(page)).map((v) => v.id).filter((id) => LANDMARK_RULES.includes(id));

async function openGrooves(page) {
  await page.click('#groovesTab');
  await expect(page.locator('#sidePanel')).toHaveCSS('transform', 'none');
  await expect(page.locator('#groovesPanel .grooveListLI').first()).toBeVisible();
}

for (const [name, url] of [
  ['editor', '/index.html'],
  ['help', '/gscribe_help.html'],
  ['about', '/gscribe_about.html'],
]) {
  test(`${name} passes the landmark and heading rules`, async ({ page }) => {
    await waitForPage(page, url);
    expect(await landmarkViolations(page)).toEqual([]);
    if (name === 'editor') {
      await openGrooves(page);
      expect(await landmarkViolations(page)).toEqual([]);
      // The Swing popover is outside the playback bar, but inside the Playback region.
      await page.click('#sidePanelClose');
      await page.click('#swingButton');
      await expect(page.locator('#swingPopover')).toBeVisible();
      expect(await landmarkViolations(page)).toEqual([]);
    }
  });
}

test('the editor has one h1, and it does not change the layout', async ({ page }) => {
  await waitForPage(page, '/index.html');
  const h1 = page.locator('h1');
  await expect(h1).toHaveCount(1);
  await expect(h1).toHaveText('Groove Scribe');
  const box = await h1.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, position: getComputedStyle(el).position };
  });
  expect(box).toEqual({ width: 1, height: 1, position: 'absolute' });
});

test('the embed content is in a main landmark', async ({ page }) => {
  await waitForPage(page, PAGES[4][1]);
  const ids = (await axeScan(page)).map((v) => v.id);
  expect(ids.filter((id) => ['region', 'landmark-one-main'].includes(id))).toEqual([]);
  await expect(page.locator('main svg').first()).toBeVisible();
});

test.describe('at 1440x900', () => {
  // The page has 22 stops from its start to Play: the top bar, the panel, the tools, the grid.
  const MAX_STOPS = 30;
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the panel comes before the tools in the tab order', async ({ page }) => {
    await waitForPage(page, '/index.html' + GROOVE);
    await openGrooves(page);
    // Tab from the start of the page, and give each stop a kind.
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    const order = [];
    for (let i = 0; i < MAX_STOPS && order.at(-1) !== 'play'; i++) {
      await page.keyboard.press('Tab');
      order.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          if (el.closest('#sidePanel')) return 'panel';
          if (el.id === 'timeLabel') return 'time';
          if (el.getAttribute('role') === 'gridcell') return 'cell';
          if (el.id.startsWith('midiPlayImage')) return 'play';
          return 'other';
        })
      );
    }
    const first = (kind) => order.indexOf(kind);
    expect(first('panel')).toBeGreaterThanOrEqual(0);
    expect(first('panel')).toBeLessThan(first('time'));
    expect(first('time')).toBeLessThan(first('cell'));
    expect(first('cell')).toBeLessThan(first('play'));
  });

  test('the docked panel does not move the layout', async ({ page }) => {
    await waitForPage(page, '/index.html' + GROOVE);
    await openGrooves(page);
    const edges = await page.evaluate(() => ({
      panel: document.getElementById('sidePanel').getBoundingClientRect().right,
      tools: document.getElementById('ToolBar').getBoundingClientRect().left,
      music: document.getElementById('RightHandContent').getBoundingClientRect().left,
      playback: document.getElementById('PlaybackBar').getBoundingClientRect().left,
    }));
    expect(edges).toEqual({ panel: 300, tools: 300, music: 300, playback: 300 });
  });
});

// Review Focus 5: the panel is before <main> in the DOM, but the overlay still paints on top.
test('the overlay panel paints above the bars', async ({ page }) => {
  await waitForPage(page, '/index.html' + GROOVE);
  await openGrooves(page);
  const hits = await page.evaluate(() => {
    const centre = (id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    };
    return {
      panel: centre('sidePanel').closest('#sidePanel') !== null,
      playback: centre('PlaybackBar').id,
      tools: centre('ToolBar').id,
    };
  });
  expect(hits).toEqual({ panel: true, playback: 'sidePanelBackdrop', tools: 'sidePanelBackdrop' });
});

for (const [width, height] of [
  [320, 640],
  [768, 1024],
  [1024, 768],
  [1440, 900],
]) {
  test.describe(`at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test(`no sideways page scroll at ${width} px`, async ({ page }) => {
      await waitForPage(page, '/index.html' + GROOVE);
      const pageWidth = () =>
        page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
          // The app box itself must fit too, also when no part of it makes the page scroll.
          app: document.getElementById('GrooveWriter').getBoundingClientRect().width,
        }));
      for (const open of [false, true]) {
        if (open) await openGrooves(page);
        const size = await pageWidth();
        expect(size.scroll, `panel open: ${open}`).toBeLessThanOrEqual(size.client);
        expect(size.app, `panel open: ${open}`).toBeLessThanOrEqual(size.client);
      }
    });
  });
}

test.describe('at 320x640', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('at 320 px every cell of bar 1 can be reached and seen', async ({ page }) => {
    await waitForPage(page, '/index.html' + GROOVE);
    await page.locator('#hi-hat0').focus();
    await page.keyboard.press('End');
    await expect(page.locator('#hi-hat15')).toBeFocused();
    const seen = await page.evaluate(() => {
      const cell = document.getElementById('hi-hat15').getBoundingClientRect();
      const grid = document.getElementById('musicalInput').getBoundingClientRect();
      const music = document.getElementById('RightHandContent').getBoundingClientRect();
      return {
        inViewport: cell.left >= 0 && cell.right <= innerWidth,
        inGrid: cell.left >= grid.left && cell.right <= grid.right,
        inMusic: cell.top >= music.top && cell.bottom <= music.bottom,
      };
    });
    expect(seen).toEqual({ inViewport: true, inGrid: true, inMusic: true });
    // The grid scrolls in its own area. The page does not.
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });
});

// A bar of 1/32 notes does not fit at tablet widths either. The grid scrolls in its own area,
// and no cell is cut off.
const THIRTY_SECONDS = '?TimeSig=4/4&Div=32&Measures=1&H=|xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx|';
for (const [width, height] of [
  [600, 800],
  [768, 1024],
]) {
  test.describe(`1/32 notes at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test(`the last 1/32 cell is not cut off at ${width} px`, async ({ page }) => {
      await waitForPage(page, '/index.html' + THIRTY_SECONDS);
      const cell = page.locator('#hi-hat31');
      await cell.scrollIntoViewIfNeeded();
      const seen = await page.evaluate(() => {
        const r = document.getElementById('hi-hat31').getBoundingClientRect();
        const clip = document.getElementById('measureContainer').getBoundingClientRect();
        const grid = document.getElementById('musicalInput').getBoundingClientRect();
        return {
          notClipped: r.right <= clip.right && r.left >= clip.left,
          inGrid: r.left >= grid.left && r.right <= grid.right,
          pageScrolls: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });
      expect(seen).toEqual({ notClipped: true, inGrid: true, pageScrolls: false });
    });
  });
}
