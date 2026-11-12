import { spawn } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeServiceWorker } from '../scripts/build-www.mjs';
import { test as base, expect } from './fixtures.js';
import { grooveData } from './helpers.js';

// Each test gets its own copy of www/ on its own port. It can then stop the server, or
// rebuild the site, without touching the server that the other spec files share.

const GROOVE =
  'TimeSig=4/4&Div=16&Tempo=80&Measures=1' +
  '&H=|xxxxxxxxxxxxxxxx|&S=|----O-------O---|&K=|o-------o-------|';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitUntilServing(origin) {
  await expect
    .poll(
      () =>
        fetch(`${origin}/index.html`).then(
          (r) => r.ok,
          () => false
        ),
      { timeout: 10_000 }
    )
    .toBe(true);
}

const test = base.extend({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured first argument.
  site: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'groove-offline-'));
    cpSync('www', dir, { recursive: true });
    const port = await freePort();
    const server = spawn('python3', ['scripts/test-server.py', String(port), dir], {
      stdio: 'ignore',
    });
    const origin = `http://localhost:${port}`;
    await waitUntilServing(origin);
    const exited = new Promise((resolve) => server.once('exit', resolve));
    const stop = () => {
      server.kill();
      return exited;
    };
    await use({ dir, origin, stop });
    await stop();
    rmSync(dir, { recursive: true, force: true });
  },
  baseURL: async ({ site }, use) => {
    await use(site.origin);
  },
});

/** Waits until the worker has precached everything and controls this page. */
async function waitForWorker(page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** Stops the server and proves it is gone, so nothing after this comes from the network. */
async function goOffline(context, site) {
  await site.stop();
  await expect(fetch(site.origin)).rejects.toThrow();
  await context.setOffline(true);
}

const cacheNames = (page) => page.evaluate(() => caches.keys());

async function expectPlayWorks(page) {
  const play = page.locator('[id^="midiPlayImage"]');
  await expect(play).toHaveClass(/Stopped/);
  await play.click();
  await expect(play).toHaveClass(/Playing/);
  await play.click();
  await expect(play).toHaveClass(/Stopped/);
}

test('an offline reload shows the editor and Play works', async ({ page, context, site }) => {
  test.setTimeout(60_000);
  await page.goto(`/index.html?sw=1&${GROOVE}`);
  await page.waitForSelector('#svgTarget svg');
  await waitForWorker(page);

  await goOffline(context, site);

  const failed = [];
  page.on('requestfailed', (request) => {
    if (request.url().startsWith(site.origin)) failed.push(request.url());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
  });

  await page.reload();
  await page.waitForSelector('#svgTarget svg');
  await expect(page.locator('#logoTextUpperLeft img')).toBeVisible();
  await expect.poll(() => grooveData(page).then((groove) => groove.snareOn)).toBe(2);
  await expectPlayWorks(page);
  expect(failed, failed.join('\n')).toEqual([]);

  // A groove link that was never opened on this device.
  await page.goto(
    '/index.html?TimeSig=4/4&Div=8&Tempo=95&Measures=2&H=|xxxxxxxx|&S=|--O---O-|&K=|o---o---|'
  );
  await page.waitForSelector('#svgTarget svg');
  expect(await grooveData(page)).toMatchObject({ tempo: 95, numberOfMeasures: 2 });

  await page.goto('/');
  await page.waitForSelector('#svgTarget svg');
  await expectPlayWorks(page);
  expect(failed, failed.join('\n')).toEqual([]);
});

test('the help page loads offline', async ({ page, context, site }) => {
  await page.goto('/index.html?sw=1');
  await page.waitForSelector('#svgTarget svg');
  await waitForWorker(page);
  await goOffline(context, site);

  const failed = [];
  page.on('requestfailed', (request) => failed.push(request.url()));
  const response = await page.goto('/gscribe_help.html');
  expect(response?.ok()).toBe(true);
  await expect(page.locator('h1')).toContainText('Help');
  expect(failed, failed.join('\n')).toEqual([]);
});

test('after a rebuild the new version takes over and the old cache is gone', async ({
  page,
  context,
  site,
}) => {
  test.setTimeout(60_000);
  const play = page.locator('[id^="midiPlayImage"]');
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });

  await page.goto('/index.html?sw=1');
  await page.waitForSelector('#svgTarget svg');
  await waitForWorker(page);
  await expect(play).toHaveClass(/Stopped/);
  // A clean load counts more than one: the editor also rewrites its URL.
  const navigationsPerLoad = navigations;
  const before = await cacheNames(page);
  expect(before).toHaveLength(1);

  appendFileSync(join(site.dir, 'js/wakeLock.js'), "\nwindow.__swBuild = 'second';\n");
  writeServiceWorker(site.dir);

  // This load finds the new worker. The update runs behind a page the user may be playing
  // on, so the page must not reload.
  navigations = 0;
  await page.goto('/index.html?sw=1');
  await page.waitForSelector('#svgTarget svg');
  await expect
    .poll(
      async () => {
        const names = await cacheNames(page);
        return names.length === 1 && names[0] !== before[0];
      },
      { timeout: 30_000 }
    )
    .toBe(true);
  await expect(play).toHaveClass(/Stopped/);
  // Time for a reload that the takeover might start. The old cache is deleted just before it.
  await page.waitForTimeout(500);
  expect(navigations).toBe(navigationsPerLoad);

  // Offline, so the changed module can only come from the new cache.
  await goOffline(context, site);
  await page.reload();
  await page.waitForSelector('#svgTarget svg');
  expect(await page.evaluate(() => window.__swBuild)).toBe('second');
  expect(await cacheNames(page)).toHaveLength(1);
});
