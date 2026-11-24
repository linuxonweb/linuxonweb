# Native Wasm GNU static-loader packet — 2026-10-02

The approved design now has a prepared finite implementation packet. Twelve
unchanged GNU loader/API units and the owned native backend compile together.
Both strict default and Release C++ links still fail solely on genuine GNU
`__syscall_cancel_arch`. Caller and metadata primitives pass, while the native
SjLj retained-cleanup route fails. No public dlfcn execution, C++ execution,
general forced unwind, full libc or Nightly acceptance is claimed. Root owns
review and any freeze/Git checkpoint. Prepared predecessors remain unchanged.

Owned scope is `tools/glibc/native-static-loader/**`, this document and
`/mnt/p6/build/glibc-native-static-loader-20261002`. Task TMPDIR/TMP/TEMP/cache
are ext4 subdirectories there. The task cap is 2 GiB; launch reserve 8 GiB,
hard stop 5 GiB. Every actual build/execution must have a finite supervisor,
separate attempt snapshots, complete stderr and actual terminal PID/PGID proof.
No browser, server, kernel, Nix, shared sysroot or service was mutated.

## Exact prerequisites and pins

GNU 2.44 source is the signed release pinned at
`/mnt/p6/build/glibc-wasm-bootstrap-20261002/source/glibc-2.44`, archive SHA256
`37f600f2bef3c5e8300147059568b2a2e40a7ad6ccc65ce942556d49429cc667`.
The cumulative replay at
`/mnt/p6/build/glibc-cumulative-make-20261002/source/glibc-2.44` provides actual
configured native Wasm headers. Each GNU source named below is byte-compared
against that pristine release before being copied into task-local evidence.

Nightly source is
`/mnt/p6/build/firefox-nightly-plan-20261002/source/firefox-159.0a1`, pinned
revision `6ce79a0416258aa1bc3a29e9ccebccdacebf916a`.
LLVM source is
`/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/jkx0x4a4nlmnjm0kz9fiss33b7wh8z9k-source`.
The selected LLVM22.1.8 toolchain is sibling store object
`xwpycnlb71djqs4gyxhbkxhzb3pw1ib4-llvm-toolchain-22.1.8`; the accepted private
C-cleanup frontend is
`/mnt/p6/build/glibc-c-cleanup-20261002/objects/compiler/clang`.
`pin-plan.py` records exact individual source/tool hashes and imported source
snapshots in `logs/design-source-pins.json`. It does not compile anything.

The preserved C++ closure packet has default and supported
SILENT_TERMINATE+NDEBUG Release full links FAIL. The exact default remaining
symbols are `__libc_dlopen_mode`, `__libc_dlsym`, `__libc_dlclose`,
`_dl_readonly_area`, `__syscall_cancel_arch`. `iconv/gconv_dl.c` extracts the
first three; `debug/readonly-area.c` extracts the fourth. The last is actual
GNU cancellation. Resolving loader providers must retain both predecessor
failures and cannot imply that cancellation or C++ lifecycle is complete.

## Actual source behavior

