Continue improving `/mnt/p3/project/linux/linuxonweb` through the rubywebterm MCP tool, which the user requested as `@rubewebterm`.
works fr about 5hours do not stop until get goal done
The goal remains a real usable browser Linux desktop: usable Firefox within 30 seconds, genuine Firefox JIT performance, broad OpenGL/Vulkan support, at least 50% of matched host-browser performance, Android and iOS usability, and real signed APK packages including Python, Node.js, and common command-line tools.

Use built-in subagents with the same model and reasoning level as the main agent. The main agent acts as CTO/project manager and delegates implementation, debugging, testing, builds, deployment, and detailed reviews. Keep the main context focused on decisions and evidence.

Read `AGENTS.md`, `agent/continue.md`, `agent/task.md`, `agent/next-agent-prompt.md`, and `docs/gpt6-astra-pro_builtin-agents_rubywebterm_acceptance-20261103.md` before changing anything. Preserve existing work, create an appropriate checkpoint, and start a new named task branch. The previous frozen branch is `gpt-6-astra-pro_builtin-agents_linuxonweb-20261103`; its final commit is `81103b2ec04a8a4f8453617ca128448e831645bc`.

Completed delivery and recovery entry:
https://fileharbor-meak.basicgleam65.chatgpt.site/raw/meaklocaldev/85337f77-8669-4c34-b004-c691237d91ba/linuxonweb_gpt-6-astra-pro_builtin-agents_rubywebterm_20261103_complete/index.html

The previous evidence-based acceptance score was 42/100. Do not claim 95/100 or completion without passing the actual target gates. Work within a fresh five-hour budget, with up to one additional hour only for important bug fixes. Record iteration scores, start/end times, build/test durations, and unresolved failures honestly.

Prioritize these engineering tasks:

1. Implement a safe Firefox cache-invalidation lifecycle. A root-owned `/opt/firefox/browser/.purgecaches` marker was confirmed to prevent cache reuse. An isolated removal test allowed existing startup/script caches to be read, but no safe per-image/per-profile migration protocol or startup-speed acceptance exists yet.

2. Fix Firefox’s native restart/spawn path and continue the legitimate Firefox/JIT build route. “Restart normally” reaches an unimplemented detached-process operation and exits without restarting. Do not use blanket exit-code respawning as a substitute. Respect protected source/build permissions; do not bypass access controls.

3. Measure actual usable Firefox readiness for both cold and warm launches. A process-start log is not acceptance. The latest full Firefox scene measured approximately 3.48 fps against 59.85 fps on the host, about 5.8%, with stalls included.

4. Continue graphics work with explicit backend selection. The accepted native Vulkan fixture used WebGL presentation. Full OpenGL/Vulkan conformance remains unfinished. WebGPU device loss at canvas/ImageBitmap export has a minimal reproduction. Do not silently fall back or describe a fixture as full API support.

5. Preserve the real signed APK system and finish missing common ports, especially Node.js, wget, tar, and findutils. The current repository contains apk-tools, reused BusyBox, certificates, curl, Python, coreutils, gzip, grep, sed, and a Vulkan demo. `/home` persists, but package files and their database reset together on restart; design and verify package persistence.

6. Preserve the accepted Android HTTPS worker fix. The tested device was an MI8 with Android 15 and Brave/Chromium 148. The accepted package-console configuration was one CPU and 512 MiB. Native commands and signed repository updates passed. Python installation exceeded a 45-second test bound; full Firefox and iOS have not passed acceptance. Recheck device availability before using ADB and clean up only owned tabs, processes, and mappings.

Keep write buffering, cache seeding, and packed Firefox-resource experiments disabled until they pass safety and performance acceptance. Write buffering previously lost acknowledged data on Stop. The packed-resource candidate reduced filesystem allocation but increased actual memory use and lowered frame rate.

Monitor CPU, RSS, and available RAM every second during tests; sample PSS every five seconds to limit observer overhead. Respect the enforced three-CPU ancestor limit. Serialize guest boots and heavy browser benchmarks. Use short Chromium temporary paths. Investigate unexpectedly long tests/builds and preserve failure evidence.

Verify the actual production browser path, including decompression, rootfs composition, desktop launch, persistence, signed package installation, and Stop cleanup. A Node-only test or kernel boot is insufficient.

Keep Git history, exact task instructions, AGENTS/continuation notes, per-iteration records, live preview, source archive, and cloud recovery artifacts current. Preserve the original encrypted base, final cumulative increment, runtime archive, and private recovery key relationship. Never publish private keys, access grants, cookies, or device identifiers in source archives.

Finish with measured results against the original gates, remaining limitations, working access links, and verified recovery instructions. If the time budget ends first, provide an honest incomplete result and a precise continuation prompt.
