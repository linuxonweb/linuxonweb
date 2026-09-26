# SPIR-V graphics renderer and guest transport

The browser now translates supplied vertex/fragment SPIR-V and executes the
result through the shared guest GPU byte protocol. Eight shader/layout cases
produce the expected real WebGPU pixels, and default/clear-only host regressions
pass. This is a working host backend and transport, **not yet guest Vulkan
graphics**. The existing Linux ICD still needs graphics resource and command
APIs. No accepted rootfs, Firefox binary or public Site was changed by this work.

## Implementation

The separate graphics translator uses archived Naga 0.20.0 at revision
`c7458638d14921c7562e4197ddeefa17be413587`, the accepted compute dependency
closure and byte-identical Cargo.lock. It performs actual SPIR-V parsing,
validation, interface reflection and WGSL generation. The graphics ABI is
`0x47520001`; the compute module and its sources/provenance remain unchanged.
No shader fingerprinting or CPU-generated replacement pixels are used.

The initial profile has one vertex or fragment entry, no shader resources,
float32 vector inputs/varyings, and one RGBA8 output. It accepts original names
including punctuation, reserved words and type-name collisions; the reflected
original name is distinct from the WGSL writer's emitted name. Coordinate
adjustment is enabled in this translator only. The renderer does not add a
second Y flip. Unsupported state rejects explicitly.

The renderer consumes declarative vertex layouts, pipelines, targets and passes
on a caller-owned device. It snapshots inputs, validates the entire pass before
submission and tracks native buffers/textures including readback staging. The
transport adds opt-in operations 16–22 for real SPIR-V, pipeline creation, vertex
allocation/upload, targets, passes and readback. It shares the existing device,
typed IDs and budgets, keeps compute independently opt-in, and closes its
translator and renderer before releasing the session device. Pipeline metadata
remains charged after shader IDs are destroyed. See the
[wire contract](../web/linux/tests/guest-vulkan-graphics/protocol.md).

## Verified evidence

All graphics artifacts, scratch, profiles and logs are on ext4 under
`/mnt/p6/build/guest-vulkan-graphics-20260926/`. Counts include individual pixel,
framing and ownership assertions; they are not Vulkan feature counts.

| Gate | Result | Evidence |
| --- | --- | --- |
| Translator build-run2 | 771,221 bytes; standalone Wasm | `translator-build-run2/build.json` |
| Node translation/ABI | 66 assertions | `translator-check-run3/result.json` |
| Browser renderer | 2,585 assertions; eight shader/layout rounds | `browser-qa-run1/result.json` |
| Existing host regression | 73 assertions, unchanged source hashes | `protocol-host-regression-run1/result.json` |
| Graphics byte protocol | 2,559 assertions; eight rounds, 19 rejections | `protocol-browser-run1/result.json` |
| Actual guest compute regression | 499 assertions, verified 1 GiB/two CPUs | Compute task's `graphics-protocol-regression-guest-run1/result.json` |

Accepted translator SHA-256:
`c1506c293785db309df6de17e481a9fb62ca9001823d3150f7a39cecc2575636`.
Its source-lock SHA-256 is
`a62ae7cbbbbd4fb77d277b6d52b657c4733da60569c79bd2c233cbe8a9d03c02`.
The frozen browser-input manifest is
`f7a2eb74e688b6f79aa41f7a0dde28d817ad1e7bb164907727879fe5110c32cc`.
Node result SHA-256:
`e7223ae8c0cec85122c3c666c1ac6548ea6b387bf08821c142dbd51dd544fc91`.
Browser renderer result SHA-256:
`f161ed64444385f3622b411810162289cf5e2aec05a4d87369ee9ba8beb76b92`.
Protocol result SHA-256:
`bd04b15e08091b181c66b37c5a6e0e0ab66bdddc2a05309c18e5c6bd286e17fc`.

The independently compiled application shaders comprise two vertex and two
fragment programs, each tested with interleaved and separate vertex buffers.
The 73×51 target requires padded GPU readback rows. Independent barycentric
landmarks safely inside/outside triangle edges check Vulkan positive-height
viewport orientation, geometry changes and red/blue fragment changes. Four
distinct image hashes match between both vertex layouts and both test gates.

