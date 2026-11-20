import { test as base, expect } from '@playwright/test';

// Hermetic test fixture: block every request that isn't the local test server
// (or an inline data:/blob: URL). The app may reference external resources, such as a
// hardcoded Google Drive fallback host, which are irrelevant to
// what we're testing and, in a sandboxed/offline environment, hang the page's
// `load` event long enough to time out navigation. Aborting them makes page
// loads fast, deterministic, and independent of network conditions. The app
// degrades gracefully; Lato and the soundfont are
// served locally, so playback still works.
export const test = base.extend({
  page: async ({ page, baseURL }, use, testInfo) => {
    const diagnostics = watchPage(page);
    // The port comes from baseURL in playwright.config.js, so a port change cannot abort every request.
    const { port } = new URL(baseURL);
    const local = [`http://localhost:${port}`, `http://127.0.0.1:${port}`];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (
        local.some((origin) => url === origin || url.startsWith(`${origin}/`)) ||
        url.startsWith('data:') ||
        url.startsWith('blob:')
      ) {
        return route.continue();
      }
      return route.abort();
    });
    // When the element under a still mouse changes (a dialog closes, the grid is drawn again),
    // Chrome sends a mouseenter by itself. On a Mac that event takes the modifier keys from the
    // real keyboard. A Ctrl or Alt held anywhere on the Mac, for example in a terminal, then
    // makes the note under the mouse paint or clear itself (noteOnMouseEnter). No test hovers
    // with a modifier, so the page does not get such an event.
    await page.addInitScript(() => {
      window.addEventListener(
        'mouseenter',
        (event) => {
          if (event.isTrusted && (event.ctrlKey || event.altKey)) event.stopImmediatePropagation();
        },
        true
      );
    });
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) await diagnostics.attach(testInfo);
  },
});

// A failed test gets a report of what the page did: the console, uncaught errors, the requests
// that failed or never finished, and how far the page got. A flaky failure that does not come
// back then still explains itself. Example: the editor did not draw the music on one page
// load in a full run (tests-e2e/editor-toolbars.spec.js), and nothing showed why.
function watchPage(page) {
  const start = Date.now();
  const at = () => `${String(Date.now() - start).padStart(6)} ms`;
  const lines = [];
  const pending = new Map();
  page.on('console', (message) =>
    lines.push(`${at()} console.${message.type()}: ${message.text()}`)
  );
  page.on('pageerror', (error) => lines.push(`${at()} pageerror: ${error.stack || error.message}`));
  page.on('crash', () => lines.push(`${at()} the page crashed`));
  page.on('load', () => lines.push(`${at()} load event`));
  page.on('domcontentloaded', () => lines.push(`${at()} DOMContentLoaded`));
  page.on('request', (request) => pending.set(request, Date.now() - start));
  page.on('requestfinished', (request) => pending.delete(request));
  page.on('requestfailed', (request) => {
    pending.delete(request);
    lines.push(`${at()} request failed: ${request.url()} (${request.failure()?.errorText})`);
  });
  return {
    async attach(testInfo) {
      for (const [request, since] of pending) {
        lines.push(`unfinished request since ${since} ms: ${request.method()} ${request.url()}`);
      }
      // The page can hang. Ask for its state with a short time limit.
      const state = await Promise.race([
        page
          .evaluate(() => ({
            url: location.href,
            readyState: document.readyState,
            editor: typeof window.myGrooveWriter,
            svgTarget: document.getElementById('svgTarget')?.innerHTML.slice(0, 200) ?? null,
            unloadedFonts: [...document.fonts]
              .filter((font) => font.status !== 'loaded')
              .map((font) => `${font.family} ${font.weight} ${font.status}`),
          }))
          .catch((error) => `evaluate failed: ${error.message}`),
        new Promise((resolve) => setTimeout(() => resolve('the page did not answer in 2 s'), 2000)),
      ]);
      lines.push(`page state: ${JSON.stringify(state, null, 2)}`);
      await testInfo.attach('page diagnostics', {
        body: lines.join('\n'),
        contentType: 'text/plain',
      });
    },
  };
}

export { expect };
