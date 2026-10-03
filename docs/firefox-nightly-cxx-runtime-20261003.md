# Nightly native C++ runtime — 2026-10-03

Firefox 159.0a1 uses clang's WebAssembly C++ ABI. The installed musl sysroot's
libc++/libc++abi archives use the generic Itanium ABI. Adding a genuine Wasm
unwinder alone resolves _Unwind_RaiseException but leaves constructor return
signatures incompatible. Actual Linux guest tests preserve this failure:
integer catches succeed, then std::runtime_error construction exits139.

The fix rebuilds libc++, libc++abi and libunwind from the unchanged installed
LLVM22.1.8 source at /nix/store/jkx0x4a4nlmnjm0kz9fiss33b7wh8z9k-source.
Both C and C++ use -fwasm-exceptions; C++ additionally uses
-Xclang -fc++-abi=webassembly. All archives are static. LIBUNWIND_HIDE_SYMBOLS
is enabled normally through CMake. The generated libc++ __config_site is
byte-identical to the installed ABI1 configuration. No LLVM source patch or
fake exception-success stub is used.

The actual Nightly environment selects the three absolute archive paths with
-nostdlib++. Existing installed headers and sysroot remain intact. The normal
rebuild is under
/mnt/p6/build/firefox-nightly-musl-recovery-20261002/native-unwind/runtimes-build.
The configure replay recipe refuses to overwrite that tree; it is preparation
and has not been executed. The real configure-run1, visibility reconfigure-run2,
failed first Ninja run and successful second run are retained there.

## Verification

The isolated guest fixture executes100 checks: integer and double throws,
typed standard exceptions, catch-and-rethrow, vector::at throwing
out_of_range, both destructor cleanups, and the uncaught-exception counter.
The final guest-run4/build-run5 records100 passes, zero failures and exit0.
It freezes all three linked archive hashes, the test source, the unchanged
accepted plain image and every served runtime input. Fresh host allocation,
actual Chromium affinity, requested guest CPUs and kernel startup all report6;
memory is1GiB. The owned browser exits normally, its process group is empty and
the dynamic HTTP server closes.

The normal Nightly pingsender and gfxtest component phases link successfully.
Their outputs have fresh phase-attributed mtimes and pass
wasm-validate --enable-all; no constructor signature warnings remain.

The independent review is
/mnt/p6/build/firefox-nightly-musl-root-review-20261002/cxx-runtime-review-run1.json
(597 checks,168 compile units,99 native archive members).
The compact pinned record is
tools/nightly-musl/evidence/native-cxx-runtime.json.

These checks establish the tested exception paths and helper links. They do
not establish complete C++ conformance, uncaught/fatal policy, a linked Nightly
browser, startup/TLS acceptance, JIT performance or release acceptance.
Public Sites v10 remains unchanged.
