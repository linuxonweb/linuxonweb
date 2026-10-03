from pathlib import Path
import difflib, hashlib, json, subprocess, sys

T = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
S = T / 'source/firefox-159.0a1'
name = 'mfbt/TaggedAnonymousMemory.h'
p = S / name
old = p.read_text()
assert hashlib.sha256(old.encode()).hexdigest() == '7196ad0a062e712c56617a6814f6c3d4fec7fe1fb80f2cbafa7a1b42bacb1a95'
needle = '#  if defined(__wasi__) || defined(__wasm__)\n'
assert old.count(needle) == 1
new = old.replace(needle, '#  if defined(__wasi__) || (defined(__wasm__) && !defined(__linux__))\n')
phases = []
for status in (T / 'status').glob('*.json'):
    row = json.loads(status.read_text())
    if isinstance(row, dict) and all(k in row for k in ('phase', 'pgid', 'state')):
        phases.append(row)
active = {int(x) for x in subprocess.check_output(['ps', '-eo', 'pgid='], text=True).split()}
assert all(r['state'] == 'completed' and r['pgid'] not in active for r in phases)
backup = T / 'tagged-mmap-preflight' / 'original-TaggedAnonymousMemory.h'
backup.parent.mkdir(exist_ok=True)
assert not backup.exists()
backup.write_text(old)
patch = ''.join(difflib.unified_diff(old.splitlines(True), new.splitlines(True), fromfile='a/' + name, tofile='b/' + name))
(T / 'patches/nightly-native-tagged-mmap-include.patch').write_text(patch)
proof = {
    'scope': 'Only native Linux/Wasm sys/mman declaration include; runtime branches and historical architecture patch unchanged',
    'original_sha256': hashlib.sha256(old.encode()).hexdigest(),
    'updated_sha256': hashlib.sha256(new.encode()).hexdigest(),
    'original_backup': str(backup),
    'owned_phase_groups_empty_before_apply': True,
    'applied': '--apply' in sys.argv,
}
if '--apply' in sys.argv:
    assert p.read_text() == old
    p.write_text(new)
(T / 'status/native-tagged-mmap-port.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof))
