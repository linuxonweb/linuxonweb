# Signed package generations (mode-specific acceptance)

The native helper is accepted and published for the small Android package console.
Native transaction, signature, identity, compatibility and crash-boundary gates
have passed, and the Firefox candidate passed actual GUI save/Stop/restart with exact
world, binaries and user data. Its final primary-route publication is tracked by the
integration acceptance report. Plain desktop optional installs and ordinary command
resolution remain unaccepted. The shell prototype is rejected and exits immediately;
image composition requires a native Wasm binary.

## User-visible contract

Standard `apk` changes the current guest session. The explicit persistent workflow
is `sudo apk-persist add PACKAGE...`, `sudo apk-persist del PACKAGE...`, or
`sudo apk-persist save` after ordinary native APK operations. A successful package
installation alone is not a persistence acknowledgement. The helper prints
`APK_PERSIST_SAVED` only after a complete generation and its activation pointer
have been committed. A failure leaves the previous complete generation available;
the running session may still contain changes from the attempted native APK operation.
Stop and Start restores the selected complete generation.

Persisted content is the exact signed package releases, their dependencies, the
installed package identities, and the exact APK world file. Package files and the
APK database are replayed together from signed archives. Manual changes to package
files or configuration outside `/home` are not captured. Package maintainer scripts
run again during replay. `/home` continues to persist independently. This is not a
general root-filesystem snapshot.

The four image-owned base packages (`apk-tools`, BusyBox, certificates, curl) cannot
be removed or replaced through this schema. Snapshot compatibility includes the
kernel, native APK and BusyBox binaries, full original installed database, canonical
base P/V/C identities, and exact signing trust. Resource-only Firefox image changes
can retain compatibility; ABI, base-package, or trust changes require an explicit
migration. An incompatible saved generation blocks desktop launch rather than
starting with a mixed package database and payloads.

## Transaction protocol

State lives in root-owned `/home/.linuxonweb-packages`. The helper requires a real
`virtiofs` mount at `/home`; it never acknowledges an ephemeral substitute. It uses
an independent native lock and shares APK's database lock while capturing inventory
and world. It validates native APK/BusyBox identities and the exact trust-key set.

A generation contains signed optional APK archives, `installed` (sorted P/V/C),
`world`, `compatibility`, and a SHA256 manifest. Native APK signature verification
and native `apk index` bind each archive to the installed checksum, including a
same-name/version rebuild. APK2's default `fetch` takes names, so the helper fetches
by name and then requires the installed filename and exact native P/V/C identity;
a newer or rebuilt archive cannot silently replace the installed release.

Every generation file and directory is flushed before its staging directory is
renamed. The previous pointer is retained before a fully written temporary active
record is atomically renamed into place. Generation names are never reused or
modified by the helper. The current strict HomeFS implementation commits each
IndexedDB operation before acknowledging it; its fsync is therefore a no-op after
those commits. No experimental write buffering, cache seeding, or packed Firefox
resources are enabled.

Replay verifies the pinned manifest, exact file set, hashes, signing trust,
compatibility, archive signatures and P/V/C identities before installing anything.
It requires the pristine image database and uses `--no-network` plus an empty
repository list. After the real native install, it checks the entire installed
P/V/C inventory, restores the exact world, and checks the offline solver before
printing `APK_PERSIST_RESTORED`. Desktop launch follows that success.

The helper uses checked native file operations, `posix_spawn`, and child exit
statuses. Each APK operation runs in an owned process group. On timeout or signal,
that group receives TERM and KILL before the leader is reaped, so its identity
cannot be reused during cleanup. This cleanup guarantee covers timeout/cancellation;
a package script that intentionally starts a background daemon on ordinary success
is not claimed to be sandboxed. Individual child and overall 300-second operation
bounds are explicit. Limits are 128 optional packages, 256 MiB archive generation,
4 MiB metadata, and a 2 MiB native stack. Archives are retained without automatic
pruning, so repeated full generations consume persistent storage.

## Explicit recovery

If replay fails, startup stops at a native recovery console and preserves evidence.
Run `apk-persist disable`, then use the browser's Stop and Start controls. Disable
renames even a malformed active pointer into a unique evidence file; it does not
parse a corrupt generation or require intact base metadata. All generation
payloads and the prior pointer remain. `apk-persist previous` validates and selects
the prior generation when present; it takes effect after Stop and Start. An explicit
`packages.base=1` boot also skips replay while retaining saved data.