| Source | Contract and consequence |
| --- | --- |
| GNU `elf/dl-libc.c:151,179,221` | Internal wrappers run actual catch/error handling; `__libc_dlopen_mode` passes RETURN_ADDRESS(0), dlsym supplies the map's local scope, and close releases an actual handle. Preserve unchanged GNU wrapper bodies. |
| GNU `dlfcn/dlopen.c`, `dlsym.c`, `dlvsym.c`, `dlmopen.c`, `dlclose.c` | Preserve public signatures/aliases and GNU mode/namespace validation, recursive lock, version lookup and error behavior. The static `dlmopen` source rejects non-base namespaces. |
| GNU `elf/dl-sym.c:97,131`, `elf/dl-sym-post.h` | DEFAULT uses caller global scope; NEXT finds the caller's real map and searches after it; ordinary handles use local scope. Version lookup constructs `r_found_version`; GNU IFUNC and shared audit paths have separate semantics. |
| GNU `elf/dl-open.c:212,811` | ELF implementation derives caller map and handles mapping/relocation/namespace state. It cannot be used as an unchanged Wasm binary loader; a small native architecture backend is unavoidable. |
| GNU `elf/dl-readonly-area.c:41` | Uses `_dl_find_object` and actual ELF PT_LOAD/RELRO protection. Wasm C `const` and symbol metadata provide no native linear-memory protection. |
| GNU `elf/dl-catch.c:205+`, `dl-exception.c` | Real per-thread descriptor `rtld_catch`, direct GNU signal-setjmp/longjmp, nested catch restoration, genuine malloc/free ownership. Reuse accepted native jump machinery; never replace with a regular setjmp wrapper or fabricated success. |
| GNU `dlfcn/dlerror.c:37+` | Actual TLS error state; one-shot consumption, malloc-failure sentinel, real `__asprintf`, gettext and errno ownership. This pulls genuine stdio and therefore the remaining cancellation route. Do not replace formatting or cancellation to force a public link. |
| LLVM `WebAssemblyISelLowering.cpp:1970` | Native non-Emscripten RETURNADDR explicitly fails; switching triple or supplying NULL would erase provenance. Use a measured owned compiler adapter. |
| Nightly `nsprpub/pr/src/linking/prlink.c:131,542,636,701,723,851+` | Initialization calls dlopen(NULL,LAZY); ordinary libraries call dlopen/dlsym/dlclose. PR_LoadStaticLibrary stores a real PRStaticLinkTable and reuses the process handle. Static-table lookup has its own exact name search and returns error on a miss. It does not automatically publish its symbols into GNU dlsym. |

The original five inventory RETURN_ADDRESS failures are `gmon/mcount.o` and
`dlfcn/{dlmopen,dlopen,dlvsym,dlsym}.o`. This packet's four dlfcn compilations
do not silently count mcount or GNU `elf/dl-libc.c` as original failed targets.

## Minimal architecture integration

Keep unchanged GNU public/internal wrapper, dl-sym, dl-catch, dl-exception
and dlerror sources wherever they compile against the actual port headers.
Add owned native implementations of `_dl_open`, `_dl_close`,
`_dl_lookup_symbol_x`, `_dl_find_dso_for_object`, and `_dl_readonly_area`.
These are selected Wasm architecture providers, not renamed ELF implementations.
Measure every provider prototype and used GNU structure field against genuine
configured headers before execution. If additional GNU helpers/globals are
needed, record them and use actual GNU bodies; no unresolved-symbol suppression.

Every native module record describes code/data that really participates in the
linked payload: canonical name/aliases, dependency and scope order, real GNU
link_map storage, symbol records, version/default visibility, actual callable
table pointer or actual linear-memory data address, and reference count.
`l_addr=0` plus genuine SHN_ABS records can express native absolute addresses;
table indices must never be treated as byte ranges of VM machine code.
No invented ELF program headers, ELF mappings, protections or relocations.
Actual link-time relocations populate symbol values. Registration validates
duplicates, version collisions, range overflow and unresolved module references.
Metadata is logically frozen after initialization; it is not read-only memory.

`dlopen(NULL)` returns the actual process map; registered native static modules
return their actual maps with real reference accounting. Unknown named ELF/DSO
loading reports an explicit architecture-unsupported error, rather than a
universal successful handle. NOLOAD never creates a module. Honor valid NOW/LAZY,
GLOBAL/LOCAL/NODELETE semantics within the supported prelinked registry; report
unimplemented DEEPBIND/relocation behavior honestly. Validate mode and namespace
through GNU wrappers. Static code remains resident on close; balanced handles
and lookup scope still change as specified, with no fabricated unloading.

Use the real GNU recursive loader lock and genuine mutex implementation when
entering mutable registry/lookup operations. Registration occurs before user
threads. Per-thread compiler TLS is independent of GNU raw TP; both must be
initialized as in the accepted startup. No no-threads libc++abi or fake mutex.

## Actual caller provenance

The smallest prototype is an owned post-O2 LLVM IR adapter, with no subsequent
LTO, covering an explicitly enumerated closed module. At each ordinary direct
or indirect call/invoke that can enter a provenance-consuming function, write
the address of an actual link-time callsite descriptor to compiler TLS. The
callee captures this descriptor at entry into an immutable SSA value.
RETURN_ADDRESS(0) is lowered to that captured value, not a NULL constant or
function table index. The descriptor records the real caller function, logical
module and callsite; exact descriptor identity resolves the actual caller map.
Nonzero depth, uninstrumented caller paths, module ambiguity and unsupported
tail-call shapes reject. Disable tail-call optimization in the first finite
packet; do not claim complete general compiler support.

