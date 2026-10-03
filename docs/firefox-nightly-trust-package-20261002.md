# Preparatory static Nightly trust bootstrap package — 2026-10-02

`tools/guest-rootfs/package-firefox-nightly-trust.py` applies the exact audited
Nightly fresh-profile `/init` adapter to a hash-pinned archive and manifest.
Run this preparatory stage **before** the complete-runtime
`package-firefox-nightly.py` stage, then apply
`package-firefox-gpu-check.py` to the complete Nightly archive. This ordering
implements the adapter described in the
[NSS adapter audit](firefox-nightly-nss-adapter-audit-20261002.md). The complete-runtime packager
preserves the modified init without requiring any implementation change.

The preparatory archive still contains the input Firefox128 runtime. Its init
now expects the future Nightly static Rust trust-anchor module. **Never boot,
promote, or deploy this intermediate archive alone.** Its successful report
means packaging only: `candidateOnly=true`, `runtimeAcceptance=false`,
`guestAcceptance=false`, `tlsAcceptance=false`, `browserRuntimeChanged=false`,
and `mustNotRunStandalone=true`. No guest or TLS test was run in this packet.
No active build/source, production asset, existing profile, or Sites file changed.

## Exact adapter and preservation

The accepted input init SHA-256 is
`413549e4d0156d3016ad9f39a2dd83f6aebaa44b05e40d3e296361be577422c0`.
The output SHA-256 is
`55d55013be46cb13541320943ef03c50a43580bf69dd5d4c425963a41a5d8803`,
identical to `nightly-static-roots-init.draft` in the NSS audit packet.

The adapter removes only the loop copying individually absent certificate,
key, and module databases from `/nss-ca-profile`, its old import log and
`ls`, and the three potentially absent DB arguments from `chown`. It adds the
audited static Nightly roots declaration. NSS must create fresh profile
databases through the real Nightly runtime. Startup does not fill partly
missing existing DB sets with old seed files. Existing profile certificates,
trust/distrust choices, keys, password metadata, and module configuration
remain untouched; inherited explicit trust is distinct from fresh static roots.

The unused old seed remains in the archive. It is not a fresh Nightly trust
source. Fonts, system PEM, launcher, all Firefox resources, home/profile data,
and every other encoded record remain identical. The tool preserves record
order, original names and their padding, metadata and body padding outside
init, and the entire decompressed archive tail. Only init body size changes
in its header; its remaining metadata and name padding are unchanged.
Gzip is regenerated deterministically with no filename and timestamp zero.

Unknown or already adapted init bodies, nonunique anchors, absent/duplicate
init records, hardlinked or nonregular init, malformed newc fields/names,
unsafe/aliased paths, input/manifest/system-asset hash mismatches, and unsafe
or existing outputs are refused. Repeated application is an explicit refusal,
not a silent success. `sh -n` checks the complete adapted init before writing.

All output is confined to
`/mnt/p6/build/firefox-nightly-trust-package-20261002`; all three scratch
environment variables must identify existing disk-backed directories there.
The tool enforces a 2 GiB task allowance and 20 GiB free-space reserve using
a conservative uncompressed output bound. It leaves failures as diagnostics
if a failure occurs after output creation; only a successful package report
establishes an audited candidate.

The output keeps kernel/plain manifest descriptors exact. Companion symlinks
point to the verified original system assets so the next packager can verify
the generated input manifest without duplicating or modifying those assets.
Only the Firefox asset hash/size/label and test version change; obsolete
`previous` rollout information is removed from this preparatory manifest.

## Actual preserved-v10 transformation

Output directory:
`/mnt/p6/build/firefox-nightly-trust-package-20261002/candidate-public-v10-run1`.

| Evidence | Value |
| --- | --- |
| Original v10 archive SHA-256 | `ce0d881dec8cea0728c5f513461f66de736c631c837e0e4c847cdf315c996745` |
| Original manifest SHA-256 | `45098057be07cbebfa9a99fe03a0a44e9ed437e4c4f15b36a96b6e5f4b3ff3dd` |
| Intermediate archive SHA-256 | `d2a42c0527df52ab1cc99640f8004cfbafc92d435f8b1bb518e4de6fa3ca748c` |
| Intermediate archive bytes | 88,910,823 |
| Intermediate manifest SHA-256 | `39977e3da733715113c131dadc6b15ee79d6cf79ff3f96ec89cdf8103cbc91cb` |
| Package report SHA-256 | `f86781a62c0f0caa7b2a4dc15c789c311940e520155656edbd00df928a468f64` |
| Packager SHA-256 | `b4b9ef7c6afc31ba6a2be0c03e337ec1fccde5058823e64e8146a21433465d81` |
| Total / unchanged encoded records | 11,470 / 11,469 |
| Modified records | `init` only |

