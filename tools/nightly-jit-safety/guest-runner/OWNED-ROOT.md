# Owned disk roots for native Firefox sessions

This route supports an explicit, currently owned build directory when a historical
`/mnt/p6/project/build` task is unavailable. It prepares or supervises the existing
native Firefox guest protocol. It does not grant build approval, resource admission,
review provenance, or native acceptance. Do not start a browser until the candidate
and every existing independent review gate are complete.

## Path contract

A task root is a direct child of one of the fixed build parents:

- `/mnt/p6/project/build`
- `/mnt/p6/build`
- `/mnt/p3/codex-build`

The parent and task root must exist, resolve canonically without symlink aliases,
be directories owned by the actual UID, and not be group/world writable. The task
root must remain on its parent's filesystem. tmpfs and ramfs are refused. Output
paths must be strictly inside that root; every intermediate directory must satisfy
the same ownership, canonical-path and filesystem checks. Existing outputs,
including dangling symlinks, are refused. Check-session outputs are created
exclusively. Python optimization is refused because it would remove existing
assertion-based supervision and acquisition gates.

This is not permission to enter, chmod, chown, or reuse a root owned by another
user. In particular, an inaccessible historical `/mnt/p6/build` is not a fallback.
The historical default preparation and repository paths remain unchanged; a
missing or unowned default fails closed. Use explicit paths for a current run.

`--repo` is optional on the supervised broad runner and defaults to the historical
repository. An explicit repository must be a canonical, actual-UID-owned disk
directory without group/world write permission. Its exact path must match
`launch.repo`, and `launch.serverSource.path` must name that repository's
`web/desktop/dev-server.mjs`. The implementation root is independently pinned to
the directory containing the executing runner; changing the repository argument
does not change that implementation identity.

## Run layout

Use separate roots for small preparation work and an admitted runtime. Choose new
names for a new candidate or a changed binding; do not reuse previous outputs.
Keep the source checkout, binaries and package archives outside the runtime root.

| Location | Contents and limit |
| --- | --- |
| Owned repository/worktree | Reviewed runner and server sources; no shared-checkout edits |
| Owned candidate build/package directory | Completed candidate, manifest, kernel/plain image inputs and actual terminal/build receipts |
| `/mnt/p3/codex-build/<candidate>-guest-prep` | `t/`, disabled/enabled preparations, reviewed records; existing 256 MiB preparation cap |
| `/mnt/p3/codex-build/<candidate>-guest-run` | `t/`, fresh direct-child outputs such as `disabled-run/` and `enabled-run/`, supervisor logs/status; admitted 4 GiB runtime cap |

Create both roots and their `t/` children as the actual user, with mode `0700`.
Never create the arm output directories in advance. Set `TMPDIR`, `TMP`, and `TEMP`
to the corresponding root's canonical `t/` directory and set
`PYTHONDONTWRITEBYTECODE=1`. Keep the existing minimum 20 GiB free-disk reserve.
The runtime allocation must account for actual kernel, plain and Firefox image
sizes, browser profile/home/cache and logs. Inputs remain pinned in their existing
owned location; the route does not admit an additional package/source copy.

All project commands still use the authorized rubywebterm workspace. The snippets
below describe arguments for that execution context; they are not evidence that
a live invocation is admitted or has run.

## Candidate and review dependencies

1. **Finish and independently review the actual build.** Keep the real final-link
   terminal receipt, natural exit/reap/physical group-empty evidence and package
   receipts. Resolve the source/toolchain/ABI closure and record the candidate's
   actual final binary, package, manifest, kernel and 14-digit local BuildID. The
   build binding must use `caller-reviewed-full-nightly-jit-build-binding-v1`,
   `wasm32-linux-musl`, `159.0a1`, environment slot count 23, broad coverage and the
   restart-only `javascript.options.portable_baseline` preference. Its nine
   required SHA-256 values remain: final binary, archive, runtime manifest, kernel,
   build review, PBL observer, interpreter observer, worker option observer and
   startup option observer. A pending or partial build is not a binding.
2. **Prepare both same-binary arms.** From the reviewed implementation root, run
   `run-broad-session.mjs --prepare` with an explicit preparation task root,
   a fresh output, a unique label, an arm and the reviewed binding path/hash.
   Missing binding is allowed only to prepare a pending host artifact; it leaves
   `guestAcceptance:false`, no verified build identity and no browser admission.
