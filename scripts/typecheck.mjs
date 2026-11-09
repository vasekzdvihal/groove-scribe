// Type-check gate: runs `tsc --noEmit` and compares per-file error counts with
// scripts/typecheck-baseline.json. A file with more errors than its baseline, or a file
// that is not in the baseline, fails the run. Fewer errors pass.
//
// After you fix errors, lower the baseline with: npm run typecheck -- --update
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(repoRoot, 'scripts/typecheck-baseline.json');

// tsc prints `path(line,col): error TSnnnn: message`. Errors with no file print
// `error TSnnnn: message`. Keys are repo-relative with forward slashes, on every OS.
const ERROR_LINE = /^(?:(.+?)\(\d+,\d+\): )?error TS\d+: /;

/**
 * @param {string} text tsc output
 * @param {string} root repo root used to make absolute paths relative
 * @returns {Record<string, number>}
 */
export function countErrorsByFile(text, root) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const line of text.split(/\r?\n/)) {
    const match = ERROR_LINE.exec(line);
    if (!match) continue;
    let file = match[1];
    if (file === undefined) {
      file = '(global)';
    } else {
      if (isAbsolute(file)) file = relative(root, file);
      file = file.replaceAll('\\', '/');
    }
    counts[file] = (counts[file] ?? 0) + 1;
  }
  return counts;
}

/**
 * @param {Record<string, number>} current
 * @param {Record<string, number>} baseline
 * @returns {string[]} one message per file that has more errors than its baseline
 */
export function compareToBaseline(current, baseline) {
  return Object.entries(current)
    .filter(([file, count]) => count > (baseline[file] ?? 0))
    .map(([file, count]) => `${file}: ${count} errors, baseline ${baseline[file] ?? 0}`);
}

function main() {
  const tsc = join(repoRoot, 'node_modules/typescript/bin/tsc');
  const run = spawnSync(process.execPath, [tsc, '--noEmit', '--pretty', 'false'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error || run.status === null) {
    const reason = run.error?.message ?? `signal ${run.signal}`;
    console.error(`typecheck: tsc could not run: ${reason}`);
    return 1;
  }
  const current = countErrorsByFile(run.stdout + run.stderr, repoRoot);
  const total = Object.values(current).reduce((sum, n) => sum + n, 0);
  if (run.status !== 0 && total === 0) {
    console.error(`typecheck: tsc exited ${run.status} with no parsable errors:`);
    console.error(run.stdout + run.stderr);
    return 1;
  }
  if (process.argv.includes('--update')) {
    const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => (a < b ? -1 : 1)));
    writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(
      `typecheck: baseline written, ${total} errors in ${Object.keys(sorted).length} files`
    );
    return 0;
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const regressions = compareToBaseline(current, baseline);
  if (regressions.length > 0) {
    console.error('typecheck: new type errors compared with scripts/typecheck-baseline.json:');
    for (const message of regressions) console.error(`  ${message}`);
    return 1;
  }
  console.log(`typecheck: ${total} errors, none new compared with the baseline`);
  return 0;
}

// realpathSync: Node gives this module its real path, but keeps a symlinked argv[1] as typed.
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exitCode = main();
}
