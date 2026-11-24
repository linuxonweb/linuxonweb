# Coherent GNU full-make discovery

This fresh build consolidates independently accepted native Wasm source
overlays and measures actual GNU `make -k -j2 lib` failures. Object counts
alone do not establish an archive, installed headers, CRT, NPTL or Nightly.
No accepted target objects are copied as build results.

`prepare.sh` verifies immutable prerequisite hashes, reuses only the accepted
private compiler and build-time metadata/SjLj tools, and replays the signed
GNU source with initial GNU configure metadata. `finish-prepare.sh` applies
the reviewed overlays, verifies the frozen corrected memory runtime, and
regenerates GNU metadata before compilation.

Use an owned ext4 `GLIBC_TASK` with the foundation environment variables and
the packet variables listed in `verify.py`. `supervise.py` owns finite
preparation process groups; `run.py` caps make at 600 seconds with two jobs,
a 2 GiB task cap and 8/5 GiB launch/stop reserves. All temporary files,
caches, diagnostics, commands, source snapshots and outputs belong there.

The owned compiler starts with unoptimized genuine C frontend IR, preserves
native C cleanup pads, translates reviewed GNU data aliases and warning
metadata, lowers jumps in their caller, then optimizes and emits native Wasm.
Exact vtable symbol extents are corrected without changing storage or code.
The diagnostic O2/C driver is not full production compiler-flag acceptance.

The syscall dispatcher selects the exact frozen final16 template for its
101 audited names and the exact last5 template for only its five new names.
Arity-sensitive APIs use their reviewed architecture C sources. These
template names include inherited compile-only or unsupported runtime APIs;
their presence does not imply full syscall capability.

The completed discovery produced 1,729 Wasm objects and 40 GNU text stamps.
Both actual make runs exited 2; six targets still fail, and no archive was
produced. The second run registered two genuine architecture providers that
the first run had not attempted, preserving all 1,727 earlier object hashes.
See `docs/glibc-coherent-make-20261002.md` for the measured boundaries.

Run preparation and auditing through `supervise.py` with unique labels and
task-local logs. `run.py run1` performs the bounded make. When reproducing the
historical incremental correction, `register-arity.py` requires the exact
old Makefile; fresh replay already includes that registration. Invoke
`audit.py run2 run2-final` to select the run2 inventory and a distinct report
name. It pins GNU `.d` and compiler `.dt` files, expands only the documented
GNU path variables, and rejects unknown variables. Historical reports and
executed source versions remain retained; auditing does not rerun compilation.
