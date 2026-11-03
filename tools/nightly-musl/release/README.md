# Reproducible incremental Firefox JIT build

For an original-O2 release candidate, use three finite stages: rebuild the raw
Wasm, optimize it with the original `wasm-opt -O2`, then run the original fpcast
compatibility pass and package the validated native. Optimization has its own
1800-second phase budget; compilation, packaging, and runtime test limits remain
unchanged. Choose the CPU count from the host's actual available lane.

```bash
tools/nightly-musl/release/build-firefox-release.sh \
  /path/on/persistent-disk/raw-build --cpus 3 --stage wasm
tools/nightly-musl/release/resume-firefox-release.sh \
  /path/on/persistent-disk/raw-build /path/on/persistent-disk/o2-stage \
  --stage optimize --cpus 3
tools/nightly-musl/release/resume-firefox-release.sh \
  /path/on/persistent-disk/o2-stage /path/on/persistent-disk/package-stage \
  --stage package --cpus 3
```

`build-firefox-release.sh` rebuilds both canonical JIT translation units and the
XPC unified translation unit that contains the Linux/Wasm extension-document
watchdog change. It replaces the two JIT archive members and the one XPC linker
object, then links Firefox. Its default
`--stage package --optimizer compat` remains a compatibility-only diagnostic
build. Build and static package success do not establish browser correctness,
JIT runtime acceptance, performance acceptance, or release readiness.

Every output directory must be fresh and resolve to persistent disk storage. The
owner records actual affinity and cgroup quotas and caps its selected CPUs
accordingly. `TMPDIR`, `TMP`, `TEMP`, compiler module cache and tool cache paths
are explicitly inside the output's `t` folder.

For known persistent services, set `LINUXWEB_PROTECTED_PROCESS_PINS` to an explicit
JSON file such as `{"992":"1606","761994":"2334360"}` before either the build or
resume wrapper. Keys are decimal PID strings; values are exact start-time strings
from field 22 of `/proc/PID/stat`. The mapping must be nonempty, unique, and current.
With this option, the owner checks only the specified process stat identities and
skips command-line discovery. It records the pin file hash in `owner.json` and
checks the complete identities again during cleanup. Without the option, the
existing generic service discovery remains available.

## Inputs and source boundary

This is an incremental rebuild against retained Nightly 159 musl inputs, not a
pristine upstream Firefox build. The defaults are explicit in `build-release.py`:

- Canonical source root: this repository. `--source-root` can select a reviewed
  source tree with the same generator/header layout.
- Original generator source tree: the retained
  `firefox-nightly-musl-recovery-20261002/source/firefox-159.0a1` tree. The actual
  `prepare.py --coverage broad` generator runs and records all its source inputs.
- Portable interpreter baseline: the retained prepared/observed file under
  `firefox-nightly-musl-jit-full-20261002/source/firefox-159.0a1`. Its exact SHA256
  is `68ad285afe873cef8afdc4739350ded8854dbc5257f621a1788922253e47eef5`.
  The canonical musl patch applies with zero fuzz and no offset. The initial
  generator's loop-only interpreter is deliberately not copied over this stage.
- XPC baseline: the prepared `js/xpconnect/src/XPCJSContext.cpp` in the same
  retained tree, SHA256 `3625183bec9f084f115b7136bc1d102d3d69c016910975de956c359266c090ca`.
  `--prepared-xpc` may select an identical reviewed copy. The shared
  `tools/nightly-jit-prep/extension_document_budget.py` adapter runs on this source.
  The retained unified translation unit keeps all 15 other source includes, with
  only its XPC include redirected to the owned adapted file.
- Native link base: `/mnt/p3/codex-build/gpt6-jit20-observe-native`. The base
  `link.args` and every real link input are inventoried. The new `libjs_static.a`
  replaces the selected JIT archive. An owned copy of `firefox-objects.list`
  replaces exactly its `Unified_cpp_js_xpconnect_src0.o` token with the freshly
  compiled XPC object; every other response token stays identical. Original
  responses remain untouched. Other native objects, including `glremote.o`, stay
  selected by the base; output and map paths are task-owned.
- Package base: `/mnt/p3/codex-build/gpt6-jit12/loop-gc-package/candidate`.
  `--base-native` and `--base-package` select explicit alternatives.

