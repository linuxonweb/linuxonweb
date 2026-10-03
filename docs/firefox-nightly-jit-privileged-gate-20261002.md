# Nightly privileged JIT evidence gate — 2026-10-02

This packet prepares the privileged safety checker and driver. It does not
establish a linked observer browser, real GC/debugger/coverage/interruption,
native callback stack/TLS safety, full JIT acceptance, GPU support or deployment.
Public Sites v10 remains unchanged. All tests in this packet are explicitly
synthetic host predicates or mocked driver API checks.

`tools/nightly-jit-safety/check-privileged.py` consumes separate privileged
console and **direct raw Firefox observer stderr** files. Console records use
`NJS_PRIV {…}` or Firefox's `console.log: "NJS_PRIV …"` representation. Observer
records retain the exact `PBLJIT_OBS event=… file=… line=… off=… tid=… pthread=…
tls=… epoch=… fn=… kind=… sp=… pcDelta=… ic=…` format. Duplicate/missing fields,
unknown events, exhausted observer budget, malformed records, fatal traces, source or identity drift,
incomplete/reordered operations and split/overlapping byte windows fail.

The updated `privileged-driver.js` uses a real current, live, in-process
`WindowGlobalChild.innerWindowId`, a generated run UUID and exact fixture label
on every record. It preserves direct access requirements and requires a raw
same-source install/run baseline before starting owned operations. Mocked
properties never prove those APIs are available in the guest. Remote actors
remain unsupported and must be implemented and validated separately.

Run one scope per capture after main/Worker fixture completion. Keep a fresh
unrotated observer file, below 2 MiB, under the exact fixture's guest directory.
Retain the complete raw file and one console invocation transcript per scope.
There is no browser launch or guest log-acquisition runner in this packet.
After a caller validates direct ordered acquisition in the real guest, invoke:

```javascript
await NightlySafetyDriver.incremental(actualContentWindow, actualGuestObserverPath);
await NightlySafetyDriver.sliceGC(actualContentWindow, actualGuestObserverPath);
await NightlySafetyDriver.run(actualContentWindow, actualGuestObserverPath);
await NightlySafetyDriver.interrupt(actualContentWindow, actualGuestObserverPath);
```

Each invocation generates its own run nonce. Capture its identity record, use
that nonce/window ID in the corresponding caller-reviewed manifest, and check
all four scopes separately. `run` orders whole GC, debug of the previously
compiled sum, debug of the fresh function, then coverage. Every done record
binds raw observer `beforeBytes`/`afterBytes` offsets from actual bounded
`IOUtils.read` snapshots; the driver compares the full old prefix byte for byte
before emitting completion. The checker independently selects complete raw
records in those byte intervals. Byte units replace the older UTF-16 character
counts. The observed initial/current GC states and cleanup records are actual
API return values; an `ok` boolean cannot replace raw observer proof.

The predicate requirements are:

- Whole and slice GC: sixteen correct sum results, cleanup to `NotActive`,
  source/LoopHead/old-function-specific eviction at a strictly greater real
  major-GC epoch, then an actual new install and normal run at that epoch.
  Slice GC calls `startgc(1)`, exactly one `gcslice(1,{dontStart:true})`, then
  `finishgc()` in `finally`; it does not retry until a favorable result.
- Incremental GC: initially inactive, exactly `startgc(1)`, active state both
  before and after the real fixture loop, result 8386560, an appended
  same-source/LoopHead/thread/pthread/TLS `skip-incremental`, owned `finishgc`
  cleanup to `NotActive`, and no main-fixture specializer entry in the window.
- Debugger: the exact sum/fresh source, real breakpoint offset, positive
  break and step counts, bounded concrete integer locals consistent with the
  sum loop, correct result, raw same-thread `skip-debuggee`, cleared actual
  breakpoints and detached debuggees. Main-fixture install/run/bail/noentry/
  interrupt records during the operation fail.
- Coverage: real positive per-bytecode-offset counts with source positions,
  correct result, raw same-thread `skip-coverage`, no main-fixture specializer
  entry, coverage disabled and debuggees detached afterward.
- Interruption: actual same-source install → generated-Wasm `Interrupt`
  (`kind=3`, native output fields) → subsequent `InterruptCheck` false/abort
  observation at the same LoopHead/thread/TLS/epoch, followed by a normal sum
  recovery run and correct result in the same actual content window within
  15 seconds. Preference restoration is required. Recovery alone fails.

The interruption driver temporarily sets `dom.global_stop_script=false`
alongside its existing bounded timeout/always-stop preferences. Current
Nightly's false interrupt result otherwise blocks scriptability for the global,
preventing the intended same-window recovery. The driver restores each prior
value and user-value bit in `finally`. This is a scoped test policy, not an
application default change. It does not itself observe callback termination.

