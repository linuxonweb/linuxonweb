"""Read-only exact 552-consumer coherence and formerly failing VM unit proof."""
from pathlib import Path
import hashlib, json, subprocess, time

T = Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
status_path = T / 'status/js-vm-run1.json'
status = json.loads(status_path.read_text())
assert status['state'] == 'completed' and status['exit_code'] == 0
assert status['phase'] == 'js-vm' and status['run'] == 'run1'
assert status['argv'][-4:] == ['build', '--allow-subdirectory-build', 'js/src/vm', '-j4']
active = {int(p) for p in subprocess.check_output(['ps', '-eo', 'pgid='], text=True).split()}
assert status['pgid'] not in active
mfbt_status_path = T / 'status/mfbt-run7.json'
mfbt = json.loads(mfbt_status_path.read_text())
assert mfbt['state'] == 'completed' and mfbt['exit_code'] == 0
assert mfbt['argv'][-4:] == ['build', '--allow-subdirectory-build', 'mfbt', '-j2']
assert mfbt['pgid'] not in active
manifest = T / 'status/inttypes-prerequisite-refresh-run1.json'
assert hashlib.sha256(manifest.read_bytes()).hexdigest() == '307ca97d721c1c5964db27c220346cb0c1661f77d290ada9a14645c588bed3ae'
original = json.loads(manifest.read_text())
assert original['count'] == len(original['rows']) == len({r['object'] for r in original['rows']}) == 552
shim = T / 'recipe/shim/inttypes.h'
assert hashlib.sha256(shim.read_bytes()).hexdigest() == original['adapter_sha256']
shim_ns = shim.stat().st_mtime_ns
assert all(r['object_mtime_ns'] < shim_ns for r in original['rows'])
rows = []
for r in original['rows']:
    obj, dep = Path(r['object']), Path(r['dependency'])
    st = obj.stat()
    data = dep.read_bytes()
    marker = ('\n' + obj.name + ': ' + str(shim) + '\n').encode()
    backup = T / 'inttypes-prerequisite-backup/deps' / dep.relative_to(T / 'obj-nightly')
    backup_hash = hashlib.sha256(backup.read_bytes()).hexdigest()
    assert backup_hash == r['before_sha256']
    fresh = st.st_mtime_ns > max(r['object_mtime_ns'], shim_ns, int(original['checked'] * 1e9))
    natural = str(shim).encode() in data and not data.endswith(marker) and b'/nix/store/bp3in3ifwgps003464g4ncrd6yzp9fn9-sysroot/include/inttypes.h' in data
    magic = obj.read_bytes()[:8].hex()
    assert fresh and natural and magic == '0061736d01000000', str(obj)
    rows.append({'object': str(obj), 'mtime_ns': st.st_mtime_ns, 'bytes': st.st_size, 'fresh_since_refresh': fresh, 'native_magic': magic, 'regenerated_dependency_includes_adapter': natural, 'dependency_sha256': hashlib.sha256(data).hexdigest(), 'original_backup': str(backup), 'original_backup_sha256': backup_hash})
header = T / 'source/firefox-159.0a1/mfbt/TaggedAnonymousMemory.h'
vm = T / 'obj-nightly/js/src/vm/Unified_cpp_js_src_vm0.o'
dep = vm.parent / '.deps' / (vm.name + '.pp')
assert vm.stat().st_mtime_ns > max(header.stat().st_mtime_ns, int(status['started'] * 1e9))
assert vm.read_bytes()[:8] == b'\0asm\x01\0\0\0'
data = dep.read_bytes()
header_alias = T / 'obj-nightly/dist/include/mozilla/TaggedAnonymousMemory.h'
assert header_alias.resolve() == header.resolve()
assert all(str(p).encode() in data for p in [header_alias, T / 'recipe/shim/sys/mman.h', shim])
log = T / 'logs/js-vm-run1.log'
assert 'Your build was successful!' in log.read_text() and 'error:' not in log.read_text()
def pin(p):
    data = p.read_bytes()
    return {'path': str(p), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
report = {'claim': 'Exact inttypes prerequisite coherence complete for original 552 consumers and real formerly failing native VM unit compiled; full browser graph/link/guest acceptance remain pending', 'checked': time.time(), 'terminal': status, 'mfbt_terminal': mfbt, 'mfbt_unified_session': {'session_id': 45044, 'reaped': True, 'exit_code': 0}, 'terminal_group_empty': True, 'unified_session': {'session_id': 4409, 'reaped': True, 'exit_code': 0}, 'required_count': 552, 'naturally_regenerated_fresh_count': len(rows), 'all_required_consumers_complete': True, 'original_dependency_backups_verified': len(rows), 'consumers': rows, 'formerly_failing_vm_object': {**pin(vm), 'mtime_ns': vm.stat().st_mtime_ns, 'native_magic': vm.read_bytes()[:8].hex(), 'actual_compile_argv_capture_claim': False}, 'pins': [pin(p) for p in [status_path, mfbt_status_path, T / 'logs/mfbt-run7.log', log, manifest, shim, header, dep, T / 'recipe/shim/sys/mman.h', T / 'tagged-mmap-preflight/original-TaggedAnonymousMemory.h', Path(__file__).resolve()]]}
out = T / 'status/inttypes-coherence-js-vm-run1.json'
assert not out.exists()
out.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: report[k] for k in ['required_count', 'naturally_regenerated_fresh_count', 'all_required_consumers_complete', 'original_dependency_backups_verified', 'formerly_failing_vm_object']}))
