Run57's unchanged packaged Firefox trapped in `pthread_getattr_np`: final
function 217188 at offset `0x7dbb981`, with an 88-byte body independently
matched to the raw module and the retained preoptimizer's named function
409129. The selected libc deliberately traps when the thread's stack pointer
is missing. Its initial main-thread TCB has no stack metadata. Offset 52 is
that pointer; offset 56 is the stack size.

The native Linux/Wasm adapter derives main-thread attributes from the actual
linker's `__stack_low` and `__stack_high`. It checks the memory boundary and,
when querying itself, a live frame. It preserves libc's detach/guard fields
and delegates created threads to the original function. It reads the pinned
libc private headers without writing TCB fields. The replay recipe binds both
those headers and the selected libc archive. Only Firefox, plugin-container
and xpcshell select the new archive and `--wrap=pthread_getattr_np`.

The real Linux/Wasm guest passes 55 checks on six CPUs with 1 GiB guest RAM:
27 checks each for genuine 8 MiB and 2 MiB linked main stacks, plus the original
main-thread query's expected exit 139. Checks include live frames, both cross
thread query directions, byte-identical worker attributes, deferred worker
cancellation, cleanup and TLS-key destructor lifecycle. The two measured
ranges are `[0,8388608)` and `[0,2097152)`. The 853-byte production object is
byte-for-byte identical to the guest-tested object. Both owned process groups
were reaped and empty, and the browser and server closed.

Evidence: [native-main-stack.json](../tools/nightly-musl/evidence/native-main-stack.json).
The retained task is `/mnt/p6/project/build/nightly-native-stack-20261003`.
It also holds independent copies of Run57's seven executables and Rust
archive. Initial compilation failures from the pinned musl feature/header
order, and the historical-status admission failure, remain recorded.

Run58 adopts this adapter through an ordinary j1 build with the original
Binaryen O2. Its eventual acceptance still requires fresh raw validators,
actual direct-link warning captures, all required transformed helpers,
package/overlay bindings, and ordinary cold/warm startup. This guest regression
does not establish Firefox startup, JIT, Firefox GPU or release acceptance.
