# Actual Run55 native runtime package

The ordinary no-debug Run55 full build is frozen, owner-reaped and group-empty.
The complete current Firefox **159.0a1**, local BuildID **20261003042618**, Hg
`dfc77f7a6d716f1a20a2576597638d4fc21cd916` runtime is packaged. This establishes
structural package acceptance; browser, NSS/TLS, JIT, GPU and release acceptance
remain pending. Public v10 is unchanged.

The raw main is **175,262,059 bytes** at
`/mnt/p6/build/firefox-nightly-musl-recovery-20261002/obj-nightly/dist/bin/firefox`.
Its separate 23-slot fpcast copy is **188,796,635 bytes** at
`/mnt/p6/project/build/nightly-native-package-transform-20261003/firefox.fpcast.wasm`.
The whole default-page Firefox/Linux gzip is **280,673,250 bytes**. These measure
three different artifacts.

All seven distinct executables—Firefox, plugin-container, xpcshell, pingsender,
gfxtest, certutil and pk12util—have raw/final inspection and passing final WABT
validation. The original five raw validators were supplied by the build owner;
the packaging task separately validated both additional NSS helpers. All 143
ABI preservation checks pass. Every transformed indirect table target uses
23 i64 arguments and an i64 result. The three browser programs retain imported
shared memory with maximum 4 GiB, an exported growable table, the exported 8 MiB
stack and native exception tags. Helpers retain their measured narrower
contracts. The actual fpcast commands include `--disable-compact-imports`.

There are eight executable records: `firefox-bin` resolves to the validated
main. The existing materialized-symlink package contract is retained, so this
alias adds **188,796,635 uncompressed payload bytes** and has the same final hash;
it is not an eighth independently validated executable.

The original inventory has **9,047 records / 814,536,417 logical bytes**, canonical
SHA256 `528b53259c3f4a2758cb93b3ce7464432b666204e55018ac99fd3c7302978f4b`.
The installed runtime has **9,048 records / 869,098,072 logical bytes**. All 3,856
records outside `/opt/firefox` and the archive tail are preserved. The init-only
trust input replaces the historical seed-copy startup before runtime packaging;
the old seed stays inert, while existing home/profile bytes remain unchanged.
Current159 static NSS policy and TLS behavior still require actual guest gates.

Reviewed sanitation commit `3849be7c` changes only installed copies of the exact
generated buildconfig display tokens and the canonical generated RFP comment.
Original inventory/resource hashes remain pinned separately from installed
hashes and replacement reasons. The 52 package fixtures and 30 independent
sanitation controls pass. The first two package attempts were stopped, reaped
with child exit -15 and exact groups empty; their retained partial archives have
no successful reports and are excluded from acceptance. The fresh accepted
candidate is `candidate-real-run55-v3`.

| Accepted artifact | Bytes | SHA256 |
| --- | ---: | --- |
| Full runtime gzip | 281,887,656 | `0b65cf5bb92612dc871deee945d58b63d3d391804ffcebeb914aa2746f46f2eb` |
| Default-page gzip | 280,673,250 | `2ae5c706a08f67cbadae26167ac81df87db36aa11e101e8c6876889db06f1d5a` |
| Full package report | — | `8052e5e5ca91f87e107fed1b95a28a95649d671900ec05db8729dd3ee2b09a8c` |
| Default-page report | — | `1dab026c08a3204bfc2316e4c63c5c0cdf790ad614357c188943c18b295bbf34` |

Full output:
`/mnt/p6/build/firefox-nightly-package-20261002/candidate-real-run55-v3`.
Default-page output:
`/mnt/p6/build/firefox-default-gpu-page-20261002/candidate-run55`.
The unchanged reviewed overlay installs the version/WebGL/WebGPU diagnostic page
and force-enabled defaults. It changes one existing preference record and adds
four page/distribution records, preserving all executable bytes, init, home,
profiles, existing metadata, order and tail. The page SHA256 is
`4e1b2f309e22fe5ef555c6a1a5f221bac75690b016a3afc228fae0466d0c8f21`.
This is baseline default-page preparation, not Firefox GPU acceptance.

All finite phases retain AS 16 GiB, polled group RSS 12 GiB, available-memory
floor 4 GiB, core zero, oom_score_adj 1000, one Binaryen worker and a 900-second
bound. The transform task cap is 4 GiB; package and overlay caps are 2 GiB each,
with a 20 GiB free-space reserve and disk-backed scratch. No bounds were enlarged.
Full packaging exits zero/reaped/group-empty in 73.184 seconds (peak RSS
709,435,392 bytes); the overlay does so in 86.784 seconds (peak RSS
6,648,492,032 bytes). Independent streaming archive/raw/final verification passes
in 20.254 seconds (peak RSS 53,223,424 bytes), also reaped and group-empty.

The coordinated baseline tester has the frozen package/report hashes. It owns
private cold/warm/default-page and profile-preserving update runs, followed by
current-source NSS DER/purpose/date inventory, TLS negative cases and independent
fresh-key checks. Only after those gates pass can the fresh whole broad PBL/JIT
source-copy transition proceed. Packaging launched no browser.

Exact commands/log hashes, all seven raw/final module pins, inventory and archive
pins, phase limits and cleanup, excluded attempts, overlay defaults and source
freeze are retained in [the aggregate evidence](evidence/nightly-run55-native-runtime-package-20261003.json).
