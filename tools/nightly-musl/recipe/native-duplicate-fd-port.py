#!/usr/bin/env python3
"""Restore existing POSIX duplicate-fd helper only for native Linux/Wasm."""
from pathlib import Path
import difflib
import hashlib
import json
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
if root.name != 'firefox-nightly-musl-recovery-20261002':
    root = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
source = root / 'source/firefox-159.0a1'
probe = json.loads((root / 'duplicate-fd-preflight/result.json').read_text())
assert all(code == 0 for code in probe['results'].values())
changes = {}
predicate = '#if !defined(__wasm__) || (defined(XP_LINUX) && !defined(__wasi__))'
for name in ('UniquePtrExtensions.h', 'UniquePtrExtensions.cpp'):
    path = source / 'mfbt' / name
    original = path.read_text()
    assert hashlib.sha256(original.encode()).hexdigest() == probe['source_changes'][name]['original_sha256']
    assert original.count('#ifndef __wasm__') == 1
    updated = original.replace('#ifndef __wasm__', predicate)
    if name.endswith('.h'):
        updated = updated.replace('// WASI does not have `dup`', '// WASI does not have `dup`; native Linux/Wasm has POSIX descriptors.')
        updated = updated.replace('#endif  // not wasm', '#endif  // non-Wasm or native Linux/Wasm')
    assert hashlib.sha256(updated.encode()).hexdigest() == probe['source_changes'][name]['copied_sha256']
    changes['mfbt/' + name] = (original, updated)
patch = ''.join(''.join(difflib.unified_diff(old.splitlines(True), new.splitlines(True), fromfile='a/' + name, tofile='b/' + name)) for name, (old, new) in changes.items())
proof = {
    'scope': 'Native Linux/Wasm !__wasi__ enables unchanged POSIX helper; generic Wasm/WASI and all non-Wasm behavior preserved',
    'predicate': predicate,
    'source_changes': probe['source_changes'],
    'body_changed': False,
    'probe': str(root / 'duplicate-fd-preflight/result.json'),
    'applied': '--apply' in sys.argv,
}
if '--apply' in sys.argv:
    statuses = [json.loads(path.read_text()) for path in (root / 'status').glob('build-run*.json') if '-group-cleanup' not in path.name]
    all_statuses = [json.loads(path.read_text()) for path in (root / 'status').glob('*.json')]
    owned_phases = [status for status in all_statuses if isinstance(status, dict) and 'phase' in status and 'pgid' in status and 'state' in status]
    assert all(status['state'] == 'completed' for status in owned_phases), 'Owned phase remains active'
    active_pgids = {int(line.strip()) for line in subprocess.check_output(['ps', '-eo', 'pgid='], text=True).splitlines() if line.strip()}
    assert not any(status['pgid'] in active_pgids for status in owned_phases), 'Owned phase group remains active'
    latest = max(statuses, key=lambda status: status['started'])
    assert latest['state'] == 'completed'
    group = [line for line in subprocess.check_output(['ps', '-eo', 'pgid='], text=True).splitlines() if line.strip() == str(latest['pgid'])]
    assert not group, 'Owned build group remains active'
    proof['terminal_build_pgid'] = latest['pgid']
    proof['group_entries_before_apply'] = group
    for name, (old, new) in changes.items():
        path = source / name
        assert path.read_text() == old
        path.write_text(new)
(root / 'patches/nightly-native-duplicate-file-handle.patch').write_text(patch)
(root / 'status/native-duplicate-fd-port.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof, indent=2))
