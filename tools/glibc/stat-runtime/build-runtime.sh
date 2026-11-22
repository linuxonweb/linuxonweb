#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
python3 "$ROOT/compile-signatures.py"
python3 - <<'EDIT'
import os,pathlib,shutil,json
T=pathlib.Path(os.environ['GLIBC_TASK']);p=T/'source/startup.c';s=p.read_text();assert 'stat_tests' not in s
s=s.replace('extern int next26_thread_test(unsigned);','extern int next26_thread_test(unsigned);\nextern int stat_thread_test(unsigned);')
assert s.count(' c->errors+=!next26_thread_test(i);')==2
s=s.replace(' c->errors+=!next26_thread_test(i);',' c->errors+=!next26_thread_test(i);\n c->errors+=!stat_thread_test(i);')
s=s.replace('extern void next26_tests(void);','extern void next26_tests(void);\nextern void stat_tests(void);\nvoid stat_record(const char *name,int success){check(name,success); }\nint stat_raw(int n,int a,int b,int c,int d,int e,int f){return sc(n,a,b,c,d,e,f); }')
assert s.count(' int next26_before=failures;next26_tests();')==1
s=s.replace(' int next26_before=failures;next26_tests();',' int stat_before=failures;stat_tests();\n put(failures==stat_before?"GNU_STAT public=8 raw=statx time64=beyond2038 result=PASS\\n":"GNU_STAT FAIL\\n");\n int next26_before=failures;next26_tests();')
assert s.count(' int next26_threads_ok=')==1
s=s.replace(' int next26_threads_ok=',' int stat_threads_ok=stat_thread_test(0)&&!children[0].errors&&!children[1].errors;\n check("stat-thread-errno-canaries",stat_threads_ok);\n put(stat_threads_ok?"GNU_STAT_THREADS errno=isolated result=PASS\\n":"GNU_STAT_THREADS FAIL\\n");\n int next26_threads_ok=')
q=T/'source-snapshots/startup-before-stat.c';assert not q.exists();shutil.copy2(p,q);p.write_text(s)
for row in json.loads((T/'logs/stat-build/result.json').read_text())['objects']:
 src=T/'objects/fullmake'/row['unit'];dst=T/'objects/guest'/('stat-'+src.name);assert not dst.exists();shutil.copy2(src,dst)
shutil.copy2(T/'objects/stat-signatures.o',T/'objects/guest/stat-signatures.o')
EDIT
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/stat-fixture.d" -c "$ROOT/fixture.c" -o "$TASK/objects/guest/stat-fixture.o" > "$TASK/logs/stat-fixture.log" 2>&1
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/stat-startup.d" -c "$TASK/source/startup.c" -o "$TASK/objects/guest/startup.o" > "$TASK/logs/stat-startup.log" 2>&1
printf '%s\n' "$TASK/objects/guest/"*.o > "$TASK/logs/stat-link-inputs.txt"
"$TOOLCHAIN/bin/wasm-ld" --no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 --error-limit=0 --import-memory --export-table -z stack-size=65536 --export=__wasm_init_tls --export=__tls_size --export=__tls_align --export=__heap_base --export=__errno_location --export=cleanup_test_tag --export=cleanup_throw --thinlto-cache-dir="$TASK/cache/lto-stat" -Map "$TASK/logs/stat-link-map.txt" "$TASK/objects/guest/"*.o -o "$TASK/objects/stat-runtime.wasm" > "$TASK/logs/stat-link.log" 2>&1
wasm-validate --enable-all "$TASK/objects/stat-runtime.wasm"
wasm-objdump -x "$TASK/objects/stat-runtime.wasm" > "$TASK/logs/stat-abi.log"
storage_check
