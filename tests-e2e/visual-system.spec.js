import { test, expect } from './fixtures.js';
import { contrastRatio } from './a11y-helpers.js';

// The editor has one set of colours (css/tokens.css). The primary buttons of the toolbars, the
// side panel and the confirm dialog share one accent.

test.use({ viewport: { width: 1024, height: 768 } });

const GROOVE =
  '?TimeSig=4/4&Div=16&Measures=1&H=|xxxxxxxxxxxxxxxx|&S=|----O-------O---|&K=|o-------o-------|';
const ACCENT = 'rgb(31, 115, 168)';
const WHITE = 'rgb(255, 255, 255)';

const look = (locator) =>
  locator.evaluate((node) => {
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, color: style.color };
  });

test('primary buttons share one accent (the library button: CSS only)', async ({ page }) => {
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');

  // A toolbar tool that is on: the open side panel tab.
  const tab = page.locator('#upperLeft .panel-tab', { hasText: 'Grooves' });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(0, 0);
  expect((await look(tab)).background).toBe(ACCENT);

  // The library CSS for its primary button. The hermetic test server blocks Firebase, so the
  // Library tab does not start here. A stand-in button in a library section checks the CSS only.
  // tests-cloud/library.spec.js checks the real Sign in with Google button.
  await page.evaluate(() => {
    const section = document.createElement('section');
    section.id = 'libraryPanel';
    section.innerHTML =
      '<button id="lpSignIn" class="btn btn-primary" type="button">Sign in with Google</button>';
    document.getElementById('sidePanel').append(section);
  });
  const signIn = page.getByRole('button', { name: 'Sign in with Google' });
  expect(await look(signIn)).toEqual({ background: ACCENT, color: WHITE });

  // The primary button of the confirm dialog.
  await page.keyboard.press('Escape');
  await page.click('#moreButton');
  await page.click('#clearAllNotesButton');
  const dialog = page.getByRole('dialog', { name: 'Clear all notes?' });
  await expect(dialog).toBeVisible();
  const keep = dialog.getByRole('button', { name: 'Keep the notes' });
  expect(await look(keep)).toEqual({ background: ACCENT, color: WHITE });
});

// Every button has one shape (D2): 6 px corners and a 44 px touch target. Round controls (the
// tempo knob, an avatar) stay round, and the note grid keeps its own cells.
async function buttonsOffShape(page, rootSelector) {
  return page.locator(rootSelector).evaluateAll((roots) => {
    const offenders = [];
    for (const root of roots) {
      for (const node of root.querySelectorAll('button, [role="button"], share-button')) {
        const style = getComputedStyle(node);
        const box = node.getBoundingClientRect();
        if (!node.getClientRects().length || style.visibility === 'hidden') continue;
        if (style.borderRadius === '50%' || node.closest('.tempoKnob, [role="gridcell"]')) continue;
        // Add a bar and Remove have no fill. Their corners stay square, so the whole 44 px box
        // takes a tap. Only their focus ring is round.
        if (node.matches('.closeMeasureButton, #addMeasureButton')) continue;
        if (style.borderRadius !== '6px' || box.height < 44) {
          const name = node.id || node.getAttribute('aria-label') || node.textContent.trim();
          offenders.push(`${name}: ${style.borderRadius}, ${Math.round(box.height)} px`);
        }
      }
    }
    return offenders;
  });
}