The renderer gate also checks viewport/scissor, two draws in one submission,
clear/load/store, input mutations, post-record uploads, native shader validation
recovery and stale-resource rejection. The protocol gate additionally proves a
bad later draw cannot partially clear/draw the target, shader IDs can be deleted
after pipeline creation, typed IDs cannot be interchanged, and a full 64-resource
table rejects allocation before native creation and recovers after destruction.

Protocol execution records 124 requests, five translations, ten passes, nine
draws, three uploads and eleven readbacks. Independent interception counts one
Worker terminated, one device destroyed, 68/68 buffers destroyed and 1/1 texture
destroyed. There are 21 submissions, including readbacks. All independent live
sets are empty **before** emergency test cleanup. Renderer ownership also returns
to zero. Eleven requested source/artifact hashes match before and after this run.

The shared C transport was rebuilt with the separate public Vulkan compute
client and actual upstream loader, then booted in Linux. All 499 assertions pass
at verified 1 GiB/two CPUs: three dispatches, 128 exact output words and sixteen
sentinel comparisons. Guest resource/allocation counters return to zero; one
native device and three buffers are independently counted and destroyed. This
inherited fixture records translator close but not independent Worker lifetime.
All 21 source/host hashes match after execution. Artifacts remain under
`/mnt/p6/build/guest-vulkan-compute-20260926/graphics-protocol-regression-{build,package,guest}-run1`.
The rebuilt binary is 360,151 bytes, SHA-256
`08b7097387590bd9e152e8d1be087580d964c10cafcde6f8187a684c380455d5`;
guest result SHA-256 is
`7b8bb2d598cfbb3f1b18fd5f13c7eb8df923aed28c01da7313d5ba83671851eb`.

All browser gates use visible, cross-origin-isolated Chromium 150 with Google
SwiftShader fallback. This is software execution evidence. QA errors and Runtime
exceptions are zero. The renderer gate retains two canceled Fetch events and
the protocol gate one; the guest compute regression also retains one. Their
causes are unestablished. The legacy host gate has
zero captured CDP events. Do not describe all runs as network-error-free.

Earlier failed attempts are retained: the initial Node check used the task root
where the output guard requires a child directory; the next check exposed
duplicate raw OpEntryPoint declarations collapsing to one Naga IR entry. The
accepted source now rejects duplicate raw declarations before parsing, retaining
the IR-level check. No Naga algorithm or compute-source change was needed.

## Remaining guest integration

The public Vulkan path must preserve the actual pinned upstream loader and add:

1. Graphics capability negotiation; honest attachment/vertex-format queries;
   typed graphics shaders, empty pipeline layouts, image views, render passes,
   framebuffers, pipelines and vertex buffers. Keep compute resource behavior
   and existing clear/copy callers intact.
2. Copied render-pass/draw state; normalized Vulkan vertex binding numbers;
   submit-time coherent uploads; graphics barriers and image layouts; complete
   command-stream validation before host effects. Extend builders' frozen
   source lists for any new includes.
3. A separate public-only Vulkan application with supplied shaders, two vertex
   layouts, real image readback and sentinel/lifetime/recovery checks. Compile
   it through the pinned loader, boot the actual Linux guest, and repeat legacy
   compute/clear/loader regression gates. A host test cannot replace this gate.
4. X11 presentation of that public application's pixels, then capability-driven
   Mesa/Zink and Firefox integration. Implement and separately test the WebGL
   graphics fallback; do not advertise compute on that fallback.

The first guest target may retain the existing 128×128/65,536-byte bounds even
though this host renderer permits 512×512. It must advertise the guest limits.
The current `transfer.inc` has one primary command buffer, 16 recorded commands
and 32 typed resources. Graphics state should have explicitly owned structures;
do not overload unrelated compute descriptor fields or silently relax checks.

Negative clip-depth/non-unit-w behavior, graphics-specific device/transport loss,
close during pending work, injected internal GPU errors, simultaneous graphics
and compute negotiation, physical GPU execution, general Vulkan conformance,
WebGL fallback, Zink/OpenGL, Firefox GPU/video decoding and native guest JIT
remain unverified or unimplemented. The broad goal remains active, below 95/100.
