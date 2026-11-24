# GNU native cancellation kernel boundary preparation — 2026-10-02

This is a concrete source and compilation packet toward the genuine GNU Wasm
runtime. The rebuilt kernel candidate and separate packaging pass legacy GNU
native/FPCAST guest regression gates. Real cancellation, NPTL forced unwind
and a GNU sysroot remain incomplete. Production kernel/runtime files are
unchanged. Task evidence is under
`/mnt/p6/build/glibc-cancel-kernel-boundary-20261002`.

The preserved v2 patch captures raw syscall result before restart, then restores
registers, signal mask and prior `active_siginfo` before a nounwind policy. Its
generation saturates instead of wrapping, and fork resets the child generation.
Copy status is separate from result policy. Actual GNU cancellation requires
SIGCANCEL, SI_TKILL and same PID plus genuine enabled/pending state; policy 1
changes only raw `-ERESTARTSYS`. Positive partial results, zero, ordinary errors,
`-ERESTARTNOINTR` and restart-block cases retain their result/restart behavior.

The reviewed v3 patch is
`prepared-v3-2/v2-to-v3.patch`, SHA-256
`3c95a1ac75893bb4a0f546fa01b446d32442b619373ef63dc01b4b927beace12`.
It handles simple and SIGINFO callbacks and adds policy 2 for an exact queued
ordinary native exception. The actual kernel loops internally on restart;
waiting for a JavaScript return with policy 0 could block forever. Policy 2
clears restart without changing the restored result; the owned host route must
rethrow the retained exception before guest code sees that internal result.
IRQ disable and normal user-mode restoration remain intact. The first v3
proposal that accidentally omitted IRQ disable is retained and superseded.

Actual changed `signal.c` and `process.c` compile against genuine configured
kernel headers in `kernel-compile-v3/proof.json`; 659 dependency records are
retained. Root independently rechecked 3,688 current/snapshot entries and both
terminal groups. The configured kernel saved commands used clang 22.1.6; these
owned controls use pinned 22.1.8. This is actual-unit/config compilation, without
a source-to-existing-live-kernel identity claim.

`gnu-helpers2/proof.json` records two actual GNU/helper objects and 12 successful
stages. The included `nptl/pthread_cancel.c` bytes match the signed GNU source,
SHA-256 `882af806c4d98bc7188465e426d74adeb7f63b95a9a8e15e0e058feb9ae27cdb`.
The genuine static handler is registered by its actual table address, while
owned helpers retain immutable siginfo and inspect actual cancelhandling flags.
The objects require strong native checkpoint/current/cancellable/leave/invalidate
and import-enter/import-leave providers; no placeholder implementation is linked.
Root independently verified 1,492 current/frozen entries and 12 empty groups.

The canonical frame-owner proposal uses a 60-byte thread sidecar/version 1 with
import/callback/critical depth at offsets 32/36/40 and jump-registration version
at 56. The boundary sidecar is separate and refers to that one canonical chain.
An opaque pre-import bridge binds the actual importing activation, raw TP,
task/exec epoch and module generation before temporary helper frames appear.
After restoration, import-leave validates that compiled guards have already
retired callback descendants, preserving the published nonlocal-jump target.
The primitive never pops arbitrary live guest frames. Polls under nonzero depth retain
pending state and return normally. The frame-only compiler proposal does not
yet supply general EH/SjLj/forced dispatch composition.

Owned worker controls exercise unique sequential delivery slots, nested delivery
followed by same-depth reuse, failed copy with no restoration import followed by
a valid callback, and exact nested foreign-exception identity. The initial 31
synthetic checks include FPCAST i64 helper-return normalization. A later retained
terminal-path failure showed that callback invalidation could replace an actual
halt/exec/trap identity with a nesting error. The corrected candidate passes 39
contract checks, including exact identity, nested retirement and no normal
return after invalidation. These are host
contract checks, not actual kernel signals or cancellation. `worker1/proof.json`
records a syntax-checked task-local rendered worker; the generator preserves
old v1 module interfaces and adds v2/v3 imports without production edits. V3
ordinary callbacks do not clear `active_siginfo` in JavaScript; kernel restoration
preserves nesting.

Whole-kernel preflight hashes 78,089 retained s6 source rows and 78,137 configured
rows. Exactly four shared source files differ: the Wasm image output target,
FB_WASM Kconfig, virtio config-write notification, and framebuffer/virtio import
declarations. The configured-only real kernel provider is `fbdev_wasm.c`; other
extra rows are generated metadata or historical tools/userspace sources. The
coherent nine-file overlay in `whole-plan1/overlay` preserves those configured
features and merges only reviewed v3 declarations. Removing the new declaration
block recovers configured import bytes exactly.

`whole-plan1/recipe.json` proposes a fresh source copy, genuine configured
`.config`, olddefconfig/prepare and `make -j2 tools/wasm/vmlinux.wasm` with pinned
LLVM 22.1.8. All `thread_info` consumers and headers rebuild. No copied target
object supplies a successful result. Measured source-tree apparent sizes are
1,586,081,453 and 1,869,504,167 bytes; the proposed separate task cap is 6 GiB,
allowing source, 2 GiB of fresh outputs, 512 MiB logs/snapshots and headroom.
Launch reserve is 8 GiB, hard stop 5 GiB, with finite owned supervision and fresh
terminal process scans. Root approved the exact recipe and supervised driver.