for (const [width, height] of [
  [1024, 768],
  [768, 1024],
]) {
  test.describe(`at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('every button has one shape', async ({ page }) => {
      await page.goto('/index.html' + GROOVE);
      await page.waitForSelector('#svgTarget svg');
      const radius = (selector) =>
        page.locator(selector).evaluate((node) => getComputedStyle(node).borderRadius);

      // The toolbars. The Help link and the Sign in control are buttons too.
      expect.soft(await buttonsOffShape(page, '#TopNav, #ToolBar, #PlaybackBar')).toEqual([]);

      // The bar buttons above and beside the grid: the bar ruler, Add a bar and Remove. The note
      // cells keep their own shape.
      await page.click('#addMeasureButton');
      await expect(page.locator('.closeMeasureButton[id]').first()).toBeVisible();
      expect.soft(await buttonsOffShape(page, '#musicalInput')).toEqual([]);
      expect.soft(await radius('#helpLink')).toBe('6px');
      expect.soft(await radius('#helpAnchor')).toBe('6px');

      // The side panel: Library, then Grooves. On the hermetic e2e server the Library tab shows
      // only the signed-out text and Sign in, so this pass checks little there.
      // tests-cloud/library.spec.js "every library button has one shape" checks the real panel.
      for (const name of ['Library', 'Grooves']) {
        await page.locator('#upperLeft .panel-tab', { hasText: name }).click();
        await expect(page.locator('#sidePanel')).toBeVisible();
        expect.soft(await buttonsOffShape(page, '#sidePanel'), name).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(page.locator('#sidePanel')).toBeHidden();
      }

      // A .btn with the hidden attribute stays hidden, such as Retry in the library.
      const shownHidden = await page
        .locator('.btn[hidden]')
        .evaluateAll((nodes) => [
          nodes.length,
          nodes.filter((node) => getComputedStyle(node).display !== 'none').map((node) => node.id),
        ]);
      expect(shownHidden[0]).toBeGreaterThan(0);
      expect(shownHidden[1]).toEqual([]);

      // The confirm dialog.
      await page.click('#moreButton');
      await page.click('#clearAllNotesButton');
      const dialog = page.getByRole('dialog', { name: 'Clear all notes?' });
      await expect(dialog).toBeVisible();
      expect.soft(await buttonsOffShape(page, '.confirm-dialog[open]')).toEqual([]);
      await dialog.getByRole('button', { name: 'Keep the notes' }).click();
      await expect(dialog).toBeHidden();

      // The share popup.
      await page.click('#shareSaveButton');
      await expect(page.locator('#fullURLPopup')).toBeVisible();
      // SHARE shows when its library has loaded.
      await expect(page.locator('#shareButton')).toBeVisible();
      expect.soft(await buttonsOffShape(page, '#fullURLPopup')).toEqual([]);
      await page.click('#fullURLPopupCloseButton');
      await expect(page.locator('#fullURLPopup')).toBeHidden();

      // The time signature popup.
      await page.click('#timeLabel');
      await expect(page.locator('#timeSigPopup')).toBeVisible();
      expect.soft(await buttonsOffShape(page, '#timeSigPopup')).toEqual([]);
    });
  });
}

// The popover items have an accent focus ring on white. A selected item is filled with the
// accent, so its ring must change colour to show.
test('a selected popover item shows its focus ring', async ({ page }) => {
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');
  await page.focus('#divisionMenuButton');
  await page.keyboard.press('Enter');
  await expect(page.locator('#divisionPopover')).toBeVisible();
  const selected = page.locator('#subdivision_16ths');
  await expect(selected).toHaveClass(/buttonSelected/);
  await selected.focus();
  const ring = await selected.evaluate((node) => {
    const style = getComputedStyle(node);
    return { outline: style.outlineColor, style: style.outlineStyle, fill: style.backgroundColor };
  });
  expect(ring.style).not.toBe('none');
  expect(contrastRatio(ring.outline, ring.fill)).toBeGreaterThanOrEqual(3);
});

// The note key in Details is a checkbox. The keyboard reaches it, and its focus ring shows on
// the plain label and on the checked (accent) label.
test('the note key shows its focus ring, on and off', async ({ page }) => {
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');
  await page.focus('#detailsButton');
  await page.keyboard.press('Enter');
  await expect(page.locator('#detailsPopover')).toBeVisible();
  const box = page.locator('#showLegend');
  for (let i = 0; i < 10; i++) {
    if (await box.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(box).toBeFocused();
  const ring = () =>
    page.locator('#LegendLabel').evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        outline: style.outlineColor,
        style: style.outlineStyle,
        fill: style.backgroundColor,
      };
    });
  for (const checked of [false, true]) {
    if (checked) await page.keyboard.press('Space');
    await expect(box).toBeChecked({ checked });
    const now = await ring();
    expect(now.style, `checked: ${checked}`).not.toBe('none');
    expect(contrastRatio(now.outline, now.fill), `checked: ${checked}`).toBeGreaterThanOrEqual(3);
  }
});

// The grid text is Lato like the rest of the editor. It does not keep the old Times New Roman.
test('the grid text uses Lato', async ({ page }) => {
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');
  for (const selector of ['.hh-label', '.sticking_count', '.sticking_left', '.notes-container']) {
    const family = await page
      .locator(selector)
      .first()
      .evaluate((node) => getComputedStyle(node).fontFamily);
    expect(family, selector).toMatch(/^"?Lato"?,/);
  }
});

// The share button library (js/share-button.min.js and its stylesheet, about 60 KB) loads when
// the share popup opens for the first time, not with the editor. The popup shows the URL and
// Copy at once. SHARE shows when the library is ready.
const shareButtonFiles = (page) => {
  const files = [];
  page.on('request', (request) => {
    if (request.url().includes('share-button.min')) files.push(new URL(request.url()).pathname);
  });
  return files;
};

test('the share button loads only with the share popup', async ({ page }) => {
  const files = shareButtonFiles(page);
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');
  await page.waitForLoadState('load');
  expect(files).toEqual([]);
  expect(await page.evaluate(() => typeof window.ShareButton)).toBe('undefined');

  const popup = page.locator('#fullURLPopup');
  const share = page.locator('#shareButtonContainer > #shareButton');
  await page.click('#shareSaveButton');
  await expect(popup).toBeVisible();
  await expect(page.locator('#fullURLPopupTextField')).toHaveValue(/TimeSig=4\/4/);
  await expect(share).toBeVisible();
  await expect(share).toContainText('SHARE');
  expect([...files].sort()).toEqual(['/css/share-button.min.css', '/js/share-button.min.js']);

  await page.click('#fullURLPopupCloseButton');
  await expect(popup).toBeHidden();
  await page.click('#shareSaveButton');
  await expect(popup).toBeVisible();
  await expect(share).toBeVisible();
  await expect(share.locator('.sb-social')).toHaveCount(1);
  expect(files).toHaveLength(2);
});

test('the share popup works without SHARE when the share button cannot load', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const files = shareButtonFiles(page);
  let failed = 0;
  page.on('requestfailed', (request) => {
    if (request.url().includes('share-button.min')) failed += 1;
  });
  await page.route('**/share-button.min.*', (route) => route.abort());
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');

  const popup = page.locator('#fullURLPopup');
  const share = page.locator('#shareButton');
  await page.click('#shareSaveButton');
  await expect(popup).toBeVisible();
  await expect(page.locator('#fullURLPopupTextField')).toHaveValue(/TimeSig=4\/4/);
  await expect(page.locator('#fullURLPopupCopyButton')).toBeVisible();
  await expect.poll(() => failed).toBe(2);
  expect(files).toHaveLength(2);
  await expect(share).toBeHidden();
  expect(errors).toEqual([]);

  // The next opening tries again.
  await page.unroute('**/share-button.min.*');
  await page.click('#fullURLPopupCloseButton');
  await page.click('#shareSaveButton');
  await expect(share).toBeVisible();
  expect(errors).toEqual([]);
});

/** Holds js/share-button.min.js until the returned function is called. */
async function holdShareScript(page) {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  await page.route('**/js/share-button.min.js', async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

// SHARE has its place in the popup before its library loads, so COPY does not move.
test('COPY stays in place while the share button loads', async ({ page }) => {
  const release = await holdShareScript(page);
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');

  const copy = page.locator('#fullURLPopupCopyButton');
  const share = page.locator('#shareButton');
  await page.click('#shareSaveButton');
  await expect(copy).toBeVisible();
  await expect(share).toBeHidden();
  const before = await copy.boundingBox();

  release();
  await expect(share).toBeVisible();
  const after = await copy.boundingBox();
  expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(0.5);
});

// The share button is built once per page, also when the popup opens several times before its
// library has loaded. Its flyout then opens with one click.
test('the share button is built once and its flyout opens after reopens', async ({ page }) => {
  await page.addInitScript(() => {
    let Real;
    window.__shareButtonBuilds = 0;
    Object.defineProperty(window, 'ShareButton', {
      configurable: true,
      get: () =>
        Real &&
        function (...args) {
          window.__shareButtonBuilds += 1;
          return new Real(...args);
        },
      set: (value) => {
        Real = value;
      },
    });
  });
  const release = await holdShareScript(page);
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');

  const popup = page.locator('#fullURLPopup');
  const share = page.locator('#shareButton');
  for (let opening = 0; opening < 3; opening++) {
    await page.click('#shareSaveButton');
    await expect(popup).toBeVisible();
    await page.click('#fullURLPopupCloseButton');
    await expect(popup).toBeHidden();
  }
  release();
  await page.click('#shareSaveButton');
  await expect(share).toBeVisible();
  await page.click('#fullURLPopupCloseButton');
  await page.click('#shareSaveButton');
  await expect(share).toBeVisible();

  const networks = share.locator('.sb-social li.enabled');
  await expect(networks.first()).toBeHidden();
  await share.click();
  await expect(networks.first()).toBeVisible();
  expect(await page.evaluate(() => window.__shareButtonBuilds)).toBe(1);
});

// A note symbol is centred in its lane, like the circles of the snare, toms and kick. The hi-hat
// X is a Font Awesome glyph, so its place depends on the line box of its cell, not on the glyph
// alone. The test measures the ink of the glyph: the box of the <i> has empty space above the
// X. The open, close and accent marks sit above the X and do not touch it.
const glyphInk = (icon) => {
  const probe = document.createElement('span');
  probe.style.cssText = 'display: inline-block; width: 0; height: 0';
  icon.append(probe);
  const baseline = probe.getBoundingClientRect().bottom;
  probe.remove();
  // A scaled cell (a note that is off, a narrow 1/32 cell) scales the glyph too.
  const scale = icon.getBoundingClientRect().height / icon.offsetHeight;
  const style = getComputedStyle(icon);
  const context = document.createElement('canvas').getContext('2d');
  context.font = `${style.fontSize} ${style.fontFamily}`;
  const glyph = getComputedStyle(icon, '::before').content.replace(/"/g, '');
  const metrics = context.measureText(glyph);
  return {
    top: baseline - metrics.actualBoundingBoxAscent * scale,
    bottom: baseline + metrics.actualBoundingBoxDescent * scale,
  };
};

const HIHAT_GROOVES = {
  '1/16':
    '?TimeSig=4/4&Div=16&Measures=1&H=|xoX+-xxxxxxxxxxx|&S=|----O-------O---|&K=|o-------o-------|',
  '1/32':
    '?TimeSig=4/4&Div=32&Measures=2&H=|xoX+-xxxxxxxxxxxxxxxxxxxxxxxxxxx|xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx|&S=|--------O---------------O-------|--------O---------------O-------|&K=|o---------------o---------------|o---------------o---------------|',
};

for (const [width, height] of [
  [1024, 768],
  [768, 1024],
  [1440, 900],
]) {
  for (const [division, query] of Object.entries(HIHAT_GROOVES)) {
    test(`the hi-hat X is centred in its lane, ${division} at ${width}x${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/index.html' + query);
      await page.waitForSelector('#svgTarget svg');
      await page.evaluate(() => document.fonts.ready);
      const result = await page.evaluate(
        ({ inkSource }) => {
          const ink = new Function(`return ${inkSource}`)();
          const lane = document.getElementById('hi-hat0').parentElement;
          const box = lane.getBoundingClientRect();
          // The lane above its line: the content box, without the bottom border.
          const laneMiddle = box.top + lane.clientTop + lane.clientHeight / 2;
          const marks = {};
          for (const [cell, mark] of [
            [1, 'hh_open'],
            [2, 'hh_accent'],
            [3, 'hh_close'],
          ]) {
            const x = ink(document.querySelector(`#hh_cross${cell} i`));
            const m = ink(document.querySelector(`#${mark}${cell} i`));
            marks[mark] = { gap: x.top - m.bottom, aboveLane: box.top - m.top };
          }
          const offset = (cell) => {
            const x = ink(document.querySelector(`#hh_cross${cell} i`));
            return (x.top + x.bottom) / 2 - laneMiddle;
          };
          return { on: offset(0), off: offset(4), marks };
        },
        { inkSource: glyphInk.toString() }
      );
      expect(
        Math.abs(result.on),
        `X on, ${result.on.toFixed(1)} px off centre`
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(result.off),
        `X off, ${result.off.toFixed(1)} px off centre`
      ).toBeLessThanOrEqual(1);
      for (const [mark, { gap, aboveLane }] of Object.entries(result.marks)) {
        expect(gap, `${mark} touches the X`).toBeGreaterThanOrEqual(1.5);
        expect(aboveLane, `${mark} goes out of the lane`).toBeLessThanOrEqual(0);
      }
    });
  }
}

