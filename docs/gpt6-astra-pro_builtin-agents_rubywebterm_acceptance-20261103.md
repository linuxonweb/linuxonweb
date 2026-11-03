# LinuxOnWeb — verified improvements and remaining work

**GPT-6 Astra Pro · built-in agents · rubywebterm · 2026-11-03**

This work improves the existing Linux/Wasm desktop and ships a usable signed
package repository. It does **not** meet the complete requested target. The
current evidence-based acceptance is **42/100**: responsive Firefox within30s,
full desktop OpenGL/Vulkan,50% host-browser graphics performance, guest Node.js,
and full Firefox on Android/iOS remain unproven or unmet. Failed experiments
were retained, and candidates with regressions were kept out of the default.

The base work period began07:06:26UTC and ended12:06:26UTC. The authorized
important-bug extension is limited to the concrete HTTPS mobile worker-loading
fix, its acceptance, and final recovery. The hard ceiling is13:06:26UTC.

## Accepted desktop image and how to use packages

The default image is **APK4 d258203daee8**,116,197,223 bytes, one gzip member:

```text
SHA256 4675a8ceb318c539cd64eb1b69338a19185d0cadb7a5f51b2352048a0c09a771
```

Its original Linux init and Firefox executable remain unchanged. The native
Firefox SHA256 is
`26e380d20f7ad198155fcf0626bc72ab49a5caf2be89e61dcafadbf4efd16998`.
The exact served image passed the real production browser decompressor,
desktop extras/init wrapper, Firefox rendering, actual terminal package
installation, Python invocation, and Stop/home-persistence checks.

Open the desktop terminal and run:

```sh
sudo apk update
sudo apk add python3 coreutils gzip grep sed
python3 -m json.tool --help
/usr/bin/ls --version
/usr/bin/gzip --version
/usr/bin/grep --version
/usr/bin/sed --version
```

The signed repository is
https://a3cf34ce40307517.5x7aqstuceku.opentunnel.xyz . It remains available while
its owned server/tunnel are running. An immutable tagged `@snapshot` fallback is
configured explicitly; it does not silently substitute stale packages.

These are genuine executables for this project's wasm32 Linux ABI. They are
not compatible with arbitrary Alpine x86_64/aarch64 repositories. Signature
and per-file checksum verification remain enabled. Rootfs package files and the
APK database reset together on guest reboot; **/home persists**. The standalone
BusyBox shell can prefer its applets over PATH, so explicit `/usr/bin` paths are
used for GNU command verification.

| Package | Version | Delivered status |
|---|---|---|
| apk-tools |2.14.12-r0|Fresh target build; real signed install/remove and script execution.|
| busybox |1.38.0_git-r0|Existing genuine target executable packaged with provenance.|
| ca-certificates |20261103-r0|Distribution trust bundle.|
| curl |8.21.0-r1|Existing genuine executable packaged with corrected alias ownership.|
| python3 |3.14.6-r1|Fresh target build; ordinary-admin invocation, JSON, files, compression, hashing, sockets/threads and posix_spawn tested.|
| coreutils |9.11-r0|Fresh GNU multicall build; representative commands and signed network installation tested.|
| gzip |1.14-r0|Fresh GNU build; roundtrip, upstream launchers, CRC/corruption rejection and package lifecycle tested.|
| grep |3.12-r0|Fresh GNU build; fixed/extended/recursive matching and error exits tested; PCRE omitted.|
| sed |4.10-r0|Fresh GNU build; substitutions, extended regex, in-place backup and errors tested.|
| linuxonweb-vkgears |20261103-r0|Optional native Vulkan WSI demonstration; tested explicit guest WebGL backend.|

The ten entries include the manager, certificates and optional graphics demo;
they are not ten independently ported general-purpose applications. Wget, tar
and findutils are not accepted standalone GNU packages. Node.js is not delivered.
Python's fork-dependent Popen path, mmap, ctypes, curses, Tk, readline and DBM
remain unavailable; host Node22 is build tooling, not guest Node.js.

Package details and limitations:
[genuine packages and recovery](gpt6-astra-rubywebterm-packages-recovery-20261103.md).

## What changed and what was measured

