# Pinned Dawn C ABI header gate

The official Dawn `headers` generator ran successfully with eleven allowlisted
source blobs: ten from Dawn `c3d35d65fb2f087c425ba20050c5ff03d32f1114`, plus the
`DEPS` file from ANGLE `c2fbfadacf8679abe316941d1ac5310f6c1645a1` containing that
Dawn pin. No repository clone or native Dawn build was needed. The fetched HTTP
bodies, including Git metadata, totaled 597,609 bytes.

`tools/guest-gpu/dawn-headers.py` resolves the pinned commit through GitHub's
HTTPS Git API, verifies each traversed Git tree hash and every fetched blob's
Git identity and size, and records SHA-256 for every source. This uses the
HTTPS commit metadata as the root of provenance; it does not verify a signed
commit. Only allowlisted regular files are written. The upstream generator and
templates are unmodified. Generator dependencies are pinned to Jinja2 3.1.6 and
MarkupSafe 3.0.3; the successful run used existing system Python 3.14.6.

Generated outputs:

| Header | Bytes | SHA-256 |
| --- | ---: | --- |
| `dawn/webgpu.h` | 257,507 | `31dab439905b58521acaec4981d0ca324c4ed1670fde8aa539a6e1634c545f09` |
| `dawn/dawn_proc_table.h` | 17,606 | `06e158929631f6a7e05dd79d31684a4a87b6360723eb6b5912046ddd99e7672d` |
| `dawn/wire/client/webgpu.h` | 44,247 | `f6bb8f8fbdf2c99133e480aa6ed635038ce3ff9b2188180d618801fc6e7f5a21` |

The generated ABI has a 20-byte proc-table version, a `WGPUFuture` containing a
64-bit ID, and `bufferMapAsync` returning that future by value while accepting
callback-info by value. The map callback takes status, a `WGPUStringView` and
two userdata pointers. `instanceWaitAny` takes a `size_t` future count,
`WGPUFutureWaitInfo *` and a 64-bit timeout. The guest must retain callback,
userdata and future bookkeeping locally; none of these pointers are browser
object addresses.

The compile-only client `web/linux/tests/guest-gpu/dawn-abi/probe.c` checks
26 actual `DawnProcTable` member/`WGPUProc*` type pairs and compiles typed calls
for the inferred clear/readback subset: limits, queue, texture/view, staging
buffer, render pass, texture copy, submit, map, wait and release. It includes
only official declarations. A negative configuration deliberately removes the
second callback userdata argument and must be rejected by the compiler. This
source must never be linked or executed as a renderer: it deliberately does
not implement runtime validation, asynchronous state or failure cleanup.

Both compilation gates now pass: Clang 22.1.8 targeting
`wasm32-unknown-linux-musl` emitted a 3,423-byte object for the positive source,
and rejected the negative source specifically for its incompatible
`WGPUBufferMapCallback` type. The object's SHA-256 is
`a441db2015c577974ff48cf7bf57140b43c54f9a944826a028c884eb667a2a95`.
The retained [ABI evidence](evidence/runtime-graphics-20260926/dawn-abi.json)
records exact commands, diagnostics, source/header hashes and dependency versions.
The final generator script's syntax and strict dependency assertion were checked
against the installed versions; its earlier successful header generation was
not repeated after adding that assertion.

Reproduction, from the repository root, with a fresh output directory on a
verified disk-backed filesystem:

```sh
export TMPDIR=/mnt/p6/build/dawn-abi-20260926/tmp
/usr/bin/python3 tools/guest-gpu/dawn-headers.py \
  --output /mnt/p6/build/dawn-abi-20260926/run2
CC=/nix/store/j8mdl69qafyijllv7s703219nb5fnrdp-wasm32-unknown-linux-musl-llvm-toolchain-wrapper-22.1.8/bin/wasm32-unknown-linux-musl-clang
"$CC" -std=c11 -Wall -Wextra -Werror -pthread -matomics -mbulk-memory -O0 \
  -I/mnt/p6/build/dawn-abi-20260926/run2/generated/include \
  -c web/linux/tests/guest-gpu/dawn-abi/probe.c \
  -o /mnt/p6/build/dawn-abi-20260926/run2/probe.o
"$CC" -std=c11 -Wall -Wextra -Werror -pthread -matomics -mbulk-memory -O0 \
  -I/mnt/p6/build/dawn-abi-20260926/run2/generated/include \
  -DDAWN_ABI_NEGATIVE_CALLBACK \
  -c web/linux/tests/guest-gpu/dawn-abi/probe.c \
  -o /mnt/p6/build/dawn-abi-20260926/run2/negative.o
```

The final command must exit nonzero for the incompatible callback pointer.
Use object compilation for this negative check: this toolchain wrapper injects
library-search flags that cause an unrelated unused-argument error with
`-fsyntax-only -Werror`. That earlier failed attempt is retained in the evidence
and does not count as callback rejection.
The successful generation's complete inputs, Git tree records, exact command,
logs and headers are preserved at `/mnt/p6/build/dawn-abi-20260926/run1`.

This is a source/type boundary check, not an executed GPU API. No EGL, GLES,
Vulkan driver, Firefox GPU backend, hardware decoder, physical acceleration or
native JIT was added. The user's Vulkan and GL-through-Vulkan requirements
remain required and unresolved. An ANGLE WebGPU path would be a separate EGL
integration experiment, not a substitute for Vulkan. Further work still needs
a traced call inventory, typed transport implementation with failure/lifetime
handling, and linked guest clear/readback execution. The ANGLE native-Dawn
dependency and translator/link closure remain unported. Production bridge,
rootfs, startup, and public Site assets were not changed by this gate.

Upstream sources: [ANGLE pinned DEPS](https://github.com/google/angle/blob/c2fbfadacf8679abe316941d1ac5310f6c1645a1/DEPS),
[Dawn generator](https://github.com/google/dawn/blob/c3d35d65fb2f087c425ba20050c5ff03d32f1114/generator/dawn_json_generator.py),
[Dawn schema](https://github.com/google/dawn/blob/c3d35d65fb2f087c425ba20050c5ff03d32f1114/src/dawn/dawn.json).
