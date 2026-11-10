#!/usr/bin/env python3
"""Capture a NEW reviewed preparation snapshot; never authorize it automatically.

Run only under the unchanged bounded owner. The resulting manifest is accepted
only after independent review and an explicit fixed-digest change in the recipe.
Packet3a and all old receipts remain unchanged. This is not a new host test.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / 'tools/nightly-jit-prep'))
from input_closure import inventory, read_pinned, need

EVIDENCE = REPO / 'docs/evidence/firefox-jit-integration-20261110'
old_path = EVIDENCE / 'preparation.json'
raw, _ = read_pinned(old_path, {'bytes': old_path.stat().st_size, 'sha256': '9facb1ee3c8fc27af2d75d0954cbd342b8c1dd374900f3ae0494cf94d7a40a90'})
old = json.loads(raw)
packet = Path(old['packet']['path']).parent
deps = packet.parent / 'linuxonweb-firefox-jit-20261108-native-deps-build'
egl = Path(old['egl']['path'])
roots = {'packet': packet, 'dependencies': deps, 'egl': egl.parent, 'repository': REPO}
manifest = {
    'schema': 'reviewed-final159-preparation-inputs-v1',
    'historicalPacketRoot': str(packet), 'historicalDependenciesRoot': str(deps),
    'sourceHead': old['sourceHead'],
    'provenance': {
        'scope': 'Separately reviewed current preparation input closure for unchanged pre-array packet3a; not retrospective host or native acceptance.',
        'generatedPacketInputs': 'All ten generated configuration, wrapper, shim, target, compile-command and link-input classes independently reproduced from already pinned evidence; see input-derivation-review.txt.',
        'nativeAndHostInputs': 'Seven compilerSourceBinding pins and all nine host manifest files retain the original preflight/host-manifest identities; native mock equals host mock.',
        'dependencyHeaders': 'Exact 1687-member prior preparation dependency-headers inventory, itself pinned by the historical preparation receipt.',
        'dependencyMetadata': 'New independently reviewed current snapshot: exact five present original archives, one missing libc++, separate exact historical helper; maps and validation are explicitly pinned here.',
        'externalFiles': 'Regular-file pins already recorded by the old successful preparation, checked again here. Directory availability is not a recursive immutable toolchain closure.',
        'historicalRecipeCommit': 'a03223f78b0fcefb45022e0da2c006baea0366fe',
        'historicalPreparation': {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
    },
    'files': {name: [] for name in roots} | {'external': []},
    'trees': [],
    'missing': [{'root': 'dependencies', 'path': 'native-unwind/runtimes-build/lib/libc++.a'}],
}
seen = set()

def add(group, name, *, expected=None, retain=False, allow_alias=False):
    key = (group, name)
    if key in seen:
        return
    seen.add(key)
    path = Path(name) if group == 'external' else roots[group] / name
    resolved = path.resolve(strict=True)
    need(allow_alias or path == resolved, 'unexpected snapshot symlink: ' + str(path))
    before = resolved.stat()
    if expected is None:
        data = resolved.read_bytes()
        expected = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
    read_pinned(path, expected, retain=False, resolved=str(resolved) if allow_alias else None)
    row = {'path': name, 'bytes': expected['bytes'], 'sha256': expected['sha256'],
           'mode': stat.S_IMODE(before.st_mode)}
    if not str(path).startswith('/nix/store/'):
        need(before.st_uid == os.getuid(), 'snapshot input is not owned')
        row['owned'] = True
    if retain:
        row['retain'] = True
    if path != resolved:
        row['resolvedPath'] = str(resolved)
    manifest['files'][group].append(row)

def tree(group, name, *, retain=False, known=None):
    paths, directories = inventory(roots[group] / name)
    manifest['trees'].append({'root': group, 'path': name, 'directories': directories})
    if known is not None:
        need(set(paths) == set(known), 'recorded tree membership changed: ' + name)
    for path in paths:
        add(group, name + '/' + path, expected=known[path] if known else None, retain=retain)

add('packet', 'preflight.json', expected=old['packet'], retain=True)
add('packet', 'host-packet/manifest.json', expected=old['hostPacket'], retain=True)
data = json.loads((packet / 'preflight.json').read_bytes())
host = json.loads((packet / 'host-packet/manifest.json').read_bytes())
host_known = {r['path']: r for r in host['files']}
host_known['manifest.json'] = old['hostPacket']
tree('packet', 'host-packet', retain=True, known=host_known)
native_known = {Path(r['path']).name: r for r in data['compilerSourceBinding']}
native_known['host-test/mock.h'] = host_known['overlay/host-test/mock.h']
tree('packet', 'native-src', retain=True, known=native_known)
tree('packet', 'recipe', retain=True)
for name in ['.mozconfig', 'compile-commands.json', 'link/link.args']:
    add('packet', name, retain=True)

for name in ['validation.json', 'replacement-paths.json', 'header-replacement-paths.json']:
    add('dependencies', name, retain=True)
validation = json.loads((deps / 'validation.json').read_bytes())
expected_present = {
    'native-mapping-wrapped-shm/libnightly-native-mapping.a',
    'native-runtime-accepted-run1/libnightly-native-runtime.a',
    'native-stack-accepted-run1/libnightly-native-stack.a',
    'native-unwind/runtimes-build/lib/libc++abi.a',
    'native-unwind/runtimes-build/lib/libunwind.a'}
actual_present = {str(Path(r['path']).relative_to(deps)) for r in validation['artifacts']}
need(actual_present == expected_present and len(validation['artifacts']) == 5, 'original five-archive set changed')
need(validation['presentArtifactValidation'] is True and validation['passArtifactValidation'] is False, 'dependency scope changed')
need(validation['missingArtifacts'] == [str(deps / manifest['missing'][0]['path'])], 'missing archive set changed')
need(not (deps / manifest['missing'][0]['path']).exists(), 'libc++ unexpectedly exists')
manifest['originalDependencySet'] = {'present': sorted(actual_present), 'missing': [manifest['missing'][0]['path']],
    'separateHelper': 'native-mapping-link/libnightly-native-mapping.a'}
for row in validation['artifacts']:
    add('dependencies', str(Path(row['path']).relative_to(deps)), expected=row)
for key in ['sourceClosure', 'inputs', 'replacementPaths']:
    row = validation[key]
    add('dependencies', str(Path(row['path']).relative_to(deps)), expected=row, retain=True)
helper = json.loads((EVIDENCE / 'helper-reconstruction.json').read_bytes())
add('dependencies', 'native-mapping-link/libnightly-native-mapping.a', expected=helper['archive'])
add('dependencies', 'native-mapping-link/reconstruction.json', retain=True)
header_raw, _ = read_pinned(Path(old['dependencyHeaders']['path']), old['dependencyHeaders'])
headers = json.loads(header_raw)
need(len(headers) == 1687, 'historical header count changed')
for name in ['native-unwind/include', 'native-unwind/runtimes-build/include/c++/v1']:
    expected = {str(Path(r['path']).relative_to(deps / name)): r for r in headers if Path(r['path']).is_relative_to(deps / name)}
    tree('dependencies', name, known=expected)
source_raw, _ = read_pinned(EVIDENCE / 'source-changes.json', old['sourceChanges'])
changes = json.loads(source_raw)
manifest['sourceDestinations'] = [
    {'path': str(Path(r['after']['path']).relative_to(old['source'])),
     'before': {k: r['before'][k] for k in ['bytes', 'sha256']} if r['before'] else None}
    for r in changes]
need(len(manifest['sourceDestinations']) == 10, 'source change input set changed')

for row in old['requiredExternalInputs']:
    if row.get('directory') or row['status'] != 'available':
        continue
    path = Path(row['path'])
    if path.is_relative_to(deps) or path == egl:
        continue
    immutable = str(path).startswith('/nix/store/')
    need(immutable or path.lstat().st_uid == os.getuid(), 'external input is not owned')
    add('external', str(path), expected=row, allow_alias=immutable)
add('egl', egl.name, expected=old['egl'])
add('repository', 'tools/pbl-jit/PblJit.cpp', expected=old['candidate'])
for name in ['input-derivation-review.txt', 'input-dependencies-review.txt']:
    add('repository', str((EVIDENCE / name).relative_to(REPO)), retain=True)
for rows in manifest['files'].values():
    rows.sort(key=lambda r: r['path'])
manifest['trees'].sort(key=lambda r: (r['root'], r['path']))
output = REPO / 'tools/nightly-jit-prep/final159-preparation-inputs-20261110.json'
need(not output.exists(), 'preserve the existing closure snapshot')
output.write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'output': str(output), 'bytes': output.stat().st_size,
    'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
    'fileCounts': {k: len(v) for k, v in manifest['files'].items()},
    'treeCount': len(manifest['trees']), 'nativeAcceptance': False}, indent=2))
