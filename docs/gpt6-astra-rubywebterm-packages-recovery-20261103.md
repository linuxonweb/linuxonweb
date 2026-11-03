# Native packages and recovery — 2026-11-03

GPT-6 Astra Pro, built-in agents, rubywebterm.

## Delivered behavior

The accepted APK4 image (version d258203daee8) contains genuine Linux/Wasm apk-tools2.14.12 and a verified four-package base database. The normal desktop uses the public signed repository at https://a3cf34ce40307517.5x7aqstuceku.opentunnel.xyz . This read-only endpoint is maintained by an owned user service and tunnel; it lasts only while those services run. The named immutable `@snapshot` fallback remains explicit, so it cannot silently conceal stale repository contents.

Run in the desktop terminal:

```sh
sudo apk update
sudo apk add python3 coreutils gzip grep sed
python3 -m json.tool --help
/usr/bin/ls --version
/usr/bin/gzip --version
/usr/bin/grep --version
/usr/bin/sed --version
```

This is the project's wasm32 Linux ABI, not compatibility with Alpine's x86_64/aarch64 repository. Packages are real Linux executables, not browser JavaScript substitutes. Signature and per-file checksum verification remain enabled. The package-signing private key is excluded from every public repository, source export and runtime archive.

## Inventory

| Package | Version | Origin and acceptance |
|---|---|---|
| apk-tools |2.14.12-r0|Fresh native build; signed install/remove, scripts, bad signature and bad per-file digest tests.|
| busybox |1.38.0_git-r0|Repackaged existing genuine guest executable with provenance; applets do not count as independently compiled GNU packages.|
| ca-certificates |20261103-r0|Existing distribution trust bundle.|
| curl |8.21.0-r1|Repackaged existing genuine native executable; correct /bin and /usr/bin alias ownership.|
| python3 |3.14.6-r1|Fresh native build; normal admin environment and json.tool pass without PYTHONHOME or prefix warnings.|
| coreutils |9.11-r0|Fresh GNU multicall binary; representative commands plus actual signed HTTPS install/remove pass.|
| gzip |1.14-r0|Fresh GNU binary; upstream gunzip/zcat launchers, compression/roundtrip/CRC/corruption rejection, signed install/remove pass.|
| grep |3.12-r0|Fresh GNU binary; fixed/extended/recursive regex and error exits, signed install/remove pass. PCRE omitted.|
| sed |4.10-r0|Fresh GNU binary; substitution/extended regex/in-place backup/error paths, signed install/remove pass.|
| linuxonweb-vkgears |20261103-r0|Optional project Vulkan WSI demo; native presentation accepted independently, explicit guest WebGL required on the tested host. It is not full Vulkan conformance.|

There are10 repository entries, including manager, certificates and the optional graphics demo. Wget, tar and findutils have source/build plans but are not accepted delivered native packages. Node.js has no completed executable target port. Host Node22 is tooling and is not guest Node.js.

The standalone BusyBox shell may prefer its built-in applets over PATH. Invoke GNU commands by `/usr/bin/COMMAND` or `coreutils COMMAND`. Unsupported fork/vfork returns ENOSYS; no child-process success is simulated. Grep's no-MMU port selects the upstream failure-returning fallback for unavailable stack/VMA signal recovery, with the actual target stack direction measured as-1.

Python acceptance covers arithmetic, Unicode, file I/O, JSON, compression, hashing, randomness, CA context, real localhost sockets/threads and os.posix_spawn. SSL context construction is not an end-to-end HTTPS proof. `_posixsubprocess`, mmap, ctypes, curses, Tk, readline and DBM are not delivered; ordinary Popen/fork-dependent uses remain unsupported.

## Persistence and evidence

Package files and the installed database are diskless and reset together on reboot. `/home` persists separately. No unsupported persistent APK world is promised. Normal production browser/desktop gates tested the repaired single-member gzip image, signed Python installation, module invocation and Stop/home behavior. The original concatenated-gzip failure is retained; real Chrome DecompressionStream rejected it even though a kernel-direct gate passed.

The corrected gzip/grep/sed gate passed24.448s with one-second resource samples and overlapped a separate functional startup diagnostic. It is correctness evidence, not clean speed evidence. The previous9.379s failure was retained: zcat required upstream launcher behavior, and the initial corruption fixture changed an optional filename rather than compressed payload. Neither issue was hidden by disabling integrity checks.

Evidence: tools/guest-packages/evidence/gnu-basic-runtime-20261103.json, stack-direction-runtime-20261103.json, public-repository and Python/coreutils evidence; startup production evidence and AGENTS.md are authoritative for desktop acceptance.

## Recovery

The accepted APK4 gzip is116197223 bytes, SHA2564675a8ceb318c539cd64eb1b69338a19185d0cadb7a5f51b2352048a0c09a771. The runtime recovery archive separately preserves exact kernel, plain rootfs, desktop extras, boot manifests and signed package repository; every split part and extracted file is checked by restore-runtime.py. Local reassembly and all extracted hashes passed before publication.

Original encrypted80a52d1 history checkpoint:
https://fileharbor-meak.basicgleam65.chatgpt.site/raw/meaklocaldev/3378cc4f-3a2b-495e-880a-734fca1b9f18/linuxonweb_gpt-6-astra-pro_builtin-agents_rubywebterm_20261103_80a52d1/

Verified d080f8f source/history progress checkpoint:
https://fileharbor-meak.basicgleam65.chatgpt.site/raw/meaklocaldev/44c94a83-38cb-4294-8dd8-48ffb21daa14/linuxonweb_gpt-6-astra-pro_builtin-agents_rubywebterm_20261103_d080f8f/

The final cumulative increment supersedes the progress increment for convenient recovery, while both published snapshots remain immutable. It requires original80a52d1, verifies/fetches into a restored base and passes git fsck before encryption. CMS AuthenticatedEnvelopedData uses AES-256-GCM with an RSA3072 recipient; only the public recipient certificate is sent to the project machine. The encrypted payload also preserves the package-signing recovery key, which must remain0600/private after extraction. Full cross-environment redownload/decrypt has not been performed; small public range/hash checks and native CMS roundtrip passed.

Use ordinary curl for public FileHarbor downloads; the observed Python urllib path returned403 while curl returned200. No access control was bypassed. Full native Firefox rebuilding is not reproducible from this source alone: historical linked inputs under inaccessible p6 paths are still required, so accepted executable distribution assets are preserved separately.

Surge publication is not completed because no existing account/token is available. The authenticated HTTPS live preview remains the actual runtime; a static source/recovery page is not represented as a runtime deployment. No iOS device or real WebKit acceptance was available. Actual Android evidence is maintained by the graphics/mobile owner.
