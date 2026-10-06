# Actual no-debug Run55 post-link packaging

Run55 completed the ordinary full native Linux/Wasm Nightly159 build. Its owner
reaped the build and verified the exact process group empty before freezing the
runtime. Raw validators and current object freshness/no-DWARF evidence remain
under `/mnt/p6/build/firefox-nightly-musl-recovery-20261002/status`.

The separate post-link task is
`/mnt/p6/project/build/nightly-native-package-transform-20261003`. Seven distinct
native Wasm executables have actual raw/final inspection, 23-slot fpcast, and
final WABT validation: Firefox, plugin-container, xpcshell, pingsender, gfxtest,
certutil, and pk12util. The three browser programs retain imported shared memory
with maximum 4 GiB, an exported growable function table, the exported 8 MiB
stack, and native exception tags. Helpers preserve their own measured contract.
All 143 ABI comparison predicates pass. Raw build outputs remain unchanged.

Each finite phase uses 16 GiB address space, a polled 12 GiB group RSS bound,
4 GiB host available-memory floor, core limit zero, oom_score_adj 1000, one
Binaryen worker, and a 900-second bound. The transform task retains a 4 GiB disk
cap; full package and default-page overlay tasks each retain 2 GiB caps. Every
task requires a 20 GiB free-space reserve. No bound was increased.

The complete original runtime inventory has 9,047 records and 814,536,417 bytes,
including eight executable records. `firefox-bin` resolves to the same raw main
as `firefox`; it is an alias, not an eighth independently validated module.
The existing packager deliberately materializes source/object symlinks as
regular guest records, avoiding host links in the archive. This baseline keeps
that contract: installing the validated main for the alias duplicates
188,796,635 uncompressed payload bytes. Both records are explicitly bound to
the same final main hash.

Actual inventory first rejected two generated text files containing build
paths. The scoped adapter alters only installed copies of:

- `chrome/toolkit/content/global/buildconfig.html`: four exact compiler-display
  and configure tokens replace the owned build-root prefix with `[build-root]`.
  The configure paragraph must be literal display text with no nested markup,
  and each configure token must have whitespace boundaries. Script and style
  elements elsewhere in this resource are rejected before any replacement.
- `modules/RFPTargetConstants.sys.mjs`: three owned source-root prefixes are
  removed only from the exact generated comment on line 2, preceded by the
  canonical generated-file comment on line 1.

Raw inventory identity is retained; installed hashes, lengths, replacement
counts and reasons are recorded separately. Unexpected paths elsewhere,
functional JavaScript lines, changed comments, nested scripts, prefixed tokens,
and different roots fail. The original 36 package fixtures and 16 additional
controls pass, for 52 checks under `fixture-run58` in the package task.

An independent review caught the initial nested-markup/token-boundary gap.
The first two actual packaging phases were stopped and owner-reaped with child
exit -15 and their exact groups empty. Their partial `candidate-real-run55` and
`candidate-real-run55-v2` archives remain diagnostic artifacts with no successful
package reports. A later review exposed template-literal contexts; requiring the
canonical generated header and rejecting script/style wrappers resolves that
specific gap. The corrected actual candidate uses `candidate-real-run55-v3`.

The runtime package uses the previously audited init-only trust candidate as
input, replacing its complete Firefox runtime with current159 resources. The
legacy seed remains inert; no saved profile/home record changes. The separate
version/WebGL/WebGPU default-page overlay retains Firefox code, init, home and
profiles. Its force-enabled preferences and diagnostic page do not establish
GPU acceptance. Actual baseline and NSS guest runs require the coordinated test
owner and independently reviewed final package hashes. Packaging establishes
no browser, NSS/TLS, JIT, GPU or release acceptance.
