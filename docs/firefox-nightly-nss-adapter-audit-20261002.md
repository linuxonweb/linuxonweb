# Nightly static NSS trust adapter audit — 2026-10-02

Firefox 159 already has a static Rust trust-anchor module. Use that upstream
path, repair the narrow Wasm bindgen visibility issue, and let NSS initialize
fresh profile databases without copying Firefox 128's root seed. Do not reapply
the old `LOWLAND_NSS_ROOTS` patch. Existing profile trust remains intact; an
inherited trust store is not proof of current default-root freshness.

This packet establishes source paths, an isolated generation fix, native Wasm
C/Rust layout compatibility, and a source-specific init draft. It establishes
no complete browser, module-loading, guest TLS, release, or deployment result.

## Scope and evidence

Owned packet: `/mnt/p6/build/firefox-nightly-nss-adapter-audit-20261002`.
All scratch and outputs use its disk-backed `tmp` directory. Total packet size
when recorded was 16,317,623 bytes, within the 2 GiB allowance. The running
Nightly source and object trees were read only; isolated compilation used
separate output and a copied target JSON, without the owner's logging wrapper.
No browser, deployment, git mutation, or additional agent was started.

Source inspected:
`/mnt/p6/build/firefox-nightly-musl-recovery-20261002/source/firefox-159.0a1`.
Its acquisition is pinned by the current continuation to official build
`20261002211853`, Hg `dfc77f7a6d716f1a20a2576597638d4fc21cd916`.
`source-evidence-manifest.json` records the inspected source file SHA-256s and
draft hashes. It does not prove the whole-tree Hg/Git mapping or active build
completion.

## Actual current loading path

| Source location | Current behavior |
| --- | --- |
| `security/manager/ssl/nsNSSComponent.cpp:687` | Load task attempts external roots, then the static XUL path at line 732; failure remains `NS_ERROR_FAILURE`. |
| `security/certverifier/NSSCertDBTrustDomain.cpp:1677` | `LoadUserModuleFromXul` passes a function pointer to `SECMOD_LoadUserModuleWithFunction` and requires `userModule->loaded`. |
| Same file, line 1768/1771 | Declares `TRUST_ANCHORS_GetFunctionList` with C linkage and passes it to the static loader. This path does not call `PR_LoadLibrary`. |
| `security/nss/lib/pk11wrap/pk11pars.c:2344,2432` | `SECMOD_LoadModuleWithFunction` constructs the module and initializes slots; `SECMOD_LoadUserModuleWithFunction` adds it to the default NSS trust domain. |
| `security/nss/lib/pk11wrap/pk11load.c:691` | `secmod_LoadPKCS11ModuleFromFunction` invokes the getter, validates its return/function list, and calls normal module initialization. |
| `toolkit/library/rust/shared/Cargo.toml:98`, `shared/lib.rs:102` | `trust-anchors` is already included in the browser Rust library. |
| `security/moz.build:101` | C CKBI is intentionally disabled because the browser uses Rust CKBI; absence of `libnssckbi.so` is not itself a roots blocker. |
| `security/manager/ssl/trust_anchors/build.rs:326` | Builds the module from the pinned NSS `certdata.txt` plus `bundled_intermediates.txt`; rejects misplaced distrust dates. |
| `trust_anchors/src/pkcs11.rs:1050,1122` | Native PKCS#11 function table and exported getter; callbacks use `extern "C"`. The getter is `#[no_mangle] pub unsafe fn`, so actual linked Wasm signature must still be checked against C's pointer-in/`CK_RV`-out contract. |

The module returns read-only certificate/trust attributes, including purpose
trust and distrust dates. `trust_anchors/src/internal.rs:108` returns modern
`CKO_TRUST` and `CKA_PKCS_TRUST_SERVER_AUTH`. NSS's
`security/nss/lib/dev/devtoken.c:1067,1136,1161` handles modern and historical
trust objects; the classes must not be conflated in a database inventory.

Normal verification remains upstream:
`NSSCertDBTrustDomain.cpp:432` checks OneCRL, then NSS trust, including active
distrust (`CERTDB_TERMINAL_RECORD`); the chain distrust-date path is at line
1230. `CertVerifier.cpp:858` performs server verification and reaches
`CheckCertHostnameHelper` at lines 954/988. No proposed adapter bypasses these
checks, accepts an exception, or installs a blanket trusted leaf/root.

## Proven narrow bindgen repair

