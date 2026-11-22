#!/bin/bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")" && pwd)
source "$ROOT/../probes/gnu-flags.sh"
storage_check
"$TOOLCHAIN/bin/clang" "${flags[@]}" -MMD -MF "$TASK/objects/signatures.d" -c "$ROOT/signatures.c" -o "$TASK/objects/signatures.o" > "$TASK/logs/signatures.log" 2>&1
dest=$(mktemp -d "$TASK/tmp/syscall-rejection-XXXXXX")
cat > "$dest/unaudited.c" <<'EOF'
#define SYSCALL_NAME lseek
#define SYSCALL_NARGS 3
#define SYSCALL_SYMBOL __wasm_unaudited_lseek
#define SYSCALL_NOERRNO 0
#define SYSCALL_ERRVAL 0
#include <syscall-template.S>
EOF
set +e
"$TOOLCHAIN/bin/clang" "${flags[@]}" -c "$dest/unaudited.c" -o "$dest/unaudited.o" > "$dest/diagnostic.log" 2>&1
status=$?
set -e
[ "$status" -ne 0 ]
rg -q 'GNU generated syscall has no audited native Wasm public signature' "$dest/diagnostic.log"
printf '%s\n' "$status" > "$dest/exit"
python3 - "$dest" <<'PY'
from pathlib import Path
import os,sys,json,hashlib,subprocess
t=Path(os.environ['GLIBC_TASK']);tool=Path(os.environ['GLIBC_TOOLCHAIN'])/'bin'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
objects=sorted((t/'objects/guest').glob('*.o'))
assert not (t/'objects/guest/wasm-basic-syscalls.o').exists()
symbols={}
for p in objects:
 if p.name.startswith('generated-'):
  symbols[p.name]=subprocess.check_output([str(tool/'llvm-nm'),'--defined-only',str(p)],text=True)
report={'pass':True,'GNUHeaderSignatureAudit':'signatures.o','rejectedUnauditedOff64':sys.argv[1],'noOwnedPidThunks':True,'objects':{str(p):sha(p) for p in objects},'generatedSymbols':symbols,'payload':sha(t/'objects/generated-syscalls.wasm'),'fpcastPayload':sha(t/'objects/generated-syscalls-fpcast.wasm')}
(t/'logs/guest-link-inputs.json').write_text(json.dumps(report,indent=2)+'\n')
(t/'accepted-runtime-before-final-make.json').write_text(json.dumps({str(t/'objects'/n):sha(t/'objects'/n) for n in ['generated-syscalls.wasm','generated-syscalls-fpcast.wasm']},indent=2)+'\n')
PY
