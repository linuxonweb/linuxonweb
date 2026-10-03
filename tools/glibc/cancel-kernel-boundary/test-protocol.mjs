import assert from "node:assert/strict";
import { BoundaryProtocol, ABI, readRecord } from "./protocol.mjs";

let checks = 0;
function check(value) { checks++; assert(value); }
const binding = { task: 4096, tp: 8192, epoch: 1, moduleGeneration: 7 };
const request = { authenticated: true, pending: true, enabled: true, exiting: false,
    terminated: false, async: false, activation: 17, ownerTP: 8192,
    taskEpoch: 1, moduleGeneration: 7 };
function record(nr, lo = 1, raw = -512, phase = ABI.deliver) {
    return { ...ABI, magic: ABI.magic, version: 2, bytes: 64, phase, task: 4096,
        tp: 8192, pid: 10, tgid: 10, lo, hi: 0, raw, nr, signal: 32,
        copyStatus: 0, result: raw, restart: nr };
}
function create(state = request) {
    return new BoundaryProtocol(binding, () => state, () => state);
}
function restore(r) { return { ...r, phase: ABI.restored }; }
for (const raw of [0, 7, -4, -5, -513, -514, -516, -512]) {
    const model = create(); const token = model.enter(63, true, 17);
    const r = record(63, 1, raw); model.deliver(r, 99);
    check(model.restored(restore(r)) === (raw === -512 ? 1 : 0));
    check(model.leave(token, "return").length === (raw === -512 ? 1 : 0));
}
for (const flag of ["authenticated", "pending", "enabled"]) {
    const model = create({ ...request, [flag]: false });
    const token = model.enter(63, true, 17); const r = record(63);
    model.deliver(r, 99); check(model.restored(restore(r)) === 0);
    check(model.leave(token, "return").length === 0);
}
for (const flag of ["exiting", "terminated"]) {
    const model = create({ ...request, [flag]: true });
    const token = model.enter(63, true, 17); const r = record(63);
    model.deliver(r, 99); check(model.restored(restore(r)) === 0);
    check(model.leave(token, "return").length === 0);
}
for (const mutation of [{ ownerTP: 8193 }, { taskEpoch: 2 }, { moduleGeneration: 8 }]) {
    const model = create({ ...request, ...mutation });
    const token = model.enter(63, true, 17); const r = record(63);
    model.deliver(r, 99); check(model.restored(restore(r)) === 0);
    check(model.leave(token, "return").length === 0);
}
{
    let state = { ...request }; const model = new BoundaryProtocol(binding, () => state, () => state);
    const token = model.enter(63, true, 17); const r = record(63);
    model.deliver(r, 99); check(model.restored(restore(r)) === 1);
    state = { ...state, enabled: false }; check(model.leave(token, "return").length === 0);
}
{
    const model = create(); const outer = model.enter(63, true, 17);
    const a = record(63); model.deliver(a, 99);
    const inner = model.enter(98, false, 17); const b = record(98, 2);
    model.deliver(b, 99); check(model.restored(restore(b)) === 0);
    check(model.leave(inner, "return").length === 0);
    check(model.restored(restore(a)) === 1);
    check(model.leave(outer, "return").length === 1);
}
for (const outcome of ["exec", "exit", "trap"]) {
    const model = create(); const token = model.enter(63, true, 17); const r = record(63);
    model.deliver(r, 99); model.restored(restore(r));
    check(model.leave(token, outcome).length === 0);
    checks++; assert.throws(() => model.enter(63, true, 17), /invalid epoch/);
}
for (const mutation of [{ tp: 1 }, { task: 1 }, { lo: 0 }, { version: 1 }, { nr: 98 }]) {
    const model = create(); model.enter(63, true, 17);
    checks++; assert.throws(() => model.deliver({ ...record(63), ...mutation }, 99));
}
{
    const model = create(); model.enter(63, true, 17); const r = record(63);
    model.deliver(r, 99);
    checks++; assert.throws(() => model.restored({ ...restore(r), lo: 2 }), /restoration/);
    checks++; assert.throws(() => model.restored({ ...restore(r), copyStatus: -14 }), /copy/);
    model.restored(restore(r));
    checks++; assert.throws(() => model.deliver(r, 99), /delivery identity/);
}
{
    const model = create({ ...request, activation: 18 }); const token = model.enter(63, true, 17);
    const r = record(63); model.deliver(r, 99); check(model.restored(restore(r)) === 0);
    check(model.leave(token, "return").length === 0);
}
{
    const model = create({ ...request, async: true }); const token = model.enter(63, false, 17);
    const r = record(63, 1, 8); model.deliver(r, 99); check(model.restored(restore(r)) === 0);
    check(model.leave(token, "return").length === 1); // deliberate async; no EINTR conversion
}
{
    const memory = new ArrayBuffer(64); const view = new DataView(memory);
    [ABI.magic, 2, 64, 1, 4096, 8192, 10, 10, 1, 0, -512, 63, -512, 63, 32, 0]
        .forEach((value, i) => view.setInt32(4 * i, value, true));
    const r = readRecord(memory, 0); check(r.raw === -512 && r.tp === 8192);
    checks++; assert.throws(() => readRecord(memory, 4), /bounds/);
}
console.log(JSON.stringify({ pass: true, checks,
    scope: "synthetic ABI/state-machine controls only; no GNU cancellation acceptance" }));
