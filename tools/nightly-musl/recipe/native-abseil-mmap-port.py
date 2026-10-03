from pathlib import Path
import difflib, hashlib, json, subprocess, sys

T = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
S = T / 'source/firefox-159.0a1'
name = 'third_party/abseil-cpp/absl/base/internal/direct_mmap.h'
p = S / name
old = p.read_text()
assert hashlib.sha256(old.encode()).hexdigest() == '40638f1a0a62a2a3a4bba8bc3398e4b7da0ec3627eeefe7274be084c2e5899d3'
needle = '#ifdef __linux__\n'
assert old.count(needle) == 1
new = old.replace(needle, '#if defined(__linux__) && !(defined(__wasm__) && !defined(__wasi__))\n')
phases = []
for status in (T / 'status').glob('*.json'):
    row = json.loads(status.read_text())
    if isinstance(row, dict) and all(k in row for k in ('phase', 'pgid', 'state')):
        phases.append(row)
active = {int(x) for x in subprocess.check_output(['ps', '-eo', 'pgid='], text=True).split()}
assert all(r['state'] == 'completed' and r['pgid'] not in active for r in phases)
backup = T / 'abseil-mmap-preflight' / 'original-direct_mmap.h'
backup.parent.mkdir(exist_ok=True)
assert not backup.exists()
backup.write_text(old)
patch = ''.join(difflib.unified_diff(old.splitlines(True), new.splitlines(True), fromfile='a/' + name, tofile='b/' + name))
(T / 'patches/nightly-native-abseil-mmap.patch').write_text(patch)
proof = {
    'scope': 'Only native Linux/Wasm non-WASI selects existing libc mmap/munmap fallback; all runtime bodies and other targets unchanged',
    'original_sha256': hashlib.sha256(old.encode()).hexdigest(),
    'updated_sha256': hashlib.sha256(new.encode()).hexdigest(),
    'original_backup': str(backup),
    'owned_phase_groups_empty_before_apply': True,
    'applied': '--apply' in sys.argv,
}
if '--apply' in sys.argv:
    assert p.read_text() == old
    p.write_text(new)
(T / 'status/native-abseil-mmap-port.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof))
