import { test, expect } from './fixtures.js';
import { loadGroove } from './helpers.js';

// The editor asks before a groove from the Grooves menu replaces unsaved edits. The library
// panel is never opened here, so the question must work without it.

const discardDialog = (page) => page.getByRole('dialog', { name: 'Discard your changes?' });

async function pickBuiltIn(page, name) {
  await page.click('#groovesAnchor');
  await page.locator('#grooveListWrapper .grooveListLI', { hasText: name }).first().click();
}

const tempo = (page) => page.evaluate(() => window.myGrooveWriter.myGrooveUtils.getTempo());

test('a built-in groove asks first when the groove has edits', async ({ page }) => {
  await loadGroove(page, '/index.html');
  await page.click('#snare4');
  const edited = page.url();

  await pickBuiltIn(page, 'Train Beat');
  const dialog = discardDialog(page);
  await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(page.url()).toBe(edited);

  await pickBuiltIn(page, 'Train Beat');
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog).toBeHidden();
  expect(page.url()).toBe(edited);

  await pickBuiltIn(page, 'Train Beat');
  await dialog.getByRole('button', { name: 'Discard changes' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#tuneTitle')).toHaveValue('Train Beat');
});

test('a built-in groove loads without a question when nothing is edited', async ({ page }) => {
  await loadGroove(page, '/index.html');
  await pickBuiltIn(page, 'Train Beat');
  await expect(page.locator('#tuneTitle')).toHaveValue('Train Beat');
  await expect(discardDialog(page)).toBeHidden();
});

test('a loaded built-in groove is clean', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type());
    dialog.accept();
  });
  await loadGroove(page, '/index.html');
  await page.click('#snare4');
  await pickBuiltIn(page, 'Train Beat');
  await discardDialog(page).getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.locator('#tuneTitle')).toHaveValue('Train Beat');

  await pickBuiltIn(page, 'Jazz Shuffle');
  await expect(page.locator('#tuneTitle')).toHaveValue('Jazz Shuffle');
  await expect(discardDialog(page)).toBeHidden();
  await loadGroove(page, '/index.html');
  expect(dialogs).toEqual([]);
});

// Every edit is in the address. The tab keeps its clean groove, so a reload, or iPad Safari
// bringing back a tab it dropped, does not count the edits as clean.
test('a reload keeps the edits unsaved, and the Grooves menu still asks', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await loadGroove(page, '/index.html');
  await page.click('#snare4');
  await page.reload();
  await page.waitForSelector('#svgTarget svg');
  await pickBuiltIn(page, 'Train Beat');
  await expect(discardDialog(page)).toBeVisible();
});

test('a new link opened in the same tab is clean', async ({ page }) => {
  page.on('dialog', (dialog) => dialog.accept());
  await loadGroove(page, '/index.html');
  await page.click('#snare4');
  await loadGroove(
    page,
    '/index.html?TimeSig=4/4&Div=8&Title=Rock&Tempo=100&Measures=1&H=|xxxxxxxx|&S=|--O---O-|&K=|o---o---|'
  );
  await pickBuiltIn(page, 'Train Beat');
  await expect(page.locator('#tuneTitle')).toHaveValue('Train Beat');
  await expect(discardDialog(page)).toBeHidden();
});

// The metronome can raise the tempo by itself. That is not an edit.
test('a tempo that the metronome raised is not an edit', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.type());
    dialog.accept();
  });
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await loadGroove(page, '/index.html');
  // Playback needs the sound to be ready.
  await page.waitForFunction(() => Boolean(window.MIDI?.Player?.ctx));
  await page.evaluate(() => {
    document.getElementById('metronomeAutoSpeedupTempoIncreaseAmount').value = '1';
    document.getElementById('metronomeAutoSpeedupTempoIncreaseInterval').value = '1';
    window.myGrooveWriter.metronomeOptionsMenuPopupClick('SpeedUp');
    window.myGrooveWriter.myGrooveUtils.startMIDI_playback();
    window.myGrooveWriter.metronomeAutoSpeedUpTempoUpdate(); // the timing baseline
  });
  const start = await tempo(page);
  await page.clock.fastForward(61000);
  await page.evaluate(() => window.myGrooveWriter.metronomeAutoSpeedUpTempoUpdate());
  expect(await tempo(page)).toBeGreaterThan(start);
  await page.evaluate(() => window.myGrooveWriter.myGrooveUtils.stopMIDI_playback());

  await pickBuiltIn(page, 'Train Beat');
  await expect(page.locator('#tuneTitle')).toHaveValue('Train Beat');
  await expect(discardDialog(page)).toBeHidden();
  await loadGroove(page, '/index.html');
  expect(dialogs).toEqual([]);
});

// A page with a beforeunload listener cannot go into the back-forward cache of Firefox, so the
// listener is there only while the page has edits.
test('the leave warning is listening only while the groove has edits', async ({ page }) => {
  await loadGroove(page, '/index.html');
  const client = await page.context().newCDPSession(page);
  const listeners = async () => {
    const { result } = await client.send('Runtime.evaluate', { expression: 'window' });
    const { listeners: all } = await client.send('DOMDebugger.getEventListeners', {
      objectId: result.objectId,
    });
    return all.filter((listener) => listener.type === 'beforeunload').length;
  };
  expect(await listeners()).toBe(0);
  await page.click('#snare4');
  await expect.poll(listeners).toBe(1);
  await page.click('#undoButton');
  await expect.poll(listeners).toBe(0);
});

test('after Keep editing, focus goes back to the Grooves button', async ({ page }) => {
  await loadGroove(page, '/index.html');
  await page.click('#snare4');
  for (const answer of ['Escape', 'button']) {
    await pickBuiltIn(page, 'Train Beat');
    const dialog = discardDialog(page);
    if (answer === 'Escape') await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: 'Keep editing' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#groovesAnchor')).toBeFocused();
  }
});