The canonical source integration originated in
`/mnt/p3/codex-build/gpt6-jit21-integration/integration.patch`: the reviewed
candidate20 tier observations and candidate21 copied cache-lifetime observations.
All seven source/header outputs were regenerated and matched the reviewed
candidate bytes on 2026-10-17. The integration changes diagnostics, not native
cache policy. A true pristine-tree recipe still needs a separately verified
upstream-to-observed-interpreter preparation step.

## Extension-document watchdog scope

On Linux/Wasm only (`__wasm__ && __linux__ && !__wasi__`), an active extension
codebase principal selects `dom.max_ext_document_script_run_time`, with a finite
60-second fallback. The existing `ContentScriptAddonPolicy()` branch remains first;
`AddonPolicy()` identifies extension documents only after that branch. Ordinary
pages keep their existing 10-second default, extension content scripts their
5-second default, and chrome/system principals their existing setting. Principals
without an addon policy keep the ordinary fallback. Native and WASI builds retain
the original selection.

The new preference joins the watchdog callback table and minimum calculation.
Existing checkpoint halves, slow-script dialog, termination and global blocking
behavior remain unchanged. The existing “always continue” action writes the newly
selected preference, so it cannot disable ordinary-page limits for an extension
document on Linux/Wasm. As with the existing integer preferences, an explicitly
configured zero is a no-limit selection; nonpositive values are excluded from the
watchdog minimum. The new default is neither zero nor a production-wide content
budget override.

`tools/nightly-jit-prep/test_extension_document_budget.py` checks exact source
adaptation and can compile the actual extracted selector/callback/minimum code
with `--compile`. Its cases cover the target, native Linux, non-Linux Wasm, WASI,
and Linux-plus-WASI macro combinations, policy and fallback categories, and
positive/zero/negative overrides. These classifier checks do not establish real
extension startup or popup acceptance; that still requires a fresh ordinary UI run.

## What the recipe guarantees

Both `PblJit.o` and `PortableBaselineInterpret.o` are explicitly rebuilt using the
original musl Clang command line and original release `-O3 -DNDEBUG=1` flags.
Neither object can be silently inherited from the old archive. The stage contains
`PblJit.cpp`, `PblCacheObserve.h`, `PortableBaselineInterpret.cpp`, `PblIc.inc`,
`PblIcOps.h`, `PblMethod.inc`, and `PblTierObserve.h`; source hashes, compiler
arguments and compiler dependency files are retained.

The XPC unified object uses its own original musl compiler command, including
`-O2 -DNDEBUG=1`. Its retained compile working directory and all flags are preserved;
only the source, object output and dependency output paths change. The adapted
unified source, its 16 input sources, compiler provenance, and original/new linker
response and object identities are recorded in `xpcIntegration`. Resume stages
require the completed XPC compile and reverify the owned response binding.

All 827 base archive members are compared. Every member other than the two
explicitly replaced names must remain byte-identical. Either replaced object may
also reproduce the base bytes; that is reported as unchanged while still being
checked against the freshly compiled object.

The default transform is the existing `/usr/bin/wasm-opt` with:

```text
--all-features --disable-compact-imports --pass-arg=max-func-params@23 --fpcast-emu
```

The combined build's `--optimizer O2` inserts the original `wasm-opt -O2` before
that pass but retains its short total build bound. Use the staged commands above
for the normal O2 budget; neither path silently falls back after a timeout. With the
default `compat` mode, no optimized artifact is created or claimed in the report.
This mode is not a fair performance comparison against an O2 build.

Both the raw and final Wasm pass `wasm-validate --enable-all`. The raw precheck
records import names/types, shared memory and absence of DWARF. The final check
uses the existing structural inspector to enumerate every actual indirect-table
element and requires `(23 i64) -> i64` for each target, with an unchanged native
import ABI. Merely finding a matching type declaration is insufficient.

The package helper changes only `opt/firefox/firefox`. A separate scan compares
record order, all unchanged record bytes/hashes and metadata, native metadata,
and trailing bytes. The manifest records the actual archive size/hash and a
testing label. When the package base has a frozen route receipt, only the archive
and manifest routes and their matching file entries are rebound. No service is
restarted or deployment performed by this build.

## Bounds and review artifacts

Build and package owners stop work at 560 seconds; their outer shells stop at
590 seconds and allow ten seconds for forced termination, for a 600-second total.
The separate optimize stage defaults to an 1800-second optimizer phase, a
1860-second owner bound, and a 1890-second outer shell plus ten seconds for forced
termination. Original runtime test deadlines are unchanged. Each native child
has a 16 GiB address-space limit, 2 GiB file limit
and its own recorded process group. On failure only that owned group is stopped.
The owner samples available host/cgroup memory, maintains a 1 GiB floor, a 20 GiB
disk reserve and an 8 GiB output bound. These are sampled protections, not an
aggregate cgroup memory limit.

