#!/bin/bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/probes/gnu-flags.sh"
mode=${1:?usage: build.sh host|guest}
[[ "$mode" = host || "$mode" = guest ]] || exit 2
OBJECT_DIR="$TASK/objects/$mode"
[ ! -e "$OBJECT_DIR" ] || { echo 'Object destination exists; use a new task' >&2; exit 2; }
mkdir "$OBJECT_DIR"
python3 "$PORT_ROOT/verify-gnu-units.py"
cmp "$PORT_ROOT/port/libc_sigaction.c" "$SRC/sysdeps/unix/sysv/linux/wasm32/libc_sigaction.c"
flags+=(-DTOP_NAMESPACE=glibc -I "$SRC/wcsmbs" -I "$SRC/iconv")
printf -v compiler '%q ' "$TOOLCHAIN/bin/clang" "${flags[@]}"
python3 "$SRC/scripts/gen-as-const.py" --cc "$compiler" "$SRC/csu/sem_t-align.sym" > "$OBJ/sem_t-align.h"
python3 "$SRC/locale/gen-translit.py" < "$SRC/locale/C-translit.h.in" > "$OBJ/C-translit.h"
while read -r item; do
 storage_check
 name=${item//\//-}
 extra=()
 # Genuine constant-false cancellation branch is removed by ThinLTO.
 [ "$item" != nptl/futex-internal ] || extra+=(-flto=thin)
 [ "$item" != malloc/malloc ] || extra+=(-DUSE_TCACHE=1 -DMORECORE_CLEARS=2)
 "$TOOLCHAIN/bin/clang" "${flags[@]}" "${extra[@]}" -MMD -MF "$OBJECT_DIR/$name.d" -c "$SRC/$item.c" -o "$OBJECT_DIR/$name.o" > "$TASK/logs/$mode-$name.log" 2>&1
done < "$PORT_ROOT/port/gnu-source-list.txt"
for item in wasm-memory wasm-basic-syscalls libc_sigaction; do
 "$TOOLCHAIN/bin/clang" "${flags[@]}" -MMD -MF "$OBJECT_DIR/$item.d" -c "$PORT_ROOT/port/$item.c" -o "$OBJECT_DIR/$item.o"
done
common=(--no-entry --shared-memory --initial-memory=2097152 --max-memory=16777216 --error-limit=0)
if [ "$mode" = host ]; then
 "$TOOLCHAIN/bin/clang" "${flags[@]}" -MMD -MF "$OBJECT_DIR/fixture.d" -c "$PORT_ROOT/probes/allocator-fixture.c" -o "$OBJECT_DIR/fixture.o"
 "$TOOLCHAIN/bin/clang" --target=wasm32-unknown-linux-gnu -c "$PORT_ROOT/port/tls-metadata.s" -o "$OBJECT_DIR/metadata.o"
 common+=(--export-memory --export=malloc --export=calloc --export=realloc --export=free --export=fixture_init --export=fixture_errno --export=fixture_heap_base --export=fixture_thread_pointer --export=fixture_perturb --export=__wasm_memory_cursor --export=__sbrk --export=__mmap --export=__munmap --export=__mremap --export=__mprotect --export=__wasm_memory_init)
 output="$TASK/objects/gnu-allocator-production.wasm"
else
 "$TOOLCHAIN/bin/clang" --target=wasm32-unknown-linux-gnu -c "$PORT_ROOT/source/entry.s" -o "$OBJECT_DIR/entry.o"
 "$TOOLCHAIN/bin/clang" "${flags[@]}" -MMD -MF "$OBJECT_DIR/startup.d" -c "$PORT_ROOT/source/startup.c" -o "$OBJECT_DIR/startup.o"
 common+=(--import-memory --export-table -z stack-size=65536 --export=__wasm_init_tls --export=__tls_size --export=__tls_align --export=__heap_base --export=__errno_location)
 output="$TASK/objects/allocator.wasm"
fi
printf '%q ' "$TOOLCHAIN/bin/wasm-ld" "${common[@]}" "$OBJECT_DIR/"*.o > "$TASK/logs/$mode-link-command.txt"
"$TOOLCHAIN/bin/wasm-ld" "${common[@]}" --thinlto-cache-dir="$TASK/cache/lto-$mode" -Map "$TASK/logs/$mode-link-map.txt" "$OBJECT_DIR/"*.o -o "$output" > "$TASK/logs/$mode-link.log" 2>&1
wasm-validate --enable-all "$output"
wasm-objdump -x "$output" > "$TASK/logs/$mode-abi.log"
wasm-objdump -d "$output" > "$TASK/logs/$mode-disassembly.log"
python3 "$PORT_ROOT/verify-gnu-units.py"
# Deliberately expose real cancellable GNU helper: it MUST remain a hard failure.
set +e
"$TOOLCHAIN/bin/wasm-ld" "${common[@]}" --export=__futex_abstimed_wait_cancelable64 "$OBJECT_DIR/"*.o -o "$TASK/objects/$mode-cancellation-forbidden.wasm" > "$TASK/logs/$mode-cancellation-required-failure.log" 2>&1
status=$?
set -e
[ "$status" -ne 0 ]
rg -q 'undefined symbol: __internal_syscall_cancel' "$TASK/logs/$mode-cancellation-required-failure.log"
storage_check
printf 'Built %s; genuine cancellation remains unsupported\n' "$output"
