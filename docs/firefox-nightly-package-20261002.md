# Isolated full Nightly runtime packaging

The new `tools/guest-rootfs/package-firefox-nightly.py` replaces every archive
record at or below `opt/firefox` with the newly built Nightly runtime. It never
substitutes a Nightly binary into the Firefox128 resource tree. Every other
newc record, its order, encoded metadata/body/padding, and the archive tail are
independently audited for exact preservation. It only writes a fresh directory
under `/mnt/p6/build/firefox-nightly-package-20261002`; it does not build,
promote, deploy, alter profiles, or edit live payloads.

Current status: preparation and synthetic tests pass; a real Nightly archive
has **not** been packaged. The actual build currently lacks `dist/bin/firefox`,
`application.ini`, and `platform.ini`. Actual fpcast and Wasm validation are
still required. No guest acceptance follows from this work.
The real read-only preflight confirms the honest missing-binary failure at
`/mnt/p6/build/firefox-nightly-package-20261002/missing-build-preflight-run1/result.json`;
its exact command and stderr are retained. No archive/output was created.

## Install adapter audit

The historical full build recipe is
`/mnt/p6/build/firefox-nightly-plan-20261002/port128-input/browser.nix`.
Its `installPhase` copied the entire `obj-wasm-browser/dist/bin` runtime, then
installed `defaults/pref/wasm.js` and exposed a launcher symlink. Its
`postFixup` stripped the binary and applied Binaryen `--fpcast-emu` with
`--pass-arg=max-func-params@23`. The binary-only `package-pbl-candidate.py`
cannot perform a full version upgrade.

The accepted public v10 input has 11,470 archive records, of which 7,614 are
at or below `opt/firefox`. Its browser modules are unpacked, so preserving old
modules or copying just a subset of Nightly files would silently mix versions.
The complete read-only source inventory is retained at
`/mnt/p6/build/firefox-nightly-package-20261002/baseline-inventory.json`.

These known-good records are preserved outside the replaced runtime:

| Record | SHA-256 |
| --- | --- |
| `init` | `413549e4d0156d3016ad9f39a2dd83f6aebaa44b05e40d3e296361be577422c0` |
| `bin/firefox` (symlink to `/opt/firefox/firefox`) | `bc15b55ad602804e3925b2f16d5327d162e99a686a82e3f9e84ca6e51e3232d0` |
| `etc/ssl/cert.pem` | `a511a02daa6829d3f3e47fe0098c23d071b9752b6695fa79a2796403c6a38fb7` |
| `nss-ca-profile/cert9.db` | `a7d2c5cd95ad5f38576f598b7065dfc1a9d47e384836053c73c15960611c9a67` |
| `nss-ca-profile/key4.db` | `b7f482f8f322b99b4489e8adfdf187db9a942dd777448f8156834cfe480b408e` |
| `nss-ca-profile/pkcs11.txt` | `e15f24b7fea8146f7fc15cfece5fb48b609909abde7481d94bb5adcea06df198` |
| `lowland-OpenSans-Regular.ttf` | `c53aceea2dcf5b4098099c0c4d0a061d17e178a049317b42a422b1a9f7f8eb59` |
| `lowland-userChrome.css` | `f45d88ae5fe04954cd0b379bf3eb0ac69f9ed892e354e33bc54302abe94757c6` |

All home/profile records and every other record outside `opt/firefox` receive
the same exact preservation check. The init's persistent-home marker and
launcher target are required. The old NSS seed's 119 roots are historical
evidence, **not** the expected count for Nightly159. Compare the seed against
the current source NSS certdata and audit the newly built static NSS adapter
before acceptance. Any required seed update is a separately scoped overlay;
never replace saved user profiles/home as part of this package operation.

The packager manages only four small guest defaults inside the fresh runtime:
`network.process.enabled=false`, `dom.ipc.processCount=1`,
`fission.autostart=false`, and
`layout.css.shared-memory-ua-sheets.enabled=false`. These are Firefox process
defaults; they do not select the Linux/Wasm CPU count. It verifies each key
exists in current source preference definitions and records their file hashes.
If the current Nightly runtime already has `defaults/pref/wasm.js`, unrelated
preferences and comments are retained; only the four managed keys are replaced.
Unrecognized syntax involving a managed key fails. No old runtime file is reused.
Compiled mmap/static-library/NSS/callback
adapters must come from the new build, with separate build/runtime acceptance.