`--stage sources`, `--stage objects`, or `--stage wasm` stops at that useful
boundary. Each invocation still uses a fresh output directory; failed evidence
is preserved. The default `--stage package` executes the complete build once.

Review `report.json`, `build-state.json`, per-stage command/receipt/log files,
`archive-members.json`, `final-abi/result.json`, and `package/package.json`.
Reports inventory actual products and keep runtime/release acceptance false.
The source generator's `manifest.json` and `pbl/deps/*.pp` retain generation and
compiler dependency evidence. Persistent preview/display identities are recorded
before and after without assuming ownership of unrelated short-lived processes.

The original 50-case JIT sessions, mutation workload and 150-second session / 30-
second scope deadlines are unchanged. Runtime validation and the signed uBlock
popup scenario are separate follow-up tests against the actual output binary.

## Script watchdog context diagnostics

`package-extension-budget.py BASE OUTPUT --expected-native-sha256 SHA` creates a
fresh, separately labelled diagnostic package with a fixed 60-second script
budget. The optional `--script-context` selector identifies the principal scope:

| Context | Preference | Scope |
| --- | --- | --- |
| `extension-content` (default) | `dom.max_ext_content_script_run_time` | Extension content scripts with an `ExpandedPrincipal` |
| `content` | `dom.max_script_run_time` | Ordinary content, including extension background pages with a `ContentPrincipal` |

`XPCJSContext` selects the extension content-script preference only when
`ContentScriptAddonPolicy()` is present; `BasePrincipal` supplies that policy for
an `ExpandedPrincipal`. An ordinary `moz-extension` background document with a
`ContentPrincipal` therefore uses the ordinary content preference. The source
defaults are 5 seconds for extension content scripts and 10 seconds for ordinary
content. Single-process operation through `MOZ_FORCE_DISABLE_E10S=1` does not
change this principal-based selection. Runtime observations must still identify
the actual context and effective preference.

For the ordinary-content experiment, pass `--script-context content` and use a
verified primary package that retains its original preferences. The helper adds
only the selected 60-second preference to
`/opt/firefox/defaults/pref/wasm.js`; the original extension content-script default
remains 5 seconds. The default selector preserves the earlier extension-content
experiment. A pre-existing override for the selected preference is rejected.

The helper keeps the existing finite resource limits, checks the expected native
hash, and verifies record ordering, the trailer, all untouched members, and the
single changed preference member. Metadata records the selected context,
preference, value, native identity, and preservation proof. It retains
`runtimeAcceptance: false`; each experiment requires its own runtime evidence.
Existing diagnostic artifacts remain unchanged.

## Resuming finite stages

`resume-firefox-release.sh` reuses completed stages from a raw build or a
previous bounded attempt. Each call requires a fresh disk-backed output
directory and verifies retained source, object, archive, raw Wasm, linker-input
hashes, and completed stage receipts before proceeding. Optimize uses the
1800/1860/1890+10-second profile by default; package and compat-package keep their
560-second owner and 600-second total bounds.

For example, after measuring the available CPU lane:

```sh
tools/nightly-musl/release/resume-firefox-release.sh \
  /path/to/prior-build /path/to/new-o2-stage --stage optimize --cpus 3
tools/nightly-musl/release/resume-firefox-release.sh \
  /path/to/new-o2-stage /path/to/new-package-stage --stage package --cpus 3
```

The optimization stage runs the same original `wasm-opt RAW -O2 -o OUTPUT`
command with a default 1800-second phase limit. `--short-optimizer` explicitly
selects the historical 530-second comparison window; `--extended-optimizer`
remains a compatible explicit alias for the normal budget. These options apply
only to optimize. The selected deadline profile and optimizer executable/library
hashes remain in build-state and report metadata through subsequent packaging.

`--observe-optimizer` adds bounded external PID/start-bound /proc samples at a
five-second cadence. It records 530 seconds as a comparison milestone without
stopping a normal run. It changes no optimizer flags, validation settings, or
pass scheduling. No internal Binaryen debug option is required.

