import { test, expect } from './fixtures.js';
import { grooveUrl } from './corpus.js';
import { loadGroove } from './helpers.js';

// Interaction tests: real clicks on the grid and the real toolbar, each step
// asserting the exact groove URL the editor writes back with history.replaceState.
// The golden master only covers URL -> output. These cover click -> URL, and they
// protect the refactor of the editor's state handling.
//
// Every test starts from a fixed URL, so a later change of the default groove
// cannot break them. Tests marked test.fixme describe the correct behaviour of a
// known bug. Remove the fixme in the PR that fixes the bug.

const empty = (div, measures = 1, extra = '') => {
  const lane = '-'.repeat(div);
  const row = (name) => `&${name}=|${Array(measures).fill(lane).join('|')}|`;
  return `?TimeSig=4/4&Div=${div}&Tempo=80&Measures=${measures}${extra}${row('H')}${row('S')}${row('K')}`;
};

const START = empty(16);

// The URL query the editor currently shows.
const query = (page) => new URL(page.url()).search;

async function expectQuery(page, expected) {
  await expect.poll(() => query(page)).toBe(expected);
}

async function open(page, q = START) {
  await loadGroove(page, grooveUrl(q));
}

async function chooseDivision(page, id) {
  await page.click('#divisionMenuButton');
  await page.click(`#${id}`);
}

async function chooseTimeSignature(page, top, bottom) {
  await page.click('#timeLabel');
  await page.selectOption('#timeSigPopupTimeSigTop', top);
  await page.selectOption('#timeSigPopupTimeSigBottom', bottom);
  await page.click('#timeSigPopupOK');
}

const HH0 =
  '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|x---------------|&S=|----------------|&K=|----------------|';
const HH0_SN4 =
  '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|x---------------|&S=|----O-----------|&K=|----------------|';
const HH0_SN4_K8 =
  '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|x---------------|&S=|----O-----------|&K=|--------o-------|';
const TWO_MEASURES =
  '?TimeSig=4/4&Div=16&Tempo=80&Measures=2&H=|x---------------|x---------------|&S=|----O-----------|----O-----------|&K=|--------o-------|--------o-------|';

test.describe('click a note', () => {
  test('each click writes its note into the URL', async ({ page }) => {
    await open(page);
    await expectQuery(page, START);
    await page.click('#hi-hat0');
    await expectQuery(page, HH0);
    await page.click('#snare4');
    await expectQuery(page, HH0_SN4);
    await page.click('#kick8');
    await expectQuery(page, HH0_SN4_K8);
  });
});

test.describe('add measure', () => {
  test('the new measure copies the last one', async ({ page }) => {
    await open(page);
    await page.click('#hi-hat0');
    await page.click('#snare4');
    await page.click('#kick8');
    await expectQuery(page, HH0_SN4_K8);
    await page.click('#addMeasureButton');
    await expectQuery(page, TWO_MEASURES);
  });

  test('a click in the new measure changes only that measure', async ({ page }) => {
    await open(page, HH0);
    await page.click('#addMeasureButton');
    await expectQuery(
      page,
      '?TimeSig=4/4&Div=16&Tempo=80&Measures=2&H=|x---------------|x---------------|&S=|----------------|----------------|&K=|----------------|----------------|'
    );
    await page.click('#snare20');
    await expectQuery(
      page,
      '?TimeSig=4/4&Div=16&Tempo=80&Measures=2&H=|x---------------|x---------------|&S=|----------------|----O-----------|&K=|----------------|----------------|'
    );
  });
});

test.describe('undo and redo', () => {
  test('undo steps back through each edit, down to the start', async ({ page }) => {
    await open(page);
    await page.click('#hi-hat0');
    await page.click('#snare4');
    await expectQuery(page, HH0_SN4);
    await page.click('#undoButton');
    await expectQuery(page, HH0);
    await page.click('#undoButton');
    await expectQuery(page, START);
    // Nothing is left to undo: the URL stays at the start.
    await page.click('#undoButton');
    await expectQuery(page, START);
  });

  test('undo takes back an added measure', async ({ page }) => {
    await open(page);
    await page.click('#hi-hat0');
    await page.click('#snare4');
    await page.click('#kick8');
    await page.click('#addMeasureButton');
    await expectQuery(page, TWO_MEASURES);
    await page.click('#undoButton');
    await expectQuery(page, HH0_SN4_K8);
  });

  test('redo re-applies what undo took back, in order', async ({ page }) => {
    await open(page);
    await page.click('#hi-hat0');
    await page.click('#snare4');
    await page.click('#undoButton');
    await page.click('#undoButton');
    await expectQuery(page, START);
    await page.click('#redoButton');
    await expectQuery(page, HH0);
    await page.click('#redoButton');
    await expectQuery(page, HH0_SN4);
    // Nothing is left to redo.
    await page.click('#redoButton');
    await expectQuery(page, HH0_SN4);
  });

  test('redo brings back an added measure', async ({ page }) => {
    await open(page, HH0);
    await page.click('#addMeasureButton');
    await page.click('#undoButton');
    await expectQuery(page, HH0);
    await page.click('#redoButton');
    await expectQuery(
      page,
      '?TimeSig=4/4&Div=16&Tempo=80&Measures=2&H=|x---------------|x---------------|&S=|----------------|----------------|&K=|----------------|----------------|'
    );
  });

  test('a new edit after undo clears the redo history', async ({ page }) => {
    await open(page);
    await page.click('#hi-hat0');
    await page.click('#undoButton');
    await page.click('#snare4');
    await page.click('#redoButton');
    await expectQuery(
      page,
      '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|----------------|&S=|----O-----------|&K=|----------------|'
    );
  });
});

