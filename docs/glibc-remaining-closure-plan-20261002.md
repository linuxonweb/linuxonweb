# Remaining genuine GNU closure plan — 2026-10-02

Source-only review at repository `a249f2e`. This document proposes the next
packet; it does not implement an adapter, run a build, or accept runtime APIs.
The owned evidence directory is
`/mnt/p6/build/glibc-remaining-closure-plan-20261002` on ext4. No frozen packet,
kernel, runtime, Git checkpoint, or release was changed by this review.

The smallest useful next packet closes four original targets:
`posix/sched_setp.o`, `posix/sched_getp.o`, `posix/sched_sets.o`, and
`nptl/sem_post.o`. It combines three typed scheduler wrappers with the missing
GNU scheduler-header dependency in sem_post, and tests actual GNU
sem_init/sem_post/sem_trywait/sem_getvalue behavior. Memory protection, default
pthread stacks, cancellation, and the static loader remain separate work.

## Exact historical count

The original inventory is
`/mnt/p6/build/glibc-fullmake-inventory-20261002/logs/primary-failures.json`.
It contains **168 distinct failed GNU targets**. The two later wrapper packets
cover **62 of its 93 generated failures**: 36 fixed plus 26 next26. The
cumulative count of 79 wrappers includes 17 wrappers completed before this
inventory; those 17 must not be subtracted again from its 93 failures.

| Original failure class | Original targets | Dedicated subsequent closure evidence | Outstanding original targets |
| --- | ---: | ---: | ---: |
| Generated syscall signatures | 93 | 62 | 31 |
| GNU C cleanup exception format | 50 | 50 | 0 |
| Floating-point environment | 8 | 8 | 0 |
| GNU library-name metadata | 3 | 3 | 0 |
| Stat ABI selection | 2 | 2 compile targets | 0 compile targets |
| Memory syscall selections | 3 | 0 | 3 |
| Caller provenance | 5 | 0 | 5 |
| Checked jump selection | 1 | 0 | 1 |
| Libio object aliases | 1 | 0 | 1 |
| Cancellation instruction markers | 1 | 0 | 1 |
| Scheduler header dependency | 1 | 0 | 1 |
| **Total** | **168** | **125** | **43** |

This is a reconciliation against dedicated packets, not a new fullmake result.
Some of the 43 may cease failing when cumulative headers are replayed; they
remain outstanding until their exact targets are rebuilt and audited. Stat's
two compile targets have separate public runtime work, including the corrected
contiguous-canary gate, owned by the integration agent. Compiled pthread
cancel/create/exit objects do not establish those APIs' runtime support.

`original-target-reconciliation.json` records all 168 identities and the
deduplicated 43 outstanding rows, with exact original source/snapshot paths,
SHA-256, retained compiler-command paths/hashes, generator defines, and aliases.
All 43 current original sources match their retained failure snapshots.

## Source and selected kernel provenance

Paths below use these exact roots:

- **G**: `/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44`, the genuine signed GNU source.
- **K**: `/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/s6qc0any0wby0f4nnivpaanvqb9hl130-source`, the retained Linux source.
- **C**: `/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/mzbhr58f5fk50b15xfrk68mwsdg4xs1c-source/.config`, the retained generated configuration. It is under parent `linux`, not `linuxonweb`.
- **B**: `/mnt/p6/project/linux/linuxonweb/web/linux/vmlinux.wasm`, the actual retained kernel binary.

C SHA-256 is
`58a7183fed206cddffbc291c32ea0393d9c30f3dc6fa4b827873164a3737d485`.
B SHA-256 is
`21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75`.
`source-provenance.json` pins 79 source/configuration/planning inputs.
`kernel-bodies.json` records exact function indices, active element indices,
code-body file offsets, lengths, SHA-256 and prefixes. The inspection includes
duplicate names: an unbound ENOSYS sibling of epoll_ctl or capget is not the
selected implementation. Likewise, real dormant brk/munmap/mremap bodies do
not make the omitted Wasm syscall numbers available.

K `arch/wasm/kernel/syscall.c:17–20` constructs the syscall table from the
architecture unistd stream, defaulting every omitted entry to sys_ni_syscall;
lines59–62 dispatch through that table. K
`arch/wasm/include/uapi/asm/unistd.h:10` defines
`__ARCH_WANT_NO_MEMORY_SYSCALLS`. K
`include/uapi/asm-generic/unistd.h:559–565`,579 and904–925 consequently omit
brk, munmap, mremap and mmap/mmap2 from that stream.

