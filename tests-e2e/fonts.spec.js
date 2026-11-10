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
