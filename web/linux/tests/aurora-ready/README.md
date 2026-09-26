# Isolated Aurora readiness gate

This fixture uses the accepted Firefox archive and pinned, already-built helper.
It changes only the precise Aurora launch line in packed `/init`, adds the helper,
and checks every other CPIO record (including metadata and order) byte for byte.
The production `sleep 10` stays intact; Firefox is not launched by this fixture.
No production archive, manifest, helper source, persistent home or startup path
is promoted. All diagnostic output goes directly to the console.

The page requests the accepted Firefox configuration: two CPUs and the main.js
4 GiB setting (`0xffff0000` bytes, leaving the final 64 KiB wasm32 page unused).
It consumes the runtime's separate boot console, retaining a 131072-character
tail and early memory/SMP evidence. The runner also retains the latest 128 CDP
console messages, each capped at 8192 characters, without inspecting objects.
Printed guest memory/SMP markers must match 4194240 KiB and two CPUs; missing
markers fail configuration verification. This diagnostic correction does not establish
why the original 1 GiB run panicked. Preserve that failed run and use a fresh
output directory (for example `run2`) on retry; the unchanged package is reusable.

The packager requires the pinned accepted gzip SHA-256
`6c7fad946e53f977bc6d55a80323f7ec6a9fa84858d1a245fe0916e2f6d17e65`
and helper SHA-256
`2c54b0b87a88366086672b3e199f886863082951a54c34ef01c2dcc6a015a2c3`.

The sole serving agent must verify filesystem type/free space and unused ports
first. Preserve unrelated services, including the user's existing server.
Run from the repository root, with Node 22+ on PATH:

```sh
findmnt -T /mnt/p6/build
df -h /mnt/p6/build
mkdir -p /mnt/p6/build/aurora-ready-20260926/tmp
export TMPDIR=/mnt/p6/build/aurora-ready-20260926/tmp
python3 web/linux/tests/aurora-ready/package.py \
  --source web/linux/initramfs-firefox.cpio.gz \
  --helper ../.cache/runtime-graphics-20260926/wm-ready/wait-for-aurora.wasm \
  --output /mnt/p6/build/aurora-ready-20260926/package1
sh -n /mnt/p6/build/aurora-ready-20260926/package1/init.after.sh
node --check web/linux/tests/aurora-ready/run-browser.mjs
ln -s /mnt/p6/build/aurora-ready-20260926/package1 web/linux/tests/aurora-ready/candidate
LINUX_WEB_PORT=4182 node web/desktop/dev-server.mjs \
  > /mnt/p6/build/aurora-ready-20260926/server.log 2>&1
```

The server command is long-running and belongs to the sole serving agent. The
existing development server follows this ignored symlink, so the candidate bytes
remain under `/mnt/p6/build`. Do not overwrite an existing symlink or output.
The packager recompresses gzip in memory and writes only the final candidate;
it neither extracts the rootfs nor invokes compilers or external temporary tools.

In another owned command session, set the same `TMPDIR` and launch a fresh,
task-owned Chromium with explicit disk profile/cache paths, no SwiftShader flags:

```sh
export TMPDIR=/mnt/p6/build/aurora-ready-20260926/tmp
/home/a/.local/archpkg/pacman/usr/bin/chromium \
  --user-data-dir=/mnt/p6/build/aurora-ready-20260926/browser-profile1 \
  --disk-cache-dir=/mnt/p6/build/aurora-ready-20260926/browser-cache1 \
  --remote-debugging-port=9396 --no-first-run --no-default-browser-check \
  --disable-dev-shm-usage about:blank \
  > /mnt/p6/build/aurora-ready-20260926/browser.log 2>&1
```

Use the established local graphical environment and executable wrapper if needed;
do not modify or restart an existing user browser. Then execute:

```sh
export TMPDIR=/mnt/p6/build/aurora-ready-20260926/tmp
CDP_URL=http://127.0.0.1:9396 \
  AURORA_QA_URL=http://127.0.0.1:4182/linux/tests/aurora-ready/index.html \
  AURORA_QA_OUT=/mnt/p6/build/aurora-ready-20260926/run1 \
  /home/a/.config/nvm/versions/node/v22.22.2/bin/node \
  web/linux/tests/aurora-ready/run-browser.mjs \
  > /mnt/p6/build/aurora-ready-20260926/runner.log 2>&1
```

The runner records guest uptime and independent host console-observation elapsed
times. Passing requires exit 0 **and** the deadline marker for one-second self-test
and ten-second missing-display tests. Both before-Aurora and already-ready tests
require the positive handshake marker and reject a deadline return. The prelaunch
test records helper PID, waits a second, verifies it remains alive, records Aurora
launch, then requires the positive handshake. Per-stage and absolute Node timers
bound broken guest timers; a page watchdog is an additional guard. Timing windows
include scheduling overhead and are acceptance bounds, not performance results.

The runner closes its own guest and tab. The serving agent must then gracefully
close only its task Chromium, stop its owned dev server, confirm ports 9396/4182
closed, and remove only the `candidate` symlink it created. Preserve disk profiles,
package and evidence for review; they contain no user browser state. Do not remove
unrelated files or services.

Passing this report alone does not establish release readiness: early Firefox
window usability, matched startup observations, fallback integration, warm cache,
and update/home preservation remain separate release gates. There is no native
Firefox JIT, guest GL/Vulkan or hardware video claim in this fixture.

## Executed acceptance

Run2 passed all 23 checks with authoritative kernel markers for 4,194,240 KiB
and two CPUs. Independent host observations were:

| Stage | Seconds | Observed result |
| --- | ---: | --- |
| Signal self-test | 1.043 | Deadline marker, exit 0 |
| Missing display | 10.039 | Deadline marker, exit 0 |
| Helper before Aurora | 1.310 | Pending before WM launch, then handshake, exit 0 |
| Aurora already present | 0.056 | Handshake, exit 0 |

The before-Aurora stage includes the deliberately inserted one-second wait.
These are helper acceptance observations, not Firefox startup benchmarks.
The initial 1 GiB fixture panicked before reaching the helper and did not collect
the separate boot console; its exact failure cause remains unproven. Run2 uses
the accepted Firefox memory configuration and captures that console. A prior
run2 attempt stopped before guest execution because its local test services had
exited; those services were confirmed absent before the serving agent restarted
them. Artifacts from each attempt remain on disk.

See the [acceptance evidence](../../../../docs/evidence/runtime-graphics-20260926/aurora-ready.json)
and [guest screenshot](../../../../docs/evidence/runtime-graphics-20260926/aurora-ready.png).
Firefox was not launched in this test. Production `sleep 10`, rootfs, manifest
and deployed Site remain unchanged. A stalled X server connection was not
separately exercised by the missing-display test.
