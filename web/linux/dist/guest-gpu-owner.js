// SPDX-License-Identifier: MIT
//
// Host GPU-owner Worker for guest GPU hostcalls (see guest-gpu-hostcall.js).
// One per machine, started by the page at the first guest call. It never
// blocks: the doorbell is awaited with Atomics.waitAsync, so asynchronous
// WebGPU work runs here while the calling guest threads sleep in Atomics.wait.

import {
    EFAULT, EINVAL, EIO, ENOSPC, ENOSYS, EPERM, FLAG_TEST_HOOKS, H_CALLS, H_DOORBELL, H_FLAGS, H_HEARTBEAT,
    H_OWNER_GEN, H_OWNER_STATE, H_PENDING, MAX_RANGE, MAX_SLOTS, OP_ADAPTER_INFO, OP_CHECKSUM, OP_ECHO, OP_FILL,
    OP_SLEEP, OP_TEST_CLOSE, OP_TEST_HANG, OP_TEST_TERMINATE, OP_WRITEBUFFER_PROBE, OWNER_ALIVE, OWNER_STARTING,
    S_ARGS, S_GEN, S_OP, S_RESULT, S_RESULT2, S_STATE, STATE_BUSY, STATE_DONE, STATE_REQUEST, slotState, slotWord,
} from "./guest-gpu-hostcall.js";
import { handleWgpuCall, OP_WGPU } from "./guest-gpu-wgpu.js";
import { attachPresentCanvas, configureVk, handleVkCall, OP_VK_CALL, OP_VK_CLOSE, OP_VK_OPEN } from "./guest-gpu-vk.js";

let hub = null;
let myGen = 0;
const attachments = new Map(); // slot -> {gen, memory}
const parked = new Set();      // slots whose request arrived before their memory
let adapterPromise = null;
let devicePromise = null;

class GuestFault extends Error {
    constructor(errno) {
        super("guest errno " + errno);
        this.errno = errno;
    }
}

function range(memory, pointer, length) {
    const ptr = pointer >>> 0, len = length >>> 0;
    if (len > MAX_RANGE)
        throw new GuestFault(EINVAL);
    const buffer = memory.buffer; // re-read: the guest may have grown its memory
    if (len > 0 && ptr === 0)
        throw new GuestFault(EFAULT);
    if (ptr + len > buffer.byteLength)
        throw new GuestFault(EFAULT);
    return new Uint8Array(buffer, ptr, len);
}

function writeU32(memory, pointer, value) {
    const bytes = range(memory, pointer, 4);
    new DataView(bytes.buffer, bytes.byteOffset, 4).setUint32(0, value >>> 0, true);
}

function fnv1a(bytes) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++)
        hash = Math.imul(hash ^ bytes[i], 0x01000193);
    return hash >>> 0;
}

function writeJson(memory, out, cap, lenOut, value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    if (lenOut >>> 0)
        writeU32(memory, lenOut, bytes.length);
    if (bytes.length > cap >>> 0)
        return -ENOSPC;
    range(memory, out, bytes.length).set(bytes);
    return bytes.length;
}

function describeError(error) {
    return { name: String(error?.name ?? "Error"), message: String(error?.message ?? error).slice(0, 512) };
}

function getAdapter() {
    if (!adapterPromise) {
        adapterPromise = (async () => {
            if (typeof navigator === "undefined" || !("gpu" in navigator) || !navigator.gpu)
                return { adapter: null, reason: "navigator.gpu is not exposed in this Worker" };
            try {
                // The discrete GPU when there is one (Dawn otherwise returns the integrated or fallback adapter).
                const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
                return adapter ? { adapter, reason: null } : { adapter: null, reason: "requestAdapter returned null" };
            }
            catch (error) {
                return { adapter: null, reason: "requestAdapter threw: " + describeError(error).message };
            }
        })();
    }
    return adapterPromise;
}

function getDevice() {
    if (!devicePromise) {
        devicePromise = (async () => {
            const { adapter, reason } = await getAdapter();
            if (!adapter)
                return { device: null, reason };
            try {
                const device = await adapter.requestDevice();
                device.lost.then((info) => {
                    devicePromise = null;
                    postMessage({ type: "log", message: "device lost: " + info.reason + " " + info.message });
                });
                return { device, reason: null };
            }
            catch (error) {
                return { device: null, reason: "requestDevice threw: " + describeError(error).message };
            }
        })();
    }
    return devicePromise;
}

