#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
python3 - <<'PY'
import os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);p=T/'source/startup.c';s=p.read_text()
assert 'fixed_tests' not in s
s=s.replace('extern int fenv_thread_test(unsigned);','extern int fenv_thread_test(unsigned);\nextern int fixed_thread_test(unsigned);')
assert s.count(' c->errors+=!fenv_thread_test(i);')==2
s=s.replace(' c->errors+=!fenv_thread_test(i);',' c->errors+=!fenv_thread_test(i);\n c->errors+=!fixed_thread_test(i);')
s=s.replace('extern void fenv_tests(void);','extern void fenv_tests(void);\nextern void fixed_tests(void);\nextern int fixed_setpgid_process(void);\nvoid fixed_record(const char *name,int success){check(name,success);}\nint fixed_raw(int n,int a,int b,int c,int d,int e,int f){return sc(n,a,b,c,d,e,f);}')
old=' if(startup.argc>1&&!strcmp(startup.argv[1],"cleanup-abort"))'
assert s.count(old)==1
s=s.replace(old,' if(startup.argc>1&&!strcmp(startup.argv[1],"fixed-setpgid")){int ok=fixed_setpgid_process();put(ok?"GNU_FIXED_SETPGID isolated=create,restore result=PASS\\n":"GNU_FIXED_SETPGID FAIL\\n");_exit(ok?0:99); }\n'+old)
assert s.count(' fenv_tests();')==1
s=s.replace(' fenv_tests();',' int fixed_before=failures;fixed_tests();\n put(failures==fixed_before?"GNU_FIXED_SYSCALLS public=36 capabilities=5ENOSYS,xattr-ramfs result=PASS\\n":"GNU_FIXED_SYSCALLS FAIL\\n");\n fenv_tests();')
s=s.replace(' check("fenv-parent-thread-canary",fenv_thread_test(0));',' check("fenv-parent-thread-canary",fenv_thread_test(0));\n int fixed_threads_ok=fixed_thread_test(0)&&!children[0].errors&&!children[1].errors;\n check("fixed-parent-thread-canary",fixed_threads_ok);\n put(fixed_threads_ok?"GNU_FIXED_THREADS errno=isolated failures=real result=PASS\\n":"GNU_FIXED_THREADS FAIL\\n");')
p.write_text(s)
PY
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/fixed-fixture.d" -c "$ROOT/fixture.c" -o "$TASK/objects/guest/fixed-fixture.o" > "$TASK/logs/fixed-fixture.log" 2>&1
cp "$TASK/objects/fixed-signatures.o" "$TASK/objects/guest/fixed-signatures.o"
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/fixed-startup.d" -c "$TASK/source/startup.c" -o "$TASK/objects/guest/startup.o" > "$TASK/logs/fixed-startup.log" 2>&1
"$TOOLCHAIN/bin/wasm-ld" --no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 --error-limit=0 --import-memory --export-table -z stack-size=65536 --export=__wasm_init_tls --export=__tls_size --export=__tls_align --export=__heap_base --export=__errno_location --export=cleanup_test_tag --export=cleanup_throw --thinlto-cache-dir="$TASK/cache/lto-fixed" -Map "$TASK/logs/fixed-link-map.txt" "$TASK/objects/guest/"*.o -o "$TASK/objects/fixed.wasm" > "$TASK/logs/fixed-link.log" 2>&1
wasm-validate --enable-all "$TASK/objects/fixed.wasm"
wasm-objdump -x "$TASK/objects/fixed.wasm" > "$TASK/logs/fixed-abi.log"
storage_check
