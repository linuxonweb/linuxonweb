# GNU typed syscall wrappers — 2026-10-02

The owned native Wasm/Linux GNU glibc 2.44 port now implements 36 additional
generated public syscall wrappers with genuine GNU C types and aliases.
Actual guest gates pass **native 48,465/0** and **FPCAST23i64 48,478/0**.
This is a bounded libc prerequisite; full GNU libc/sysroot, public NPTL
cancellation and Firefox Nightly are still incomplete.

Artifacts are under `/mnt/p6/build/glibc-syscalls-fixed-20261002`.
Replay instructions and limitations are in `tools/glibc/syscalls-fixed/README.md`.
The predecessor fenv packet and its accepted 123-object runtime remain unchanged.

## Implementation and build evidence

The group consists of twelve xattr APIs, eight file APIs, seven descriptor/watch
APIs and nine identity/scheduler APIs. Each wrapper consumes an unchanged genuine
GNU-generated stream; all 36 are byte-equal to the original failed full-make
inventory snapshots. The owned architecture template permits only explicitly
audited signatures and preserves GNU body names and public aliases.

Independent GNU-header type assertions and volatile public function-pointer
references check C semantics, including signedness, pointer qualification and
uid/gid/group output types. Actual raw IR contains all 36 exact public address
initializers. The object audit verifies strong definitions and public T/W aliases
with identical function identities. It checks 263 actual included header hashes
and byte equality of the public headers with the signed pristine GNU release.

The genuine GNU make path also builds the 36 original targets through the new
architecture Makefile and compiler driver, in three io/misc/posix invocations.
Root independently checked those actual objects, symbols and generated streams.
This is selected-target build acceptance, not a passing full `make lib`.

The final runtime links 161 objects: 140 native Wasm-v1 and 21 LLVM ThinLTO
objects. Each new body and public alias has exactly one provider in the actual
link inputs. The final source/module record adds 45 inputs. Root verified all
206 current inputs against their actual hashes and byte-equal retained snapshots.
Each test CPIO changes only `/init` and adds one byte-exact GNU probe module.

## Runtime acceptance and retained failures

Both guests run six public wrapper suites, one concurrent errno suite and a
separate process-group success mode. Tests cover real link/symlink contents,
pipe contents and flags, flock conflict/unlock/retry, eventfd uint64 counters,
descriptor closure with adjacent survival, ownership/masks, typed identities,
scheduler queries/errors and output canaries. Success preserves GNU errno;
real failures change separate per-thread GNU errno.

The earlier allocator/startup/TLS, nonlocal jumps, cleanup/once, abort/signal,
raw exec replacement and fixed-rounding regressions remain passing. Both
accepted browsers exit naturally with status zero and close their owned server.
All 34 actually served runtime input hashes match in each accepted run.
Root scanned the 17 recorded supervisor groups; none has a live member. The
packet additionally records its runner/browser groups and retained failures.

Two early native runs remain FAIL. Their named fixture started with bootstrap
process group/session zero: `setpgid(0, 0)` correctly creates the caller's own
group, so a subsequent "restore zero" selects that same group. The corrected
test runs as an ordinary child of the existing rootfs setsid shell. Actual
native diagnostics show pid67, inherited group/session66, create→67, restore→66,
with errno245 preserved. The shell remains alive and belongs outside the new
GNU payload closure. The fixture requires nonzero inherited identities and
the runner requires the strict success marker and status zero exactly once.

The initial configure permission failure and one duplicate packaging-destination
failure are also retained. Executed script/source versions are preserved before
tooling consolidation; accepted modules are unchanged by that consolidation.

## Capability limits and exact identities

The kernel still returns genuine ENOSYS for inotify_init1/add_watch/rm_watch,
timerfd_create and memfd_create. Ramfs lacks user xattr storage: expected
unsupported/policy errors and empty lists are tested, without claiming stored
payloads, replacement or ERANGE semantics. Epoll coverage is descriptor creation;
syncfs covers ramfs API behavior. See the separate kernel evidence document.

- Acceptance SHA-256: `66a4f807170a2c8fb6c8c1a716cde70006367a4a00aed35423d808c77e4040e5`.
- Final runtime inputs SHA-256: `c5577be05d76fe42b21bc1ecf221217e6a34160ac062157e9ddd1da10c0641d1`.
- Native module SHA-256: `e5396d14ea345dc34c884f42a4cf5dccc04195373e9418e256d9200f28fc9921`.
- FPCAST module SHA-256: `6eee037b3fe34ff965e0e5be1901daf98d1d55b9595cb064afe8ba66b5a98b3e`.

Public cancellable close, default pthread stack/guards, forced cancellation
unwind, general CRT/loader, C++ runtime and coherent Nightly dependencies remain
unaccepted. Preserve this accepted packet and continue in a new owned task.
The public Sites release is unchanged.