Optimization does not repeat compilation. A successful O2 stage is never rerun
by a package resume. That stage
also reuses already completed fpcast, final structural validation, or ABI
inspection when their command, byte hash, and predicates match. A copied final
artifact or report is checked against its retained source bytes; it is recorded
as reused evidence. An incomplete or failed stage is never treated as passed.

The reports identify the preceding build and reused stage evidence. A successful
optimization-only report means that stage completed; it does not claim a complete
package, a runtime pass, or a performance result.

On 2026-10-17, the original O2 stage completed in 577.252850 seconds on three
effective CPUs after the user authorized a longer optimizer budget. That was
47.252850 seconds beyond the prior 530-second cutoff. The measured input was
`c6a8d61c3db34133eccdc120ed7f5aedd407bad59ffc8a941a6777fd0534c150`: only the
Wasm name custom section had been removed, with every other section envelope
and payload, including `llvm.func_attr.annotate.inline-me`, independently proved
unchanged. Previous raw-input attempts timed out, so this does not establish a
measured speedup from metadata removal. The optimized intermediate was
`bb92c36681c4b15544a2fb8630b79288d671112e64af04c88f91738003893f2c`; the
validated and packaged native was
`26e380d20f7ad198155fcf0626bc72ab49a5caf2be89e61dcafadbf4efd16998`.
The retained `jit-name-only-o2-extended` and `jit-o2-package` reports record the
original command, phase receipts, hashes, and cleanup. Runtime acceptance remains
a separate gate.

An explicit compatibility-only package can also resume directly from the verified
raw Wasm. This preserves the same original fpcast command and performs no
compilation or O2 stage:

```sh
taskset -c 0-2 tools/nightly-musl/release/resume-firefox-release.sh \
  /path/to/prior-raw-build /path/to/new-compat-package \
  --stage compat-package --cpus 3
```

The state, report, package and frozen route receipt label this result
`diagnosticOnly: true`, `fullO2Status: unresolved`. They retain the failed prior
stage report by hash. The primary package keeps the existing extension timeout;
`package-extension-budget.py` creates a separate diagnostic layer and carries
forward the native optimizer status. Existing raw/source-map bytes and completed
build stages remain preserved.

On 2026-10-17, the typed-array admission raw module completed this compatibility
resume in 91.3 seconds after two bounded O2 attempts timed out. The resulting
native SHA256 is
`6258aabbaa031832e4c1a7504fdb64807393f82b26f7aa6c8b67a8bb4778b278`;
its five-second-default archive SHA256 is
`26229de6855b8c4f1b72528c1fbc5b57af2d079b9b05e164e01e57d401ac1c61`.
Static ABI and native-only archive checks passed. These results establish a
reproducible diagnostic build, not runtime or full-O2 acceptance.

## Typed-array IC admission and focused runtime probe

`PblIc.inc` declines compilation of an IC chain containing
`LoadTypedArrayElementResult` or `StoreTypedArrayElement` while those operations
have no inline translation. Otherwise a hot chain repeatedly crosses the fpcast
ABI to interpret individual operations. Rejection follows the existing negative
cache path and installs the existing interpreter entry, which handles the whole
IC chain. The other ICs and the method/loop tiers retain their existing admission
rules. This change does not modify cache lifetime or GC policy.

`typed-array-probe.html` is a separate companion to the unchanged original JIT
suites. Run it inside the actual guest Firefox with a distinct `?label=...` URL
parameter, preserve the complete
`PBL_TYPED_ARRAY` records, and check the captured log with:

```sh
python3 -B tools/nightly-musl/release/check-typed-array-probe.py \
  --raw /path/to/capture.log --label exact-runtime-label \
  --out /path/to/check.json
```

The probe requires 9,514 assertions across 12 semantic groups, including number
and BigInt arrays, conversion/clamping, invalid indices, resizing and detachment.
Four fixed throughput cases each perform 458,752 operations in seven samples and
verify their expected checksum. It keeps a 120-second wall deadline and records
both active and wall time. The checker requires complete ordered records and
finite timings. It does not infer the binary, CPU lane, enabled tiers, native
execution, or complete session lifecycle from a user-agent string; those must be
bound to the actual runtime capture separately.

Performance comparisons require matching native optimization, environment,
workload and CPU conditions. In particular, `PBLIC=0` also disables PBLBC in the
current method compiler; that configuration is a loop-only control. A
compatibility-only build is not an equivalent performance baseline for O2. The
60-second extension preference package above remains a separate diagnostic;
the primary release package preserves the original default.