## Current evidence

- The real guest passed 34 prerequisite checks: file/directory fsync, rename and
  old-open-inode semantics, exclusive create, write errors, observed positive short
  writes, native spawn error/exit propagation, process-group setup, and concurrent
  nonblocking lock exclusion. The first probe failed only to induce a short write
  with a 1 MiB request; the bounded 2 MiB repeat observed 1 MiB written and read back.
- Five fresh guest boots passed 39 checks using exact APK4 base package files and
  database, real persistent HomeFS, and no network device after the first boot.
  Signed tar+gzip add/save, offline restore with exact world, removal/new generation,
  removal restore, corrupt archive rejection before replay, explicit disable, base
  recovery, and user-data retention passed.
- Helper timings in that component fixture: tar+gzip save 2.608 s and restore 1.977 s;
  post-removal gzip save 3.242 s and restore 1.373 s. These are not full desktop startup
  times. The five-boot owner ran 52.008 s with 1 s CPU/RSS/RAM/quota and 5 s PSS sampling.
- `persistence-native-fiveboot-20261103-1322.json` and
  `persistence-primitives-20261103-1322.json` in `evidence/` retain exact source,
  native binary, image, and result identities, including failed first attempts.

These initial component results were followed by the safety gates below and the
integration agent's actual Firefox candidate save/Stop/restart gate. Component times
do not establish full desktop startup or mobile usability. The distinct mode gates
and publication status below remain authoritative.

## Further native safety gates (2026-11-03 15:22 UTC)

The exact default production helper passed 54 additional checks across three fresh
boots. A real failing maintainer script returned failure without advancing the
active generation. The helper rejected a bad RSA signature even after the test
recomputed all SHA256 manifests; it also rejected a validly signed archive with the
same name/version and a different native C identity. The latter fixture changes
control metadata while retaining the original executable payload. Compatibility,
trust-set, and protected-world changes were rejected. A malformed active pointer
was preserved by disable, and a verified prior generation was selected and replayed
offline. Native owner time was 71.028 seconds. See
`evidence/persistence-native-negatives-20261103-1322.json`.

Separately, an explicitly instrumented native helper passed 22 assertions over
three boots. Compile-time-only hooks stopped it before activation and immediately
after active-pointer rename, before directory fsync and the success acknowledgement.
A native supervisor killed and reaped only its known isolated child group. A fresh
boot retained the prior generation in the first case and replayed the new complete
generation in the second. Native owner time was 37.008 seconds. This is process-kill
boundary coverage, not a hardware-power-loss claim. Rebuilding the default helper
from the source with those hooks compiled out produced byte-identical production
bytes (`be3214abafca8d28d7d5c46f18f17af887cda82c4651940a099bea689b06a3b8`).
The instrumented binary must never be deployed. See
`evidence/persistence-interruption-20261103-1322.json`.

## CPU quota qualification during this continuation

The earlier native functional receipts remain observations of exact signed package bytes and helper behavior. Their owner monitor sampled only the root child CPU ancestor; it did not establish that every browser process shared that ancestor. The package smoke harness also used three-CPU affinity, which is not a substitute for a common capped ancestor. Those durations are not matched-performance acceptance.

The revised owner requires one shared ancestor capped at no more than three CPUs for every observed live owned process, unions child lists from all threads, rejects unreadable live inventories and observed cgroup migration, and retains PID/start identity during cleanup. Fourteen focused regression checks passed. The representative recheck passed 164 functional checks across nine fresh native boots in 128.292 seconds, with 128 valid common-cap samples and zero survivors: GNU 71, helper positive 39, critical negative 54. See `evidence/shared-cap-native-recheck-20261103-1322.json`. This does not expand Firefox, Android or plain-mode acceptance.

## Browser route status before final acceptance

The Firefox candidate uses the exact native helper and APK4 package base. Its actual
GUI save acknowledgment was followed by normal Stop in 88.631 ms; a fresh production
browser launch restored the exact generation, world, tar/gzip bytes and a home marker.
The earlier whole-browser quota qualification still applies to that timing receipt.
The revised common-cap native transaction recheck above independently passed.

