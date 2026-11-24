# Next GNU generated-wrapper packet — 2026-10-02

Source-only proposal for 16 original GNU lib targets: genuine public types and
aliases, three enabled kernel APIs, and thirteen APIs whose selected retained
kernel bodies return ENOSYS. This advances cumulative GNU archive closure while
keeping unsupported operations visible to ordinary callers. Complete genuine
GNU libc/sysroot and runtime support remain prerequisites for Firefox Nightly
159, then native Wasm JIT, GPU and the verified Sites release.

No compiler, make, guest, browser, server or kernel build was run for this plan.
Only this new document and `/mnt/p6/build/glibc-remaining-wrappers-plan-20261002`
were written. The directory is on `/mnt/p6` ext4, with owned `tmp` and `cache`
directories and a 2 GiB cap. Earlier packets and plans remain unchanged.

## Historical target reconciliation

The frozen inventory has 168 distinct failed GNU lib targets. Dedicated later
packets cover 125: 50 C cleanup, eight fenv, 62 of the original 93 generated
wrappers, three library-name headers and two stat compile selections. The
cumulative 79 generated wrappers include 17 completed before that inventory;
79 must not be subtracted from its 93. The remaining historical set is 43.

`posix/sched_setp.o`, `posix/sched_getp.o`, `posix/sched_sets.o` and
`nptl/sem_post.o` are assigned separately. Their assignment is not acceptance.
If those four pass, 39 historical targets remain, including the 28 generated
targets reviewed here. If the proposed sixteen also pass, 23 historical targets
remain, including twelve generated targets. These counts reconcile dedicated
target evidence; they are not a fresh successful full make or libc archive.

The new `target-matrix.json` retains every one of the 28 exact original unit
identities, source and source-snapshot hashes, retained `commands.json` hash,
the complete original compiler command arrays and original GNU working
directory. It independently verifies that source and snapshot match, and that
the retained command array equals the original failure row. For each target it
records the exact log line for the deliberate signature-audit error and the
associated make failure. The original error is:

```
GNU generated syscall has no audited native Wasm public signature
```

All original streams in the proposed sixteen have `SYSCALL_NOERRNO=0` and
`SYSCALL_ERRVAL=0`. Preserve normal GNU return/errno translation, each exact
argument count, unsigned-long transport annotations and all generated alias
lines. A recognized name alone must not open the architecture audit gate.

## Proposed sixteen

Public declarations come from the signed GNU 2.44 tree. `_GNU_SOURCE` exposes
the GNU extensions. Public type checks must use a separate client translation
unit, avoiding GNU internal inline substitutions. The typed function-pointer
assignments must compile without incompatible-pointer or prototype diagnostics.

| Original target | Genuine GNU public type | Public header | Required kernel result |
| --- | --- | --- | --- |
| `posix/uname.o` | `int (struct utsname *)` | `sys/utsname.h` | Success and EFAULT |
| `misc/sysinfo.o` | `int (struct sysinfo *)` | `sys/sysinfo.h` | Success and EFAULT |
| `misc/epoll_ctl.o` | `int (int, int, int, struct epoll_event *)` | `sys/epoll.h` | ADD/MOD/DEL success and specified errors |
| `misc/quotactl.o` | `int (int, const char *, int, caddr_t)` | `sys/quota.h` | Exact ENOSYS |
| `misc/name_to_handle_at.o` | `int (int, const char *, struct file_handle *, int *, int)` | `fcntl.h` | Exact ENOSYS |
| `misc/mlock.o` | `int (const void *, size_t)` | `sys/mman.h` | Exact ENOSYS |
| `misc/munlock.o` | `int (const void *, size_t)` | `sys/mman.h` | Exact ENOSYS |
| `misc/mlockall.o` | `int (int)` | `sys/mman.h` | Exact ENOSYS |
| `misc/munlockall.o` | `int (void)` | `sys/mman.h` | Exact ENOSYS |
| `misc/mincore.o` | `int (void *, size_t, unsigned char *)` | `sys/mman.h` | Exact ENOSYS |
| `misc/remap_file_pages.o` | `int (void *, size_t, int, size_t, int)` | `sys/mman.h` | Exact ENOSYS |
| `misc/process_madvise.o` | `ssize_t (int, const struct iovec *, size_t, int, unsigned int)` | `sys/mman.h` | Exact ENOSYS |
| `misc/process_mrelease.o` | `int (int, unsigned int)` | `sys/mman.h` | Exact ENOSYS |
| `misc/mseal.o` | `int (void *, size_t, unsigned long)` | `sys/mman.h` | Exact ENOSYS |
| `misc/pkey_alloc.o` | `int (unsigned int, unsigned int)` | `sys/mman.h` | Exact ENOSYS |
| `misc/pkey_free.o` | `int (int)` | `sys/mman.h` | Exact ENOSYS |

