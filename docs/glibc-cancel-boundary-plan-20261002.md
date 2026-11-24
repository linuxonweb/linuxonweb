# GNU cancellation boundary diagnosis — 2026-10-02

The current GNU C++ link still needs `__syscall_cancel_arch`. Compiling a
function with that name will not establish cancellation. Current source
inspection identifies a further constraint: simply deferring a cancellation
exception in the worker until its kernel syscall import returns can leave a
blocked operation running forever, because GNU installs SIGCANCEL with
`SA_RESTART` and this kernel restarts the interrupted call internally.

The reproducible inspection is
`python3 tools/glibc/cancel-boundary-plan/evidence.py`. Its eleven original and
snapshot inputs, ten source findings, selected kernel identity and actual
register structure are recorded in
`/mnt/p6/build/glibc-cancel-boundary-plan-20261002/evidence.json`.
This is source evidence, not a cancellation test result.

GNU `nptl/pthread_cancel.c` cancels from its signal handler for asynchronous
mode or when the interrupted PC lies inside the cancellable syscall bridge.
The current GNU signal adapter supplies NULL context. Kernel Wasm registers
carry the syscall arguments, result, restart number and mode, without an
interrupted user instruction address. A fabricated PC or function-table index
cannot satisfy GNU's instruction-range contract.

GNU `nptl/cancellation.c` already checks a real `-EINTR` result and an enabled,
pending cancellation request after the architecture bridge. The kernel's
`arch/wasm/kernel/signal.c` converts `-ERESTARTSYS` to `-EINTR` only when a
handler lacks `SA_RESTART`; otherwise it requests a restart. It restores the
saved interrupted registers and mask after the synchronous callback. Its
syscall loop then restarts before returning to the worker. Throwing through
that callback skips kernel restoration; queuing a user unwind alone does not
change the restart decision.

The required native architecture route must preserve GNU cancellation state
and request provenance, deliver unwind after kernel restoration, and make an
explicit restart decision for an interrupted cancellable operation with no
side effects. It must preserve positive or partial results rather than turn
them into cancellation. Any required kernel change should be a minimal owned
hook applied to a source copy, with the reason above recorded. An adapter-only
route is preferable if it can demonstrably supply that decision without
losing state. Neither route has been built or accepted here.

The next implementation gate must include a real blocked read or futex,
pending-before-entry and pending-during-block requests, cancellation disabled
and restored, nested signal callbacks, independent threads, unrelated-signal
restart, partial I/O preservation, restored kernel mask/register state,
exactly-once GNU cleanup and nested C++ destruction, and a real
`PTHREAD_CANCELED` join. It also needs genuine `_Unwind_ForcedUnwind` and CFA
integration. Polling-only delivery does not establish busy-loop asynchronous
cancellation. Ordinary C++ exceptions and complete default NPTL remain
prerequisites to browser acceptance.
