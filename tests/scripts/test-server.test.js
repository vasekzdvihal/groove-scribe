import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '../../scripts/test-server.py');
const OVERLAY = 'html_examples_and_tests';
const OVERLAY_PAGE = `/${OVERLAY}/GrooveMultiDisplay.html`;

function freePort() {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// node:http sends the path as written, so ".." and %2e reach the server. fetch would clean them.
function status(port, path) {
  return new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port, path }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });
}

async function startServer(dir, ...extra) {
  const port = await freePort();
  // The tests need the python3 on PATH, the same one a developer runs the server with.
  // eslint-disable-next-line sonarjs/no-os-command-from-path
  const child = spawn('python3', [SCRIPT, String(port), dir, ...extra], { stdio: 'ignore' });
  const exited = new Promise((_, reject) => {
    child.once('exit', (code) => reject(new Error(`test-server exited with code ${code}`)));
  });
  exited.catch(() => {});
  const ready = (async () => {
    for (;;) {
      try {
        await status(port, '/');
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 25));
      }
    }
  })();
  await Promise.race([ready, exited]);
  return { port, stop: () => child.kill() };
}

describe('test-server.py', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'test-server-'));
    writeFileSync(join(dir, 'served.txt'), 'x');
    mkdirSync(join(dir, `${OVERLAY}_lookalike`));
    writeFileSync(join(dir, `${OVERLAY}_lookalike/served.txt`), 'x');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  describe('with an overlay folder', () => {
    let server;
    beforeAll(async () => {
      server = await startServer(dir, OVERLAY);
    }, 10_000);
    afterAll(() => server.stop());

    it('serves the overlay folder from the repo root', async () => {
      expect(await status(server.port, OVERLAY_PAGE)).toBe(200);
    });

    it('serves every other path from the served directory', async () => {
      expect(await status(server.port, '/served.txt')).toBe(200);
      expect(await status(server.port, '/index.html')).toBe(404);
    });

    it('does not treat a folder with a longer name as the overlay', async () => {
      expect(await status(server.port, `/${OVERLAY}_lookalike/served.txt`)).toBe(200);
    });

    it.each([
      `/${OVERLAY}/../index.html`,
      `/${OVERLAY}/%2e%2e/index.html`,
      `/${OVERLAY}/..%2findex.html`,
      `/${OVERLAY}/../../../../../../../../etc/hosts`,
      `/${OVERLAY}/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/hosts`,
    ])('does not let %s leave the overlay folder', async (path) => {
      expect(await status(server.port, path)).toBe(404);
    });
  });

  describe('without an overlay folder', () => {
    let server;
    beforeAll(async () => {
      server = await startServer(dir);
    }, 10_000);
    afterAll(() => server.stop());

    it('serves nothing from the repo root', async () => {
      expect(await status(server.port, OVERLAY_PAGE)).toBe(404);
      expect(await status(server.port, '/served.txt')).toBe(200);
    });
  });

  it.each(['..', 'a/b', '/etc', ''])('refuses %j as an overlay folder name', (name) => {
    // eslint-disable-next-line sonarjs/no-os-command-from-path
    const run = spawnSync('python3', [SCRIPT, '0', dir, name], { timeout: 5000 });
    expect(run.status).not.toBe(0);
    expect(run.signal).toBeNull();
  });
});
