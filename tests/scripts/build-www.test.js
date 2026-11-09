import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkWwwContents } from '../../scripts/build-www.mjs';

describe('checkWwwContents', () => {
  let dir;
  const put = (path) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), 'x');
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'build-www-'));
    put('index.html');
    put('js/main.js');
    put('soundfont/gunshot-ogg.js');
    put('soundfont/gunshot-mp3.js');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('passes a tree with only the soundfonts the app loads', () => {
    expect(checkWwwContents(dir)).toEqual([]);
  });

  it('fails a tree with a .wav file, in any folder and in any letter case', () => {
    put('images/click.wav');
    put('css/Kick.WAV');
    expect(checkWwwContents(dir)).toEqual([
      'css/Kick.WAV: .wav files must not ship',
      'images/click.wav: .wav files must not ship',
    ]);
  });

  it('fails a tree with a soundfont the app does not load', () => {
    put('soundfont/acoustic_grand_piano-ogg.js');
    expect(checkWwwContents(dir)).toEqual([
      'soundfont/acoustic_grand_piano-ogg.js: the app does not load this soundfont',
    ]);
  });

  it('fails every file below the soundfont folder that the app does not load', () => {
    put('soundfont/NewDrumSamples/OGG/Kick.ogg');
    expect(checkWwwContents(dir)).toEqual([
      'soundfont/NewDrumSamples/OGG/Kick.ogg: the app does not load this soundfont',
    ]);
  });

  it('reports a .wav below the soundfont folder once', () => {
    put('soundfont/NewDrumSamples/WAV (Orig)/Kick.wav');
    expect(checkWwwContents(dir)).toEqual([
      'soundfont/NewDrumSamples/WAV (Orig)/Kick.wav: .wav files must not ship',
    ]);
  });
});
