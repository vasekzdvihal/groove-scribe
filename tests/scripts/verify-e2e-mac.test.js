import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyReport,
  compareSnapshotDir,
  exitCodeFor,
  SKIPPED_PNGS,
} from '../../scripts/verify-e2e-mac.mjs';

describe('compareSnapshotDir', () => {
  let dir;
  const put = (name, content) => writeFileSync(join(dir, name), content);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'verify-e2e-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('passes identical SVG and MIDI files', () => {
    put('a-chromium-linux.svg', '<svg/>');
    put('a-chromium-darwin.svg', '<svg/>');
    put('a-midi-chromium-linux.txt', 'MThd');
    put('a-midi-chromium-darwin.txt', 'MThd');
    expect(compareSnapshotDir(dir)).toEqual({ compared: 2, skipped: 0, problems: [] });
  });

  it('fails when one byte differs', () => {
    put('a-chromium-linux.svg', '<svg/>');
    put('a-chromium-darwin.svg', '<svg />');
    const out = compareSnapshotDir(dir);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toContain('a-chromium-darwin.svg');
  });

  it('fails when the darwin file has no Linux baseline', () => {
    put('a-chromium-darwin.svg', '<svg/>');
    const out = compareSnapshotDir(dir);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toContain('no Linux baseline');
  });

  it('fails when a Linux baseline has no darwin file', () => {
    put('a-chromium-linux.svg', '<svg/>');
    const out = compareSnapshotDir(dir);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toContain('no darwin file');
  });

  it('skips the two named PNGs even when they differ or are missing', () => {
    expect(SKIPPED_PNGS).toHaveLength(2);
    put('home-chromium-linux.png', 'x');
    put('home-chromium-darwin.png', 'y');
    put('rock16-chromium-linux.png', 'x');
    const out = compareSnapshotDir(dir);
    expect(out).toEqual({ compared: 0, skipped: 2, problems: [] });
  });

  it('does not skip another PNG', () => {
    put('other-chromium-linux.png', 'x');
    put('other-chromium-darwin.png', 'y');
    const out = compareSnapshotDir(dir);
    expect(out.problems).toHaveLength(1);
  });
});

describe('classifyReport', () => {
  const report = (results) => ({
    suites: [
      { specs: [], suites: [{ specs: [{ file: 'a.spec.js', title: 't', tests: [{ results }] }] }] },
    ],
  });
  const missing = {
    status: 'failed',
    errors: [{ message: "A snapshot doesn't exist at /x.svg, writing actual." }],
  };

  it('does not count a missing snapshot as a failure', () => {
    expect(classifyReport(report([missing]))).toEqual({ failures: [], missingSnapshots: 1 });
  });

  it('counts any other error as a failure', () => {
    const out = classifyReport(report([{ status: 'failed', errors: [{ message: 'boom\nmore' }] }]));
    expect(out.failures).toHaveLength(1);
    expect(out.failures[0]).toContain('boom');
  });

  it('counts a timeout with no error text as a failure', () => {
    const out = classifyReport(report([{ status: 'timedOut', errors: [] }]));
    expect(out.failures).toHaveLength(1);
  });

  it('counts a test with a missing snapshot and a real error as a failure', () => {
    const out = classifyReport(
      report([{ status: 'failed', errors: [missing.errors[0], { message: 'real' }] }])
    );
    expect(out.failures).toHaveLength(1);
  });

  it('counts a global error as a failure', () => {
    expect(classifyReport({ suites: [], errors: [{ message: 'setup' }] }).failures).toHaveLength(1);
  });
});

describe('exitCodeFor', () => {
  it('passes when Playwright passed and nothing is wrong', () => {
    expect(exitCodeFor({ runStatus: 0, failures: [], problems: [] })).toBe(0);
  });

  it('passes when only missing darwin snapshots made Playwright exit non-zero', () => {
    expect(exitCodeFor({ runStatus: 1, failures: [], problems: [], missingSnapshots: 3 })).toBe(0);
  });

  it('fails on a real failure or a snapshot problem', () => {
    expect(exitCodeFor({ runStatus: 1, failures: ['x'], problems: [], missingSnapshots: 0 })).toBe(
      1
    );
    expect(exitCodeFor({ runStatus: 0, failures: [], problems: ['y'], missingSnapshots: 0 })).toBe(
      1
    );
  });

  it('fails when Playwright exited non-zero but the report shows nothing wrong', () => {
    expect(exitCodeFor({ runStatus: 1, failures: [], problems: [], missingSnapshots: 0 })).toBe(1);
    expect(exitCodeFor({ runStatus: null, failures: [], problems: [], missingSnapshots: 0 })).toBe(
      1
    );
  });
});
