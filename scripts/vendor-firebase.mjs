// Rebuild js/vendor/firebase.js from the pinned `firebase` npm package.
// Run with `npm run vendor:firebase` after a Firebase version bump.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [join(repoRoot, 'scripts/firebase-entry.js')],
  outfile: join(repoRoot, 'js/vendor/firebase.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2021',
  minify: true,
  legalComments: 'inline',
});
