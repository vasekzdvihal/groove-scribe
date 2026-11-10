import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  checkWwwContents,
  precacheList,
  serviceWorkerVersion,
  writeServiceWorker,
} from '../../scripts/build-www.mjs';

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

describe('the service worker build', () => {
  let dir;
  const put = (path, content = 'x') => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'build-www-sw-'));
    for (const path of [
      'index.html',
      'js/main.js',
      'js/vendor/firebase.js',
      'css/fonts.css',
      'soundfont/gunshot-ogg.js',
      'soundfont/gunshot-mp3.js',
      'MIDI.js/js/MIDI/Plugin.js',
      'MIDI.js/inc/Base64.js',
      'font-awesome/4.7.0/css/font-awesome.min.css',
      'font-awesome/4.7.0/fonts/fontawesome-webfont.woff2',
      'fonts/lato-latin-400-normal.woff2',
      'images/metronome.svg',
      'images/apple-touch-icon.png',
    ]) {
      put(path);
    }
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('precaches the page, modules, CSS, sound, firebase.js and what the page loads', () => {
    expect(precacheList(dir)).toEqual([
      'MIDI.js/inc/Base64.js',
      'MIDI.js/js/MIDI/Plugin.js',
      'css/fonts.css',
      'font-awesome/4.7.0/css/font-awesome.min.css',
      'font-awesome/4.7.0/fonts/fontawesome-webfont.woff2',
      'fonts/lato-latin-400-normal.woff2',
      'images/apple-touch-icon.png',
      'images/metronome.svg',
      'index.html',
      'js/main.js',
      'js/vendor/firebase.js',
      'soundfont/gunshot-mp3.js',
      'soundfont/gunshot-ogg.js',
    ]);
  });

  it('picks up a new file without a list to update', () => {
    put('js/added.js');
    expect(precacheList(dir)).toContain('js/added.js');
  });

  it.each([
    'sw.js',
    'GrooveEmbed.html',
    'font-awesome/4.3.0/css/font-awesome.min.css',
    'font-awesome/4.7.0/fonts/fontawesome-webfont.ttf',
    'font-awesome/4.7.0/less/core.less',
    'MIDI.js/inc/SoundManager2/script/soundmanager2.js',
    'fonts/LATO-OFL-LICENSE.txt',
  ])('does not precache %s', (path) => {
    put(path);
    expect(precacheList(dir)).not.toContain(path);
  });

  it('changes the version when a precached file changes', () => {
    const before = serviceWorkerVersion(dir);
    expect(serviceWorkerVersion(dir)).toBe(before);
    put('js/main.js', 'changed');
    expect(serviceWorkerVersion(dir)).not.toBe(before);
  });

  it('changes the version when a precached file is added or moved', () => {
    const before = serviceWorkerVersion(dir);
    put('js/added.js');
    expect(serviceWorkerVersion(dir)).not.toBe(before);
  });

  it('keeps the version when a file outside the precache changes', () => {
    const before = serviceWorkerVersion(dir);
    put('GrooveEmbed.html', 'changed');
    expect(serviceWorkerVersion(dir)).toBe(before);
  });

  it('writes sw.js with the version and the file list', () => {
    writeServiceWorker(dir);
    const source = readFileSync(join(dir, 'sw.js'), 'utf8');
    expect(source).toContain(`'${serviceWorkerVersion(dir)}'`);
    expect(source).toContain('"js/vendor/firebase.js"');
    expect(source).not.toContain('__PRECACHE_FILES__');
    expect(source).not.toContain('__VERSION__');
  });

  it('precaches the Font Awesome font under the URL the stylesheet asks for', () => {
    writeServiceWorker(dir);
    expect(readFileSync(join(dir, 'sw.js'), 'utf8')).toContain(
      '"font-awesome/4.7.0/fonts/fontawesome-webfont.woff2?v=4.7.0"'
    );
  });

  it('leaves the assembled tree valid for the content check', () => {
    writeServiceWorker(dir);
    expect(checkWwwContents(dir)).toEqual([]);
  });
});
