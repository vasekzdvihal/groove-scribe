import { test, expect } from './fixtures.js';

// Part play: the ruler above each bar selects beats, Play loops only them, and the chip in the
// playback bar says what plays.

const H = '|x-x-x-x-x-x-x-x-|xxxxxxxxxxxxxxxx|x---x---x---x---|x-x-x-x-x-x-x-x-|';
const S = '|----O-------O---|--O---O---O---O-|----O-------O---|O-O-O-O-O-O-O-O-|';
const K = '|o-------o-------|o--o--o--o--o---|o-o-o-o-o-o-o-o-|o---------------|';
// At 120 BPM a bar takes 2 s, so 3 s of play holds a loop back to the start of the part.
const FOUR_BARS = `?TimeSig=4/4&Div=16&Tempo=120&Measures=4&H=${H}&S=${S}&K=${K}`;
const EIGHTHS_TWO_BARS = '?TimeSig=4/4&Div=8&Tempo=80&Measures=2&H=|xxxxxxxx|xxxxxxxx|';
const SIX_EIGHT_TWO_BARS = '?TimeSig=6/8&Div=8&Tempo=80&Measures=2&H=|xxxxxx|xxxxxx|';
const ONE_BAR = '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|xxxxxxxxxxxxxxxx|';

async function openEditor(page, query) {
  await page.goto('/index.html' + query);
  await page.waitForSelector('#svgTarget svg');
}

const shaded = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.bg-highlight.is-part-selected')].map((el) =>
      Number(el.id.replace('bg-highlight', ''))
    )
  );
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const chip = (page) => page.locator('#partPlayChip');

test('Play loops only the selected bar', async ({ page }) => {
  await openEditor(page, FOUR_BARS);
  await page.getByRole('button', { name: 'Bar 2', exact: true }).click();
  await expect(chip(page)).toBeVisible();
  await expect(chip(page)).toContainText('Bar 2');
  expect(await shaded(page)).toEqual(range(16, 31));

  // Play works once the sound is ready.
  await expect(page.locator('[id^="midiPlayImage"]')).toHaveClass(/Stopped/, { timeout: 15000 });
  await page.click('[id^="midiPlayImage"]');
  await expect
    .poll(() => page.evaluate(() => window.myGrooveWriter.myGrooveUtils.isPlaying()), {
      timeout: 15000,
    })
    .toBe(true);
  // Every 20 ms, note the cell that has the playback highlight.
  const seen = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const ids = new Set();
        const timer = setInterval(() => {
          for (const cell of document.querySelectorAll('.bg-highlight')) {
            if (cell.style.background) ids.add(Number(cell.id.replace('bg-highlight', '')));
          }
        }, 20);
        setTimeout(() => {
          clearInterval(timer);
          resolve([...ids].sort((a, b) => a - b));
        }, 3000);
      })
  );
  await page.evaluate(() => window.myGrooveWriter.myGrooveUtils.stopMIDI_playback());
  expect(seen.length).toBeGreaterThan(8);
  expect(seen.filter((id) => id < 16 || id > 31)).toEqual([]);
  // It played the start and the end of bar 2.
  expect(seen[0]).toBeLessThanOrEqual(17);
  expect(seen.at(-1)).toBeGreaterThanOrEqual(29);
});

test('a drag on the ruler selects beats across two bars', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openEditor(page, FOUR_BARS);
  const url = page.url();
  const centre = async (beat) => {
    const box = await page.locator(`.bar-ruler-beat[data-beat="${beat}"]`).boundingBox();
    return [box.x + box.width / 2, box.y + box.height / 2];
  };
  await page.mouse.move(...(await centre(6)));
  await page.mouse.down();
  await page.mouse.move(...(await centre(8)), { steps: 5 });
  await page.mouse.move(...(await centre(9)), { steps: 5 });
  await page.mouse.up();
  expect(await shaded(page)).toEqual(range(24, 39));
  await expect(page.locator('#partPlayChip .part-play-label')).toHaveText(
    'Bar 2 beat 3 – bar 3 beat 2'
  );
  // The URL does not keep the selection.
  expect(page.url()).toBe(url);

  await page.getByRole('button', { name: 'Play the whole groove' }).click();
  await expect(chip(page)).toBeHidden();
  expect(await shaded(page)).toEqual([]);
});

