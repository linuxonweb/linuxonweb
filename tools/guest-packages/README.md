# Real Linux/Wasm APK packages

This tooling targets the project's `wasm32-unknown-linux-musl` ABI. It does not install stock x86/ARM Alpine packages and does not replace Linux programs with browser JavaScript.

## Current acceptance

The 2026-11-03 component run in `evidence/apk-runtime-20261103.json` passed in 7.73 seconds with 512 MiB guest memory and three actual Chromium CPUs. It executed apk-tools 2.14.12, verified and installed a signed BusyBox package, ran the installed binary, executed a post-install script through a real spawned/chrooted guest process, queried the installed database, and removed the package. The same run rejected an altered signature, an untrusted signing key, and a correctly signed archive carrying an invalid per-file SHA1. A post-install script returning 7 was reported as a failed transaction. This is component acceptance; normal desktop publication remains a separate gate. A later real guest network run fetched the signed index and all five packages through libfetch over the guest DNS/TCP stack, installed Python and curl, ran them, removed their files, and retained the base package database. The fixture does not substitute browser JavaScript for guest network clients.

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

## Accepted full-image integration

The first accepted candidate appends a standard newc overlay to the byte-identical decoded Firefox archive and encodes the result as one gzip member. Its original `/init`, native Firefox executable and `/home` image contents remain unchanged. A real guest install exported the four-package base database used in the overlay: apk-tools, BusyBox, CA certificates and curl. The public HTTPS repository supplies Python on demand.

`evidence/normal-image-runtime-20261103.json` records a 70.58-second, two-boot functional gate with 2 GiB guest RAM. The original `/init` booted in its existing console mode. The desktop admin account used `sudo apk add python3`; Python ran without a PYTHONHOME workaround. Removal and reinstall worked. A second fresh rootfs had neither Python files nor its database entry, while a file in the separately persisted `/home` remained. The existing guest sudo binary returned Exec format error; rebuilding the unchanged `tools/guest-rootfs/sudo.c` against the current native ABI fixed it, retaining its UID0/1000 restriction and 04755 mode. This is guest administration only.

Reproduce the fixture with `run-smoke.mjs IMAGE NEW_OUT - tools/guest-packages/normal-image-check.json`. `overlay-rootfs.py` requires the pinned original image, signed packages, exported actual base database, public repository URL and optional rebuilt sudo helper. It records every overlay member and unchanged native hash. A 1 GiB full-image attempt failed while unpacking the large original rootfs; this remains a mobile footprint problem, not a reason to claim mobile support.

### Browser compression regression and correction

The first candidate used concatenated gzip members. The kernel-direct package fixture and Node decompressor accepted it, but real Chromium DecompressionStream rejected it before production boot. The prior image was restored. `repack-single-gzip.py` streams the exact same decoded CPIO sequence into one gzip member and checks decoded SHA256/length identity. `overlay-rootfs.py` now always writes one member. Real Chromium streaming decode and the actual production desktop path are required before republishing; a successful Node or kernel-only check is insufficient. The rejected image and evidence remain retained.

## Python layout revision and current signed repository

Python 3.14.6-r1 keeps the exact interpreter and standard-library ZIP from r0, adds the upstream `os.py` landmark and the expected `lib-dynload` directory, and requires no `PYTHONHOME` override. The ordinary admin upgrade test passed `python3 -m json.tool --help` and all 16 runtime checks with empty stderr. The earlier four-second production observation was too short; the r0 warning was real but its imports did eventually work. The r1 package has a new version and hash; the old snapshot is immutable.

The live, read-only repository is `https://a3cf34ce40307517.5x7aqstuceku.opentunnel.xyz`. Put this root URL in `/etc/apk/repositories`; apk itself appends `/wasm32`. It receives append-only versioned packages and atomic signed-index updates. `publish-repository.py` checks package signatures and exact receipt hashes before changing public files; it rejects replacement of an existing version or public key. The separate HTTP service exposes only package, index, receipt and public-key paths, with no shell, TCP bridge, messages or private preview session. Its lifetime depends on the user host service and tunnel; immutable FileHarbor snapshots provide durable recovery.

The immutable Python-r1/coreutils snapshot is `https://fileharbor-meak.basicgleam65.chatgpt.site/raw/meaklocaldev/72701b51-5611-4cef-8136-189f6265a61d/linuxonweb_gpt-6-astra-pro_builtin-agents_rubywebterm_20261103_pkgsr1/`. The normal-image builder can add it under the explicit `@snapshot` tag. Selecting that tag is a deliberate fixed-version fallback, not a claim that the snapshot receives future updates.

`evidence/live-repository-runtime-20261103.json` records real guest HTTPS signed-index fetch, `apk add python3 coreutils`, ordinary admin Python execution, native GNU file/hash/sort commands, and removal of both packages and aliases. The complete owner took 106.94 seconds, including boot and all checks; this is a functional gate, not a Firefox launch benchmark. GNU coreutils 9.11 was compiled from pinned upstream sources, not BusyBox aliases. Its tested aliases are installed under `/usr/bin`; use that path explicitly when `/bin` BusyBox appears first in PATH. Fork-dependent operations return ENOSYS and remain unsupported. Gzip, grep, sed and the remaining GNU ports are only accepted after their own runtime gates.

## Download and restore evidence

The old encrypted-history `restore-checkpoint.py` reads local chunks and verifies each chunk plus the complete ciphertext; it contains no HTTP downloader. Ordinary curl public downloads of the new snapshot manifest/index and a 4096-byte range from the old ciphertext passed exact hash checks. An urllib request received HTTP403 from the public edge, so curl is the documented retrieval client. No credentials or User-Agent override were used. Full public ciphertext re-download and full cross-environment decryption remain unverified.

## Final GNU packages (2026-11-03)

Genuine GNU coreutils9.11, gzip1.14, grep3.12 and sed4.10 are compiled for Linux/Wasm and verified through signed APK install, representative commands and removal. Use explicit `/usr/bin/ls`, `/usr/bin/gzip`, `/usr/bin/grep`, `/usr/bin/sed`, or `coreutils COMMAND`: the BusyBox standalone shell may prefer its own applets for bare names. GNU gzip gunzip/zcat use the upstream shell launchers with an explicit native gzip path. Grep has no PCRE; the no-MMU port selects the upstream failure-returning fallback for unsupported stack/VMA signal recovery. Fork/vfork return ENOSYS; no child success is simulated. Wget, tar and findutils source recipes exist but were not accepted binaries in this task. Python3.14.6-r1 works in the normal admin environment without PYTHONHOME; Node.js is not ported.

The corrected three-package gate passed24.448s, with one-second CPU/RAM samples; it overlapped a functional startup diagnostic and is not clean speed evidence. Failed predecessors remain recorded.
