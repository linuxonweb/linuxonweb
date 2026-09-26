# Isolated Firefox readiness candidate

`package-aurora-ready.py` consumes the pinned accepted Firefox gzip, its accepted
boot manifest and the already guest-tested `wait-for-aurora.wasm`. It replaces
one exact packed `/init` startup block, retaining all profile, certificate,
persistent-home and other accepted fixes. It never uses the generic `init.sh`.

The helper runs as `admin` with `DISPLAY=:0`, matching its guest acceptance.
Its successful handshake **or normal ten-second deadline exit** proceeds directly
to Firefox. A missing/non-executable helper or any nonzero `su`/helper result
retains the original `sleep 10`. The initial log describes readiness waiting;
the existing Firefox launch log and helper handshake/deadline logs remain.

From the repository root, the designated command/serving agent runs:

```sh
findmnt -T /mnt/p6/build
df -h /mnt/p6/build
mkdir -p /mnt/p6/build/firefox-ready-20260926/tmp
export TMPDIR=/mnt/p6/build/firefox-ready-20260926/tmp
export TMP="$TMPDIR" TEMP="$TMPDIR"
/usr/bin/python3 tools/guest-rootfs/package-aurora-ready.py \
  --source /mnt/p6/build/firefox-ready-20260926/baseline-images/initramfs-firefox.cpio.gz \
  --helper ../.cache/runtime-graphics-20260926/wm-ready/wait-for-aurora.wasm \
  --manifest /mnt/p6/build/firefox-ready-20260926/baseline-images/boot-manifest.json \
  --output /mnt/p6/build/firefox-ready-20260926/candidate-reproduction \
  > /mnt/p6/build/firefox-ready-20260926/package-reproduction.log 2>&1
sh -n /mnt/p6/build/firefox-ready-20260926/candidate-reproduction/init.after.sh
```

The output directory must be absent. Use a fresh sibling for retries and retain
earlier artifacts. The packager checks Linux mount metadata for all input,
output-parent and scratch paths, rejects memory-backed filesystems and forbidden
temporary paths, and requires at least 2 GiB free on the output filesystem.
It recompresses in memory, with deterministic gzip level 9, empty filename and
mtime zero; it does not extract a rootfs or invoke external build tools.

The accepted local candidate is now promoted. The command above uses the four
verified pre-promotion inputs preserved in `baseline-images/`, including the
unchanged kernel and plain archive needed by the manifest check. The original
build used those same baseline bytes from `web/linux/` and wrote `candidate/`.
Do not pass the now-promoted manifest as the pinned baseline or overwrite the
original candidate/evidence when reproducing.

Output consists of `initramfs-firefox.cpio.gz`, `boot-manifest.json`,
`init.before.sh`, `init.after.sh`, and the final audit `package.json`. The gzip
and helper input hashes are pinned in the tool; the full accepted manifest
structure is pinned and its kernel/plain files are verified by size and hash.
`package.json` records input/output hashes, filesystem/capacity checks, gzip
settings, the new version, and exact transformation assertions. Every original
CPIO record except `/init` remains byte-for-byte identical, in original order;
only `/init`'s size field and body/padding may change. The archive tail is kept,
and one root-owned executable `bin/wait-for-aurora` record is inserted before
the trailer. The audit is written last; a partial directory is not a candidate.

The candidate manifest keeps all accepted URLs and labels and complete
kernel/plain asset records. Only Firefox bytes/hash and the content-derived
version change. The isolated acceptance server must route the candidate manifest
and Firefox archive at the accepted paths, with kernel/plain assets served from
the accepted `web/linux` directory. The candidate directory intentionally does
not duplicate those unchanged assets. No production archive or manifest is
written or staged by this command.

Passing packaging does not establish a startup improvement or release readiness.
Before promotion, verify missing/failed/successful helper shell branches, actual
early Firefox window usability, matched baseline/candidate startup observations,
zero-image warm cache, and update/reload preserving the same home data. Previous
helper-only acceptance is not Firefox acceptance. There is no new native JIT,
guest Vulkan/OpenGL, hardware decoding or physical GPU capability in this change.
