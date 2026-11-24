The owned Clang 22.1.8 frontend adds the missing Wasm C exception personality choice. GNU C remains C and emits real scoped cleanup pads. One private CodeGen archive member changes; its other 100 member occurrences and installed LLVM/Clang archives remain unchanged. The original compiler, ordinary/no-EH C objects and C++ frontend controls are preserved.

The accepted packet compiles the 50 actual GNU units that failed the earlier inventory's DWARF landingpads. The real Linux native and FPCAST guests exercise native tag payload/rethrow, nested and ordinary C cleanup, loops, indirect calls, linear-stack restoration, TLS/errno, public GNU pthread_once reset/retry/done and cleanup-chain restoration. Throwing during cleanup invokes genuine GNU abort. A raw kernel exec221 from an active cleanup frame replaces the instance without running the abandoned cleanup, then validates fresh argv/TLS/constructors and exits through GNU _exit42. This raw syscall probe does not accept a public GNU execve wrapper.

The JavaScript bridge uses two exact, worker-local errors captured from a real Wasm unreachable instruction. Real engine traps bypass application catch_all, while ordinary JS exceptions remain catchable. Halt propagates unchanged to the outer worker boundary; exec is consumed by the outer user.call loop. The legacy Symbol comparisons remain. A constructed RuntimeError or an unrelated real trap never matches these identities. Host controls explicitly import a private unexpected-abort observer; it is never called, and those objects never join the GNU guest payload.

This is a bounded compiler/runtime prerequisite, not a complete GNU sysroot, ELF CRT, loader, pthread lifecycle/cancellation, C++ exception runtime or Nightly browser. GNU NPTL forced unwind still lacks a native Wasm implementation. The compiler driver accepts C translation units, forces O2 after early metadata/jump lowering, and is not acceptance of production PIC/LTO/debug/dependency-file/C++ compiler behavior. Fixture stacks/TLS and arena_max1/tcache0 remain the prior test policy. The old rootfs launcher lies outside the new GNU payload closure.

Use a new ext4 task, an immutable signed GNU 2.44 release archive, matching LLVM 22.1.8 source/toolchain, and the frozen inventory packet. All generated files and temporary/cache paths stay under GLIBC_TASK. Build scripts use at most two compiler workers. The 3 GiB task cap, 8 GiB launch reserve and 5 GiB hard stop apply.

```bash
export GLIBC_TASK=/mnt/p6/build/<fresh-task>
export GLIBC_TOOLCHAIN=<llvm-22.1.8-installation>
export GLIBC_LLVM_SOURCE=<matching-read-only-llvm-source>
export GLIBC_KERNEL_HEADERS=<retained-linux-wasm-uapi-include>
export GNU_RELEASE_ARCHIVE=<signed-glibc-2.44.tar.xz>
export GLIBC_INVENTORY_PACKET=<frozen-fullmake-inventory-packet>
export GLIBC_CHROMIUM=<chromium-executable>
source tools/glibc/c-cleanup/env.sh
python3 tools/glibc/c-cleanup/supervise.py compiler 1200 python3 tools/glibc/c-cleanup/build-compiler.py
python3 tools/glibc/c-cleanup/archive-audit.py
python3 tools/glibc/c-cleanup/controls.py
python3 tools/glibc/c-cleanup/control-objects.py
python3 tools/glibc/c-cleanup/supervise.py replay 900 bash tools/glibc/c-cleanup/prepare.sh
python3 tools/glibc/c-cleanup/supervise.py units 600 python3 tools/glibc/c-cleanup/rebuild-units.py
python3 tools/glibc/c-cleanup/supervise.py base 1800 bash tools/glibc/c-cleanup/build-base.sh
python3 tools/glibc/c-cleanup/supervise.py runtime 120 bash tools/glibc/c-cleanup/build-runtime.sh
python3 tools/glibc/c-cleanup/supervise.py host-build 120 bash tools/glibc/c-cleanup/build-host-controls.sh
python3 tools/glibc/c-cleanup/supervise.py host-controls 30 node tools/glibc/c-cleanup/test-host-controls.mjs
bash tools/glibc/prepare-guest.sh
node tools/glibc/c-cleanup/test-tag.mjs "$GLIBC_TASK/objects/c-cleanup.wasm" "$GLIBC_TASK/logs/native-tag-result.json"
BINARYEN_CORES=2 wasm-opt --all-features --disable-compact-imports --pass-arg=max-func-params@23 --fpcast-emu "$GLIBC_TASK/objects/c-cleanup.wasm" -o "$GLIBC_TASK/objects/c-cleanup-fpcast.wasm"
node tools/glibc/c-cleanup/test-tag.mjs "$GLIBC_TASK/objects/c-cleanup-fpcast.wasm" "$GLIBC_TASK/logs/fpcast-tag-result.json"
python3 tools/glibc/c-cleanup/package.py "$GLIBC_TASK/objects/c-cleanup.wasm" native-package
python3 tools/glibc/c-cleanup/package.py "$GLIBC_TASK/objects/c-cleanup-fpcast.wasm" fpcast-package
python3 tools/glibc/c-cleanup/supervise.py native 240 node tools/glibc/c-cleanup/run-guest.mjs jit "$GLIBC_TASK/guest-native-production-run1" "$GLIBC_TASK/native-package"
python3 tools/glibc/c-cleanup/supervise.py fpcast 240 node tools/glibc/c-cleanup/run-guest.mjs jit "$GLIBC_TASK/guest-fpcast-production-run1" "$GLIBC_TASK/fpcast-package"
```

Every gate output/profile must have a fresh destination. Failed C stages retain command, cwd, source bytes and IR. The accepted historical base build completed its first closure, then was stopped with exit143 during a redundant second jump rebuild; the fresh final links and guest gates succeeded. build-base.sh factors out that redundant rebuild; this factorization is source-reviewed replay scaffolding, not an additional completed build run. Initial missing sem_t metadata failures and the halt-interception guest failures remain retained.

After final source review, audit.py and freeze.py pin the actual closure. GLIBC_NATIVE_RUN and GLIBC_FPCAST_RUN may select different accepted task-relative gate directories. Terminal freezes refuse existing manifests or snapshot destinations.
