import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// One set of colour tokens for the editor, the panel, the dialogs, the pages and the embed. They
// live in css/tokens.css, and every page loads that file first.

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

// share-button.min.css is vendored.
const SKIP = new Set(['share-button.min.css']);
const CSS_FILES = readdirSync(join(root, 'css'))
  .filter((name) => name.endsWith('.css') && !SKIP.has(name))
  .map((name) => `css/${name}`);

const TOKENS = {
  '--accent': '#1f73a8',
  '--accent-hover': '#1a6493',
  '--accent-active': '#155780',
  '--accent-text': '#ffffff',
  '--accent-shade': 'rgba(31, 115, 168, 0.09)',
  '--surface-1': '#222a2f',
  '--surface-2': '#2a3238',
  '--surface-header': '#243640',
  '--text': '#eef2f4',
  '--text-dim': '#b4c0c7',
  '--line': '#46525a',
  '--danger': '#a8261a',
  '--danger-text': '#f08a8a',
  '--radius': '6px',
};

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A definition of the token, not a use and not a longer name: "--text:" but not "--text-dim:".
const definition = (name) => new RegExp(`(^|[\\s;{])${escape(name)}\\s*:\\s*([^;]+);`, 'g');

describe('the colour tokens', () => {
  it('finds the stylesheets', () => {
    expect(CSS_FILES).toContain('css/editor-toolbars.css');
    expect(CSS_FILES).toContain('css/tokens.css');
  });

  it('uses no retired blue', () => {
    const retired = /#(2d97da|68c2ff|63b1e6|1b6fa8|005483|14689d)\b/i;
    const found = CSS_FILES.filter((file) => retired.test(read(file)));
    expect(found).toEqual([]);
  });

  it('defines no panel, dialog or bar colour variables', () => {
    const old =
      /--(lp|dd)-[a-z-]+\s*:|--bar-(text|dim|tools-bg|playback-bg|line|selected|danger|bg)\s*:/;
    const found = CSS_FILES.filter((file) => old.test(read(file)));
    expect(found).toEqual([]);
  });

  it('defines every token once, in tokens.css', () => {
    const tokens = read('css/tokens.css');
    for (const [name, value] of Object.entries(TOKENS)) {
      const values = [...tokens.matchAll(definition(name))].map((match) => match[2].trim());
      expect(values, name).toEqual([value]);
      const elsewhere = CSS_FILES.filter(
        (file) => file !== 'css/tokens.css' && definition(name).test(read(file))
      );
      expect(elsewhere, name).toEqual([]);
    }
  });

  it('gives white text a contrast of 4.5:1 or more on every accent', () => {
    const luminance = (hex) => {
      const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const [r, g, b] = channels.map((c) =>
        c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      );
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const name of ['--accent', '--accent-hover', '--accent-active', '--danger']) {
      expect(1.05 / (luminance(TOKENS[name]) + 0.05), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('loads tokens.css before any other app stylesheet', () => {
    for (const page of ['index.html', 'gscribe_help.html', 'gscribe_about.html']) {
      const links = [...read(page).matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)]
        .map((match) => /href="([^"]+)"/.exec(match[0])?.[1])
        .filter((href) => href?.startsWith('css/'));
      expect(links[0], page).toBe('css/tokens.css');
    }
    const embed = read('js/groove_display.js');
    const tokens = embed.indexOf("'../css/tokens.css'");
    expect(tokens).toBeGreaterThan(-1);
    expect(tokens).toBeLessThan(embed.indexOf("'../css/groove_display.css'"));
  });
});
