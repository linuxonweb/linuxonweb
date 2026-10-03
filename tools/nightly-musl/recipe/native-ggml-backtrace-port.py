from pathlib import Path
import difflib, hashlib, json, subprocess, sys
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
name='third_party/llama.cpp/ggml/src/ggml-c.c'
p=T/'source/firefox-159.0a1'/name; old=p.read_text()
assert hashlib.sha256(old.encode()).hexdigest()=='24a243dc86572d9b5301012e943982a7d624f2d0a355d07904d8fe3498169f95'
needle='#if defined(__linux__) || \\\n    defined(__FreeBSD__)'
assert old.count(needle)==1
new=old.replace(needle,'#if (defined(__linux__) && !(defined(__wasm__) && !defined(__wasi__))) || \\\n    defined(__FreeBSD__)')
groups=set(map(int,subprocess.check_output(['ps','-eo','pgid='],text=True).split()))
for status in (T/'status').glob('*.json'):
    row=json.loads(status.read_text())
    if isinstance(row,dict) and all(k in row for k in ('phase','pgid','state')):
        assert row['state']=='completed' and row['pgid'] not in groups,status
backup=T/'ggml-backtrace-preflight/original-ggml-c.c'
backup.parent.mkdir(exist_ok=True); assert not backup.exists(); backup.write_text(old)
(T/'patches/nightly-native-ggml-backtrace.patch').write_text(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+name,tofile='b/'+name)))
proof=dict(scope='Only native Linux/Wasm selects existing unsupported debugger-backtrace fallback; inference, abort/callback/message and other platforms untouched',original_sha256=hashlib.sha256(old.encode()).hexdigest(),updated_sha256=hashlib.sha256(new.encode()).hexdigest(),original_backup=str(backup),owned_phase_groups_empty_before_apply=True,applied='--apply' in sys.argv)
if '--apply' in sys.argv:
    assert p.read_text()==old; p.write_text(new)
(T/'status/native-ggml-backtrace-port.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(proof))