| Area | Verified change or observation | Scope and limit |
|---|---|---|
| New-file metadata | Removed a redundant lookup/truncate transaction after a newly created empty file is already committed.50 real-browser checks and independent review pass. |64-cycle metadata sample767.32→695.39ms, about9.4% lower; strict durability unchanged.|
| FUSE lookup metadata | Optional atomic lookup+attributes uses one read-only transaction; old implementations retain the original fallback.24 host checks and actual native stat/permission/error assertions pass. |128-stat ABBA median about11.9% lower; equal262LOOKUPs, separate getattr785→526. This is a separate workload, not an additive speedup.|
| Boot working set | Preserve compressed initramfs through the frontend, now the normal Firefox default. |Earlier matched reference-image peak owned PSS4.2732→3.2287GiB, about24.4% lower. It did not meet30s startup and is not a fresh peak for APK4.|
| GL command transport | Removed avoidable scalar/draw allocations while retaining diagnostic/swizzle paths. |Narrow command benchmark improves; this does not imply the full Firefox scene reaches50% of host speed.|
| JIT retention | Bound the immutable compiled-module cache to1024entries and8MiB of retained source images.69 native checks and seven lifecycle groups pass. |The limit is not a cap on all compiled code, live table functions or guest memory. Native compiler/private-code/GC limitations remain.|
| Vulkan presentation | Corrected partial WSI presentation, image orientation, resource cleanup and close handling.32 real-GPU checks and a native acquire/render/present/close sequence pass. |The tested demo renders; this is not Vulkan or full OpenGL conformance. The separate WebGPU path retained a device-memory failure.|

### Full Firefox remains slow

The controlled reference cold runs observed Firefox chrome around71s and a
rendered startup page around91s. These are screenshot observation bounds, not
precise event latencies. A later exact APK4 run deliberately avoided active
browser observation for the first150s, so it cannot establish earlier readiness.

The same320x240 WebGL2 cube measured **59.84828fps in host Chromium** and
**3.4783fps in guest Firefox** in the latest APK4 control, about5.8% of host.
The guest sample had a7.089s longest frame interval. Real hardware rendering was
present; the whole guest/browser execution path still incurred large stalls.
This directly fails the requested50% host-performance goal.

The benchmark explicitly used3CPU affinity with an effective3CPU ancestor quota,
2GiB guest memory,1280x720 desktop, and WebGL presenter/backend. Public defaults
are different: CPU min(4,hardwareConcurrency), saved settings honored, initial
2GiB with a possible4GiB Firefox choice, and auto/WebGPU selections. Backend
choices remain explicit; no silent WebGPU-to-WebGL fallback was introduced.

The latest APK4 quiet run sampled peak owned PSS2,810,084,352B=2.617GiB. CPU,
RSS, available RAM and quota were sampled every second; PSS every five seconds,
so its peak is a sampled lower bound. The historical compression comparison
used one-second PSS and must not be mixed with this newer workload/cadence.

Evidence: [APK4 and Omni receipts](../tools/startup-benchmark/evidence/apk4-omni-20261103/acceptance.json),
[atomic metadata receipt](../tools/startup-benchmark/evidence/atomic-lookup-20261103.json),
[owner timing ledger](../tools/startup-benchmark/evidence/startup-owner-time-ledger-20261103.json).

## Important failures and useful diagnostics

**Browser archive compatibility.** An initial APK composition used concatenated
gzip members. Node and direct kernel checks accepted it, but real Chromium
DecompressionStream rejected it. The release was withdrawn, the previous image
restored, and the package builder changed to a single gzip member. APK4 is the
accepted correction. AGENTS.md now requires the exact production browser path
for every image/compression/composition release.

**Canonical resource packing was rejected.** Firefox159's own OmniJar formatter
reduced regular resources8,059→26 and64KiB file allocation by538,509,312B.
Native/init and8,030 non-manifest resource payloads were verified unchanged.
However, the download grew3.2MB, matched first150s PSS rose2.617→3.231GiB
(+23.4%), and cube throughput3.1877fps did not beat3.4783fps. Fresh and retained
profiles both rendered correctly, but this candidate remains off public.
One-GiB viability was not tested; the two-GiB regression does not answer it.

**The global cache marker is a concrete startup lead.** The root-owned
`/opt/firefox/browser/.purgecaches` remains after normal startup, and Firefox
admin cannot remove it. Source159 invalidates caches whenever it exists; a
diskless root restores it on every boot. In an isolated exact-APK4 guest cloned
from a closed test profile, removing only that marker caused the original
startup-cache inode to be read5,236,797B and script-cache inode14,313,900B,
with zero rewrites. This proves actual cache reuse. It does not prove a clean
speedup: recovery uploads and a short GNU guest overlapped the run. A safe
per-image/per-profile migration covering all launch paths is not implemented;
the public marker remains. [Diagnostic receipt](../tools/startup-benchmark/evidence/cache-marker-20261103/acceptance.json).