Instrument after O2 so inlined calls describe the actual surviving caller.
Any builtin-bearing public wrapper must retain an actual entry or have its
inlined use correctly attributed. A callback, recursion or exception does not
replace the captured SSA identity; every subsequent instrumented call writes
its own descriptor. Native tag0/tag1, HALT/exec control and real SjLj behavior
remain intact. Verify ordinary returns, exception escape, nested loader calls
and longjmp do not leak caller state. A pending TLS value alone is insufficient
when a missing caller can reuse a prior descriptor: finite coverage must reject
such paths and entry from JS must use an explicit process entry descriptor.

The descriptor is an architecture logical return-location token backed by
actual linked metadata, not a fabricated VM PC. `_dl_find_dso_for_object`
recognizes exact tokens. GNU NEXT's caller-range check can use the actual
per-module descriptor allocation, while readonly-area uses actual linear-memory
ownership separately. Do not pass descriptor ranges off as executable byte
ranges or infer pointer protection from them. General `dladdr`, function/data
pointer collisions and arbitrary JIT caller registration need additional
explicit metadata and remain outside the first finite gate.

## Real symbols, versions and readonly-area

Native lookup scans only actual GNU scope arrays and published symbol records.
DEFAULT searches globals in dependency order; NEXT excludes all records through
the actual caller map; ordinary handles use their actual local dependency scope.
Match exact version/hash and default visibility. Missing names/versions signal
actual GNU loader errors. First prototype uses actual exported function/data
records with two versions and collisions to prove order. TLS/IFUNC/GNU_UNIQUE,
symbol interposition beyond this registry and dynamic module1+ TLS are explicit
future contracts: reject their registration or lookup until faithfully supported.

`_dl_readonly_area` returns `dl_readonly_area_writable` for measured valid native
linear-memory intervals, including C string literals/const tables. Out-of-range
or overflowing requests return `not_found` for genuine GNU fallback. There is
no Wasm-protected-readonly success. Preserve GNU `%n` fortify consequences and
test them with real GNU code; changing that result to hide a diagnostic is invalid.

NSPR's real PR_LoadStaticLibrary table remains authoritative for PR lookup;
GNU native registration is a separate explicit integration step for modules
that should also be visible to dlsym. The first packet measures the actual
NSPR initialization/load/find/close call sequence with GNU APIs. It does not
claim PR monitor/thread lifecycle acceptance without linking genuine NSPR and
its real GNU dependencies. Later coherent NSPR/Firefox builds must consume the
same explicit metadata and retain missing-symbol errors.

## Approved ordered gates

1. Compile native caller instrumentation/control fixtures, validate exact
   descriptor identities for process plus two real module functions, direct and
   indirect calls, nested recursion/callback and ordinary exception/longjmp
   routes. Reject uninstrumented/nonzero-depth/tail-call cases. Inspect raw and
   adapted IR, actual native instructions, TLS layout and stack restoration.
2. Compile actual four original dlfcn failures plus unchanged GNU dl-libc,
   dl-sym, dl-catch, dl-exception, dlerror and the owned architecture backend.
   Measure exact GNU function types, structures and aliases; preserve every
   failed attempt and source/command/include/object pin. Do not change the
   caller-return builtin to NULL or drop public APIs to obtain a link.
3. Link against verified genuine GNU selected objects, allocator/startup/TLS,
   actual scheduler/vtables/compiler-rt as needed. First require full default
   public GNU loader link. If the real cancellation/stdio dependency still
   prevents it, retain exact extraction evidence and do not claim public runtime
   PASS. A separately labelled internal/backend gate can exercise GNU internal
   wrappers only if it has genuine closed dependencies and no replaced failures.
4. Actual native fixture: process handle, named registered handle, balanced
   close/reopen, NOW/LAZY/NOLOAD/GLOBAL/LOCAL; two callable functions and writable
   data with verified returned values; DEFAULT/NEXT from two different real
   modules and negative caller; two versions/default selection; genuine errors
   for missing names/versions/ELF loading/namespaces/unsupported features;
   dlerror once/reset and nested catch restoration; writable literal/range
   checks, overflow and output canaries. Concurrent error/refcount/TLS gates
   require real guest threads and initialized per-thread TP/DTV, never a global
   substitute. No browser/server needed for the first host-native finite gate.
