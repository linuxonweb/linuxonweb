# Current native golden transport slice

This directory runs a standalone native Linux/Wasm C++ application through the unchanged real kernel hostcall hub and an isolated GPU owner into the already pinned current Rust `wgpu` executor. It does not call Firefox's current client serializer, launch Firefox, modify the frozen Firefox source/object graph, or change production assets.

The Rust `buffer_fixture` serializer supplies pinned setup and WGSL compute messages. `fixtures.mjs` verifies and removes their exact current map/unmap suffixes. The native application independently emits those two messages and a known unsupported DestroyDevice message using current fixed-int IDs. It checks all sixteen copied/computed words, complete current map and queue responses, and invokes the actual generated-header BufferMapClosure indirectly only after genuine Rust async completion. `volatile` prevents devirtualizing this callback; the transformed table is independently inspected as 23-i64 → i64.

The transport blocks the calling guest syscall while the owner awaits Rust queue/map callbacks. Readback is copied into guest-owned memory before return; this is not Firefox frontend promise delivery or its IPC shared-memory map lifecycle. Owner inputs are snapshotted before async GPU work and output writes check the exact live request sequence again. Sessions are bound to the calling slot and memory generation; detach closes idle sessions and defers closure for an in-flight call. Caller-abandonment behavior is implemented but has not been deliberately runtime-tested here.

Accepted arms under `/mnt/p6/project/build/nightly-current-native-gpu-transport-20261003`: `hardware3` and `software1` complete copy plus WGSL storage compute; `webgl1` completes genuine Rust WebGL copy/map with compute explicitly unavailable. All use the same native app/archive/Rust bytes. The optional API identity probe distinguishes NVIDIA/maxwell and google/swiftshader; the latter has actual Rust Cpu classification. These are completed readback checks, not FPS or pixel/render/compositor acceptance.

Run the retained admission with:

```sh
python3 web/linux/tests/nightly-webgpu-current/native-transport/check.py hardware3 software1 webgl1
```

Fresh runs require a fresh name, disk-backed TMPDIR/TMP/TEMP resolving into the task, and:

```sh
node web/linux/tests/nightly-webgpu-current/native-transport/run.mjs hardware auto FRESHNAME
node web/linux/tests/nightly-webgpu-current/native-transport/run.mjs software auto FRESHNAME
node web/linux/tests/nightly-webgpu-current/native-transport/run.mjs hardware webgl FRESHNAME
```

`/mnt/p6/project/build/ncgt-20261003` is a short symlink to the same disk task tmp directory, necessary for host AF_UNIX socket length. Native phases have AS16GiB, RSS12GiB, RAM-floor4GiB, core0, finite900s, task4GiB/reserve20GiB. Final compile/link/fpcast/validator replay records actual oom1000 inheritance and identical output hashes. Chromium requires the existing 2TiB virtual cage allowance, with RSS12GiB/RAM-floor4GiB/finite540s; its actual launched app scope resets oom to0, explicitly recorded. Fresh nproc, browser affinity/count and real kernel SMP match at six for every accepted arm.

Next bind actual current `wgpu_client_new` / `wgpu_client_get_queued_messages` native Rust exports and preserve ByteBuf ownership, then feed returned current ServerMessage bytes through `wgpu_client_receive_server_message`. This must execute real adapter/device and map/work-done resolution hooks instead of this harness's native callback fixture. Current WebGPUParent::MapCallback also requires publishing the mapped bytes into its owned IPC shared memory before sending success, with unmap/destroy races handled. Only then can the full current browser adapter integration be considered.
