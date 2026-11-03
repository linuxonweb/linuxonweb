# Firefox 159 native JIT build and acceptance audit

GPT-6 Astra Pro / built-in graphics_jit agent / rubywebterm, 2026-11-03.
This records inspected source and existing evidence; it is not a new Firefox
build or a claim that all native JIT safety gates pass.

## Current executable identity

The original system archive is
`60847fb853398000566e822884816fdd8a75d6c8e7776189ba3fcab1672859fa`,
114,767,798 bytes. Its native `opt/firefox/firefox` is 208,805,368 bytes with
SHA-256 `26e380d20f7ad198155fcf0626bc72ab49a5caf2be89e61dcafadbf4efd16998`.
The later APK system overlay changes the outer archive while preserving this
native executable and `/init`. Use the active manifest rather than assuming
the old archive is still the default.

The immutable original package and receipts are under
`/mnt/p3/codex-build/astra-linuxweb-oct17/jit-o2-package/package/`:
`package.json`, `boot-manifest.json`, `freeze-receipt.json`, and the initramfs.
Packaging/build success in these receipts does not imply native runtime or
release acceptance; their acceptance flags remain distinct.

## What currently executes

Firefox is a custom wasm32 Linux/musl port, not an x86 Linux system emulated by
this application. The native browser and Linux run as WebAssembly. Its custom
portable-baseline JIT emits additional Wasm modules for supported JavaScript
paths, which the host runtime installs and invokes. The standard upstream
native JIT is disabled in the build configuration; the portable-baseline path
is explicitly enabled in the exported build's `.mozconfig`.

The actual cube run contains native loop/IC compilation and entry counters.
The matrix-multiply inner loop compiled, but the two enclosing loops were
rejected with `reason=nested loop`. `tools/pbl-jit/PblJit.cpp` explicitly limits
that compiler to a single supported loop, and its loop parser emits this
rejection. This is concrete evidence of real JIT execution **and** incomplete
coverage; it does not establish desktop-class JavaScript throughput.

The original broad native acceptance remains unresolved. Retained mutation
runs passed 75 rows and 8,408 assertions, but the required GC/live-entry chain
and three of six guard paths lacked the required exercised coverage. The
observed failure is missing in-window lifecycle/guard evidence, not a proven
execution of freed code. Do not weaken, delete, or reinterpret those original
gates as passes. A focused live-entry-before-GC case can add evidence but cannot
replace them.

The separate host cache change in commit `08a66fe` bounds retained compiled
module references by 1,024 entries and 8 MiB of immutable **source images**. It
preserves the 12-word native stats ABI. A 69-check real Linux fixture verifies
current install/replay/free contracts. These checks do not accept native
Firefox GC guards and do not bound installed private functions or total native
compiled-code memory. Current private installs deliberately refuse free while
remaining callable; that limitation was retained and explicitly tested.

## Readable complete source route

A readable Firefox **159.0a1** export exists; the earlier source-only assessment
that only 128 ESR was available was superseded by this audit.

| Item | Inspected value |
| --- | --- |
| Patched export | `/mnt/p3/codex-build/linuxonweb-org-push/firefox-src` |
| Equivalent exported tree | `/mnt/p3/codex-build/linuxonweb-org-push/main/firefox` |
| Patched Git head | `525176a870d4ec4329e7decdb2ef7fdd5b87fb22` |
| Port/recipe commit | `f8bac14ded` |
| Imported upstream boundary | `f29f25d425` |
| Upstream Git mirror | `bf9757d91e2e53b8ab836f2a08bf4c0275fdcd23` |
| Recorded Mercurial revision | `dfc77f7a6d716f1a20a2576597638d4fc21cd916` |
| Official reference build ID | `20261002211853` |
| Local custom build ID | `20261003042618` |

`mach`, configure sources, vendored dependencies, ported native files, and
`linuxonweb-build/{adapters,patches,pbl-jit,recipe,evidence}` are present. The
source-identity receipt explicitly calls its Hg/Git correspondence an inference
from matching subject/author date and eight canonical file pairs, not a
full-tree equivalence proof. Preserve that qualification.

The exported recipe README describes an earlier phase and even says no custom
JIT is included; the actual tree contains the later PBL source and patches.
Do not treat that README as a complete, current, already-validated rebuild
command. Compare the exact source inputs with the current original-package
receipts before rebuilding. In particular, the `.mozconfig` and recipe
mozconfig differ: the former enables portable baseline, while the older recipe
file lacks that final setting.