`caddr_t` is the GNU `char *` typedef, not a replacement `void *` prototype.
`process_madvise` has public `ssize_t` return even though its generated list
uses the `i` transport class. On this Wasm32 ABI they occupy the same signed
32-bit result slot; the public definition and type audit must retain `ssize_t`.
`pkey_alloc` arguments are unsigned in the genuine public declaration despite
the generated stream's `i:ii` spelling. GNU `size_t` and `unsigned long` are
32-bit here; no pointer or signedness information should be erased in C.

Preserve these exact generated strong bodies/public weak aliases and hidden
weak declarations: `__uname`/`uname`, `__sysinfo`/`sysinfo`,
`__remap_file_pages`/`remap_file_pages`, `__mseal`/`mseal`,
`__pkey_alloc`/`pkey_alloc`, `__pkey_free`/`pkey_free`. The other ten streams
define their public names directly with no alias lines. `target-matrix.json`
contains the exact original alias text and all seven stream defines per row.

Declaration locations under GNU 2.44: `posix/sys/utsname.h:81`, Linux
`sys/sysinfo.h:29`, `sys/epoll.h:124`, `sys/quota.h:130`,
`bits/fcntl-linux.h:456`, `misc/sys/mman.h:103–140`, Linux
`bits/mman_ext.h:25–30` and `bits/mman-shared.h:65–91`. The latter paths are
under `sysdeps/unix/sysv/linux/`. Retain unchanged GNU generator output and
add bounded owned architecture type selection using the preceding packets'
audited template pattern.

`target-matrix.json` also records each Linux SYSCALL_DEFINE argument type,
exact declaration text, source hash and line. All raw results use signed native
`long`. uname takes kernel `new_utsname *`; sysinfo/epoll use the measured
kernel counterparts. quotactl uses unsigned cmd/qid_t and a void output
pointer; name_to_handle_at uses a void mount-id pointer. mlock/munlock/mincore
and mseal encode addresses as unsigned long; remap_file_pages uses five
unsigned longs; pkey_alloc uses two unsigned longs. These are32-bit transport
slots on Wasm32, while the GNU public C declarations above remain exact.
For name_to_handle_at, ordinary flags0 use the genuine public int mount-id
output; the newer AT_HANDLE_MNT_ID_UNIQUE protocol is not accepted here.
The disabled source declarations are pinned for ABI review, and must not be
mistaken for selected implementations.

## Retained kernel capability proof

Exact artifacts:

- Kernel source: `/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/s6qc0any0wby0f4nnivpaanvqb9hl130-source`.
- Actual configuration: `/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/mzbhr58f5fk50b15xfrk68mwsdg4xs1c-source/.config`.
  SHA-256 `58a7183fed206cddffbc291c32ea0393d9c30f3dc6fa4b827873164a3737d485`.
- Retained binary: `/mnt/p6/project/linux/linuxonweb/web/linux/vmlinux.wasm`.
  SHA-256 `21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75`.
- Actual Linux headers selected in the original compiler commands:
  `/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/ckv9mf7zan7434qdbfj6cv8dhqn228ab-linux-0.0.0-headers/include`.

The table below pairs the asm-generic syscall number with the active Wasm
element-table binding and its code body. The syscall table's source selection
is `arch/wasm/kernel/syscall.c:17–20`, dispatch `:59–62`, including
`include/uapi/asm-generic/unistd.h`. The section parser records dormant named
duplicates too; only a body with the active element binding is used below.
For example, dormant `sys_epoll_ctl` function 1146 returns ENOSYS but the
active function is 6518. Do not infer a disabled API from that dormant body.

