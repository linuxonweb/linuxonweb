#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/../probes/gnu-flags.sh"
python3 "$ROOT/select-generated.py"
for input in "$TASK/source/selected-syscalls/"*.c; do
 storage_check
 name=$(basename "$input" .c)
 "$TOOLCHAIN/bin/clang" "${flags[@]}" -flto=thin -MMD -MF "$TASK/objects/generated-$name.d" -c "$input" -o "$TASK/objects/guest/generated-$name.o" > "$TASK/logs/generated-$name.log" 2>&1
done
python3 - <<'PY'
from pathlib import Path
import os
t=Path(os.environ['GLIBC_TASK']);root=Path(os.environ['PORT_ROOT'])/'syscalls'
p=t/'source/startup.c';s=p.read_text();assert s.count(' jump_tests();')==1
fixture=(root/'fixture.c').read_text()
s=s.replace('__attribute__((noreturn)) void startup_main(void){',fixture+'\n__attribute__((noreturn)) void startup_main(void){')
s=s.replace(' jump_tests();',' jump_tests();\n generated_syscall_tests();');p.write_text(s)
# Remove only the superseded owned two-thunk provider, never GNU objects.
p=t/'objects/guest/wasm-basic-syscalls.o'
assert (t/'objects/guest/generated-getpid.o').exists() and (t/'objects/guest/generated-gettid.o').exists()
if p.exists():p.unlink()
PY
bash "$ROOT/../jumps/build.sh"
cp "$TASK/objects/jumps.wasm" "$TASK/objects/generated-syscalls.wasm"
python3 - <<'PY'
from pathlib import Path
import os,json,hashlib
t=Path(os.environ['GLIBC_TASK'])
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
objects=sorted((t/'objects/guest').glob('*.o'))
assert not (t/'objects/guest/wasm-basic-syscalls.o').exists()
(t/'logs/guest-link-inputs.json').write_text(json.dumps({'noOwnedPidThunks':True,'objects':{str(p):sha(p) for p in objects},'payload':sha(t/'objects/generated-syscalls.wasm')},indent=2)+'\n')
PY
