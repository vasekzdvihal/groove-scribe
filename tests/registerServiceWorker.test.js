import { describe, it, expect } from 'vitest';
import { shouldRegister } from '../js/registerServiceWorker.js';

const at = (href) => new URL(href);

describe('shouldRegister', () => {
  it.each([
    'https://groove-scribe-zdvihal.web.app/index.html',
    'https://groove-scribe-zdvihal.web.app/',
    'https://groove-scribe-zdvihal.web.app/index.html?TimeSig=4/4',
  ])('registers on HTTPS: %s', (href) => {
    expect(shouldRegister(at(href), false)).toBe(true);
  });

  it.each(['http://localhost:8010/index.html?sw=1', 'http://localhost:8010/?TimeSig=4/4&sw=1'])(
    'registers on localhost with ?sw=1: %s',
    (href) => {
      expect(shouldRegister(at(href), false)).toBe(true);
    }
  );

  it.each([
    'http://localhost:8010/index.html',
    'http://localhost:8010/index.html?sw=0',
    'http://localhost:8010/index.html?sw=',
    'http://example.test/index.html',
    'http://example.test/index.html?sw=1',
    'http://192.168.1.20:8000/index.html?sw=1',
  ])('does not register: %s', (href) => {
    expect(shouldRegister(at(href), false)).toBe(false);
  });

  it.each([
    'https://localhost/index.html',
    'capacitor://localhost/index.html',
    'http://localhost:8010/index.html?sw=1',
  ])('never registers in Capacitor: %s', (href) => {
    expect(shouldRegister(at(href), true)).toBe(false);
  });
});