| API/selected kernel name | Syscall number | Active element → function | Body offset / bytes | Capability evidence |
| --- | ---: | --- | --- | --- |
| sched_setparam | 118 | 183 → 2016 | 486266 / 26 | Real body |
| sched_setscheduler | 119 | 184 → 2014 | 486024 / 49 | Real body |
| sched_getparam | 121 | 186 → 2021 | 487133 / 181 | Real body |
| uname / newuname | 160 | 224 → 755 | 264229 / 337 | Real body |
| sysinfo | 179 | 243 → 782 | 272014 / 314 | Real body |
| epoll_ctl | 21 | 87 → 6518 | 1464446 / 147 | Real body; CONFIG_EPOLL=y |
| quotactl | 60 | 125 → 1157 | 340593 / 4 | ENOSYS; CONFIG_QUOTA unset |
| name_to_handle_at | 264 | 317 → 1306 | 341338 / 4 | ENOSYS; CONFIG_FHANDLE unset |
| mount_setattr | 442 | 386 → 5851 | 1313608 / 301 | Real body |
| pidfd_send_signal | 424 | 368 → 699 | 254513 / 366 | Real body |
| capget | 90 | 155 → 563 | 225246 / 472 | Real body; CONFIG_MULTIUSER=y |
| capset | 91 | 156 → 565 | 225996 / 420 | Real body; CONFIG_MULTIUSER=y |
| init_module | 105 | 170 → 1181 | 340713 / 4 | ENOSYS; CONFIG_MODULES unset |
| delete_module | 106 | 171 → 1182 | 340718 / 4 | ENOSYS; CONFIG_MODULES unset |
| prctl | 167 | 231 → 773 | 267893 / 1941 | Real body, option-specific support |
| vhangup | 58 | 123 → 4958 | 1122953 / 34 | Real body, capability/TTY dependent |
| sync | 81 | 146 → 6183 | 1389380 / 10 | Real body |
| pivot_root | 41 | 107 → 5850 | 1313460 / 146 | Real body, root/mount topology dependent |

Every ENOSYS body above and in the memory table below is exactly
`00 41 5a 0b`: zero locals, i32.const -38, end. Its SHA-256 is
`5f51e5a7d8d201941dddaeaed4fc1773573d40a5a76554643c65f8cd7a8e9b2d`.
The active element and source table selection are part of the evidence;
finding that byte sequence or a named function alone is insufficient.

The read-only inspection/reconciliation can be repeated without a compiler:

```sh
python3 /mnt/p6/build/glibc-remaining-closure-plan-20261002/inspect-kernel.py
python3 /mnt/p6/build/glibc-remaining-closure-plan-20261002/reconcile.py
```

For an individual body, inspect the recorded offset/length directly, for
example `dd if=web/linux/vmlinux.wasm bs=1 skip=340593 count=4 status=none | xxd -p`.
This reproduces binary evidence, not a guest test.

## Three scheduler wrappers and genuine semaphore packet

G `posix/sched.h:54–62` supplies the exact public prototypes:

```c
int sched_setparam(pid_t, const struct sched_param *);
int sched_getparam(pid_t, struct sched_param *);
int sched_setscheduler(pid_t, int, const struct sched_param *);
```

G `bits/types/struct_sched_param.h:23–26` and K
`include/linux/sched.h:412–414` each define one `int sched_priority`.
The source-derived expected size/alignment is4/4, priority offset0. Fresh
target compiler measurements must establish that expectation independently
for the actual selected GNU and kernel headers; this review did not compile
layout probes. Retain G `sysdeps/unix/sysv/linux/syscalls.list:58,62–63` and
the exact original generated streams, including the strong
`__sched_getparam`, `__sched_setparam`, `__sched_setscheduler` bodies and their
GNU public weak aliases. No void-pointer substitute is needed.

The original sem_post diagnostic is at original
`logs/fullmake-inventory.log:2898`: G
`sysdeps/nptl/internaltypes.h:31` embeds an incomplete `struct sched_param`.
G `nptl/sem_post.c:24` includes internaltypes without arranging its scheduler
type dependency. A narrow owned forwarding header can include genuine
`sched.h` before the genuine internaltypes header; prove the resulting actual
GNU pthread attribute/descriptor layout is unchanged. Do not replace the
structure, copy a foreign pthread ABI, or change the GNU sem_post algorithm.

The proposed build packet should:

1. Use fresh signed GNU replay, accepted private C-EH compiler and current
   cumulative owned architecture selection in new disk-backed storage.
