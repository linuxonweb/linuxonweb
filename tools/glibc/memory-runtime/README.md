# GNU memory runtime packet

Prepared bounded GNU 2.44 native Linux/Wasm integration; root review and freeze are separate. All host temporary/cache/profile/output paths belong under GLIBC_TASK on ext4. Preserve both frozen input packets and all failed attempts. This is not full sysroot/Nightly acceptance.

Source task config.sh and this directory's env.sh. In a fresh task, run input-readback.py against the two immutable input manifests, then supervise each operation with a unique label and finite deadline:

1. prepare.sh (fresh signed replay, owned architecture overlays, GNU configure/metadata, verified arity reuse).
2. build.sh build1 (actual GNU make all eight targets plus public fixture/startup and unique authority link). The argument names a unique retained make attempt.
3. build-guest.sh (native EH tag validation, FPCAST transformation and both CPIO packages).
4. run-guest.mjs jit <new-run-directory> <native-package4>, then the same command with fpcast-package4. Both use free owned ports 4213/9423 and retain all prior gates.
5. audit.py, then verify-terminal.py after every supervised group has exited. Root independently reviews prepared acceptance and the exact freezer before authorization.

The final native module is memory-v4.wasm and the transformed module memory-v4-fpcast.wasm. Initial preparation, reuse, link and native1 failures remain retained. The old actual object wasm-memory.o is excluded; eight GNU make providers include unchanged GNU misc/sbrk.c. Two derivatives correct mremap flags and the shared authority's ownership union/rounded moving copy. 236 prior objects remain byte-identical.

The actual command/argv/source/stage snapshots are authoritative for replay; do not rerun scripts inside an already populated frozen task. Native1 FAIL49,863/2 used a wrong post-free dirty pattern; v4 clients measure the real GNU perturb tunable and pass native49,874/0 and FPCAST49,846/0. malloc_trim is actual GNU mtrim with observable interior discard, preserved live neighbors and metadata reuse.
