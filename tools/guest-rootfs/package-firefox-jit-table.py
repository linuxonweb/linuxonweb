#!/usr/bin/env python3
"""Pinned candidate: make the Firefox wasm function table growable (guest JIT prep).

Post-link binary splice, no Firefox rebuild. The packed `opt/firefox/firefox`
module declares its only funcref table with limits initial == maximum
(177851), so the guest JIT runtime (web/linux/dist/guest-jit.js) cannot append
installed functions with `table.grow` and `jit_install` returns -ENOMEM.

This tool rewrites exactly one wasm section, the Table section, replacing the
limits `{flags=1, min=177851, max=177851}` with `{flags=0, min=177851}` (no
maximum, which is what wasm-ld `--growable-table` emits). Every other module
byte is preserved: the output module equals
`module[:table_section] + new_table_section + module[table_section_end:]`,
which is verified. The table was already exported as
`__indirect_function_table`; no export, global, code, element or data byte
changes. Code semantics are unchanged: `call_indirect` bounds checks use the
dynamic table length, which stays 177851 until the runtime grows it.

Only that one CPIO member changes (its size field shrinks by 3 bytes); all
other records, their order, metadata and the archive tail are preserved.
"""
import argparse
import copy
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('ready_package', Path(__file__).with_name('package-aurora-ready.py'))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
TASK = Path('/mnt/p6/build/guest-jit-ffprep-20260928')
# Accepted inputs: archive SHA-256 -> (manifest SHA-256, label). The Firefox
# module member is identical in both.
SOURCES = {
    'd3d9afca272947ba1b6bb743585a6f0cf33de90c54adff1cd85b5c5bf9d8002b':
        ('8fca6cf14e2a0e1ad77cd49aa28198ed0fa02a8649156bcb43468b877ca8cc45', 'b21b2cac65a3 (DevTools fix, promoted ee20f16)'),
    '7bd5e9041d568c6b5b325abba16754d943a51b009c368c39901c0fb0a751508a':
        ('595c01ac6d0d0c3e67441eedc69dc0946a71a79c9b30ae7a7966f5169306e516', '29331a186e50 (Sites v9)'),
}
MEMBER = 'opt/firefox/firefox'
MEMBER_SHA = '644ab48f01a8a588706d1ec1c3a97006469964c705edc0f5d599286c890c610f'
TABLE_INITIAL = 177851


def uleb(value):
    out = bytearray()
    while True:
        byte = value & 0x7f
        value >>= 7
        out.append(byte | (0x80 if value else 0))
        if not value:
            return bytes(out)


def read_uleb(data, offset):
    result = shift = 0
    while True:
        byte = data[offset]
        offset += 1
        result |= (byte & 0x7f) << shift
        shift += 7
        if not byte & 0x80:
            return result, offset


def sections(module):
    if module[:8] != b'\0asm\x01\0\0\0':
        raise ValueError('not a wasm module')
    offset = 8
    while offset < len(module):
        section_id = module[offset]
        size, payload = read_uleb(module, offset + 1)
        yield section_id, offset, payload, payload + size
        offset = payload + size
    if offset != len(module):
        raise ValueError('truncated module')


