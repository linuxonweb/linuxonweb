This packet adds the native Wasm fixed rounding mode to GNU's generic floating-point environment header: FE_TONEAREST=0, FE_ALL_EXCEPT=0, genuine GNU types and default pointers. Unsupported exception flags and selectable modes remain absent. The public fegetround/fesetround objects are unchanged GNU implementations with their strong internal symbols, weak public aliases, warning text and stub markers preserved.

The actual eight GNU unit builds pass. Native Linux passes 48,373/0 and FPCAST23i64 passes 48,384/0, including six public-rounding suites, concurrent errno/mode checks and all retained allocator/startup/jump/cleanup/once/abort/exec regressions. Browser/server exits and every owned group are verified terminal.

The eight retained inventory failures are compiled with their original GNU flags and selected source bytes in a fresh signed-source replay. This does not accept their formatting/conversion runtime dependencies or a full libm/sysroot. The bounded public fixture uses volatile function pointers to genuine GNU functions, rejects invalid modes without changing errno, and checks positive/negative nearest-even ties using native f32.add/f64.add. The existing raw-clone guest fixture checks separate child errno canaries. It does not accept full pthread lifecycle/cancellation, C++ exceptions or Nightly.

Set GLIBC_TASK to a fresh ext4 task, GLIBC_TOOLCHAIN and GLIBC_KERNEL_HEADERS to the reviewed toolchain/UAPI, GNU_RELEASE_ARCHIVE to the signed GNU 2.44 archive, GLIBC_INVENTORY_PACKET to the frozen failure inventory, GLIBC_C_CLEANUP_PACKET to the immutable accepted compiler/runtime packet, and GLIBC_CHROMIUM to the browser executable. The 2 GiB task cap, 8 GiB launch reserve and 5 GiB hard stop apply. Temporary files, caches, browser profiles and generated artifacts stay under the task.

```bash
source tools/glibc/fenv/env.sh
python3 tools/glibc/fenv/supervise.py replay 900 bash tools/glibc/fenv/prepare.sh
python3 tools/glibc/fenv/supervise.py units 600 python3 tools/glibc/fenv/rebuild-units.py
python3 tools/glibc/fenv/supervise.py runtime 120 bash tools/glibc/fenv/build-runtime.sh
python3 tools/glibc/fenv/audit-build.py
python3 tools/glibc/fenv/supervise.py packages 120 bash tools/glibc/fenv/build-guest.sh
python3 tools/glibc/fenv/supervise.py native 240 node tools/glibc/fenv/run-guest.mjs jit "$GLIBC_TASK/guest-native-run1" "$GLIBC_TASK/native-package"
python3 tools/glibc/fenv/supervise.py fpcast 240 node tools/glibc/fenv/run-guest.mjs jit "$GLIBC_TASK/guest-fpcast-run1" "$GLIBC_TASK/fpcast-package"
python3 tools/glibc/fenv/audit-packages.py
python3 tools/glibc/fenv/audit-results.py
```

Reuse verifies the accepted private compiler, archive closure, lowering tools and every original runtime input/source snapshot. The original 120 link objects include 99 native Wasm objects and 21 ThinLTO inputs. New public math/fixture objects and the modified startup are compiled and linked freshly. LLVM is not rebuilt. The inherited driver retains failed command/cwd/source/IR/stage results; it remains C-only and forces O2 after early GNU metadata/jump lowering, rather than accepting every production compiler flag.

Public GNU math/fenv.h is force-included after libc-symbols.h only for the two public implementations and fixture. This avoids GNU internal inline substitutes while preserving GNU aliases and metadata. The eight inventory units keep their internal header selection. Fixture static reservations, arena_max=1/tcache=0 and the old rootfs launcher outside the GNU payload closure retain their prior bounded scope. Each guest/profile/result destination must be fresh; no predecessor source or artifacts are modified.
