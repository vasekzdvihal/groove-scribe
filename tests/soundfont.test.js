import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as constants from '../js/constants.js';

// MIDI.js plays each MIDI note from the sample stored under its note name in
// soundfont/gunshot-*.js. A note whose slot is an empty string plays silence, and
// nothing in the app warns about it: the Mid tom row shipped that way.

const root = process.cwd();
const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * @param {number} midi
 * @returns {string} the MIDI.js key, for example 47 -> "B2"
 */
function noteName(midi) {
  return NOTE_NAMES[midi % 12] + (Math.floor(midi / 12) - 1);
}

/**
 * @param {string} file
 * @returns {Map<string, string>} note name -> data URI ('' for an empty slot)
 */
function samples(file) {
  const text = readFileSync(join(root, 'soundfont', file), 'utf8');
  return new Map([...text.matchAll(/"([A-G]b?\d)"\s*:\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
}

const playedNotes = [
  ...new Set(
    Object.entries(constants)
      .filter(([name]) => name.startsWith('constant_OUR_MIDI_') && !name.includes('VELOCITY'))
      .map(([, value]) => /** @type {number} */ (value))
  ),
];

describe.each(['gunshot-ogg.js', 'gunshot-mp3.js'])('%s', (file) => {
  const font = samples(file);

  it.each(playedNotes)('has a sample for MIDI note %i', (note) => {
    expect(font.get(noteName(note))).toMatch(/^data:audio\/(ogg|mp3);base64,./);
  });

  it('gives the High, Mid and Floor tom three different sounds', () => {
    const toms = [
      constants.constant_OUR_MIDI_TOM1_NORMAL,
      constants.constant_OUR_MIDI_TOM2_NORMAL,
      constants.constant_OUR_MIDI_TOM4_NORMAL,
    ].map((note) => font.get(noteName(note)));
    expect(new Set(toms).size).toBe(3);
  });
});
