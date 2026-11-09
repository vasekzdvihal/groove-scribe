import { test, expect } from './fixtures.js';
import { grooveUrl } from './corpus.js';
import { loadGroove } from './helpers.js';

// Interaction tests: real clicks on the grid and the real toolbar, each step
// asserting the exact groove URL the editor writes back with history.replaceState.
// The golden master only covers URL -> output. These cover click -> URL, and they
// protect the refactor of the editor's state handling.
//
// Every test starts from a fixed URL, so a later change of the default groove
// cannot break them. Tests marked with the skip modifier describe the correct behaviour
// of a known bug. Remove the modifier in the PR that fixes the bug.

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

// Accepts every dialog and returns the list of their messages.
function collectDialogs(page) {
  const messages = [];
  page.on('dialog', (dialog) => {
    messages.push(dialog.message());
    dialog.accept();
  });
  return messages;
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

  test('add measure at 10 measures changes nothing (audit item 2)', async ({ page }) => {
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
    // The limit is 10 measures, so the URL must still say Measures=10.
    await expectQuery(page, ten);
  });

  test('the Add button follows the limit on load, remove, undo and redo', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    const add = page.locator('#addMeasureButton');
    await open(page, empty(16, 9));
    await expect(add).toBeEnabled();
    await expect(add).toHaveAttribute('title', 'Add measure');

    await add.click();
    await expectQuery(page, empty(16, 10));
    await expect(add).toBeDisabled();

    await page.click('#undoButton');
    await expectQuery(page, empty(16, 9));
    await expect(add).toBeEnabled();

    await page.click('#redoButton');
    await expectQuery(page, empty(16, 10));
    await expect(add).toBeDisabled();

    await page.click('#closeMeasureButton10');
    await expectQuery(page, empty(16, 9));
    await expect(add).toBeEnabled();

    await open(page, empty(16, 10));
    await expect(add).toBeDisabled();
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

  test('undo takes back the toms toggle (audit item 14)', async ({ page }) => {
    await open(page);
    await page.click('#hi-hat0');
    await page.click('#showHideTomsButton');
    await expectQuery(page, WITH_TOMS);
    await page.click('#undoButton');
    await expectQuery(page, HH0);
  });

  test('undo takes back the view mode toggle (audit item 14)', async ({ page }) => {
    await open(page);
    await page.click('#hi-hat0');
    await expectQuery(page, HH0);
    await page.click('#view-edit-switch');
    await expect(page.locator('#view-edit-switch')).toHaveText('Edit mode');
    await page.click('#view-edit-switch');
    await expect(page.locator('#view-edit-switch')).toHaveText('View mode');
    // A view toggle is not an edit. One undo must take back the hi-hat note.
    await page.click('#undoButton');
    await expectQuery(page, START);
  });

  test('undo works while the editor is in view mode (audit item 14)', async ({ page }) => {
    await open(page);
    await page.click('#hi-hat0');
    await expectQuery(page, HH0);
    await page.click('#view-edit-switch');
    await expect(page.locator('#view-edit-switch')).toHaveText('Edit mode');
    await page.keyboard.press('Control+z');
    await expectQuery(page, START.replace('?', '?Mode=view&'));
  });

  test('undo takes back the stickings toggle (audit item 14)', async ({ page }) => {
    await open(page);
    await page.click('#hi-hat0');
    await page.click('#stickingsButton');
    await page.locator('#stickingsContextMenu li').filter({ hasText: 'Show or Hide' }).click();
    await expect.poll(() => query(page)).toContain('&Stickings=');
    await page.click('#undoButton');
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

  // A switch between straight notes and triplets cannot keep the notes. The editor asks first
  // and names what will be lost.
  test('1/8 triplets ask first, then load the default triplet notes when accepted', async ({
    page,
  }) => {
    const messages = collectDialogs(page);
    await open(page, HH0);
    await chooseDivision(page, 'subdivision_12ths');
    await expectQuery(
      page,
      '?TimeSig=4/4&Div=12&Tempo=80&Measures=1&H=|------------|&S=|---O-----O--|&K=|o-----o-----|'
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/lose the notes/);
  });

  test('dismissing the triplet question leaves the groove and the division as they were', async ({
    page,
  }) => {
    const messages = [];
    page.on('dialog', (dialog) => {
      messages.push(dialog.message());
      dialog.dismiss();
    });
    await open(page, HH0);
    await chooseDivision(page, 'subdivision_12ths');
    await expect.poll(() => messages).toHaveLength(1);

    await expectQuery(page, HH0);
    await expect(page.locator('#divisionMenuLabel')).toHaveText('1/16 notes');
    expect(await page.evaluate(() => window.myGrooveWriter.notesPerMeasure())).toBe(16);

    // The dismissed change added no undo step.
    await page.click('#undoButton');
    await expectQuery(page, HH0);
  });

  test('an empty groove switches to triplets without a question', async ({ page }) => {
    const messages = collectDialogs(page);
    await open(page, START);
    await chooseDivision(page, 'subdivision_12ths');
    await expectQuery(
      page,
      '?TimeSig=4/4&Div=12&Tempo=80&Measures=1&H=|------------|&S=|---O-----O--|&K=|o-----o-----|'
    );
    expect(messages).toEqual([]);
  });

  test('undo takes back a division change', async ({ page }) => {
    await open(page, HH0_SN4_K8);
    await chooseDivision(page, 'subdivision_8ths');
    await page.click('#undoButton');
    await expectQuery(page, HH0_SN4_K8);
  });
});

test.describe('change division on a touch tablet', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });

  test('a tap on 1/8 triplets asks first and Cancel keeps the groove', async ({ page }) => {
    const messages = [];
    page.on('dialog', (dialog) => {
      messages.push(dialog.message());
      dialog.dismiss();
    });
    await open(page, HH0);
    await page.tap('#divisionMenuButton');
    await page.tap('#subdivision_12ths');
    await expect.poll(() => messages).toHaveLength(1);
    await expectQuery(page, HH0);
    await expect(page.locator('#divisionMenuLabel')).toHaveText('1/16 notes');
  });

  test('a tap on 1/8 triplets switches after OK', async ({ page }) => {
    collectDialogs(page);
    await open(page, HH0);
    await page.tap('#divisionMenuButton');
    await page.tap('#subdivision_12ths');
    await expectQuery(
      page,
      '?TimeSig=4/4&Div=12&Tempo=80&Measures=1&H=|------------|&S=|---O-----O--|&K=|o-----o-----|'
    );
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

  // 8/8 at 1/16 notes has the same 16 note grid as 4/4, so nothing but the label shows the change.
  const EIGHT_EIGHT =
    '?TimeSig=8/8&Div=16&Tempo=80&Measures=1&H=|----------------|&S=|----------------|&K=|----------------|';

  test('the label is right after load', async ({ page }) => {
    await open(page, EIGHT_EIGHT);
    await expect(page.locator('#timeSigLabel')).toHaveText('8/8');
  });

  test('the label is right after loading another groove', async ({ page }) => {
    await open(page);
    await page.evaluate((q) => window.myGrooveWriter.loadNewGroove(q), EIGHT_EIGHT);
    await expect(page.locator('#timeSigLabel')).toHaveText('8/8');
  });

  test('the label follows undo and redo', async ({ page }) => {
    await open(page);
    await chooseTimeSignature(page, '8', '8');
    await expectQuery(page, EIGHT_EIGHT);
    await expect(page.locator('#timeSigLabel')).toHaveText('8/8');
    await page.click('#undoButton');
    await expectQuery(page, START);
    await expect(page.locator('#timeSigLabel')).toHaveText('4/4');
    await page.click('#redoButton');
    await expectQuery(page, EIGHT_EIGHT);
    await expect(page.locator('#timeSigLabel')).toHaveText('8/8');
  });

  // Three measures with different notes in every lane. Notes in slots 12 to 15 fall outside a
  // shorter measure, and each measure has a note there.
  const LANES = {
    H: ['x-----------x---', '-x-----------x--', '--x-----------x-'],
    S: ['----O-----------', '-----O----------', '------g-------O-'],
    K: ['o---------------', '-o--------------', '--o----------o--'],
    Stickings: ['R-----------R---', '-L-----------L--', '--B-----------c-'],
    T1: ['---o------------', '----o-----------', '-----o------o---'],
    T4: ['--------o-------', '---------o------', '----------o----o'],
  };

  // The URL of the LANES groove with each measure cut or padded to the given length.
  function lanesUrl(timeSig, notes) {
    const row = (name) =>
      `&${name}=|${LANES[name].map((m) => m.slice(0, notes).padEnd(notes, '-')).join('|')}|`;
    return `?TimeSig=${timeSig}&Div=16&Tempo=80&Measures=3${row('H')}${row('S')}${row('K')}${row('T1')}${row('T4')}${row('Stickings')}`;
  }

  const ORIGINAL = lanesUrl('4/4', 16);

  for (const [top, bottom, notes, name] of [
    ['3', '4', 12, 'a shorter measure drops only its own notes past the new end'],
    ['7', '8', 14, 'a shorter measure in 7/8 drops only its own notes past the new end'],
    ['5', '4', 20, 'a longer measure keeps its notes and gets empty new slots'],
    ['8', '4', 32, 'a measure of twice the length is padded and not stretched'],
  ]) {
    test(`${top}/${bottom} on three measures: ${name}, and one undo restores the groove`, async ({
      page,
    }) => {
      await open(page, ORIGINAL);
      await expectQuery(page, ORIGINAL);
      await chooseTimeSignature(page, top, bottom);
      await expectQuery(page, lanesUrl(`${top}/${bottom}`, notes));
      await page.click('#undoButton');
      await expectQuery(page, ORIGINAL);
      await expect(page.locator('#timeSigLabel')).toHaveText('4/4');
    });
  }

  test('a refused change keeps every part of the editor as it was', async ({ page }) => {
    const messages = collectDialogs(page);
    const triplets =
      '?TimeSig=4/4&Div=12&Tempo=80&Measures=2&H=|x-----------|-x----------|&S=|------------|------------|&K=|------------|------------|';
    const edited = triplets.replace('H=|x-----', 'H=|x--x--');
    await open(page, triplets);
    await page.click('#hi-hat3');
    await expectQuery(page, edited);

    await chooseTimeSignature(page, '4', '8');
    await expect.poll(() => messages).toHaveLength(1);

    await expectQuery(page, edited);
    await expect(page.locator('#timeSigLabel')).toHaveText('4/4');
    await expect(page.locator('#divisionMenuLabel')).toHaveText('1/8 triplets');
    expect(await page.evaluate(() => window.myGrooveWriter.numberOfMeasures())).toBe(2);
    expect(await page.evaluate(() => window.myGrooveWriter.notesPerMeasure())).toBe(12);

    // The popup stays open with the refused choice, so the user can correct it.
    await expect(page.locator('#timeSigPopup')).toBeVisible();
    await expect(page.locator('#timeSigPopupTimeSigBottom')).toHaveValue('8');
    await page.click('#timeSigPopupCancel');

    // The refusal added no undo step: one undo takes back the note, a second does nothing.
    await page.click('#undoButton');
    await expectQuery(page, triplets);
    await page.click('#undoButton');
    await expectQuery(page, triplets);
  });

  test('1/8 triplets in 7/8 time are refused because of the triplets', async ({ page }) => {
    const messages = collectDialogs(page);
    const triplets = empty(12);
    await open(page, triplets);
    await chooseTimeSignature(page, '7', '8');
    await expect
      .poll(() => messages)
      .toEqual(['Triplets are disabled in 7/8 time.  Use x/4 time for triplets.']);
    await expectQuery(page, triplets);
  });

  test('after a refusal and Cancel, the popup opens on the real time signature', async ({
    page,
  }) => {
    collectDialogs(page);
    await open(page, empty(12));
    await chooseTimeSignature(page, '7', '8');
    await page.click('#timeSigPopupCancel');
    await page.click('#timeLabel');
    await expect(page.locator('#timeSigPopupTimeSigTop')).toHaveValue('4');
    await expect(page.locator('#timeSigPopupTimeSigBottom')).toHaveValue('4');
  });

  test('a time signature the popup does not list leaves its selects usable', async ({ page }) => {
    const messages = collectDialogs(page);
    const lane = '-'.repeat(64);
    await open(
      page,
      `?TimeSig=16/4&Div=16&Tempo=80&Measures=1&H=|${lane}|&S=|${lane}|&K=|${lane}|`
    );
    await page.click('#timeLabel');
    await expect(page.locator('#timeSigPopupTimeSigTop')).not.toHaveValue('');
    await page.click('#timeSigPopupCancel');
    expect(messages).toEqual([]);
  });

  test('a long single measure gets the expanded grid', async ({ page }) => {
    await open(page);
    await expect(page.locator('#musicalInput')).not.toHaveClass(/expanded/);
    await chooseTimeSignature(page, '8', '4');
    await expect(page.locator('#musicalInput')).toHaveClass(/expanded/);
  });

  test('1/8 notes in 3/16 time are refused, with the reason', async ({ page }) => {
    const messages = collectDialogs(page);
    const eighths = empty(8);
    await open(page, eighths);
    await chooseTimeSignature(page, '3', '16');
    await expect
      .poll(() => messages)
      .toEqual([
        '1/8 notes are disabled in 3/16 time.  This combination would result in a half note.',
      ]);
    await expectQuery(page, eighths);
    await expect(page.locator('#timeSigLabel')).toHaveText('4/4');
    await expect(page.locator('#timeSigPopup')).toBeVisible();
    await page.click('#timeSigPopupCancel');
    // The next edit proves that the refused time signature was never stored.
    await page.click('#hi-hat0');
    await expectQuery(page, eighths.replace('H=|-', 'H=|x'));
  });
});

// Known bugs. Each test states the correct behaviour. PR 3 removes the modifier.
test.describe('known bugs', () => {
  test('toms hide when the next loaded groove has none', async ({ page }) => {
    await open(page, `${START}&T1=|o---------------|&T4=|---o------------|`);
    await page.click('#groovesAnchor');
    await page.locator('.grooveListLI').first().click();
    // The first built-in groove is the empty 16th note groove. It has no toms.
    await expectQuery(page, START);
  });

  test('stickings hide when the next loaded groove has none', async ({ page }) => {
    await open(page, `${START}&Stickings=|R---------------|`);
    await page.click('#groovesAnchor');
    await page.locator('.grooveListLI').first().click();
    await expectQuery(page, START);
  });

  test('swing stays on a 12 note measure after load (audit item 16)', async ({ page }) => {
    // 6/8 at 1/16 notes is a 12 note measure that supports swing.
    await open(
      page,
      '?TimeSig=6/8&Div=16&Tempo=80&Measures=1&Swing=40&H=|------------|&S=|------------|&K=|------------|'
    );
    await page.click('#hi-hat0');
    await expectQuery(
      page,
      '?TimeSig=6/8&Div=16&Tempo=80&Swing=40&Measures=1&H=|x-----------|&S=|------------|&K=|------------|'
    );
  });

  test('swing stays on a 24 note measure after load (audit item 16)', async ({ page }) => {
    // 3/4 at 1/32 notes is a 24 note measure that supports swing.
    const lane = '-'.repeat(24);
    await open(
      page,
      `?TimeSig=3/4&Div=32&Tempo=80&Measures=1&Swing=40&H=|${lane}|&S=|${lane}|&K=|${lane}|`
    );
    await page.click('#hi-hat0');
    await expectQuery(
      page,
      `?TimeSig=3/4&Div=32&Tempo=80&Swing=40&Measures=1&H=|x${'-'.repeat(23)}|&S=|${lane}|&K=|${lane}|`
    );
  });

  async function choosePermutation(page, name) {
    await page.click('#permutationAnchor');
    await page.locator('#permutationContextMenu li').filter({ hasText: name }).click();
    await expect(page.locator('#PermutationOptions')).toHaveClass(/displayed/);
  }

  async function expectNoPermutation(page) {
    await expect(page.locator('#PermutationOptions')).not.toHaveClass(/displayed/);
    await expect(page.locator('#permutationAnchor')).not.toHaveClass(/buttonSelected/);
    await expect(page.locator('.kick-container').first()).toBeVisible();
  }

  test('undo clears an active permutation', async ({ page }) => {
    await open(page);
    await page.click('#hi-hat0');
    await expectQuery(page, HH0);
    await choosePermutation(page, 'Kick');
    await page.click('#undoButton');
    await expectQuery(page, START);
    await expectNoPermutation(page);
  });

  test('loading another groove clears an active permutation', async ({ page }) => {
    await open(page);
    await choosePermutation(page, 'Kick');
    await page.click('#groovesAnchor');
    await page.locator('.grooveListLI').first().click();
    await expectNoPermutation(page);
  });

  test('a bad time signature combination leaves all state unchanged (audit item 15)', async ({
    page,
  }) => {
    const messages = collectDialogs(page);
    // 1/8 triplets are not allowed with an 8th note beat.
    const triplets =
      '?TimeSig=4/4&Div=12&Tempo=80&Measures=1&H=|x-----------|&S=|------------|&K=|------------|';
    await open(page, triplets);
    await chooseTimeSignature(page, '4', '8');
    await expect
      .poll(() => messages)
      .toEqual(['Triplets are disabled in 4/8 time.  Use x/4 time for triplets.']);
    await expectQuery(page, triplets);
    await expect(page.locator('#timeSigLabel')).toHaveText('4/4');
  });

  test('on two measures, a time signature change keeps each measure in its own bar (audit item 18)', async ({
    page,
  }) => {
    await open(
      page,
      '?TimeSig=4/4&Div=8&Tempo=80&Measures=2&H=|x-------|x-------|&S=|--------|--------|&K=|--------|--------|'
    );
    await chooseTimeSignature(page, '3', '4');
    await expectQuery(
      page,
      '?TimeSig=3/4&Div=8&Tempo=80&Measures=2&H=|x-----|x-----|&S=|------|------|&K=|------|------|'
    );
  });

  test('toms 2 and 3 survive load and read back (audit item 17)', async ({ page }) => {
    const lane = (note, at) => `|${'-'.repeat(at)}${note}${'-'.repeat(15 - at)}|`;
    const withToms =
      START + `&T1=${lane('o', 0)}&T2=${lane('o', 1)}&T3=${lane('o', 2)}&T4=${lane('o', 3)}`;
    await open(page, withToms);
    await expectQuery(page, withToms);
  });

  test('toms 2 and 3 survive an edit in another lane, undo and redo', async ({ page }) => {
    const lane = (note, at) => `|${'-'.repeat(at)}${note}${'-'.repeat(15 - at)}|`;
    const toms = `&T1=${lane('o', 0)}&T2=${lane('o', 1)}&T3=${lane('o', 2)}&T4=${lane('o', 3)}`;
    const base = START + toms;
    await open(page, base);
    await expectQuery(page, base);
    await page.click('#hi-hat0');
    const edited = START.replace('&H=|----------------|', '&H=|x---------------|') + toms;
    await expectQuery(page, edited);
    await page.click('#undoButton');
    await expectQuery(page, base);
    await page.click('#redoButton');
    await expectQuery(page, edited);
  });

  test('toms 2 and 3 do not leak into the next groove', async ({ page }) => {
    const lane = (note, at) => `|${'-'.repeat(at)}${note}${'-'.repeat(15 - at)}|`;
    const withT2 = START + `&T1=${lane('o', 0)}&T2=${lane('o', 1)}&T4=${lane('-', 0)}`;
    await open(page, withT2);
    await expectQuery(page, withT2);
    const next = START + `&T1=${lane('o', 4)}&T4=${lane('o', 5)}`;
    await page.evaluate((q) => window.myGrooveWriter.loadNewGroove(q), next);
    await expectQuery(page, next);
  });

  test('toms 2 and 3 are dropped when the bar layout changes', async ({ page }) => {
    const lane = (note, at) => `|${'-'.repeat(at)}${note}${'-'.repeat(15 - at)}|`;
    const withToms =
      START + `&T1=${lane('o', 0)}&T2=${lane('o', 1)}&T3=${lane('o', 2)}&T4=${lane('-', 0)}`;
    await open(page, withToms);
    await expectQuery(page, withToms);
    await chooseDivision(page, 'subdivision_8ths');
    await expect.poll(() => query(page)).not.toContain('T2=');
    await expect.poll(() => query(page)).not.toContain('T3=');
    await page.click('#undoButton');
    await expectQuery(page, withToms);
  });

  test('Clear all notes removes toms 2 and 3, and undo brings them back', async ({ page }) => {
    const lane = (note, at) => `|${'-'.repeat(at)}${note}${'-'.repeat(15 - at)}|`;
    const withToms =
      START + `&T1=${lane('o', 0)}&T2=${lane('o', 1)}&T3=${lane('o', 2)}&T4=${lane('-', 0)}`;
    await open(page, withToms);
    await expectQuery(page, withToms);
    await page.click('#moreButton');
    await page.click('#clearAllNotesButton');
    await expect.poll(() => query(page)).not.toContain('T2=');
    await expect.poll(() => query(page)).not.toContain('T3=');
    await page.click('#undoButton');
    await expectQuery(page, withToms);
  });
});
