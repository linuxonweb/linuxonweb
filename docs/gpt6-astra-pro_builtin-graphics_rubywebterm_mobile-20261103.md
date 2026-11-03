# Authenticated mobile Linux console: accepted scope

GPT-6 Astra Pro / built-in graphics_jit / Rubywebterm. Final CTO project acceptance: **42/100**; mobile **2/5**.

The actual MI8 running Android15 and Brave/Chrome148 booted the 512MiB native Wasm Linux console through the authenticated HTTPS preview, executed native commands, and stopped cleanly. The accepted user route is `/linux/packages/v1/package-shell.html?cpus=1` after opening a valid preview access link in the same browser. The default desktop and two-CPU console configuration were not substituted for this tested one-CPU phone configuration.

## What ran on the phone

| Operation | Observed result |
|---|---|
| `id` | Native `uid=0(root) gid=0(root)` output |
| `apk info` | Native manager listed apk-tools, BusyBox, CA certificates and curl |
| `apk update` | Actual HTTPS repository request completed with10 distinct packages available |
| `apk add python3` | Reached Installing3.14.6-r1 but did not finish within45s; installation is unaccepted |
| Physical Stop | Native guest stopped; owned worker Blob revoked; owned phone tab and ADB forwarding removed |

Commands used real Android text injection and Enter events into the visible input. The final screenshot shows the on-screen keyboard, but no letter was tapped on that keyboard: soft-key letter-tap and composition behavior remain unaccepted. The normal console home is separate from the desktop home; this test used an explicitly isolated test namespace and did not clear existing storage. Initial `apk info` reports a missing index-cache warning before `apk update`; the installed base packages are still listed.

## Measured startup and resources

| Measurement | Final accepted run |
|---|---:|
| Image fetch | 6.669s |
| Verified image to native prompt | 3.601s |
| Complete owned test, including ADB/auth setup and cleanup | 34.202s |
| Minimum available device RAM | 1,772,552,192 B |
| Worker instances observed | 28 |
| Verified remote worker fetches | 1 |
| Owned Blob URLs created / revoked | 1 / 1 |

The kernel cache was not cleared. Full navigation-to-ready time was not independently measured. These figures do not establish cold Firefox startup or desktop-level performance. CPU/RAM sampling ran every1s and covered the whole phone; the minimum allowed available RAM was1GiB. No unrelated tabs or the existing port8888 service were changed.

## Why the public route was slow and what changed

Before the change, the authenticated preview served mutable worker modules with `Cache-Control:no-store`. The same phone reached a local-route prompt in4.681s but repeatedly stalled before userspace on HTTPS. An exact dependency audit confirmed matching kernel/image/worker lengths and hashes, valid MIME types and HTTP200 responses, with no redirect or HTML fallback. A fresh test home did not remove the delay.

The console and all worker imports are now bundled into source-pinned, SHA256-named modules. The console downloads its worker once, checks the digest, creates one per-machine Blob URL, and reuses that URL for its workers. The URL is revoked on Stop and failure. Original source asset bases and execution query behavior are preserved. The optional runtime argument leaves the normal desktop worker path unchanged. No preview proxy restart, authentication change, global browser setting change, or long caching of mutable routes was needed.

The loader rejects wrong origins/paths, credentials, query strings, fragments, mismatched hashes, failed responses and streamed payloads over4MiB. It cancels oversized reads before retaining bytes beyond that limit, supports caller cancellation, and has a30s download bound. Peer review passed. All29 real-Chromium integrity/lifecycle gates passed in6.478s with zero owned processes left.

## Recoverable artifacts

| File | Bytes | SHA256 |
|---|---:|---|
| `web/linux/packages/v1/package-shell.html` | 5,089 | `d117af55de7c369815efe3d6d797d37b11adafed034bc2f639285390684b42e4` |
| `web/linux/packages/v1/package-shell.mjs` | 9,104 | `7fce19bcb9503a5590af484d2714967b7403953aeff4acddc7824f8141cee926` |
| `web/linux/packages/v1/package-console.cpio.gz` | 3,425,102 | `12d9a1246d7671f220e4e5d600e0892173c553c06a3bb63efeec3b1e5c347912` |
| `web/linux/packages/v1/console-manifest.json` | 1,040 | `9d3c668792d42fd0ca21f863404e7c2d0a41274e7589744b9bae6aa03a3d0b11` |
| `web/linux/packages/v1/runtime-bundles.json` | 7,533 | `8131b9001c46fbe2bd5bfc9f891e6f6c06dcf5a3935ec1a1ba37b8f642efe731` |
| `web/linux/dist/immutable/worker-d4ffec4ec28122798e730b4db2797ecb2df9983a71a260190299c93c72e59f15.mjs` | 103,608 | `d4ffec4ec28122798e730b4db2797ecb2df9983a71a260190299c93c72e59f15` |
| `web/linux/dist/immutable/console-49b2d792ea611e68e64449488906719e3b518bab6a4b5b8f16c4ff0c8c809558.mjs` | 222,188 | `49b2d792ea611e68e64449488906719e3b518bab6a4b5b8f16c4ff0c8c809558` |

Source/build recipe: `tools/graphics-benchmark/build-mobile-bundles.mjs` uses the installed esbuild0.28.1 and rejects residual external/dynamic imports. `tools/guest-packages/build-console.py` builds the signed base-package image and sets the standard CA paths. `tools/graphics-benchmark/android-console-owner.mjs` owns one phone tab/mappings with a RAM floor and bounded lifetime; set `ANDROID_SERIAL` locally for the authorized device. `summarize-mobile.py` exports only curated acceptance fields; raw grants, cookies, targets and device identifiers remain private.

Evidence: [curated result](../tools/graphics-benchmark/evidence/gpt6-astra-rubywebterm-mobile-20261103.json), [device resource samples](../tools/graphics-benchmark/evidence/gpt6-astra-rubywebterm-mobile-resources-20261103.json), [native command screenshot](../tools/graphics-benchmark/evidence/gpt6-astra-rubywebterm-mi8-https-native-20261103.png), [physical Stop screenshot](../tools/graphics-benchmark/evidence/gpt6-astra-rubywebterm-mi8-https-stopped-20261103.png).

## Remaining limits

Full Firefox on Android was deferred because of the measured desktop memory/performance budget. The phone Python installation timeout is preserved. Soft-keyboard typing and iOS are untested. Full desktop OpenGL/Vulkan conformance, Firefox native JIT safety coverage, the30s cold Firefox target and50% host-browser rendering target remain open; see the graphics/JIT acceptance matrix.

The original failed phone setup/deadline/scroll-coordinate fixtures and the failed package-install attempt remain recorded. The final bounded gate uses settled physical coordinates and completed native command/Stop evidence; failures were not dropped to obtain a passing result.

The HTML acceptance badge was refreshed to42 after the run; historical screenshots retain the observed earlier badge. The tested worker/console bundle and guest image bytes are unchanged.