function plain(object) {
    const result = {};
    if (!object)
        return result;
    for (const key in object) {
        const value = object[key];
        if (typeof value !== "function")
            result[key] = value;
    }
    return result;
}

async function adapterInfo() {
    const { adapter, reason } = await getAdapter();
    const report = {
        available: Boolean(adapter),
        reason,
        powerPreference: "high-performance",
        scope: typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope ? "worker" : "other",
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
        crossOriginIsolated: self.crossOriginIsolated,
    };
    if (!adapter)
        return report;
    report.info = plain(adapter.info);
    report.isFallbackAdapter = adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null;
    report.features = [...adapter.features].sort();
    report.limits = plain(adapter.limits);
    report.wgslLanguageFeatures = navigator.gpu.wgslLanguageFeatures ? [...navigator.gpu.wgslLanguageFeatures].sort() : null;
    report.preferredCanvasFormat = navigator.gpu.getPreferredCanvasFormat?.() ?? null;
    const { device, reason: deviceReason } = await getDevice();
    report.device = device ? { ok: true, features: [...device.features].sort(), maxBufferSize: device.limits.maxBufferSize }
        : { ok: false, reason: deviceReason };
    return report;
}

// Does GPUQueue.writeBuffer accept views of the guest's SharedArrayBuffer, and
// does it snapshot the bytes at call time (so the guest may reuse its buffer as
// soon as the hostcall returns)? `live()` is false once the caller abandoned
// the request; the probe then stops touching guest memory.
class Abandoned extends Error { }
async function writeBufferProbe(memory, src, len, live) {
    if ((len >>> 0) === 0 || (len >>> 0) % 4 !== 0)
        throw new GuestFault(EINVAL);
    const source = range(memory, src, len);
    const report = { bytes: len >>> 0, sharedArrayBuffer: source.buffer instanceof SharedArrayBuffer, cases: {} };
    const { device, reason } = await getDevice();
    if (!device) {
        report.available = false;
        report.reason = reason;
        return report;
    }
    report.available = true;
    const size = len >>> 0;
    const target = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const expected = source.slice();
    async function verify() {
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(target, 0, readback, 0, size);
        device.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);
        const got = new Uint8Array(readback.getMappedRange()).slice();
        readback.unmap();
        let mismatches = 0;
        for (let i = 0; i < size; i++)
            if (got[i] !== expected[i])
                mismatches++;
        return mismatches;
    }
    async function attempt(name, write) {
        const entry = { ok: false };
        if (!live())
            throw new Abandoned("caller abandoned the probe");
        try {
            device.pushErrorScope("validation");
            const t0 = performance.now();
            write();
            entry.callMs = performance.now() - t0;
            // Mutate the guest source right after the call: a call-time snapshot keeps the old bytes.
            for (let i = 0; i < size; i++)
                source[i] ^= 0xff;
            const t1 = performance.now();
            await device.queue.onSubmittedWorkDone();
            entry.completeMs = performance.now() - t1;
            if (!live())
                throw new Abandoned("caller abandoned the probe");
            for (let i = 0; i < size; i++)
                source[i] ^= 0xff;
            const error = await device.popErrorScope();
            if (error)
                entry.validationError = String(error.message).slice(0, 512);
            entry.mismatches = await verify();
            entry.snapshotAtCall = entry.mismatches === 0;
            entry.ok = !error && entry.mismatches === 0;
        }
        catch (error) {
            if (error instanceof Abandoned)
                throw error;
            entry.exception = describeError(error);
            // Restore the source if the exception happened after mutation.
            let restored = !live(); // never write into a buffer the caller gave up
            for (let i = 0; i < size && restored; i++)
                restored = source[i] === expected[i];
            if (!restored)
                for (let i = 0; i < size; i++)
                    source[i] = expected[i];
            try {
                await device.popErrorScope();
            }
            catch { }
        }
        // Clear the target between cases.
        device.queue.writeBuffer(target, 0, new Uint8Array(size));
        report.cases[name] = entry;
    }
    await attempt("sharedView", () => device.queue.writeBuffer(target, 0, source));
    await attempt("sharedBufferOffset", () => device.queue.writeBuffer(target, 0, source.buffer, source.byteOffset, size));
    await attempt("copySlice", () => device.queue.writeBuffer(target, 0, source.slice()));
    // Timing only: rotate the order each round so warm-up does not favour one path.
    const modes = {
        sharedView: () => device.queue.writeBuffer(target, 0, source),
        sharedBufferOffset: () => device.queue.writeBuffer(target, 0, source.buffer, source.byteOffset, size),
        copySlice: () => device.queue.writeBuffer(target, 0, source.slice()),
    };
    const names = Object.keys(modes), samples = Object.fromEntries(names.map((name) => [name, []]));
    for (let round = 0; round < 9; round++) {
        for (let k = 0; k < names.length; k++) {
            const name = names[(round + k) % names.length];
            if (!report.cases[name]?.ok)
                continue;
            if (!live())
                throw new Abandoned("caller abandoned the probe");
            const t0 = performance.now();
            modes[name]();
            samples[name].push(performance.now() - t0);
            await device.queue.onSubmittedWorkDone();
        }
    }
    report.medianCallMs = Object.fromEntries(names.filter((name) => samples[name].length).map((name) => {
        const sorted = samples[name].sort((x, y) => x - y);
        return [name, sorted[sorted.length >> 1]];
    }));
    report.timingRounds = 9;
    target.destroy();
    readback.destroy();
    return report;
}

