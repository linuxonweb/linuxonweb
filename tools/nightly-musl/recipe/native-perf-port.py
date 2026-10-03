from pathlib import Path
import hashlib,json,difflib,subprocess,sys
T=Path('/mnt/p6/build/firefox-nightly-musl-recovery-20261002'); S=T/'source/firefox-159.0a1'
name='js/src/builtin/Profilers.cpp'; p=S/name; old=p.read_text()
assert hashlib.sha256(old.encode()).hexdigest()=='feefba5f301c29460e6dcc8c91d822936a9e6c430f1954db749c723c5d97ec42'
assert old.count('static bool perfInitialized = false;')==1
assert old.count('  /*\n   * Delete mozperf.data the first time through')==1
assert old.count('  UnsafeError("js_StartPerf: fork() failed\\n");\n  return false;\n}')==1
new=old.replace('static bool perfInitialized = false;', '#  if !defined(__wasm__) || defined(__wasi__)\nstatic bool perfInitialized = false;\n#  endif')
new=new.replace('  /*\n   * Delete mozperf.data the first time through', '#  if defined(__wasm__) && !defined(__wasi__)\n  UnsafeError("js_StartPerf: external perf is unavailable on native Linux/Wasm\\n");\n  return false;\n#  else\n  /*\n   * Delete mozperf.data the first time through')
new=new.replace('  UnsafeError("js_StartPerf: fork() failed\\n");\n  return false;\n}', '  UnsafeError("js_StartPerf: fork() failed\\n");\n  return false;\n#  endif\n}')
statuses=[json.loads(p.read_text()) for p in (T/'status').glob('*.json')]
phases=[r for r in statuses if isinstance(r,dict) and 'phase' in r and 'pgid' in r and 'state' in r]
active={int(x) for x in subprocess.check_output(['ps','-eo','pgid='],text=True).split()}
assert all(r['state']=='completed' and r['pgid'] not in active for r in phases)
patch=''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+name,tofile='b/'+name))
(T/'patches/nightly-native-perf.patch').write_text(patch)
proof={'scope':'Only optional external Linux perf launcher; no Gecko profiler change','native_predicate':'outer __linux__, inner __wasm__ && !__wasi__','no_env_noop_preserved':True,'requested_native_perf_returns_false_before_unlink':True,'original_sha256':hashlib.sha256(old.encode()).hexdigest(),'updated_sha256':hashlib.sha256(new.encode()).hexdigest(),'owned_phase_groups_empty_before_apply':True,'applied':'--apply' in sys.argv}
if '--apply' in sys.argv: p.write_text(new)
(T/'status/native-perf-port.json').write_text(json.dumps(proof,indent=2));print(json.dumps(proof,indent=2))