| API | Syscall nr | Active element → function | Body byte offset / size |
| --- | ---: | --- | --- |
| uname (`sys_newuname`) | 160 | 224 → 755 | 264229 / 337 |
| sysinfo | 179 | 243 → 782 | 272014 / 314 |
| epoll_ctl | 21 | 87 → 6518 | 1464446 / 147 |
| quotactl | 60 | 125 → 1157 | 340593 / 4 |
| name_to_handle_at | 264 | 317 → 1306 | 341338 / 4 |
| mlock | 228 | 288 → 1269 | 341153 / 4 |
| munlock | 229 | 289 → 1270 | 341158 / 4 |
| mlockall | 230 | 290 → 1271 | 341163 / 4 |
| munlockall | 231 | 291 → 1272 | 341168 / 4 |
| mincore | 232 | 292 → 1273 | 341173 / 4 |
| remap_file_pages | 234 | 294 → 1277 | 341193 / 4 |
| process_madvise | 440 | 384 → 1275 | 341183 / 4 |
| process_mrelease | 448 | 391 → 3945 | 886003 / 4 |
| mseal | 462 | 405 → 1285 | 341233 / 4 |
| pkey_alloc | 289 | 342 → 1326 | 341438 / 4 |
| pkey_free | 290 | 343 → 1327 | 341443 / 4 |

Each selected four-byte body is exactly `00 41 5a 0b`: zero local groups,
`i32.const -38`, `end`. Its SHA-256 is
`5f51e5a7d8d201941dddaeaed4fc1773573d40a5a76554643c65f8cd7a8e9b2d`.
Full enabled body hashes are:

- uname: `fea6a03273a26e3cde2946738c073686f3a6cadfb85a431d240e6f365bec71ed`.
- sysinfo: `755fe23932072ef2edba4fc976c91981277760ee29882d8437ce1fff8e27b015`.
- epoll_ctl: `a650b4a80fc2edc90ce7010f1879d83114b4866d4e8fc52439f62940355f5e68`.

Configuration corroborates selection: `CONFIG_EPOLL=y` at line154,
`CONFIG_EVENTFD=y` at157; `CONFIG_FHANDLE` is unset at147, advice syscalls
unset at160, modules unset at231, quota unset at1270, namespaces unset at124.
The exact `CONFIG_MMU` setting is absent; `CONFIG_MMU_LAZY_TLB_REFCOUNT=y`
is a different setting. `mm/Makefile:36–48` selects `nommu.o` and keeps the
MMU-dependent memory family dormant; advice objects also require MMU at74–76.
`kernel/sys_ni.c:63,177–193,225,263–264` supplies conditional fallbacks.
`mm/oom_kill.c:1195–1256` has a compiled non-MMU ENOSYS branch for
`process_mrelease`, explaining its separate selected function3945.

These facts establish capability expectations, not guest runtime acceptance.
No rootfs filesystem can override the unconditional selected ENOSYS for quotas
or file handles. Do not promise either operation on ramfs or any other mounted
filesystem. The epoll fixture uses an eventfd and does not depend on rootfs
support for polling ordinary files.

## Layout gate before wrapper compilation

Compile fresh constant/offset measurement units against the actual generated
GNU header selection and, separately, selected kernel UAPI headers. Save the
exact header dependencies, compiler flags, IR constants and object hashes. The
following are source-derived expectations, not measurements from this task:

| Type | Expected native Wasm layout | Conversion decision |
| --- | --- | --- |
| GNU `struct utsname`, kernel `struct new_utsname` | size390, alignment1; six 65-byte arrays at0/65/130/195/260/325 | Direct pointer only after equality measured |
| GNU/kernel `struct sysinfo` | size64, alignment4; signed32 uptime0; unsigned32 loads4/8/12; totalram16, freeram20, sharedram24, bufferram28, totalswap32, freeswap36; u16 procs40/pad42; totalhigh44/freehigh48; mem_unit52; `_f[8]`56 | Direct pointer only after equality measured |
| GNU/kernel `struct epoll_event` | size16, alignment8; events0, data8; GNU union size8/alignment8 | Direct pointer only after equality measured; no packed x86 layout |
| GNU `struct file_handle` | size8, alignment4; handle_bytes0, handle_type4, payload8 | No kernel copy on current ENOSYS; retain genuine public layout |
| GNU `struct iovec` | size8, alignment4; pointer0, size_t4 | No kernel read on current ENOSYS; retain genuine public layout |

