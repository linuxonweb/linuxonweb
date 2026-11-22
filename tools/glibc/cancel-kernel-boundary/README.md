# Native GNU signal/cancellation return boundary

This packet proposes a versioned kernel/worker/GNU boundary. Actual changed
kernel units and GNU helper objects compile. A separately audited candidate
kernel passes legacy native/FPCAST GNU regression gates. Admitted native frame
providers and real cancellation runtime remain incomplete.
Production runtime and retained kernel sources remain unchanged.

`prepare.py` preserves the v2 proposal. `prepare-v3.py` derives the reviewed v3
revision in a unique output directory. V3 routes both simple and SIGINFO
callbacks and retains a copied 80-byte record with raw pre-restart syscall
result, task/TP identity, monotonic 64-bit delivery generation, handler identity
and separate callback/copy status. The kernel restores registers, mask and the
previous `active_siginfo` before consulting a nounwind policy:

* 0 preserves the restored result and restart decision.
* 1 converts only authenticated, enabled pending cancellation at raw
  `-ERESTARTSYS` to `-EINTR`, clearing restart.
* 2 clears restart without changing the restored result, solely when the host
  retains the exact escaping native exception and guarantees rethrow before
  guest code can observe that result.

The third policy is necessary because `wasm_syscall` restarts internally before
returning to JavaScript. Copy failure is not policy; the actual kernel skips
policy and forces SIGSEGV after restoration. Failed host callback tokens drain
without expecting a restoration import.

`worker-boundary.mjs` is an owned integration candidate. It retains unique
immutable delivery slots until the outermost drain; callback depth is not an
identity. Registered GNU SIGCANCEL handlers are deferred. Ordinary native
exceptions are caught at the callback boundary, acknowledged after kernel
restoration, and rethrown unchanged into the importing source context. Nested
rethrows must encounter the enclosing host catcher before outer kernel frames.
Actual halt/exec traps invalidate the epoch and propagate unchanged. Ordinary
traps remain failures. `install-worker.py` renders unique task-local worker and
wasm.js copies, retaining originals, additive v1/v2/v3 interfaces and typed
native/FPCAST helper calls; it never edits production files.

`gnu-handler.c` includes the unchanged signed-GNU `nptl/pthread_cancel.c` and
exposes its actual static handler address. `gnu-helper.c` uses real GNU
cancelhandling bits, translated siginfo, PID/SI_TKILL validation and current
boundary checkpoints. Its storage uses compiler TLS while ownership binds the
actual raw GNU TP. Context is an opaque validated boundary record, not invented
PC/ucontext data. The helper objects require the actual canonical native frame providers. The host import-enter primitive must snapshot the canonical frame
head before any temporary recorded helper activation. Helpers still need real
records, with polling suppressed under live import/callback/critical depth.
No constant-success provider is supplied.

`compile-kernel.py` compiles genuine changed kernel units using pinned configured
headers and saved real commands with explicit VFS mappings. `compile-gnu-helpers.py`
retains genuine GNU source, all stage argv/cwd/results, raw IR, dependencies and
objects. `checks.py` and the protocol/worker tests provide clearly labeled
synthetic boundary controls, not real GNU cancellation acceptance.

`kernel-preflight.py` measures source/config discrepancies. `plan-whole-kernel.py`
renders the exact coherent nine-file overlay and a finite fresh build recipe:
retained s6 kernel source plus the configured four architecture changes and real
framebuffer provider, merged reviewed v3 imports, genuine configured `.config`,
fresh generated headers and all fresh target objects. `build-whole-kernel.py`
adds storage monitoring, deadlines and cleanup of each owned process group even
on supervisor errors. Reviewed preparation attempts retain a source-copy rule
failure and a genuine host `fixdep` link failure. The corrected host recipe
uses explicit system GNU linker/libgcc settings for host helpers only, with the
native Wasm target toolchain unchanged. Fresh outputs may reuse the independent
owned source only after exact complete membership and byte verification. The measured proposal uses a new 6 GiB task cap with 8 GiB launch
reserve and 5 GiB hard stop; this small preparation packet retains its 2 GiB cap.

Every replay requires a new label/destination, task-local ext4 TMPDIR/TMP/TEMP
and cache, finite owned process groups and terminal child checks. Preserve
failed labels, source snapshots and original stage proofs. A full kernel build
must audit imports, section metadata and actual object closure before any
isolated guest gate. General NPTL forced unwind, pthread lifecycle, C++
interoperability, a full GNU sysroot and Nightly/JIT/GPU remain incomplete.

The actual fresh whole build links the kernel and retains its exit2 O= packaging
failure. Separate `prepare-kernel-packaging.py` and the readiness auditor retain
byte-exact original Wasm sections, audited metadata and an exact import delta.
`prepare-basic-guest.py` routes only the owned kernel/bootstrap/worker candidates;
`audit-basic-guest.py` verifies historical renamed originals, served bytes,
mandatory existing gates and terminal groups. Basic3 passes native49871/0 and
FPCAST49858/0 without admitted cancellation helpers.

`native-bridge.c` supplies the one canonical GNU owner/frame sidecar. Its
compile audit requires no calls/imports/SP writes. Opaque i32 generation handles
are never exposed slot addresses; a saturating serial survives outer completion
and stale-token reuse is rejected before dereference. `compile-native-bridge.py`
retains fresh source/header/IR/object/stage proof. Allocating GNU helpers still
require actual compiler records and depth-suppressed polls; the real immutable
compiler root getter and genuine forced unwind remain mandatory unresolved
composition inputs.

`prepare-cancel-arch.py` pins signed GNU cancellation reference bytes, removes
only the unsupported ELF PC labels and bootstrap warning, and reverses exactly.
`compile-cancel-arch.py` compiles that unchanged pending-check/syscall/result
body through the accepted GNU frontend and adapters, retaining strong real
`__syscall_do_cancel` linkage. These objects do not prove cancellation execution.
