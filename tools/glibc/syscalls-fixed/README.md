This packet extends genuine GNU glibc 2.44 generated syscall wrappers with 36
independently audited public C signatures for native Wasm/Linux. It preserves
GNU-generated bodies, internal names and public aliases, and uses the existing
raw kernel transport with actual GNU errno. It adds no replacement libc.

Set the task parameters in a disk-backed config, then source that config and
`env.sh`. Required inputs are the signed GNU archive, kernel headers, LLVM
22.1.8 tools, immutable C-cleanup compiler packet, immutable fenv runtime
packet and the original full-make inventory. All scratch, caches, profiles and
outputs belong below `GLIBC_TASK`; the inherited policy limits the task to
2 GiB, requires 8 GiB free before launch and stops at 5 GiB free.

A fresh replay runs these commands from the repository root:

```sh
python3 tools/glibc/syscalls-fixed/supervise.py replay 180 bash tools/glibc/syscalls-fixed/prepare.sh
python3 tools/glibc/syscalls-fixed/supervise.py wrappers 180 bash tools/glibc/syscalls-fixed/build-wrappers.sh
python3 tools/glibc/syscalls-fixed/audit-wrappers.py
python3 tools/glibc/syscalls-fixed/supervise.py make-selected 180 python3 tools/glibc/syscalls-fixed/build-make.py
python3 tools/glibc/syscalls-fixed/supervise.py runtime 120 bash tools/glibc/syscalls-fixed/build-runtime.sh
python3 tools/glibc/syscalls-fixed/supervise.py package 120 bash tools/glibc/syscalls-fixed/build-guest.sh "$GLIBC_TASK/objects/fixed.wasm" accepted
python3 tools/glibc/syscalls-fixed/supervise.py native 180 node tools/glibc/syscalls-fixed/run-guest.mjs jit "$GLIBC_TASK/guest-native" "$GLIBC_TASK/native-package-accepted"
python3 tools/glibc/syscalls-fixed/supervise.py fpcast 180 node tools/glibc/syscalls-fixed/run-guest.mjs jit "$GLIBC_TASK/guest-fpcast" "$GLIBC_TASK/fpcast-package-accepted"
```

`audit-wrappers.py` writes `logs/wrapper-audit/result.json`. It checks all 36
streams against the original GNU-generated inventory snapshots, public header
bytes against the signed source, independent C function type assertions,
actual volatile public address initializers and object body/alias identity.
`build-make.py` builds exactly the 36 selected genuine GNU targets through the
fresh architecture Makefile. This is distinct from the manually linked runtime
and does not establish a successful full `make lib` or installed sysroot.

The copied template includes 20 earlier audited names and the 36 new names.
The earlier sigaltstack template entry remains compile support; the runtime
retains its earlier provider. The 17 earlier generated wrapper objects and
three private close convention probes remain separate from this extension.
A private close probe does not accept public cancellable close.

The retained kernel returns ENOSYS for inotify_init1, inotify_add_watch,
inotify_rm_watch, timerfd_create and memfd_create. The test checks those errors
explicitly. Ramfs user xattr storage is unavailable: getters/setters/removers
fail with the genuine kernel errors; lists are empty. Symlink policy errors
are checked separately. Successful xattr payload storage, ERANGE/replacement
behavior, inotify events, timers and memfd mappings/seals remain unaccepted.
The epoll test creates a descriptor; it does not test event monitoring. The
syncfs test covers ramfs, without a durable disk claim.

The runtime calls all 36 public functions through volatile pointers, checks
success errno preservation and real kernel errors with canaries, and preserves
allocator/startup/TLS/jump/cleanup/once/abort/exec/rounding regressions. The
setpgid success test runs in an ordinary child of an existing rootfs setsid
shell, with a genuine nonzero inherited group. That shell and the rootfs
launcher remain outside the new GNU payload closure. The first two native
failures are retained: their fixture attempted to restore bootstrap group 0,
which setpgid interprets as the caller's own PID.

The compiler driver retains raw IR, stage commands, source bytes and exit
statuses. Its forced O2 C pipeline and query passthrough are bounded build
tools, not acceptance of every GNU/Nightly compiler flag. Full GNU startup,
loader provenance, default pthread creation/guards, forced cancellation
unwind, C++ runtime, full libc/sysroot and Firefox Nightly remain incomplete.