3. **Review the implementation and package adoption.** Pin every executing file
   required by `preflight()`, including both new parent-directory policy files
   `owned-paths.mjs` and `owned_paths.py`. Preserve the exact implementation root,
   executable window-observer pin, standard AutoConfig defaults/config pins,
   actual init capture-adoption review and original native binary identity.
   `implementation.frameObserver` must retain kind
   `existing-owned-worker-stall-frames-v1`, be present in `implementation.files`
   with the same path/hash, and export `createStallFrameDiagnostics`. Its canonical
   file is now imported from that reviewed record, with hashes checked immediately
   before and after import. There is no hardcoded import of the absent historical
   frame-observer file. A test stub is not a runtime observer.
4. **Review the exact launch and resource plan.** The launch must bind the current
   repository, runtime task, candidate inputs, both preparations, exact served
   runtime files, package sizes/allocation and owned build roots. Complete an
   independent `caller-reviewed-nightly-broad-runner-prelaunch-v1` review pinning
   the exact launch and implementation digests, including real
   `noActiveOwnedBuild:true` and `freshFinalLinkTerminalReapedEmpty:true` evidence.
   No generated template or test fixture supplies these facts.
5. **Admit the whole process tree before execution.** Preserve the common ancestor
   capped to at most three CPUs, the hard 150-second session deadline and the
   existing resource/identity monitoring. The supervisor retains its 170-second
   outer bound, 10-second natural-drain bound, 12 GiB group RSS ceiling, 4 GiB
   available-RAM floor, 2 TiB address-space limit, zero core limit and OOM score
   adjustment. CPU/RSS/available-RAM telemetry and PSS sampling remain required by
   the launch review. The path helpers and `--repo` option do not provision a CPU
   quota or substitute for that review. A browser is prohibited while an owned
   build is active.

Example preparation arguments, after setting these variables to independently
verified canonical paths and hashes:

```sh
node "$REPO/tools/nightly-jit-safety/guest-runner/run-broad-session.mjs" --prepare \
  --task-root "$PREP_TASK" --out "$PREP_TASK/disabled" \
  --label "$DISABLED_LABEL" --arm disabled \
  --binding "$BUILD_BINDING" --binding-sha256 "$BUILD_BINDING_SHA256"
node "$REPO/tools/nightly-jit-safety/guest-runner/run-broad-session.mjs" --prepare \
  --task-root "$PREP_TASK" --out "$PREP_TASK/enabled" \
  --label "$ENABLED_LABEL" --arm enabled \
  --binding "$BUILD_BINDING" --binding-sha256 "$BUILD_BINDING_SHA256"
```

Only inside the reviewed common resource ancestor, with the completed independent
records and runtime scratch environment, the supervised invocation is:

```sh
python3 "$REPO/tools/nightly-jit-safety/guest-runner/supervise-broad-session.py" --run \
  --repo "$REPO" --task-root "$RUN_TASK" \
  --out "$RUN_TASK/disabled-run" --arm disabled \
  --launch "$LAUNCH" --launch-sha256 "$LAUNCH_SHA256" \
  --implementation "$IMPLEMENTATION" --implementation-sha256 "$IMPLEMENTATION_SHA256" \
  --prelaunch-review "$PRELAUNCH_REVIEW" --prelaunch-review-sha256 "$PRELAUNCH_REVIEW_SHA256"
```

Use the separately reviewed `enabled` arm and fresh `enabled-run` output for its
invocation. Do not invoke `--run` directly with Node. Re-pinning paths or changing
any implementation/input bytes invalidates the prior matching review; have the
changed concrete records reviewed before launch.

## Native evidence remains required

The captured process is native Firefox inside the Linux guest. The host Chromium
browser transports/observes that guest; host JavaScript timings are not Firefox
performance evidence. Keep the full append-only native log, exact parent/worker
startup and observer records, application/platform identity, scope outcomes,
actual native PID/PGID/SID/start ticks and native exit record. The log boundary
remains 2 MiB, and rotation/truncation is a failure. Preserve the numeric startup
option evidence, interrupt/cancel/abort/recovery contract, native exit status 0,
reaping and physical process-group/session emptiness, including zombies. Forced
cleanup never earns a pass.

Capture production and its `pass:false` acquisition template do not replace an
independent acquisition review. Only that review plus the existing production
`check-session.py` gate can validate a session. Full JIT, useful compiled work,
bytecode mapping, performance and GPU claims still need their separate evidence.
No probe thresholds, coverage cases or acceptance predicates change here.