The smallest diagnostic callback hook is the existing PBI `CASE(LoopHead)`:
after `PUSH_EXIT_FRAME`, save the actual `InterruptCheck(cx)` result; emit
`ObserveSkip(frame->script(),pc,cx,"interrupt-callback-continue"/"interrupt-callback-abort")`;
then keep `if (!interruptAllowed) GOTO_ERROR()` unchanged. Root prepared this
in the separate unapplied observer-run6. The specializer's existing `interrupt`
record proves only generated-Wasm return kind3; it does not prove abort. Actual
coherent observer compilation, callback ordering and guest execution remain
pending. The checker refuses a current driver-only interruption transcript.

Production has no synthetic-acceptance switch. The CLI requires an independently
reviewed acquisition digest:

```bash
python3 tools/nightly-jit-safety/check-privileged.py \
  --acquisition /mnt/p6/build/ACTUAL_PACKET/acquisition.json \
  --review-sha256 CALLER_REVIEWED_SHA256 \
  --out /mnt/p6/build/ACTUAL_PACKET/privileged-result.json
```

The acquisition JSON has `kind: "actual-guest-privileged-acquisition-v1"` and
`capture: {"producer":"guest-firefox","observer":"direct-unrotated-stderr",
"console":"direct-browser-console","orderedSnapshots":true}`. `expected`
contains `scope` (`incremental`, `slice-gc`, `gc-debug-coverage` or `interrupt`),
actual `label`, `runId`, decimal-string `windowId`, `version: "159.0a1"`,
actual `applicationBuildID` and `platformBuildID`, `observerLogPath`, and the
exact main case IDs plus `debugFresh`, `coverage`, `infinite` in `fixtureNames`.

`artifacts` must contain exactly `console`, `observer`, `contract`, `driver`,
`observerPbl`, `observerInterpreter`, `compiledIdentity`, `captureReview`.
Every entry is `{ "path": "ABSOLUTE_RETAINED_PATH", "sha256": "…" }`.
The fixture contract and every generated fixture file are rehashed. The driver
must match the checker companion exactly. Main and Worker observer sources are
allowed only from that pinned fixture inventory; Worker records cannot supply
main-operation identity proof.

The manifest's `compiledIdentity` fields are `target: "wasm32-linux-musl"`,
`version`, `applicationBuildID`, `platformBuildID`, `observerPblSha256`,
`observerInterpreterSha256`. The retained compiledIdentity JSON report must
have `pass:true` and match those fields; the source digests must equal the
retained observer source artifact digests. The caller must independently review
actual complete configure/compiler/link/fpcast/module evidence behind this
identity report. This checker does not replace the coherent full-build gate.

The retained captureReview JSON must have
`kind:"caller-reviewed-actual-guest-capture"`, `pass:true`, matching `label`,
`runId`, `windowId`, `observerLogPath`, and `artifacts` mapping the other seven
roles to their exact SHA256 digests. Review the live guest/browser ownership,
source installation, stream ordering/flush visibility, prefix preservation,
absence of omitted/rotated stderr and source/build identity before creating
this report. Hashing retained bytes is not proof they came from a real guest.
The caller-reviewed acquisition is the explicit runtime trust boundary; the
checker cannot authenticate arbitrary files against a compromised producer.
Known synthetic/mock provenance in acquisition/raw/review files is refused.

`guestEvidencePass` is only the selected operation's bounded evidence verdict.
`guestAcceptance` and `fullJITAcceptance` remain false even when it passes.
Combine all four scopes with the existing main/Worker safety gate, current
host/browser/kernel CPU agreement, native callback stack/TLS probes, actual
browser/NSS/TLS/performance acceptance and release checks before promotion.

Current-source API citations and full-file SHA256 pins are retained in
`/mnt/p6/build/firefox-nightly-jit-privileged-gate-20261002/api-source-review.json`:
Window.webidl686 (ChromeOnly windowGlobalChild), WindowGlobalActors.webidl240–250
(in-process/live state and innerWindowId), IOUtils.webidl28–38/498–507 (byte
reads/maxBytes), XPCComponents.cpp1610–1613/1732 (forceGC/testing functions),
TestingFunctions.cpp3127/3187/3231/3249 (state/start/finish/slice),
Debugger.cpp4665/4846/4879 (coverage/detach/getDebuggees),
Script.cpp1547/1665/1750–1816 (breakpoint cleanup and actual coverage fields),
XPCJSContext.cpp798–808 and all.js1861 (abort/scriptability preference), and
PortableBaselineInterpret.cpp8232–8236 (existing callback branch).
`IOUtils` has no digest operation in this driver; the checker hashes retained
bytes with Python hashlib. Browser file-read and stderr-flush availability
remain real-guest validation requirements, independent of host mocks.