// A touch screen has no hover. A tap must not leave a hover fill on a button until the next tap
// elsewhere (iPad Safari keeps :hover on the tapped element). The hover fills are only for a
// mouse: @media (hover: hover). Stand-in buttons with no actions carry the classes.
const HOVER_STAND_INS = `
  <div id="hoverStandIns" style="position: fixed; top: 120px; left: 20px; z-index: 10000;
    display: flex; flex-wrap: wrap; gap: 8px; width: 600px; padding: 8px; background: #222a2f">
    <button type="button" class="btn" id="standInBtn">Neutral</button>
    <button type="button" class="btn btn-primary" id="standInPrimary">Primary</button>
    <button type="button" class="btn btn-danger" id="standInDanger">Danger</button>
    <button type="button" class="tool" id="standInTool"><span class="tool-in">Tool</span></button>
    <button type="button" class="tool tool-filled" id="standInFilled">
      <span class="tool-in">Filled</span></button>
    <button type="button" class="tool tool-primary" id="standInToolPrimary">
      <span class="tool-in">Tool primary</span></button>
    <div class="tool-popover" style="position: static; display: block">
      <button type="button" id="standInPopoverItem">Popover item</button></div>
    <ul class="grooveListUL"><li><button type="button" class="grooveListLI" id="standInGrooveRow">
      Groove row</button></li></ul>
  </div>`;
