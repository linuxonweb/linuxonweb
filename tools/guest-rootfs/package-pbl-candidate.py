#!/usr/bin/env python3
"""Package an isolated PBL test archive; preserve and audit all other records.

Outputs must be in web/linux/tests/runtime-candidates, excluded by the explicit
deployment allowlist. Use the generated launcher only in a fresh QA profile.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--source-manifest', type=Path, required=True)
parser.add_argument('--candidate-report', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
allowed = root / 'web/linux/tests/runtime-candidates'
source, out = args.source.resolve(), args.output.resolve()
if not out.is_relative_to(allowed) or out == allowed or out.exists():
    parser.error('use a fresh named directory under web/linux/tests/runtime-candidates')

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def exact(stream, count):
    data = stream.read(count)
    if len(data) != count:
        raise ValueError('truncated newc archive')
    return data

manifest = json.loads(args.source_manifest.read_text())
baseline = manifest['assets']['firefox']
if source.stat().st_size != baseline['bytes'] or digest(source) != baseline['sha256']:
    parser.error('source does not match accepted manifest')
candidate_report = json.loads(args.candidate_report.read_text())
if not candidate_report.get('pass'):
    parser.error('candidate build must have passed')
candidate = Path(candidate_report['candidate']).resolve()
if (candidate.stat().st_size != candidate_report['bytes'] or
        digest(candidate) != candidate_report['sha256']):
    parser.error('candidate hash/length mismatch')
with candidate.open('rb') as stream:
    if stream.read(8) != b'\0asm\x01\0\0\0':
        parser.error('candidate is not a Wasm module')
out.mkdir(parents=True)
destination = out / 'initramfs-firefox.cpio.gz'
fd, temporary = tempfile.mkstemp(dir=out, prefix='archive-')
target = 'opt/firefox/firefox'
touched = 0
try:
    with gzip.open(source, 'rb') as inp, os.fdopen(fd, 'wb') as raw:
        with gzip.GzipFile(filename='', fileobj=raw, mode='wb', mtime=0, compresslevel=6) as writer:
            while True:
                header = exact(inp, 110)
                if header[:6] != b'070701':
                    raise ValueError('expected newc archive')
                size, namesize = int(header[54:62], 16), int(header[94:102], 16)
                name = exact(inp, namesize)
                namepad = exact(inp, (-(110 + namesize)) % 4)
                key = name.rstrip(b'\0').decode().removeprefix('./').lstrip('/')
                if key == target:
                    if int(header[38:46], 16) != 1:
                        raise ValueError('Firefox has hardlinks; require a different overlay plan')
                    remaining = size + (-size) % 4
                    while remaining:
                        block = exact(inp, min(remaining, 1024 * 1024)); remaining -= len(block)
                    newsize = candidate.stat().st_size
                    writer.write(header[:54] + f'{newsize:08x}'.encode() + header[62:] + name + namepad)
                    with candidate.open('rb') as stream:
                        while block := stream.read(1024 * 1024): writer.write(block)
                    writer.write(b'\0' * (-newsize % 4)); touched += 1
                else:
                    writer.write(header + name + namepad)
                    remaining = size + (-size) % 4
                    while remaining:
                        block = exact(inp, min(remaining, 1024 * 1024))
                        writer.write(block); remaining -= len(block)
                if key == 'TRAILER!!!':
                    while block := inp.read(1024 * 1024): writer.write(block)
                    break
    if touched != 1: raise ValueError('Firefox must occur exactly once')
    os.replace(temporary, destination)
finally:
    if os.path.exists(temporary): os.unlink(temporary)

# Independent complete pass: metadata, names, padding, body hashes and trailer.
def inventory(path):
    records = []
    init = None
    with gzip.open(path, 'rb') as stream:
        while True:
            header = exact(stream, 110)
            if header[:6] != b'070701': raise ValueError('invalid audit header')
            size, namesize = int(header[54:62], 16), int(header[94:102], 16)
            name = exact(stream, namesize); namepad = exact(stream, (-(110+namesize))%4)
            key = name.rstrip(b'\0').decode().removeprefix('./').lstrip('/')
            bodyhash = hashlib.sha256(); remaining = size; initparts = []
            while remaining:
                block = exact(stream, min(remaining, 1024 * 1024)); remaining -= len(block)
                bodyhash.update(block)
                if key == 'init': initparts.append(block)
            padding = exact(stream, (-size)%4)
            if key == 'init': init = b''.join(initparts)
            records.append((key, header[:54]+header[62:], name, namepad, size, bodyhash.hexdigest(), padding))
            if key == 'TRAILER!!!':
                trailerhash = hashlib.file_digest(stream, 'sha256').hexdigest()
                break
    return records, init, trailerhash

before, init, trailer_before = inventory(source)
after, newinit, trailer_after = inventory(destination)
if len(before) != len(after) or trailer_before != trailer_after:
    raise ValueError('archive record count or trailer changed')
changed = []
for old, new in zip(before, after):
    if old[:4] != new[:4]: raise ValueError('record metadata/name/order changed: ' + old[0])
    if old != new:
        changed.append(old[0])
        if old[0] != target or new[4:6] != (candidate_report['bytes'], candidate_report['sha256']):
            raise ValueError('unexpected body change: ' + old[0])
if changed != [target]: raise ValueError('expected exactly one Firefox replacement')
if init != newinit or not init or b'home: persistent storage mounted' not in init:
    raise ValueError('persistent-home init missing or changed')
if digest(source) != baseline['sha256'] or digest(candidate) != candidate_report['sha256']:
    raise ValueError('input changed during packaging')
archive_sha = digest(destination)
relative = destination.relative_to(root / 'web/linux').as_posix()
manifest['assets']['firefox'] = {'url': './'+relative, 'bytes': destination.stat().st_size,
                               'sha256': archive_sha, 'label': 'TEST ONLY: '+out.name}
manifest.pop('previous', None)
manifest['version'] = 'test-pbl-'+archive_sha[:16]
(out/'boot-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
report = {'pass': True, 'scope': 'isolated package audit only; guest acceptance pending',
          'sourceArchiveSHA256': baseline['sha256'], 'candidateSHA256': candidate_report['sha256'],
          'archiveSHA256': archive_sha, 'archiveBytes': destination.stat().st_size,
          'records': len(before), 'changedMembers': changed, 'allOtherRecordsIdentical': True,
          'initSHA256': hashlib.sha256(init).hexdigest(), 'persistentInitPreserved': True,
          'launcherURL': '/linux/'+out.relative_to(root/'web/linux').as_posix()+'/launch.html'}
(out/'package-report.json').write_text(json.dumps(report, indent=2)+'\n')
(out/'launch.html').write_text('''<!doctype html><meta charset="utf-8"><title>Isolated PBL QA</title>
<h1>Isolated PBL QA archive</h1><p>Use only in a fresh task-owned browser profile.
This changes that profile's saved system selection. It does not change published assets.</p>
<button id="launch">Boot this test archive</button><pre id="status"></pre>
<script type="module">
const manifest = await (await fetch('./boot-manifest.json', {cache:'no-store'})).json();
document.querySelector('#status').textContent=JSON.stringify(manifest,null,2);
document.querySelector('#launch').onclick=()=>{
 localStorage.setItem('linuxonweb.system.active.v1',JSON.stringify(manifest));
 localStorage.removeItem('linuxonweb.system.previous.v1');
 location.assign('/linux/index.html?firefox=1');
};
</script>''')
print(json.dumps(report), flush=True)
