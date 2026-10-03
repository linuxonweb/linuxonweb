# Native GNU Wasm EH/SjLj routing — 2026-10-02

This prepared compiler packet fixes the measured tag1 cleanup-routing failure
and escaping-frame linear-SP leaks in finite native Wasm controls. The final
standalone and composed gates pass. Root review and checkpoint remain separate;
this packet does not establish GNU forced unwind, cancellation, NPTL, public
loader/C++ runtime, a GNU sysroot or Nightly acceptance.

Owned paths are `tools/glibc/native-eh-routing/**`, this report and
`/mnt/p6/build/glibc-native-eh-routing-20261002` (abbreviated T below). Prepared
native-static-loader and accepted cancel-compiler inputs remain unchanged.
TMPDIR/TMP/TEMP/cache use task ext4 storage. The task has a 2 GiB cap, 8 GiB launch
reserve and 5 GiB hard stop. Each supervised command has a separate process group,
300-second limit, full log, source/input/output snapshots and terminal group
proof. Supervisor locking excludes concurrent ledger writers.

## Compiler change and exact identities

The source pin is LLVM 22.1.8 from
`/mnt/p6/project/linux/.tmp-firefox-build/nix-local-store/nix/store/jkx0x4a4nlmnjm0kz9fiss33b7wh8z9k-source`.
Installed LLVM libraries/tools are from the sibling
`xwpycnlb71djqs4gyxhbkxhzb3pw1ib4-llvm-toolchain-22.1.8` directory. The accepted
C cleanup frontend is `/mnt/p6/build/glibc-c-cleanup-20261002/objects/compiler/clang`.
Unchanged GNU architecture jump declarations come from the actual cumulative
GNU 2.44 header tree. No GNU setjmp, cancellation or unwind implementation is
replaced by this packet.

`prepare.py` creates the owned `WebAssemblyCFGStackify.cpp` and patch. The opt-in
`-wasm-native-eh-routing` hook runs after original unwind-mismatch handling,
relative-depth rewriting and result-type adjustment, before function END and
later local/register numbering. It explicitly requires wasm32 Linux GNU and
legacy Wasm EH; modern EH, another target and wasm64 reject.

For every original legacy catch_all, a separate EH block catches the actual
`__c_longjmp` tag, consumes its i32 payload in a valid vreg/drop and executes
native rethrow0. Original leading scoped END markers/labels move before the new
catch, preserving bytecode order. Original catch body, successors and EH
alternatives remain. Original tag-specific SjLj catches remain unchanged.
Tag0 and foreign exceptions continue through original cleanups/catches; tag1
bypasses them. This includes the deliberately tested architecture catch_all,
not only compiler-generated language cleanup pads.

An actual global-SP read before the prologue defines the entry-state vreg even
for zero-stack functions. A typed outer TRY matches the original function result
using LLVM's existing result rules; separate outer handler and END blocks keep
MachineVerifier's terminator rules valid. The escaping handler writes this real
entry SP and rethrows the exact native exception. Normal typed fallthrough and
explicit returns remain normal. No JS or assembly reset repairs a failed frame.

Original inner depths remain unchanged. The old delegate-to-caller destination
now reaches the new outer restoration handler. The strengthened fixture's actual
`objects/delegate.s` contains `delegate 1` at line 45, targeting catch0, while
its original inner cleanup and tag1 bypass retain their own scopes. Actual
nested targets and normal returns are tested, rather than inferred from layout.

Final identities:

| Artifact | SHA-256 |
|---|---|
| `T/logs/compiler.patch` | `54282b5f77bde214a3ad9d93bbcc11d83b96d4a881128397f7cbcc4e91013efa` |
| `T/objects/WebAssemblyCFGStackify.cpp.o` | `ea7cf9ec3e1e7d3d178e8ee498abcd55f2df1d22ea92a2ba20bf658ee7e0a54a` |
| standalone `T/objects/llc` | `07663226f1abe212a143fd885c98578c751cddf53ff498923f3cfb8e7406cc0a` |
| `T/objects/composed/llc` | `801e1771b69f7cce0a535c00b07fc412ebebc128925bcabde41d0d8c1fa5b1b8` |
| composed target archive | `c62f8db2d4ab0381dcc93f834705ecfd2c4bc263dd1e957632e3f9e836ebea36` |
| `T/logs/compose-archive-proof.json` | `4b0bcfe8e924322b5269143ca6df27fc9ba253865da84d3e26ad90d028664831` |