`sys/sysinfo.h:25` includes `linux/kernel.h`, which includes Linux
`sysinfo.h`; its uptime is Linux native `long`, not GNU 64-bit `time_t`.
Kernel `include/uapi/linux/sysinfo.h:8–23` and generic `posix_types.h:15–16`
define that layout. GNU utsname uses Linux `bits/utsname.h` length65; kernel
`include/uapi/linux/utsname.h:25–32` has matching six fields. GNU generic
Linux `bits/epoll.h` leaves packing empty; kernel `eventpoll.h:76–86` only
packs for x86_64. Selecting an x86 override would be an ABI error.

If an enabled pair differs, stop direct-pointer compilation and add a typed
owned conversion: copy GNU inputs into a measured kernel temporary and copy
kernel outputs into a GNU temporary before publishing on success. Verify every
field, size, alignment and scalar type, including data.u64. Do not translate
unsupported results into success or copy uninitialized output on error.

Every object guard must cover the exact extent: aligned byte storage with
16 bytes directly before the object and 16 directly after `sizeof(object)`.
Do not put an over-aligned member in a struct that adds unguarded padding.
Use static offset checks, initialize object padding explicitly, and compare
prefix, suffix and untouched bytes immediately after each call. The uname
extent is390 and sysinfo extent64; epoll storage must retain alignment8.

## Ordered build and runtime packet

1. Fresh signed GNU replay/configure and cumulative architecture overlay in a
   new owned task; verify frozen predecessor manifests and actual runtime link
   inputs first. Generate real GNU metadata rather than hand-writing it.
   Measure the five layout pairs above and public scalar sizes/signedness.
   Preserve GNU generator source streams and all aliases. Extend the audited
   type registry/template only for the sixteen rows, validating every stream
   define and rejecting changed arity/convention/ULONG annotations.
2. Replay the sixteen exact original GNU make targets using their original
   generated streams and measured architecture selection. Add independent GNU
   public-header clients assigning each API to the exact typed pointer above.
   Save raw and optimized IR, object/function/alias metadata and actual include
   dependencies. Retain public weak aliases and strong internal bodies; do not
   manufacture stub metadata for an ordinary Linux wrapper returning ENOSYS.
3. Link all sixteen through the cumulative real GNU payload/archive candidate
   with no duplicate definitions, unresolved suppression or alternate libc.
   Force retention and execution of every public API using volatile typed
   function pointers. Link/type presence alone is insufficient. Independently
   reread all actual link inputs and preserve earlier suites. Use the accepted
   native compiler/C-cleanup route and genuine GNU errno/TLS.
4. Run the suites below in actual native and FPCAST23i64 Linux guests. Restore
   or close every owned resource, preserve both pass and failed attempts, and
   independently check input hashes and natural guest exits. No new kernel
   configuration is part of this packet. Only after full packet acceptance
   rerun genuine full GNU make to discover its next real selection failures.

Enabled suites:

- **uname:** Fill the390-byte output and contiguous guards with distinguishable
  patterns. Call public `uname` through its genuine type; require0 and unchanged
  errno sentinel, six bounded terminated fields and intact guards. Read a
  separately guarded kernel `newuname` via raw syscall160 and compare all six
  fields without hardcoding a fabricated machine/release string. Repeat after
  another syscall. Require EFAULT through a pointer that provably fails
  `access_ok`; leave the valid output object untouched. `kernel/sys.c:1351–1365`
  performs the copy and release/architecture overrides.
- **sysinfo:** Require public success with guards intact, errno preserved,
  nonnegative uptime, nonzero mem_unit, sensible RAM/swap/high-memory bounds
  and the source-zeroed pad/_f bytes. Bracket the public call with separately
  guarded raw179 calls. Compare stable identity/total fields, not rapidly
  changing free RAM, load values or thread counts. Check nondecreasing bracketed
  uptime. Compute byte quantities with 64-bit multiplication; do not require
  mem_unit1 because `kernel/sys.c:2934–2995` rescales only when native values
  fit. Compare complete layout/fields against the raw representation and
  require EFAULT with a provably rejected pointer. Success writes exactly64
  bytes (`:2997–3006`).