2. Audit the three public function-pointer signatures, actual GNU/kernel
   sched_param layouts, and exact original generator-stream bytes. Rebuild all
   four original GNU targets through genuine make, auditing symbols/aliases.
3. Freshly rebuild G `nptl/sem_init.c`, `nptl/sem_wait.c` and
   `nptl/sem_getvalue.c` to supply genuine public sem_init, sem_trywait and
   sem_getvalue controls. G `sem_wait.c:76–86` implements noncancellable
   __new_sem_trywait using the genuine fast token acquisition algorithm;
   __new_sem_wait at lines24–42 explicitly requires pthread_testcancel and a
   cancellable slow wait. If unreachable sem_wait dependencies prevent the
   scoped trywait link, use inspected function section GC or ThinLTO to retain
   only the requested API's genuine reachable implementation. Do not add a
   cancellation provider stub. Record the retained-sem_wait link limitation
   explicitly; this scope is not public sem_wait acceptance or a complete
   libc archive.
4. Measure sem_t/new_sem sizes, alignment, offsets and the actual selected
   atomic-sem_t branch. Audit real Wasm atomic instructions and GNU release/
   acquire ordering. Preserve GNU versioned-symbol/static aliases; do not use
   the custom kernel wasm_sem_* API as a substitute for GNU semaphores.
5. Retain current allocator/startup/jump/abort/syscall/stat regressions and pin
   every newly linked source, actual include and object in both guest modes.

Runtime expectations must follow the pinned kernel arguments and policies.
K `kernel/sched/syscalls.c:853–866` rejects NULL param or negative PID with
EINVAL, then copies one sched_param, returning EFAULT for a failed copy and
ESRCH for a missing task. sched_setscheduler additionally rejects a negative
policy at934–939. sched_getparam at1025–1050 copies exactly the one integer on
success and leaves the output untouched on these preceding error paths.
K `__sched_setscheduler:493–590` accepts real policy/priority changes after
validation and permission checks: normal/batch/idle priority must be0, FIFO/RR
priority must be1–99. This is not a syscall that merely validates then ignores
all changes. Kernel `kernel/sched/Makefile:41` selects build_policy.o, and
`build_policy.c:66` includes the reviewed syscalls.c.

Run actual native and FPCAST23i64 Linux guests with:

- Public sched_getparam success for PID0/current PID, surrounded by immediate
  contiguous byte canaries. Check priority against independent raw-kernel
  readback, preserve success errno, and verify negative-PID/NULL/missing-task
  errors and unchanged canaries/output. Capture the real pointer and every
  kernel argument rather than inferring transport from returned values.
- Public sched_setparam with a valid preserved priority; public
  sched_setscheduler with a real controlled transition between SCHED_OTHER
  and SCHED_BATCH, both priority0, in an isolated child. Record original
  policy/priority, read back after each successful change, and restore them
  through public GNU APIs before exit. Verify invalid policy and invalid
  priority errors without changing the original state. If permission or
  runtime behavior blocks a proposed change, retain the failure; source
  support does not turn it into a successful policy fixture. Avoid changing
  the regression runner's policy or asserting FIFO/RR success without its
  actual permission/range evidence.
- Genuine public sem_init(value0), sem_trywait→EAGAIN, sem_post→one token,
  sem_getvalue→1, successful sem_trywait→0, then EAGAIN again. Check errno,
  contiguous sem_t/output canaries, and preservation on failure.
- Genuine sem_init above SEM_VALUE_MAX→EINVAL, and a semaphore initialized
  to SEM_VALUE_MAX whose sem_post→EOVERFLOW preserves its token count. G
  sem_post:43–56/59–73 contains the exact overflow/wake branches. Do not
  expect GNU sem_getvalue to validate an invalid object: its source explicitly
  lacks that validation.
- Concurrent initialized GNU-TLS/errno users calling public post/trywait:
  matched produced/consumed token counts, no spurious trywait success, payload
  publication visibility, and independent per-thread errno. A test that
  manually models a futex waiter may separately check sem_post's wake branch,
  but it cannot claim public blocking sem_wait or cancellation acceptance.

If these gates pass, four more original targets have dedicated closure
evidence, leaving39 outstanding historical targets. Extra semaphore controls
are additional units, not additional subtractions from the original168.

## The other nine layout/historical exports

All return int. The table supplies genuine public types where GNU declares
them; historical exports must have clearly labelled kernel-derived types.

