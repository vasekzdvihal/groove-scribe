import { test, expect } from './fixtures.js';

// The sound file is the only thing Play needs from the network. On a weak connection one
// failed download must not break Play until the page reloads.

const GROOVE =
  '?TimeSig=4/4&Div=16&Tempo=80&Measures=1' +
  '&H=|xxxxxxxxxxxxxxxx|&S=|----O-------O---|&K=|o-------o-------|';
const SOUND_FILE = '**/soundfont/gunshot-*.js';
const FAILED = 'Sound failed. Tap to retry.';

test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });

// Test-only hook in groove_utils.js: the real waits are 1, 3 and 9 s.
async function shortenWaits(page, timeoutMs = 20000) {
  await page.addInitScript((timeout) => {
    window.__groovescribeSoundLoad = { delays: [50, 50, 50], timeoutMs: timeout };
  }, timeoutMs);
}

// Aborts the first `failures` requests for the sound file and returns the request counter.
async function failSoundFile(page, failures) {
  const counter = { requests: 0 };
  await page.route(SOUND_FILE, (route) => {
    counter.requests++;
    return counter.requests <= failures ? route.abort() : route.continue();
  });
  return counter;
}

async function playWorks(page) {
  const play = page.locator('[id^="midiPlayImage"]');
  await expect(play).toHaveClass(/Stopped/);
  await play.tap();
  await expect(play).toHaveClass(/Playing/);
}

const PAGES = [
  ['editor', '/index.html', '#svgTarget svg'],
  ['embed', '/GrooveEmbed.html', 'svg'],
];

for (const [name, path, ready] of PAGES) {
  test.describe(`sound file on the ${name} page`, () => {
    test('one failed request is retried by itself and Play works', async ({ page }) => {
      await shortenWaits(page);
      const counter = await failSoundFile(page, 1);
      await page.goto(path + GROOVE);
      await page.waitForSelector(ready);
      await playWorks(page);
      expect(counter.requests).toBe(2);
      await expect(page.getByRole('button', { name: FAILED })).toHaveCount(0);
    });

    test('three failed retries show the message, a tap loads the sound', async ({ page }) => {
      await shortenWaits(page);
      const counter = await failSoundFile(page, 4);
      await page.goto(path + GROOVE);
      await page.waitForSelector(ready);
      const retry = page.getByRole('button', { name: FAILED });
      await expect(retry).toBeVisible();
      expect(counter.requests).toBe(4); // the first try and three retries
      // Play shows it is not ready yet.
      await expect(page.locator('[id^="midiPlayImage"]')).not.toHaveClass(/Stopped/);

      await retry.tap(); // the network is back: later requests pass
      await expect(retry).toHaveCount(0);
      await playWorks(page);
      expect(counter.requests).toBe(5);
    });

    test('the keyboard retries, and Play retries too', async ({ page }) => {
      await shortenWaits(page);
      const counter = await failSoundFile(page, 8);
      await page.goto(path + GROOVE);
      await page.waitForSelector(ready);
      const retry = page.getByRole('button', { name: FAILED });
      await expect(retry).toBeVisible();

      await retry.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => counter.requests).toBe(8); // Enter started four more tries
      await expect(retry).toBeVisible(); // and they failed too

      await page.locator('[id^="midiPlayImage"]').tap(); // Play starts a new try
      await expect(retry).toHaveCount(0);
      await playWorks(page);
    });

    test('a request that stalls is given up on and retried', async ({ page }) => {
      await shortenWaits(page, 400);
      let requests = 0;
      await page.route(SOUND_FILE, (route) => {
        requests++;
        if (requests === 1) return; // never answered
        return route.continue();
      });
      await page.goto(path + GROOVE);
      await page.waitForSelector(ready);
      await playWorks(page);
      expect(requests).toBe(2);
    });
  });
}
