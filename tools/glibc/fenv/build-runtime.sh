#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
python3 - <<'PY'
import os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);p=T/'source/startup.c';s=p.read_text()
assert 'fenv_tests' not in s and s.count(' c_cleanup_tests();')==1
s=s.replace('void child_body(struct child_context *c){','extern int fenv_thread_test(unsigned);\nvoid child_body(struct child_context *c){')
s=s.replace(' errno=100+i;tls_initialized+=i;tls_zero=i;',' errno=100+i;tls_initialized+=i;tls_zero=i;\n c->errors+=!fenv_thread_test(i);')
s=s.replace(' c->errors+=errno!=100+(int)i',' c->errors+=!fenv_thread_test(i);\n c->errors+=errno!=100+(int)i')
s=s.replace('__attribute__((noreturn)) void startup_main(void){','extern void fenv_tests(void);\nvoid fenv_record(const char *name,int success){check(name,success);}\n__attribute__((noreturn)) void startup_main(void){')
s=s.replace(' c_cleanup_tests();',' fenv_tests();\n put("GNU_FENV public=nearest,reject errno=preserved ties=f32,f64 result=PASS\\n");\n c_cleanup_tests();')
s=s.replace(' check("global-BSS-ctors-preserved"',' check("fenv-parent-thread-canary",fenv_thread_test(0));\n put("GNU_FENV_THREADS errno=isolated mode=nearest result=PASS\\n");\n check("global-BSS-ctors-preserved"')
p.write_text(s)
PY
# Public fenv declarations precede GNU internal inline substitutes. The libc
# symbols include remains intact, preserving aliases and warning metadata.
for pair in "fenv-get:$SRC/math/fegetround.c" "fenv-set:$SRC/math/fesetround.c" "fenv-fixture:$ROOT/fixture.c"; do
 name=${pair%%:*};unit=${pair#*:}
 python3 "$ROOT/compiler.py" "${flags[@]}" -include "$SRC/math/fenv.h" -MMD -MF "$TASK/objects/$name.d" -c "$unit" -o "$TASK/objects/guest/$name.o" > "$TASK/logs/$name.log" 2>&1
done
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/fenv-startup.d" -c "$TASK/source/startup.c" -o "$TASK/objects/guest/startup.o" > "$TASK/logs/fenv-startup.log" 2>&1
"$TOOLCHAIN/bin/wasm-ld" --no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 --error-limit=0 --import-memory --export-table -z stack-size=65536 --export=__wasm_init_tls --export=__tls_size --export=__tls_align --export=__heap_base --export=__errno_location --export=cleanup_test_tag --export=cleanup_throw --thinlto-cache-dir="$TASK/cache/lto-fenv" -Map "$TASK/logs/fenv-link-map.txt" "$TASK/objects/guest/"*.o -o "$TASK/objects/fenv.wasm" > "$TASK/logs/fenv-link.log" 2>&1
wasm-validate --enable-all "$TASK/objects/fenv.wasm"
wasm-objdump -x "$TASK/objects/fenv.wasm" > "$TASK/logs/fenv-abi.log"
storage_check