**Restart normally is not accepted.** The real about:profiles action closed
Firefox with exit0, but no replacement PID/window appeared in90s. Readable
native159 source supplies a likely existing cause: detached process creation
returns not-implemented on this target, and shutdown ignores the result.
Exact baseline runtime equivalence is untested; native bytes are unchanged.
Restarting every exit0 from a wrapper would break ordinary Close and was not used.

**Writeback remains off.** Negotiated experimental FUSE writeback reduced256
4KiB writes to two host writes, but the existing Stop path lost acknowledged
dirty guest pages. A separate native barrier fixture passed16 checks covering
real syncfs, active/open writers, durable reopen, quota errors, nonce ownership
and timeout resume. Actual desktop PID1 can still respawn/write, so a complete
production quiescence protocol is missing. Strict public commits were preserved.
Code-cache seeding also remains off after failed reuse/deadline experiments.

## Android, iOS and the mobile loading fix

A minimal real Linux package console has been tested on the attached MI8 through
an isolated ADB route, including native uid/gid output and cleanup. This is not
full desktop Firefox on the phone. iOS hardware acceptance is unmeasured.

The HTTPS console exposed a concrete module-loading bottleneck. The targeted fix
bundles the worker's imports into one content-addressed module, verifies SHA256
before execution, shares one owned Blob across that machine's workers, and
preserves original asset bases/execution queries. URL confinement rejects
foreign origins, credentials, wrong paths, query strings and fragments. A capped
stream bounds the worker body to4MiB even with missing/false Content-Length;
abort and cleanup paths are explicit. The normal desktop worker path is unchanged.
Independent source review and29 real-Chromium integrity/lifecycle checks pass.
The actual authenticated HTTPS phone gate passed at12:06:35UTC: native `id`
and APK information through real Android input, physical Stop, one worker-bundle
fetch, exactly one Blob created and revoked, and owned tab/forward cleanup with
no errors. The source commit is recorded in the final release table. This accepts
a minimal native Linux console on the tested phone, not mobile Firefox or iOS.

## Reproduction, recovery and timing

The accepted image source directory is
`out/gpt-6-astra-pro_builtin-agents_packages-mobile-20261103/build/rootfs-apk4`.
The existing coordinated publisher is:

```sh
node web/desktop/publish-build.mjs out/gpt-6-astra-pro_builtin-agents_packages-mobile-20261103/build/rootfs-apk4
```

Do not publish the rejected Omni directory. Read `AGENTS.md`,
`agent/continue.md` and `agent/devsummary.md` before further work. The source
branch is `gpt-6-astra-pro_builtin-agents_linuxonweb-20261103`; no Git remote
was configured on arrival. Recovery preserves source/history separately from
large runtime assets and private encrypted signing-key recovery. Public exports
exclude profiles, private preview state and signing secrets. Full native
Firefox rebuilding is not yet reproducible from the shipped source checkpoint
alone; old exact object dependencies remain inaccessible and the readable source
export has not been shown equivalent to the current linked binary.

Startup checkpoints:80a52d1 (durable create path),c2e4d21 (atomic metadata),
0f2b5dc (APK4/Omni acceptance),78d7b29 (cache-marker diagnostic). GNU packages
and recovery tooling:83c4c2. The runtime hashes are recorded in the completed package recovery receipt.
The final cumulative source/history upload is still pending at this versioned
documentation checkpoint; its post-freeze completion receipt will identify the
exact source HEAD and public URLs.

## Final timing and iteration accounting

Documentation checkpoint: **2026-11-03T12:19:58.069549+00:00**. Elapsed from07:06:26UTC is
**18812.070s (5h13m32.070s)**. The last measured phone event ended
12:06:35.931UTC,18009.931s after task start. Cumulative recovery publication
continues after this checkpoint and has its own completion receipt. Model and
planning time were not instrumented.

