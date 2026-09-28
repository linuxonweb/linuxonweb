# Firefox DevTools console in the guest — 2026-09-28

Status: fixed in a local candidate `b21b2cac65a3`. It is **not promoted** to
`web/linux` or Sites. Compact evidence is in
`docs/evidence/firefox-devtools-20260928/firefox-devtools.json`. Raw runs are
under `/mnt/p6/build/firefox-devtools-20260928/` (ext4, task-local `tmp`).

## Symptom

On Sites v9 (`29331a186e50`), F12 opens a DevTools area that stays blank and
dark. Run `repro-run2` reproduces this in the real guest. That runner's
`pass=true` covers only startup and home; the toolbox itself was blank.

## Root cause

Guest stderr was captured with diagnostic prefs (`browser.dom.window.dump.enabled`
and related prefs; test-only). It shows this chain:

```
Error: Missing session data in `sharedData`   ContentProcessWatcherRegistry.sys.mjs:47
Failed to sendQuery in DevToolsProcessParent  DevToolsProcessParent:watchTargets
Exception while opening the toolbox           toolbox.js startListening
```

This Wasm Firefox runs as a single process, so the parent process also hosts
the `DevToolsProcess` JS actor. The parent writes the watcher session through
`Services.ppmm.sharedData`, a WritableSharedMap. The registry reads it through
`Services.cpmm.sharedData`. In the parent, that is the read-only SharedMap,
rebuilt by mapping the serialized descriptor a second time.

The archived wasm `MemMapSnapshot::Finalize` keeps the writer's mapping without
freezing or msync. Its own comment notes that the wasm mmap shim creates
independent memory for a second mapping of the same descriptor. The reader
therefore sees stale bytes, `DevTools:watchedPerWatcher` resolves to null, and
`watchTargets` throws.

## Fix (adapter, no rebuild)

`tools/guest-rootfs/package-firefox-devtools.py` replaces exactly one packed
chrome module:
`opt/firefox/browser/chrome/devtools/modules/devtools/server/connectors/js-process-actor/ContentProcessWatcherRegistry.sys.mjs`.

It adds `getWatcherSharedData()`, which selects the map by process type:

- In the parent process (`PROCESS_TYPE_DEFAULT`), it returns
  `Services.ppmm.sharedData`. The writable map holds the same entries, flushed by
  ParentProcessWatcherRegistry.
- In any other process, it returns `Services.cpmm.sharedData` unchanged.

Both former `const { sharedData } = Services.cpmm;` reads now use it.

The packager pins the v9 image, manifest and member hashes. It preserves record
order, metadata apart from size, and the tail, and leaves every other CPIO
record unchanged. The output is gzip -9 with mtime 0.

| Item | Value |
| --- | --- |
| Member SHA-256, before | `46f85178…ef815` |
| Member SHA-256, after | `d860fcdd…482f1` |
| Candidate | `/mnt/p6/build/firefox-devtools-20260928/candidate-run1/initramfs-firefox.cpio.gz` |
| Candidate size | 88,378,850 bytes |
| Candidate SHA-256 | `d3d9afca272947ba1b6bb743585a6f0cf33de90c54adff1cd85b5c5bf9d8002b` |
| Candidate manifest SHA-256 | `8fca6cf1…cc45` |

## Evidence (real guest, finite runner)

The runner is `tools/guest-rootfs/test-firefox-devtools.mjs OUTPUT IMAGE_DIR STEPS [diag]`.
It owns one in-process dev server (port 4193) and one headless Chromium (CDP
port 9403). It sends real key input through CDP and seeds `/home` with a marker,
a fixture page and `user.js`.

Run `cand-accept-run1` used steps `console,eval,inspector,warm` without
diagnostic prefs, and passed. I inspected every screenshot:

- **Console:** Ctrl+Shift+K opened the Console tab within 20 s. It shows
  `devtools-ok` from `devtools-probe.html:3:9` (screenshot `15-console-020s.png`).
- **Evaluation:** typing `1+2` then Enter shows `3` (`20-eval-040s.png`).
  `document.title="dt-"+(1+2)` then changed the page title to `dt-3`, and the
  page wrote a download file into the guest to prove it.
- **Inspector:** Ctrl+Shift+C shows the DOM tree, Rules, Layout and Box Model
  (`30-inspector-040s.png`).
- **Startup, warm boot and home:** cold fixture readiness took 50.4 s. The warm
  reload auto-opened the homepage in 29.3 s with zero system-image requests. The
  home marker was preserved, there were zero Runtime exceptions, and Chromium
  exited 0 with the server closed.
- **Diagnostic run `cand-diag-run1`:** F12 opened the full toolbox on the
  Inspector. Ctrl+Shift+J opened the Browser Console window with messages.

Failed attempt: `repro-run1` hit a runner browser-readiness deadline, because
Chromium wrote no `DevToolsActivePort` when given an explicit port. The runner
now polls `/json/version` instead.

Cleanup: ports 4193 and 9403 are free and no owned processes remain. User server
PID 1591443 is unchanged.

## Limitations

- This is a local candidate only. No promotion, no update-path test and no
  public acceptance were run.
- The underlying SharedMap/mmap incoherence is not fixed. Other parent-process
  `cpmm.sharedData` readers may be affected; the log also shows `bad serialized
  structured data`. A proper fix belongs in the mmap shim or in `MemMapSnapshot`,
  which requires a rebuild.
- The Browser Console's multiprocess mode does not apply in this single-process
  build.
- Timings are fixed-wait observations, not benchmarks.
