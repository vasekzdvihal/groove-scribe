import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(process.cwd(), '.github', 'workflows');
const files = readdirSync(dir).filter((name) => /\.ya?ml$/.test(name));

/**
 * Every `uses:` value in a workflow file.
 * @param {string} text
 * @returns {string[]}
 */
function usesValues(text) {
  return [...text.matchAll(/^[ \t]*(?:-[ \t]+)?uses:[ \t]*(\S+)/gm)].map((match) => match[1]);
}

describe('workflow actions', () => {
  it('finds workflow files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const name of files) {
    it(`${name} pins every action to a 40-character commit SHA`, () => {
      const unpinned = usesValues(readFileSync(join(dir, name), 'utf8')).filter(
        (value) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(value)
      );
      expect(unpinned).toEqual([]);
    });
  }
});