const STAND_IN_IDS = [
  'standInBtn',
  'standInPrimary',
  'standInDanger',
  'standInTool',
  'standInFilled',
  'standInToolPrimary',
  'standInPopoverItem',
  'standInGrooveRow',
];
const fill = (page, selector) =>
  page.locator(selector).evaluate((node) => getComputedStyle(node).backgroundColor);

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1024, height: 768 } });

  test('a tapped button keeps its rest fill', async ({ page }) => {
    await page.goto('/index.html' + GROOVE);
    await page.waitForSelector('#svgTarget svg');
    expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(false);
    await page.evaluate(
      (html) => document.body.insertAdjacentHTML('beforeend', html),
      HOVER_STAND_INS
    );
    for (const id of STAND_IN_IDS) {
      const rest = await fill(page, `#${id}`);
      await page.tap(`#${id}`);
      // A press shows :active for a moment after the tap. Then the rest fill must come back.
      await expect.soft.poll(() => fill(page, `#${id}`), { message: id, timeout: 2000 }).toBe(rest);
    }
    await page.evaluate(() => document.getElementById('hoverStandIns').remove());

    // COPY in the share popup, a neutral button on white.
    await page.tap('#shareSaveButton');
    await expect(page.locator('#fullURLPopup')).toBeVisible();
    const rest = await fill(page, '#fullURLPopupCopyButton');
    await page.tap('#fullURLPopupCopyButton');
    await expect.soft
      .poll(() => fill(page, '#fullURLPopupCopyButton'), { message: 'COPY', timeout: 2000 })
      .toBe(rest);
  });
});

