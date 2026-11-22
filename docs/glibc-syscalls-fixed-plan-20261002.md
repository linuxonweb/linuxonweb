# GNU generated syscall continuation — 2026-10-02

This is a read-only source review by the planning agent, independently compared
with the current architecture template. No wrappers have been built or accepted
by this plan. The authoritative 93 failed entries are in the frozen full-make
inventory's logs/primary-failures.json, class `unaudited generated syscall signature`.

The next owned packet should close a 36-entry fixed scalar/pointer group:

- Twelve extended-attribute calls: setxattr, lsetxattr, fsetxattr, getxattr,
  lgetxattr, fgetxattr, listxattr, llistxattr, flistxattr, removexattr,
  lremovexattr, fremovexattr.
- Eight file operations: linkat, symlinkat, fchownat, umask, pipe2, flock,
  syncfs, close_range.
- Seven descriptor/watch operations: eventfd, epoll_create1, inotify_init1,
  inotify_add_watch, inotify_rm_watch, timerfd_create, memfd_create.
- Nine identity/scheduler operations: getpgid, getsid, sched_yield,
  sched_primax, sched_primin, getgroups, getresuid, getresgid, setpgid.

Use exact genuine GNU-generated streams and aliases, a fail-closed owned
architecture template and explicit public function, kernel name, C return and
argument types, transport argument count and header provenance. Declare
`extern __typeof__(public_name) SYSCALL_SYMBOL;` before each concrete typed
definition; independent GNU-header type assertions and raw LLVM function-address
references verify C and native Wasm types. GNU make-syscalls.sh's `i` means any
signedness or size. Equal LLVM i32 types alone do not establish C semantics.

Important distinctions: xattr getters/lists return ssize_t; umask returns mode_t
and is the only NOERRNO stream among these 93. None uses ERRVAL. eventfd's kernel
name is eventfd2. close_range endpoints and memfd flags are unsigned; inotify
mask is uint32_t. sched_primax/primin are public sched_get_priority_max/min.
Keep typed uid/gid/group output objects and surrounding canaries.

Fresh native and FPCAST Linux gates must call actual public APIs through their
genuine function-pointer types, retain earlier runtime regressions, verify errno
preservation on success and thread-local GNU errno on failure, and prove natural
guest/browser exits and owned service cleanup. Exercise real files/links/pipes,
descriptor contents and closure, identity outputs, scheduling errors and xattr
payloads including NUL/short buffers. Read-only planning has not established all
kernel/filesystem capabilities: reproducible ENOSYS/ENOTSUP verifies truthful
transport but must remain an unavailable facility, not a skipped success gate.

The remaining disjoint partition totals 57 entries:

| Group | Count | Frozen names |
| --- | ---: | --- |
| Further fixed scalar/buffer | 27 | swapoff, setfsgid, chroot, acct, fsmount, setsid, unshare, mount, swapon, pidfd_open, setdomain, fsopen, klogctl, setpriority, pivot_root, fsconfig, setns, open_tree, sched_gets, setfsuid, sethostname, pidfd_getfd, fanotify_init, fspick, move_mount, tgkill, execve |
| Memory authority | 13 | mlock, munlock, mlockall, munlockall, mincore, mprotect, madvise, remap_file_pages, mseal, process_madvise, process_mrelease, pkey_alloc, pkey_free |
| Layout/historical exports | 12 | quotactl, name_to_handle_at, sysinfo, uname, sched_setp, sched_getp, sched_sets, epoll_ctl, mount_setattr, pidfd_send_signal, capget, capset |
| Calling-convention anomalies | 5 | prctl, vhangup, sync, init_module, delete_module |

prctl is genuinely variadic: its five-fixed-argument stream cannot implement the
Wasm variadic ABI. Derive option-specific argument requirements from the actual
kernel; do not read four absent varargs. Keep all public/internal aliases typed
consistently. vhangup is void-argument in GNU and kernel, despite the one-argument
stream: choose an owned architecture source, retaining the anomaly. sync returns
void. Historical init_module/delete_module streams have five/three arguments,
whereas the kernel has three/two; GNU provides no installed public declarations
for them, capget/capset or pivot_root. Record historical-export/kernel provenance
honestly rather than inventing GNU public headers.

Select exactly one memory provider: existing wasm-memory.c owns logical mappings,
__mprotect and __madvise. The kernel omits brk/mmap/munmap/mremap. Protection,
sealing and pkeys require actual authority, not success stubs. Audit structure
sizes/offsets/alignment for epoll_event, utsname, sched_param, file_handle,
mount_attr, quota/capability variants and GNU-to-kernel siginfo conversions.
GNU sys/sysinfo.h imports Linux UAPI struct sysinfo: uptime is kernel long32,
not GNU time_t64. Preserve genuine layout. Keep off_t/time_t64 transports outside
the generic i32 group until exact ordering, overflow and large-offset/time64
runtime gates pass.
