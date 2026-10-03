# Nightly NSS/TLS guest gate preparation — 2026-10-02

The owned tools in `tools/nightly-nss-gate/` prepare exact static-root policy,
five deterministic TLS conditions, a raw PKCS#11 inventory probe and a
privileged Nightly159 browser driver. No guest, browser, fixture server, target
link or deployment was started. Preparation passes do not establish acceptance.

Evidence lives in
`/mnt/p6/build/firefox-nightly-nss-guest-gate-prepare-20261002`.
Selected `prepare-run2` replaces run1's unusable guest-loopback addressing;
both are retained. Fixtures use `nightly-nss-fixture.test`, with an owned QA
DNS/TCP mapping to host loopback. Random RSA keys are generated once and pinned;
the scenarios, serial sequence, validity dates and verification time are fixed.
The valid certificate expires October 1, 2027; actual transport runs after that
date require a newly reviewed fixture packet. No fixture CA enters production.

`expected-inventory.json` pins certdata
`beb7e6dfe6499926e52c075c27bcfbe4c957f8609c575b3860273ae2806f63eb`
and the bundled intermediate. It contains 173 exact DER/policy records, including
172 current certificates and 121 current TLS anchors. It retains absent, false
and distrust-date bytes separately, and maps source legacy trust enumerators to
Nightly's modern PKCS#11 values as the actual Rust generator does.

The actual target archive independently read after the build owner reported it
is 1,788,758 bytes, SHA-256
`5ada69e6a11b458c52bfb173f4755e3c3cb0981bcf1d727c968b90492c6b767b`.
All 19 object members have the native Wasm header. Their hashes and names are
in `trust-anchor-target-archive.json`. This establishes target compilation;
it does not establish the final browser link, loaded module or TLS.

To regenerate preparation in a new owned directory:

```bash
export TMPDIR=/mnt/p6/build/firefox-nightly-nss-guest-gate-prepare-20261002/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR"
export PYTHONPYCACHEPREFIX=/mnt/p6/build/firefox-nightly-nss-guest-gate-prepare-20261002/pycache
python3 tools/nightly-nss-gate/prepare.py prepare \
  --source /mnt/p6/build/firefox-nightly-musl-recovery-20261002/source/firefox-159.0a1 \
  --out /mnt/p6/build/firefox-nightly-nss-guest-gate-prepare-20261002/prepare-run3
python3 tools/nightly-nss-gate/test-preparation.py \
  /mnt/p6/build/firefox-nightly-nss-guest-gate-prepare-20261002/prepare-run3
```

The selected run passes 28 host preparation checks: exact policy contract,
ten raw-inventory mutations rejected, OpenSSL verification of the five fixed
conditions, certificate/key loading without sockets, and fixture DER/nonce
consistency. Eight Node checks pass for strict dynamic host CPU selection and
the isolated proxy transformation. Three Python, three JavaScript and one
current-header C syntax checks pass. C syntax checking uses the host parser;
it makes no target ABI or runtime claim.

After the sole full build has stopped and the complete Nightly package,
compiled identity, fpcast, trust-init and GPU-page report chain is validated,
the outer guest harness must do these steps:

1. Import `cpu-contract.mjs`; call `selectNssHostCpus` using the host browser's
   actual `navigator.hardwareConcurrency`, then set that returned count in
   machine settings before boot. Call `saveNssBootEvidence` immediately after
   each cold/update/warm kernel startup, before logs can be evicted. It requires
   exact nproc/browser/requested/selected/kernel agreement and refuses counts
   the UI cannot represent. Do not invoke historical two-CPU TLS runners.
2. Export the fresh profile before Firefox starts and prove cert9/key4/module
   files are absent; initialization must not copy the historical seed. Copy
   the driver, expected inventory and fixture JSON into an isolated guest home.
   Use the normal target NSS database creation path. For fixture installation,
   write `nightly-nss-owned-profile` inside that dedicated profile with the
   fixture root's exact SHA-256 plus a newline. Never put this marker in a user
   or production profile.
