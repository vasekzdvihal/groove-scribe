import { test, expect } from './fixtures.js';
import { loadGroove } from './helpers.js';

// The Help and About pages are plain documents. They must be real HTML pages that fit a phone,
// and the editor must link to Help in plain sight.

const PAGES = ['gscribe_help.html', 'gscribe_about.html'];
const WIDTHS = [390, 1024];
const SIZES = [
  [1024, 768],
  [768, 1024],
  [390, 844],
];

for (const path of PAGES) {
  test(`${path} is a complete HTML document`, async ({ page, request, baseURL }) => {
    const source = await (await request.get(`${baseURL}/${path}`)).text();
    expect(source.trimStart().toLowerCase().startsWith('<!doctype html>')).toBe(true);

    await page.goto(`/${path}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('head meta[charset]')).toHaveAttribute('charset', /utf-8/i);
    await expect(page.locator('head meta[name="viewport"]')).toHaveCount(1);
    expect((await page.title()).trim()).not.toBe('');
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('link[href="css/pages.css"]')).toHaveCount(1);
    await expect(page.locator('a[href="index.html"]').first()).toBeVisible();
  });

  for (const width of WIDTHS) {
    test(`${path} has no horizontal scroll at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/${path}`);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.scrollingElement.scrollWidth,
        clientWidth: document.scrollingElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  }
}

test('the pages use the editor font and the editor top bar colour', async ({ page }) => {
  await loadGroove(page, '/index.html');
  const editorColor = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--header-bg-color')
      .trim();
    document.body.append(probe);
    return getComputedStyle(probe).backgroundColor;
  });
  expect(editorColor).not.toBe('rgba(0, 0, 0, 0)');
  await page.goto('/gscribe_help.html');
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Lato');
  expect(
    await page.evaluate(() => getComputedStyle(document.querySelector('.page-bar')).backgroundColor)
  ).toBe(editorColor);
});

test('the footer links are 44 px tall', async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(`/${path}`);
    const box = await page.locator('.page-links a').first().boundingBox();
    expect(box.height, path).toBeGreaterThanOrEqual(44);
  }
});

test('the editor keeps a readable title at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadGroove(page, '/index.html');
  const title = await page.locator('#grooveTitleDisplay').boundingBox();
  expect(title.width).toBeGreaterThanOrEqual(80);
  const account = await page.locator('#helpAnchor').boundingBox();
  expect(account.width).toBeGreaterThanOrEqual(44);
  expect(account.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('#helpAnchor')).toHaveAttribute('aria-label', 'Sign in and help');
});

test('the account button has its own label before the script runs', async ({
  request,
  baseURL,
}) => {
  const source = await (await request.get(`${baseURL}/index.html`)).text();
  expect(source).toMatch(/id="helpAnchor"[^>]*aria-label="Help menu"/);
});

for (const [width, height] of SIZES) {
  test(`the Help link in the editor is visible and uncovered at ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await loadGroove(page, '/index.html');
    const link = page.locator('#helpLink');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'gscribe_help.html');
    const box = await link.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    const onTop = await page.evaluate(
      ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('#helpLink')),
      { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    );
    expect(onTop).toBe(true);
    const signIn = await page.locator('#helpAnchor').boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(signIn.x);
  });
}

test('the built site serves both pages and their stylesheet', async ({ request, baseURL }) => {
  for (const path of [...PAGES, 'css/pages.css']) {
    const response = await request.get(`${baseURL}/${path}`);
    expect(response.ok(), path).toBe(true);
  }
});
