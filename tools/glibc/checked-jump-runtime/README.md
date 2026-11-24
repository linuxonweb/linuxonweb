# GNU checked-jump runtime gate

Preparation only until the exact frozen selected GNUmake checked-jump object/source/hash handoff arrives. Reuses immutable final16 runtime manifest888d4947e801e9c3ecc5c58c194751964be069c8ed993284c846da4c4c105266 and acceptance3b1c085163fc39d250bbe7b8176b8bf989397c26e7899b3a8eb4a1e0b1d6985d. `prepare-base.py` verifies all96238 original manifest pins and every final runtime original/snapshot pair before copying231 objects and the exact startup/worker/index.

The selected next build will replace only the owned jump helper provider with two genuine GNU-selected native providers preserving the accepted owned native architecture bodies. Exact provider names, object hashes, source selection and final object count must come from root's frozen checked-jump-make handoff. Other providers and all prior gates stay byte-identical. Native and FPCAST23i64 must retain all allocator/startup/TLS/signal/abort/C cleanup/once/fenv/stat/scheduler/semaphore/syscall/isolation/exec gates and three checked-invalid jump exit134 cases. No cancellation/forced unwind/C++ or full libc/sysroot/Nightly acceptance follows from this bounded gate.

All files, temp/cache/browser/profile artifacts remain under the owned ext4 task. Source `config.sh` and env.sh after setting GLIBC_CHECKED_JUMP_PACKET. Use finite supervise.py commands, -j2,2GiB task cap,8GiB launch reserve,5GiB hard stop. Freeze requires root review; no Git/shared/frozen predecessor edits.

Accepted handoff objects are GNUmake setjmp/__longjmp.o and debug/____longjmp_chk.o, with exact object/source pins in provider-select.py. These are owned native architecture bodies compiled through genuine GNUmake selection. Build/test order after source config/env:

```sh
python3 tools/glibc/checked-jump-runtime/supervise.py prepare-base 300 python3 tools/glibc/checked-jump-runtime/prepare-base.py
python3 tools/glibc/checked-jump-runtime/supervise.py build 300 bash tools/glibc/checked-jump-runtime/build.sh
python3 tools/glibc/checked-jump-runtime/supervise.py package 150 bash tools/glibc/checked-jump-runtime/build-guest.sh
python3 tools/glibc/checked-jump-runtime/supervise.py native 180 node tools/glibc/checked-jump-runtime/run-guest.mjs jit "$GLIBC_TASK/native-run1" "$GLIBC_TASK/native-package"
python3 tools/glibc/checked-jump-runtime/supervise.py fpcast 180 node tools/glibc/checked-jump-runtime/run-guest.mjs jit "$GLIBC_TASK/fpcast-run1" "$GLIBC_TASK/fpcast-package"
python3 tools/glibc/checked-jump-runtime/audit.py
python3 tools/glibc/checked-jump-runtime/verify-terminal.py
```

Historical audit requires the preserved build1 preparation-failure log/source. For a fresh successful replay, that historical assertion should reference this immutable packet rather than pretend a new failure occurred. Freeze supervision/stdout must be outside the frozen task; set GLIBC_CHECKED_JUMP_FREEZE_AUTHORIZED only after root review.
