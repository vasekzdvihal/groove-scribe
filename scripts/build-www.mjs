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

import { createHash } from 'node:crypto';
import {
  rmSync,
  mkdirSync,
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
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

// What the service worker stores for offline use, matched against the files in www/, so a new
// module or stylesheet joins by itself. It is the editor page and everything that page loads.
// Both sound formats are included (about 470 KB together): the browser picks one at run time.
// Left out on purpose: the embed page, the old Font Awesome and its other font formats, and
// SoundManager2, which nothing loads.
const PRECACHED = [
  /^(index|profile|gscribe_help|gscribe_about)\.html$/,
  /^js\/.+\.js$/,
  /^css\/.+\.css$/,
  /^soundfont\/.+\.js$/,
  /^MIDI\.js\/(?!inc\/SoundManager2\/).+\.js$/,
  /^font-awesome\/4\.7\.0\/css\/font-awesome\.min\.css$/,
  /^font-awesome\/4\.7\.0\/fonts\/fontawesome-webfont\.woff2$/,
  /^fonts\/.+\.woff2$/,
  /^images\/.+\.(svg|png)$/,
];

// A precached file is found by its exact URL, so these must match what the stylesheet asks
// for. tests-e2e/offline.spec.js fails if the font is requested under another URL.
const PRECACHE_QUERIES = {
  'font-awesome/4.7.0/fonts/fontawesome-webfont.woff2': '?v=4.7.0',
};

const SW_TEMPLATE = join(repoRoot, 'scripts/sw-template.js');
const SW_VERSION_PLACEHOLDER = "'__VERSION__'";
const SW_FILES_PLACEHOLDER = "['__PRECACHE_FILES__']";

/**
 * @param {string} dir
 * @returns {string[]} every file under dir, as sorted relative paths
 */
function listFiles(dir) {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((path) => statSync(join(dir, path)).isFile())
    .sort();
}

/**
 * @param {string} dir the assembled tree
 * @returns {string[]} the files the service worker precaches, as sorted relative paths
 */
export function precacheList(dir) {
  return listFiles(dir).filter((path) => PRECACHED.some((pattern) => pattern.test(path)));
}

/**
 * The hash of every precached file and its URL. The template is in the hash too: a changed
 * worker then gets its own cache, so a failed install cannot delete the cache in use.
 * @param {string} dir the assembled tree
 * @param {Record<string, string>} [queries] URL queries of precached files
 * @returns {string} a short hex version
 */
export function serviceWorkerVersion(dir, queries = PRECACHE_QUERIES) {
  const hash = createHash('sha256').update(readFileSync(SW_TEMPLATE));
  for (const path of precacheList(dir)) {
    hash.update(`\0${path}${queries[path] ?? ''}\0`).update(readFileSync(join(dir, path)));
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * @param {string} version
 * @param {string[]} files URLs relative to the worker
 * @returns {string} the source of sw.js
 */
export function renderServiceWorker(version, files) {
  const template = readFileSync(SW_TEMPLATE, 'utf8');
  for (const placeholder of [SW_VERSION_PLACEHOLDER, SW_FILES_PLACEHOLDER]) {
    if (!template.includes(placeholder)) {
      throw new Error(`build-www: sw-template.js has no ${placeholder}`);
    }
  }
  return template
    .replace(SW_VERSION_PLACEHOLDER, () => `'${version}'`)
    .replace(SW_FILES_PLACEHOLDER, () => JSON.stringify(files));
}

/**
 * Writes sw.js into the assembled tree.
 * @param {string} dir the assembled tree
 */
export function writeServiceWorker(dir) {
  const urls = precacheList(dir).map((path) => path + (PRECACHE_QUERIES[path] ?? ''));
  const source = renderServiceWorker(serviceWorkerVersion(dir), urls);
  writeFileSync(join(dir, 'sw.js'), source);
}

/**
 * Finds files that must not ship: .wav files, and anything in soundfont/ the app does not load.
 * @param {string} dir the assembled tree
 * @returns {string[]} one problem per file, sorted by path; empty when the tree is clean
 */
export function checkWwwContents(dir) {
  const problems = [];
  for (const path of listFiles(dir)) {
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

  writeServiceWorker(OUT);

  console.log(`Assembled www/ with ${ITEMS.length} runtime items.`);
}

// realpathSync: Node gives this module its real path, but keeps a symlinked argv[1] as typed.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main();
}
