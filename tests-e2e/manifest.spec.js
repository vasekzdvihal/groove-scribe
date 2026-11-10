import { test, expect } from './fixtures.js';

// The home-screen install needs a manifest the page links, icons that load, and a start URL
// inside the scope. Safari on iPad ignores the manifest icons and reads the apple-touch-icon.

test('the editor links a manifest that installs it as a standalone app', async ({
  page,
  request,
  baseURL,
}) => {
  await page.goto('/index.html');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('manifest.webmanifest');

  const manifestUrl = new URL(href, `${baseURL}/index.html`).href;
  const response = await request.get(manifestUrl);
  expect(response.ok()).toBe(true);
  const manifest = await response.json();

  expect(manifest.display).toBe('standalone');
  expect(manifest.name).toBe('GrooveScribe');
  expect(new URL(manifest.start_url, manifestUrl).pathname).toBe('/index.html');
  expect(new URL(manifest.scope, manifestUrl).pathname).toBe('/');
  expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);

  const sizes = manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose ?? 'any'}`);
  expect(sizes).toEqual(expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']));
  for (const icon of manifest.icons) {
    const iconResponse = await request.get(new URL(icon.src, manifestUrl).href);
    expect(iconResponse.ok(), icon.src).toBe(true);
    expect(iconResponse.headers()['content-type'], icon.src).toBe('image/png');
  }
});

test('the editor has the iPad home-screen tags and no stale cache manifest', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute(
    'content',
    'yes'
  );
  await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);
  expect(await page.locator('html').getAttribute('unused_manifest')).toBeNull();
});