test('two taps select from one beat to the other', async ({ page }) => {
  await openEditor(page, FOUR_BARS);
  await page.locator('.bar-ruler-beat[data-beat="2"]').click();
  await page.locator('.bar-ruler-beat[data-beat="5"]').click();
  expect(await shaded(page)).toEqual(range(8, 23));
  await expect(page.locator('#partPlayChip .part-play-label')).toHaveText(
    'Bar 1 beat 3 – bar 2 beat 2'
  );
});

test('a tap on the selection clears it', async ({ page }) => {
  await openEditor(page, FOUR_BARS);
  await page.locator('.bar-ruler-beat[data-beat="2"]').click();
  await page.locator('.bar-ruler-beat[data-beat="5"]').click();
  await page.locator('.bar-ruler-beat[data-beat="3"]').click();
  expect(await shaded(page)).toEqual([]);
  await expect(chip(page)).toBeHidden();

  const bar = page.getByRole('button', { name: 'Bar 2', exact: true });
  await bar.click();
  await expect(chip(page)).toBeVisible();
  await bar.click();
  expect(await shaded(page)).toEqual([]);
  await expect(chip(page)).toBeHidden();
});

// The keyboard. The ruler beats are a list per bar, with one tab stop for all of them.
const focused = (page) => page.locator(':focus');
const isPlaying = (page) => page.evaluate(() => window.myGrooveWriter.myGrooveUtils.isPlaying());

