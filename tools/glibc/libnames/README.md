The static GNU build skips `gnu/lib-names.h` generation when shared libraries
are disabled, while three genuine NPTL sources include that header. This owned
Wasm architecture overlay selects the exact existing GNU Makerules recipe for
the static build. It uses unchanged GNU version inputs and `lib-names.awk`;
it does not invent installed libraries or change upstream source.

An owned architecture `pthreadP.h` includes the unchanged genuine GNU header
and translates its ELF `.globl` static requirements into typed retained native
Wasm relocations. The two strong unwind references and eight strong threading
references remain strong; GNU's explicit weak trylock reference remains weak.
Missing strong providers must still fail at link. No cancellation implementation
is supplied by this adapter. Private controls prove archive extraction with
section GC and real native/FPCAST table calls; a host GNU assembler metadata
comparison independently checks the original weak/global trylock binding.

Source a task configuration containing the parameters required by the frozen
`syscalls-fixed/env.sh`, with a new disk-backed `GLIBC_TASK`. Run `prepare.sh`,
then `build.py`, through the existing finite task supervisor. All temporary
files, sources and outputs must stay below that new task directory. Preserve
the compiler, fenv and full-make predecessor manifests and their exact inputs.

The gate compares all generated macro lines against an independent run of
the genuine GNU script on the actual make-expanded sonames. Actual GNU make
then builds `pthread_cancel.o`, `pthread_exit.o` and `pthread_create.o`; source
bytes must match the retained original failure snapshots. Native Wasm object
validation and real public symbols are required. This does not accept public
pthread lifecycle, forced unwind, default stack guards, a full GNU sysroot or
Firefox Nightly.