Standalone sparse compilation regenerates four target tables, rebuilds only the
CFGStackify member and unchanged llc drivers, and relinks private llc. The ordered
45-member proof shows only CFGStackify changed. Composition copies the original
installed archive into a fresh directory and replaces exactly CFGStackify plus
accepted FrameLowering; the remaining 43 ordered members match original bytes.
Accepted FrameLowering is
`/mnt/p6/build/glibc-cancel-compiler-20261002/objects/compiler/WebAssemblyFrameLowering.cpp.o`,
SHA `cd5c088f0596ee87989c964e1f63644d124dcb11120ed20aa8d07801ab195e5f`.
There is no full LLVM build, upstream mutation or later LTO.

## Actual finite execution gates

All final backends run `-verify-machineinstrs`, `-exception-model=wasm`, native
Wasm EH/SjLj and the opt-in routing flag. Links have no allow-undefined or
undefined-symbol suppression. Node executes genuine shared-memory native Wasm
modules; this task is a compiler gate, not a Linux guest runtime gate.

| Gate | Result | Actual execution PID/PGID (exit0, empty group) |
|---|---|---|
| retained predecessor route | 32 cases PASS | 160054 |
| C/C++ frames O0/O2/O3 | 336 cases per mode PASS | 160503 / 160728 / 160957 |
| normal typed returns O0/O2/O3 | 410 cases per mode PASS | 160519 / 160751 / 160978 |
| delegate/nested/catch-all | 336 cases PASS | 161250 |
| composed controls O0/O2/O3 | 848/0, 864/0, 864/0 assertions | 169415 / 169510 / 169612 |

Standalone coverage totals 2,606 cases. The retained routing replay changes
ordinary tag1 cleanup from `[1,9,9]` to `[9]` and keeps tag0 `[1,2]`. Frame suites
measure zero/static/dynamic/overaligned/indirect/nested/recursive C and C++ frames,
exact foreign Error identity, actual native tag/payload, and SP before/after.
C++ here means real emitted destructor cleanup pads; it does not mean libc++abi
public typed catch/rethrow runtime acceptance.

Retained-target cases require result37 and cleanup9 exactly once on later normal
exit. Two nested native setjmp targets exercise inner and outer destinations:
inner jump produces `[9,11]`, outer jump `[11]`. These use LLVM's real native SjLj
operations and actual GNU architecture declarations; they do not replace the
GNU public jump implementation. i32/i64/f32/f64/void leaf and branch returns
cover explicit returns and typed fallthrough without hitting an artificial trap.
Delegate controls exercise normal callee unwind-to-caller, invoked cleanup,
nested parent cleanup, normal return42 and an independent original catch_all.
Standalone fatal import counters remain zero.

Composition reuses the six accepted O0/O2/O3 C/C++ IR inputs and unchanged
accepted diagnostic runtime.o. Each mode retains 80 ordinary escaping cases,
16 tag0 cases and adds 32 genuine tag1 escapes through C and C++ loops. Ordinary
identity, source cleanup order and SP restoration pass. Tag1 retains its actual
tag and payload731, skips source cleanup and restores SP. The retained target
itself is tested in the standalone suites. Caller-SP and compiler-poll controls
also retain their accepted normal zero/static/dynamic/indirect/nested/recursive
checks. No reset function, exported reset symbol or JS reset call is present.

Actual Wasm traps intentionally bypass EH. Sixteen fresh instances per mode
measure trap identity, no source cleanup and a 16-byte SP change, then are
discarded. These rows remain in the reports; trap recovery is not claimed.

Flag-off private llc assembly is byte-identical to predecessor assembly,
SHA `25a05c81137f20827c04fd11b6c282fe186a0f3f01f7a398f0842e85f30b1900`.
Modern-EH, wrong-target and wasm64 controls abort with the owned diagnostic:
PID/PGID 161339, 161493, 161606, exit-6 and empty groups.

## Preserved failures and diagnostic boundaries

