# Static loader / public client experiment

This isolated fixture links the real Khronos Vulkan-Loader **v1.3.231**, commit
`61187c40845c92a80bcd2216089dd01badcda7ac`, to the existing partial WebGPU ICD.
Matching Vulkan-Headers are pinned to
`98f440ce6868c94f5ec6e198cc1adda4760e8849`. `source-lock.json` records the exact
allowlisted URLs, sizes and SHA-256 hashes, including files inspected and excluded
from compilation. The four previously used Vulkan headers match official bytes.

The static port replaces driver discovery with one built-in provider. It preserves
upstream interface negotiation, instance/device creation chains, required ICD
queries, dispatch-table setup and public typed Vulkan trampolines. No `dlopen`
override, ICD manifest, dynamic driver discovery or layers are supplied. Provider
metadata uses normal loader allocation and cleanup; it owns no library handle.
Unknown device/physical procedures return NULL. The three generic unknown-call
trampoline sources and their assembly alternatives are not compiled. Known
upstream typed API entrypoints remain present; their existence does not imply
that this incomplete ICD implements them.

`client.c` includes only public Vulkan/POSIX headers and is compiled as a separate
object. Its undefined Vulkan symbols must be defined by the upstream loader
archive; it calls no ICD/private audit APIs. `build.py` retains object symbol
lists, the exact port patch, source hashes, commands, logs and a linker map. The
client checks enumeration, unsupported extension and unknown-procedure rejection,
format/image limits and sparse rejection, then clears one 17×3 image twice and
checks all 102 returned pixels plus untouched mapped-memory sentinels. It releases
all objects through public Vulkan APIs; the host fixture independently checks
native device/texture/buffer teardown and protocol CLOSE.

The driver still has only the opt-in, synchronous RGBA8 clear/copy profile. The
COMPUTE queue bit exists for clear eligibility but compute dispatch is absent.
This is not Vulkan conformance, a general application GPU, shader support, Zink,
OpenGL, Firefox acceleration, WebGL fallback or hardware video decoding. A
SwiftShader run supplies software execution evidence only. The accepted runtime
and public Site are unchanged.

All commands must export `TMPDIR`, `TMP`, and `TEMP` to an existing disk-backed
scratch directory under `/mnt/p6/build/guest-vulkan-loader-20260926`; output paths
must be fresh children of that root. The runner uses an existing sole-owner
server/browser and never starts services. Commands, after approved source fetch:

```sh
python3 web/linux/tests/guest-vulkan-loader/build.py \
  --source-audit /mnt/p6/build/guest-vulkan-loader-20260926/source-audit \
  --output /mnt/p6/build/guest-vulkan-loader-20260926/build-run1
python3 web/linux/tests/guest-vulkan-loader/package.py \
  --build /mnt/p6/build/guest-vulkan-loader-20260926/build-run1/build.json \
  --output /mnt/p6/build/guest-vulkan-loader-20260926/package-clear
```

The serving owner creates the exact test-only `candidate-clear` symlink to the
packaged root and invokes `run-browser.mjs clear` with explicit `VK_QA_OUT`,
`VK_QA_BASE` and `CDP_URL`. The runner captures kernel memory/SMP markers and closes
its guest/tab. Only the owner cleans up its service/browser and exact symlink.
Build success alone is not actual guest acceptance.

Actual first-run guest acceptance now passes 883 assertions through the public
loader client; direct ICD regressions pass 44 lifecycle, 14 unavailable and 957
clear checks. See [the integration report](../../../../docs/guest-vulkan-loader-integration-20260926.md)
and [compact evidence](../../../../docs/evidence/runtime-graphics-20260926/guest-vulkan-loader-integration.json).

For a fresh source cache, run `fetch.py --output` with a fresh task-disk child,
then pass that directory as `build.py --source-audit`. Every download is checked
against the exact immutable URL, byte length and hash in `source-lock.json`.
The helper is syntax-checked; this continuation verified the original retrieval
and built from those bytes, without repeating all downloads through the helper.
The upstream loader requires `VK_ENABLE_BETA_EXTENSIONS` for its generated object
metadata; the loader compilation honors this upstream setting using pinned beta
and video declaration headers. Client and ICD compilation does not enable it,
and no video capability or extension is advertised by the ICD. The first compile
attempt without those declarations failed and is preserved in `build-run1`.
