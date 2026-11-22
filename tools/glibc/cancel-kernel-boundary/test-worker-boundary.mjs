/* Synthetic helper-contract tests only; no GNU authentication/unwind claim. */
import assert from "node:assert/strict";
import { WorkerSignalBoundary } from "./worker-boundary.mjs";
const fields = ["magic", "version", "bytes", "phase", "task", "tp", "pid", "tgid",
    "lo", "hi", "raw", "nr", "result", "restart", "signal", "copyStatus",
    "handler", "trampoline", "flags", "kind"];
let checks = 0;
function check(test) { assert.ok(test); checks++; }
function harness({ ordinary, registered = true, fail = () => false, fpcast = false } = {}) {
    const kernelMemory = new WebAssembly.Memory({ initial: 1 });
    const memory = new WebAssembly.Memory({ initial: 1 });
    const prepared = new Map(), dispatches = [], faults = [], checkpoints = [];
    const slots = new Set();
    function read(slot) {
        const view = new DataView(memory.buffer, slot, 80);
        return Object.fromEntries(fields.map((name, index) => [name,
            ["raw", "nr", "result", "restart", "copyStatus"].includes(name)
                ? view.getInt32(index * 4, true) : view.getUint32(index * 4, true)]));
    }
    const exports = {
        __wasm_boundary_v3_abi: () => 3,
        __wasm_boundary_v3_import_enter: (_sidecar, nr) => nr + 8192,
        __wasm_boundary_v3_import_leave: () => 0,
        __wasm_boundary_v3_slot: (_sidecar, index) => {
            const slot = 4096 + index * 512;
            assert.ok(!slots.has(slot)); slots.add(slot); return slot;
        },
        __wasm_boundary_v3_prepare: (_sidecar, slot) => {
            const record = read(slot); prepared.set(slot, { record, translatedSiginfo: { sequence: record.lo } });
            return fail(record) ? -14 : 0;
        },
        __wasm_boundary_v3_inspect: (_sidecar, slot) => {
            const r = prepared.get(slot).record;
            return (typeof registered === "function" ? registered(r) : registered) ? 1 : 0;
        },
        __wasm_boundary_v3_policy: (_sidecar, slot, eligible) => {
            const record = read(slot); assert.equal(record.lo, prepared.get(slot).record.lo);
            return eligible && record.raw === -512 ? 1 : 0;
        },
        __wasm_boundary_v3_dispatch: (_sidecar, slot) => {
            const state = prepared.get(slot);
            assert.equal(state.record.lo, read(slot).lo);
            dispatches.push({ lo: state.record.lo, info: state.translatedSiginfo.sequence, slot });
        },
        __wasm_boundary_v3_callback_enter: (_sidecar, slot) => slot + 400,
        __wasm_boundary_v3_callback_leave: (_sidecar, checkpoint, escaped) => {
            checkpoints.push({ checkpoint, escaped }); return 0;
        },
        __wasm_boundary_v3_complete: () => { slots.clear(); prepared.clear(); return 0; },
        __wasm_boundary_v3_invalidate: () => { slots.clear(); prepared.clear(); },
    };
    const context = { instance: { exports }, memory };
    const b = new WorkerSignalBoundary({ kernelMemory, context: () => context,
        callTyped: (fn, args) => {
            const value = fn(...args);
            return fpcast && value !== undefined ? BigInt(value) : value;
        }, ordinary: (...args) => ordinary ? ordinary(b, write, ...args) : 0,
        controls: new Set(), fault: message => faults.push(message) });
    b.admit(128, 1, 1, 1024);
    function write(lo, phase = 1, nr = 63, kind = 1, status = 0) {
        const r = { magic: 0x53424733, version: 3, bytes: 80, phase,
            task: 16, tp: 128, pid: 20, tgid: 20, lo, hi: 0, raw: -512, nr,
            result: -512, restart: 63, signal: 32, copyStatus: status,
            handler: 7, trampoline: kind === 1 ? 9 : 0, flags: 0x10000004, kind };
        const view = new DataView(kernelMemory.buffer, 0, 80);
        fields.forEach((name, index) => view.setUint32(index * 4, r[name], true));
        return r;
    }
    return { b, write, dispatches, faults, checkpoints, slots };
}

