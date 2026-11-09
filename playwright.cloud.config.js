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
    command: 'node scripts/build-www.mjs && python3 scripts/test-server.py 8001 www',
    url: 'http://localhost:8001/index.html',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