The package produces identical `package-report.json` and compatible
`package.json`, before/after complete inventories, and both init scripts.
Reports bind original archive/manifest, original/adapted init, output
archive/manifest, packager identity, record preservation and scratch/storage.

An independent parser in
`/mnt/p6/build/firefox-nightly-trust-package-20261002/audit-real-run1.py`
compares every unaffected encoded byte while streaming both gzip archives.
It imports no packager parser and holds at most one MiB of browser body per
arm. Its 12-check audit passes at `audit-real-run1.json`; it rechecks public
v10 and manifest identity, unchanged browser/seed/font/home/system records,
init metadata, exact audited init body, record order/count, tail, shell
syntax, companion descriptors and referenced asset hashes, and retained
production inputs. The public archive has a zero-byte decompressed tail;
fixtures additionally verify a nonempty opaque tail and nonzero padding.
Total packet storage after the audit is 101,880,074 bytes, under the 2 GiB
allowance; free space was 84,101,971,968 bytes, above the 20 GiB reserve.

## Reproduction and chain binding

Use a fresh output name; the recorded candidate is intentionally never
overwritten:

```bash
export TMPDIR=/mnt/p6/build/firefox-nightly-trust-package-20261002/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR"
python3 -B tools/guest-rootfs/package-firefox-nightly-trust.py \
  --source web/linux/initramfs-firefox.cpio.gz \
  --source-sha256 ce0d881dec8cea0728c5f513461f66de736c631c837e0e4c847cdf315c996745 \
  --manifest web/linux/boot-manifest.json \
  --manifest-sha256 45098057be07cbebfa9a99fe03a0a44e9ed437e4c4f15b36a96b6e5f4b3ff3dd \
  --output /mnt/p6/build/firefox-nightly-trust-package-20261002/candidate-public-v10-run2
```

For the actual full-runtime packager, set `--source` to this stage's archive
and `--manifest` to its manifest, with the intermediate hashes above, plus
the genuine full-build/fpcast/validation evidence required by
[the full-runtime package documentation](firefox-nightly-package-20261002.md).
Use that tool's own task scratch environment and output destination. Its
`sourceArchiveSHA256` must equal this trust report's `archiveSHA256`, and its
`sourceManifestSHA256` must equal this trust report's
`outputManifestSHA256`. The GPU-default-page stage then binds the full-runtime
output archive/manifest hashes. Keep the trust report separately pinned so
the original v10 identity is preserved through all three stages.

The update test baseline remains the unmodified original v10 archive and
manifest, independently pinned. Do not use this prep archive as a bootable
baseline or as a full Nightly artifact. The baseline runner must consume the
complete Nightly→GPU package chain, and record the full package's modified
input hashes rather than incorrectly requiring the original v10 archive hash
there. Static NSS module ABI, current certdata/intermediate DER and purpose/date
policy, fresh-profile trust, and existing user-trust preservation need separate
real guest evidence bound to the full Nightly/browser/adapter/source identity.

Fixtures can be reproduced using a fresh run name:

```bash
python3 -B tools/guest-rootfs/test-firefox-nightly-trust-package.py \
  --run-name fixture-run2
```

The recorded `fixture-run1/result.json` passes 61 checks. It uses the retained
hash-pinned read-only v10 init and independently audited draft, synthetic
browser/system/seed/profile records, and deliberately nonzero padding. It
checks malformed records, duplicate aliases, unknown/repeated init, exact
metadata/body/tail/order preservation, absent partial-profile DB preservation,
input/manifest/system hashes, companion references, report truthfulness and
unsafe/existing output refusal. Both new Python files pass syntax parsing;
the adapted real init passes `sh -n`. These are packaging checks, not browser,
NSS loading, guest CPU, JIT, GPU, TLS, or deployment acceptance. Every eventual
guest run must select host-count CPUs and independently assert host/browser/
requested/kernel SMP count agreement as required by the continuation.