| Original target | Argument types and source | Remaining work / truthful expectation |
| --- | --- | --- |
| posix/uname.o | `struct utsname *`; G posix/sys/utsname.h:48–81 | GNU/Linux fields are six65-byte arrays: expected390 bytes/alignment1. Measure, then success strings and contiguous canaries; K kernel/sys.c:1351 copies new_utsname. |
| misc/sysinfo.o | `struct sysinfo *`; G Linux sys/sysinfo.h:25–29 imports linux/kernel.h | Retain actual kernel long32, not GNU time_t64. K UAPI linux/sysinfo.h:8–23 implies64 bytes on Wasm32; measure every offset and padding; zero/output-bound/runtime checks, K kernel/sys.c:2997. |
| misc/epoll_ctl.o | `int,int,int,struct epoll_event *`; G Linux sys/epoll.h:123–125 | GNU generic/kernel Wasm layouts are expected16 bytes, data offset8, alignment8; packing is only selected on other architectures. Measure; real eventfd ADD/MOD/DEL and data64 readback using a separately audited observation path. Do not adopt x86's packed12-byte layout. K fs/eventpoll.c:2628 copies the whole event. |
| misc/quotactl.o | `int,const char *,int,caddr_t`; G Linux sys/quota.h:130 | Exact ENOSYS/errno/output-canary gate now. Success would require enabled kernel quota and a supporting mounted filesystem; dormant quota source is insufficient. |
| misc/name_to_handle_at.o | `int,const char *,struct file_handle *,int *,int`; G bits/fcntl-linux.h:365–370,456 | Handle prefix expected8 bytes plus caller-sized flexible bytes; mutable handle_bytes and mount ID are separate outputs. Current selected body is ENOSYS. Future success also requires real filesystem export handles, which ramfs does not establish. |
| misc/mount_setattr.o | `int,const char *,unsigned int,struct mount_attr *,size_t`; G Linux sys/mount.h:211–217,329 | Four uint64 fields, expected32 bytes/alignment8; test version-size/tail, flag validation, isolated mount mutations/restore. Respect retained NULL/default-source mount bug and use the already validated configured-source ramfs route. |
| misc/pidfd_send_signal.o | `int,int,siginfo_t *,unsigned int`; G Linux sys/pidfd.h:132 | NULL-info signal0 first; non-NULL requires genuine GNU→kernel siginfo conversion and exact supported union/code fields. The existing signal conversion is not automatic acceptance of this different syscall. K kernel/signal.c:4075. |
| misc/capget.o | Historical two-pointer export; kernel cap_user_header_t, cap_user_data_t | GNU ships a symbol/stream but no public capget prototype. K UAPI capability.h:40–50: header version32/PID32, data three uint32 per wordset. Independently type an owned historical declaration, version negotiation/write bounds, current actual capabilities. |
| misc/capset.o | Historical two-pointer export; kernel header/data pointers | Same explicit historical status; audit kernel const semantics rather than inventing a GNU signature. Test a reversible self no-op capability set/readback and invalid-version errors; dropping capabilities is irreversible within a task, so do not mutate the main runner. |

## Calling-convention anomalies and historical pivot_root

These six targets are outside the ordinary signature-expansion route.

| Original target | Exact mismatch | Faithful next selection |
| --- | --- | --- |
| misc/prctl.o | GNU public `int prctl(int,...)`, G Linux sys/prctl.h:42; stream has five fixed registers and aliases __prctl_time64 | Select a true variadic architecture source with GNU aliases. G Linux/or1k/prctl.c:26–43 is a genuine C precedent for four unsigned-long varargs, not a drop-in foreign ABI. Wasm varargs lowering and options needing fewer/no varargs need explicit review; reading absent Wasm varargs can consume unrelated linear memory. First supported name GET/SET options must supply and transport all expected argument words. Do not publish a five-fixed-argument prototype. |
| misc/vhangup.o | G posix/unistd.h:939 declares `int vhangup(void)`; generic Unix syscalls.list:91 generates one argument | Owned architecture stream selection must correct to zero kernel arguments while retaining the original anomaly and export. Exact capability/TTY-dependent behavior, never a fabricated successful hangup. |
| misc/sync.o | G posix/unistd.h:1005 declares `void sync(void)`; Unix list:84 uses int-result convention | Void-return architecture wrapper invokes actual sync and preserves ordinary GNU behavior/errno; no int-return public prototype. |
| misc/init_module.o | Linux syscalls.list:28 generates five args; K kernel/module/main.c:3634 defines three | Historical export, no genuine GNU public prototype. Kernel-reviewed arguments are module pointer,unsigned long length,const char *parameters; future owned selection uses three. Current kernel modules disabled: exact ENOSYS, no module-loading success. |
| misc/delete_module.o | Linux syscalls.list:8 generates three args; K kernel/module/main.c:804 defines two | Historical export with name pointer,unsigned int flags; honest current ENOSYS. Retain original count mismatch. |
| misc/pivot_root.o | Fixed two-path stream but no GNU public prototype | Historical kernel-derived `int(const char *,const char *)` declaration. K fs/namespace.c:4759 has a real body. Success needs a genuinely isolated valid mount/root topology; defer it rather than mutating the regression runner's root. |

