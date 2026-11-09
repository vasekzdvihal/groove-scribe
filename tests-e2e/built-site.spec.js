import { test, expect } from './fixtures.js';
import { loadGroove } from './helpers.js';

// Playwright serves www/, the tree that production deploys. A runtime file that
// scripts/build-www.mjs leaves out shows up here as a failed request.

function collectFailedRequests(page, origin) {
  const failed = [];
  page.on('response', (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) {
      failed.push(`${response.status()} ${response.url()}`);
    }
  });
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(origin)) {
      failed.push(`${request.failure()?.errorText} ${request.url()}`);
    }
  });
  return failed;
}

test('the built editor loads every file it asks for and plays', async ({ page, baseURL }) => {
  const failed = collectFailedRequests(page, baseURL);
  const soundfont = page.waitForResponse(/\/soundfont\/gunshot-(ogg|mp3)\.js$/);

  await loadGroove(page, '/index.html');
  await soundfont;
  expect(failed, failed.join('\n')).toEqual([]);

  await page.click('[id^="midiPlayImage"]');
  await expect
    .poll(() => page.evaluate(() => window.myGrooveWriter.myGrooveUtils.isPlaying()), {
      timeout: 15000,
    })
    .toBe(true);
  await page.evaluate(() => window.myGrooveWriter.myGrooveUtils.stopMIDI_playback());

  expect(failed, failed.join('\n')).toEqual([]);
});
