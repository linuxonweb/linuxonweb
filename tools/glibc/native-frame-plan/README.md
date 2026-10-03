# Native GNU frame and forced-unwind design

The reviewed normal frame prerequisite passes native O0/O2/O3 controls. GNU
forced unwind, cancellation and lifecycle remain unaccepted.

```sh
python3 -B tools/glibc/native-frame-plan/evidence.py
python3 -B tools/glibc/native-frame-plan/review.py
```

Default owned ext4 storage is `/mnt/p6/build/glibc-native-frame-plan-20261002`.
Use `GNU_FRAME_PLAN_TASK` for a fresh replay. TMP/cache is task-local; cap2GiB,
launch reserve8GiB, hard stop5GiB. All source and compiler bases are read-only.
The source/layout evidence is separate from the sparse compiler and normal
record gate. Reviewable hook plan and acceptance gates are in
`docs/glibc-native-frame-plan-20261002.md`.

The accepted sparse compiler is frozen in `records-patch-7` with ABI/runtime
snapshots. `records-controls-4/results.json` records 5,361 native assertions,
three byte-identical flags-off objects and compiler/runtime rejection controls.
`audit-records.py` independently rereads the successful evidence, archive members,
link inputs and retained failures. First failures remain in patches2/5 and
controls1/2/3. `prepare-records.py --packet records-patch-N` creates a fresh
review copy without replacing an earlier packet. `build-records.py --packet
records-patch-2` only prints its bounded recipe. Sparse compilation requires
the exact root-reviewed `--reviewed-patch SHA256` and retains all stages.
The first record mode rejects EH pads/SjLj and forced dispatch explicitly.
After exact reviewed compilation, run `test-records.py --packet records-patch-N`.
Native record controls use a synthetic owner token and never reset SP; they
cannot accept GNU TP/lifecycle/forced unwind. See the task document for failures
and remaining composition requirements.

Separate module4 compilers now build without modifying records7. Frozen
`module4-proposal-16` and `module4-proposal-18` each pass the same 5,361 normal
native assertions; records-controls-8 and records-controls-9 contain their
exact sources, commands and outputs. `prepare-module4.py` defaults to the
source17 replay of frozen16. These normal gates still use a synthetic owner.

`module4-proposal-25` moves the unique marker result definition into the true
machine entry alongside the actual caller-SP capture. Its normal gate is
`records-controls-10/results.json` (5,361 assertions, O0/O2/O3 and byte-identical
flags-off objects). Retained SjLj resume execution needs the composed consumer
gate; normal-path evidence does not prove that route.

The current mixed-provider source combines an external exact module/function
IR manifest, producer-owned primitive authentication, real manifest-root getter,
strict C++ CatchPad provenance and backend64 jump registration. Proposal26's
first compile fails on a missing target-intrinsic header; proposal27 adds only
that header. Its diagnostic build and source-bound admission controls are
separate from runtime acceptance. Genuine GNU abort remains allocating and
must participate in records. The source-only `transition-status-v2.*` proposal
does not replace it or solve corrupt-owner fatal admission.

Backend64/public196 and generation-bearing immutable tag1 delivery handles
require every GNU jump-buffer client to rebuild. Unchanged GNU unwind,
cancellation and jump units have separate compile evidence owned by the
coordinating packets. No general EH/forced-unwind, owner bootstrap, pthread
lifecycle, full sysroot or Firefox acceptance follows from these controls.

`module4-proposal-31` builds the fixed record/context address correction from
actual Enter/Bind frame-index provenance. Only FrameLowering is rebuilt, with
exact GNUFrames27/LowerSjLj23/TargetMachine16 reuse. Its four groups exit0 and
empty. Fresh records-controls11 passes 5,361 normal native assertions, flags-off
byte identity and rejection controls, with 108 pins and 46 empty groups. The
composed SjLj compiler now reaches a retained unconsumed-admission
failure; runtime acceptance remains absent.

`transition-status-closure-2/proof.json` closes all18 actual IR function bodies
with the genuine canonical bridge and state-valid provider, retaining the first
unsealed-arithmetic-intrinsic rejection. `fatal-status-proposal-1` is a separate
uncompiled status2 fatal-scope source proposal; no compiler status consumer,
genuine recorded abort gate or corrupt/unpublished fatal policy is accepted.


Work stopped on the user's switch back to musl Nightly/JIT/GPU. All GNU source,
compiler and failed-control artifacts are retained. The already launched
source32 build finished before the stop reached its supervisor; no source32
runtime or SjLj controls were launched. Its compiler SHA256 is
`53126ca50e5da00714fa51d7afab7547deed5d9cf39ba6773da7bd584660a03a`,
under `/mnt/p6/build/glibc-native-frame-plan-continuation32-20261002`.
The exact Call-to-Invoke conversion preserves compiler admission and early-poll
metadata; only LowerSjLj was rebuilt in the verified consumer13 composition.
The 3825-input plan includes 606 actual include dependencies, verified again
against the postcompile dependency file. All four build groups and the
supervisor group are empty. Latest actual composed SjLj controls remain the
consumer13 unconsumed-admission failures; source32 has compile evidence only.

The retained `fatal-status-proposal-2` corrects proposal1's persistent critical
depth: fatal lifetime is separate TLS state, with critical depth held only for
short atomic token mutations. This leaves genuine GNU import/signal paths
available. It is source-only and has no compiler status consumer. Status0,
status3, nested failure, callback checkpoint lifetime and epoch retirement
remain unresolved. No GNU cancellation, general forced unwind, production
owner, full sysroot, Nightly, JIT or GPU acceptance is claimed.
