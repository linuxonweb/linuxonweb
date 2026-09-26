# Public startup performance and Firefox acceptance

Sites version 5 serves an immutable, content-addressed worker module graph on
the existing public origin. The stable platform module selects that graph;
stable application modules and the system manifest still revalidate. Kernel,
rootfs, Firefox executable, home storage and the Cloudflare DNS/TCP proxy are
unchanged. Future releases must retain prior published graph bytes if old open
tabs must keep creating workers after browser-cache eviction.

The matched lean Chromium 150 console test measured **55.048 seconds before,
3.486 seconds on the first v5 boot, and 2.693 seconds on its warm repeat**.
Actual host and guest lines verified 1 GiB/2 CPU, foreground visibility and
1280×720 Canvas2D; both new runs had zero system-image requests and no page
errors. They used 65 and 67 versioned worker requests. These are individual
observations, not a multi-run distribution or a Firefox launch speedup ratio.

The earlier instrumented diagnosis found essentially equal Wasm compilation
times across localhost and the public Site, but public worker dependencies
repeatedly incurred network latency. The immutable graph removes repeated
revalidation from worker creation. Ten unit checks, three workerd integration
tests, local browser startup and live changed-module/manifest hash, policy and
isolation checks pass. See [profile evidence](evidence/runtime-graphics-20260926/runtime-origin-profile.json),
[live asset checks](evidence/runtime-graphics-20260926/sites-v5-live-assets.json)
and [release provenance](evidence/runtime-graphics-20260926/sites-release.json).

## Actual guest Firefox

The public guest starts with verified 4 GiB/2 CPU. The serial launch message was
first observed at 16.150 seconds; the screenshot at 36.517 seconds showed the
real Firefox/Aurora window. Neither observation measures exact first paint.
There is no matched pre-change public Firefox launch baseline.

The existing five-case JavaScript fixture was copied to a nonce file in the
mounted home through the page's existing filesystem interface. Actual guest
Firefox opened the file, rendered it, ran all five checksums and saved the
result JSON into persistent Downloads. The report identifies Firefox and the
fixed 100-call batches. Update & restart subsequently preserved the preexisting
home marker, fixture and 2,528-byte downloaded result byte-for-byte.

The first Ctrl+L automation attempt also triggered the outer browser's reserved
shortcut, losing document focus. This was an automation limitation: clicking the
observed guest address bar, using paced Ctrl+A and checking focused `#fb` before
typing succeeded. The failed attempt remains recorded. These tests attach to
the page only; worker hooks and startup pauses are not used.

External-page acceptance is separate. The default Bing page timed out, and
`http://example.com` visibly reported a reset. Neither is recorded as success.
The controlled Google navigation passed visual review: `http://www.google.com`
redirected to `https://www.google.com/?gws_rd=ssl`, and actual guest Firefox
rendered the Google homepage with its lock indicator. The same-origin DNS
endpoint returned HTTP 200; the observer recorded successful WebSocket
handshakes and bidirectional traffic for Google ports 80 and 443. No separate
HTTPS navigation was needed. See [Firefox acceptance evidence](evidence/runtime-graphics-20260926/sites-v5-firefox.json)
and [the reviewed screenshot](evidence/runtime-graphics-20260926/sites-v5-firefox-google.png).
Bing's timeout cause remains unresolved.

## Destination restrictions in the retained proxy

Cloudflare documents that its Workers raw TCP API blocks outbound connections
to Cloudflare-owned ranges. This is a limitation of the unchanged network
backend, independent of the worker-asset cache policy.
[Cloudflare TCP considerations](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/#considerations)

Both an independent DNS snapshot and the deployed same-origin DNS endpoint
for `example.com` returned `104.20.23.154` and
`172.66.147.243`. Both fall within Cloudflare's published `104.16.0.0/13` and
`172.64.0.0/13` ranges, so this domain is a poor generic raw-TCP control.
[Google Public DNS answer](https://dns.google/resolve?name=example.com&type=A),
[Cloudflare IPv4 ranges](https://www.cloudflare.com/ips-v4/)

These answers confirm the destination restriction applies to the returned
addresses. The earlier reset's exact selected address was not captured, so its
attribution remains an inference. The follow-up recorded DNS answers for
example.com, Google and Bing and the real Firefox Google request's WebSocket
handshake status and frame counts/lengths. It retained no TCP payloads or
credentials. Google rendered through the unchanged backend; that establishes
actual Firefox network success for this destination, not universal reachability.

Native guest JIT, guest GL/Vulkan and hardware video decoding remain separate
unimplemented ports. The isolated guest C→WebGPU→X11 proof uses SwiftShader,
is not deployed, and its narrow prototype assessment is not a full-goal score.
