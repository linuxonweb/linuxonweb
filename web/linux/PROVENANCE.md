# Native Linux browser payload provenance

This directory stages the browser boot payload from the read-only sibling
checkout `/mnt/p6/project/linux/linuxwasm-wasm/tools/wasm`.

The runtime tree under `dist/` and `vmlinux.wasm` were copied byte-for-byte.
The Firefox initramfs was extracted and repacked as a valid `newc` archive after
adding minimal `firefox` uid/gid 1000 account records and changing `/init` to
create a writable profile and launch Firefox through BusyBox `su` at
`https://www.bing.com`; the sibling checkout was not modified. The browser
gunzips this payload before passing the raw CPIO to the wasm kernel.

| staged asset | bytes | SHA-256 |
| --- | ---: | --- |
| `vmlinux.wasm` | 6,281,750 | `21c15250e6f27c95fef333a16ffbc411159838f194f0ea19f8adcda3f21b0e75` |
| `initramfs.cpio` | 40,424,448 | `47e748df7eb2a6728fbdcd299245be5e1c5abc4c263abf05112b3d01baa239f2` |
| `initramfs-firefox.cpio.gz` (Bing/su uid-1000 patched) | 87,144,428 | `85dbee2c9e6b611c44e1bc08e32f97044b38c6f96cf6cb0d14b533ac3d91183a` |
| `dist/index.js` | 16,584 | `1a4a0310b55f9b33634afc5b24a3be985e490c0b24917e9e200adbf1297b43d4` |
| `dist/platform.js` | 4,046 | `a3b171470c5e7bee3d4aea9c54ed9af1d7ed73bc657dada36372b42d02870440` |
| `dist/worker.js` (user-memory growth adapter hooks) | 19,985 | `b8aa162801d8f5273356037fb834a3b337a945f67dc81fb7a305fbc10b03af91` |
| `dist/user-memory-growth-adapter.js` | 4,842 | `7500739662e7abed6a99732f4321e2ec0865a2bc9d8c8816c633217dd48adf83` |
| `dist/USER_MEMORY_GROWTH_ADAPTER.md` | 1,285 | `8c9b6ad067e883daf0b6a3e70685f2a10b7cc2a4e315f7d4b9a59ab733a5e0be` |
| `node_modules/@xterm/xterm/lib/xterm.js` | 289,441 | `1f991ac3b4b283ebf96e60ae23a00a52765dd3a2e46fa6fdda9f1aab032f7495` |
| `node_modules/@xterm/addon-fit/lib/addon-fit.js` | 1,497 | `bdaefa370b1bfc42ee88d46fe6072400902a4d4b2d45cd93438dda9b23c97089` |
| `node_modules/@xterm/xterm/css/xterm.css` | 5,559 | `ba8e6985669488981ccf40c0cefe3aba80722cb6c92de7ad628b0bd717faf2b6` |

`vmlinux.wasm` embeds `.linux.sections` and `.linux.initramfs`; the external
CPIO is selected by `main.js` for the GUI/Firefox userspace. The page requires
COOP/COEP/CORP response headers because the runtime uses shared WebAssembly
memory and module workers. Firefox auto-boot raises the guest memory setting to
the supported 4 GiB maximum; the normal console/X modes retain the 1 GiB default.

Validation of the su/4 GiB progress state: a 75-second visible Chrome run at
`http://127.0.0.1:4173/linux/index.html?firefox=1` used 4096 MB and reached
Firefox GTK/Gecko initialization, then stopped with
`RuntimeError: memory access out of bounds`. No Bing request was observed.
Screenshot: `/tmp/linuxwasm-su-4gb-75.png`.

## User-memory growth adapter (2026-09-21)

`dist/user-memory-growth-adapter.js` is an out-of-tree bridge for user
`WebAssembly.Memory` ranges. `dist/worker.js` grows user destinations before
`write`, `write_zeroes`, and futex atomic access, and grows successful
`brk`/`mmap`/`mremap` ranges returned by the Linux syscall import. The kernel
destination used by `read` remains on bounded `memory_bytes()` access and is
never grown. Growth failures retain the existing copy/zero/futex failure
returns; syscall failures are logged with `console.debug` and leave the kernel
return unchanged. The generated sibling tree and `sources/` checkouts remain
untouched.

Validation evidence:

- `node --check web/linux/dist/worker.js` and
  `node --check web/linux/dist/user-memory-growth-adapter.js` both exited 0.
- A Node ESM edge test grew shared memory from 1 to 2 pages for a boundary
  write, grew it from 2 to 5 pages for an x86 `mmap` result, and rejected both
  a `Number.MAX_SAFE_INTEGER` address plus length 2 overflow and a range beyond
  an 8-page maximum;
  it printed `adapter edge tests: PASS`.
- A bounded visible Chrome run at
  `http://127.0.0.1:4173/linux/index.html?firefox=1` remained stable for 95 s
  after the adapter hooks, with no `RuntimeError: memory access out of bounds`
  and no observed Bing request. This validates runtime stability only; it is
  not a Firefox or Bing completion claim.
