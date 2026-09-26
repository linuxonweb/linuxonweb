#!/usr/bin/env python3
"""Run a finite, file-based WebGL2 shader gate; no persistent service."""
import argparse
import hashlib
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import subprocess

from importlib.util import module_from_spec, spec_from_file_location

HERE = Path(__file__).resolve().parent
SPEC = spec_from_file_location('fixture_storage', HERE / 'prepare-fixtures.py')
STORAGE = module_from_spec(SPEC)
SPEC.loader.exec_module(STORAGE)
TASK = STORAGE.TASK


def sha(data):
    return hashlib.sha256(data).hexdigest()


class ResultParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inside = False
        self.text = ''

    def handle_starttag(self, tag, attrs):
        if tag == 'pre' and dict(attrs).get('id') == 'result':
            self.inside = True

    def handle_endtag(self, tag):
        if tag == 'pre':
            self.inside = False

    def handle_data(self, data):
        if self.inside:
            self.text += data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--base', type=Path, default=TASK / 'translator-check-run2/result.json')
    parser.add_argument('--coordinates', type=Path, default=TASK / 'coordinate-check-run1/result.json')
    parser.add_argument('--chromium', type=Path, default=Path('/home/a/.local/archpkg/pacman/usr/bin/chromium'))
    args = parser.parse_args()
    out = args.output.resolve()
    STORAGE.disk(out)
    for key in ('TMPDIR', 'TMP', 'TEMP'):
        scratch = Path(os.environ[key])
        if not scratch.is_dir():
            raise ValueError('scratch directory missing')
        STORAGE.disk(scratch)
    out.mkdir(parents=True, exist_ok=False)
    inputs = {}

    def frozen(path):
        path = path.resolve()
        data = path.read_bytes()
        inputs[str(path)] = sha(data)
        return data

    for name in ('run-coordinate-browser.py', 'prepare-fixtures.py', 'coordinate-browser.js'):
        (out / name).write_bytes(frozen(HERE / name))
    STORAGE.disk(args.base)
    STORAGE.disk(args.coordinates)
    base = json.loads(frozen(args.base))
    coordinates = json.loads(frozen(args.coordinates))
    if not base['pass'] or not coordinates['pass'] or base['artifactSha256'] != coordinates['artifactSha256']:
        raise ValueError('translator acceptance reports differ or failed')
    shaders = {}
    for name in ('pair-a.vert', 'pair-b.vert', 'pair-a.frag', 'pair-b.frag'):
        item = base['outputs'][name]
        path = Path(item['glslPath'])
        STORAGE.disk(path)
        data = frozen(path)
        if sha(data) != item['glslSha256']:
            raise ValueError('emitted base shader changed')
        shaders[name] = data.decode()
    for name in ('clip-negative.vert', 'clip-far.vert', 'perspective.vert'):
        item = coordinates['results'][name]
        path = Path(item['path'])
        STORAGE.disk(path)
        data = frozen(path)
        if item['rejected'] or sha(data) != item['glslSha256']:
            raise ValueError('emitted coordinate shader changed')
        shaders[name] = data.decode()
    harness = (out / 'coordinate-browser.js').read_text()
    page = ('<!doctype html><meta charset="utf-8"><title>WEBGL_COORDINATE_RUNNING</title>'
            '<canvas id="target" width="73" height="51"></canvas><pre id="result">pending</pre>'
            '<script>const SHADERS=' + json.dumps(shaders).replace('<', '\\u003c') + ';\n' + harness + '</script>')
    (out / 'index.html').write_text(page)
    env = dict(os.environ, XDG_CACHE_HOME=str(out / 'xdg-cache'))
    command = [str(args.chromium), '--headless', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
               '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
               '--user-data-dir=' + str(out / 'browser-profile'), '--disk-cache-dir=' + str(out / 'browser-cache'),
               '--dump-dom', (out / 'index.html').as_uri()]
    (out / 'command.json').write_text(json.dumps(command, indent=2) + '\n')
    (out / 'inputs-before.json').write_text(json.dumps(inputs, indent=2) + '\n')
    with (out / 'browser-dom.html').open('w') as stdout, (out / 'browser.log').open('w') as stderr:
        subprocess.run(command, env=env, stdout=stdout, stderr=stderr, check=True, timeout=45)
    parsed = ResultParser()
    parsed.feed((out / 'browser-dom.html').read_text())
    report = json.loads(parsed.text)
    current = {path: sha(Path(path).read_bytes()) for path in inputs}
    if current != inputs:
        raise ValueError('gate input changed while browser ran')
    report.update(artifactSha256=base['artifactSha256'], inputs=inputs,
                  htmlSha256=sha((out / 'index.html').read_bytes()),
                  browserLogSha256=sha((out / 'browser.log').read_bytes()),
                  browserExited=True, command=command)
    (out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    if not report['pass']:
        raise RuntimeError('WebGL coordinate browser gate failed; see result.json')
    print(json.dumps({'pass': True, 'cases': len(report['cases']), 'assertions': report['assertions'],
                      'renderer': report['renderer'], 'report': str(out / 'result.json')}))


if __name__ == '__main__':
    main()
