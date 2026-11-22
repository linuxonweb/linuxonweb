# GNU static metadata and native references — 2026-10-02

Actual GNU make now builds the three originally blocked NPTL objects:
`pthread_cancel.o`, `pthread_exit.o` and `pthread_create.o`. The owned Wasm
architecture exposes the genuine GNU library-name generator to static builds.
All 22 generated macros match an independent run of the unchanged GNU script
on the actual make-expanded inputs. Names remain GNU metadata; they do not
advertise installed shared libraries.

The first successful header generation exposed GNU ELF `.globl` requirements
that the existing native metadata pass correctly refused. An owned architecture
`pthreadP.h` includes the unchanged GNU header and replaces its static-require
macro with typed retained Wasm pointer relocations. Two unwind references and
eight threading references remain strong. GNU's explicitly weak trylock symbol
remains weak. The original weak/global combination is checked with an actual
host GNU assembler relocation fixture. This preserves the separate attributes
described in the [GNU assembler global documentation](https://sourceware.org/binutils/docs/as/Global.html)
and [weak documentation](https://sourceware.org/binutils/docs/as/Weak.html).

The gate checks the actual objects' public symbols, all eleven static references,
raw typed initializers, retention metadata and absence of module assembly.
Three successful five-stage compilations consume unchanged genuine GNU sources;
445 source/object/header inputs are hashed. Earlier metadata/query failures and
the original executed tool versions remain retained.

Private link controls prove a missing strong provider fails, an archive provider
is extracted with section GC enabled, and its native function remains callable
through the actual table. Native and FPCAST23i64 controls have no imports and
return the expected value. These controls supply a private arithmetic function;
they supply no GNU cancellation or pthread runtime implementation.

Artifacts are under `/mnt/p6/build/glibc-libnames-20261002`; replay tools are in
`tools/glibc/libnames`. Six supervised build/control groups terminate naturally
and are empty. Task storage is approximately 0.41 GiB on disk. No guest server
or browser was started by this packet.

The initial sonames capture redirected an empty shell command instead of its
echo group; exact failed inputs are retained, and group capture now matches
the generator. The first static control replay also omitted `-c` from the frozen
driver's normalized argument list; its failed invocation is retained. An unused
weak/global assembler fixture emitted no symbol, so the final comparison adds
an actual relocation. These are retained test/tooling failures, without turning
them into successful runtime claims.

An initial audit assumption that all eleven references were strong failed on
GNU's explicitly weak trylock declaration. The accepted audit checks ten strong
requirements and that weak requirement separately against actual objects and
the GNU assembler control. The initial audit script was not snapshotted before
correction; its historical bytes are not claimed as retained provenance. The
executed build overlays and successful compilation inputs are retained.

Full GNU archive/sysroot, default thread stacks and guards, public join/detach,
forced cancellation unwind, loader/CRT, C++ dependencies and Firefox Nightly
remain incomplete. The next syscall packet continues separately. The accepted
36-wrapper runtime and public Sites release are unchanged.