test('a mouse still shows the hover fill', async ({ page }) => {
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');
  expect(await page.evaluate(() => matchMedia('(hover: hover)').matches)).toBe(true);
  await page.evaluate(
    (html) => document.body.insertAdjacentHTML('beforeend', html),
    HOVER_STAND_INS
  );
  for (const id of STAND_IN_IDS) {
    await page.mouse.move(0, 0);
    const rest = await fill(page, `#${id}`);
    await page.hover(`#${id}`);
    expect.soft(await fill(page, `#${id}`), id).not.toBe(rest);
  }
});

// iPad Safari shows :active on a tap only when the page has a touch listener. The editor
// registers an empty, passive one on the document, so the pressed steps show on the tablet.
test('the editor listens for touches, so pressed buttons show on an iPad', async ({ page }) => {
  await page.addInitScript(() => {
    const add = EventTarget.prototype.addEventListener;
    window.__documentTouchListeners = [];
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (type === 'touchstart' && (this === document || this === document.body)) {
        window.__documentTouchListeners.push(options);
      }
      return add.call(this, type, listener, options);
    };
  });
  await page.goto('/index.html' + GROOVE);
  await page.waitForSelector('#svgTarget svg');
  const listeners = await page.evaluate(() => window.__documentTouchListeners);
  expect(listeners).toContainEqual({ passive: true });
});

