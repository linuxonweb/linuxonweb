# Nightly NSS outer guest runner preparation — 2026-10-03

`tools/nightly-nss-gate/run-guest.mjs` extends the existing baseline runner's
exported `runIsolatedNightlyGuest` lifecycle. Importing either module does not
start a browser. The original baseline CLI, package admission, ownership,
affinity, exact startup/final CPU checks, bounded waits, storage reserve and
cleanup predicates are retained. The NSS overlay is applied after the owned
server's socket tracking, so fixture connections participate in cleanup.

This is unexecuted guest preparation. It does not establish NSS, TLS, browser,
JIT, GPU or release acceptance. `tlsAcceptance` and `releaseAcceptance` remain
false even when the private fixture diagnostic passes.

After the build has stopped and real packages are independently reviewed, run
with the baseline runner's candidate/report options and the following additional
options. All report hashes must identify independently reviewed real files:

```sh
NSS_TASK=/mnt/p6/build/firefox-nightly-nss-guest-gate-prepare-20261002
TMPDIR="$NSS_TASK/tmp" TMP="$NSS_TASK/tmp" TEMP="$NSS_TASK/tmp" \
node tools/nightly-nss-gate/run-guest.mjs \
  --out "$NSS_TASK/cold-warm-real-run1" \
  --candidate REVIEWED_GPU_PAGE_PACKAGE \
  --overlay-report-sha256 REVIEWED_OVERLAY_REPORT_SHA256 \
  --nightly-package REVIEWED_FULL_NIGHTLY_PACKAGE \
  --nightly-report-sha256 REVIEWED_FULL_PACKAGE_REPORT_SHA256 \
  --mode cold-warm \
  --fixtures "$NSS_TASK/prepare-run2/fixtures" \
  --fixtures-sha256 REVIEWED_FIXTURES_JSON_SHA256 \
  --expected "$NSS_TASK/prepare-run2/expected-inventory.json" \
  --expected-sha256 REVIEWED_EXPECTED_INVENTORY_SHA256 \
  --trust-report REVIEWED_INIT_ADAPTER_REPORT \
  --trust-report-sha256 REVIEWED_INIT_ADAPTER_REPORT_SHA256
```

The finite fixture service starts only after shared active-build/package/system
asset admission. It verifies the fixture file manifest and current source
inventory pins. Its hostname/address/port overlay applies only to the owned QA
server. The wrapper stops that exact fixture child in `finally` and records its
exit, output and closed-port checks separately, updating the final result on a
cleanup failure. The service has an independent 1800-second lifetime; unusually
slow runs fail rather than silently extending its lifetime.

Before Firefox starts, the private persistent home contains driver/fixture
files and an owned-profile marker, while cert9/key4/module/exception files are
proven absent, including each database's WAL, SHM and journal sidecars. The
browser creates its own NSS databases. Real guest keyboard events invoke a
small privileged ES module through Browser Console. The driver imports the
current `Timer.sys.mjs` exports explicitly and starts an async function after
synchronous module evaluation; `ChromeUtils.importESModule` does not support
top-level await. A process-local `resource://nightlynss/` substitution maps only
the owned guest driver directory; current system-module admission rejects a
direct `file://` import. Five TLS
cases check exact offline and live transport errors, certificate identity,
body nonce, and browser secure state or error-document URI. Every visible case
waits for the outer framebuffer screenshot and a matching nonce/hash
acknowledgement; screenshots still require independent pixel review.

After the five cases, target NSS creates an SDR secret and saves its ciphertext.
The private profile stores an explicit distrust choice, a custom trusted CA and
a zero-trust leaf record. Subsequent boots verify the retained ciphertext through
target SDR, distrust failure and custom-CA success before changing saved trust.
The runner requests `eAttemptQuit`, requires its actual exit-status-zero log, then
exports the stopped databases with WAL/SHM/journal sidecars. `sqlite-audit.py`
checks integrity and exact logical table/schema hashes, including key and
authentication records. It reads private copies with the original WAL because
SQLite `mode=ro` may still create or alter SHM files, and verifies the original
exports remain unchanged. Whole-file inequality does not imply data loss.
The saved SDR ciphertext and trust identifiers must also remain identical.
NSS phases leave baseline download preservation unestablished (`null`).

Use independent invocations for all required modes:

- `cold-warm`: fresh database creation, five TLS conditions and saved-state warm
  restart. A second invocation with `--compare-fresh FIRST_RESULT_JSON` requires
  the same browser/fixture inputs, distinct owned host profiles, complete
  cold/warm phases, retained no-database/no-seed proof, successful prior browser
  and fixture cleanup, and different logical key state/ciphertext.
- `update-warm`: append the shared pinned `--baseline`, archive and manifest
  options plus `--baseline-firefox-version 128.14.0`. It creates private user
  state with the baseline, uses the actual Update & restart action, then checks
  current Nightly and warm preservation. Current-root inventory is deliberately
  omitted on the Firefox128 baseline and remains required on Nightly gates.
- `missing-module`: after a stopped cold run, remove only its own NSS-created
  pkcs11.txt and verify the retained trust/key/auth logical records after restart.
- `missing-cert`: after a stopped cold run, remove only its own cert9.db. Require
  no remaining cert9 sidecars before removal, unchanged pkcs11.txt, retained
  SDR/key/auth logical records and absence of the deliberately removed private
  trust records; this phase does not claim preservation of deleted trust.

Real execution may expose API, console-focus, package-init or database-lifecycle
differences; preparation checks cannot prove those paths. Remaining required
gates include the actual guest raw PKCS#11 inventory probe linked to the final
selected trust-anchor objects, binding that result to the loaded browser token,
current default-root/public HTTPS behavioral chains, distrust-after fixtures,
independent screenshot review, and combined review of every profile mode.
`tools/nightly-nss-gate/raw-inventory.c` still needs its concrete selected-object
target link and guest execution. No production profile, package, public v10,
Site, active build source/recipe/output or user service is changed here.

Independent preparation review retains 43 baseline synthetic checks, 38 runner
and privileged-module controls (including the nine fixture admissions), and 12
SQLite controls under
`/mnt/p6/project/build/nightly-nss-runner-review-20261003`. These verify import
safety, corrected API usage and admission/persistence semantics without a
browser launch. They do not establish actual guest behavior or release acceptance.