- **epoll_ctl:** Use accepted public `epoll_create1` and nonblocking `eventfd`
  fixtures. ADD EPOLLIN with a nontrivial64-bit data value including high bits;
  input event bytes and guards must remain unchanged. Observe zero readiness,
  write an eventfd counter, observe one ready event and exact64-bit data. MOD
  to a different64-bit value and observe it; drain the eventfd and observe zero.
  DEL with NULL event is required to succeed; write again and observe zero.
  Test duplicate ADD/EEXIST, missing MOD/DEL/ENOENT, bad descriptors/EBADF,
  self-watch/EINVAL, invalid opcode/EINVAL and ADD/MOD unreadable event/EFAULT.
  Sequence errors with valid other inputs so the intended check wins.
  `fs/eventpoll.c:2481–2615` implements the operation/errors; `:2628–2637`
  copies the event only for ADD/MOD. Its added ERR/HUP bits affect the kernel
  local copy, not the caller input. Close both descriptors even after errors.

The readiness observer is task-local raw syscall22 `epoll_pwait(epfd, out, 1,
0, NULL, 8)`, not a new GNU public cancellation wrapper. Its selected binding
is element88→function6526, body1467527/146; the dormant named function1147
returns ENOSYS but has no active element. The parser records both and the full
body hash. `fs/eventpoll.c:2722–2753` and `kernel/signal.c:3282–3298` confirm
the null mask skips conversion; no GNU128-byte sigset is passed. Use the
measured16-byte kernel epoll layout in a contiguous guarded observer buffer.
Raw eventfd read/write and close are fixture plumbing, not new acceptance of
public read/write/close cancellation semantics.

For EFAULT tests, NULL is insufficient proof on this architecture: its
`access_ok` is a numeric range check with TASK_SIZE=U32_MAX, and address0 can
be linear-memory data. Use `(uintptr_t)UINT32_MAX`, whose remaining range is
zero for any nonzero copy, with the genuine pointer type. Sources are
`arch/wasm/include/asm/uaccess.h:8–14` and `processor.h:45`. Do not dereference
that address in the guest fixture. DEL may use NULL because its event is ignored.

Unsupported suites:

- For each of the thirteen exact ENOSYS APIs, call through its genuine public
  typed pointer using valid-shaped arguments and a nonzero errno sentinel;
  require the proper signed return−1 and errno ENOSYS(38). A second call with
  altered flags or arguments must still report the retained unconditional
  ENOSYS, not pretend argument validation or a fallback implemented support.
- `quotactl`: ordinary Q_GETQUOTA-shaped invocation on a harmless path with a
  filled guarded output region; the entire region stays unchanged. Unsupported
  quota configuration is reported explicitly. No mount/filesystem success.
- `name_to_handle_at`: guarded genuine header plus payload storage and a
  separately guarded `int` mount-id sentinel; ordinary flags0, header byte
  capacity initialized. Both output regions, prefix, payload and all guards
  remain unchanged. Do not claim handle availability or overflow negotiation.
- `mincore`: guarded vector and owned allocation payload both remain unchanged.
  mlock/unlock/remap/mseal cases preserve payloads and allocation bookkeeping.
  process_madvise preserves genuine const iovec arrays and their payloads;
  process_mrelease and pkey APIs provide only truthful unsupported results.
  No protection, sealing, residency, reclaim or real memory-lock success claim.
- Use concurrent existing clone/TLS fixture users for at least one enabled
  success/error pair and unsupported pair, proving genuine per-thread errno
  remains independent. This reuses the scoped fixture lifecycle and makes no
  claim about default GNU pthread creation, guarded stacks or cancellation.

## Twelve deferred generated targets