// True while the caller still waits for request `seq` of `slot`. Asynchronous
// operations check it again right before writing guest memory: an abandoned
// request's buffer may already belong to something else.
function current(slot, seq) {
    return Atomics.load(hub, slotWord(slot, S_STATE)) === slotState(seq, STATE_BUSY);
}

function completeWith(slot, seq, produce) {
    if (!current(slot, seq))
        return;
    let result;
    try {
        result = produce();
    }
    catch (error) {
        result = errnoOf(error);
    }
    complete(slot, seq, result);
}

function complete(slot, seq, result, result2 = 0) {
    const base = slotWord(slot, 0);
    const busy = slotState(seq, STATE_BUSY);
    if (Atomics.load(hub, base + S_STATE) !== busy)
        return; // the caller gave up (owner loss, thread exit); never complete a later request
    // The owner is single-threaded, so a stale write here is always followed by
    // the later request's own write before its exchange; the caller reads the
    // result only after observing its exact DONE word.
    hub[base + S_RESULT] = result | 0;
    hub[base + S_RESULT2] = result2 | 0;
    if (Atomics.compareExchange(hub, base + S_STATE, busy, slotState(seq, STATE_DONE)) === busy) {
        Atomics.add(hub, H_CALLS, 1);
        Atomics.notify(hub, base + S_STATE, 1);
    }
}

function errnoOf(error) {
    if (error instanceof GuestFault || (Number.isInteger(error?.errno) && error.errno > 0 && error.errno < 4096))
        return -error.errno;
    postMessage({ type: "log", message: "op failed: " + describeError(error).message });
    return -EIO;
}

