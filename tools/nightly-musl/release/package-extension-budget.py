#!/usr/bin/env python3
"""Create an isolated Firefox package with a bounded 60-second script watchdog.

This diagnostic changes one default preference, preserves the native executable,
and verifies every CPIO record. It does not publish or claim a runtime fix.
"""
import argparse
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import resource
import shutil
import signal
import stat
import subprocess
import time

REPO = Path(__file__).resolve().parents[3]
MEMBER = 'opt/firefox/defaults/pref/wasm.js'
PREF = 'dom.max_ext_content_script_run_time'
SCRIPT_CONTEXTS = {
    'extension-content': (PREF, 'extension content scripts with ExpandedPrincipal'),
    'content': ('dom.max_script_run_time',
                'ordinary content, including extension background pages with ContentPrincipal'),
}


def context_settings(script_context):
    try:
        return SCRIPT_CONTEXTS[script_context]
    except KeyError:
        raise ValueError('Unknown script context: '+str(script_context)) from None


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2)+'\n')


def pin(path):
    return dict(path=str(path), sha256=sha(path), bytes=path.stat().st_size)


def exact(stream, count):
    data = stream.read(count)
    if len(data) != count:
        raise ValueError('Truncated CPIO record')
    return data


def rewrite(source, destination, script_context='extension-content'):
    preference, scope = context_settings(script_context)
    changed = []
    with gzip.open(source, 'rb') as stream, destination.open('xb') as target:
        with gzip.GzipFile(filename='', fileobj=target, mode='wb', mtime=0, compresslevel=6) as output:
            while True:
                header = exact(stream, 110)
                if header[:6] != b'070701':
                    raise ValueError('Expected unchecksummed newc')
                fields = [int(header[i:i+8], 16) for i in range(6, 110, 8)]
                size, namesize = fields[6], fields[11]
                if not 1 <= namesize <= 4096:
                    raise ValueError('Invalid CPIO name size')
                encoded = exact(stream, namesize)
                name = encoded[:-1].decode('utf-8').removeprefix('./')
                name_padding = exact(stream, -(110+namesize) % 4)
                if name == MEMBER:
                    if changed or size > 65536 or not stat.S_ISREG(fields[1]) or fields[4] != 1:
                        raise ValueError('Expected one small single-link preference file')
                    old = exact(stream, size)
                    exact(stream, -size % 4)
                    if preference.encode() in old or not old.endswith(b'\n'):
                        raise ValueError('Base already overrides '+preference+' or lacks final newline')
                    addition = (f'\n// Bounded 60-second diagnostic watchdog for {scope}.\n'
                                '// Other watchdog preferences and saved user preferences are unchanged.\n'
                                f'pref("{preference}", 60);\n').encode()
                    new = old+addition
                    output.write(header[:54]+f'{len(new):08x}'.encode()+header[62:]+encoded+name_padding)
                    output.write(new)
                    output.write(bytes(-len(new) % 4))
                    changed.append((old, new))
                else:
                    output.write(header+encoded+name_padding)
                    remaining = size
                    while remaining:
                        chunk = exact(stream, min(remaining, 1024*1024))
                        output.write(chunk)
                        remaining -= len(chunk)
                    output.write(exact(stream, -size % 4))
                if name == 'TRAILER!!!':
                    while chunk := stream.read(1024*1024):
                        output.write(chunk)
                    break
    if len(changed) != 1:
        raise ValueError('Required preference member is missing')
    return changed[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--expected-native-sha256', required=True)
    parser.add_argument('--script-context', choices=tuple(SCRIPT_CONTEXTS),
                        default='extension-content',
                        help='Watchdog context; defaults to extension content scripts (backward compatible)')
    args = parser.parse_args()
    preference, scope = context_settings(args.script_context)
    began = time.monotonic()
    def expired(signum, frame):
        raise TimeoutError('180-second diagnostic package deadline expired')
    signal.signal(signal.SIGALRM, expired)
    signal.alarm(180)
    resource.setrlimit(resource.RLIMIT_FSIZE, (2*1024**3, 2*1024**3))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    if not re.fullmatch(r'[a-f0-9]{64}', args.expected_native_sha256):
        raise ValueError('Exact native SHA256 is required')
    base = args.base.resolve(strict=True)
    output = args.output.absolute()
    parent = output.parent.resolve(strict=True)
    filesystem = subprocess.check_output(['findmnt', '-n', '-o', 'FSTYPE', '--target', str(parent)], text=True, timeout=5).strip()
    if filesystem not in {'btrfs', 'ext4', 'xfs'} or shutil.disk_usage(parent).free < 20*1024**3:
        raise ValueError('Fresh disk-backed output with20GiB reserve is required')
    available = re.search(r'^MemAvailable:\s+(\d+) kB$', Path('/proc/meminfo').read_text(), re.M)
    if not available or int(available[1])*1024 < 1024**3:
        raise ValueError('Available-memory floor is1GiB')
    output.mkdir(mode=0o700)
    manifest = json.loads((base/'boot-manifest.json').read_text())
    asset = manifest['assets']['firefox']
    source = base/Path(asset['url'].split('?', 1)[0]).name
    source_pin = pin(source)
    if (source_pin['sha256'], source_pin['bytes']) != (asset['sha256'], asset['bytes']):
        raise ValueError('Base manifest/archive identity differs')
    spec = importlib.util.spec_from_file_location('archive_verify', REPO/'tools/guest-rootfs/rewrite-firefox-archive.py')
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    before, before_tail = verifier._scan(source)
    if before['opt/firefox/firefox']['sha256'] != args.expected_native_sha256:
        raise ValueError('Unexpected native executable')
    destination = output/'initramfs-firefox.cpio.gz'
    old, new = rewrite(source, destination, args.script_context)
    after, after_tail = verifier._scan(destination)
    if list(before) != list(after) or before_tail != after_tail:
        raise ValueError('CPIO order, names, or trailer changed')
    altered = [name for name in before if before[name] != after[name]]
    if altered != [MEMBER]:
        raise ValueError('Unexpected CPIO changes: '+repr(altered))
    original, current = before[MEMBER], after[MEMBER]
    expected_fields = original['fields'].copy()
    expected_fields[6] = len(new)
    if current['fields'] != expected_fields or original['prefix'][:54] != current['prefix'][:54] or original['prefix'][62:] != current['prefix'][62:]:
        raise ValueError('Preference record metadata changed beyond body size')
    if current['sha256'] != hashlib.sha256(new).hexdigest() or new[:len(old)] != old:
        raise ValueError('Preference body differs')
    if pin(source) != source_pin:
        raise ValueError('Base archive changed during packaging')
    (output/'wasm-before.js').write_bytes(old)
    (output/'wasm-after.js').write_bytes(new)
    archive = pin(destination)
    native_metadata = json.loads((base/'package.json').read_text())
    native_mode = native_metadata.get('optimizer', native_metadata.get('nativeOptimizer', 'unknown'))
    full_o2_status = native_metadata.get('fullO2Status', 'complete' if native_mode == 'O2' else 'unresolved')
    manifest['version'] = archive['sha256'][:12]
    manifest['assets']['firefox'].update(url='./initramfs-firefox.cpio.gz', bytes=archive['bytes'], sha256=archive['sha256'], label='Firefox '+scope+' watchdog 60s diagnostic; native '+native_mode+'; original O2 '+full_o2_status+'; runtime result pending')
    save(output/'boot-manifest.json', manifest)
    report = dict(passPackage=True, diagnosticOnly=True, nativeOptimizer=native_mode, fullO2Status=full_o2_status, source=source_pin, archive=archive,
        nativeSHA256=args.expected_native_sha256, nativeUnchanged=True, scriptContext=args.script_context, scriptScope=scope, preference=preference, defaultValue=60,
        modifiedMembers=[dict(name=MEMBER, before=dict(bytes=len(old), sha256=hashlib.sha256(old).hexdigest()), after=dict(bytes=len(new), sha256=hashlib.sha256(new).hexdigest()), metadataChanged=['filesize'])],
        verifiedRecords=len(before), unchangedRecords=len(before)-1, recordOrderPreserved=True, trailerPreserved=True,
        originalJitTestsUnchanged=True, runtimeAcceptance=False, published=False, elapsedSeconds=time.monotonic()-began,
        rollback='Select the unmodified base package; no profile, addon or existing package was edited')
    frozen = base/'freeze-receipt.json'
    if frozen.is_file():
        receipt = json.loads(frozen.read_text())
        receipt.update(kind='linuxonweb-extension-budget-diagnostic' if args.script_context == 'extension-content' else 'linuxonweb-content-budget-diagnostic', scriptContext=args.script_context, scriptScope=scope, preference=preference, defaultValue=60, build=manifest['version'], parentReceipt=str(frozen), parentSha256=sha(frozen), runtimeAcceptance=False, diagnosticOnly=True, nativeOptimizer=native_mode, fullO2Status=full_o2_status)
        changed = {}
        for route, path in [('/linux/initramfs-firefox.cpio.gz', destination), ('/linux/boot-manifest.json', output/'boot-manifest.json')]:
            old_entry = receipt['routes'][route]
            entry = dict(source=str(path), snapshot=str(path), bytes=path.stat().st_size, sha256=sha(path))
            changed[old_entry['snapshot']] = entry
            receipt['routes'][route] = entry
        receipt['files'] = [changed.get(item['snapshot'], item) for item in receipt['files']]
        save(output/'freeze-receipt.json', receipt)
    save(output/'package.json', report)
    signal.alarm(0)
    print(json.dumps(report))


if __name__ == '__main__':
    main()
