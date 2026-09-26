# Experimental graphics transport

This opt-in profile connects the real SPIR-V translator and declarative renderer
to the existing guest GPU byte stream. It is not a Vulkan implementation by
itself. Guest Vulkan command translation and application execution are separate
gates; this transport does not establish Firefox, Zink, hardware acceleration,
presentation, or WebGL fallback support.

`serveGPU({…}, {allowGraphics:true, graphicsTranslatorOptions:{url,sha256}})`
creates a hash-pinned translator and renderer on the session's existing device
before HELLO advertises `graphicsProfile:1`. Compute and image-clear capabilities
remain independently opt-in. The old opcodes keep their existing meanings.
There is one device, sequential request loop and typed resource table per
connection. Neither JSON nor SPIR-V accepts a guest-supplied WGSL replacement.

The existing 16-byte little-endian header and status-prefixed reply framing are
unchanged. Creation replies contain one nonzero uint32 resource ID. IDs increase
monotonically and cannot be reused after destruction. Successful upload/pass
replies have no body. Shader and renderer validation failures return -22; bounded
allocation failures return -12. These permit subsequent recovery. Unavailable
devices return -19 and internal GPU failures -5; either ends the session after
the error reply when the transport still works. Disconnect, deadline and device
loss close the renderer and Worker and release the device and all resources.

| Opcode | Request | Successful reply |
| --- | --- | --- |
| 16 GRAPHICS_SHADER | Actual SPIR-V bytes, 20–65,536 bytes, multiple of four | Shader ID |
| 17 GRAPHICS_PIPELINE | UTF-8 pipeline JSON, 1–65,536 bytes | Pipeline ID |
| 18 VERTEX_BUFFER | uint32 byte size, 4–65,536, aligned to four | Buffer ID |
| 19 VERTEX_UPLOAD | uint32 ID, offset, byte count, then exactly that many bytes | Empty |
| 20 GRAPHICS_TARGET | uint32 width, height, each 1–512 | Target ID |
| 21 GRAPHICS_PASS | UTF-8 pass JSON, 1–65,536 bytes | Empty |
| 22 GRAPHICS_READBACK | uint32 target ID | Actual packed top-to-bottom RGBA8 bytes |

Upload offsets/counts must be aligned to four and remain inside the allocation.
Readback is exactly width × height × 4 bytes, at most 1 MiB, with no dimensions
or padding in its reply. The caller already owns the target dimensions.
Existing DESTROY (7) releases any resource ID, including these new kinds.

Pipeline JSON is:

```json
{
  "vertex": {"shader": 1, "entryPoint": "original_vertex_name"},
  "fragment": {"shader": 2, "entryPoint": "original_fragment_name"},
  "vertexBuffers": [{"stride": 20, "attributes": [
    {"location": 0, "offset": 0, "format": "float32x2"},
    {"location": 1, "offset": 8, "format": "float32x3"}
  ]}]
}
```

Shader reference records contain only `shader` and `entryPoint`. Names must
equal the SPIR-V original entry names and stages must match. Emitted WGSL names
are resolved internally. Optional pipeline fields and nested vertex declarations
follow [RENDERER.md](RENDERER.md), with its strict supported-state validation.
Pipeline lifetime does not depend on surviving shader IDs. The host charges
retained shader metadata/WGSL again for each pipeline, so shader destruction
cannot bypass the shared 16 MiB allocation budget.

Pass JSON contains `target`, `loadOp`, `storeOp`, optional `clearColor`, and
`draws` (0–256). Each draw contains `pipeline`, `vertexBuffers`, `vertexCount`
and optional `firstVertex`, `instanceCount`, `firstInstance`, `viewport`,
`scissor`. Vertex bindings (0–8, matching pipeline layout order) contain
`buffer` and optional byte `offset`/`size`. Vulkan binding-number normalization
belongs to the guest driver. All other draw/pass semantics follow RENDERER.md.

Unknown fields, wrong-type IDs, stale IDs, reserved prototype-related keys and
unsupported values reject. The host resolves every draw reference before
recording, and the renderer validates the entire pass before native encoding or
submission. A bad later draw cannot partially clear or draw the target. Successful
passes submit once; readback adds a separate staging submission. Native failure
after submission cannot roll back pixels. The renderer invalidates that target
until a later successful clear, and internal failures terminate the session.

The shared host limit is 64 resources and 16 MiB of accounted allocation across
all profiles; graphics readback additionally checks row-aligned staging against
that budget. The renderer independently tracks and caps its native allocations.
The host does not nest its legacy error scopes around renderer operations;
sequential request processing prevents overlapping device-global scopes.

The current guest driver may impose smaller limits than this transport. It must
advertise only capabilities it implements, map terminal errors to device loss,
copy caller state and validate whole command streams before host effects.