## Memory API selection and the thirteen remaining generated facilities

| Original target | Public argument types (G sys/mman.h or Linux bits/mman headers) | Active element → function / body offset |
| --- | --- | --- |
| misc/mlock.o | `const void *,size_t` | 288 → 1269 / 341153 |
| misc/munlock.o | `const void *,size_t` | 289 → 1270 / 341158 |
| misc/mlockall.o | `int` | 290 → 1271 / 341163 |
| misc/munlockall.o | `void` | 291 → 1272 / 341168 |
| misc/mprotect.o | `void *,size_t,int` | 286 → 1267 / 341143 |
| misc/madvise.o | `void *,size_t,int` | 293 → 1274 / 341178 |
| misc/mincore.o | `void *,size_t,unsigned char *` | 292 → 1273 / 341173 |
| misc/remap_file_pages.o | `void *,size_t,int,size_t,int` | 294 → 1277 / 341193 |
| misc/process_madvise.o | `int,const struct iovec *,size_t,int,unsigned int`; return ssize_t | 384 → 1275 / 341183 |
| misc/process_mrelease.o | `int,unsigned int` | 391 → 3945 / 886003 |
| misc/mseal.o | `void *,size_t,unsigned long` | 405 → 1285 / 341233 |
| misc/pkey_alloc.o | `unsigned int,unsigned int` | 342 → 1326 / 341438 |
| misc/pkey_free.o | `int` | 343 → 1327 / 341443 |

All thirteen selected kernel bodies are four-byte ENOSYS. All returns are int
except public process_madvise's ssize_t. C disables ADVISE_SYSCALLS, lacks an
enabled MMU, and K mm/Makefile:36–40 selects nommu instead of the protection/
mapping implementation family. The existence of mm/mprotect.c is dormant
source evidence. This cannot supply genuine guard pages by configuration alone.

The three additional original memory failures are:

| Target | Actual original source | Original failure |
| --- | --- | --- |
| misc/brk.o | G sysdeps/unix/sysv/linux/brk.c; brk_call.h:24 | Missing __NR_brk, original log:6919 |
| misc/mmap64.o | G sysdeps/unix/sysv/linux/mmap64.c:58 | Missing __NR_mmap, log:3938 |
| misc/mremap.o | G sysdeps/unix/sysv/linux/mremap.c:49 | Missing __NR_mremap, log:5095 |

The existing owned `tools/glibc/port/wasm-memory.c` is the accepted GNU
allocator's nonrecursive authority. Its limitations are part of the API plan:

- __mmap accepts exactly anonymous private RW, fd−1, offset0; all other
  modes return ENOTSUP. Public mmap/mmap64 offsets must retain genuine off_t64
  width and aliases, without inventing a kernel mmap number.
- __munmap releases only a complete tracked mapping. It reuses logical ranges;
  it does not make stale pointers fault or support arbitrary partial unmapping.
- __mremap accepts flags0/MAYMOVE, exact tracked source ranges, shrink/reuse
  and copy-preserving movement. FIXED/DONTUNMAP return ENOTSUP without reading
  absent varargs. GNU's Linux source validates known flag bits first; a new
  public selection must retain appropriate EINVAL versus unsupported behavior.
- __sbrk grows the shared authority cursor, reports failed growth without
  advancing it, and rejects negative increments. Selecting genuine GNU sbrk
  additionally requires coherent __curbrk and __brk semantics, including
  query/growth/shrink failure and separation from live mapping reservations.
  An alias to __sbrk is not a correct implementation of int brk(void *).
- __mprotect always returns ENOTSUP. __madvise supports only aligned
  MADV_DONTNEED within the heap cursor range and zeroes bytes. It currently
  does not verify mapping liveness; public advice acceptance needs tighter
  ownership/partial-range/error review before exposing that breadth.

