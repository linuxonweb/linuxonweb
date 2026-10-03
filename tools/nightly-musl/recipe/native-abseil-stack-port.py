from pathlib import Path
import difflib, hashlib, json, subprocess, sys

T = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
name = 'third_party/abseil-cpp/absl/debugging/internal/examine_stack.cc'
p = T / 'source/firefox-159.0a1' / name
old = p.read_text()
assert hashlib.sha256(old.encode()).hexdigest() == 'cab6f0f7190ef26884be4e7ef777bcb1913bf629587a9a8d0bda838d21868073'
needle = 'void* GetProgramCounter(void* const vuc) {\n#ifdef __linux__\n'
assert old.count(needle) == 1
new = old.replace(needle, 'void* GetProgramCounter(void* const vuc) {\n#if defined(__linux__) && !(defined(__wasm__) && !defined(__wasi__))\n')
active = set(map(int, subprocess.check_output(['ps', '-eo', 'pgid='], text=True).split()))
for status in (T / 'status').glob('*.json'):
    row = json.loads(status.read_text())
    if isinstance(row, dict) and all(k in row for k in ('phase', 'pgid', 'state')):
        assert row['state'] == 'completed' and row['pgid'] not in active, status
backup = T / 'abseil-stack-preflight' / 'original-examine_stack.cc'
backup.parent.mkdir(exist_ok=True)
assert not backup.exists()
backup.write_text(old)
patch = ''.join(difflib.unified_diff(old.splitlines(True), new.splitlines(True), fromfile='a/'+name, tofile='b/'+name))
(T/'patches/nightly-native-abseil-stack.patch').write_text(patch)
proof = dict(scope='Only native Linux/Wasm selects the existing unknown-program-counter nullptr fallback; stack dumping, other targets and signal ABI untouched', original_sha256=hashlib.sha256(old.encode()).hexdigest(), updated_sha256=hashlib.sha256(new.encode()).hexdigest(), original_backup=str(backup), owned_phase_groups_empty_before_apply=True, applied='--apply' in sys.argv)
if '--apply' in sys.argv:
    assert p.read_text() == old
    p.write_text(new)
(T/'status/native-abseil-stack-port.json').write_text(json.dumps(proof, indent=2)+'\n')
print(json.dumps(proof))
