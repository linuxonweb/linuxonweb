GNU memory source selection and closed host behavior pass in
`/mnt/p6/build/glibc-memory-make-20261002`. Actual GNU make compiles thirteen
units: unchanged sbrk, errno/errno-location, memcpy/memset/wordcopy, plus seven
owned native memory architecture providers. This does not establish a complete
GNU archive, sysroot, Linux guest runtime or Firefox Nightly baseline.

The existing nonrecursive Wasm allocation authority supplies anonymous RW
mapping and range reuse. The new logical break tracks GNU brk/sbrk independently
from mapping placement. Tests establish that failed expansion across a mapping
preserves both the break and mapped payload, that OOM leaves placement unchanged,
and that remapping preserves data and zeros its expanded tail. Shrink and unmap
release logical allocation state without decommitting or protecting Wasm pages.
MAP_STACK and hardware protection requests remain unsupported.

The first build failed because GNU sysd-syscalls had been generated before the
architecture source overrides were installed. That rules file and original
frontend errors remain retained. Regenerating owned metadata makes unmodified
GNU make-syscalls.sh select the explicit providers. The final prepare script
invalidates stale generated selection metadata after installing its overrides.
No kernel syscall, upstream generator or frozen predecessor source changed.

The first direct host probe passes282 checks. An expanded public ABI gate adds
volatile function-pointer calls compiled against genuine GNU declarations,
including off64_t and variadic mremap, and native/FPCAST23i64 modules each
pass291 checks with zero imports. TLS storage follows actual linker metadata
and precedes the heap floor. All13 selected source/snapshot/object records,
their309 actual dependencies and build selection were audited.

Replay commands and required environment are in
tools/glibc/memory-make/README.md. Tested reports are logs/memory-make-run2.json,
logs/host-run2-result.json, logs/host-run2-fpcast-result.json and
logs/memory-audit.json. The initial audit asserted a source path without GNU's
relative ../ prefix; its failed script is retained, and the corrected check
accepts that exact relative prefix without weakening selected-provider checks.

These exact objects still require concurrent real Linux guest integration.
Files, shared mappings, default NPTL stacks/guards, general CRT and full libc
are outside this accepted host gate. The requested sequence remains genuine
GNU Nightly, then verified native JIT, then GPU and a verified Sites release.