test.describe('toggle toms', () => {
  const WITH_TOMS =
    '?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|x---------------|&S=|----------------|&K=|----------------|&T1=|----------------|&T4=|----------------|';

  test('showing the toms adds their lanes and hiding them removes the lanes', async ({ page }) => {
    await open(page, HH0);
    await page.click('#showHideTomsButton');
    await expectQuery(page, WITH_TOMS);
    await page.click('#showHideTomsButton');
    await expectQuery(page, HH0);
  });

  test('a note clicked in a tom lane is written to the URL', async ({ page }) => {
    await open(page, HH0);
    await page.click('#showHideTomsButton');
    await expectQuery(page, WITH_TOMS);
    await page.click('#tom1-0');
    await expectQuery(page, WITH_TOMS.replace('&T1=|-', '&T1=|o'));
  });

  test.fixme('undo takes back the toms toggle (audit item 14)', async ({ page }) => {
    await open(page);
    await page.click('#hi-hat0');
    await page.click('#showHideTomsButton');
    await expectQuery(page, WITH_TOMS);
    await page.click('#undoButton');
    // Today the URL still has the tom lanes, and the next undo is lost too.
    await expectQuery(page, HH0);
  });
});

test.describe('change division', () => {
  test('1/8 notes keep the notes on their beats', async ({ page }) => {
    await open(page, HH0_SN4_K8);
    await chooseDivision(page, 'subdivision_8ths');
    await expectQuery(
      page,
      '?TimeSig=4/4&Div=8&Tempo=80&Measures=1&H=|x-------|&S=|--O-----|&K=|----o---|'
    );
  });

  test('1/32 notes keep the notes on their beats', async ({ page }) => {
    await open(page, HH0_SN4_K8);
    await chooseDivision(page, 'subdivision_32ths');
    await expectQuery(
      page,
      '?TimeSig=4/4&Div=32&Tempo=80&Measures=1&H=|x-------------------------------|&S=|--------O-----------------------|&K=|----------------o---------------|'
    );
  });

  // This test pins today's behaviour on purpose. The straight-to-triplet switch drops the
  // hi-hat note and loads a default triplet groove with no warning. PR 3 task T3.5
  // ("ask before straight to triplet") changes this, and then this test needs an update.
  test('1/8 triplets switch to 12 notes and load the default triplet notes', async ({ page }) => {
    await open(page, HH0);
    await chooseDivision(page, 'subdivision_12ths');
    await expectQuery(
      page,
      '?TimeSig=4/4&Div=12&Tempo=80&Measures=1&H=|------------|&S=|---O-----O--|&K=|o-----o-----|'
    );
  });

  test('undo takes back a division change', async ({ page }) => {
    await open(page, HH0_SN4_K8);
    await chooseDivision(page, 'subdivision_8ths');
    await page.click('#undoButton');
    await expectQuery(page, HH0_SN4_K8);
  });
});

test.describe('change time signature', () => {
  test('3/4 shortens the measure to 12 notes', async ({ page }) => {
    await open(page, HH0_SN4_K8);
    await chooseTimeSignature(page, '3', '4');
    await expectQuery(
      page,
      '?TimeSig=3/4&Div=16&Tempo=80&Measures=1&H=|x-----------|&S=|----O-------|&K=|--------o---|'
    );
    await expect(page.locator('#timeSigLabel')).toHaveText('3/4');
  });

  test('7/8 at 1/8 notes makes a 7 note measure', async ({ page }) => {
    await open(page, empty(8));
    await chooseTimeSignature(page, '7', '8');
    await expectQuery(
      page,
      '?TimeSig=7/8&Div=8&Tempo=80&Measures=1&H=|-------|&S=|-------|&K=|-------|'
    );
    await expect(page.locator('#timeSigLabel')).toHaveText('7/8');
  });

  // selectOption alone never changes the URL, so this proves only that Cancel applies no
  // change. It does not prove that the popup would have changed the URL on Done.
  test('cancel leaves the time signature as it was', async ({ page }) => {
    await open(page, HH0);
    await page.click('#timeLabel');
    await page.selectOption('#timeSigPopupTimeSigTop', '5');
    await page.click('#timeSigPopupCancel');
    await expectQuery(page, HH0);
    await expect(page.locator('#timeSigLabel')).toHaveText('4/4');
  });

  test('undo takes back a time signature change', async ({ page }) => {
    await open(page, HH0_SN4_K8);
    await chooseTimeSignature(page, '3', '4');
    await page.click('#undoButton');
    await expectQuery(page, HH0_SN4_K8);
    await expect(page.locator('#timeSigLabel')).toHaveText('4/4');
  });
});

