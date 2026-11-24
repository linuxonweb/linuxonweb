#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/../probes/gnu-flags.sh"
# First run the frozen generated wrapper gate in this fresh task only.
if [ "${1:-}" != --base-ready ]; then bash "$ROOT/../syscalls/build.sh"; fi
for pair in "revoke:misc/revoke.c" "sigstack:sysdeps/unix/sysv/linux/sigstack.c" "sigreturn:signal/sigreturn.c"; do
 name=${pair%%:*};unit=${pair#*:}
 "$ROOT/compiler.py" "${flags[@]}" -MD -MF "$TASK/objects/warning-$name.d" -c "$SRC/$unit" -o "$TASK/objects/guest/warning-$name.o" > "$TASK/logs/warning-$name.log" 2>&1
done
python3 - <<'PY'
import os,pathlib,re,json,hashlib
t=pathlib.Path(os.environ['GLIBC_TASK']);root=pathlib.Path(os.environ['PORT_ROOT'])/'fullmake'
s=(t/'objects/fullmake/sysd-syscalls').read_text()
b=re.search(r'^#### CALL=sigaltstack NUMBER=.*?(?=^#### CALL=|\Z)',s,re.M|re.S).group()
stream='\n'.join(re.findall(r"echo '([^']*)'",b))+'\n'
(t/'source/sigaltstack-generated.c').write_text(stream)
(t/'logs/sigaltstack-selection.json').write_text(json.dumps({'GNUrule':b.splitlines()[0],'streamSHA256':hashlib.sha256(stream.encode()).hexdigest()},indent=2)+'\n')
p=t/'source/startup.c';s=p.read_text();assert s.count(' generated_syscall_tests();')==1
s=s.replace('__attribute__((noreturn)) void startup_main(void){',(root/'fixture.c').read_text()+'\n__attribute__((noreturn)) void startup_main(void){')
s=s.replace(' generated_syscall_tests();',' generated_syscall_tests();\n fullmake_tests();');p.write_text(s)
PY
"$ROOT/compiler.py" "${flags[@]}" -MD -MF "$TASK/objects/warning-sigaltstack.d" -c "$TASK/source/sigaltstack-generated.c" -o "$TASK/objects/guest/warning-sigaltstack.o" > "$TASK/logs/warning-sigaltstack.log" 2>&1
bash "$ROOT/../jumps/build.sh"
cp "$TASK/objects/jumps.wasm" "$TASK/objects/fullmake-warnings.wasm"
"$TOOLCHAIN/bin/llvm-objdump" -h "$TASK/objects/guest/"warning-*.o > "$TASK/logs/guest-warning-sections.txt"
