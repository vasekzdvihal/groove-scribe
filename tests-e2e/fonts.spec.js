import { test, expect } from './fixtures.js';

// Lato ships with the app. A weak network must not delay start-up, and no page may ask Google for a font.

const GROOVE =
  '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|xxxxxxxxxxxxxxxx|&S=|----O-------O---|&K=|o-------o-------|';
const CZECH = 'ěščřžýáíé';

async function checkLato(page) {
  return page.evaluate(async (czech) => {
    await Promise.all(
      [300, 400, 700].map((w) => document.fonts.load(`${w} 16px Lato`, czech + 'A'))
    );
    const loaded = [...document.fonts].filter(
      (f) => f.family.replace(/"/g, '') === 'Lato' && f.status === 'loaded'
    );
    return {
      check: document.fonts.check('16px Lato'),
      checkCzech: document.fonts.check('16px Lato', czech),
      loadedFaces: loaded.length,
    };
  }, CZECH);
}

for (const [name, url] of [
  ['editor', '/index.html' + GROOVE],
  ['embed', '/GrooveEmbed.html' + GROOVE],
]) {
  test(`${name} uses the bundled Lato and never calls Google Fonts`, async ({ page }) => {
    const requested = [];
    page.on('request', (req) => requested.push(req.url()));
    await page.goto(url);
    await page.waitForSelector('svg');
    const result = await checkLato(page);
    expect(result.check).toBe(true);
    expect(result.checkCzech).toBe(true);
    expect(result.loadedFaces).toBeGreaterThanOrEqual(3);
    expect(requested.filter((u) => /fonts\.(googleapis|gstatic)\.com/.test(u))).toEqual([]);
    expect(requested.some((u) => /\/fonts\/lato-latin-ext-400-normal\.woff2/.test(u))).toBe(true);
  });
}

// The icons use Font Awesome 4.7.0. Only its woff2 and woff files ship, so the browser must load
// the woff2. The embed and the editor load the same copy.
for (const [name, url] of [
  ['editor', '/index.html' + GROOVE],
  ['embed', '/GrooveEmbed.html' + GROOVE],
]) {
  test(`${name} shows the Font Awesome 4.7.0 icons from the woff2 file`, async ({ page }) => {
    const requested = [];
    const failed = [];
    page.on('request', (req) => requested.push(req.url()));
    page.on('requestfailed', (req) => failed.push(req.url()));
    page.on('response', (res) => {
      if (res.status() >= 400) failed.push(res.url());
    });
    await page.goto(url);
    await page.waitForSelector('svg');
    const loaded = await page.evaluate(async () => {
      await document.fonts.load('14px FontAwesome', '');
      return document.fonts.check('14px FontAwesome', '');
    });
    expect(loaded).toBe(true);
    const icons = requested.filter((u) => u.includes('font-awesome'));
    expect(icons.some((u) => u.includes('font-awesome/4.7.0/css/font-awesome.min.css'))).toBe(true);
    expect(
      icons.some((u) => u.includes('font-awesome/4.7.0/fonts/fontawesome-webfont.woff2'))
    ).toBe(true);
    expect(icons.filter((u) => !u.includes('font-awesome/4.7.0/'))).toEqual([]);
    expect(failed.filter((u) => u.includes('font-awesome'))).toEqual([]);
  });
}
