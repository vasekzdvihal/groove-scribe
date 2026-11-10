// Assemble www/ from the app's runtime files. www/ is what ships: Firebase Hosting
// deploys it, Capacitor copies it into the native iOS/Android projects, and the
// Playwright suites serve it, so the tests exercise exactly what users get.
//
// www/ must contain only what the app needs at runtime, and NOT node_modules, the
// test suites, dev config, or the example/test HTML pages. We deliberately list the
// runtime assets rather than copying the repo root.
//
// Run via `npm run build:www`. Firebase `predeploy`, `cap:sync` and the Playwright
// `webServer` commands all run this script, so each one builds a fresh www/ and
// enforces checkWwwContents.

import {
  rmSync,
  mkdirSync,
  cpSync,
  existsSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(repoRoot, 'www');

// The app loads exactly one instrument, 'gunshot' (see oneTimeInitializeMidi in
// js/groove_utils.js). That file holds every drum sample and the metronome.
// MIDI.loadPlugin picks -ogg when the browser plays Ogg and -mp3 when it does not
// (Safari), so both must ship.
const SOUNDFONTS = ['soundfont/gunshot-ogg.js', 'soundfont/gunshot-mp3.js'];

// The app entry + app-wired pages, plus every asset they load.
const ITEMS = [
  'index.html',
  'profile.html',
  'GrooveEmbed.html',
  'gscribe_help.html',
  'gscribe_about.html',
  'js',
  'css',
  'MIDI.js',
  ...SOUNDFONTS,
  'images',
  'font-awesome',
  'fonts',
];

/**
 * Finds files that must not ship: .wav files, and anything in soundfont/ the app does not load.
 * @param {string} dir the assembled tree
 * @returns {string[]} one problem per file, sorted by path; empty when the tree is clean
 */
export function checkWwwContents(dir) {
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((path) => statSync(join(dir, path)).isFile())
    .sort();
  const problems = [];
  for (const path of files) {
    if (/\.wav$/i.test(path)) {
      problems.push(`${path}: .wav files must not ship`);
    } else if (path.startsWith('soundfont/') && !SOUNDFONTS.includes(path)) {
      problems.push(`${path}: the app does not load this soundfont`);
    }
  }
  return problems;
}

function main() {
  // Every listed item is a required runtime asset. Fail loudly if any is missing
  // rather than shipping a silently incomplete www/ (which would build a broken
  // mobile app that still "succeeds" in CI). Validate before touching www/.
  const missing = ITEMS.filter((item) => !existsSync(join(repoRoot, item)));
  if (missing.length > 0) {
    console.error(`build-www: missing required runtime asset(s): ${missing.join(', ')}`);
    process.exit(1);
  }

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  for (const item of ITEMS) {
    cpSync(join(repoRoot, item), join(OUT, item), { recursive: true });
  }

  const problems = checkWwwContents(OUT);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`build-www: ${problem}`);
    process.exit(1);
  }

  console.log(`Assembled www/ with ${ITEMS.length} runtime items.`);
}

// realpathSync: Node gives this module its real path, but keeps a symlinked argv[1] as typed.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main();
}