The active generated `pkcs11-bindings` output lacked `C_GetFunctionList` and
the types reachable from it. Wasm libclang's default visibility is hidden for
this declaration; vendored `bindgen/ir/function.rs:728` drops function cursors
unless visibility is `CXVisibility_Default`. This removes the allowlisted
function and its dependent PKCS#11 types.

`clang-visibility-run1.json` records read-only parsing with the actual libclang:
adding only `-fvisibility=default` changes the getter's visibility 1→3 while
keeping `CK_ULONG=4`, `CK_ATTRIBUTE=12`, `CK_FUNCTION_LIST=276`, alignment 4.

`bindgen-run2/result.json` runs an owned copy of the already compiled build
script against the current headers. Both arms generate successfully, but the
default arm lacks all six required declarations; the explicit-visibility arm
restores `C_GetFunctionList`, `CK_FUNCTION_LIST`, `CK_ATTRIBUTE`, `CK_SLOT_ID`,
`CK_BBOOL`, and `CK_UTF8CHAR_PTR`, with ILP32 layout assertions. The generated
fixed bindings SHA-256 is
`a4309cac6aa3affe6090edacc71f802efb632704874d280a3c868d28c2ad2550`.

The preferred repair is the owned Cargo environment adapter appending
`-fvisibility=default` to `BINDGEN_EXTRA_CLANG_ARGS` only for the Wasm target.
Keep host helper flags separate. No parser patch or x86 layout alias is needed.
The build owner reported applying this adapter and starting run10; this packet
does not claim that run's outcome. The initial isolated generation attempt
failed because its probe omitted `NO_NSPR_10_SUPPORT`; that failed output is
retained under `bindgen-run1`.

`layout-run2/result.json` passes 12 paired native Wasm C/Rust compile-time
assertions: widths, sizes, alignments, three `CK_ATTRIBUTE` offsets and three
`CK_FUNCTION_LIST` offsets. Version is offset 0, initialization pointer 4,
getter pointer 16. Rust additionally verifies
`CK_UNAVAILABLE_INFORMATION == u32::MAX`. The oversized generated literal is
already intentionally allowed/truncated by `pkcs11-bindings/src/lib.rs:5`;
it is not a compile blocker. Both objects have genuine Wasm magic, but were
not linked or executed. `layout-run1` retains a probe-only Rust field-spelling
failure (`type` instead of generated `type_`); its C assertions passed.

## Exact default-root freshness comparison

`root-freshness-run1.json` compares DER fingerprints and source trust policy
against the preserved key-free `prepared-seed-run2`, with read-only SQLite
integrity checks. The public local v10 archive is independently matched to
SHA-256 `ce0d881dec8cea0728c5f513461f66de736c631c837e0e4c847cdf315c996745`;
`public-v10-nss-records.json` confirms its three seed files exactly match that
preserved seed.

| Measure | Result |
| --- | --- |
| Current NSS certdata SHA-256 | `beb7e6dfe6499926e52c075c27bcfbe4c957f8609c575b3860273ae2806f63eb` |
| Current certificate/trust objects | 172 / 172 |
| Current TLS trusted-delegator roots | 121 |
| Preserved seed certificates / native trust rows / private objects | 119 / 119 / 0 |
| Identical certificate DER values | 118 |
| Seed certificates absent from current certdata | 1 |
| Current certificates absent from seed | 54, including four TLS roots |

The absent seed certificate is `lowland-ca-113`, Chunghwa Telecom ePKI Root
Certification Authority, SHA-256
`c0a6f4dc63a24bfdcf54ef2a6a082a0a72de35803e2ff5ff527ae5d87206dfd5`.
The shared Atos TrustedRoot 2011 certificate (`lowland-ca-010`) now has
`CKT_NSS_MUST_VERIFY_TRUST` for TLS, whereas the legacy seed grants CA trust.
Izenpe.com (`lowland-ca-063`) now has server distrust-after `260415235959Z`.
The four missing TLS roots are Telia EC/RSA TLS Root CA v3 and SECOM TLS
RSA/ECC Root CA 2024. The remaining differences include purpose-specific roots;
54 additions must not be described as 54 new TLS anchors.

The Rust module additionally bundles one intermediate certificate. Its actual
inventory therefore must account for that certificate without declaring it a
trusted TLS root. Counts alone cannot prove DER/purpose/date policy equality.

## Minimal fresh-profile packaging adapter

The v10 `/init` SHA-256 is
`413549e4d0156d3016ad9f39a2dd83f6aebaa44b05e40d3e296361be577422c0`.
Lines 193–199 copy each missing certificate/key/module database from the legacy
seed. Preserving those bytes in the initial Nightly packager is useful
historical protection, but does not establish correct fresh Nightly defaults.

