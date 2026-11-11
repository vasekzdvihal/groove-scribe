import { test, expect } from './fixtures.js';
import { allGrooves, grooveUrl } from './corpus.js';
import { getMidi, loadGroove, midiNotesFromDataUrl } from './helpers.js';

// Interaction tests: real clicks on the grid and the real toolbar, each step
// asserting the exact groove URL the editor writes back with history.replaceState.
// The golden master only covers URL -> output. These cover click -> URL, and they
// protect the refactor of the editor's state handling.
//
// Every test starts from a fixed URL, so a later change of the default groove
// cannot break them.

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

// Close the time signature popup with the keyboard. A mouse click leaves the pointer over
// the note grid when the popup closes, and Chromium on macOS then sends a hover event with
// the real keyboard's Ctrl state, so a Ctrl key held in another app sets a note.
async function closeTimeSigPopup(page, button) {
  await page.locator(button).press('Enter');
}

// A refused change keeps the popup open, so a refusal passes { refused: true }.
async function chooseTimeSignature(page, top, bottom, { refused = false } = {}) {
  await page.click('#timeLabel');
  await page.selectOption('#timeSigPopupTimeSigTop', top);
  await page.selectOption('#timeSigPopupTimeSigBottom', bottom);
  await closeTimeSigPopup(page, '#timeSigPopupOK');
  if (!refused) await expect(page.locator('#timeSigPopup')).toBeHidden();
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

  test('Cmd+Z and Cmd+Shift+Z undo and redo, and so do Ctrl+Z and Ctrl+Y', async ({ page }) => {
    await open(page);
    await page.click('#hi-hat0');
    await page.click('#snare4');
    await expectQuery(page, HH0_SN4);
    await page.keyboard.press('Meta+z');
    await expectQuery(page, HH0);
    await page.keyboard.press('Meta+Shift+z');
    await expectQuery(page, HH0_SN4);
    await page.keyboard.press('Control+z');
    await expectQuery(page, HH0);
    await page.keyboard.press('Control+y');
    await expectQuery(page, HH0_SN4);
    await page.keyboard.press('Meta+y');
    await expectQuery(page, HH0_SN4);
  });

  test('Cmd+Z in the title field is left to the browser and does not undo the groove', async ({
    page,
  }) => {
    await open(page);
    await page.click('#hi-hat0');
    await expectQuery(page, HH0);
    await page.click('#detailsButton');
    await page.locator('#tuneTitle').focus();
    await page.keyboard.type('abc');
    await expect(page.locator('#tuneTitle')).toHaveValue('abc');
    await page.keyboard.press('Meta+z');
    await page.keyboard.press('Control+z');
    // the groove keeps its hi-hat note
    expect(
      await page.evaluate(() => window.myGrooveWriter.grooveDataFromClickableUI().hh_array[0])
    ).toBeTruthy();
  });

  // The metronome can raise the tempo by itself. That is not an edit. Before the fix, each
  // raise added an undo step, so 40 raises pushed the user's own edits out of the history.
  test('the metronome auto speed-up does not push edits out of the undo history', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await open(page);
    await page.click('#hi-hat0');
    await page.click('#snare4');
    await page.click('#kick8');
    await expectQuery(page, HH0_SN4_K8);

    await page.evaluate(() => {
      document.getElementById('metronomeAutoSpeedupTempoIncreaseAmount').value = '1';
      document.getElementById('metronomeAutoSpeedupTempoIncreaseInterval').value = '1';
      document.getElementById('metronomeAutoSpeedUpKeepGoingForever').checked = true;
      window.myGrooveWriter.metronomeOptionsMenuPopupClick('SpeedUp');
      window.myGrooveWriter.myGrooveUtils.startMIDI_playback();
    });
    // 50 raises, each one minute apart. The history holds at most 40 steps.
    for (let i = 0; i < 50; i++) {
      await page.clock.fastForward(61000);
      await page.evaluate(() => window.myGrooveWriter.metronomeAutoSpeedUpTempoUpdate());
    }
    await page.clock.fastForward(1000);
    expect(
      await page.evaluate(() => window.myGrooveWriter.myGrooveUtils.getTempo())
    ).toBeGreaterThan(120);

    // Undo takes back the user's three edits one by one, down to the start. The first undo
    // also takes back the tempo, because the newest step carried it.
    for (const expected of [HH0_SN4, HH0, START]) {
      await page.evaluate(() => window.myGrooveWriter.undoCommand());
      await expectQuery(page, expected);
    }
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

test.describe('save ABC', () => {
  test('a non-Latin title downloads as title.abc with the ABC text in UTF-8', async ({ page }) => {
    await open(page, HH0 + '&Debug=1'); // the ABC panel is part of the debug view
    await page.click('#detailsButton');
    await page.locator('#tuneTitle').fill('Český rock 🥁');
    await page.locator('#tuneTitle').blur();
    await page.click('#showHideABC');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('text=Save ABC to file'),
    ]);
    expect(download.suggestedFilename()).toBe('Český rock 🥁.abc');
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString('utf8');
    expect(text).toContain('Český rock 🥁');
    expect(text).toContain('\r\n');
  });

  test('an untitled groove downloads as notation.abc', async ({ page }) => {
    await open(page, HH0 + '&Debug=1'); // the ABC panel is part of the debug view
    await page.click('#showHideABC');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('text=Save ABC to file'),
    ]);
    expect(download.suggestedFilename()).toBe('notation.abc');
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
    await closeTimeSigPopup(page, '#timeSigPopupCancel');
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

    await chooseTimeSignature(page, '4', '8', { refused: true });
    await expect.poll(() => messages).toHaveLength(1);

    await expectQuery(page, edited);
    await expect(page.locator('#timeSigLabel')).toHaveText('4/4');
    await expect(page.locator('#divisionMenuLabel')).toHaveText('1/8 triplets');
    expect(await page.evaluate(() => window.myGrooveWriter.numberOfMeasures())).toBe(2);
    expect(await page.evaluate(() => window.myGrooveWriter.notesPerMeasure())).toBe(12);

    // The popup stays open with the refused choice, so the user can correct it.
    await expect(page.locator('#timeSigPopup')).toBeVisible();
    await expect(page.locator('#timeSigPopupTimeSigBottom')).toHaveValue('8');
    await closeTimeSigPopup(page, '#timeSigPopupCancel');

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
    await chooseTimeSignature(page, '7', '8', { refused: true });
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
    await chooseTimeSignature(page, '7', '8', { refused: true });
    await closeTimeSigPopup(page, '#timeSigPopupCancel');
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
    await closeTimeSigPopup(page, '#timeSigPopupCancel');
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
    await chooseTimeSignature(page, '3', '16', { refused: true });
    await expect
      .poll(() => messages)
      .toEqual([
        '1/8 notes are disabled in 3/16 time.  This combination would result in a half note.',
      ]);
    await expectQuery(page, eighths);
    await expect(page.locator('#timeSigLabel')).toHaveText('4/4');
    await expect(page.locator('#timeSigPopup')).toBeVisible();
    await closeTimeSigPopup(page, '#timeSigPopupCancel');
    // The next edit proves that the refused time signature was never stored.
    await page.click('#hi-hat0');
    await expectQuery(page, eighths.replace('H=|-', 'H=|x'));
  });
});

