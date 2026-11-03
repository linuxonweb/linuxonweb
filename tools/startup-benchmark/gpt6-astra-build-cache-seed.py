#!/usr/bin/env python3
"""Package only generated code caches from a fresh, isolated benchmark profile."""
import argparse, gzip, hashlib, json, struct
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--export', type=Path, required=True)
parser.add_argument('--fixture-report', type=Path, required=True)
parser.add_argument('--package-receipt', type=Path, required=True)
parser.add_argument('--archive', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--compatibility-export', type=Path)
args = parser.parse_args()
allowed = ['startupCache.4.little', 'scriptCache.bin', 'urlCache.bin']
digest = lambda data: hashlib.sha256(data).hexdigest()
fixture_bytes = args.fixture_report.read_bytes()
fixture = json.loads(fixture_bytes)
export = json.loads((args.export / 'export.json').read_text())
package = json.loads(args.package_receipt.read_text())
if fixture.get('mode') != 'firefox' or fixture.get('reusedTestProfile') or not fixture.get('end') or fixture.get('remainingOwned') != []:
    raise SystemExit('Requires a closed fresh-profile Firefox fixture, never an existing user profile')
if export['sourceTestProfile']['sourceRun'] != fixture['run']:
    raise SystemExit('Export provenance differs from fixture')
with args.archive.open('rb') as stream:
    archive_sha = hashlib.file_digest(stream, 'sha256').hexdigest()
if archive_sha != package['sha256'] or len(package['nativeSha256']) != 64:
    raise SystemExit('System archive identity differs from package receipt')
files, payloads = [], []
for name in allowed:
    data = (args.export / name).read_bytes()
    record = {'filename': name, 'bytes': len(data), 'sha256': digest(data)}
    if not 0 < len(data) <= 24 * 1024**2 or record not in export['files']:
        raise SystemExit('Cache export size/checksum differs')
    files.append(record); payloads.append(data)
header = json.dumps({'schema': 1, 'files': files}, separators=(',', ':')).encode()
raw = b'LOWSC01\n' + struct.pack('<I', len(header)) + header + b''.join(payloads)
if len(raw) > 32 * 1024**2:
    raise SystemExit('Cache pack too large')
packed = gzip.compress(raw, compresslevel=1, mtime=0)
args.output.mkdir(parents=True, exist_ok=False)
asset_name = 'gpt6-astra-rubywebterm-code-cache.bin.gz'
(args.output / asset_name).write_bytes(packed)
manifest = {'schema': 1, 'kind': 'linuxonweb-firefox-code-cache',
    'source': {'archiveSha256': archive_sha, 'firefoxSha256': package['nativeSha256'],
        'fixtureReportSha256': digest(fixture_bytes), 'fixtureStarted': fixture['start'],
        'fixtureEnded': fixture['end'], 'fixtureBrowser': fixture['browserVersion']['product'],
        'profileState': 'fresh isolated fixture; only GPU-check, about:blank and about:profiles were opened',
        'excluded': 'No durable profile, NSS, places, cookies, logins, permissions, remote-settings or user files are included'},
    'asset': {'url': asset_name, 'bytes': len(packed), 'sha256': digest(packed), 'unpackedBytes': len(raw)},
    'files': files, 'acceptance': 'Experimental opt-in; cache use and launch benefit require guest runtime evidence'}
if args.compatibility_export:
    import re
    compat_bytes = args.compatibility_export.read_bytes()
    compat = json.loads(compat_bytes)
    fields = compat.get('fields', {})
    keys = ['LastVersion', 'LastOSABI', 'LastPlatformDir', 'LastAppDir']
    if set(fields) != set(keys) or compat.get('onlyBuildMetadata') is not True or compat['sourceTestProfile']['sourceRun'] != fixture['run']:
        raise SystemExit('Compatibility metadata is not from the same closed clean fixture')
    if not re.fullmatch(r'[A-Za-z0-9.]+_[0-9]{14}/[0-9]{14}', fields['LastVersion']) or fields['LastOSABI'] != 'Linux_wasm32-gcc3' or fields['LastPlatformDir'] != '/opt/firefox' or fields['LastAppDir'] != '/opt/firefox/browser':
        raise SystemExit('Compatibility metadata is outside the exact generated build field set')
    text = '[Compatibility]\n' + ''.join(key + '=' + fields[key] + '\n' for key in keys)
    manifest['schema'] = 2
    manifest['compatibility'] = {'fields': fields, 'bytes': len(text.encode()), 'sha256': digest(text.encode()), 'sourceExportSha256': digest(compat_bytes)}
    manifest['source']['excluded'] = 'Only generated code caches plus four build compatibility fields; no prefs, NSS, places, cookies, logins, permissions, remote-settings or user data'
manifest_bytes = (json.dumps(manifest, indent=2) + '\n').encode()
(args.output / 'manifest.json').write_bytes(manifest_bytes)
seed = {'archiveSha256': archive_sha, 'manifestSha256': digest(manifest_bytes),
        'manifestURL': './startup-cache/' + args.output.name + '/manifest.json'}
(args.output / 'catalog-entry.json').write_text(json.dumps(seed, indent=2) + '\n')
print(json.dumps({'output': str(args.output), 'packedBytes': len(packed), 'unpackedBytes': len(raw),
                  'manifestSha256': seed['manifestSha256'], 'archiveSha256': archive_sha}))
