import { defineConfig, devices } from '@playwright/test';

// Library tests against the Firebase emulators: run `npm run test:cloud`.
export default defineConfig({
  testDir: './tests-cloud',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 45_000,
  use: {
    baseURL: 'http://localhost:8001',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `python3 -m http.server` listens with a backlog of 5. The editor loads about 50 files
    // at once, so Chromium sometimes got a reset and the page never started. A longer
    // backlog stops that.
    command:
      'python3 -c "from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler; ThreadingHTTPServer.request_queue_size = 128; ThreadingHTTPServer((\'127.0.0.1\', 8001), SimpleHTTPRequestHandler).serve_forever()"',
    url: 'http://localhost:8001/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