A later memory packet must select exactly one provider for each public/internal
symbol. Generated raw mprotect/madvise wrappers would conflict with these owned
providers and produce different errors; they cannot silently replace them.
Keep raw-kernel ENOSYS evidence distinct from the explicitly owned logical
memory API's ENOTSUP/subset success. Add public alias/type/offset/overflow,
mapping overlap/reuse/canary/OOM and failed-growth state checks in both modes.
Do not substitute malloc-backed mmap or claim guard/permission support.

## The eight other structural targets

| Original target(s) | Source/diagnostic evidence | Required follow-up |
| --- | --- | --- |
| debug/____longjmp_chk.o | G Linux ____longjmp_chk.c:19 needs jmpbuf-offsets.h; original log:7091 | The accepted native helper already implements owner/stack/direction checks in tools/glibc/jumps/helpers.c:11–17. Its fullmake overlay selects __longjmp.c, not the standalone debug target. Give the exact target a faithful architecture selection with one definition, retain checked/unchecked aliases, replay valid and abort134 owner/bounds/direction gates. Generic Linux code falls through on unsupported sigaltstack, so a made-up offsets header would weaken the accepted check. |
| gmon/mcount.o | G gmon/mcount.c uses machine-gmon.h/MCOUNT and genuine caller/self-PC edges | Native Wasm profiling/compiler call-site provenance; no null or constant caller replacement. |
| dlfcn/dlopen.o, dlfcn/dlmopen.o, dlfcn/dlsym.o, dlfcn/dlvsym.o | G corresponding sources call RETURN_ADDRESS(0) | Reviewed static-module registration and real caller-to-module provenance. Preserve public APIs, GNU locking/error paths, symbol versions, RTLD_NEXT scope and honest unsupported ELF/namespace errors. Compilation without provenance is not loader acceptance. |
| libio/vtables.o | G vtables.c:560–568 exports two interior object aliases into __io_vtables; libc-symbols.h:258–278 emits .global/.type/.set/.size; original log:12819 rejects .global _IO_file_jumps | A narrow Wasm data-alias/relocation representation preserving exact interior address, object size, exported names and vtable bounds. Verify symbols/relocations/address identity with genuine libio and section-GC/archive controls before stdio runtime. Erasing the assembly or substituting separate copies changes identity. |
| nptl/syscall_cancel.o | G Linux syscall_cancel.c:24–49 specifies cancellation PC boundaries; log:3018 says data symbols need .size for __syscall_cancel_arch_start | Full native cancellation design, not metadata labels or a compile-only marker repair. Genuine pthread_cancel consumes signal context PC; current signal adapter supplies NULL context. G nptl/unwind.c:70,130 needs _Unwind_GetCFA/_Unwind_ForcedUnwind absent from the accepted LLVM Wasm path. Preserve syscall side effects, blocked-wait interruption, forced cleanup/destructors and join result; no cancellation stub or ordinary setjmp wrapper. |

These are eight exact targets: one checked jump, five provenance, one libio
and one cancellation target. The three memory selections and sem_post are
accounted for in their separate sections above.

## Critical path and acceptance boundary

After the four-target scheduler/semaphore packet, build the small uname/sysinfo
layout pair and then epoll_ctl with exact64-bit data transport. Historical,
quota/handle ENOSYS and anomaly selections can close build metadata honestly
while leaving unsupported facilities explicitly unavailable. The separate
memory packet must preserve the allocator authority and prepare real stack
overflow/guard adaptation: G nptl/allocatestack.c:169 requests MAP_STACK,
201–229 requires MADV_GUARD_INSTALL or mprotect(PROT_NONE). Current providers
cannot satisfy those default NPTL semantics unchanged.

Converge all owned selections in a fresh genuine fullmake inventory before
claiming the historical43 are closed; retain newly exposed failures, actual
source selection and object hashes. A structurally complete archive still
needs production CRT/init/fini, complete GNU TP/DTV/TLS lifecycle, default
pthread create/exit/join/detach/once, real cancellation/forced unwinding,
stdio, and the reviewed static loader. Rebuild all consumers against the
accepted native ABI, including changed jmp_buf and true GNU headers/libraries.
Only then can a coherent GNU sysroot/toolchain and Firefox Nightly be accepted,
followed by full native Wasm JIT, GPU and verified Sites release. No step here
accepts a musl/WASI archive, an x86 substitute, or unsupported-success fixtures.
