# Isolated public Vulkan graphics application

`client.c` is a separate public Vulkan 1.0 application linked through the pinned
static Khronos loader. It does not call driver-private or GPU transport entrypoints.
The first actual Linux guest execution passes all eight shader/layout rounds on
SwiftShader, with exact operation counts and independent resource cleanup.
See [the execution report](../../../../docs/guest-vulkan-graphics-execution-20260926.md).
The existing renderer/protocol gates remain separate host evidence.

The eight rounds combine two independently compiled vertex programs, two fragment
programs and interleaved/separate vertex layouts. Each renders two draws in a CLEAR
pass, then an empty compatible LOAD pass, and copies a 73×51 RGBA8 target to mapped
host-coherent memory. An independent barycentric oracle checks safely interior
interpolated colors (tolerance two UNORM bytes), exact green exterior, alpha, row
orientation and 32 sentinel bytes (16 buffer-tail plus 16 allocation-tail bytes).
Most assertion counts are individual byte/pixel comparisons; report eight rounds,
four programs and operation counts separately.

Bindings 5 and unsorted 7/2 declarations test driver slot normalization. The client
mutates caller structures and bind arrays, destroys shader/layout/creation-pass
objects before drawing, and writes mapped vertex bytes after command recording.
Separate layouts use an optional HOST_WRITE→VERTEX_ATTRIBUTE_READ barrier;
interleaved layouts omit it legally. Every round checks whole-stream rejection for
a missing TRANSFER_WRITE→HOST_READ barrier and rejection of a destroyed pipeline,
with unchanged mapped bytes. Fixed host operation counts also reject unexpected
GPU side effects from either invalid stream. A malformed module and an unsupported
resource shader must reject before later valid shaders recover.

`build.py` freezes the exact client/ICD/include closure and shader bytes, checks
pinned official loader/header blobs, compiles with `-Werror`, checks client undefined
symbols against public loader symbols, validates Wasm and checks its Linux import
ABI. `package.py` makes a hash-verified isolated copy of the accepted plain image;
only `/init` changes and the public application is added. Accepted runtime assets
are never modified. `storage.py` rejects memory-backed storage and requires all
three scratch environment variables under the persistent task root.

Example commands for the sole command/serving owner, after checking resolved
filesystem/free space and creating the disk-backed scratch directory:

```sh
export TMPDIR=/mnt/p6/build/guest-vulkan-graphics-20260926/tmp
export TMP="$TMPDIR"
export TEMP="$TMPDIR"
/usr/bin/python3 web/linux/tests/guest-vulkan-graphics/build.py \
  --source-audit /mnt/p6/build/guest-vulkan-loader-20260926/source-audit \
  --shader-dir /mnt/p6/build/guest-vulkan-graphics-20260926/translator-fixtures-run1 \
  --output /mnt/p6/build/guest-vulkan-graphics-20260926/guest-build-run1
/usr/bin/python3 web/linux/tests/guest-vulkan-graphics/package.py \
  --build /mnt/p6/build/guest-vulkan-graphics-20260926/guest-build-run1/build.json \
  --output /mnt/p6/build/guest-vulkan-graphics-20260926/guest-package-run1
VK_QA_OUT=/mnt/p6/build/guest-vulkan-graphics-20260926/guest-run1 \
  /home/a/.config/nvm/versions/node/v22.22.2/bin/node \
  web/linux/tests/guest-vulkan-graphics/run-guest.mjs graphics
```

The sole serving owner must first create and record `candidate-guest` pointing to
the new package, and own an isolated server/browser on HTTP 4182/CDP 9396. The runner
never starts services. Preserve the existing `candidate` translator link and its
771,221-byte Wasm pinned to
`c1506c293785db309df6de17e481a9fb62ca9001823d3150f7a39cecc2575636`.

The page requires actual Linux 1 GiB/two-CPU kernel markers, eight round markers,
16 passes/16 draws/12 uploads/eight readbacks, and zero errors. Native Worker,
device, buffer and texture counters are independently captured before emergency
cleanup. The graphics translator Worker is identified by its exact module URL;
unrelated Linux Workers are excluded. The runner captures JSON, network failures,
Runtime exceptions, boot logs and a screenshot, then closes its guest/tab.

This remains an offscreen bounded, nonconformant prototype. It does not demonstrate
X11 presentation, a usable general Vulkan/OpenGL driver, Firefox GPU integration,
physical GPU execution, a WebGL fallback, hardware video decoding or native JIT.
Do not deploy this fixture.
