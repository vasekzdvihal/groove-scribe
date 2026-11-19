import { describe, it, expect } from 'vitest';
import * as constants from '../js/constants.js';

describe('the grid "on" colours', () => {
  // gridState.js compares the inline colour of a cell with these. The browser gives back
  // rgb(r, g, b) with one space after each comma, so a hex or a different spacing never matches.
  const names = Object.keys(constants).filter((name) => /^constant_.*_on_color_rgb$/.test(name));

  it('finds the colours', () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(names)('%s has the form the browser gives back', (name) => {
    expect(constants[name]).toMatch(/^rgb\(\d{1,3}, \d{1,3}, \d{1,3}\)$/);
  });
});