function serve(slot) {
    const base = slotWord(slot, 0);
    const request = Atomics.load(hub, base + S_STATE);
    if ((request & 3) !== STATE_REQUEST)
        return;
    const seq = request >>> 2;
    const gen = hub[base + S_GEN];
    const attachment = attachments.get(slot);
    if (!attachment || attachment.gen !== gen) {
        parked.add(slot); // served when the page relays this slot's memory
        return;
    }
    const op = hub[base + S_OP];
    const a = [0, 1, 2, 3, 4].map((i) => hub[base + S_ARGS + i]);
    if (Atomics.compareExchange(hub, base + S_STATE, request, slotState(seq, STATE_BUSY)) !== request)
        return; // abandoned meanwhile
    const memory = attachment.memory;
    const testHooks = (Atomics.load(hub, H_FLAGS) & FLAG_TEST_HOOKS) !== 0;
    try {
        switch (op) {
            case OP_ECHO:
                return complete(slot, seq, a[0] & 0x7fffffff, seq);
            case OP_CHECKSUM: {
                const bytes = range(memory, a[0], a[1]);
                range(memory, a[2], 4);
                writeU32(memory, a[2], fnv1a(bytes));
                return complete(slot, seq, 0);
            }
            case OP_FILL: {
                const bytes = range(memory, a[0], a[1]);
                const seed = a[2] >>> 0;
                for (let i = 0; i < bytes.length; i++)
                    bytes[i] = ((seed ^ Math.imul(i, 0x9E3779B1)) >>> 13) & 0xff;
                return complete(slot, seq, 0);
            }
            case OP_ADAPTER_INFO:
                adapterInfo().then((report) => completeWith(slot, seq, () => writeJson(memory, a[0], a[1], a[2], report)))
                    .catch((error) => complete(slot, seq, errnoOf(error)));
                return;
            case OP_WRITEBUFFER_PROBE:
                writeBufferProbe(memory, a[0], a[1], () => current(slot, seq))
                    .then((report) => completeWith(slot, seq, () => writeJson(memory, a[2], a[3], a[4], report)))
                    .catch((error) => complete(slot, seq, errnoOf(error)));
                return;
            case OP_WGPU:
                // Firefox wgpu server calls (W4a executor, docs/firefox-webgpu-w4a-20260930.md).
                handleWgpuCall(memory, a).then((write) => completeWith(slot, seq, write))
                    .catch((error) => complete(slot, seq, errnoOf(error)));
                return;
            case OP_VK_OPEN:
            case OP_VK_CALL:
            case OP_VK_CLOSE:
                // Guest Vulkan ICD sessions (guest-gpu-vk.js), the default guest GPU transport.
                handleVkCall(memory, op, a, (message) => postMessage({ type: "log", message }))
                    .then((write) => completeWith(slot, seq, write))
                    .catch((error) => complete(slot, seq, errnoOf(error)));
                return;
            case OP_SLEEP: {
                const ms = a[0] >>> 0;
                if (ms > 10000)
                    return complete(slot, seq, -EINVAL);
                setTimeout(() => complete(slot, seq, 0), ms);
                return;
            }
            case OP_TEST_HANG:
                if (!testHooks)
                    return complete(slot, seq, -EPERM);
                for (;;) { } // the heartbeat stops; callers must detect the stall
            case OP_TEST_CLOSE:
                if (!testHooks)
                    return complete(slot, seq, -EPERM);
                clearInterval(heartbeatTimer);
                self.close();
                return;
            case OP_TEST_TERMINATE:
                if (!testHooks)
                    return complete(slot, seq, -EPERM);
                postMessage({ type: "terminate_me" });
                return;
            default:
                return complete(slot, seq, op === 0 ? -ENOSYS : -EINVAL);
        }
    }
    catch (error) {
        complete(slot, seq, errnoOf(error));
    }
}

function drain() {
    for (let word = 0; word < MAX_SLOTS / 32; word++) {
        let bits = Atomics.exchange(hub, H_PENDING + word, 0);
        while (bits !== 0) {
            const bit = 31 - Math.clz32(bits);
            bits &= ~(1 << bit);
            serve(word * 32 + bit);
        }
    }
}

let heartbeatTimer = 0;

async function loop() {
    const hasWaitAsync = typeof Atomics.waitAsync === "function";
    for (;;) {
        const doorbell = Atomics.load(hub, H_DOORBELL);
        drain();
        if (hasWaitAsync) {
            const wait = Atomics.waitAsync(hub, H_DOORBELL, doorbell);
            if (wait.async)
                await wait.value;
        }
        else if (Atomics.load(hub, H_DOORBELL) === doorbell) {
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
    }
}

self.onmessage = ({ data }) => {
    switch (data?.type) {
        case "init": {
            hub = new Int32Array(data.hub);
            myGen = data.gen;
            configureVk(data.config?.vk);
            for (const { slot, gen, memory } of data.attachments)
                attachments.set(slot, { gen, memory });
            heartbeatTimer = setInterval(() => Atomics.add(hub, H_HEARTBEAT, 1), 50);
            Atomics.add(hub, H_HEARTBEAT, 1);
            if (Atomics.load(hub, H_OWNER_GEN) === myGen &&
                Atomics.compareExchange(hub, H_OWNER_STATE, OWNER_STARTING, OWNER_ALIVE) === OWNER_STARTING)
                Atomics.notify(hub, H_OWNER_STATE);
            void loop();
            break;
        }
        case "attach":
            attachments.set(data.slot, { gen: data.gen, memory: data.memory });
            if (parked.delete(data.slot) && hub)
                serve(data.slot);
            break;
        case "present-canvas":
            attachPresentCanvas(data.session, data.surface, data.canvas);
            break;
        case "detach":
            if (attachments.get(data.slot)?.gen === data.gen)
                attachments.delete(data.slot);
            parked.delete(data.slot);
            break;
    }
};