async function tabTo(page, selector, key = 'Tab') {
  const target = page.locator(selector);
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press(key);
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Tab did not reach ${selector}`);
}

test('the ruler beats are one tab stop', async ({ page }) => {
  await openEditor(page, FOUR_BARS);
  await page.getByRole('button', { name: 'Bar 1', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(focused(page)).toHaveAttribute('aria-label', 'Bar 1, beat 1');
  // The next stops are the grid and Remove bar 1, then Bar 2: no other beat.
  const stops = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      return {
        role: el.getAttribute('role'),
        name: el.getAttribute('aria-label') ?? el.textContent,
      };
    });
    stops.push(stop);
    if (stop.name === 'Bar 2') break;
  }
  expect(stops.at(-1).name).toBe('Bar 2');
  expect(stops.filter((stop) => stop.role === 'option')).toEqual([]);
});

test('Enter selects a beat, and Enter on another beat selects the beats between', async ({
  page,
}) => {
  await openEditor(page, FOUR_BARS);
  await page.locator('.bar-ruler-beat[data-beat="0"]').focus();
  await page.keyboard.press('Enter');
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(focused(page)).toHaveAttribute('aria-label', 'Bar 2, beat 2');
  await page.keyboard.press('Enter');
  expect(await shaded(page)).toEqual(range(0, 23));
  await expect(page.locator('#partPlayChip .part-play-label')).toHaveText(
    'Bar 1 beat 1 – bar 2 beat 2'
  );
  await expect(page.locator('#partPlayStatus')).toHaveText('Bar 1 beat 1 – bar 2 beat 2');
  await expect(page.locator('.bar-ruler-beat[aria-selected="true"]')).toHaveCount(6);
});

test('Shift+Right extends the selection across a bar', async ({ page }) => {
  await openEditor(page, FOUR_BARS);
  await page.locator('.bar-ruler-beat[data-beat="3"]').focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  expect(await shaded(page)).toEqual(range(12, 23));
  await expect(page.locator('#partPlayChip .part-play-label')).toHaveText(
    'Bar 1 beat 4 – bar 2 beat 2'
  );
});

test('Enter on the selection clears it', async ({ page }) => {
  await openEditor(page, FOUR_BARS);
  await page.locator('.bar-ruler-beat[data-beat="4"]').focus();
  await page.keyboard.press('Enter');
  await expect(chip(page)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(chip(page)).toBeHidden();
  expect(await shaded(page)).toEqual([]);
});

test('arrow keys on the ruler do not change the tempo, and Space does not play', async ({
  page,
}) => {
  await openEditor(page, FOUR_BARS);
  await page.locator('.bar-ruler-beat[data-beat="2"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => window.myGrooveWriter.myGrooveUtils.getTempo())).toBe(120);
  await expect(focused(page)).toHaveAttribute('aria-label', 'Bar 1, beat 2');
  await page.keyboard.press(' ');
  await expect(page.locator('#partPlayChip .part-play-label')).toHaveText('Bar 1, beat 2');
  expect(await isPlaying(page)).toBe(false);
});

test('a tap on a beat or on Bar N leaves no focus, so Space plays', async ({ page }) => {
  await openEditor(page, FOUR_BARS);
  await page.getByRole('button', { name: 'Bar 2', exact: true }).click();
  await page.locator('.bar-ruler-beat[data-beat="9"]').click();
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.keyboard.press(' ');
  await expect.poll(() => isPlaying(page)).toBe(true);
  await page.keyboard.press(' ');
  await expect.poll(() => isPlaying(page)).toBe(false);
});

test('the add and remove bar buttons work by keyboard', async ({ page }) => {
  await openEditor(page, ONE_BAR);
  await tabTo(page, '#addMeasureButton');
  await expect(focused(page)).toHaveAccessibleName('Add a bar');
  await page.keyboard.press('Enter');
  await expect(page.locator('.staff-container')).toHaveCount(2);
  // The focus stays on Add a bar, so the next key goes on from there.
  await expect(page.locator('#addMeasureButton')).toBeFocused();
  await tabTo(page, '#closeMeasureButton2', 'Shift+Tab');
  await expect(focused(page)).toHaveAccessibleName('Remove bar 2');
  await page.keyboard.press('Enter');
  await expect(page.locator('.staff-container')).toHaveCount(1);
  await expect(page.locator('#addMeasureButton')).toBeFocused();
});

test('a tap on Add a bar or Remove bar leaves no focus, so Space plays', async ({ page }) => {
  await openEditor(page, ONE_BAR);
  await page.locator('#addMeasureButton').click();
  await expect(page.locator('.staff-container')).toHaveCount(2);
  await page.locator('#closeMeasureButton2').click();
  await expect(page.locator('.staff-container')).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.keyboard.press(' ');
  await expect.poll(() => isPlaying(page)).toBe(true);
  await page.keyboard.press(' ');
  await expect.poll(() => isPlaying(page)).toBe(false);
});

test('Add a bar at the limit says why it does nothing', async ({ page }) => {
  await openEditor(page, '?TimeSig=4/4&Div=16&Tempo=80&Measures=10');
  const add = page.locator('#addMeasureButton');
  await expect(add).toHaveAttribute('aria-disabled', 'true');
  await expect(add).toHaveAccessibleName('Add a bar. The limit is 10 bars');
});

test('every beat is reachable by keyboard, also the one under Remove bar in 6/8', async ({
  page,
}) => {
  await openEditor(page, SIX_EIGHT_TWO_BARS);
  await page.locator('.bar-ruler-beat[data-beat="0"]').focus();
  for (let n = 1; n < 12; n++) {
    await page.keyboard.press('ArrowRight');
    await expect(focused(page)).toHaveAttribute('data-beat', String(n));
  }
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await expect(focused(page)).toHaveAttribute('aria-label', 'Bar 2, beat 6');
  await page.keyboard.press('Enter');
  await expect(page.locator('#partPlayChip .part-play-label')).toHaveText('Bar 2, beat 6');
});

test('view mode hides the rulers and keeps the chip', async ({ page }) => {
  await openEditor(page, FOUR_BARS);
  await page.getByRole('button', { name: 'Bar 3', exact: true }).click();
  await page.getByRole('button', { name: 'View mode' }).click();
  await expect(page.locator('.bar-ruler').first()).toBeHidden();
  await expect(chip(page)).toBeVisible();
  await page.getByRole('button', { name: 'Play the whole groove' }).click();
  await expect(chip(page)).toBeHidden();
});

test('a permutation hides the rulers', async ({ page }) => {
  await openEditor(page, '?TimeSig=4/4&Div=16&Tempo=80&Measures=1');
  await expect(page.locator('.bar-ruler')).toBeVisible();
  await page.evaluate(() => window.myGrooveWriter.permutationPopupClick('kick_16ths'));
  await expect(page.locator('.bar-ruler').first()).toBeHidden();
});

// The ruler parts that are smaller than a finger, and beats that do not line up with their cells.
function rulerTargetProblems(page) {
  return page.evaluate(() => {
    const problems = [];
    const box = (el) => el.getBoundingClientRect();
    const targets = document.querySelectorAll('.bar-ruler-bar, .bar-ruler-beat');
    if (!targets.length) problems.push('no ruler');
    for (const el of targets) {
      const b = box(el);
      if (b.width < 44 || b.height < 44)
        problems.push(`small ${el.textContent.trim()} ${b.width}x${b.height}`);
    }
    const notesPerBeat = 16 / 4;
    for (const beat of document.querySelectorAll('.bar-ruler-beat')) {
      const n = Number(beat.dataset.beat);
      const first = box(document.getElementById('hi-hat' + n * notesPerBeat));
      const last = box(document.getElementById('hi-hat' + ((n + 1) * notesPerBeat - 1)));
      const b = box(beat);
      if (Math.abs(b.left - first.left) > 1 || Math.abs(b.right - last.right) > 1)
        problems.push(`beat ${n} is not over its cells`);
    }
    return problems;
  });
}

// Remove buttons that the ruler covers, or that cover more of the ruler than D1 allows: the
// right end of the last beat only, with at least 44 px of that beat left free.
function removeButtonProblems(page) {
  return page.evaluate(() => {
    const problems = [];
    const box = (el) => el.getBoundingClientRect();
    const overlaps = (a, b) =>
      a.left < b.right - 0.5 &&
      b.left < a.right - 0.5 &&
      a.top < b.bottom - 0.5 &&
      b.top < a.bottom - 0.5;
    for (const remove of document.querySelectorAll('.closeMeasureButton[id]')) {
      // A hit test needs the button on screen.
      remove.scrollIntoView({ block: 'center' });
      const r = box(remove);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (r.width < 44 || r.height < 44 || !remove.contains(hit))
        problems.push(`${remove.id} is small or covered`);
      const ruler = remove.parentElement.querySelector('.bar-ruler');
      const beats = [...ruler.querySelectorAll('.bar-ruler-beat')];
      const others = [ruler.querySelector('.bar-ruler-bar'), ...beats.slice(0, -1)];
      if (others.some((el) => overlaps(box(el), r))) problems.push(`${remove.id} covers a beat`);
      const lastBeat = box(beats.at(-1));
      if (r.left - lastBeat.left < 44) problems.push(`${remove.id} leaves less than 44 px`);
      // The cells stay clear of the ruler and its Remove button.
      const firstCell = box(remove.parentElement.querySelector('.hi-hat'));
      if (firstCell.top < Math.max(lastBeat.bottom, r.bottom) - 0.5)
        problems.push(`${remove.id} row covers the cells`);
    }
    return problems;
  });
}

for (const [width, height] of [
  [1024, 768],
  [768, 1024],
  [1440, 900],
]) {
  test.describe(`rulers at ${width}x${height}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true });

    for (const [name, query] of [
      ['four bars in 1/16', FOUR_BARS],
      ['one bar', ONE_BAR],
    ]) {
      test(`every ruler target is 44 px, and Remove stays free (${name})`, async ({ page }) => {
        await openEditor(page, query);
        expect(await rulerTargetProblems(page)).toEqual([]);
        expect(await removeButtonProblems(page)).toEqual([]);
      });
    }

    test('1/8 note beats are 44 px and line up with their cells', async ({ page }) => {
      await openEditor(page, EIGHTHS_TWO_BARS);
      await expect(page.locator('.bar-ruler-beat')).toHaveCount(8);
      const problems = await page.evaluate(() =>
        [...document.querySelectorAll('.bar-ruler-beat')].flatMap((beat) => {
          const n = Number(beat.dataset.beat);
          const b = beat.getBoundingClientRect();
          const first = document.getElementById('hi-hat' + n * 2).getBoundingClientRect();
          const last = document.getElementById('hi-hat' + (n * 2 + 1)).getBoundingClientRect();
          return [
            ...(b.width < 44 || b.height < 44 ? [`small ${n}`] : []),
            ...(Math.abs(b.left - first.left) > 1 || Math.abs(b.right - last.right) > 1
              ? [`beat ${n} is not over its cells`]
              : []),
          ];
        })
      );
      expect(problems).toEqual([]);
    });

    test('6/8 in 1/8 notes: Remove stays free, and a drag reaches the last beat under it', async ({
      page,
    }) => {
      await openEditor(page, SIX_EIGHT_TWO_BARS);
      await expect(page.locator('.bar-ruler-beat')).toHaveCount(12);
      const geometry = await page.evaluate(() => {
        const remove = document.getElementById('closeMeasureButton1');
        remove.scrollIntoView({ block: 'center' });
        const r = remove.getBoundingClientRect();
        // Every point of the button, 1 px in from its edges, hits the button.
        const points = [1, r.width / 2, r.width - 1].flatMap((dx) =>
          [1, r.height / 2, r.height - 1].map((dy) => [r.left + dx, r.top + dy])
        );
        const free = points.every(([x, y]) => remove.contains(document.elementFromPoint(x, y)));
        const widths = [0, 1, 2, 3, 4].map((n) =>
          Math.floor(
            document.querySelector(`.bar-ruler-beat[data-beat="${n}"]`).getBoundingClientRect()
              .width
          )
        );
        return { free, big: r.width >= 44 && r.height >= 44, small: widths.filter((w) => w < 44) };
      });
      expect(geometry).toEqual({ free: true, big: true, small: [] });

      const start = await page.locator('.bar-ruler-beat[data-beat="4"]').boundingBox();
      const remove = await page.locator('#closeMeasureButton1').boundingBox();
      const y = start.y + start.height / 2;
      await page.mouse.move(start.x + start.width / 2, y);
      await page.mouse.down();
      await page.mouse.move(remove.x + remove.width - 2, y, { steps: 8 });
      await page.mouse.up();
      expect(await shaded(page)).toEqual(range(4, 5));
      await expect(page.locator('#partPlayChip .part-play-label')).toHaveText('Bar 1, beats 5–6');
    });
  });
}

