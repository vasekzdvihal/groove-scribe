// Pass/fail e2e run for any platform: npm run test:e2e:verify
//
// Linux and Windows: runs plain `playwright test` and passes its exit code through.
//
// macOS: the golden-master baselines are Linux-only, so Playwright reports every snapshot
// test as failed ("A snapshot doesn't exist ... writing actual") and writes
// `*-chromium-darwin*` files. This script
//   1. deletes stale darwin files,
//   2. runs Playwright with a JSON report,
//   3. treats a test as failed only when it has an error other than a missing snapshot,
//   4. compares each darwin SVG/MIDI byte for byte with its Linux baseline,
//   5. deletes all darwin files, even when something failed.
// Any real failure, any difference, or any baseline without a darwin file exits non-zero.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const playwrightCli = join(repoRoot, 'node_modules/@playwright/test/cli.js');
const e2eDir = join(repoRoot, 'tests-e2e');

const DARWIN = '-chromium-darwin';
const LINUX = '-chromium-linux';

// The only two smoke PNGs that differ on a Mac (font rendering). Any other PNG is compared.
export const SKIPPED_PNGS = ['home.png', 'rock16.png'].map((name) =>
  name.replace('.png', `${LINUX}.png`)
);

const isSkipped = (linuxName) => SKIPPED_PNGS.includes(linuxName);

/**
 * Compares the darwin files in one snapshot directory with their Linux baselines.
 * @param {string} dir snapshot directory
 * @returns {{ compared: number, skipped: number, problems: string[] }}
 */
export function compareSnapshotDir(dir) {
  const names = readdirSync(dir);
  const problems = [];
  let compared = 0;
  let skipped = 0;

  const linuxNames = new Set(names.filter((n) => n.includes(LINUX)));
  const darwinNames = new Set(names.filter((n) => n.includes(DARWIN)));

  for (const linux of linuxNames) {
    const darwin = linux.replace(LINUX, DARWIN);
    if (isSkipped(linux)) {
      skipped += 1;
    } else if (!darwinNames.has(darwin)) {
      problems.push(`${join(dir, linux)}: no darwin file was written for this baseline`);
    }
  }
  for (const darwin of darwinNames) {
    const linux = darwin.replace(DARWIN, LINUX);
    if (isSkipped(linux)) continue;
    if (!linuxNames.has(linux)) {
      problems.push(`${join(dir, darwin)}: no Linux baseline to compare with`);
      continue;
    }
    compared += 1;
    if (!readFileSync(join(dir, darwin)).equals(readFileSync(join(dir, linux)))) {
      problems.push(`${join(dir, darwin)}: differs from ${linux}`);
    }
  }
  return { compared, skipped, problems };
}

const testResults = (spec) => (spec.tests ?? []).flatMap((test) => test.results ?? []);
const specResults = (suite) =>
  (suite.specs ?? []).flatMap((spec) => testResults(spec).map((result) => [spec, result]));

const MISSING_SNAPSHOT = /A snapshot doesn't exist at /;

/**
 * Reads a Playwright JSON report. A test is a real failure when it has an error that is not
 * "snapshot missing, writing actual".
 * @param {any} report parsed JSON report
 * @returns {{ failures: string[], missingSnapshots: number }}
 */
export function classifyReport(report) {
  const failures = (report.errors ?? []).map((e) => `global error: ${e.message}`);
  let missingSnapshots = 0;

  const checkResult = (spec, result) => {
    if (result.status === 'passed' || result.status === 'skipped') return;
    const errors = result.errors ?? [];
    const real = errors.filter((e) => !MISSING_SNAPSHOT.test(e.message ?? ''));
    if (errors.length > 0 && real.length === 0) {
      missingSnapshots += 1;
      return;
    }
    const reason = real[0]?.message?.split('\n')[0] ?? result.status;
    failures.push(`${spec.file} > ${spec.title}: ${result.status}: ${reason}`);
  };
  const walk = (suite) => {
    for (const [spec, result] of specResults(suite)) checkResult(spec, result);
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return { failures, missingSnapshots };
}

function snapshotDirs() {
  return readdirSync(e2eDir)
    .filter((n) => n.endsWith('-snapshots'))
    .map((n) => join(e2eDir, n));
}

function deleteDarwinFiles() {
  for (const dir of snapshotDirs()) {
    for (const name of readdirSync(dir)) {
      if (name.includes(DARWIN)) rmSync(join(dir, name), { force: true });
    }
  }
}

function playwright(args, env = {}) {
  return spawnSync(process.execPath, [playwrightCli, 'test', ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
}

function main(args) {
  if (process.platform !== 'darwin') {
    return playwright(args).status ?? 1;
  }

  const reportDir = mkdtempSync(join(tmpdir(), 'verify-e2e-'));
  const reportFile = join(reportDir, 'report.json');
  try {
    deleteDarwinFiles();
    const run = playwright(['--reporter=list,json', ...args], {
      PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
    });
    if (!existsSync(reportFile)) {
      console.error(`verify: Playwright wrote no JSON report (exit ${run.status}).`);
      return 1;
    }
    const { failures, missingSnapshots } = classifyReport(
      JSON.parse(readFileSync(reportFile, 'utf8'))
    );
    const problems = [];
    let compared = 0;
    let skipped = 0;
    for (const dir of snapshotDirs()) {
      const out = compareSnapshotDir(dir);
      compared += out.compared;
      skipped += out.skipped;
      problems.push(...out.problems);
    }
    console.log(
      `verify: ${compared} snapshots compared with Linux baselines, ${skipped} PNGs skipped, ` +
        `${missingSnapshots} tests only had a missing darwin snapshot`
    );
    for (const line of [...failures, ...problems]) console.error(`verify: ${line}`);
    return failures.length + problems.length > 0 ? 1 : 0;
  } finally {
    deleteDarwinFiles();
    rmSync(reportDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
