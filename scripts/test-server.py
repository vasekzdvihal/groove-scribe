#!/usr/bin/env python3
"""Static server for the Playwright suites.

Usage: test-server.py PORT DIRECTORY [OVERLAY_FOLDER]

Why this is not `python3 -m http.server`:
- That server handles one request at a time. Parallel page loads, each pulling a large
  soundfont, then time out. ThreadingHTTPServer serves workers concurrently.
- Its listen backlog is 5. The editor loads about 50 files at once, so Chromium sometimes
  got a connection reset and the page never started. request_queue_size = 128 stops that.
- It binds 127.0.0.1 only, so nothing on the network can reach it.

OVERLAY_FOLDER is optional: one folder name, served from the repo root at /OVERLAY_FOLDER/.
Every other path comes only from DIRECTORY. Test-only pages can then run next to the built
site without being copied into it.
"""
import posixpath
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

REPO_ROOT = str(Path(__file__).resolve().parent.parent)


class Server(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, overlay=None, **kwargs):
        self.overlay = overlay
        super().__init__(*args, **kwargs)

    def translate_path(self, path):
        # The same cleaning as the parent's translate_path, so ".." and %2e%2e are gone
        # before the first segment is compared.
        clean = posixpath.normpath(unquote(path.split("?", 1)[0].split("#", 1)[0]))
        if self.overlay and clean.split("/")[1:2] == [self.overlay]:
            self.directory = REPO_ROOT
        return super().translate_path(path)


def main():
    if len(sys.argv) not in (3, 4):
        sys.exit("usage: test-server.py PORT DIRECTORY [OVERLAY_FOLDER]")
    port = int(sys.argv[1])
    overlay = sys.argv[3] if len(sys.argv) == 4 else None
    if overlay is not None and (overlay in ("", ".", "..") or "/" in overlay):
        sys.exit(f"test-server: OVERLAY_FOLDER must be one folder name, got {overlay!r}")
    handler = partial(Handler, directory=sys.argv[2], overlay=overlay)
    Server(("127.0.0.1", port), handler).serve_forever()


if __name__ == "__main__":
    main()
