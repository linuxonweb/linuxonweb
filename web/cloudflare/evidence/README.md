# Deployment validation — 2026-09-26

Worker: https://linuxonweb.testcatty.workers.dev/

`worker-firefox-bing.png` shows the guest Firefox rendering the live HTTPS Bing page, including its search field, background image and cards. The guest uses the deployed Worker WebSocket TCP proxy; this is the Firefox window inside the Linux framebuffer.

Validation used isolated Chromium 150.0.7871.114 with a fresh profile, 1280×720 guest display, two guest CPUs and the supported 2 GiB memory setting. Chromium profile/cache/temporary files were moved to disk because the host `/tmp` tmpfs was full. The deployed Firefox default remains 4 GiB. Existing user browsers were not changed.

- `NETWORK_TESTS=1 npm test`: 9/9 passed, including all staged source hashes, HEAD/304, isolation headers, redirects, private/origin rejection, multipart and single-part byte ranges, live Bing DNS/TCP HTTP, and certificate-verified Google TLS over the binary WebSocket tunnel.
- `npx wrangler deploy --dry-run --outdir dist`: passed without restaging the archived guest image.
- Deployed Bing TCP port 80 and TLS port 443 both returned HTTP 200; TLS certificate verification succeeded.
- The deployed full Firefox archive streamed all 87,821,007 bytes with SHA-256 `e726ede312e1164a2081f4294374774e02ac4574126ea1602889f442c477ca25`.
- A byte range crossing the 20 MiB chunk boundary matched the immutable staged chunks.
- Cloudflare tail telemetry, reported by the deployment agent, showed 2 ms CPU for the native full-archive stream after replacing JavaScript chunk copying with native stream piping.

`network-smoke.txt` contains the production network and archive verification results. Browser screenshots before the final successful run were not retained here as successful evidence.

## Public Sites and mobile keyboard

Final public URL: https://linuxonweb.exact-coot-7512.chatgpt.site/

A fresh isolated Chromium profile using the deployed defaults (4 GiB RAM, two guest CPUs, 1280×720 display) booted Firefox and rendered the live Bing page. `sites-firefox-bing.png` includes the new Keyboard button.

At a 430×932 mobile viewport, clicking Keyboard focused the native textarea with `inputmode=text`. Real `Input.insertText` events passed text into the guest: the initial address attempt appeared in Bing's search field. A subsequent Keyboard-panel Ctrl plus native `l` selected Firefox's address bar; native text input typed `https://www.google.com`, and the panel Enter button submitted it. Firefox then rendered the live Google page. No guest callback was invoked directly.

- `sites-mobile-keyboard.png`: mobile viewport and visible keyboard controls.
- `sites-keyboard-google-url.png`: text visibly entered into the guest Firefox address bar.
- `sites-firefox-google-keyboard.png`: live Google page after keyboard-driven navigation.
- `browsercheck.json`: compact structured results and actual test settings.

The native textarea focus and guest typing path were verified. A physical Android/iOS keyboard popup cannot be observed in headless Chromium.
