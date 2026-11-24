# GNU native Wasm next 26 syscall wrappers — 2026-10-02

The bounded packet at `/mnt/p6/build/glibc-syscalls-next26-20261002` passes
actual Linux native and FPCAST23i64 guest gates with **48,554/0** and
**48,567/0**. It adds 26 genuine GNU-generated public wrappers to the preceding
53, preserving exact public C types, raw errno transport, implementation names
and public aliases. GNU make builds all 26 selected targets. Every generated
stream equals its original frozen inventory source snapshot byte for byte.

The public APIs are swapoff, swapon, setfsuid, setfsgid, chroot, acct, setsid,
sethostname, setdomainname, execve, mount, fsopen, fsmount, fsconfig, fspick,
open_tree, move_mount, unshare, setns, sched_getscheduler, pidfd_open,
pidfd_getfd, klogctl, setpriority, fanotify_init and tgkill. Independent GNU
prototype assertions and volatile public address references cover all 26.
Alias audits establish strong implementations and identical public function
addresses; the final link audit establishes one provider for each name.

The fixture checks real success/error returns and errno preservation, thread
errno isolation, IDs/priorities with restoration, hostname/domain restoration,
an actual tgkill callback through GNU signal conversion, pidfd shared file
offsets, and legacy/configured-source modern ramfs mounts with bounded file
bytes and unmount cleanup. Separate ordinary processes prove setsid and
restricted-root chroot. Public execve runs while a real GNU C cleanup frame is
active and replaces it with fresh GNU argv/environment/TLS/constructors;
the new target exits 43 without executing the old cleanup. The pinned
setsid/shell/rootfs scaffold and raw fixture I/O/uname/priority/unmount calls
remain outside acceptance of new GNU APIs.

All earlier allocator/startup/TLS, jump/mask/fortify, generated syscall errno,
warning metadata, C cleanup/public pthread_once, genuine abort and raw exec,
fixed-rounding and 36-wrapper regressions pass. Each accepted guest contains
six strict suite markers, the thread marker and exact isolated process statuses.
Browser exit is zero, servers close, and the owned process groups are empty.

Four selected kernel facilities remain explicitly unsupported: swapoff,
swapon, acct and fanotify_init return ENOSYS. No success is substituted for
those errors. The previous inotify/timerfd/memfd and ramfs xattr limits remain.

The original native/FPCAST payloads exposed a kernel default-source mount bug.
`fs/namespace.c` assigns the static `"none"` string when `fc->source` is NULL,
then delayed mount release calls `kfree_const`. The selected Wasm
`arch/wasm/include/asm/sections.h` defines `is_kernel_rodata` to return false,
so that static storage reaches `kfree`, producing a SLUB reserved-page warning.
The native first run happened to retain strict markers; the FPCAST first run
lost three markers to interleaved warning output. **Neither warning-bearing
run is accepted.** Exact payloads, inputs, consoles and relevant kernel source
bytes are retained. The final fixture uses the genuine fsconfig SET_STRING
`source=gnu-next26` option before CMD_CREATE, and both accepted consoles have
no allocator warning. Default/NULL-source compatibility remains a real kernel
architecture blocker; this packet does not change the kernel or suppress logs.

The final module consumes **191 objects: 170 Wasm v1 and 21 ThinLTO bitcode**.
It reuses the verified immutable 161-object GNU foundation, adds 26 wrappers,
two public-reference/fixture units, and two unchanged GNU signal mask helpers,
with the owned startup replaced coherently. Actual GNU make builds sigemptyset
and sigaddset; their pristine-source equality, raw IR, successful stage commands,
linked-copy equality and every `.o.dt` dependency are audited. The supplemental
dependency audit pins 316 included files and 74 exact executed compiler/source
versions. The initial mutable-originalArgs reporting defect is mapped to its
retained original driver bytes; future attempts copy the argument list.

The packet preserves its failed ambiguous-stream selection, missing fixture
header, missing public mask-helper link, and original warning-bearing runtime
attempts. Recompiles, transformed modules, packages, logs and caches use unique
owned destinations. Later retention-only tooling changes do not rebuild the
accepted payload. Replay commands and storage policy are in
[the packet README](../tools/glibc/syscalls-next26/README.md).

Acceptance, link/provider/dependency/input/group proofs and the immutable
manifest live in the task directory. This remains a manually closed GNU
runtime fixture with a bounded C-only diagnostic driver. Full libc.a/ELF CRT,
default pthread creation/guards, forced unwind/C++ cancellation, static/dynamic
loader compatibility, a coherent Firefox sysroot, Nightly, JIT, GPU and Sites
release remain unfinished.