// The other glyphs of the grid are centred too: the cross stick X, the buzz bars and the ghost
// note "( · )" in the snare lane, the accent chevron in its circle, and the hi-hat foot splash X
// below the kick circle.
const GLYPH_GROOVE =
  '?TimeSig=4/4&Div=16&Measures=1&H=|x-x-x-x-x-x-x-x-|&S=|gxbO------------|&K=|x-X-------------|';

for (const [width, height] of [
  [1024, 768],
  [768, 1024],
]) {
  test(`the snare and kick glyphs are centred, at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/index.html' + GLYPH_GROOVE);
    await page.waitForSelector('#svgTarget svg');
    await page.evaluate(() => document.fonts.ready);
    const offsets = await page.evaluate(
      ({ inkSource }) => {
        const faInk = new Function(`return ${inkSource}`)();
        // The ink of plain text, such as the brackets of the ghost note.
        const textInk = (node, text) => {
          const probe = document.createElement('span');
          probe.style.cssText = 'display: inline-block; width: 0; height: 0';
          node.append(probe);
          const baseline = probe.getBoundingClientRect().bottom;
          probe.remove();
          const style = getComputedStyle(node);
          const context = document.createElement('canvas').getContext('2d');
          context.font = `${style.fontSize} ${style.fontFamily}`;
          const metrics = context.measureText(text);
          return {
            top: baseline - metrics.actualBoundingBoxAscent,
            bottom: baseline + metrics.actualBoundingBoxDescent,
          };
        };
        const centre = ({ top, bottom }) => (top + bottom) / 2;
        const laneMiddle = (id) => {
          const lane = document.getElementById(id).parentElement;
          const box = lane.getBoundingClientRect();
          return box.top + lane.clientTop + lane.clientHeight / 2;
        };
        const snare = laneMiddle('snare0');
        // The splash X crosses the kick line. It sits in the middle between the bottom of the
        // kick circle and the bottom of the kick lane, so the X and a kick in one cell do not
        // touch.
        const kickCell = document.getElementById('kick0').getBoundingClientRect();
        const kickCircle = document.getElementById('kick_circle2').getBoundingClientRect();
        const belowCircle = (kickCircle.bottom + kickCell.bottom) / 2;
        const circle = document.getElementById('snare_circle3').getBoundingClientRect();
        const icon = (selector) => document.querySelector(`${selector} i`);
        return {
          'ghost dot': centre(faInk(icon('#snare_ghost0'))) - snare,
          'ghost brackets': centre(textInk(document.getElementById('snare_ghost0'), '(')) - snare,
          'cross stick X': centre(faInk(icon('#snare_xstick1'))) - snare,
          'buzz bars': centre(faInk(icon('#snare_buzz2'))) - snare,
          'accent chevron in its circle':
            centre(faInk(icon('#snare_accent3'))) - (circle.top + circle.bottom) / 2,
          'splash X': centre(faInk(icon('#kick_splash0'))) - belowCircle,
          'splash X of a kick and splash': centre(faInk(icon('#kick_splash2'))) - belowCircle,
        };
      },
      { inkSource: glyphInk.toString() }
    );
    for (const [glyph, offset] of Object.entries(offsets)) {
      expect
        .soft(Math.abs(offset), `${glyph}, ${offset.toFixed(1)} px off centre`)
        .toBeLessThanOrEqual(1);
    }
  });
}
