import { describe, it, expect, beforeEach, vi } from 'vitest';

let trackInput;
let lastInputWasKeyboard;

beforeEach(async () => {
  vi.resetModules();
  ({ trackInput, lastInputWasKeyboard } = await import('../js/inputModality.js'));
});

describe('inputModality', () => {
  it('starts as pointer input', () => {
    trackInput();
    expect(lastInputWasKeyboard()).toBe(false);
  });

  it('follows the last key or pointer input', () => {
    trackInput();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(lastInputWasKeyboard()).toBe(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(lastInputWasKeyboard()).toBe(false);
  });

  it('adds its listeners once, however often trackInput runs', () => {
    const add = vi.spyOn(window, 'addEventListener');
    trackInput();
    trackInput();
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
    add.mockRestore();
  });
});