5. Reattempt both prepared C++ configurations with the actual loader objects,
   preserving their original failures. Closure means all symbols resolve with
   actual providers and typed/foreign catch/rethrow executes; it is never an
   archive/dead-strip claim. Remaining __syscall_cancel_arch/forced unwind and
   restart-decision hooks stay genuine separate blockers if still unimplemented.

Default GNU NPTL stacks/guards, general forced unwind/cancellation, full libc
archive/sysroot and Nightly builds remain downstream gates. Busy-loop async
cancellation and internally restarted blocked syscalls need actual kernel/runtime
coordination; this loader packet does not implement or certify them.

## Prepared implementation and measured scope

`caller-ir.cpp` transforms actual post-O2 LLVM IR and rejects every uncovered
definition or external boundary, nonzero return depth, surviving tail call and
inline assembly. Each surviving covered call/invoke gets its own descriptor
allocated in its actual module; a declared native entry gets a separate entry
descriptor. The callee consumes the pending TLS descriptor into SSA and clears
it immediately. An unseeded entry traps before its body. Indirect calls compare
their actual relocated target against covered definitions before publishing a
descriptor. A separately linked non-NULL callable uncovered target records
whether its body ran; it is rejected before entry, with body counter zero.
The earlier NULL-only negative control is retained as insufficient evidence.

The adapter removes stale memory/speculatable attributes after introducing TLS
effects. There is no optimization or LTO after transformation. The final GNU
closure contains 69 covered definitions, 118 actual descriptors, six surviving
return-address captures and 40 guarded indirect sites. Explicit declarations
into pinned unchanged GNU providers clear pending TLS before the call, so an
uncovered callback cannot inherit stale caller identity. This is finite coverage,
not general instrumentation of arbitrary archive callbacks or foreign JS calls.

`native-loader.c` uses actual GNU `link_map`, `r_scope_elem`, `r_found_version`,
`Elf32_Sym`, namespace fields, GNU recursive mutex macros and GNU error bodies.
The bound is exactly three registered prelinked modules: process, top-level A
and its dependency B. A has `l_loader=NULL`; B has `l_loader=A`. A/B scopes contain
the global scope followed by the dependency-root A searchlist. Handle-local
scope uses the relevant real module searchlist. Symbol addresses reference real
function/data allocations, version hash/name records are explicit, and caller
tokens occupy real surviving callsite allocations. Token intervals describe
metadata allocations; they are not fabricated executable/readonly VM intervals.
Valid linear memory, including literals, is genuinely writable; invalid ranges
return GNU `not_found`. ELF loading, namespaces and unsupported mode bits take
explicit GNU errors. General Nightly registration remains future integration.

The selected genuine GNU units are `dlfcn/{dlopen,dlsym,dlvsym,dlmopen,dlclose,
dlerror,libc_dlerror_result}.c` and `elf/{dl-libc,dl-sym,dl-catch,dl-exception,
dl-printf}.c`; all twelve configured source bodies compare byte-for-byte with
the signed pristine GNU release. The owned backend is the thirteenth unit.
GNU `dlerror` and public loader bodies remain present. The four original caller
return-address dlfcn failures now produce native code; the separate gmon target
is outside this packet. GNU static diagnostic `_dl_argv = &__progname` comes from
actual `elf/dl-support.c` lines49–50; process argv initialization is a separate
startup requirement. The owned gscope header copies GNU's real atomic flag/wake
protocol from `sysdeps/riscv/nptl/tls.h` without importing register/layout ABI;
its wake/concurrency behavior has not been executed here.

The public fixture compiles genuine `dlopen`, `dlsym`, `dlvsym`, `dlmopen`,
`dlclose`, `dlerror`, real GNU catch/error paths and a local-to-global A/B scope
sequence. It obtains A/B callbacks with actual public dlsym and calls returned
function pointers. Planned assertions include private B lookup from both modules,
process-first duplicate-name ordering for DEFAULT, B lookup for NEXT from A,
missing lookup for NEXT from B, version/default selection and one-shot dlerror.
These are compiled fixtures, not public runtime passes: both full links fail.

