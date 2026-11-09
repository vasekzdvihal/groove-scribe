#!/usr/bin/env python3
"""Static server for the Playwright suites.

Usage: test-server.py PORT DIRECTORY

Why this is not `python3 -m http.server`:
- That server handles one request at a time. Parallel page loads, each pulling a large
  soundfont, then time out. ThreadingHTTPServer serves workers concurrently.
- Its listen backlog is 5. The editor loads about 50 files at once, so Chromium sometimes
  got a connection reset and the page never started. request_queue_size = 128 stops that.
- It binds 127.0.0.1 only, so nothing on the network can reach it.
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class Server(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: test-server.py PORT DIRECTORY")
    port = int(sys.argv[1])
    handler = partial(SimpleHTTPRequestHandler, directory=sys.argv[2])
    Server(("127.0.0.1", port), handler).serve_forever()


if __name__ == "__main__":
    main()
