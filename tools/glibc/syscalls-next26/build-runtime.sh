#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/env.sh"
source "$ROOT/../probes/gnu-flags.sh"
python3 - <<'PY'
import os,pathlib
T=pathlib.Path(os.environ['GLIBC_TASK']);p=T/'source/startup.c';s=p.read_text()
assert 'next26_tests' not in s
s=s.replace('extern int fixed_thread_test(unsigned);','extern int fixed_thread_test(unsigned);\nextern int next26_thread_test(unsigned);')
assert s.count(' c->errors+=!fixed_thread_test(i);')==2
s=s.replace(' c->errors+=!fixed_thread_test(i);',' c->errors+=!fixed_thread_test(i);\n c->errors+=!next26_thread_test(i);')
s=s.replace('extern void fixed_tests(void);','extern void fixed_tests(void);\nextern void next26_tests(void);\nextern int next26_setsid_process(void),next26_chroot_process(void),next26_exec_target_fresh(void);\nextern void next26_exec_process(void);\nvoid next26_record(const char *name,int success){check(name,success);}\nint next26_raw(int n,int a,int b,int c,int d,int e,int f){return sc(n,a,b,c,d,e,f);}')
old=' if(startup.argc>1&&!strcmp(startup.argv[1],"fixed-setpgid"))'
assert s.count(old)==1
modes=' if(startup.argc>1&&!strcmp(startup.argv[1],"next26-setsid")){int ok=next26_setsid_process();put(ok?"GNU_NEXT26_SETSID isolated=create,query,reject result=PASS\\n":"GNU_NEXT26_SETSID FAIL\\n");_exit(ok?0:99); }\n'
modes+=' if(startup.argc>1&&!strcmp(startup.argv[1],"next26-chroot")){int ok=next26_chroot_process();put(ok?"GNU_NEXT26_CHROOT isolated=sentinel,restricted-root result=PASS\\n":"GNU_NEXT26_CHROOT FAIL\\n");_exit(ok?0:99); }\n'
modes+=' if(startup.argc>1&&!strcmp(startup.argv[1],"next26-exec")){next26_exec_process();_exit(99); }\n'
modes+=' if(startup.argc>1&&!strcmp(startup.argv[1],"next26-exec-target")){int ok=startup.argc==3&&!strcmp(startup.argv[0],"/bin/gnu-allocator-probe")&&!strcmp(startup.argv[2],"gnu-public-exec")&&startup.envc==2&&!strcmp(startup.envp[0],"GLIBC_TUNABLES=glibc.malloc.arena_max=1")&&!strcmp(startup.envp[1],"GNU_NEXT26_EXEC=environment-sentinel")&&next26_exec_target_fresh()&&!THREAD_SELF->cleanup&&descriptor_valid(0)&&ctor_count==1&&ctor_saw_ready&&!errno;put(ok?"GNU_NEXT26_EXEC_TARGET argv=sentinel env=sentinel TLS=fresh chain=empty status=43\\n":"GNU_NEXT26_EXEC_TARGET FAIL\\n");_exit(ok?43:99); }\n'
s=s.replace(old,modes+old)
assert s.count(' int fixed_before=failures;fixed_tests();')==1
s=s.replace(' int fixed_before=failures;fixed_tests();',' int next26_before=failures;next26_tests();\n put(failures==next26_before?"GNU_NEXT26_SYSCALLS public=26 capabilities=4ENOSYS result=PASS\\n":"GNU_NEXT26_SYSCALLS FAIL\\n");\n int fixed_before=failures;fixed_tests();')
s=s.replace(' check("fenv-parent-thread-canary",fenv_thread_test(0));',' check("fenv-parent-thread-canary",fenv_thread_test(0));\n int next26_threads_ok=next26_thread_test(0)&&!children[0].errors&&!children[1].errors;\n check("next26-parent-thread-canary",next26_threads_ok);\n put(next26_threads_ok?"GNU_NEXT26_THREADS errno=isolated failures=real result=PASS\\n":"GNU_NEXT26_THREADS FAIL\\n");')
p.write_text(s)
PY
bash "$ROOT/build-signal.sh"
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/next26-fixture.d" -c "$ROOT/fixture.c" -o "$TASK/objects/guest/next26-fixture.o" > "$TASK/logs/next26-fixture.log" 2>&1
cp "$TASK/objects/next26-signatures.o" "$TASK/objects/guest/next26-signatures.o"
python3 "$ROOT/compiler.py" "${flags[@]}" -MMD -MF "$TASK/objects/next26-startup.d" -c "$TASK/source/startup.c" -o "$TASK/objects/guest/startup.o" > "$TASK/logs/next26-startup.log" 2>&1
printf '%s\n' "$TASK/objects/guest/"*.o > "$TASK/logs/next26-link-inputs.txt"
"$TOOLCHAIN/bin/wasm-ld" --no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 --error-limit=0 --import-memory --export-table -z stack-size=65536 --export=__wasm_init_tls --export=__tls_size --export=__tls_align --export=__heap_base --export=__errno_location --export=cleanup_test_tag --export=cleanup_throw --thinlto-cache-dir="$TASK/cache/lto-next26" -Map "$TASK/logs/next26-link-map.txt" "$TASK/objects/guest/"*.o -o "$TASK/objects/next26.wasm" > "$TASK/logs/next26-link.log" 2>&1
wasm-validate --enable-all "$TASK/objects/next26.wasm"
wasm-objdump -x "$TASK/objects/next26.wasm" > "$TASK/logs/next26-abi.log"
storage_check
