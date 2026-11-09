import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import picomatch from 'picomatch';

const config = JSON.parse(readFileSync(join(process.cwd(), 'firebase.json'), 'utf8'));
const rules = config.hosting.headers ?? [];

/**
 * Does a Hosting `source` match a served path? The site root `/` is special:
 * the Hosting emulator matches it only against the literal source `/` and the
 * catch-all `**`, not against `**` + `/` + a name pattern (picomatch would).
 * @param {string} source
 * @param {string} servedPath
 */
function matches(source, servedPath) {
  if (servedPath === '/') return source === '/' || source === '**';
  if (source === '/') return false;
  return picomatch(source.replace(/^\//, ''))(servedPath.replace(/^\//, ''));
}

/**
 * Headers Firebase Hosting would send for a served path. Hosting applies every
 * matching `source` rule, so we merge all of them in order. Sources are globs
 * with extglob support, matched against the path without its leading slash.
 * @param {string} servedPath
 * @returns {Record<string, string>}
 */
function headersFor(servedPath) {
  const merged = {};
  for (const rule of rules) {
    if (!matches(rule.source, servedPath)) continue;
    for (const { key, value } of rule.headers) merged[key] = value;
  }
  return merged;
}

const EMBED = 'GrooveEmbed.html';
const pages = [
  '/',
  'index.html',
  '/index.html',
  'gscribe_help.html',
  'gscribe_about.html',
  'profile.html',
];

describe('Firebase Hosting security headers', () => {
  const sitewide = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };

  it.each([...pages, EMBED, '/GrooveEmbed.html'])('%s has the sitewide headers', (p) => {
    expect(headersFor(p)).toMatchObject(sitewide);
  });

  it.each(pages)('%s forbids framing by other origins', (p) => {
    expect(headersFor(p)['Content-Security-Policy']).toBe("frame-ancestors 'self'");
  });

  it.each([EMBED, `/${EMBED}`, `sub/${EMBED}`])('%s stays embeddable (no CSP)', (p) => {
    expect(headersFor(p)).not.toHaveProperty('Content-Security-Policy');
  });

  it.each(['/__/auth/iframe', '__/auth/iframe', '/__/auth/handler'])(
    '%s (Firebase Auth) gets no CSP',
    (p) => {
      expect(headersFor(p)).not.toHaveProperty('Content-Security-Policy');
    }
  );

  it('does not set Cross-Origin-Opener-Policy (breaks the Google sign-in popup)', () => {
    for (const p of [...pages, EMBED]) {
      expect(headersFor(p)).not.toHaveProperty('Cross-Origin-Opener-Policy');
    }
  });
});