| Exact original target | Concrete next requirement |
| --- | --- |
| `misc/mprotect.o` | Resolve provider selection: existing owned `__mprotect` returns ENOTSUP, raw kernel returns ENOSYS. A second generated strong body collides. Neither path implements protection/guards. |
| `misc/madvise.o` | Resolve provider selection: existing `__madvise` supplies bounded MADV_DONTNEED zeroing, raw kernel returns ENOSYS. Audit mapping liveness and GNU breadth before changing it. |
| `misc/prctl.o` | Genuine variadic `int(int,...)` versus fixed-five stream; option/arity and Wasm va_list adaptation. Linux or1k C source is useful precedent but unconditional extraction of four absent varargs cannot establish Wasm correctness. |
| `misc/vhangup.o` | Genuine `int(void)` and zero-argument kernel versus original one-argument stream; architecture selection must preserve public ABI and terminal side-effect isolation. |
| `misc/sync.o` | Genuine `void(void)` versus generated int return; owned void wrapper/selection and errno preservation, real enabled sync. |
| `misc/init_module.o` | Historical exported symbol with no GNU public declaration; streamfive/kernelthree. Retain export with reviewed type selection and current real ENOSYS. |
| `misc/delete_module.o` | Historical exported symbol with no GNU public declaration; streamthree/kerneltwo, current real ENOSYS. |
| `misc/capget.o` | Historical export/no GNU public declaration; measure version/header/data. Invalid version with NULL data performs version negotiation and can return0; do not replace that protocol with blanket EINVAL. |
| `misc/capset.o` | Historical export/no GNU public declaration; measure two data words for v3, isolate self/no-op acceptance, avoid irreversible capability dropping in the fixture runner. |
| `misc/mount_setattr.o` | Genuine mount_attr four u64s and size/version-tail checks; enabled implementation needs owned isolated mount setup/cleanup, with namespaces disabled. |
| `misc/pidfd_send_signal.o` | Genuine siginfo pointer; measure relevant GNU/kernel union fields and source validation, implement conversion if needed, then real non-NULL delivery. A matching128-byte extent alone cannot establish union semantics. |
| `misc/pivot_root.o` | Historical export/no GNU public declaration, enabled kernel; isolated reversible mount topology, never pivot the shared fixture runner root. |

The owned memory providers in `tools/glibc/port/wasm-memory.c` remain separate
from eleven proposed raw memory/protection ENOSYS operations and the deferred
raw mprotect/madvise ENOSYS entries. They bootstrap
genuine malloc using Wasm growth and logical mappings. Their existence is not
evidence for Linux MMU semantics, MAP_STACK guards, default NPTL stacks or
overflow traps. This packet does not cover pkey_get/set/mprotect merely because
pkey_alloc/free compile, nor general semaphore waits or cancellation.

Beyond these generated targets, real GNU static caller provenance/loader
selection, checked jumps, IO aliases and memory-source selection remain. The
runtime critical path also includes genuine default NPTL, stack/guard
adaptation, cancellation and forced unwind/C++ cleanup; those require their
own architecture/runtime acceptance. Preserve APIs and honest errors; no
null return-address substitutes, cancellation stubs, musl or WASI fallbacks.

## Inspectable evidence and replay

Owned evidence files are `target-matrix.json`, `source-provenance.json`,
`kernel-bodies.json`, `prepare.py`, `inspect-kernel.py` and `readback-audit.json`.
They pin original source, snapshots, command/log evidence, actual GNU public
headers, installed Linux headers, kernel sources, config and binary. The audit
independently rereads all pins and selected body bytes and reports differences.

The scripts perform read-only parsing of inputs and write only owned reports:

```sh
export TMPDIR=/mnt/p6/build/glibc-remaining-wrappers-plan-20261002/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR"
python3 /mnt/p6/build/glibc-remaining-wrappers-plan-20261002/inspect-kernel.py
python3 /mnt/p6/build/glibc-remaining-wrappers-plan-20261002/prepare.py
```

For independent binary proof, read exactly `bodySize` bytes at `bodyOffset`
from the pinned kernel, compare their SHA-256 with `kernel-bodies.json`, and
verify selected unsupported bytes are `00415a0b`. Parse the name and active
element sections to verify the element→function indices; do not search only
for an ENOSYS byte sequence or a dormant name. The report contains all named
alternatives, enabling this distinction without a kernel rebuild.
