# Isolated experimental Vulkan lifecycle

This first executable slice exercises official Vulkan C signatures and ICD
procedure lookup inside the real wasm32 Linux guest, with a live host WebGPU
device obtained through the existing vsock HELLO bridge. The test resolves and
calls instance/device enumeration, device/queue creation and destruction. It
also rejects unsupported features, extensions, descriptor chains and queues.

It is **not** a conformant Vulkan implementation, system loader integration,
Vulkan rendering, OpenGL-through-Vulkan, Firefox acceleration or a decoder.
The single queue currently has zero capability flags; command submission and
image entrypoints return NULL. Properties identify the experimental scope and
do not invent PCI IDs, UUIDs or physical acceleration. Clear/readback remains
the next required executable slice; no overall goal score follows from this one.

`icd.c` and the client use the existing unmodified Khronos 1.3.231 C headers in
the archived Firefox ANGLE source. `header-provenance.json` pins each local
header's SHA-256 and source path; it does not claim a fresh upstream authenticity
verification. Build copies those exact headers, retaining their license notices,
and records them with frozen input C source hashes. No new dependency downloads,
Dawn implementation or shader compiler is required for this lifecycle phase.

The browser's `serveLifecycle` wraps the existing `guest-gpu/host.mjs` without
changing that implementation. It records actual device creation/destruction and
connection closure. A passing live run requires two successful HELLOs plus CLOSE,
one real host device created and destroyed, zero graphics resources created,
zero draw/readback operations, exact guest/host adapter identity agreement, guest
zero-live-object audit and exit status zero. A second fixture passes `gpu:null`
to the host and requires instance creation to fail with no device enumeration.
SwiftShader is acceptable semantic evidence and must remain identified as a
software fallback.

The first build/package and both real guest runs passed on 2026-09-26: live
38 checks and unavailable 11 checks, each on its first attempt at actual 1 GiB /
2 CPUs. Chromium 150 used the Google SwiftShader fallback adapter; the live run
created and destroyed exactly one host device and finished with zero live guest
instances/devices. The unavailable run created no host or guest devices.
The guest artifact is
`/mnt/p6/build/guest-vulkan-20260926/build-run1/guest-vulkan-lifecycle.wasm`
(41,861 bytes; SHA-256
`0f2b0d4b611f2a8930e343ca1d6145824d1e48d4654307d322626b15c28e3c24`).
Raw results remain in `qa-live-run1/result.json` and
`qa-unavailable-run1/result.json` beneath that task directory. See the
[execution report](../../../../docs/guest-vulkan-lifecycle-20260926.md) and
[compact evidence](../../../../docs/evidence/runtime-graphics-20260926/guest-vulkan-lifecycle.json).
This fixture remains excluded from deployed Sites version 6.

Build and packaging are executed by a command agent, not the implementation
agent. First verify the target filesystem/capacity and export **all** temporary
environment variables. These scripts independently reject memory filesystems,
outputs outside the task directory, missing scratch paths and less than 1 GiB
free space. Use fresh output names on every attempt.

```sh
findmnt -T /mnt/p6/build -o TARGET,FSTYPE,AVAIL
df -h /mnt/p6/build
mkdir -p /mnt/p6/build/guest-vulkan-20260926/tmp
export TMPDIR=/mnt/p6/build/guest-vulkan-20260926/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR" PYTHONDONTWRITEBYTECODE=1
/usr/bin/python3 web/linux/tests/guest-vulkan/build.py \
  --output /mnt/p6/build/guest-vulkan-20260926/build-run1
/usr/bin/python3 web/linux/tests/guest-vulkan/package.py \
  --build /mnt/p6/build/guest-vulkan-20260926/build-run1/build.json \
  --output /mnt/p6/build/guest-vulkan-20260926/package-live-run1 --mode live
/usr/bin/python3 web/linux/tests/guest-vulkan/package.py \
  --build /mnt/p6/build/guest-vulkan-20260926/build-run1/build.json \
  --output /mnt/p6/build/guest-vulkan-20260926/package-unavailable-run1 --mode unavailable
```

The compile/link invocation is recorded exactly in `compile.command.txt`.
It uses the established wasm32-musl compiler, `-std=c11 -O2 -Wall -Wextra
-Werror -pthread -matomics -mbulk-memory -static`, the two new C files and
existing `guest-gpu.c`, with imported shared memory and exported function table.
Wasm validation and an import allowlist follow; no X11 dependency is needed.
The only permitted imports are shared `env.memory` and the existing Linux
syscall/thread/signal imports. Build success is not guest execution evidence.

Packaging hash-checks the accepted **plain** image against the current manifest,
changes only the test copy of `/init`, and adds one executable. All other CPIO
records and the archive tail are compared byte-for-byte. It never modifies the
accepted image. The test doesn't attach the persistent-home backend.

Only the sole serving owner may expose these two directories as the fixture's
`candidate` and `candidate-unavailable` links, with no existing path replaced:

```sh
ln -s /mnt/p6/build/guest-vulkan-20260926/package-live-run1 web/linux/tests/guest-vulkan/candidate
ln -s /mnt/p6/build/guest-vulkan-20260926/package-unavailable-run1 web/linux/tests/guest-vulkan/candidate-unavailable
```

Wait for the current release VM to finish. Use an isolated disk-backed Chromium
profile with the existing server and CDP port owned by that serving agent. The
runner starts no browser/server; it creates and closes only its own tab and VM.
Set the URLs to that owner's actual endpoints, then run serially:

```sh
export CDP_URL=http://127.0.0.1:9394
export VK_QA_BASE=http://127.0.0.1:4180/linux/tests/guest-vulkan/
VK_QA_OUT=/mnt/p6/build/guest-vulkan-20260926/qa-live-run1 \
  node web/linux/tests/guest-vulkan/run-browser.mjs live
VK_QA_OUT=/mnt/p6/build/guest-vulkan-20260926/qa-unavailable-run1 \
  node web/linux/tests/guest-vulkan/run-browser.mjs unavailable
```

Acceptance requires both `result.json` files to report `pass:true`, actual host
adapter identity in the positive case, one host device destruction, no remaining
guest objects, no runtime exceptions, and successful unavailable-host failure.
Retain the screenshots, package/build reports and logs under the task directory.
The serving owner removes only its two exact symlinks after testing and cleans
up owned services under the existing ownership rules. Nothing here is deployed.
