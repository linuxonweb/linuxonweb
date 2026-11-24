#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
python3 - <<'PY'
import os,pathlib
t=pathlib.Path(os.environ['GLIBC_TASK']);p=t/'source/startup.c';s=p.read_text()
assert s.count(' fullmake_tests();')==1
if 'extern void c_cleanup_tests(void);' not in s:
 s=s.replace('__attribute__((noreturn)) void startup_main(void){','extern void c_cleanup_tests(void);\nextern void cleanup_abort(void);\nvoid c_cleanup_record(const char *name,int success){check(name,success);}\n__attribute__((noreturn)) void startup_main(void){')
 s=s.replace(' fullmake_tests();',' fullmake_tests();\n c_cleanup_tests();\n put("GNU_C_CLEANUP native-tag=payload,rethrow once=reset,retry,done chain=restored result=PASS\\n");')
 s=s.replace(' jump_tests();',' if(startup.argc>1&&!strcmp(startup.argv[1],"cleanup-abort")){put("GNU_C_CLEANUP_ABORT throwing-inside-cleanup\\n");cleanup_abort();}\n jump_tests();')
if 'void cleanup_exec_raw' not in s:
 s=s.replace('extern void cleanup_abort(void);','extern void cleanup_abort(void);\nextern void cleanup_exec(char **);\nextern int cleanup_exec_target_fresh(void);\nextern void _exit(int) __attribute__((noreturn));\nvoid cleanup_exec_raw(char **envp){char *args[]={"/bin/gnu-allocator-probe","cleanup-exec-target","exec-sentinel",0};int r=sc(221,(int)args[0],(int)args,(int)envp,0,0,0);check("raw-exec-unexpected-return",0);(void)r;_exit(99);}')
 s=s.replace(' jump_tests();',' if(startup.argc>1&&!strcmp(startup.argv[1],"cleanup-exec")){put("GNU_C_CLEANUP_EXEC active-cleanup raw-kernel-exec221\\n");cleanup_exec(startup.envp);_exit(99); }\n if(startup.argc>1&&!strcmp(startup.argv[1],"cleanup-exec-target")){int ok=startup.argc==3&&!strcmp(startup.argv[0],"/bin/gnu-allocator-probe")&&!strcmp(startup.argv[2],"exec-sentinel")&&cleanup_exec_target_fresh()&&!THREAD_SELF->cleanup&&descriptor_valid(0)&&ctor_count==1&&ctor_saw_ready&&!errno;put(ok?"GNU_C_CLEANUP_EXEC_TARGET argv=sentinel TLS=fresh chain=empty status=42\\n":"GNU_C_CLEANUP_EXEC_TARGET FAIL\\n");_exit(ok?42:99); }\n jump_tests();')
p.write_text(s)
PY
for pair in "cleanup-fixture:$ROOT/fixture.c" "cleanup-compat:$SRC/nptl/cleanup_compat.c"; do
 name=${pair%%:*};unit=${pair#*:}
 python3 "$ROOT/compiler.py" "${flags[@]}" -fexceptions -MMD -MF "$TASK/objects/$name.d" -c "$unit" -o "$TASK/objects/guest/$name.o" > "$TASK/logs/$name.log" 2>&1
done
cp "$TASK/objects/fullmake/nptl/pthread_once.o" "$TASK/objects/guest/cleanup-once.o"
"$TOOLCHAIN/bin/clang" "${flags[@]}" -mexception-handling -c "$ROOT/native-tag.S" -o "$TASK/objects/guest/cleanup-tag.o" > "$TASK/logs/cleanup-tag.log" 2>&1
# Reuse the unchanged jump closure; compile the modified startup once with this driver.
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/cleanup-startup.d" -c "$TASK/source/startup.c" -o "$TASK/objects/guest/startup.o" > "$TASK/logs/cleanup-startup.log" 2>&1
"$TOOLCHAIN/bin/wasm-ld" --no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 --error-limit=0 --import-memory --export-table -z stack-size=65536 --export=__wasm_init_tls --export=__tls_size --export=__tls_align --export=__heap_base --export=__errno_location --export=cleanup_test_tag --export=cleanup_throw --thinlto-cache-dir="$TASK/cache/lto-cleanup" -Map "$TASK/logs/cleanup-link-map.txt" "$TASK/objects/guest/"*.o -o "$TASK/objects/c-cleanup.wasm" > "$TASK/logs/cleanup-link.log" 2>&1
wasm-validate --enable-all "$TASK/objects/c-cleanup.wasm"
wasm-objdump -x "$TASK/objects/c-cleanup.wasm" > "$TASK/logs/cleanup-abi.log"
storage_check