// Two sequential callbacks at identical depth keep immutable record+siginfo.
{
    const { b, write, dispatches } = harness();
    const token = b.enter(63);
    for (const lo of [1, 2]) {
        write(lo); check(b.capture(9, 7, 32, 0, 3) === 0);
        write(lo, 2); check(b.restored(0, 3) === 1);
    }
    check(b.slotIndex === 2); b.leave(token, "return");
    check(dispatches.length === 2 && dispatches[0].lo === 1 && dispatches[1].lo === 2);
    check(dispatches[0].slot !== dispatches[1].slot && dispatches.every(r => r.lo === r.info));
}
// Nested registered delivery then sibling at reused callback depth.
{
    const h = harness({ registered: r => r.lo !== 1, ordinary: (b, write) => {
        const inner = b.enter(98); write(2, 1, 98);
        check(b.capture(9, 7, 32, 0, 3) === 0); write(2, 2, 98);
        check(b.restored(0, 3) === 0); b.leave(inner, "return"); return 0;
    } });
    const token = h.b.enter(63); h.write(1);
    check(h.b.capture(9, 7, 32, 0, 3) === 0); h.write(1, 2);
    check(h.b.restored(0, 3) === 0); h.write(3);
    check(h.b.capture(9, 7, 32, 0, 3) === 0); h.write(3, 2);
    check(h.b.restored(0, 3) === 1); h.b.leave(token, "return");
    check(h.dispatches.map(r => r.lo).join() === "2,3");
    check(h.dispatches[0].slot !== h.dispatches[1].slot);
}
// Kernel skips restored import after copy failure. Subsequent callback works.
{
    const { b, write, dispatches, faults } = harness({ fail: r => r.lo === 1 });
    const token = b.enter(63); write(1);
    check(b.capture(9, 7, 32, 0, 3) === -14);
    check(b.callbacks.length === 0 && token.deliveries[0].failed);
    write(2); check(b.capture(9, 7, 32, 0, 3) === 0);
    write(2, 2); check(b.restored(0, 3) === 1); b.leave(token, "return");
    check(dispatches.length === 1 && dispatches[0].lo === 2 && !faults.length);
}
// Exact nested foreign identity escapes each restored kernel into an enclosing
// callback catcher. No internal restart result reaches a user callback.
{
    const identity = new Error("foreign identity");
    let depth = 0;
    const h = harness({ registered: false, ordinary: (b, write) => {
        if (depth++) throw identity;
        const inner = b.enter(98); write(2, 1, 98);
        check(b.capture(9, 7, 32, 0, 3) === 0); write(2, 2, 98);
        check(b.restored(0, 3) === 2); b.leave(inner, "return");
        throw new Error("raw result reached callback");
    } });
    const token = h.b.enter(63); h.write(1);
    check(h.b.capture(9, 7, 32, 0, 3) === 0); h.write(1, 2);
    check(h.b.restored(0, 3) === 2);
    assert.throws(() => h.b.leave(token, "return"), error => error === identity); checks++;
    check(h.b.imports.length === 0 && h.b.callbacks.length === 0 && h.b.slotIndex === 0);
    check(h.checkpoints.length === 2 && h.checkpoints.every(c => c.escaped === 1));
}
// FPCAST i64 helper returns retain pointer values and signed failure codes.
{
    const { b, write, dispatches } = harness({ fpcast: true, fail: r => r.lo === 1 });
    const token = b.enter(63); write(1);
    check(b.capture(9, 7, 32, 0, 3) === -14);
    write(2); check(b.capture(9, 7, 32, 0, 3) === 0);
    write(2, 2); check(b.restored(0, 3) === 1); b.leave(token, "return");
    check(dispatches.length === 1 && dispatches[0].lo === 2 && b.slotIndex === 0);
}
// Exact terminal identities survive callback invalidation and every outer
// import catch. No stale nesting error may replace halt/exec/trap identity.
for (const nested of [false, true]) {
    const identity = new WebAssembly.RuntimeError("terminal control/trap");
    let inner;
    const h = harness({ registered: false, ordinary: (b) => {
        if (nested) inner = b.enter(98);
        throw identity;
    } });
    h.b.controls.add(identity);
    const outer = h.b.enter(63); h.write(1);
    assert.throws(() => h.b.capture(9, 7, 32, 0, 3), error => error === identity); checks++;
    if (inner) h.b.leave(inner, "escape");
    h.b.leave(outer, "escape");
    check(h.b.dead && h.b.imports.length === 0 && h.b.callbacks.length === 0);
    assert.throws(() => h.b.enter(63), /invalid boundary epoch/); checks++;
    assert.throws(() => h.b.leave(outer, "return"), /invalid boundary epoch/); checks++;
}
console.log(JSON.stringify({ pass: true, checks, scope: "synthetic owned worker/helper contract; no real GNU cancellation" }));
