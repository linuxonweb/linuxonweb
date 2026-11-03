# Signed package generations (native candidate)

The native helper is a candidate, with real native component validation. It is
not accepted for production until actual browser Stop durability and the remaining
signature, identity, compatibility, and interruption gates pass. The shell prototype
is rejected and exits immediately; image composition requires a native Wasm binary.

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
is not claimed to be sandboxed. Individual child and overall300-second operation
bounds are explicit. Limits are128 optional packages,256MiB archive generation,
4MiB metadata, and a2MiB native stack. Archives are retained without automatic
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

- The real guest passed34 prerequisite checks: file/directory fsync, rename and
  old-open-inode semantics, exclusive create, write errors, observed positive short
  writes, native spawn error/exit propagation, process-group setup, and concurrent
  nonblocking lock exclusion. The first probe failed only to induce a short write
  with a1MiB request; the bounded2MiB repeat observed1MiB written and read back.
- Five fresh guest boots passed39 checks using exact APK4 base package files and
  database, real persistent HomeFS, and no network device after the first boot.
  Signed tar+gzip add/save, offline restore with exact world, removal/new generation,
  removal restore, corrupt archive rejection before replay, explicit disable, base
  recovery, and user-data retention passed.
- Helper timings in that component fixture: tar+gzip save2.608s and restore1.977s;
  post-removal gzip save3.242s and restore1.373s. These are not full desktop startup
  times. The five-boot owner ran52.008s with1s CPU/RSS/RAM/quota and5s PSS sampling.
- `persistence-native-fiveboot-20261103-1322.json` and
  `persistence-primitives-20261103-1322.json` in `evidence/` retain exact source,
  native binary, image, and result identities, including failed first attempts.

Actual production decompression/composition/desktop, Stop immediately after the
success acknowledgement, signed same-version replacement, recomputed-manifest
signature tampering, ABI/trust mismatch, interrupted activation, larger Python
replay, and mobile persistence still need their own passing evidence.
