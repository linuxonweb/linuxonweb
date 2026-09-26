# Bounded declarative renderer

`renderer.mjs` is experimental source with a passing browser pixel gate. It is not
imported by the accepted runtime, and does not establish guest graphics,
physical acceleration, WebGL fallback, Vulkan conformance or Firefox support.

The pure exports `validateTranslatedShader(input, stage)`,
`validatePipelineDescriptor(input)` and `validateTargetDescriptor(input)`
copy and freeze supported values. They contain no native WebGPU resource
creation. `createGraphicsRenderer(device, {onEvent}?)` uses the caller's existing
device. Browser WebGPU enum globals must be available. No adapter/device is
requested and the renderer never calls `device.destroy()`.

The translator contract is schema 1, `profile:'graphics-empty-v1'`,
`backend:'wgsl'`, `coordinateAdjustment:true`, `stage:'vertex'|'fragment'`,
`wgsl`, original `originalEntryPoint`, emitted `entryPoint`, `inputs`, `outputs`
and `resources:[]`. Location items are
`{location,type:{scalar:'f32',components:2|3|4},interpolation}`. Varyings have
`interpolation:{mode:'perspective'|'linear'|'flat',sampling:null|'center'}`;
other locations have null interpolation. Absent non-flat sampling normalizes
to center; flat requires null. Position is
`{builtin:'position',type:{scalar:'f32',components:4},invariant:boolean,interpolation:null}`,
required on vertex output and optional on fragment input. No other builtin or
resources are accepted. The validator trusts this metadata came from the
validated translator; it does not independently parse WGSL to prove reflection.
Actual shader compilation and pipeline validation still execute on the GPU API.

Methods (creation returns opaque local object handles, never transport IDs):

- `await createPipeline({vertex,fragment,vertexBuffers,colorFormat?,topology?,frontFace?,cullMode?,sampleCount?})`.
  Vertex and fragment are translated records. `vertexBuffers` contains
  `{stride,stepMode?:'vertex',attributes:[{location,offset,format}]}`; formats
  are `float32x2`, `float32x3`, `float32x4`. All vertex input locations must
  match exactly; every fragment varying must match a vertex output. The only
  initial raster state is RGBA8 UNORM, triangle list, CCW, no culling, one sample,
  fill, full color write mask, no blend, depth/stencil, descriptors or textures.
  These are defaults for optional fields; unsupported values/fields reject.
  Descriptor/translation values are copied before the first await. Pipeline
  lifetime is independent of the supplied records and temporary shader modules.
- `await createVertexBuffer({size})`; size is aligned to four bytes and at most
  65536. `await uploadVertexBuffer(handle, offset, Uint8Array)` copies caller
  bytes immediately, validates bounds and queues the GPU write. Uploads made
  after draw recording and before `end()` are visible to that submission.
- `await createTarget({width,height,format?:'rgba8unorm'})`; dimensions are
  1–512. Owned texture has render-attachment/copy-source usage.
- `begin({target,loadOp:'clear'|'load',storeOp:'store',clearColor?})` records a
  pass without native GPU work. Clear requires `[r,g,b,a]` in [0,1]; load
  disallows clearColor and needs a previously successful stored target at end.
  Discard store is unsupported.
- `draw({pipeline,vertexBuffers:[{buffer,offset?,size?}],vertexCount,firstVertex?,instanceCount?,firstInstance?,viewport?,scissor?})`
  records a copied draw; vertexCount is 3–65536 and a multiple of three,
  firstVertex defaults to zero, instanceCount must be one, firstInstance zero.
  Bindings correspond to layout array positions. Viewport is
  `{x,y,width,height,minDepth?,maxDepth?}`; scissor is `{x,y,width,height}`.
  Both default to the full target; all coordinates must be inside the target,
  scissor values are integers, viewport dimensions positive, depth in [0,1].
  Zero scissor extent is allowed. All referenced attribute fetches are bounded.
- `await end()` detaches the recorded pass, revalidates every live handle and
  bound, encodes every draw in one native pass and submits once. Encoder
  validation completes before submission. The method waits once for the pass,
  never after each draw. An empty clear pass is valid. Failure consumes the
  recording; `abort()` discards a recording without GPU work. A target becomes
  readable/loadable only after successful stored submission. A submitted pass
  cannot be rolled back if a native failure occurs; the target is marked
  uninitialized until a later successful clear pass.
- `await readback(target)` returns
  `{width,height,format:'rgba8unorm',rowOrder:'top-to-bottom',pixels:Uint8Array}`.
  It copies actual GPU pixels through a 256-byte-row-aligned staging buffer,
  strips padding, unmaps and destroys staging in a finally block. No shader
  fingerprinting, CPU pixel substitution, Y flip or depth conversion occurs.
- `await destroy(handle)` releases a live object. A recorded reference to it
  causes `end()` to reject before encoding. Repeated/stale/foreign destroys
  reject. Handles from another renderer cannot be used here.
- `close()` synchronously invalidates handles, cancels awaiting operations and
  destroys all owned textures/buffers, including in-flight staging, once. It is
  idempotent and preserves the caller's device. Device loss performs equivalent
  cleanup with state `lost`; renderer recreation requires a caller-owned new
  device. `getStats()` reports current handles, bytes, native ownership counters,
  uploads, passes/draws/readbacks and state.

All async work is serialized; callers should await completion before depending
on the result. Synchronous descriptor errors throw immediately. Async native
failures reject `GraphicsRendererError` with `code` and transport-friendly
`status`: validation/-22, budget/-12, unavailable/-19, GPU internal/-5.
Rejected operations do not poison the next operation unless device loss or
close occurs. `onEvent` is diagnostic only. Do not interleave external error
scopes on the supplied device while an operation is running: WebGPU scopes are
device-global, and this module cannot serialize unrelated users of the device.
The future host adapter remains responsible for protocol negotiation, wire IDs,
Vulkan barriers/layout transitions and command submission ordering.

The browser gate passes 2,585 assertions across eight shader/layout combinations;
the byte-protocol gate passes 2,559, including resource exhaustion/recovery. Both
use independently checked real GPU pixels and independently counted Worker and
native resource ownership. See the [graphics execution report](../../../../docs/guest-vulkan-graphics-transport-20260926.md).

Still untested: negative clip depth and non-unit clip-w; graphics-specific device
loss and close during pending pipeline/map/submit; injected internal GPU errors;
simultaneous graphics/compute negotiation. Guest Vulkan graphics integration,
presentation, WebGL fallback and Firefox remain unimplemented. SwiftShader
evidence does not demonstrate physical GPU acceleration.
