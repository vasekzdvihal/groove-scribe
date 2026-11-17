import { test, expect } from './fixtures.js';

// Part play: the ruler above each bar selects beats, Play loops only them, and the chip in the
// playback bar says what plays.

const H = '|x-x-x-x-x-x-x-x-|xxxxxxxxxxxxxxxx|x---x---x---x---|x-x-x-x-x-x-x-x-|';
const S = '|----O-------O---|--O---O---O---O-|----O-------O---|O-O-O-O-O-O-O-O-|';
const K = '|o-------o-------|o--o--o--o--o---|o-o-o-o-o-o-o-o-|o---------------|';
// At 120 BPM a bar takes 2 s, so 3 s of play holds a loop back to the start of the part.
const FOUR_BARS = `?TimeSig=4/4&Div=16&Tempo=120&Measures=4&H=${H}&S=${S}&K=${K}`;
const EIGHTHS_TWO_BARS = '?TimeSig=4/4&Div=8&Tempo=80&Measures=2&H=|xxxxxxxx|xxxxxxxx|';
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

    test('the chip has a 44 px clear button and stays on screen', async ({ page }) => {
      await openEditor(page, FOUR_BARS);
      await page.locator('.bar-ruler-beat[data-beat="2"]').click();
      await page.locator('.bar-ruler-beat[data-beat="13"]').click();
      await expect(chip(page)).toBeVisible();
      const layout = await page.evaluate(() => {
        const box = (el) => el.getBoundingClientRect();
        const c = box(document.getElementById('partPlayChip'));
        const clear = box(document.querySelector('#partPlayChip button'));
        const bar = box(document.getElementById('PlaybackBar'));
        return {
          clear: clear.width >= 44 && clear.height >= 44,
          onScreen: c.left >= 0 && c.right <= window.innerWidth,
          aboveBar: c.bottom <= bar.top,
          bar: document.getElementById('PlaybackBar').scrollWidth <= bar.width,
        };
      });
      expect(layout).toEqual({ clear: true, onScreen: true, aboveBar: true, bar: true });
    });
  });
}
