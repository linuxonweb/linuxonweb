# LinuxOnWeb progress — 2026-11-08

## Scope and starting point

New task branch `gpt-6-linuxonweb-20261108-progress` from `db40504` with tag `checkpoint-linuxonweb-20261108-db40504`; preserves the historical branch, runtime and untracked build artifacts. The prior **45/100** acceptance remains the only validated overall score. Original rubric and full gates stay in `agent/continue.md` and the earlier final report. The 2026-11-03 checkpoint is not evidence of current public-preview availability.

## Correction in this iteration

A preserved real-browser cold run had usable Firefox at 105.438s and a separate native close failure. `native-quit-dialog.png` shows the browser *without* a confirmation dialog at the point when the old harness blindly clicked. `native-close.png` shows the native Firefox Nightly confirmation dialog appearing only later; the original harness mislabeled this as a shutdown failure.

`tools/startup-benchmark/gpt6-astra-current.mjs` now polls actual CDP screenshots and requires the visible same-geometry Nightly confirmation before clicking the known native Quit action. It detects clean native exit without a dialog separately, records observation evidence and the number of attempts, and fails closed if no supported dialog is seen within the bounded interval. No native Firefox, production runtime or image bytes were modified.

The new `native-quit-visual.mjs` decodes bounded 8-bit RGB/RGBA PNG scans and checks four dialog-background pixels, a dimmed background pixel and a purple button pixel. This is a fixture-specific conservative detector, **not** a general vision or accessibility API. A different browser theme/layout must be explicitly supported and retested rather than bypassing the check.

Validation: `node --test tools/startup-benchmark/native-quit-visual.test.mjs web/linux/firefox-cache-lifecycle.test.mjs` passed **13/13** checks, including before/after images captured in the original run and existing exact-image cache proof checks. `node --check tools/startup-benchmark/gpt6-astra-current.mjs` and `git diff --check` passed. This does **not** establish an actual new native exit, warm cache reuse, native restart, 30s Firefox startup or 50% host speed.

## Continue from here

1. Re-run the existing real native/HTTPS cache lifecycle measurement with full 3-CPU ancestor monitoring and current-launch exit 0; verify closed profile and warm navigation, then corruption/image-generation change tests. Do not turn on default cache lifecycle until all gates pass.
2. Profile public HTTPS cold-image transport: last observed WAN request hit 150s before the native guest began booting; do not conflate transfer with executable time.
3. Respect protected native Firefox sources; no unauthorized builds or blanket exit-code respawns. General JIT, broad OpenGL/Vulkan, 50% host graphics, signed guest Node.js and full mobile Firefox remain unmet.
4. Maintain actual runtime/recovery artifacts and preview status; never publish private keys or authorization tokens.

Notion status: https://app.notion.com/p/4122764382088153ba54dd7ccde00e4d