// Known bugs. Each test states the correct behaviour. PR 3 removes the fixme.
test.describe('known bugs', () => {
  test.fixme('toms hide when the next loaded groove has none', async ({ page }) => {
    // The expected URL below is a best guess. PR 3 may correct it.
    await open(page, `${START}&T1=|o---------------|&T4=|---o------------|`);
    await page.click('#groovesAnchor');
    await page.locator('.grooveListLI').first().click();
    // The first built-in groove is the empty 16th note groove. It has no toms.
    // Today the toms stay visible and the URL keeps empty T1 and T4 lanes.
    await expectQuery(page, START);
  });

  test.fixme('stickings hide when the next loaded groove has none', async ({ page }) => {
    // The expected URL below is a best guess. PR 3 may correct it.
    await open(page, `${START}&Stickings=|R---------------|`);
    await page.click('#groovesAnchor');
    await page.locator('.grooveListLI').first().click();
    // Today the URL keeps an empty Stickings lane.
    await expectQuery(page, START);
  });

  test.fixme('swing stays on a 12 note measure after load (audit item 16)', async ({ page }) => {
    // 6/8 at 1/16 notes is a 12 note measure that supports swing.
    await open(
      page,
      '?TimeSig=6/8&Div=16&Tempo=80&Measures=1&Swing=40&H=|------------|&S=|------------|&K=|------------|'
    );
    await page.click('#hi-hat0');
    // Today the first edit drops Swing from the URL.
    await expectQuery(
      page,
      '?TimeSig=6/8&Div=16&Tempo=80&Swing=40&Measures=1&H=|x-----------|&S=|------------|&K=|------------|'
    );
  });

  test.fixme('a permutation survives a restore', async ({ page }) => {
    await open(page);
    await page.click('#permutationAnchor');
    await page.locator('#permutationContextMenu li').nth(1).click();
    await expect(page.locator('#PermutationOptions')).toHaveClass(/displayed/);
    await page.reload();
    await page.waitForSelector('#svgTarget svg');
    // Today the permutation is not in the URL and is gone after the reload.
    await expect(page.locator('#PermutationOptions')).toHaveClass(/displayed/);
  });

  test.fixme('add measure at 10 measures changes nothing (audit item 2)', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    const ten = empty(16, 10);
    await open(page, ten);
    await expect(page.locator('#addMeasureButton')).toHaveAttribute(
      'title',
      'Maximum is 10 measures'
    );
    await expect(page.locator('#addMeasureButton')).toBeDisabled();
    // Force the click: a disabled button is not clickable by default.
    await page.click('#addMeasureButton', { force: true });
    // Today the URL says Measures=11, and a reload cuts it back to 10.
    await expectQuery(page, ten);
  });

  test.fixme('a bad time signature combination leaves all state unchanged (audit item 15)', async ({
    page,
  }) => {
    // 1/8 triplets are not allowed with an 8th note beat.
    // The expected URL is a best guess. PR 3 may instead expect a switch to a straight division.
    const triplets =
      '?TimeSig=4/4&Div=12&Tempo=80&Measures=1&H=|x-----------|&S=|------------|&K=|------------|';
    await open(page, triplets);
    await chooseTimeSignature(page, '4', '8');
    // Today the division changes to 16 and the hi-hat note spreads over the measure.
    await expectQuery(page, triplets);
    await expect(page.locator('#timeSigLabel')).toHaveText('4/4');
  });

  test.fixme('on two measures, a time signature change keeps each measure in its own bar (audit item 18)', async ({
    page,
  }) => {
    await open(
      page,
      '?TimeSig=4/4&Div=8&Tempo=80&Measures=2&H=|x-------|x-------|&S=|--------|--------|&K=|--------|--------|'
    );
    await chooseTimeSignature(page, '3', '4');
    // Today the second measure's note moves to the third slot of the new second bar.
    await expectQuery(
      page,
      '?TimeSig=3/4&Div=8&Tempo=80&Measures=2&H=|x-----|x-----|&S=|------|------|&K=|------|------|'
    );
  });

  test.fixme('toms 2 and 3 survive load and read back (audit item 17)', async ({ page }) => {
    // The expected URL below is a best guess. PR 3 may correct it.
    const lane = (note, at) => `|${'-'.repeat(at)}${note}${'-'.repeat(15 - at)}|`;
    const withToms =
      START + `&T1=${lane('o', 0)}&T2=${lane('o', 1)}&T3=${lane('o', 2)}&T4=${lane('o', 3)}`;
    await open(page, withToms);
    // Today the URL has T1 and T4 only.
    await expectQuery(page, withToms);
  });
});
