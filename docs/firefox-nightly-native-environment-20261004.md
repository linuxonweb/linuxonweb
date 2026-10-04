# Native Nightly environment interposer

Run58 cold startup exited 139. The unchanged-package diagnostic captured
`158256@0x5585073 -> 1526 -> 154306 -> 154395 -> 346991 -> _start`.
A bounded named-preoptimizer/body/data lookup binds this to the actual startup
`SaveToEnv("NO_AT_BRIDGE=1") -> PR_SetEnv -> putenv` path. The ELF interposer
used `dlsym(RTLD_NEXT)`; the linked native musl implementation returns null,
and its missing-real-symbol crash branch executes the observed unreachable.
This is separate from the previously corrected main-thread stack trap.

The reviewed patch scopes Linux/Wasm, excluding WASI, to six static linker
wrappers: secure_getenv, __secure_getenv, putenv, setenv, unsetenv and clearenv.
It retains the upstream synchronized getenv scanner and actual musl mutation,
copying and caller-buffer ownership. The compatibility secure alias calls
musl secure_getenv. Public pthread_once and mutex attributes initialize a
recursive lock before any constructor-time call. Recursion is required for
musl secure_getenv -> getenv, name-only putenv -> unsetenv, and
setenv(overwrite=0) -> getenv. Ordinary Linux keeps the original resolution.
The initial task candidate used a recursive static initializer absent from
this selected musl; its failed compile is retained, and the corrected object
uses public initialization APIs with explicit fatal checks for failures.

The actual native guest passed 40 checks: early NSPR PR_SetEnv before main,
pointer alias and mutation, direct caller-buffer removal, replacement policy,
invalid names/errno, real clearing, both secure APIs and synchronized reader/
writer pthread rounds. A private fixture control saved/restored libc.secure
to verify real musl filtering; this does not accept kernel AT_SECURE handling.
The original object traps 139 before main in the same early NSPR call. Both
actual modules use native C++ ABI, accepted native runtime archives,
--fatal-warnings links, valid Wasm and uniform 23-slot fpcast targets.

The guest aggregate was 41/0 with exit 0, actual host/browser/guest CPU 6 and 1 GiB
RAM. The strict outer harness remains **false**: Chrome exited 0 but left two
running descendants and one zombie, so the exact owned group required forced
cleanup. Unified 76027 was reaped 1 without a resource stop; Node 1000387 and
Chrome 1000462 groups were physically empty afterward and the server closed.
These results accept the environment behavior only. Production adoption and
the natural component compile are complete; ordinary program links, helpers,
baseline, broad JIT and release remain pending. No Firefox GPU test ran.

The replay recipe requires exact original/patched source and patch hashes,
preserves the original, and supports an already-applied source with fresh
evidence. Production browser links must select the six wrappers and audit
all direct linker diagnostics. Helpers separately need the admitted shared
memory import/max 4 GiB and exported table; their existing stack/table layout
must remain unchanged. Do not broaden the browser runtime wrapping gate to
helpers. Validate that structural loader contract on every packaged module,
in addition to Wasm validity and fpcast signatures.

Before adoption, eight Run58 outputs (raw seven plus Rust) were independently
copied after exact size/hash matching against the accepted manifest: 738,794,194
bytes with distinct inodes and unchanged originals. The replay applied the exact
reviewed source and preserved original source/defs bytes. The natural component
compile exited 0 and produced the same 3,732-byte object used by the actual guest,
SHA256 `006f277bb40baaedbf106255da5c7adba42e937583864e5e8a8787723a49d4c9`.

Seven forced make and real compiler-driver previews passed: the three browser
programs select exactly the six environment wrappers; the four helpers gain only
import-memory, shared-memory, max-memory 4 GiB and export-table. Helper stack
sizes and fixed table layout remain unchanged. The three preparation owners
exited/reaped 0, with groups 1018672, 1026763 and 1028669 physically empty. These
were previews: no program link or optimizer ran. The full build remains held for
the coordinated standalone benchmark window.

Evidence: [native-environment.json](../tools/nightly-musl/evidence/native-environment.json).
The retained task is `/mnt/p6/project/build/nightly-native-env-20261004`;
`guest-gate.json`, `root-actual-env-review.json` and `guest-run/physical-cleanup.json`
retain the semantic result and outer failure separately. The independent
trap report is `nightly-baseline-run58-20261003/independent-env-trap-review.json`.
