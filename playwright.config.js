import { defineConfig, devices } from '@playwright/test';

// End-to-end / browser tests for Groove Scribe. These run the REAL app in
// Chromium (rendered abc2svg sheet music, real MIDI generation, real DOM/CSS) —
// the layer the jsdom unit suite cannot cover. They double as a pre-refactor
// golden-master: capture the rendered SVG + generated MIDI for a corpus of
// grooves now, and diff after refactoring.
//
// The suite is tuned to finish well under 5 minutes: Chromium only, fully
// parallel, one auto-started static server shared by all workers.
export default defineConfig({
  testDir: './tests-e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Cap workers: the test server + Chromium instances are CPU-bound, and
  // a modest count keeps page loads fast and the suite well under its time budget.
  workers: 4,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:8010',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Serve the built site that production deploys. Two embed tests use test-only pages in
    // html_examples_and_tests, which never ship, so the server overlays that one folder.
    // Those pages still load the shipped js/ from www/ through ../js/.
    command:
      'node scripts/build-www.mjs && python3 scripts/test-server.py 8010 www html_examples_and_tests',
    url: 'http://localhost:8010/index.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
