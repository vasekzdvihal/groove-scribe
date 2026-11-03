import { describe, it, expect } from 'vitest';
import { resolveCloudConfig } from '../../js/cloud/firebaseClient.js';

const REAL = { projectId: 'real' };

describe('resolveCloudConfig', () => {
  it('returns null when no project is connected', () => {
    expect(resolveCloudConfig({ hostname: 'example.com', search: '' }, null)).toBeNull();
  });

  it('uses the real project by default', () => {
    expect(resolveCloudConfig({ hostname: 'localhost', search: '' }, REAL)).toEqual({
      useEmulator: false,
      config: REAL,
    });
  });

  it('uses the emulator on localhost with ?emulator=1', () => {
    const result = resolveCloudConfig({ hostname: '127.0.0.1', search: '?emulator=1' }, REAL);
    expect(result.useEmulator).toBe(true);
    expect(result.config.projectId).toBe('demo-groovescribe');
  });

  it('ignores ?emulator=1 on a public host', () => {
    expect(resolveCloudConfig({ hostname: 'example.com', search: '?emulator=1' }, REAL)).toEqual({
      useEmulator: false,
      config: REAL,
    });
  });
});
