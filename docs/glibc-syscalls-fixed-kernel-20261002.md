# Kernel evidence for the 36 GNU wrappers — 2026-10-02

This is source/configuration/binary evidence, not runtime acceptance. The fresh
planning agent received only the wrapper goal and source locations. Root
independently reread the configuration hash, enabled/disabled settings and all
five exact Wasm function bodies. Actual guest results remain authoritative for
API behavior and errors.

The shipped kernel `web/linux/vmlinux.wasm` has SHA256
`21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75`.
The retained configuration is
`/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/mzbhr58f5fk50b15xfrk68mwsdg4xs1c-source/.config`,
SHA256 `58a7183fed206cddffbc291c32ea0393d9c30f3dc6fa4b827873164a3737d485`.
It disables INOTIFY_USER, TIMERFD and MEMFD_CREATE, and enables EPOLL, EVENTFD,
FILE_LOCKING, MULTIUSER and EXT4_FS. Complete source-build provenance linking
that configuration to the shipped binary has not been reconstructed. An older
retained defconfig leaves TIMERFD enabled by default, so its defaults cannot
establish the shipped kernel's capabilities.

The following selected functions have four-byte bodies `00 41 5a 0b`: zero
locals, `i32.const -38`, `end`. They return ENOSYS for valid and invalid inputs.
Function-table indices are distinct from Linux syscall numbers; the planner
checked generic syscall wiring separately but did not reconstruct every
syscall-table data word.

| Public API | Function index | Body byte offset | Wasm element index |
| --- | ---: | --- | ---: |
| inotify_init1 | 1151 | 0x053253 | 92 |
| inotify_add_watch | 1152 | 0x053258 | 93 |
| inotify_rm_watch | 1153 | 0x05325d | 94 |
| timerfd_create | 1161 | 0x053285 | 150 |
| memfd_create | 1318 | 0x053596 | 332 |

The other 31 wrappers have selected real implementations. Dormant weak ENOSYS
bodies also exist for several enabled facilities; seeing a weak body alone does
not establish unsupported behavior. Actual table bindings matter.

The current root/runtime filesystems are ramfs and provide no user-xattr storage.
Planning predicts EOPNOTSUPP for regular-file user.* setters/getters/removers and
zero-length success for the three list APIs. On an actual symlink, namespace
checks instead predict EPERM for lsetxattr/lremovexattr and ENODATA for lgetxattr.
These predictions must be checked against actual guest results. Ramfs rejection
does not test stored binary payloads, replacement, ERANGE or short buffers.

The retained kernel source used for semantic review is
`/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/s6qc0any0wby0f4nnivpaanvqb9hl130-source`.
Its fs/xattr.c implements handler rejection, list fallback and namespace checks;
fs/ramfs/inode.c and file-nommu.c have no user-xattr handlers. Wasm selects
MMU=n, which prevents ordinary SHMEM/TMPFS selection. EXT4_FS includes xattr.o
and xattr_user.o unconditionally even when POSIX ACL/security are disabled, so
an explicitly attached writable ext4 fixture is a later route to payload tests.
Current initramfs gates attach no such disk.

The enabled facilities need concrete runtime checks:

- Hardlinks and symlinks: reopen and read actual contents/targets; same-filesystem
  hardlinks, since cross-filesystem links return EXDEV.
- Ownership and umask: typed IDs, unchanged-owner behavior and mask restoration.
- Pipes: canaried int[2], real bytes, CLOEXEC/NONBLOCK and invalid flags.
- flock: two independent opens, exclusive nonblocking conflict, unlock and retry.
- syncfs/close_range: valid and invalid descriptors; close only fresh bounded
  ranges and prove neighboring descriptors survive. Ramfs sync does not prove
  durable disk persistence.
- eventfd: uint64 counter read/write and empty nonblocking EAGAIN. epoll creation
  does not test monitoring; epoll_ctl/wait are outside these 36 wrappers.
- Identities/groups: typed output canaries and actual group count. An undersized
  group list is meaningful only with a nonzero count. Later pointer failure in
  getresuid/getresgid can leave earlier outputs written.
- Scheduling/process groups: priority queries and invalid policy; child-isolated
  setpgid. Session leaders legitimately return EPERM. Yield does not prove
  fairness, and priority queries do not prove realtime scheduling acceptance.

Later kernel work must preserve the current binary and use an isolated coherent
source/configuration candidate enabling INOTIFY_USER, TIMERFD and MEMFD_CREATE.
Verify watch/event/removal, expiration/readiness/time64 and anonymous descriptor
contents in real guests. Config-only enablement is insufficient.

Native memfd has an additional boundary: tiny-shmem has a ramfs-backed provider,
but without SHMEM, shmem_file() is false and seal operations can return EINVAL.
The Wasm architecture also omits kernel mmap-family calls. Anonymous descriptor
contents do not establish working mappings/seals. Do not bypass MMU dependencies
or substitute success stubs for those semantics.