3. Explicitly run the finite fixture service only for the actual guest gate:

   ```bash
   python3 tools/nightly-nss-gate/serve.py \
     --fixtures /mnt/p6/build/firefox-nightly-nss-guest-gate-prepare-20261002/prepare-run2/fixtures \
     --out /mnt/p6/build/firefox-nightly-nss-guest-gate-prepare-20261002/endpoints.json \
     --seconds 600
   ```

   Apply `fixtureProxyOverlay(serverSource, endpoints)` to the owned QA server
   copy before starting it. This maps only the fixture hostname to reserved
   192.0.2.10, and only that destination plus the five announced ports to host
   loopback. Import the endpoint JSON into the guest. No production server edit
   is needed. Raw guest loopback cannot reach a host fixture.
4. In the **guest Firefox Browser Console**, import the copied system module
   and execute its asynchronous driver:

   ```javascript
   var nssGate = ChromeUtils.importESModule("file:///home/admin/nightly-nss/browser-probe.sys.mjs");
   await nssGate.run({
     expectedPath: "/home/admin/nightly-nss/expected-inventory.json",
     fixturePath: "/home/admin/nightly-nss/fixtures.json",
     endpointsPath: "/home/admin/nightly-nss/endpoints.json",
     outputPath: "/home/admin/nightly-nss/result.json",
     installFixtures: true
   });
   ```

   The inventory-only mode omits fixture paths and `installFixtures`. The
   fixture mode requires an empty/absent exception file, imports only the owned
   CA through `addCertFromBase64`, checks offline exact PRError values, actual
   TLS bodies/security/certificate identity and browser title/secure state or
   error-document URI. Each successful page title and visible heading carry
   its nonce. Capture guest framebuffer screenshots independently; a title
   check alone is not pixel evidence. Changing the CA to explicit distrust must
   invalidate previously successful verification and TLS in the same session.
   The driver leaves its fixture CA at zero trust for subsequent update/warm
   testing and saves a failure report before propagating any exception.
5. Link `raw-inventory.c` with the final browser's actual target trust-anchor
   objects and current NSS headers, under the owner's native Wasm/ILP32/SjLj
   recipe. That concrete link command awaits the final link inputs and must
   not be guessed from a host executable. Run the resulting probe **in the
   Linux/Wasm guest**, retain startup CPU evidence, object/binary hashes and
   stdout, and compare:

   ```bash
   python3 tools/nightly-nss-gate/prepare.py compare \
     --expected /mnt/p6/build/firefox-nightly-nss-guest-gate-prepare-20261002/prepare-run2/expected-inventory.json \
     --actual /mnt/p6/build/firefox-nightly-nss-guest-gate-prepare-20261002/raw-guest-inventory.json
   ```

   The probe calls the exact getter, opens the token normally, enumerates all
   objects, reads DER/hash/purpose/distrust attributes and rejects non-ILP32.
   It initializes with NULL rather than conflating NSS's extended initializer
   with the standard vendored layout. A direct-getter pass must also be bound
   to the browser's loaded module/token evidence; it does not alone prove the
   browser selected that module.

`snapshot` and `comparePreservation` check exposed existing DER, effective
SSL/email trust, module configuration and token password-presence metadata.
They do not distinguish explicit distrust from zero trust, prove raw key or
password metadata preservation, or identify which default module supplied a
deduplicated certificate. Export stopped SQLite databases, include sidecars,
run integrity checks and compare logical key/authentication/trust records for
the actual update gate. Independently audit partly missing databases, two fresh
profiles' SDR/key independence, inherited legacy explicit anchors and original
home/download/preferences evidence. Current default-root behavioral chains,
public HTTPS chains, policy distrust-date behavior, actual update/warm cache
effects and no-indirect-call-trap logs remain required and pending.

The older root seed, production defaults, existing profiles, public v10,
running build and user services are untouched. All driver results deliberately
retain `guestAcceptance:false`; only the complete independently reviewed
outer gate can establish acceptance and authorize the already approved release.
