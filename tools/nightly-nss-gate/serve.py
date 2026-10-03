#!/usr/bin/env python3
"""Explicit finite fixture service; preparation does not invoke this command.

Map fixture DNS to 192.0.2.10 in the isolated QA DNS handler, and forward only
that address and these announced ports to host loopback in its TCP handler.
"""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import signal
import ssl
import threading
import time


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/':
            self.send_error(404); return
        content = (self.server.fixture_dir / (self.server.case + '.html')).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers(); self.wfile.write(content)

    def log_message(self, fmt, *args):
        print(json.dumps({'case': self.server.case, 'request': fmt % args}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixtures', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--seconds', type=int, default=600)
    args = parser.parse_args()
    assert 1 <= args.seconds <= 1800
    directory = Path(args.fixtures).resolve()
    output = Path(args.out).resolve()
    task = Path('/mnt/p6/build/firefox-nightly-nss-guest-gate-prepare-20261002')
    assert directory.is_relative_to(task) and output.is_relative_to(task)
    fixture_bytes = (directory / 'fixtures.json').read_bytes()
    fixtures = json.loads(fixture_bytes)
    for name, digest in fixtures['files'].items():
        assert hashlib.sha256((directory / name).read_bytes()).hexdigest() == digest, 'fixture changed ' + name
    servers = []
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    try:
        for row in fixtures['cases']:
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            server.daemon_threads = True
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.options |= ssl.OP_NO_TICKET
            context.load_cert_chain(directory / (row['name'] + '.pem'), directory / (row['name'] + '.key'))
            server.socket = context.wrap_socket(server.socket, server_side=True)
            server.fixture_dir, server.case = directory, row['name']
            servers.append(server)
            threading.Thread(target=server.serve_forever, daemon=True).start()
        report = {'fixtureManifestSHA256': hashlib.sha256(fixture_bytes).hexdigest(),
                  'expiresAt': time.time() + args.seconds,
                  'proxyAddress': '192.0.2.10', 'proxyHost': '127.0.0.1',
                  'ports': [s.server_port for s in servers],
                  'urls': {s.case: 'https://' + fixtures['hostname'] + ':' + str(s.server_port) + '/' for s in servers}}
        output.write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report), flush=True)
        stop.wait(args.seconds)
    finally:
        for server in servers:
            server.shutdown(); server.server_close()


if __name__ == '__main__':
    main()
