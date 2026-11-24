# Genuine GNU C++ exception closure — prepared, 2026-10-02

The actual LLVM 22.1.8 libc++abi units, including demangling and standard
new/delete, compile against GNU glibc 2.44 headers. Both the default and the
separately authorized Release/silent-terminate links **FAIL**. No typed/foreign
catch/rethrow runtime, full cancellation, GNU sysroot or Nightly acceptance is
claimed. The immediate default link has five unresolved symbols after genuine
GNU scratch-buffer, native compiler-rt, scheduler, vtable and startup additions.
The predecessor routing and first prototype packets remain unchanged; neither
is claimed root-frozen here.

Task: `/mnt/p6/build/glibc-cxx-exception-closure-20261002`. Owned repository scope:
`tools/glibc/cxx-exception-closure/**` and this document. The report is prepared
for root review; no freeze, Git, kernel/Nix edits or service changes occurred.

## Actual source and object selection

GNU source is the cumulative signed-release replay at
`/mnt/p6/build/glibc-cumulative-make-20261002/source/glibc-2.44`, with generated
headers in its `objects/configure-port` and `objects/fullmake` directories.
GNU pristine release archive SHA-256 is
`37f600f2bef3c5e8300147059568b2a2e40a7ad6ccc65ce942556d49429cc667`.
LLVM source is the retained Nix source
`/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/jkx0x4a4nlmnjm0kz9fiss33b7wh8z9k-source`.

`prepare-archive.py` independently verifies all 1,690 structurally complete
cumulative GNU objects against their frozen manifest. The count includes one
`.os` file; the first preparation incorrectly scanned `.o` alone, found 1,689,
and failed before launching a compiler. That failure and source are retained.
This object set has **no malloc directory or malloc/free/aligned_alloc bodies**.
The allocator is explicitly selected from the accepted checked-jump runtime's
`objects/guest/malloc-malloc.o`, verified against its actual final-input map.

The owned default archive excludes the old memory-provider selections and
selects the eight architecture objects from `glibc-memory-make-20261002`:
brk, sbrk, mmap64 (also mmap aliases), munmap, mremap, mprotect, madvise and
wasm-memory-authority. Initial selection was prepared, before that packet's
subsequent root freeze. These copies do not constitute new guest acceptance.
Its real protection limits remain unsupported. The separate Release candidate
retains the accepted checked-jump memory authority and uses an archive excluding
all new memory providers. The first Release link's duplicate memory-provider
definitions remain a failure, rather than being suppressed.

The checked-jump runtime supplies actual GNU malloc, elf-dl-tunables and owned
startup globals/TLS state. Frozen `glibc-vtables-make-20261002` supplies genuine
`libio/vtables.o`; frozen `glibc-sched-sem-20261002` supplies genuine
`posix/sched_sets.o`, `sched_setp.o`, `sched_getp.o`. Each source object and copy
is hashed against its own manifest. GNU stdio, mutexes, strings and abort are
selected from actual cumulative GNU objects. No replacement stdio, mutex,
cancellation, null return address or unresolved-symbol suppression is used.

The original 14 missing dependencies now have genuine candidate definitions:

| Required symbol/API | Genuine source/body | ABI and selection |
|---|---|---|
| `__assert_fail` | GNU `assert/assert.c:30` | `void(const char*,const char*,unsigned,const char*)`, nonreturning |
| `__cxa_demangle` | LLVM `libcxxabi/src/cxa_demangle.cpp:381` | `char*(const char*,char*,size_t*,int*)`; actual source compiled |
| `abort` | GNU `stdlib/abort.c:75` | `void(void)`, actual signal/fatal implementation |
| `aligned_alloc` | GNU `malloc/malloc.c:3322` | `void*(size_t,size_t)`, accepted unchanged GNU allocator object |
| `fprintf` | GNU `stdio-common/fprintf.c` | `int(FILE*,const char*,...)`, real GNU variadic implementation |
| `free` | GNU `malloc/malloc.c`, public alias of `__libc_free` | `void(void*)`, same allocator authority |
| `memcpy` | GNU `string/memcpy.c:28` | `void*(void*,const void*,size_t)` |
| `memset` | GNU `string/memset.c:27` | `void*(void*,int,size_t)` |
| sized `operator delete` | LLVM `libcxxabi/src/stdlib_new_delete.cpp:127` | `void(void*,size_t) noexcept`; calls standard delete then GNU free |
| `pthread_mutex_lock` | GNU `nptl/pthread_mutex_lock.c` | `int(pthread_mutex_t*)`, genuine normal/robust/priority implementation |
| `pthread_mutex_unlock` | GNU `nptl/pthread_mutex_unlock.c:356` | `int(pthread_mutex_t*)`, genuine public/internal aliases |
| `stderr` | GNU `libio/stdio.c:35` | actual `FILE*` points to GNU `_IO_2_1_stderr_` |
| `strcmp` | GNU `string/strcmp.c:102` | `int(const char*,const char*)` |
| `vfprintf` | GNU `stdio-common/vfprintf.c:21` | `int(FILE*,const char*,va_list)`, calls real GNU internal formatter |

