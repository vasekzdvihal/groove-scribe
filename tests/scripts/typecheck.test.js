import { describe, it, expect } from 'vitest';
import { compareToBaseline, countErrorsByFile } from '../../scripts/typecheck.mjs';

describe('compareToBaseline', () => {
  const baseline = { 'js/a.js': 3, 'js/b.js': 1 };

  it('reports a file whose error count went up', () => {
    const out = compareToBaseline({ 'js/a.js': 4, 'js/b.js': 1 }, baseline);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('js/a.js');
    expect(out[0]).toContain('3');
    expect(out[0]).toContain('4');
  });

  it('does not report equal counts', () => {
    expect(compareToBaseline({ ...baseline }, baseline)).toEqual([]);
  });

  it('does not report lower counts or files that are now clean', () => {
    expect(compareToBaseline({ 'js/a.js': 1 }, baseline)).toEqual([]);
  });

  it('reports a new file with errors', () => {
    const out = compareToBaseline({ ...baseline, 'js/new.js': 2 }, baseline);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('js/new.js');
  });
});

describe('countErrorsByFile', () => {
  const root = '/repo';

  it('counts errors per repo-relative path with forward slashes', () => {
    const text = [
      "js/a.js(1,2): error TS2322: Type 'x' is not assignable.",
      '  continuation line',
      'js/a.js(5,1): error TS2304: Cannot find name.',
      'js\\b.js(1,1): error TS2322: Windows style.',
    ].join('\n');
    expect(countErrorsByFile(text, root)).toEqual({ 'js/a.js': 2, 'js/b.js': 1 });
  });

  it('makes absolute paths repo-relative', () => {
    const text = '/repo/js/a.js(1,2): error TS2322: x';
    expect(countErrorsByFile(text, root)).toEqual({ 'js/a.js': 1 });
  });

  it('files errors without a path under a global key', () => {
    expect(countErrorsByFile('error TS18003: No inputs were found.', root)).toEqual({
      '(global)': 1,
    });
  });

  it('returns an empty object for output with no errors', () => {
    expect(countErrorsByFile('', root)).toEqual({});
  });
});