The original benchmark also accepts the owned task root and repository through
its existing `prepare.py --repo --task-root --out --label --option --cpus --build-id`
interface. It still binds the original fixture and its nine producer files;
follow `../original-benchmark/INTEGRATION.txt` for the genuine native launch and
ABBAAB/performance evidence. An owned-root preparation is not a benchmark run.

## Reproducible host checks

Use a fresh owned disk task root with `t/` and the scratch environment described
above. The host checks never launch Chromium or a Firefox guest:

```sh
python3 tools/nightly-jit-safety/test_owned_paths.py --task-root "$CHECK_TASK"
node tools/nightly-jit-safety/test-owned-paths.mjs "$CHECK_TASK"
node tools/nightly-jit-safety/guest-runner/test-runner.mjs \
  --task-root "$CHECK_TASK" --repo "$REPO"
python3 tools/nightly-jit-safety/guest-runner/test-supervisor.py \
  --task-root "$CHECK_TASK" --out "$CHECK_TASK/tiny-process-group.json"
```

On 2026-11-08, the focused checks passed: 23 Python path-policy cases, 26 JavaScript
path/pinned-observer cases, 69 existing runner fault cases, five actual tiny
process-group cases, and 11 preparation/rejection smoke cases. The tiny process
owner exited naturally, reaped its child and left its physical group empty. The
smokes prepared pending main/copied artifacts, refused an existing output without
overwriting it, refused missing acquisition review, and prepared/validated the
original benchmark interface. Browser launches and native acceptances were zero.

Receipts are under the owned host-check directory
`/mnt/p3/codex-build/linuxonweb-firefox-jit-20261108-owned-route-test-2`:
`python-path-tests/report.json`, `js-path-tests/report.json`,
`runner-contract-tests/host-checks.json`, `tiny-process-group-fixed.json` and
`preparation-smokes.json`. These are host receipts, not review artifacts.

## Retained final159 baseline: what is verifiable

A bounded one-CPU static inventory on 2026-11-08 rehashed the readable retained
package, streamed its compressed cpio without extraction, matched the archive's
`opt/firefox/firefox` member to the retained final binary, and read embedded
application/platform BuildIDs `20261004075010` and version `159.0a1`. It also
rehash-verified the retained manifest and readable frozen kernel/plain inputs.

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `jit-o2-package/obj/firefox.fpcast.wasm` | 208805368 | `26e380d20f7ad198155fcf0626bc72ab49a5caf2be89e61dcafadbf4efd16998` |
| `jit-o2-package/package/initramfs-firefox.cpio.gz` | 114767798 | `60847fb853398000566e822884816fdd8a75d6c8e7776189ba3fcab1672859fa` |
| Retained boot manifest | 733 | `8b0416b2336a4d891b97409d611c61b2d327b189461eea36daf70824687a3346` |
| Frozen `vmlinux.wasm` | 6281750 | `21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75` |
| Frozen `initramfs.cpio` | 40495556 | `3abcabf273287eada1663c5fc4baedc7f7e28b379c580b796cfebea0f531d1be` |

The binary/archive/manifest are in
`/mnt/p3/codex-build/astra-linuxweb-oct17`; frozen kernel/plain inputs are in
`/mnt/p3/codex-build/gpt6-launch12/frozen/web/linux`. The static inventory report
and bounded reproducer are in the host-check directory as
`retained-baseline-inventory.json` and `retained-baseline-inventory.py`.

Those bytes can anchor a new, honest independent review of a **retained baseline**.
They do not prove a new clean build, fresh ABI execution, native runtime identity,
new observer provenance, useful compiled work or acceptance. The retained build
report explicitly describes a canonical raw PblJit generator plus historical
prepared/observed PBI baseline rather than pristine upstream; several original
provenance paths point to unavailable historical roots. Existing source/build
receipts retain their original scope and runtime-acceptance false status.

A new binding needs a reviewer to resolve or explicitly reject that provenance
closure and verify the current exact artifacts, observer hashes and ABI/build
claims. Hash equality is not a substitute for that decision. No baseline binding,
prelaunch approval or native pass has been created in this checkpoint. The new
full-JIT candidate and its independent source/build/postlink/resource reviews are
still prerequisites for the requested candidate run.
