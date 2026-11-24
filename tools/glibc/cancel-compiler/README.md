# Native GNU cancellation compiler prerequisites

This owned sparse compiler implements early source-scope safepoints and actual
caller-entry linear-stack capture. It is a bounded prerequisite subset, not a
completed forced-unwind compiler, GNU cancellation runtime or GNU sysroot.

The explicit mode is `-mllvm -wasm-gnu-cancel-prerequisite`. It rejects targets
other than wasm32 Linux GNU and requires native Wasm exception handling. The
initial mode disables inlining and tail calls. It emits may-throw polls at common
function startup and source while/do/for/range loop headers while the genuine
Clang cleanup stack remains available. A reserved marker is lowered by the owned
backend into the preserved actual prologue global stack pointer, saved in a fresh
register before the current frame's allocation. Marker definitions in mode-on
source reject; `marker-audit.py` rejects leftover references and definitions in
selected native link inputs. Direct use of an unaudited linker can bypass that
admission audit and is outside this subset.

```sh
python3 -B tools/glibc/cancel-compiler/prepare.py
python3 -B tools/glibc/cancel-compiler/build.py
python3 -B tools/glibc/cancel-compiler/test.py
python3 -B tools/glibc/cancel-compiler/review.py
```

`prepare.py` requires fresh task source storage; the defaults use
`/mnt/p6/build/glibc-cancel-compiler-20261002`. For a fresh replay set `GLIBC_TASK`
to new owned ext4 storage. Existing source attempts are retained rather than
rewritten. Frozen LLVM/GNU/compiler trees remain read-only. Only two frontend
archive occurrences and one backend occurrence change; the accepted C exception
personality fix stays intact. All caches/TMP are task-local. Launch reserve is
8GiB, hard stop5GiB and task cap2GiB.

The Node controls use an audited mode-off diagnostic poll provider. That provider
never authenticates a GNU cancellation request. Its unexpected-fatal boundary
fails if invoked; no genuine GNU abort is linked here. C and C++ source cleanups,
actual native tag0 and Wasm traps are compiler controls. The uninterpreted tag0
payload is not a GNU exception record. The tests measure escaping stack leaks
and explicitly restore stack state between diagnostic cases; that restoration
is not compiler acceptance.

See `docs/glibc-cancel-compiler-20261002.md` for exact scope, retained failures and
remaining general frame/EH/LTO work. Do not use the driver for coherent GNU/C++
dependency rebuilds or claim cancellation support from these controls.