Every prior compiler/source version and command output remains retained in T.
The first void outer TRY failed native validation; a temporary unreachable fixed
that subset but broad O0 frames exposed nonterminator-after-RETURN verifier
failure. Separate handler blocks fixed verifier structure. The next broad
candidate passed frames/returns but delegate execution failed because typed
inner results reached a void outer TRY. Final typed outer TRY removes that
artificial unreachable and passes the delegate regression and every return gate.

Earlier assembly and explicit-import link failures remain. The strict frames
link requires real GNU abort/std::terminate dependencies and failed. Root approved
separately labeled diagnostic fixtures declaring exact env.unexpected_abort and
env.unexpected_terminate imports; both counters are zero. Composition preserves
accepted diagnostic-only runtime.o, including its compiler control helpers and
fatal boundary. These helpers are not GNU/libc++abi providers and establish no
fatal, typed C++ or cancellation runtime acceptance.

The first composition link failed on eleven genuine `__c_longjmp` tag references,
PID/PGID164664 exit1, empty group. Its archive, objects and log remain unchanged.
Attempt2 uses a new `composed-controls-attempt2` directory and adds the actual
native tag declaration plus raise_tag1 fixture; it does not suppress unresolved
symbols. Fresh composition directories refuse rerun overwrite.

The initial read-only inspection used nonexistent `routes.adapted.bc`; its
failure is recorded without invented task PID proof. Corrected supervised
inspection uses actual retained `routes.bc`. One negative control used an invalid
LLVM CLI exception-model name; it remains a CLI failure, not an owned guard proof.
The three final supported negative controls provide the actual guard evidence.

## Reproduction and evidence

Run each script with python3 from the repository, in this order, using a fresh
owned task directory: prepare.py, plan-pins.py with a new version, build.py,
routes-build.py, frames-build.py, delegate-build.py, compiler-controls.py,
compose-pins.py with a new version, compose.py, compose-tests.py, audit.py.
Scripts currently pin the authorized dated task path; copying or parameterizing
for a fresh replay must preserve original evidence. Composition refuses existing
output directories. Do not rerun it over this prepared packet.

`T/logs/commands.json` contains 315 actual finite commands, argv/input hashes,
actual PID/PGID, full log paths, historical sources and outputs. Every command
is terminal and every owned group is empty; the longest measured command is
7.56 seconds. Historical attempted outputs are preserved under
`T/objects/attempts`, and source versions under `T/source`.

Reviewed final standalone plan manifest is
`T/logs/plan-source-pins-attempt4b.json`, SHA
`09450e1851fbcc95dafc7f4074e897fdae355bd8dd4a0e577953f8f226cad89f`.
Reviewed original composition manifest is `T/logs/compose-source-pins.json`, SHA
`71592f04d93818a882237341639b2300178d278fba36a7ab11ef7b79cb1dd5a2`.
Fixture attempt2 manifest is `T/logs/compose-source-pins-attempt2.json`, SHA
`d4411afd4ae38548a7628b35002565ddc728612601f6f6b3acf9dd31d733e9f5`.
Final `final-source-tool-pins.json`, `final-object-pins.json`,
`final-evidence-pins.json`, `repository-path-pins.json` and
`prepared-acceptance.json` provide current source/tool/include closure, all
retained objects/evidence and exact repository path hashes. Root independently
reviews and checkpoints these paths; this packet performs no Git operation.

## Remaining boundary

The patch does not publish activation records, prune frame/target registrations,
provide _Unwind_GetCFA or _Unwind_ForcedUnwind, run GNU stop callbacks before
language cleanup, or implement GNU thread cancellation. A dynamic-allocation
callee is tested with caller cleanup, but restoring active body SP for a forced
stop in its own dynamic cleanup requires the separate frame design. Real target
ownership, thread/TLS/exec generations and equal-SP ancestry remain unimplemented.
No concurrency, general coverage, unsupported modern EH, C++ exception record
ownership, swallowed forced-exception abort or public pthread_exit/join gate is
accepted here. Current full GNU loader/C++ links still depend on genuine
cancellation closure. The next packet must integrate real frame/target records
and tag0 stop-before-cleanup semantics with the native kernel cancellation
boundary, then execute genuine public NPTL/C++ gates before Nightly.
