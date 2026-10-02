# Coherent GNU full-make discovery — 2026-10-02

Fresh signed GNU glibc 2.44 source with the accepted native Wasm overlays
produced 1,729 complete Wasm objects and 40 separately classified GNU text
stamps. Both genuine `make -k -j2 lib` runs exited 2. Six targets still fail;
no libc archive, installed sysroot, CRT, NPTL or Nightly build is accepted.
No previously accepted GNU target objects were copied into this build.

The source order was foundation replay and initial GNU metadata; coherent
156-byte public/24-byte internal jump buffers and checked backend; genuine
libnames generation and retained pthread requirements; scheduler headers and
nearest-only fenv; statx selection and distinct 104-to-128-byte legacy stat
conversion; arity-sensitive C providers; audited GNU-generated wrappers;
then the accepted corrected memory providers and final configure/metadata.
GNU TP remains separate from compiler TLS. The memory-runtime manifest is
`2604aa26fae2ae073c2326b5741752ac013cdf4a83878c81950fc943adcff2c4`;
its independent guest acceptance belongs to that predecessor packet.

Run1 completed naturally in 316.34 seconds with 1,727 Wasm objects. GNU
suppressed generated init_module/delete_module extras because architecture
C sources existed, but those sources had not been registered as routines.
The retained Makefile-only correction registered both genuine providers.
Incremental run2 completed naturally in 113.14 seconds: both providers were
compiled by actual GNU make, and all 1,727 earlier object sizes and hashes
remained unchanged. Dependency regeneration also scheduled 600 additional
C attempts; run2 is not described as a two-command rebuild.

The final audited target outcomes are 1,729 complete and six failed, from
1,735 attempted object targets. The original 168-target inventory measures
162 complete and six failed; the separate historical cumulative 44-failure
inventory measures 38 complete and six failed. These are comparisons of
actual target outcomes. Neither count establishes whole-library linkage.

The six primary failures are dlfcn/dlopen.o, dlmopen.o, dlsym.o, dlvsym.o and
gmon/mcount.o, which require genuine caller provenance unsupported by the
current native Wasm backend, and nptl/syscall_cancel.o, whose genuine GNU
cancellation assembly markers need an architecture implementation. The
markers delimit a side-effect-sensitive syscall region; removing them would
lose semantics. The compiled genuine nptl/unwind.o separately retains
undefined _Unwind_ForcedUnwind and _Unwind_GetCFA references. Passing C cleanup
compilation does not close forced unwind or cancellation.

The compiler uses the accepted private C frontend, unoptimized native C
cleanup IR, reviewed GNU data-alias translation, warning custom metadata,
caller-aware jump lowering, O2 and the native Wasm backend. The sole vtable
alias case retains offsets 168/420 and exact 84-byte symbol extents without
changing storage, code or relocations. Ordinary empty-alias cases retain
byte-identical backend objects. The forced-O2 C driver and limited query/
assembly passthrough are diagnostic tools, not production compiler-flag or
C++/Nightly driver acceptance.

The final read-only audit pins 2,802 actual dependencies from 1,735 `.d` and
604 `.dt` files, with no missing dependencies. The earlier `.dt`-only run2
report and its executed auditor are retained; they covered 1,516 includes.
The corrected union includes all 2,800 run1 dependencies plus the two new
provider sources. It expands only common-objpfx, objpfx and the GNU source
path variable, with explicit bounded replacements and no evaluation.

Evidence is under `/mnt/p6/build/glibc-coherent-make-20261002`, particularly
`logs/coherent-audit-run2-final.json`, `logs/run2-object-preservation.json`,
the unique compiler attempts, retained failed configure tree, source-plan
versions and supervisor records. The final audit records 2,339 C attempts,
292 query/non-C attempts, 1,736 source records and exact executed drivers.
Absent ephemeral configure sources are retained snapshots, not fabricated
current inputs. Header installation was not attempted; no generated stub
header lists or archives were produced. Further work must provide caller
provenance and the real cancellation boundary, then repeat genuine archive
and header build checks before claiming a GNU sysroot.