The isolated `nightly-static-roots-init.draft.patch` replaces that exact copy
loop with the static-roots startup declaration and removes the ensuing
seed-specific `ls` and nonexistent fresh-DB arguments from `chown`. It leaves
existing profile database contents untouched. NSS creates its own fresh DB and
uses current static CKBI. `sh -n` passes the full draft; this is syntax-only
evidence. No archive was generated by this packet.

Apply this as a separate hash-pinned preparatory packaging stage before the
complete-runtime packager, checking the input init SHA, exact source block,
allowed changed record (`init` only), and all other encoded records. Bind the
modified input archive back to the original v10 archive in its adapter report.
The intermediate still has Firefox128 and must never be run or promoted on its
own; package the complete Nightly runtime before guest acceptance. This order
lets the full-runtime report truthfully assert preservation of its input init,
followed by the existing default-GPU-page overlay. The unused legacy seed
can stay inert in the archive for this minimal stage; explicitly prove startup
does not copy it. Do not change the system PEM bundle as a proxy for browser
trust, or copy independently missing pieces into a partial existing NSS DB.

For existing profiles, preserve all trust/distrust records, keys, password
metadata, custom CAs and module configuration. Historical bootstrap trust lacks
per-entry provenance: the nickname or equality to an old default trust value
cannot distinguish an unchanged bootstrap from the user's same-value choice.
Do not automatically remove or rewrite such entries. An exact pristine stopped
database pair can be recognized by the recorded whole-file hashes, but this
does not authorize broader nickname-based resetting. Report inherited explicit
profile trust separately from the current static default-root inventory.

## Real guest acceptance still required

Every new guest run records and asserts host `nproc`, browser
`hardwareConcurrency`, requested guest CPUs, and actual startup kernel SMP CPUs
agree (currently eight), before startup logs can be evicted. Pin the full
browser, fpcast, archive, runner, source certdata, adapter and profile evidence.

1. Verify the actual linked getter/function-table ABI and module startup through
   the guest browser, including cold and warm restarts with no `call_indirect`
   traps. Enumerate the loaded static module, token, certificate DER hashes,
   purpose trust and distrust attributes; compare exact policy with the pinned
   source and bundled intermediate. A loader-success log or 121-root count is
   insufficient.
2. In an isolated fresh profile, prove no seed database existed before Firefox
   started, NSS-created databases remain valid after shutdown, and current
   static defaults are effective. Exercise valid HTTPS from multiple real root
   chains. Capture final URL, response/body nonce, rendered browser content,
   secure transport state and guest logs; the host's own request is not proof.
3. Use deterministic owned HTTPS fixtures for valid, wrong-hostname, expired,
   unknown-issuer/self-signed, and bad-chain cases. For the trusted-chain cases,
   add only the fixture CA through target NSS in a dedicated test profile.
   Require the valid page nonce to render and each negative case to produce the
   appropriate certificate failure/interstitial without rendering its nonce.
   Use a separate authority/hostname or clean state to avoid cached success.
   Keep `cert_override.txt` absent/empty and never click through an exception.
4. In the owned update profile, create an explicit distrust choice and a
   zero-trust record, an independently added CA, and representative user data.
   Capture trust objects plus authentication metadata before/after actual
   update/reload. Require continued distrust failures and custom-CA success,
   preservation of keys/password metadata, downloads, preferences and home.
   Test both present and partly missing DB files: startup must never fill a
   missing piece with the old seed. Enumerate inherited legacy anchors honestly.
5. After changing trust through the normal browser/NSS interface, verify its
   trust cache is refreshed: a newly distrusted previously working chain must
   fail in the same session and after warm restart. Test current root policy
   fixtures, including distrust-after behavior where a deterministic chain is
   available; DER overlap is not behavioral proof.
6. Fresh profiles must independently generate their own SDR/key state; compare
   their key IDs/content without sharing keys. No new authenticated profile
   seed is required by the static route. If a later fallback is needed, rebuild
   it through this exact target NSS, derive its certificate/purpose/date policy
   from current source, remove all private/secret objects with secure deletion
   and vacuum, preserve necessary authentication metadata, and validate it in
   real target profiles before packaging. The hardcoded 119-root helper is
   historical and cannot establish a latest Nightly seed.

All those gates remain pending. The known-good public v10 runtime and profiles
remain preserved; this audit provides no new release acceptance.