The first fresh attempt stopped during source copying because the original
membership rule rejected an empty retained tools header beneath a directory
named `generated`. The original task and driver remain preserved. Inspection
found exactly eight such baseline source paths: four empty tools placeholders,
the YNL Makefile/ignore file, and checked-in WireGuard generator output. The
reviewed second attempt permits only their exact filenames and hashes; it still
rejects configured target headers and old objects. Its complete source copy
passed, then `olddefconfig` failed while linking the host `fixdep` tool.

The pinned LLVM package's ELF linker exits unsuccessfully without diagnostics,
and its default x86 host compiler runtime archive is absent. Separate retained
host controls reproduce both issues. The same pinned Clang with explicit
`--rtlib=libgcc -fuse-ld=/usr/bin/ld` compiles, links and executes genuine
`fixdep`; its 13 actual host linker inputs are traced, hashed and retained.
These system GNU tools serve only host build helpers. The target compiler and
Wasm linker remain the pinned LLVM toolchain. The proposed third attempt uses a
fresh output directory and rechecks every regular file and symlink of the owned
independent source copy, including all nine overlays. Earlier failed outputs
and logs remain unchanged. Run3 stopped on a correctly detected Rust availability
configuration change. Run4 permits only the reviewed host-availability metadata
change, with target Rust still disabled and functional configuration unchanged.
It compiled and linked the actual kernel but exited 2 on an O= packaging script
path error. That original outcome remains FAIL.

Separate packaging1 copies the byte-exact linked object/initramfs and changes
only two source-relative script references in an owned architecture Makefile.
The final candidate is 6,281,781 bytes, SHA-256
`c999225be7be4a8be57afab7586be2897688d2ae0468c62a325236e48650d227`.
Every original Wasm section body is byte-identical to the linked input; two
custom metadata sections are added. Actual exported bounds and all 19 passive
initialization ranges agree with metadata. Audit5 readiness passes: 822 Wasm
objects, 34 host ELF objects, 490 archives, 1,374 saved commands and 4,742 unique
dependencies. Earlier parser/audit failures remain retained. The exact import
delta replaces legacy simple/SIGINFO callback imports with the reviewed two v3
imports; no other import changes are accepted.

Isolated basic3 runs this candidate kernel with unchanged accepted GNU memory
runtime modules. Native passes 49,871/0; FPCAST23i64 passes 49,858/0. Allocator,
startup/TLS, ordinary simple/SIGINFO signals, jumps, cleanup/once, genuine abort,
exec, fenv, typed wrappers, stat/time64 and memory authority regressions remain
mandatory. Browser exits are 0, servers close and runner/browser groups are
empty. This demonstrates legacy runtime regression behavior, without admitted
canonical frame records or actual GNU cancellation. Basic1/2 preparation and
bootstrap failures remain retained. A separate lineage audit maps the exact
original worker/runner snapshots to their proven renamed paths, preserving the
original preparation report and hashes.

`glibc-cancel-native-bridge2-20261002/proof.json` compiles the actual GNU-context
bridge and helper/handler objects in 21 stages. The bridge owns the sole canonical
60-byte `nf_thread`; it caches real kernel-verified GNU TP separately from
compiler TLS, binds actual task/instance epoch separately from immutable compiler
module generation, and captures the importing activation before helper frames.
Native assembly has zero calls, imports or linear-stack writes. Import and
checkpoint handles use one saturating, nonreset serial namespace. Each
checkpoint retains its own serial plus import serial, and resolution searches
bounded live slots before dereferencing. Completed/reused slot addresses cannot
authenticate stale handles. This is compile/audit evidence; actual admitted
frame and repeated stale-handle execution still await compiler composition.

`prepare-cancel-arch.py` selects the actual signed GNU reference
`syscall_cancel.c`, SHA-256
`1552ef7f9424bd54d0897abc77df370de2d655be8e7b37ee40fed1c99f5155bd`.
Removing only its bootstrap warning and unsupported ELF PC-label macro/calls
reverses exactly to pristine bytes. The owned result predicate binds the real
admitted cancellation-arch activation and restored delivery; it invents no PC.
Seven stages compile the selected body, retaining GNU's canceled precheck,
strong `__syscall_do_cancel` requirement, raw syscall and error-result behavior.
No forced-unwind substitute or real cancellation runtime acceptance is supplied.

Required real guest acceptance remains:

* Preserve old-module allocator/startup/TLS/jump/cleanup/once/abort/exec gates
  using the fresh kernel, then exercise genuine admitted helper/frame providers.
* Block on read and futex; prove authenticated pending cancellation interrupts
  eligible `-ERESTARTSYS` only after kernel restoration. Test disabled/exiting,
  forged/ignored signals and task/module/generation/TP reuse rejection.
* Retain errno and partial data for positive/zero results with deferred pending
  cancellation; distinguish deliberately selected asynchronous termination after
  side effects from deferred result preservation.
* Exercise two sequential and nested actual signals, copy failure then valid
  delivery, and ordinary blocked-handler tag1/foreign escapes with exact identity,
  mask/register restoration, actual SP and published jump-target preservation.
* Prove v1 compatibility, exec/exit epoch invalidation, native and FPCAST guest
  execution, natural guest/browser exits, closed servers and empty owned groups.

Genuine GNU cancellation dispatch cannot be accepted until real native frame and
forced-unwind providers are composed. Synthetic callback success and two-unit
compilation do not remove that boundary.