The plain desktop candidate replaces only eight verified signed base payload members,
adds the current APK alias, accepted native sudo and helper metadata, archives six
legacy registry/launcher files, and preserves 3,834 unmanaged records byte for byte.
Its base-only recovery/desktop gate passed. Optional package installs and ordinary
nonroot command selection have not passed. In particular, legacy BusyBox aliases may
precede installed GNU commands in the original `/bin`-first PATH. Native sudo supplies
a protected `/usr/sbin:/usr/bin:/sbin:/bin` PATH, so a sudo-only branding test cannot
prove the ordinary terminal behavior. The deferred `plain-production-check.sh`
separates privileged no-force installation from a real uid-1000 PATH/branding phase;
no unverified alias deletion, force overwrite or image PATH change has been made.

The small console candidate retains one CPU and 512 MiB on the actual MI8 / Android 15
/ Brave Chromium 148 device. The first corrected persistence attempt installed signed
Python 3.14.6 in 30.596 s, ran native imports in 4.465 s and saved a signed generation in
32.047 s. Physical Stop completed 555 ms after the save acknowledgment, and all owned
worker targets disappeared. Replay later emitted the same generation acknowledgment
with `offline=1 exactWorld=1` in 4.284 s, but the frontend had mistaken an APK progress
bar ending `# ` for a prompt and enabled input too early. That full gate failed before
restored hashes, world and imports were checked. The source now requires the exact
initial native prompt; three focused progress/chunk/replay tests and independent
review passed. The final immutable bundle and actual device acceptance are recorded below.
See `evidence/android-persistence-20261103-1322.json` for all retained attempts,
actual sample intervals and scoped cleanup. The first two attempts remain failures;
no full Firefox-on-Android or iOS acceptance follows from a console pass.

When the console manifest includes the verified helper, its Python button is labeled
"Install, save & check Python" and executes `apk update`, `apk-persist add python3`,
and real native Python imports in sequence. Ordinary `apk add` is session-only until
an explicit successful `apk-persist save`; the candidate page explains this contract.

## Accepted Android console and publication (17:35 UTC)

The final actual-device owner ran from 17:32:55.637 to 17:35:33.716 UTC (158.079 s),
with one guest CPU and 512 MiB, common capped host ancestry throughout, no errors,
and zero remaining owned host processes. It verified authenticated served bundle
hashes and the actual HTTPS kernel hash before Start. The prompt fix remained
unready during replay progress and enabled input at the actual native prompt.

Signed Python 3.14.6 installation took 30.773 s (180 s test bound); real native JSON,
zlib, hashing and certificate-store imports took 3.934 s. The save command took 31.788 s,
and physical Stop completed 674.738 ms after acknowledgment. A new guest in the same
owned persistent home replayed the exact saved generation offline in 3.826 s of helper
time; Start-to-real-prompt observation was 19.320 s. Native status verified the saved
signed generation, and binary/stdlib ZIP/world hashes, installed Python state and a
home marker were unchanged. Restored native imports passed in 4.110 s. Both normal
Stop operations left zero owned worker targets; exactly two worker blobs were created
and revoked. The owned phone tab and ADB mapping were removed without touching other
tabs, mappings or app processes.

The default console now serves those exact tested bytes: new console bundle
`7ffafa012c9072c31e4d0946863fa56ad3a64b9197002e513c922d417d4000a6`, unchanged
worker `81f46bbca8d06843b50ea2fea18e0dab6d30516a398988a7c0761c4eb66c9445`,
and unchanged small helper image
`60be177eb68336db15f85129676a5f15a8544139e747272ca633cc8d4e82be74`.
Each promoted file was atomically replaced with directory fsync, HTML last; previous
bytes and symlink metadata were retained. All six actual production upstream files
matched their length and SHA256 readbacks. The existing authenticated HTTPS route is
`/linux/packages/v1/package-shell.html?cpus=1`; no access policy or server process
was changed. The exact build metadata retains its earlier candidate labels as
provenance; `evidence/accepted-mobile-artifacts-20261103-1322.json` and
`evidence/mobile-publication-20261103-1322.json` record subsequent acceptance.