test.describe('editor state regressions', () => {
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
    await chooseTimeSignature(page, '4', '8', { refused: true });
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

test.describe('toms 2 and 3 play and show', () => {
  const T1 = 48;
  const T2 = 47;
  const T3 = 45;
  const T4 = 43;
  const lane = (note, at) => `|${'-'.repeat(at)}${note}${'-'.repeat(15 - at)}|`;
  const allFour = `&T1=${lane('o', 0)}&T2=${lane('o', 1)}&T3=${lane('o', 2)}&T4=${lane('o', 3)}`;

  // The MIDI the Play button sends to the player: the URL given to loadMIDIFromURL.
  async function midiFromPlayButton(page) {
    await page.evaluate(() => {
      const gu = window.myGrooveWriter.myGrooveUtils;
      const realLoad = gu.loadMIDIFromURL;
      window.playedMidi = [];
      gu.loadMIDIFromURL = function (url) {
        window.playedMidi.push(url);
        return realLoad.call(this, url);
      };
    });
    // The button gets its click handler when the soundfont has loaded.
    await expect(page.locator('[id^="midiPlayImage"]')).toHaveClass(/Stopped/, { timeout: 15000 });
    await page.click('[id^="midiPlayImage"]');
    await expect
      .poll(() => page.evaluate(() => window.playedMidi.length), { timeout: 15000 })
      .toBeGreaterThan(0);
    const url = await page.evaluate(() => window.playedMidi[0]);
    await page.evaluate(() => window.myGrooveWriter.myGrooveUtils.stopMIDI_playback());
    return url;
  }

  // The MIDI file behind the "Download MIDI file" menu item.
  async function midiFromSaveMenu(page) {
    await page.click('#moreButton');
    await page.click('#downloadButton');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      // The click starts a data: navigation that ends as a download, so do not wait for it.
      page
        .locator('#downloadContextMenu li', { hasText: 'Download MIDI file' })
        .click({ noWaitAfter: true }),
    ]);
    return download.url(); // MIDISaveAs navigates to this data: URL
  }

  const notesOf = (dataUrl) => midiNotesFromDataUrl(dataUrl).map((n) => n.note);

  // The note heads of the rendered sheet music, as their distinct heights and their count.
  async function noteHeads(page) {
    return page.evaluate(() => {
      const heads = [...document.querySelectorAll('#svgTarget use')].filter(
        (use) => use.getAttribute('xlink:href') === '#hd'
      );
      return {
        count: heads.length,
        heights: new Set(heads.map((use) => use.getAttribute('y'))).size,
      };
    });
  }

  test('the Play button sends notes for all four toms', async ({ page }) => {
    await open(page, START + allFour);
    const notes = notesOf(await midiFromPlayButton(page));
    expect(notes).toEqual(expect.arrayContaining([T1, T2, T3, T4]));
  });

  test('the Play button sends the MIDI of the golden master', async ({ page }) => {
    await open(page, allGrooves.find((g) => g.name.includes('all four voices')).url);
    const golden = await getMidi(page);
    const played = await midiFromPlayButton(page);
    expect(midiNotesFromDataUrl(played)).toEqual(midiNotesFromDataUrl(golden));
    expect(played).toBe(golden);
  });

  test('the saved MIDI file holds notes for all four toms', async ({ page }) => {
    await open(page, START + allFour);
    const notes = notesOf(await midiFromSaveMenu(page));
    expect(notes).toEqual(expect.arrayContaining([T1, T2, T3, T4]));
  });

  test('the sheet music draws all four toms', async ({ page }) => {
    await open(page, START + allFour);
    await expect.poll(() => noteHeads(page)).toEqual({ count: 4, heights: 4 });
  });

  // Each kept tom shares a position with a grid tom, so its tick must equal the grid tom's.
  for (const { name, div, slot, at } of [
    { name: '1/8 notes', div: 8, slot: 8, at: [3, 1] },
    { name: '1/8 triplets', div: 12, slot: 12, at: [5, 7] },
  ]) {
    test(`on ${name}, toms 2 and 3 play in the right place of every measure`, async ({ page }) => {
      const row = (measure, index) =>
        Array.from({ length: 2 }, (_, m) =>
          '-'
            .repeat(index)
            .padEnd(slot, '-')
            .split('')
            .map((c, i) => (m === measure && i === index ? 'o' : c))
            .join('')
        ).join('|');
      const q =
        `?TimeSig=4/4&Div=${div}&Tempo=80&Measures=2` +
        `&H=|${row(9, 0)}|&S=|${row(9, 0)}|&K=|${row(9, 0)}|` +
        `&T1=|${row(1, at[1])}|&T2=|${row(1, at[1])}|&T3=|${row(0, at[0])}|&T4=|${row(0, at[0])}|`;
      await open(page, q);
      const notes = midiNotesFromDataUrl(await midiFromPlayButton(page));
      const tickOf = (note) => notes.find((n) => n.note === note)?.tick;
      expect(tickOf(T2)).toBeDefined();
      expect(tickOf(T3)).toBeDefined();
      expect(tickOf(T2)).toBe(tickOf(T1));
      expect(tickOf(T3)).toBe(tickOf(T4));
    });
  }

  test('hidden toms 2 and 3 stay silent like toms 1 and 4, and come back when shown', async ({
    page,
  }) => {
    await open(page, START + allFour);
    await expect.poll(() => noteHeads(page)).toEqual({ count: 4, heights: 4 });
    await page.click('#showHideTomsButton');
    await expect.poll(() => noteHeads(page)).toEqual({ count: 0, heights: 0 });
    const silent = notesOf(await midiFromPlayButton(page));
    for (const tom of [T1, T2, T3, T4]) expect(silent).not.toContain(tom);
    await page.click('#showHideTomsButton');
    await expect.poll(() => noteHeads(page)).toEqual({ count: 4, heights: 4 });
  });

  test('a groove with notes only on toms 2 or 3 asks before switching to triplets', async ({
    page,
  }) => {
    const messages = [];
    page.on('dialog', (dialog) => {
      messages.push(dialog.message());
      dialog.dismiss();
    });
    const onlyT2 = START + `&T2=${lane('o', 1)}`;
    await open(page, onlyT2);
    await chooseDivision(page, 'subdivision_12ths');
    await expect.poll(() => messages).toHaveLength(1);
    await expect(page.locator('#divisionMenuLabel')).toHaveText('1/16 notes');
  });
});
