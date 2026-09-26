# Public Vulkan graphics in the Linux guest

The separate public Vulkan application now executes through the pinned static
Khronos loader, guest ICD, vsock transport, SPIR-V translator and browser WebGPU
renderer. The first executed guest attempt passed on Google SwiftShader. This
is a bounded, nonconformant offscreen graphics capability, not a usable general
Vulkan/OpenGL driver or Firefox acceleration. Accepted runtime images and the
public Site are unchanged.

The application supplies two independently compiled vertex programs and two
fragment programs, combined with interleaved and separate vertex layouts in
eight rounds. Every round renders two draws in a CLEAR pass, then a compatible
empty LOAD pass, and reads a 73×51 RGBA8 image into guest memory. Its independent
barycentric oracle checks interior interpolated colors with a two-byte UNORM
tolerance, exact green exterior, alpha and orientation, excluding edge bands.
All 32 tail bytes survive: sixteen inside the buffer and sixteen beyond it in
the memory allocation. The 232,734 assertions are mostly individual pixel/byte
comparisons, not that many independent behaviors.

Bindings 5 and unsorted 7/2 declarations exercise slot normalization. Caller
structures and binding arguments are mutated after calls; shader modules,
pipeline layout and creation render pass are destroyed before drawing. Mapped
vertex data changes after recording are observed both with and without an
explicit HOST→VERTEX_INPUT barrier. Each round rejects a missing
TRANSFER→HOST barrier and a stale pipeline before effects, preserves mapped
bytes, then resets successfully. Malformed and unsupported-resource shaders
reject without preventing subsequent valid work.

The host reports exactly sixteen passes, sixteen draws, twelve vertex uploads,
eight readbacks and sixteen successful translations across 114 requests. Thus
the rejected submissions caused no extra graphics operations. Independent
ownership counters, captured before emergency cleanup, show one translator
Worker terminated, one device destroyed, twenty buffers destroyed and one
texture destroyed; all live counts are zero. Renderer resources, native objects
and allocated bytes are zero. The guest reports zero resources/allocated bytes
and a successful transport close. There are zero QA errors and zero Runtime
exceptions. One canceled Fetch event (`net::ERR_ABORTED`) is retained with its
cause unestablished.

Actual kernel logs establish 1 GiB and two CPUs. The visible, isolated browser
was Chromium 150.0.7871.114 with explicit SwiftShader fallback. The runner's
4,265 ms elapsed time is this small test's duration, not a Firefox startup or
hardware-performance measurement. The screenshot shows the guest desktop and
test page; it does not show an X11 presentation of the rendered test image.

## Reproduction and provenance

Commands are in
[the fixture README](../web/linux/tests/guest-vulkan-graphics/README.md).
All builds, profiles, caches, scratch and logs are under the verified ext4 task
root `/mnt/p6/build/guest-vulkan-graphics-20260926`.

- `commands-compile-run1`: complete guest ICD compiles with `-Werror`; eight
  source hashes and thirteen pinned header hashes match afterward.
- `application-build-gate-run1`: all 174 input hashes match after build/package.
  Fifty public Vulkan symbols resolve through the pinned upstream loader;
  Wasm validation and Linux import checks pass. The 383,945-byte application is
  SHA-256 `d8955d6da382eecd5e2d2e302129ed342ad5bfb4fc431b12e9d8b05d339d0570`.
- `guest-package-run1`: the isolated 40,879,736-byte archive is SHA-256
  `658b136729b91291b30fb7651727b0e4691b599b4869abab01b1f3dd96cbb4f8`.
  Only `/init` changes, one application is added, and 3,846 original records
  plus the archive tail are preserved. Accepted source images are unchanged.
- `guest-run1/result.json`: SHA-256
  `c1ccf737d99fcc7b791601fdb123d68ceca65170b88c01b2dac0500ed27009c9`.
  `guest-execution-gate-run2` checks 32 source/artifact hashes before and after,
  including seventeen compiled inputs, eight host sources and the frozen
  translator. The translator remains the accepted 771,221-byte graphics run2
  artifact, SHA-256
  `c1506c293785db309df6de17e481a9fb62ca9001823d3150f7a39cecc2575636`.

Earlier service attempts are preserved separately: `guest-service-run1` records
Chromium's overlong Unix socket path failure; `guest-service-run2` started
services that were later confirmed absent before execution. Their exit cause
is unestablished. `guest-execution-gate-run1` stopped before launching the guest.
The serving owner started `guest-service-run3` and kept its turn active through
the successful guest test. This observation does not prove why prior processes
disappeared.

## Shared compute regression

The existing public compute application also passes against the changed ICD:
501 checks, three dispatches, 128 shader-dependent output words and sixteen tail
word comparisons. Both guest and native GPU resources close successfully;
actual kernel markers again establish 1 GiB/two CPUs. The inherited compute
harness counts translator close calls but does not independently observe its
Worker lifetime. There are zero Runtime exceptions and one canceled Fetch event
with cause unestablished. This successful-path regression does not test the new
submission failure/device-loss behavior.

The new raw shader walk rejected the original all-zero malformed module inside
the guest. A first executed regression therefore completed all 499 guest checks
but correctly failed the host's required negative-translation assertion. The
client now retains that local rejection and adds a framed Compute entry-point
declaration without a valid module/function. This reaches host validation,
rejects with opcode 10/status -22, and recovers for valid execution. Host
acceptance assertions were preserved. Root made this small test-input edit
while the sole serving owner held the available child slot; command execution
and verification remained delegated.

Under `/mnt/p6/build/guest-vulkan-compute-20260926`, the accepted regression
uses `graphics-icd-regression-build-run2`, `graphics-icd-regression-package-run2`
and `graphics-icd-regression-guest-run3`. The application is 376,230 bytes,
SHA-256 `ee5d5ed052eb3977832f97b4af6e5478901e600e3619f8cf39e2fee9e24cd2e3`.
The guest result SHA-256 is
`b9e80eb73a86173f624836f1e891aaaf6daa84aeb6f9ef7d62848327d68c4b52`.
The graphics task's `compute-icd-regression-final-audit-run1` passes 39 read-only
audit checks, including all 26 current input/host/artifact hashes against the
pre-run snapshot.

Preserved failed attempts include a connection-refused run before guest startup
and the 499-check run with absent host rejection. The final runner exited zero
and its strict acceptance passed, but its wrapper incorrectly read the previous
run's result at line 35. The corrected read-only audit verifies the actual run3
result without rerunning the guest or replacing the failed wrapper evidence.

The sole serving owner completed cleanup, verified ports 4182/9396 closed,
removed four identity-checked owned candidate links and preserved every build,
profile/cache/log and the user's server. See the graphics task's
`guest-final-cleanup-run1/cleanup.json`. All prior service handles are retired.

Further work includes
graphics loss/pending-close tests, negative clip depth/non-unit-w, X11
presentation, WebGL fallback, sampled images/descriptors, indexed draws,
depth/blending, Mesa/Zink compatibility and Firefox integration. Native JIT and
hardware decoding also remain unresolved. The full goal has not reached 95/100.