No usable configured Firefox object tree or `config.status` was found in the
readable export. The few `.o` files are upstream test fixtures, not a browser
link graph. The readable final binary and JIT archive are not replacements for
all native runtime/C++/Mesa inputs required by the incremental relink.

## Actual access blocker and permitted alternatives

The historical incremental build lives under `/mnt/p6/build`, whose relevant
parent is root-owned mode 0700 and is unreadable to the connected UID1000. This
is an operating-system access boundary, not a missing path or a transient MCP
failure. It was not bypassed.

The minimal categories needed for an exact incremental route are:

- `firefox-nightly-musl-jit-full-20261002/obj-nightly/browser/app` and the
  matching configured native object/archive graph.
- The recorded mapping/shared-memory, runtime-accepted, and stack-accepted
  native adapter archives.
- The recorded `glgears-zink` EGL/Mesa link archive.
- The matching native-unwind `libc++.a`, `libc++abi.a`, and `libunwind.a`.

Exact individual input filenames and arguments are already recorded in
`/mnt/p3/codex-build/astra-linuxweb-oct17/jit-typed-o2-build/` command/build-state
receipts. An owner may make the required inputs normally readable; an agent
must not use sudo, permission changes, or an alternate interface to evade this
boundary. No requested work was held waiting for that change; accessible host
runtime, GPU, SDK, and package improvements continued.

A legitimate clean rebuild can instead copy or clone the readable 159 export
into a new owned disk-backed directory, restore the recorded native libraries
from authorized readable sources, and relocate the build recipe's old absolute
paths. Preserve historical exports. The inspected recipe references 71 present
real Nix paths and one absent historical GCC runtime path. The 34 synthetic
`eeee…` paths are compiler prefix-map replacements, not missing dependencies.
Native unwind/runtime archives still need a legitimate source/build route.

## Cost and decision for this session

The previously recorded final Binaryen `-O2` stage alone took about 577 seconds
and approximately 24 GiB. A complete clean Firefox build has not been measured
under the current effective **three-CPU** browser/build environment. Guessing a
short total from the optimizer duration would be misleading. Source copy,
configure, native libraries, C++/Rust compilation, link, optimization, ABI
validation, packaging, and real browser safety/startup gates all remain work.

The CTO therefore chose not to start an unmeasured full rebuild within the
remaining session budget. There was no risky binary rewriting and no promotion
of an untested native candidate. The next native task should budget a full
exclusive build/validation window, reserve at least 20 GiB disk free, and keep
available RAM above the observed optimizer peak plus a margin. Record every
phase, sample resource use each second, and stop unrelated heavy tests while
linking/optimizing.

## Useful next native changes and acceptance

First recover reproducibility and source identity. Then profile the actual
nested-loop/collision/recompilation costs, implement one narrow supported
extension, and compare the same real Firefox workload before and after. Run
all original semantic, GC/live-entry, mutation, and guard tests unchanged.
Exercise an entry immediately before GC/mutation to diagnose coverage gaps,
but retain the broad acceptance requirement. Keep host compiled-module cache
retention distinct from live installed native code ownership.

Cold Firefox readiness must include archive retrieval, visible rendering, and
usable input within 30 seconds; the runs in this session do not meet it.
Likewise, a native GL transport microbenchmark or a simple JIT fixture does not
establish 50% of host-browser performance. The exact same-page Firefox versus
Chromium comparison is recorded separately with clock endpoints and all stalls
included.

## Native Restart normally gap

The readable159 export calls `LaunchChild(true)` from `xpcom/base/AppShutdown.cpp:150–180` and ignores its result. `toolkit/xre/nsAppRunner.h:168` defaults `aTryExec=false`, selecting `PR_CreateProcessDetached`. In `nsprpub/pr/src/md/unix/uxproces.c:237–245`, the Wasm/Linux branch explicitly returns `PR_NOT_IMPLEMENTED_ERROR` because independent fork is unavailable. This is consistent with the observed Restart normally action exiting status0 without a replacement process. The Unix `execv` route exists when `aTryExec=true`. The native binary was unchanged by the rejected Omni experiment; the old-image runtime comparison remains untested, so this is a source-supported likely existing limitation, not a proven resource-packing regression. A scoped exec/posix_spawn restart change requires a legitimate native rebuild and restart/ordinary-Close acceptance. An unconditional shell restart on exit0 would break normal Close and is inappropriate.