These definitions resolve the previous immediate symbol list; they are not
claims that the resulting GNU stdio or mutex runtime has executed.

## Coherent exception ABI and compiler inputs

The unchanged compiled LLVM units are cxa_exception, cxa_personality,
cxa_exception_storage, cxa_aux_runtime, cxa_handlers, cxa_default_handlers,
private_typeinfo, abort_message, fallback_malloc, stdlib_exception,
stdlib_typeinfo, cxa_demangle and stdlib_new_delete. Both configurations compile
all 13 units. The actual GNU public unwind header is selected; an owned include
wrapper adds LLVM's required struct typedef spellings. The small owned
Unwind-wasm.c adaptation changes the language-specific-data return spelling
from uintptr_t to GNU void* and selects libunwind's actual configuration header
without accidentally including GNU config.h. It does not implement forced
unwind, CFA or change the original SEARCH_PHASE-only personality call.

Native execution of the layout-only module passes eight assertions:
GNU `_Unwind_Exception` 24/alignment8; `__cxa_exception` 72/alignment8 with
unwind-header offset48; dependent exception 72/offset48; EH globals8. This
module has no imports. The original LLVM 32/alignment16 exception ABI is not
mixed into the GNU candidate.

The private accepted C frontend compiles C/C++ units; the original LLVM clang
driver compiles assembly. The first assembly invocation through the private
driver failed on its cc1 invocation and is retained. Target is genuinely
`wasm32-unknown-linux-gnu`, with actual GNU headers, atomics/bulk memory/native
Wasm EH. The compiler-rt archive is the target-neutral
`lib/clang/22/lib/wasm32/libclang_rt.builtins.a`, copied/pinned directly. No musl
subdirectory archive is selected. It contains a real `__unordtf2` definition
and resolves that GNU long-double formatter dependency in default link3.

Unmodified GNU scratch_buffer_grow_preserve.c and
scratch_buffer_set_array_size.c compile using the actual cumulative GNU
compiler arguments, with source/include paths made absolute and task-local
outputs. Their allocation/overflow behavior remains genuine; no constant
success or libc routine replacement is added.

## Retained full-link failures and exact next dependencies

Default link3 PID/PGID **4004595**, exit1, owned group empty. Its complete stderr
is `logs/typed-foreign-link-attempt3.log`; `logs/why-extract.txt` and the retained
attempt3 side-output snapshots identify extracted callers. Unique missing
symbols are exactly:

| Missing symbol | Actual extracted caller | Genuine next source requirement |
|---|---|---|
| `__libc_dlopen_mode` | GNU `iconv/gconv_dl.o`, gconv_dl.c:114 uses `__libc_dlopen` macro | GNU `elf/dl-libc.c:151`, including real `RETURN_ADDRESS(0)` at156 and dl-open machinery |
| `__libc_dlsym` | same caller, gconv_dl.c:117/127/128 | GNU `elf/dl-libc.c:179`; real map/scope/symbol lookup |
| `__libc_dlclose` | same caller, gconv_dl.c:169/194 | GNU `elf/dl-libc.c:221`; genuine handle lifetime |
| `_dl_readonly_area` | GNU `debug/readonly-area.o`, readonly-area.c:28 | GNU `elf/dl-readonly-area.c:41` uses `_dl_find_object`, actual map ELF program headers, PF_R/PF_W and RELRO bounds; no fabricated readonly linear-memory map |
| `__syscall_cancel_arch` | GNU `nptl/cancellation.o`, cancellation.c:53 | architecture cancellation transport/markers and real GNU unwind prerequisites |