| Gate | Actual result | Limit |
| --- | --- | --- |
| Caller identity | PASS99 checks across96 cases | Finite direct, guarded indirect, recursion/callback; non-NULL uncovered body stays zero and stale entry rejects |
| Compile-negative controls | PASS4; actual adapter exits3 | RA depth, uncovered external/definition and surviving tail call reject |
| GNU/public ABI | PASS6 typed prototype assertions plus14 native layout measures | Compile/layout evidence only |
| GNU loader closure | PASS13 frontend/lowering/O2 units and coherent native object | No public runtime |
| Metadata primitives | PASS35 checks and6 caller cases | Genuine GNU strcmp/memset; map/token/version/query/writable-range primitives only |
| Tag0 native route | PASS16/16 | Actual native exception, both C cleanups once, caller identities and entry SP restored |
| Tag1 native SjLj route | FAIL16/16 | Returns37 and restores SP, but retained cleanup runs twice: `[1,9,9]` |
| Default GNU/C++ full link | FAIL | Sole `__syscall_cancel_arch` |
| Release GNU/C++ full link | FAIL | Sole `__syscall_cancel_arch`; separate supported libc++abi configuration |

Actual GNU layout is `link_map`616/alignment8, `l_loader`380, `l_scope`480,
`l_local_scope`484; `r_scope_elem`8, `r_found_version`16, `Elf32_Sym`16,
`Lmid_t`4, `pthread_mutex_t`24; GNU descriptor gscope flag16 and rtld catch1156;
native descriptor12/alignment4. Header/prototype/layout commands and actual
outputs are in `logs/layout-results.json` and `objects/layout.{o,wasm}`.

The metadata-only link selects primitive functions; this deliberately does not
exercise public open/lookup/error/recursive-lock/refcount bodies. Their strict
full-link extraction is recorded separately. No dead stripping is presented as
public loader or C++ behavior acceptance. Host probes use initialized compiler
TLS but do not establish GNU descriptor/DTV startup or concurrent thread isolation.

## Strict full-link input evidence

Both final attempt6 links use 50 exact arguments and29 ordered object/archive
inputs, with no wrappers or unresolved-symbol suppression. Both include the
actual new `gnu-loader.o`, GNU diagnostic startup data, coherent selected GNU
allocator/startup/vtables/scheduler/scratch objects, compiler-rt and real
libc++abi/Unwind-wasm objects. Release substitutes only fourteen genuine
predecessor Release exception units; its GNU allocator/provider selection matches
the default. The earlier Release `__mmap64` and duplicate/stdio failures remain
retained. Neither configuration is a completion substitute.

`logs/final-link-inputs.json` records every ordered path/size/hash, complete argv,
argv hash, exact stderr and real PID/PGID. Ordered input hashes (canonical compact
JSON in audit.py) are default
`a8aadb421863d7ece31f5bb2fc36e92aeaeca4e1ac3a7ec363d4210391e35ce3`
and Release
`9ad84a758fa3cdc5efb1941a622081483982300f3d60636aa33874bae5157dea`.
The new coherent native GNU object SHA256 is
`2ae515530decc4642bf07ee629e6e3591976529c9da76b735d53feb642ece861`.

Both171-byte final stderr files have SHA256
`17ea52f4ce64d0749f76f279957ad6385bf1581af146a2806dc6b05bc7cdf7f5`
and the exact sole diagnostic:

```text
wasm-ld: error: /mnt/p6/build/glibc-native-static-loader-20261002/objects/imported-cxx/libgnu-selected.a(gnu-nptl-cancellation.o): undefined symbol: __syscall_cancel_arch
```

Default PID/PGID24335 and Release24365 exited1 with empty groups. Their logs are
`logs/gnu-public-cxx-{default,release}-link-attempt6.log`; extraction/map files
are `logs/public-cxx-{default,release}-{why,map}.txt`. The54 imported original/copy
rows are verified against the immutable prepared C++ object ledger.
`boundary-provider-records.json` and `boundary-defined-providers.json` give all19
explicit boundaries: sixteen real GNU/provider definitions, two genuine native
Linux imports declared by the actual architecture headers, and native LLVM
setjmp lowering. Clearing caller TLS at these boundaries deliberately rejects
callbacks from uncovered archive code; it cannot establish transitive coverage.

## Native tag routing failure and next gate

