import { test, expect } from './fixtures.js';

// Verifies the embed pages (which load groove_display.js as an ES module and
// self-inject the MIDI/abc2svg libraries) actually render in a browser. These
// pages have no unit coverage, so this guards the increment-2 conversion.

const GROOVE =
  '?TimeSig=4/4&Div=16&Tempo=80&Measures=1' +
  '&H=|xxxxxxxxxxxxxxxx|&S=|----O-------O---|&K=|o-------o-------|';

function collectErrors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|net::ERR_/.test(t)) return; // blocked externals (fonts)
    errors.push(t);
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return errors;
}

test('GrooveEmbed.html renders a groove from the URL without errors', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/GrooveEmbed.html' + GROOVE);
  // AddGrooveDisplayToPage builds an SVG once the injected libraries load.
  await page.waitForSelector('svg', { timeout: 15000 });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('GrooveMultiDisplay.html renders multiple grooves', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/html_examples_and_tests/GrooveMultiDisplay.html');
  await page.waitForSelector('svg', { timeout: 15000 });
  // It embeds many grooves; expect more than one rendered.
  const count = await page.locator('svg').count();
  expect(count).toBeGreaterThan(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('grooveDBTest.html renders (GrooveDBFormatPutGrooveOnPage path)', async ({ page }) => {
  // Exercises GrooveDBFormatPutGrooveOnPage, which now uses DOM insertion instead
  // of document.write so it works under deferred ES-module loading.
  const errors = collectErrors(page);
  await page.goto('/html_examples_and_tests/grooveDBTest.html');
  await page.waitForSelector('svg', { timeout: 15000 });
  expect(await page.locator('svg').count()).toBeGreaterThan(1);
  expect(errors, errors.join('\n')).toEqual([]);
});

// A line break in Title, Author or Comments must not become an ABC directive.
// abc2svg runs %%beginjs with eval and copies %%beginsvg <style> to the page.
const JS_PAYLOAD = 'x\n%%beginjs\nwindow.__xss=5\n%%endjs\n';
const SVG_PAYLOAD =
  'x\n%%beginsvg\n<style type="text/css">\n<img src=x onerror="window.__xss=6"></style>\n%%endsvg\n';

for (const name of ['Title', 'title', 'Author', 'author', 'Comments', 'comments']) {
  for (const [kind, payload] of [
    ['beginjs', JS_PAYLOAD],
    ['beginsvg', SVG_PAYLOAD],
  ]) {
    test(`crafted text does not run: ${kind} in ${name}`, async ({ page }) => {
      await page.goto(
        '/GrooveEmbed.html' + GROOVE + '&' + name + '=' + encodeURIComponent(payload)
      );
      await page.waitForSelector('svg', { timeout: 15000 });
      await page.waitForTimeout(500);
      expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    });
  }
}

test('crafted text does not run: directive in the H lane', async ({ page }) => {
  await page.goto(
    '/GrooveEmbed.html?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=' +
      encodeURIComponent('|x\n%%beginjs\nwindow.__xss=7\n%%endjs\nxxxxxxxxxxxxxx|') +
      '&S=|----O-------O---|&K=|o-------o-------|'
  );
  await page.waitForSelector('svg', { timeout: 15000 });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

// The sanitizer stops these lines first. Feed raw directives to abc2svg itself,
// so the vendored edits (no eval, no <style> copy, no raw ml) stay covered.
test('abc2svg ignores %%beginjs, %%beginml and the %%beginsvg style copy', async ({ page }) => {
  await page.goto('/GrooveEmbed.html' + GROOVE);
  await page.waitForSelector('svg', { timeout: 15000 });
  const result = await page.evaluate(() => {
    let out = '';
    const abc = new window.Abc({
      img_out: (str) => {
        out += str;
      },
      errmsg: () => {},
      read_file: () => '',
      anno_start: () => {},
      anno_stop: () => {},
      get_abcmodel: () => {},
    });
    abc.tosvg(
      'SOURCE',
      '%abc\nX:1\nT:t\n' +
        '%%beginjs\nwindow.__xss=5\n%%endjs\n' +
        '%%beginsvg\n<style type="text/css">\n<img src=x onerror="window.__xss=6"></style>\n%%endsvg\n' +
        '%%beginml\n<img src=x onerror="window.__xss=7">\n%%endml\n' +
        'K:C\nCDEF|\n'
    );
    return { xss: window.__xss, out };
  });
  expect(result.xss).toBeUndefined();
  expect(result.out).not.toContain('onerror');
  expect(result.out).toContain('<svg');
});
