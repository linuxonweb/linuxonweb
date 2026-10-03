from pathlib import Path
import difflib,hashlib,json,subprocess,sys
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002')
name='third_party/llama.cpp/src/llama-mmap.cpp';source=T/'source/firefox-159.0a1'/name;old=source.read_text()
assert hashlib.sha256(old.encode()).hexdigest()=='743e75fc6f0161b82d6d01bc8d266fb27cac5fdf967ffde07fe11c249ee1e372'
needle='        if (prefetch) { flags |= MAP_POPULATE; }\n';assert old.count(needle)==1
new=old.replace(needle,'#ifdef MAP_POPULATE\n'+needle+'#endif\n')
needle='struct llama_mlock::impl {\n#ifdef _POSIX_MEMLOCK_RANGE';assert new.count(needle)==1
new=new.replace(needle,'struct llama_mlock::impl {\n#if defined(_POSIX_MEMLOCK_RANGE) && !(defined(__linux__) && defined(__wasm__) && !defined(__wasi__))')
needle='#if defined(_POSIX_MEMLOCK_RANGE) || defined(_WIN32)\nconst bool llama_mlock::SUPPORTED = true;';assert new.count(needle)==1
new=new.replace(needle,'#if (defined(_POSIX_MEMLOCK_RANGE) && !(defined(__linux__) && defined(__wasm__) && !defined(__wasi__))) || defined(_WIN32)\nconst bool llama_mlock::SUPPORTED = true;')
groups=set(map(int,subprocess.check_output(['ps','-eo','pgid='],text=True).split()))
for p in (T/'status').glob('*.json'):
 d=json.loads(p.read_text())
 if isinstance(d,dict) and all(k in d for k in ('phase','pgid','state')):assert d['state']=='completed' and d['pgid'] not in groups,p
P=T/'llama-mapping-preflight';P.mkdir(exist_ok=True);original=P/'original-llama-mmap.cpp';assert not original.exists();original.write_text(old)
patch=T/'patches/nightly-native-llama-mapping.patch';patch.write_text(''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+name,tofile='b/'+name)))
if '--apply' in sys.argv:assert source.read_text()==old;source.write_text(new)
(T/'status/native-llama-mapping-port.json').write_text(json.dumps(dict(scope='Only optional populate hint and unsupported native Wasm page locking; actual file mmap and prefetch retained',original_sha256=hashlib.sha256(old.encode()).hexdigest(),updated_sha256=hashlib.sha256(new.encode()).hexdigest(),original_backup=str(original),owned_groups_empty_before_apply=True,applied='--apply' in sys.argv),indent=2)+'\n')
