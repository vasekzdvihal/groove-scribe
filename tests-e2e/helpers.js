// Shared helpers for the Groove Scribe browser tests.

// Navigate to a groove URL and wait until the sheet-music SVG has rendered.
export async function loadGroove(page, url, timeout = 15000) {
  await page.goto(url, { timeout });
  await page.waitForSelector('#svgTarget svg', { timeout });
}

// The rendered sheet-music SVG markup (abc2svg output).
export function getSvg(page) {
  return page.locator('#svgTarget').innerHTML();
}

// The MIDI data URL the app would play for the current grid state.
export function getMidi(page) {
  return page.evaluate(() => {
    const gw = window.myGrooveWriter;
    return gw.myGrooveUtils.create_MIDIURLFromGrooveData(gw.grooveDataFromClickableUI());
  });
}

// A snapshot of the groove data currently represented by the clickable grid.
export function grooveData(page) {
  return page.evaluate(() => {
    const gd = window.myGrooveWriter.grooveDataFromClickableUI();
    return {
      notesPerMeasure: gd.notesPerMeasure,
      timeDivision: gd.timeDivision,
      numberOfMeasures: gd.numberOfMeasures,
      numBeats: gd.numBeats,
      noteValue: gd.noteValue,
      showToms: gd.showToms,
      showStickings: gd.showStickings,
      tempo: gd.tempo,
      hhOn: gd.hh_array.filter(Boolean).length,
      snareOn: gd.snare_array.filter(Boolean).length,
      kickOn: gd.kick_array.filter(Boolean).length,
    };
  });
}

// The note-on events of a Standard MIDI File, as { tick, note } in time order.
// Takes the data URL the editor plays or saves, so a test can read the real output.
export function midiNotesFromDataUrl(dataUrl) {
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  const notes = [];
  let at = 14; // the header chunk
  at += 8; // "MTrk" and the track length
  let tick = 0;
  const readVarLength = () => {
    let value = 0;
    let byte;
    do {
      byte = bytes[at++];
      value = value * 128 + (byte % 128);
    } while (byte >= 128);
    return value;
  };
  while (at < bytes.length) {
    tick += readVarLength();
    const status = bytes[at++];
    if (status === 0xff) {
      at += 1; // meta type
      at += readVarLength();
    } else if (status >= 0x90 && status < 0xa0) {
      if (bytes[at + 1] > 0) notes.push({ tick, note: bytes[at] });
      at += 2;
    } else if (status >= 0xc0 && status < 0xe0) {
      at += 1; // program change or channel pressure
    } else {
      at += 2; // note off and the other two-byte channel events
    }
  }
  return notes;
}