def splice_table(module):
    tables = [s for s in sections(module) if s[0] == 4]
    if len(tables) != 1:
        raise ValueError('exactly one Table section required')
    _, start, payload, end = tables[0]
    old_payload = module[payload:end]
    expected = b'\x01\x70\x01' + uleb(TABLE_INITIAL) + uleb(TABLE_INITIAL)
    if old_payload != expected:
        raise ValueError('pinned fixed-size table required, found ' + old_payload.hex())
    new_payload = b'\x01\x70\x00' + uleb(TABLE_INITIAL)
    new_section = b'\x04' + uleb(len(new_payload)) + new_payload
    spliced = module[:start] + new_section + module[end:]
    if spliced[:start] != module[:start] or spliced[start + len(new_section):] != module[end:]:
        raise ValueError('splice changed bytes outside the Table section')
    return spliced, {'offset': start, 'oldSection': module[start:end].hex(), 'newSection': new_section.hex(),
                     'sizeDelta': len(spliced) - len(module)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    if not out.is_relative_to(TASK) or out == TASK or out.exists() or args.output.is_symlink() or not out.parent.is_dir():
        parser.error('fresh output under existing task root required')
    filesystems = {str(p.resolve()): base.disk_filesystem(p) for p in (args.source, args.manifest, out.parent)}
    scratch = {}
    for name in ('TMPDIR', 'TMP', 'TEMP'):
        p = Path(os.environ.get(name, '/tmp')).resolve()
        if not p.is_relative_to(TASK) or not p.is_dir():
            parser.error(name + ' must be an existing disk-backed task directory')
        filesystems[str(p)] = base.disk_filesystem(p)
        scratch[name] = str(p)
    if shutil.disk_usage(out.parent).free < 4 * 1024**3:
        parser.error('4 GiB free disk required')
    source, manifest_bytes = args.source.read_bytes(), args.manifest.read_bytes()
    source_sha = base.digest(source)
    if source_sha not in SOURCES or base.digest(manifest_bytes) != SOURCES[source_sha][0]:
        parser.error('accepted input hash mismatch')
    manifest = json.loads(manifest_bytes)
    if manifest['assets']['firefox']['sha256'] != source_sha:
        parser.error('manifest does not describe source archive')
    for key in ('kernel', 'plain'):
        asset = manifest['assets'][key]
        p = args.manifest.parent / asset['url']
        if not p.exists():
            p = Path(__file__).resolve().parents[2] / 'web/linux' / asset['url']
        filesystems[str(p.resolve())] = base.disk_filesystem(p)
        if p.stat().st_size != asset['bytes'] or base.file_digest(p) != asset['sha256']:
            parser.error('accepted ' + key + ' mismatch')
    raw = gzip.decompress(source)
    original = list(base.records(raw))
    old = {r[0]: r for r in original}
    if len(old) != len(original):
        raise ValueError('duplicate archive paths')
    before = old[MEMBER][3]
    if base.digest(before) != MEMBER_SHA:
        raise ValueError('pinned Firefox module required')
    after, splice = splice_table(before)
    tail = raw[sum(len(r[4]) for r in original):]
    candidate = b''.join(base.replace_body(r, after) if r[0] == MEMBER else r[4] for r in original) + tail
    changed = list(base.records(candidate))
    new = {r[0]: r for r in changed}
    if [r[0] for r in original] != [r[0] for r in changed]:
        raise ValueError('archive paths/order changed')
    if [key for key in old if old[key][4] != new[key][4]] != [MEMBER]:
        raise ValueError('unexpected record change')
    if old[MEMBER][1][:54] + old[MEMBER][1][62:] != new[MEMBER][1][:54] + new[MEMBER][1][62:]:
        raise ValueError('member metadata change')
    if new[MEMBER][3] != after:
        raise ValueError('member body mismatch')
    if candidate[sum(len(r[4]) for r in changed):] != tail:
        raise ValueError('archive tail changed')
    out.mkdir()
    module_path = out / 'firefox-growable-table.wasm'
    module_path.write_bytes(after)
    checks = {}
    for label, command in (('validate', ['wasm-validate', '--enable-all', str(module_path)]),
                           ('table', ['wasm-objdump', '-x', '-j', 'Table', str(module_path)]),
                           ('export', ['wasm-objdump', '-x', '-j', 'Export', str(module_path)])):
        result = subprocess.run(command, capture_output=True, text=True, timeout=1800, env=os.environ.copy())
        (out / (label + '.log')).write_text(result.stdout + result.stderr)
        checks[label] = {'command': command, 'exitCode': result.returncode}
        if result.returncode != 0:
            raise ValueError(label + ' failed')
    table_log = (out / 'table.log').read_text()
    if f' - table[0] type=funcref initial={TABLE_INITIAL}\n' not in table_log or 'max=' in table_log:
        raise ValueError('spliced table is not growable: ' + table_log)
    if 'table[0] -> "__indirect_function_table"' not in (out / 'export.log').read_text():
        raise ValueError('table export missing')
    compressed = io.BytesIO()
    with gzip.GzipFile(filename='', fileobj=compressed, mode='wb', compresslevel=9, mtime=0) as stream:
        stream.write(candidate)
    encoded = compressed.getvalue()
    new_manifest = copy.deepcopy(manifest)
    new_manifest['assets']['firefox'].update(bytes=len(encoded), sha256=base.digest(encoded))
    new_manifest['version'] = base.digest(json.dumps(new_manifest['assets'], sort_keys=True).encode())[:12]
    (out / 'initramfs-firefox.cpio.gz').write_bytes(encoded)
    (out / 'boot-manifest.json').write_text(json.dumps(new_manifest, indent=2) + '\n')
    report = dict(passPackage=True, candidateOnly=True, sourceSha256=source_sha,
        sourceManifestSha256=SOURCES[source_sha][0], sourceVersion=manifest['version'], sourceLabel=SOURCES[source_sha][1],
        archiveSha256=base.digest(encoded), bytes=len(encoded),
        uncompressedBytes=len(candidate), version=new_manifest['version'],
        memberBeforeSha256=base.digest(before), memberAfterSha256=base.digest(after),
        memberBeforeBytes=len(before), memberAfterBytes=len(after), splice=splice,
        tableInitial=TABLE_INITIAL, tableMaximumBefore=TABLE_INITIAL, tableMaximumAfter=None,
        tableExport='__indirect_function_table', moduleChecks=checks,
        unchangedRecords=len(old) - 1, modified=[MEMBER], added=[], originalOrderPreserved=True,
        tailPreserved=True, metadataExceptSizePreserved=True, profilePreferencesUnchanged=True,
        source=str(args.source.resolve()), manifest=str(args.manifest.resolve()),
        filesystems=filesystems, scratch=scratch,
        releaseGatesPending=['cold-and-automatic-warm-input', 'update-and-home-preservation',
                             'firefox-in-process-jit-install', 'public-acceptance'])
    (out / 'package.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passPackage': True, 'version': report['version'], 'bytes': len(encoded),
                      'archiveSha256': report['archiveSha256'], 'output': str(out)}))


if __name__ == '__main__':
    main()
