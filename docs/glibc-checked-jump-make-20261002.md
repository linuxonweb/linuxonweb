# GNU native checked-jump source selection — 2026-10-02

Actual GNU make now compiles `debug/____longjmp_chk.o` using the native Wasm
architecture provider. The cumulative build selected generic Linux's backend,
which requires nonexistent machine `jmpbuf-offsets.h` and unsuitable alternate
stack semantics. The owned adapter selects the already guest-tested native
stack/owner checks without changing the jump ABI or disabling fortification.

A fresh signed GNU 2.44 replay and accepted cumulative configure create
`/mnt/p6/build/glibc-checked-jump-make-20261002`. The adapter verifies the frozen
`tools/glibc/jumps/helpers.c` against the accepted stat-runtime manifest. It
splits that body at its checked-backend boundary: the unchanged five ordinary
functions remain in `sysdeps/wasm32/__longjmp.c`; the checked function is in
`sysdeps/unix/sysv/linux/wasm32/____longjmp_chk.c`. Its GNU internal `setjmp.h`
provides the actual hidden, noreturn `__longjmp` declaration. There is one
provider for each routine; the ordinary object no longer defines the checked
routine. No upstream GNU body, kernel or accepted fixture is modified.

Both actual GNU make targets pass, with valid native Wasm output and exact
source/driver snapshots. The checked implementation retains GNU descriptor
identity, stack bounds/direction/alignment, live invocation and positive-label
checks, then dispatches the existing native longjmp mechanism. There is no
unchecked fallback or synthetic cancellation result.

Three unique supervised build attempts are retained. The first selected the
correct native source but lacked the internal `__longjmp` declaration. The
second compiled the ordinary unit but the owned audit incorrectly required
only one historical successful attempt after a rebuild. The corrected third
attempt selects the latest successful exact-source compile and passes both
units. Earlier commands, diagnostics, source/tool versions and objects remain.
The preparation and all three build groups are terminal.

Replay is in [the packet README](../tools/glibc/checked-jump-make/README.md).
`logs/checked-make-run3.json` records actual targets, hashes, symbols, GNU make
commands and retained driver attempts. This closes the genuine source-selection
compile blocker. Substituting these two exact objects into the full real guest
regressions, including all checked-jump failure exits, is assigned separately;
it is not yet accepted. Full NPTL/cancellation, production sysroot, Nightly,
JIT/GPU and deployment remain incomplete.