// The chip is part of the playback bar: inside its box, never over the music, and the bar does
// not scroll. The longest kind of label, with a 44 px ×.
for (const [width, height, docked, inline] of [
  [1024, 768, false, null],
  [768, 1024, false, false],
  [1440, 900, false, true],
  [1440, 900, true, null],
]) {
  test.describe(`the chip at ${width}x${height}${docked ? ' docked' : ''}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true });

    test('sits in the playback bar and covers no music', async ({ page }) => {
      await openEditor(page, FOUR_BARS);
      if (docked) {
        await page.click('#groovesTab');
        await expect(page.locator('#sidePanel')).toBeVisible();
      }
      await page.locator('.bar-ruler-beat[data-beat="6"]').click();
      await page.locator('.bar-ruler-beat[data-beat="9"]').click();
      await expect(page.locator('#partPlayChip .part-play-label')).toHaveText(
        'Bar 2 beat 3 – bar 3 beat 2'
      );
      // The end of the music, scrolled into view.
      await page.evaluate(() => {
        const content = document.getElementById('RightHandContent');
        content.scrollTop = content.scrollHeight;
      });
      const layout = await page.evaluate(() => {
        const box = (id) => document.getElementById(id).getBoundingClientRect();
        const c = box('partPlayChip');
        const bar = box('PlaybackBar');
        const content = box('RightHandContent');
        const grid = box('measureContainer');
        // The part of the grid that shows on screen.
        const seen = {
          left: Math.max(grid.left, content.left),
          right: Math.min(grid.right, content.right),
          top: Math.max(grid.top, content.top),
          bottom: Math.min(grid.bottom, content.bottom),
        };
        const clear = document.querySelector('#partPlayChip button').getBoundingClientRect();
        const play = document.querySelector('.midiPlayImage').getBoundingClientRect();
        const kicks = [...document.querySelectorAll('#musicalInput .kick')];
        const lastKick = kicks.at(-1).getBoundingClientRect();
        return {
          insideBar:
            c.left >= bar.left - 0.5 &&
            c.right <= bar.right + 0.5 &&
            c.top >= bar.top - 0.5 &&
            c.bottom <= bar.bottom + 0.5,
          coversGrid:
            c.left < seen.right &&
            seen.left < c.right &&
            c.top < seen.bottom &&
            seen.top < c.bottom,
          lastNoteFree: lastKick.bottom <= bar.top + 0.5,
          clear: clear.width >= 44 && clear.height >= 44,
          barScrolls: document.getElementById('PlaybackBar').scrollWidth > bar.width + 0.5,
          inline: Math.abs((c.top + c.bottom) / 2 - (play.top + play.bottom) / 2) <= 2,
        };
      });
      const { inline: isInline, ...rest } = layout;
      expect(rest).toEqual({
        insideBar: true,
        coversGrid: false,
        lastNoteFree: true,
        clear: true,
        barScrolls: false,
      });
      if (inline !== null) expect(isInline).toBe(inline);

      // The × gives the bar back its height.
      await page.getByRole('button', { name: 'Play the whole groove' }).click();
      expect((await page.locator('#PlaybackBar').boundingBox()).height).toBe(96);
    });
  });
}
