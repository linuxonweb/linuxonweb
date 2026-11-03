# Real Linux/Wasm APK packages

This tooling targets the project's `wasm32-unknown-linux-musl` ABI. It does not install stock x86/ARM Alpine packages and does not replace Linux programs with browser JavaScript.

## Current acceptance

The 2026-11-03 component run in `evidence/apk-runtime-20261103.json` passed in 7.73 seconds with 512 MiB guest memory and three actual Chromium CPUs. It executed apk-tools 2.14.12, verified and installed a signed BusyBox package, ran the installed binary, executed a post-install script through a real spawned/chrooted guest process, queried the installed database, and removed the package. The same run rejected an altered signature, an untrusted signing key, and a correctly signed archive carrying an invalid per-file SHA1. A post-install script returning 7 was reported as a failed transaction. This is component acceptance; normal desktop integration is a separate gate. A later real guest network run fetched the signed index and all five packages through libfetch over the guest DNS/TCP stack, installed Python and curl, ran them, removed their files, and retained the base package database. The fixture does not substitute browser JavaScript for guest network clients.

`run-smoke.mjs` freezes runtime assets on first read, hashes them, owns a fresh browser profile and checks actual CPU equality. `bounded.py` records wall time and one-second CPU/RSS/available-memory samples for its owned process tree. RSS sums can double count shared pages; they are not called PSS. Browser and process cleanup are scoped to owned resources.

## Upstream and ABI changes

apk-tools source: https://gitlab.alpinelinux.org/alpine/apk-tools/-/archive/v2.14.12/apk-tools-v2.14.12.tar.gz

SHA256: `62dcb1951108ba24c7478bbca402ea9a34b3bb09baa161b220d0a18e15645e35`.

The builder explicitly selects wasm32, links the real static OpenSSL/zlib libraries, and omits the optional host Lua help generator. The unavailable mmap fast path falls back to apk's buffered file reader. The unavailable fork path uses posix_spawn plus a small guest helper that applies chroot and executes package scripts. Script failures propagate. Signature, archive hashes, per-file checksums, solver and database behavior remain upstream. ELF-only linker switches are removed for wasm-ld.

`package-apk.py` creates signed APK v2 streams with `.PKGINFO`, compressed-data SHA256, required per-file PAX SHA1 metadata and directory records. Its private signing key must be supplied from outside the repository. The runtime public key belongs in `/etc/apk/keys`; never publish the private key. `make-fixtures.py` creates intentionally invalid packages for tests, including a signed bad per-file digest; fixture private keys must remain outside public archives.

BusyBox 1.38.0.git was imported from the existing clean Firefox distribution, not rebuilt during this task. Its executable SHA256 is `f772c352356483bbe0a44eb07b1f156df8e88920ae3d0325f38026be0ba6df9c`. The source distribution SHA256 is `60847fb853398000566e822884816fdd8a75d6c8e7776189ba3fcab1672859fa`. Its provenance is recorded in the package receipt.

## CPython work

Official CPython 3.14.6 source: https://www.python.org/ftp/python/3.14.6/Python-3.14.6.tar.xz

SHA256: `143b1dddefaec3bd2e21e3b839b34a2b7fb9842272883c576420d605e9f30c63`.

The host build Python is also 3.14.6. Cross configuration uses the actual Linux/musl target and static extension modules, not WASI or Emscripten. The upstream configure getaddrinfo probe was compiled for the guest and passed its IPv4/IPv6 numeric-address checks before caching its result. The custom libc lacks mmap/mprotect, so mimalloc is disabled using CPython's supported `--without-mimalloc` option. The real guest interpreter passed 16 checks in 13.615 seconds: arithmetic, Unicode, file write/read/rename/stat, JSON, zlib, SHA256, secure randomness, SSL context and CA loading, localhost lookup, a threaded TCP echo, and real `os.posix_spawn` with exit-status propagation. This proves SSL context creation, not an end-to-end HTTPS request. `subprocess.Popen` remains unsupported; `os.posix_spawn` works. Optional mmap, ctypes, remote debugging, curses, Tk, readline and DBM modules are unavailable and are listed explicitly in `configure-python.py`. No fork success is simulated.

Relevant upstream configuration references: https://github.com/python/cpython/blob/v3.14.6/configure.ac and https://github.com/python/cpython/blob/v3.14.6/Doc/using/configure.rst .

## Persistence

The normal desktop currently persists `/home`; `/usr`, `/lib`, `/etc` and the package database are reconstructed from the initramfs at boot. Until an explicit signed cache/world restore mechanism is implemented and restart-tested, package installations are diskless: installed files and the database reset together. Do not persist only `/lib/apk/db`, because it would claim that vanished files remain installed.

## Build tools

`build-apk-tools.py`, `configure-python.py`, `package-apk.py`, `make-smoke.py` and `run-smoke.mjs` accept explicit source/toolchain/output inputs. Inspect their `--help`/usage and use a fresh output directory. Keep TMPDIR/TMP/TEMP on disk. The current Nix compiler is LLVM 22.1.8 for wasm32-unknown-linux-musl; the explicit static dependency paths are recorded in each build receipt. These external toolchain inputs are not silently treated as ordinary Alpine sysroots.

## Repository contents and recovery

The first signed repository contains apk-tools 2.14.12, BusyBox 1.38.0.git, CA certificates, curl 8.21.0 and CPython 3.14.6. APK and Python were compiled for this guest during the task. BusyBox, curl and the CA bundle were reused from the pinned distribution, with binary hashes and provenance retained. BusyBox applets are not counted as independently compiled GNU packages. GNU coreutils, wget, tar, gzip, findutils, grep and sed have pinned source downloads; they are not accepted packages until their build and guest checks pass. Node.js is not included: no compatible Node/V8 guest port has been found.

`recipes/*.json` names the exact input artifacts and their accepted hashes. `rebuild-repository.py --artifacts DIR --output NEW_DIR --key PRIVATE_KEY --public-key PUBLIC_KEY --host-apk HOST_APK` rebuilds signed archives and the index from those inputs. The private key is external and never enters a package or source export. Use the source builders to regenerate compiled inputs; `make-smoke.py` exposes a streaming reader for extracting reviewed reused binaries from the pinned distribution. The normal-image overlay builder will consume the actual database exported after guest installs, rather than inventing installed package records.
