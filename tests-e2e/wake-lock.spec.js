import { test, expect } from './fixtures.js';

// The screen must stay on while a groove plays and between exercises. Chromium on
// desktop has no stub-free way to observe a screen lock, so the page gets a fake
// navigator.wakeLock and the test reads what the editor asked for.

const GROOVE =
  '?TimeSig=4/4&Div=16&Tempo=80&Measures=1' +
  '&H=|xxxxxxxxxxxxxxxx|&S=|----O-------O---|&K=|o-------o-------|';

test('Play asks for a screen lock, Stop leaves a 10 minute release timer', async ({ page }) => {
  await page.addInitScript(() => {
    const log = { requests: [], releases: 0, timers: [] };
    window.__wake = log;
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: async (type) => {
          log.requests.push(type);
          return {
            addEventListener() {},
            release: async () => {
              log.releases++;
            },
          };
        },
      },
    });
    const realSet = window.setTimeout.bind(window);
    window.setTimeout = (fn, ms, ...rest) => {
      if (ms === 600000) {
        log.timers.push(ms);
        return realSet(() => {}, 0); // never fires a real release; the test only checks it is set
      }
      return realSet(fn, ms, ...rest);
    };
  });
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');
  const play = page.locator('[id^="midiPlayImage"]');
  await expect(play).toHaveClass(/Stopped/);

  await play.click();
  await expect(play).toHaveClass(/Playing/);
  await expect.poll(() => page.evaluate(() => window.__wake.requests)).toEqual(['screen']);
  expect(await page.evaluate(() => window.__wake.timers.length)).toBe(0);

  await play.click(); // the same control stops playback
  await expect(play).toHaveClass(/Stopped/);
  await expect.poll(() => page.evaluate(() => window.__wake.timers)).toEqual([600000]);
  expect(await page.evaluate(() => window.__wake.releases)).toBe(0);
});
