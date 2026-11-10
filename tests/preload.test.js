import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// index.html preloads the modules that main.js pulls in, so the browser fetches them in
// parallel instead of one import level after another. A renamed file must not leave a
// preload that returns 404, and a new import must not leave the chain half preloaded.

const root = process.cwd();
const html = readFileSync(join(root, 'index.html'), 'utf8');

/**
 * @param {string} text
 * @returns {string[]} the href of every modulepreload link
 */
function preloaded(text) {
  return [...text.matchAll(/<link\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => /rel=["']modulepreload["']/.test(tag))
    .map((tag) => /href=["']([^"']+)["']/.exec(tag)?.[1])
    .filter(Boolean)
    .map((href) => href.replace(/^\.\//, ''));
}

/**
 * Static imports of a module, as repo-relative paths. Dynamic import() is skipped on
 * purpose: the Firebase SDK loads only when the library panel connects.
 * @param {string} file repo-relative path
 * @returns {string[]}
 */
function staticImports(file) {
  const text = readFileSync(join(root, file), 'utf8');
  return [...text.matchAll(/^(?:import|export)\s[^;]*?from\s*'(\.[^']+)'/gms)].map((match) =>
    join(dirname(file), match[1])
  );
}

/** @returns {Set<string>} main.js and everything it imports statically */
function mainChain() {
  const seen = new Set();
  const queue = ['js/main.js'];
  while (queue.length) {
    const file = /** @type {string} */ (queue.pop());
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...staticImports(file));
  }
  return seen;
}

describe('modulepreload in index.html', () => {
  const listed = preloaded(html);

  it('lists some files', () => {
    expect(listed.length).toBeGreaterThan(5);
  });

  it('lists only files that exist', () => {
    expect(listed.filter((file) => !existsSync(join(root, file)))).toEqual([]);
  });

  it('lists every module of the main chain, and nothing else', () => {
    expect([...listed].sort()).toEqual([...mainChain()].sort());
  });

  it('does not list the Firebase SDK', () => {
    expect(listed.filter((file) => file.includes('vendor/'))).toEqual([]);
  });
});