Runtime symlinks into this build's source/object trees are materialized, including
directory links with cycle detection. Broken links, links outside those trees,
special files, special permission bits, and host task paths in text resources
are rejected. Installed directories use 0755; regular files use 0644 or 0755
according to their executable bits. No source ownership or host path survives
as a guest link. Application and platform version, local BuildID, and Hg source
stamp must agree with the hash-pinned source identity. The official reference
BuildID `20261002211853` is distinct from local BuildID `20261003042618`.

## Reproducible preflight and packaging

All task storage is disk-backed and below the dedicated task root, with a
2 GiB allowance and a 20 GiB free-space reserve. Preserve earlier run directories.
The commands below use fresh names; they intentionally fail until a full
runtime exists. Use this source identity and complete runtime, never an old
Firefox128 package:

```bash
export TMPDIR=/mnt/p6/build/firefox-nightly-package-20261002/scratch
export TMP="$TMPDIR" TEMP="$TMPDIR"
python3 -B tools/guest-rootfs/package-firefox-nightly.py \
  --source web/linux/initramfs-firefox.cpio.gz \
  --source-sha256 ce0d881dec8cea0728c5f513461f66de736c631c837e0e4c847cdf315c996745 \
  --manifest web/linux/boot-manifest.json \
  --manifest-sha256 45098057be07cbebfa9a99fe03a0a44e9ed437e4c4f15b36a96b6e5f4b3ff3dd \
  --source-root /mnt/p6/build/firefox-nightly-musl-recovery-20261002/source/firefox-159.0a1 \
  --object-root /mnt/p6/build/firefox-nightly-musl-recovery-20261002/obj-nightly \
  --runtime /mnt/p6/build/firefox-nightly-musl-recovery-20261002/obj-nightly/dist/bin \
  --source-identity tools/nightly-musl/evidence/source-identity.json \
  --source-identity-sha256 20052ba173eccfa41b036721bed8b14d42c17fe703d196855fcf9b55416561c3 \
  --inventory-only \
  --output /mnt/p6/build/firefox-nightly-package-20261002/preflight-real-run1
```

`preflight.json` gives the canonical `runtimeInventorySHA256`, source identity
hash and raw binary hash. The digest covers canonical JSON of every runtime
record's relative name, normalized mode, byte count and content hash; the human
readable `runtime-inventory.json` has different formatting. Recheck this frozen
inventory after strip/fpcast preparation; the packager rereads and verifies it
before and after packaging. The caller must review complete build success and
real command evidence; the packager checks evidence identity/freshness, not
whether a caller-created JSON statement is truthful.

Provide a reviewed `build-evidence.json` with this schema, replacing every
placeholder with actual evidence. Synthetic fixture reports are never build
evidence:

```json
{
  "schema": 1,
  "completeBuild": true,
  "sourceIdentitySHA256": "source-identity-file-sha256",
  "runtimeInventorySHA256": "canonical-preflight-inventory-sha256",
  "rawBinarySHA256": "dist-bin-firefox-sha256",
  "finalBinarySHA256": "final-fpcast-validated-binary-sha256",
  "commands": {
    "fullBuild": {"argv": ["python3", "mach", "build"], "exitCode": 0,
      "log": "/mnt/p6/build/owned-build/full.log", "logSHA256": "actual-log-sha256"},
    "fpcast": {"argv": ["wasm-opt", "--all-features", "--pass-arg=max-func-params@23", "--fpcast-emu", "RAW", "-o", "FINAL"],
      "exitCode": 0, "log": "/mnt/p6/build/owned-build/fpcast.log", "logSHA256": "actual-log-sha256"},
    "structuralValidation": {"argv": ["wasm-validate", "--enable-all", "FINAL"],
      "exitCode": 0, "log": "/mnt/p6/build/owned-build/validate.log", "logSHA256": "actual-log-sha256"}
  }
}
```

For the actual package, repeat the preflight command, remove `--inventory-only`,
use a new output name such as `candidate-real-run1`, and add:

```bash
  --binary /mnt/p6/build/owned-build/final-fpcast-validated-firefox.wasm \
  --native-binary plugin-container=/mnt/p6/build/owned-build/plugin-container.fpcast.wasm \
  --native-binary xpcshell=/mnt/p6/build/owned-build/xpcshell.fpcast.wasm \
  --build-evidence /mnt/p6/build/owned-build/build-evidence.json \
  --build-evidence-sha256 REVIEWED_EVIDENCE_SHA256
```

The three browser executables share the native XPTCall adapter and require
the same 23-slot fpcast ABI. `--binary` selects Firefox; repeat
`--native-binary NAME=PATH` for additional current-runtime executables. If
`plugin-container` or `xpcshell` exists in the frozen runtime, its transformed
override is mandatory. Other Wasm executables may use the same mechanism.
Resource files, missing paths, duplicate overrides, ELF inputs and replacing
Firefox through this additional option are rejected. The original `dist/bin`
inventory remains unchanged; only the installed archive uses the selected
finals, and the allowance counts their actual installed sizes.

For every additional override, extend the schema1 evidence with
`nativeBinaries[NAME]`, containing `rawBinarySHA256`, `finalBinarySHA256` and
`commands.fpcast` / `commands.structuralValidation`. These command entries have
the same argv, exitCode, log and logSHA256 fields as the main binary, including
the required 23-parameter fpcast flags. The evidence names must exactly match
the additional overrides. The packager pins every final input, rereads it while
writing the archive and rechecks its hash afterward. It independently audits
the complete archive and preserves every record outside `opt/firefox`.

Synthetic `fixture-run4` exercises36 checks, including independent exact helper
byte/mode checks, preservation of outside records, and negative controls for
missing/raw/swapped helpers, stale raw/final hashes, absent command proof,
changed validator logs and orphan evidence. New negative controls require their
specific diagnostic, preventing unrelated failures from counting as success.
This verifies the archive adapter; no actual Nightly packaging or guest
acceptance is inferred from synthetic fixtures.

The output includes the candidate archive, manifest, complete original and
final archive inventories, original runtime inventory, and `package-report.json`.
An identical `package.json` provides the narrow fields used by existing GPU
overlays/guest runners: `archiveSha256`, `bytes`, `version`, `sourceVersion`,
`sourceSha256`, and `sourceManifestSha256`. It retains `candidateOnly=true` and
`guestAcceptance=false`; compatibility never implies an old proof applies.
Only a successful report establishes packaging success. A failure may retain
a partial output as diagnostic evidence. The generated manifest keeps the
known-good kernel/plain asset descriptors and original asset URLs. Mount the
isolated task output and those unchanged assets appropriately in the QA server;
it is not a production URL/launcher and does not edit localStorage.

## Verification and remaining gates

Run the fixtures with:

```bash
python3 -B tools/guest-rootfs/test-firefox-nightly-package.py --run-name fixture-run3
```

The latest frozen run passes 20 checks:
`/mnt/p6/build/firefox-nightly-package-20261002/fixture-run2/result.json`.
The earlier 19-check run1 remains retained. The additional check covers merging
unrelated current-build defaults and compatible candidate `package.json` fields.
The fixtures verify old resource removal, nested fresh resources, every retained
encoded record and trailer, kernel manifest preservation, safe source symlink
materialization, broken/outside/cyclic links, host-path leaks, permission hazards,
manifest/stamp/evidence mismatches, missing binary, native ELF rejection,
23-parameter fpcast evidence and current-source preference definitions.
The tiny Wasm fixture and mock logs only exercise adapter validation; no real
fpcast, browser build, JIT or guest test is claimed.

After real packaging, use existing `package-firefox-gpu-check.py` as the
separately audited second stage to add the requested default version/WebGL/WebGPU
homepage and force-enabled GPU defaults. That stage must bind the new archive
and manifest hashes, not a Firefox128 candidate. Follow
`docs/firefox-default-gpu-page-20261002.md` for the overlay behavior.
Then audit Nightly resources and static adapters/NSS freshness, run actual
guest version and cold/warm/profile-preserving update acceptance, integrate
and accept native Wasm JIT, and finally accept guest GPU rendering. New guest
runners must select `nproc`/browser host CPUs and assert recorded kernel SMP
count agreement (currently eight). Packaging fixtures do not boot a guest and
cannot establish CPU or browser acceptance. Public Sites v10 and all local
production assets remain preserved until a validated successor passes the
authorized release gates.