The extraction map directly records `io/openat64.o` pulling cancellation.o
via `__syscall_cancel`. `libio/fileops.o` also pulls both `__write` and
`__write_nocancel`; the public Linux write/openat64 source uses real
SYSCALL_CANCEL. GNU cancellation.c's direct-call path for single-threaded,
disabled or exiting cancellation does not justify eliminating the other path.
Genuine nptl/unwind.o still imports `_Unwind_ForcedUnwind` and `_Unwind_GetCFA`;
the five immediate missing symbols are not a claim that full NPTL will close
after five definitions. An architecture cancellation stub is unacceptable.

Release configuration uses the supported upstream
`LIBCXXABI_SILENT_TERMINATE=ON` and NDEBUG, retaining thread support and real
abort. LLVM libcxxabi/CMakeLists.txt:134 defines the option, :441 enables the
macro, and :352 discusses Release NDEBUG. cxa_default_handlers.cpp:97 selects
std::abort as default handler. However cxa_handlers.cpp:36/61/67 still calls
`__abort_message`; abort_message.cpp prints unless both NDEBUG and
LIBCXXABI_BAREMETAL are set. BAREMETAL/no-threads are not selected. The actual
Release link therefore also fails, PID/PGID **4011811**, exit1/empty, with
retained complete stderr/extraction/map. It is not substituted for the default
completion target. No typed/foreign test has executed in this packet.

## Reproduction, evidence and continuation gates

Run the task-owned scripts from the repository root. All launched commands
have task-local TMPDIR/TMP/TEMP/cache and a finite 300-second supervisor
deadline; each child has an actual recorded PID/PGID and terminal status.

```sh
python3 tools/glibc/cxx-exception-closure/prepare-archive.py
python3 tools/glibc/cxx-exception-closure/cxxabi-compile.py
python3 tools/glibc/cxx-exception-closure/cxxabi-compile.py --probe-only
python3 tools/glibc/cxx-exception-closure/gnu-scratch.py
python3 tools/glibc/cxx-exception-closure/layout-execute.py
python3 tools/glibc/cxx-exception-closure/link.py            # expected FAIL
python3 tools/glibc/cxx-exception-closure/cxxabi-compile.py --release
python3 tools/glibc/cxx-exception-closure/release-link.py    # expected FAIL
python3 tools/glibc/cxx-exception-closure/cxxabi-compile.py --deps-only
python3 tools/glibc/cxx-exception-closure/audit.py
```

`logs/source-tool-pins.json` pins actual compiler tools, source and actual
include dependencies; `logs/object-pins.json` pins selected originals, copies,
actual outputs and retained object attempts. `logs/commands.json` records every
launched command with exact arguments/source snapshots/PID/PGID/exit. The audit
independently rereads all pins and checks no owned command group remains live.
The first two default map/extraction output paths were reused before the
supervisor began retaining side outputs. Their full stderr, arguments and
source/output snapshots survive; their original maps are not claimed retained.
Attempt3 has independently retained map/extraction output. Preparation failure
before subprocess launch is recorded separately. No browser/server was started.

The prepared typed probe requires exact thrown-object identity through nested
typed catch/rethrow and exactly one destructor. The foreign probe requires the
original actual GNU unwind record, no premature cleanup during rethrow, and
one FOREIGN_EXCEPTION_CAUGHT cleanup. Both compile, neither runs. The eventual
real Linux guest gate must additionally measure escaping-frame linear SP,
nested RAII/C cleanup ordering, actual GNU allocator ownership and freeing,
per-thread exception/TLS isolation, ordinary EH/nonlocal-jump/allocator
regressions and real abort134 on fatal paths. Forced cancellation additionally
requires actual per-frame stop/CFA coverage, GNU unwind_stop, public pthread_exit
and deferred cancellation/join; this packet supplies none of those acceptance
claims.

The next bounded source review is genuine native static-loader registration,
caller/module provenance and honest symbol/version/RTLD_NEXT lookup, preserving
GNU public APIs and explicit unsupported ELF/namespace errors. Cancellation
architecture/runtime closure remains a separate required packet. These are
GNU/Nightly prerequisites, not optional count reductions.
