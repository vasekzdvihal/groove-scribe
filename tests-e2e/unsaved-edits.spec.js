import { test, expect } from './fixtures.js';
import { loadGroove } from './helpers.js';

// The editor asks before a groove from the Grooves tab replaces unsaved edits. The library
// panel is never opened here, so the question must work without it.

const discardDialog = (page) => page.getByRole('dialog', { name: 'Discard your changes?' });

// A docked panel stays open after a pick, so open the Grooves tab only when it is not shown.
async function pickBuiltIn(page, name) {
  const tab = page.locator('#groovesTab');
  if ((await tab.getAttribute('aria-pressed')) !== 'true') await tab.click();
  await page.locator('#grooveListWrapper .grooveListLI', { hasText: name }).first().click();
}

// The notes on the grid, to prove that an answer did not also click a note.
const notes = (page) =>
  page.evaluate(() => {
    const gd = window.myGrooveWriter.grooveDataFromClickableUI();
    return JSON.stringify([gd.hh_array, gd.snare_array, gd.kick_array, gd.toms_array]);
  });

// Answer the discard question: 'Escape', or the name of a button. The answer waits until the
// dialog is open, so a click cannot go to the grid cell under the button (#kick6 at 1280 px with
// the docked panel). Keep editing must leave the notes as they were.
async function answer(page, how) {
  const dialog = discardDialog(page);
  await expect(dialog).toHaveJSProperty('open', true);
  const before = await notes(page);
  if (how === 'Escape') await page.keyboard.press('Escape');
  else await dialog.getByRole('button', { name: how }).click();
  await expect(dialog).toBeHidden();
  if (how !== 'Discard changes') {
    expect(await notes(page), `the answer ${how} changed a note on the grid`).toBe(before);
  }
}

const tempo = (page) => page.evaluate(() => window.myGrooveWriter.myGrooveUtils.getTempo());

test('a built-in groove asks first when the groove has edits', async ({ page }) => {
  await loadGroove(page, '/index.html');
  await page.click('#snare4');
  const edited = page.url();

  await pickBuiltIn(page, 'Train Beat');
  const dialog = discardDialog(page);
  await expect(dialog.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await answer(page, 'Escape');
  expect(page.url()).toBe(edited);

  await pickBuiltIn(page, 'Train Beat');
  await answer(page, 'Keep editing');
  expect(page.url()).toBe(edited);

  await pickBuiltIn(page, 'Train Beat');
  await answer(page, 'Discard changes');
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
  await answer(page, 'Discard changes');
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
  const clean = page.url();
  await page.click('#snare4');
  // The edit must be in the address before the reload, or the reload loses it.
  await expect.poll(() => page.url()).not.toBe(clean);
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

test('after Escape focus goes back to the Grooves tab, and a tap leaves no focus ring', async ({
  page,
}) => {
  await loadGroove(page, '/index.html');
  await page.click('#snare4');
  const grooves = page.locator('#groovesTab');
  await pickBuiltIn(page, 'Train Beat');
  await answer(page, 'Escape');
  await expect(grooves).toBeFocused();

  for (const name of ['Keep editing', 'Discard changes']) {
    await page.click('#snare8');
    await pickBuiltIn(page, 'Train Beat');
    await answer(page, name);
    expect(await grooves.evaluate((node) => node.matches(':focus-visible')), name).toBe(false);
    await expect(grooves).not.toBeFocused();
  }
});

test('the Grooves tab lists the grooves and a pick loads one', async ({ page }) => {
  await loadGroove(page, '/index.html');
  const tab = page.locator('#groovesTab');
  await tab.click();
  await expect(page.locator('#sidePanelTitle')).toHaveText('Grooves');
  await expect(page.locator('#groovesPanel #grooveListWrapper .grooveListLI')).not.toHaveCount(0);

  await pickBuiltIn(page, 'Train Beat');
  await expect(page.locator('#tuneTitle')).toHaveValue('Train Beat');
  // Docked, the panel stays open, and focus is not in it, so space plays.
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  expect(
    await page.evaluate(() => document.getElementById('sidePanel').contains(document.activeElement))
  ).toBe(false);
});

test.describe('the Grooves tab on a narrow screen', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  const trainBeat = (page) =>
    page.locator('#grooveListWrapper .grooveListLI', { hasText: 'Train Beat' }).first();

  test('a pick by keyboard closes the panel, and focus goes to the tab', async ({ page }) => {
    await loadGroove(page, '/index.html');
    const tab = page.locator('#groovesTab');
    await tab.click();
    await expect(page.locator('#sidePanelClose')).toBeFocused();
    await trainBeat(page).locator('button').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#tuneTitle')).toHaveValue('Train Beat');
    await expect(page.locator('#sidePanel')).toBeHidden();
    await expect(tab).toHaveAttribute('aria-pressed', 'false');
    await expect(tab).toBeFocused();
  });

  test('a tap pick closes the panel and leaves the focus off the tab', async ({ page }) => {
    await loadGroove(page, '/index.html');
    const tab = page.locator('#groovesTab');
    await tab.click();
    await trainBeat(page).click();
    await expect(page.locator('#tuneTitle')).toHaveValue('Train Beat');
    await expect(page.locator('#sidePanel')).toBeHidden();
    await expect(tab).toHaveAttribute('aria-pressed', 'false');
    await expect(tab).not.toBeFocused();
  });
});

test('a pick with unsaved edits asks first', async ({ page }) => {
  await loadGroove(page, '/index.html');
  await page.click('#snare4');
  const edited = page.url();

  await pickBuiltIn(page, 'Train Beat');
  await answer(page, 'Keep editing');
  expect(page.url()).toBe(edited);
  await expect(page.locator('#groovesTab')).toHaveAttribute('aria-pressed', 'true');

  await pickBuiltIn(page, 'Train Beat');
  await answer(page, 'Discard changes');
  await expect(page.locator('#tuneTitle')).toHaveValue('Train Beat');
});