| Agent or task | Recorded units | Measured duration | Interpretation |
|---|---|---:|---|
| startup_io browser/runtime owners |39 completed receipts|3324.041s summed;3324.037s interval union|Actual monitored browser jobs; none>300s.|
| startup_io separately retained seed/packing builds |4 receipts|165.523s|2.003s seedv1,3.008s seedv2,128.483s canonical pack,32.029s combination; not a complete native-build aggregate.|
| packages_mobile monitored stages |88 receipts|2198.230s interval union|Raw nested sum2204.244s is not added again; none individually>300s.|
| graphics_jit host build/test work |95 measured ledger entries across categories|713.494s host build/test|The95 entries also include the separate categories below and shared runs; not95 independent desktop acceptance cycles.|
| graphics_jit physical-device owners |Separate owner lifetimes|1349.471s|Includes setup,UI and tool idle; not pure guest CPU or boot time.|
| graphics_jit read-only background services |Separate bounded owners|542.475s|Overlaps device tests; do not add as wall time.|
| graphics_jit artifact upload |Separate transfer|156.481s|Network transfer, not build/test CPU.|
| Final runtime recovery upload |8 verified files,172422959bytes|592.892s|11:57:07.656–12:07:00.548UTC; sequential8MiB transfer parts and server SHA verification explain>5min.|

Startup records contain12 explicitly numbered phase entries (including baseline;
legacy number3 was not separately recorded). Package legacy23IDs are timed-stage
IDs; the later milestone ledger records9–11 plus final recovery12. These counters
have different meanings, so they are not combined into a misleading total.

Two graphics owner lifetimes exceeded5min: the301.001s read-only server was an
expected finite background service; android6 lasted314.523s because it included
setup/UI/tool latency, physical Stop and a second Start, with a120s bound for
each guest period. No slow native build is hidden in those values. All these
categories can overlap and must not be added to infer project wall elapsed.
The four retained startup build receipts are partial build coverage; additional
short fixture durations remain in their experiment notes. No unmeasured total
model/planning duration is invented.

Detailed accounting: [final timing JSON](../agent/final-timing-summary-20261103.json),
[startup owners](../tools/startup-benchmark/evidence/startup-owner-time-ledger-20261103.json),
[package stages](../tools/guest-packages/evidence/final-timing-20261103.json),
[graphics ledger](../agent/graphics-jit-devsummary.json).

## Final mobile release and next steps

The accepted mobile/runtime source commit is
**a2d3da521831e39f150cb8f757d1eaa7c0d0f621**. The final physical phone gate used
MI8, Android15, Brave/Chrome148,1guestCPU and512MiB. It measured6.669s for image
fetch and3.601s from verified image to native prompt; existing kernel cache may
be reused, and complete navigation-to-ready was not measured. Neither is a
Firefox launch result. Native `id`, APK information, signed repository update
and Stop/worker cleanup are accepted. Phone Python installation did not finish
within45s. An on-screen keyboard was visible, but letter taps/composition were
not tested. iOS hardware remains untested.

[Mobile acceptance report](gpt6-astra-pro_builtin-graphics_rubywebterm_mobile-20261103.md)
and [curated phone receipt](../tools/graphics-benchmark/evidence/gpt6-astra-rubywebterm-mobile-20261103.json)
retain the exact scope and failures.

The highest-value next work is a reproducible native159 build/restart fix,
safe per-profile resource-version cache invalidation, a complete durable Stop
barrier before writeback, and full-browser stall profiling. Genuine Node.js,
remaining GNU packages, broader Python support, full mobile Firefox and iOS are
still unfinished. Use the [next-agent prompt](../agent/next-agent-prompt.md) and
[authoritative continuation](../agent/continue.md); keep the accepted APK4 image
while future candidates are evaluated.

The verified runtime recovery archive is available at:
https://fileharbor-meak.basicgleam65.chatgpt.site/raw/meaklocaldev/f26dad37-c632-4ccf-b123-5180fb22fa05/linuxonweb_gpt-6-astra-pro_builtin-agents_rubywebterm_20261103_runtime/
Its local reassembly/extracted hashes and all8server hashes passed; a freshly
fetched public manifest matched. Final source/history recovery is a separate cumulative publication, **pending
at this documentation checkpoint**. Its completed external release receipt and
the final delivery message identify the exact frozen source HEAD and public URLs;
this report does not claim that upload has already completed.

To recover the complete project, obtain all three dependencies: the original
encrypted **80a52d1 full-history base**, the **final cumulative encrypted history
increment** (which requires that base), and the **exact runtime archive** above.
A filtered public source tar is useful for inspection but does not replace the
full history or large runtime assets. The intermediate d080f8f increment is a
progress checkpoint, not the final cumulative increment. The package recovery
report links the original base. Local increment fetch/git-fsck and runtime
reassembly/hash checks pass; a complete public redownload/decrypt of the full
release has **not** been performed. Keep that verification limit explicit.
