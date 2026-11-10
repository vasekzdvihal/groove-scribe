import { test, expect } from './fixtures.js';

// The editor starts sooner (the sound file is requested once, early) and a resize that
// does not change the width of the music does nothing.

const GROOVE =
  '?TimeSig=4/4&Div=16&Tempo=80&Measures=1' +
  '&H=|xxxxxxxxxxxxxxxx|&S=|----O-------O---|&K=|o-------o-------|';

async function openEditor(page) {
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');
}

// Counts how often the sheet music is replaced, whatever code does it.
async function countRedraws(page) {
  await page.evaluate(() => {
    window.__redraws = 0;
    new MutationObserver(() => window.__redraws++).observe(document.getElementById('svgTarget'), {
      childList: true,
    });
  });
  return () => page.evaluate(() => window.__redraws);
}

const settle = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 300)));

test.describe('resize', () => {
  test.use({ viewport: { width: 1208, height: 800 } });

  test('a height-only resize does not redraw the music', async ({ page }) => {
    await openEditor(page);
    const redraws = await countRedraws(page);
    await page.setViewportSize({ width: 1208, height: 500 });
    await settle(page);
    await page.setViewportSize({ width: 1208, height: 900 });
    await settle(page);
    expect(await redraws()).toBe(0);
  });

  test('a width change redraws the music once, however many resize events come', async ({
    page,
  }) => {
    await openEditor(page);
    const redraws = await countRedraws(page);
    const before = await page.locator('#svgTarget svg').first().getAttribute('width');
    await page.setViewportSize({ width: 900, height: 800 });
    await page.evaluate(() => {
      for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('resize'));
    });
    await settle(page);
    expect(await redraws()).toBe(1);
    expect(await page.locator('#svgTarget svg').first().getAttribute('width')).not.toBe(before);
  });

  test('a resize during playback does not rebuild the MIDI or stop the groove', async ({
    page,
  }) => {
    await openEditor(page);
    const play = page.locator('[id^="midiPlayImage"]');
    await expect(play).toHaveClass(/Stopped/);
    await play.click();
    await expect(play).toHaveClass(/Playing/);
    const loads = await page.evaluate(() => {
      const callbacks = window.myGrooveWriter.myGrooveUtils.midiEventCallbacks;
      window.__midiLoads = 0;
      const original = callbacks.loadMidiDataEvent;
      callbacks.loadMidiDataEvent = function (...args) {
        window.__midiLoads++;
        return original.apply(this, args);
      };
      return window.__midiLoads;
    });
    await page.setViewportSize({ width: 1000, height: 700 });
    await settle(page);
    await expect(play).toHaveClass(/Playing/);
    expect(await page.evaluate(() => window.__midiLoads)).toBe(loads);
    expect(
      await page.evaluate(
        () => window.myGrooveWriter.myGrooveUtils.midiEventCallbacks.noteHasChangedSinceLastDataLoad
      )
    ).toBe(false);
  });
});

test('the sound file is requested once, before the app asks for it', async ({ page }) => {
  const sound = [];
  page.on('request', (request) => {
    if (/\/soundfont\/gunshot-/.test(request.url())) sound.push(request.url());
  });
  await openEditor(page);
  const play = page.locator('[id^="midiPlayImage"]');
  await expect(play).toHaveClass(/Stopped/);
  await play.click();
  await expect(play).toHaveClass(/Playing/);
  expect(sound).toHaveLength(1);
  // Chromium plays Ogg, so that is the file the preload names.
  expect(sound[0]).toMatch(/gunshot-ogg\.js$/);
  // The preload is in the page's head, so the request starts before the module code runs.
  expect(
    await page.locator('head link[rel="preload"][href$="soundfont/gunshot-ogg.js"]').count()
  ).toBe(1);
});