`routes.c` uses the actual GNU architecture24-byte `__jmp_buf`, private C cleanup
frontend and native Wasm EH/SjLj backend. The backend explicitly requires
`-exception-model=wasm -wasm-enable-eh -wasm-enable-sjlj`; earlier omitted-model
failures remain retained. `routes.S` saves the actual native entry stack pointer
and restores it when tag0 escapes. This is entry restoration, not a per-frame
CFA provider or forced-unwind implementation.

Final `logs/routes-results.json` SHA256
`352136f3e459661dfa83aaace86d76a51663f0d58b6110e44e82404506832ded`
contains32 cases. Tag0 returns original payload731, cleanup order `[1,2]` with
module identities `[1,2]`, and SP65536 before/after. Tag1 returns37 and also
restores SP65536, but order `[1,9,9]` with identities `[1,0,0]` proves that native
SjLj lowering prematurely executes the retained target cleanup and then executes
it again on return. Final Node PID/PGID22207 exits1 with empty group. Do not
reinterpret this failure as accepted ordinary GNU nonlocal-jump routing.

Inspectable inputs are `objects/routes.ll` (raw optimized private C),
`routes.adapted.ll`, `routes.native.s`, `routes.o` and `routes.wasm`, with attempts
and exact compiler argv in `logs/commands.json`. Their adapted-IR/native-assembly
hashes are respectively
`630494229873700c6f7636f1dd7a95add4f0e31584875d8f8e2d799a5517063a`
and `25a05c81137f20827c04fd11b6c282fe186a0f3f01f7a398f0842e85f30b1900`.
The next compiler/runtime packet must distinguish tag1 nonlocal jumps from tag0
language unwinding, preserve the retained target cleanup, provide actual logical
frame/CFA ownership and integrate genuine cancellation transport before public
loader/C++ execution. There is no null CFA, cancellation stub, erased cleanup,
fake interrupted PC or longjmp-only forced-unwind claim here.

## Prepared evidence and replay

`audit.py` reads back the40 original design rows, all54 C++ import original/copy
rows, actual GNU leaf copies, source/header/tool pins, immutable attempt artifact
hashes, final link inputs and every recorded terminal process group. Prepared
ledgers are `logs/{source-tool-pins,object-pins,terminal-groups}.json` and
`logs/prepared-acceptance.json`. This is prepared evidence with
`fullDesignPass=false`, `publicGNUDlfcnRuntime=false`, `cppRuntime=false`,
`generalSjLjRouting=false`, `forcedUnwind=false` and `frozen=false`.

Historical preservation gaps are explicit in `logs/evidence-gaps.json`: two
initial planning script versions, some overwritten intermediate JSON reports
and generated mutable input files before prospective input/result snapshotting,
one unsupervised diagnostic assembly dump, and seven negative-control ledger
rows lost by accidentally concurrent supervisors. The negative packet was
rerun serially with complete final command records; no successful gate relies
on the lost rows. Original terminal tool outputs prove those seven exits/groups,
but overwritten same-named logs are not claimed as complete historical evidence.
The final serial control, routing, metadata and full-link results remain pinned.

Commands are serial, each actual subprocess gets a finite300-second supervised
deadline and its own process group. Replay uses task-owned TMP variables:

```sh
python3 tools/glibc/native-static-loader/caller-build.py
python3 tools/glibc/native-static-loader/caller-negative.py
python3 tools/glibc/native-static-loader/gnu-compile.py
python3 tools/glibc/native-static-loader/gnu-native.py
python3 tools/glibc/native-static-loader/layout-build.py
python3 tools/glibc/native-static-loader/metadata-build.py
python3 tools/glibc/native-static-loader/routes-build.py
python3 tools/glibc/native-static-loader/gnu-full-link.py
python3 tools/glibc/native-static-loader/boundary-symbols.py
python3 tools/glibc/native-static-loader/audit.py
```

The route command intentionally exits1 on its retained failure. Full-link
supervision records two actual exit1 failures; the script completes its evidence
collection normally. Boundary-symbol inspection consumes the actual latest
full-link argv. Existing initial audit parsing failures are also recorded;
subsequent audit readback passes. No files are frozen or committed by
this packet. Real NSPR linking, general static registry, GNU pthread lifecycle,
cancellation/forced unwind and coherent Nightly builds remain required.
