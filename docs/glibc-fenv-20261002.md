# GNU fixed floating-point environment on native Wasm — 2026-10-02

GNU's internal fenv header requires FE_TONEAREST even on architectures without
selectable rounding modes. The generic GNU bits/fenv.h omitted it, blocking
eight actual full-make units. The owned wasm32 architecture header copies GNU
2.44's generic header and adds only FE_TONEAREST=0. Genuine types, default
environment pointers, licensing and FE_ALL_EXCEPT=0 remain intact. Unsupported
public modes and exception flags remain absent.

The fresh task is `/mnt/p6/build/glibc-fenv-20261002`; repository build and test
scripts are in tools/glibc/fenv. The signed GNU replay, configure and metadata
generation pass. The accepted private C-cleanup compiler and runtime closure
are reused with exact predecessor manifest, source and snapshot verification;
frozen predecessor files are unchanged. No LLVM or GNU base rebuild is claimed.

The eight actual frozen inventory failures now compile on their first attempt:
stdlib strtof_l/strtod_l/strtold_l, wcsmbs wcstof_l/wcstod_l/wcstold_l, and
stdio-common printf_fp/printf_fphex. All resulting Wasm objects and unchanged
GNU source hashes were independently checked. This is compile acceptance;
conversion and formatting runtime behavior is not established by these builds.

## Genuine public implementations

Unchanged GNU math/fegetround.c returns nearest. Unchanged math/fesetround.c
accepts nearest and rejects every other integer without changing errno. Their
strong internal definitions, public weak aliases and genuine GNU warning/stub
custom sections survive the native Wasm build.

For these two units and the public test fixture only, the driver preincludes
genuine math/fenv.h after libc-symbols.h. The public header sets _FENV_H and
therefore skips GNU include/fenv.h's internal trivial inline implementations.
Those internal setters return success for every input and cannot establish
public invalid-mode rejection. Global _ISOMAC is avoided because it removes
GNU alias/warning machinery. No genuine implementation is rewritten.

Independent raw and optimized IR inspection verifies volatile public function
pointers and retained indirect calls to the genuine GNU aliases. The fixture
object contains native f32.add/f64.add and call_indirect instructions, with no
fast-math replacement. Volatile operands prevent constant-folded arithmetic
from satisfying the runtime gate. A first symbol-display audit expected ELF's
weak-binding spelling; the retained correction recognizes actual Wasm
BINDING_WEAK. The payload and build were unchanged.

## Real Linux guest acceptance

Separate fresh native and FPCAST23i64 guests pass 48,373/0 and 48,384/0. Each
runs the public rounding suite six times and the concurrent thread suite once:

- Getter/setter accept nearest; setters reject 1, -1, INT_MIN and INT_MAX.
- Errno canaries remain unchanged; rejected setters leave the mode nearest.
- Eight signed f32/f64 tie cases verify exact nearest-even result bits.
- Two children and the parent retain separate GNU errno state while calling
  the public APIs before/after concurrent allocator work.

The earlier allocator/startup, signal/time64, native-jump, generated-syscall,
warning, cleanup/once, abort134 and raw exec221/fresh-target42 gates also pass.
All 34 actual served input hashes per run were independently reread without
differences. Guests and browsers exit naturally, servers close, and supervisors
report empty terminal process groups. The final closure contains 123 objects:
120 accepted predecessor objects, with startup recompiled, plus two genuine GNU
rounding implementations and the public fixture.

This accepts the fixed-rounding header, eight compile units and the two genuine
public rounding APIs in the bounded GNU runtime. Full libm, conversion/formatting
runtime, GNU archive/sysroot, general NPTL/cancellation, production C++ compiler
behavior, Nightly, full JIT, Firefox GPU and Sites deployment remain unfinished.
Continue with the source-reviewed 36-wrapper plan in
[the syscall continuation](glibc-syscalls-fixed-plan-20261002.md).
