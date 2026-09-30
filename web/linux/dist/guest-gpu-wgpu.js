// SPDX-License-Identifier: MIT
//
// Host wgpu executor for the guest GPU hostcall channel (packet W4a of
// docs/firefox-webgpu-design-20260929.md; format in docs/firefox-webgpu-w4a-20260930.md).
// Runs inside the GPU-owner Worker (guest-gpu-owner.js). The future guest
// `__wrap_wgpu_server_*` adapter linked into Firefox turns each wrapped
// wgpu-core server entrypoint into one OP_WGPU hostcall:
//
//   gpu_hostcall(OP_WGPU, req_ptr, req_len, resp_ptr, resp_cap, resp_len_out)
//     -> total response bytes | -ENOSPC (*resp_len_out = bytes needed) | -errno
//
// Request (little-endian): 16-byte header
//   u32 magic 'WGQ1' (0x31514757), u16 version (1), u16 call, u32 payload_len, u32 reserved (0)
// followed by the payload: payload_len/8 u64 fields (every field is a u64;
// guest pointers and lengths too), so the C side needs no struct padding rules.
//
// Response: 24-byte header
//   u32 magic 'WGR1' (0x31524757), u16 version, u16 call, u32 error_type,
//   u32 payload_len, u32 message_len, u32 reserved
// followed by the payload (u64 fields, strings as u64 length + bytes padded to
// 8) and the UTF-8 error message (no NUL). error_type is Firefox's
// ErrorBufferType: 0 None, 1 DeviceLost, 2 Internal, 3 OutOfMemory, 4 Validation.
//
// Error policy (pinned for W4): synchronous. Every call that touches a device
// runs inside validation/out-of-memory/internal error scopes that are popped
// before the hostcall returns, so host WebGPU validation errors of that call
// come back in its own response (exactly where wgpu-core fills ErrorBuffer).
// Errors raised outside any call (device.onuncapturederror) and all
// asynchronous completions are queued and returned by POLL_ALL_DEVICES.
//
// Ids: Firefox wgpu-core raw ids, u64 = index | epoch << 32 | backend << 61.
// Objects are keyed per Global and per kind by index; the full id must match.
// Creating over a live index fails, so does a lookup whose epoch or backend
// differs from the live object (stale id).

export const OP_WGPU = 0x10;
export const WGPU_REQ_MAGIC = 0x31514757;  // "WGQ1"
export const WGPU_RESP_MAGIC = 0x31524757; // "WGR1"
export const WGPU_VERSION = 1;
export const WGPU_REQ_HEADER = 16, WGPU_RESP_HEADER = 24;

export const CALL = Object.freeze({
    SERVER_NEW: 1, SERVER_DELETE: 2, INSTANCE_REQUEST_ADAPTER: 3, ADAPTER_PACK_INFO: 4, ADAPTER_REQUEST_DEVICE: 5,
    ADAPTER_DROP: 6, DEVICE_CREATE_BUFFER: 7, BUFFER_MAP: 8, BUFFER_GET_MAPPED_RANGE: 9, BUFFER_UNMAP: 10,
    BUFFER_DESTROY: 11, BUFFER_DROP: 12, DEVICE_CREATE_ENCODER: 13, COMMAND_ENCODER_ACTION: 14, ENCODER_FINISH: 15,
    ENCODER_DROP: 16, QUEUE_WRITE_ACTION: 17, QUEUE_SUBMIT: 18, QUEUE_ON_SUBMITTED_WORK_DONE: 19,
    DEVICE_SET_LOST_CALLBACK: 20, POLL_ALL_DEVICES: 21, DEVICE_DESTROY: 22, DEVICE_DROP: 23, DEVICE_ACTION: 24,
    STATS: 25,
});
export const ERR = Object.freeze({ NONE: 0, DEVICE_LOST: 1, INTERNAL: 2, OUT_OF_MEMORY: 3, VALIDATION: 4 });
export const EVENT = Object.freeze({ BUFFER_MAP: 1, WORK_DONE: 2, DEVICE_LOST: 3, UNCAPTURED_ERROR: 4 });
// wgpu-core BufferMapAsyncStatus
export const MAP_STATUS = Object.freeze({ SUCCESS: 0, ALREADY_MAPPED: 1, MAP_ALREADY_PENDING: 2, ERROR: 3, ABORTED: 4,
    CONTEXT_LOST: 5, INVALID: 6, INVALID_RANGE: 7, INVALID_ALIGNMENT: 8, INVALID_USAGE_FLAGS: 9 });
// wgt::DeviceLostReason
export const LOST = Object.freeze({ UNKNOWN: 0, DESTROYED: 1, DROPPED: 2, REPLACED_CALLBACK: 3 });

const EINVAL = 22, EFAULT = 14, ENOSPC = 28;
const MAX_REQUEST = 1 << 20, MAX_DATA = 256 << 20, MAX_EVENTS_PER_POLL = 4096, MAX_MESSAGE = 4096;
const BACKENDS = ["Empty", "Vulkan", "Metal", "Dx12", "Gl", "BrowserWebGpu"];

// wgt::Limits field order (bincode order of AdapterInformation.limits), mapped to WebGPU names.
export const LIMIT_FIELDS = Object.freeze([
    "maxTextureDimension1D", "maxTextureDimension2D", "maxTextureDimension3D", "maxTextureArrayLayers", "maxBindGroups",
    "maxBindingsPerBindGroup", "maxDynamicUniformBuffersPerPipelineLayout", "maxDynamicStorageBuffersPerPipelineLayout",
    "maxSampledTexturesPerShaderStage", "maxSamplersPerShaderStage", "maxStorageBuffersPerShaderStage",
    "maxStorageTexturesPerShaderStage", "maxUniformBuffersPerShaderStage", "maxUniformBufferBindingSize",
    "maxStorageBufferBindingSize", "maxVertexBuffers", "maxBufferSize", "maxVertexAttributes",
    "maxVertexBufferArrayStride", "minUniformBufferOffsetAlignment", "minStorageBufferOffsetAlignment",
    "maxInterStageShaderComponents", "maxColorAttachments", "maxColorAttachmentBytesPerSample",
    "maxComputeWorkgroupStorageSize", "maxComputeInvocationsPerWorkgroup", "maxComputeWorkgroupSizeX",
    "maxComputeWorkgroupSizeY", "maxComputeWorkgroupSizeZ", "maxComputeWorkgroupsPerDimension", "minSubgroupSize",
    "maxSubgroupSize", "maxPushConstantSize", "maxNonSamplerBindings",
]);
// WebGPU spec defaults: requiredLimits only carries values better than these.
const WEBGPU_DEFAULT_LIMITS = {
    maxTextureDimension1D: 8192, maxTextureDimension2D: 8192, maxTextureDimension3D: 2048, maxTextureArrayLayers: 256,
    maxBindGroups: 4, maxBindingsPerBindGroup: 1000, maxDynamicUniformBuffersPerPipelineLayout: 8,
    maxDynamicStorageBuffersPerPipelineLayout: 4, maxSampledTexturesPerShaderStage: 16, maxSamplersPerShaderStage: 16,
    maxStorageBuffersPerShaderStage: 8, maxStorageTexturesPerShaderStage: 4, maxUniformBuffersPerShaderStage: 12,
    maxUniformBufferBindingSize: 65536, maxStorageBufferBindingSize: 134217728, maxVertexBuffers: 8,
    maxBufferSize: 268435456, maxVertexAttributes: 16, maxVertexBufferArrayStride: 2048,
    minUniformBufferOffsetAlignment: 256, minStorageBufferOffsetAlignment: 256, maxColorAttachments: 8,
    maxColorAttachmentBytesPerSample: 32, maxComputeWorkgroupStorageSize: 16384, maxComputeInvocationsPerWorkgroup: 256,
    maxComputeWorkgroupSizeX: 256, maxComputeWorkgroupSizeY: 256, maxComputeWorkgroupSizeZ: 64,
    maxComputeWorkgroupsPerDimension: 65535,
};
// wgt::Features bit -> WebGPU feature name (only the bits WebGPU exposes).
export const FEATURE_BITS = Object.freeze({
    0: "depth-clip-control", 1: "depth32float-stencil8", 2: "texture-compression-bc", 3: "texture-compression-etc2",
    4: "texture-compression-astc", 5: "timestamp-query", 6: "indirect-first-instance", 7: "shader-f16",
    8: "rg11b10ufloat-renderable", 9: "bgra8unorm-storage", 10: "float32-filterable", 54: "dual-source-blending",
    56: "subgroups",
});
const PCI_VENDORS = { nvidia: 0x10de, amd: 0x1002, intel: 0x8086, apple: 0x106b, qualcomm: 0x5143, arm: 0x13b5,
    google: 0x1ae0, microsoft: 0x1414, imgtec: 0x1010, mesa: 0x10005 };

class WgpuError extends Error {
    constructor(type, message) {
        super(message);
        this.type = type;
    }
}
class TransportError extends Error {
    constructor(errno) {
        super("errno " + errno);
        this.errno = errno;
    }
}
const validation = (message) => new WgpuError(ERR.VALIDATION, message);

function guestRange(memory, pointer, length) {
    const ptr = Number(pointer), len = Number(length);
    if (!Number.isSafeInteger(ptr) || !Number.isSafeInteger(len) || len < 0 || len > MAX_DATA)
        throw new TransportError(EINVAL);
    const buffer = memory.buffer;
    if ((len > 0 && ptr === 0) || ptr + len > buffer.byteLength)
        throw new TransportError(EFAULT);
    return new Uint8Array(buffer, ptr, len);
}

// Raw wgpu id helpers.
export function unzipId(raw) {
    const v = BigInt.asUintN(64, BigInt(raw));
    return { index: Number(v & 0xffffffffn), epoch: Number((v >> 32n) & 0x1fffffffn), backend: Number(v >> 61n), raw: v };
}
export function zipId(index, epoch, backend) {
    return BigInt(index >>> 0) | (BigInt(epoch & 0x1fffffff) << 32n) | (BigInt(backend) << 61n);
}
function idFromWire(value) {
    // Decoder JSON form of a SerialId: {"Id": [index, epoch, "Vulkan"]}
    const triple = value?.Id;
    if (!Array.isArray(triple) || triple.length !== 3)
        throw validation("unsupported id encoding " + JSON.stringify(value));
    const backend = BACKENDS.indexOf(triple[2]);
    if (backend < 0)
        throw validation("unknown backend " + triple[2]);
    return zipId(Number(triple[0]), Number(triple[1]), backend);
}
const idText = (raw) => { const { index, epoch, backend } = unzipId(raw); return `(${index},${epoch},${BACKENDS[backend] ?? backend})`; };

class Table {
    constructor(kind) {
        this.kind = kind;
        this.map = new Map();
    }
    insert(raw, object) {
        const id = unzipId(raw);
        if (id.raw === 0n)
            throw validation(`${this.kind} id is zero`);
        const live = this.map.get(id.index);
        if (live)
            throw validation(live.epoch === id.epoch
                ? `${this.kind} id ${idText(raw)} is already in use`
                : `${this.kind} index ${id.index} reused with epoch ${id.epoch} while epoch ${live.epoch} is live`);
        this.map.set(id.index, { epoch: id.epoch, backend: id.backend, object });
        return object;
    }
    // Throws exactly what insert would throw, without inserting.
    checkFree(raw) {
        const id = unzipId(raw);
        if (id.raw === 0n)
            throw validation(`${this.kind} id is zero`);
        const live = this.map.get(id.index);
        if (live)
            throw validation(live.epoch === id.epoch
                ? `${this.kind} id ${idText(raw)} is already in use`
                : `${this.kind} index ${id.index} reused with epoch ${id.epoch} while epoch ${live.epoch} is live`);
    }
    get(raw) {
        const id = unzipId(raw);
        const live = this.map.get(id.index);
        if (!live)
            throw validation(`invalid ${this.kind} id ${idText(raw)}`);
        if (live.epoch !== id.epoch || live.backend !== id.backend)
            throw validation(`stale ${this.kind} id ${idText(raw)}: live epoch ${live.epoch}`);
        return live.object;
    }
    has(raw) {
        try { this.get(raw); return true; } catch { return false; }
    }
    remove(raw) {
        const object = this.get(raw);
        this.map.delete(unzipId(raw).index);
        return object;
    }
    get size() {
        return this.map.size;
    }
}

class Global {
    constructor(handle) {
        this.handle = handle;
        this.adapters = new Table("adapter");
        this.devices = new Table("device");
        this.buffers = new Table("buffer");
        this.encoders = new Table("command encoder");
        this.commandBuffers = new Table("command buffer");
        this.events = [];
        this.pending = new Set(); // promises of outstanding asynchronous work
        this.submissions = 0;
        this.eventsDropped = 0;
    }
    queue(event) {
        if (this.events.length >= 65536) {
            this.eventsDropped++;
            return;
        }
        this.events.push(event);
    }
    track(promise) {
        const tracked = promise.finally(() => this.pending.delete(tracked));
        this.pending.add(tracked);
        return tracked;
    }
}

const globals = new Map();
let nextGlobal = 1;
const counters = { calls: 0, errors: 0, transportErrors: 0 };

let decoderPromise = null;
function getDecoder() {
    if (!decoderPromise) {
        decoderPromise = (async () => {
            const base = new URL("../tests/firefox-webgpu-decoder/", import.meta.url);
            const { createDecoder } = await import(new URL("decoder.mjs", base).href);
            // Pinned W3 artifact; served next to this module (W4c ships it with the runtime).
            const response = await fetch(new URL("./firefox-webgpu-decoder.wasm", import.meta.url));
            if (!response.ok)
                throw new WgpuError(ERR.INTERNAL, "decoder wasm fetch failed: " + response.status);
            return createDecoder(await response.arrayBuffer());
        })();
        decoderPromise.catch(() => { decoderPromise = null; });
    }
    return decoderPromise;
}

async function decode(kind, bytes) {
    const decoder = await getDecoder();
    // The decoder copies the input into its own memory; pass a private copy of the guest range.
    const result = decoder.decode(kind, bytes.slice());
    if (result.status !== 0 || !result.ok)
        throw validation(`malformed ${kind} byte buffer (status ${result.status}): ${String(result.error ?? "").slice(0, 256)}`);
    return result.value;
}

function describe(error) {
    return String(error?.message ?? error).slice(0, MAX_MESSAGE);
}

// Run fn (sync or async) inside validation/out-of-memory/internal scopes on
// the device and turn the first host error into a WgpuError.
async function scoped(device, fn) {
    device.pushErrorScope("internal");
    device.pushErrorScope("out-of-memory");
    device.pushErrorScope("validation");
    let result, thrown = null;
    try {
        result = await fn();
    }
    catch (error) {
        thrown = error;
    }
    const pops = [device.popErrorScope(), device.popErrorScope(), device.popErrorScope()].map((p) => p.catch(() => null));
    const [v, o, i] = await Promise.all(pops);
    if (thrown instanceof WgpuError || thrown instanceof TransportError)
        throw thrown;
    if (thrown)
        throw new WgpuError(thrown?.name === "OperationError" && /memory/i.test(thrown.message) ? ERR.OUT_OF_MEMORY : ERR.VALIDATION,
            `${thrown?.name ?? "Error"}: ${describe(thrown)}`);
    if (v)
        throw new WgpuError(ERR.VALIDATION, describe(v));
    if (o)
        throw new WgpuError(ERR.OUT_OF_MEMORY, describe(o) || "out of memory");
    if (i)
        throw new WgpuError(ERR.INTERNAL, describe(i) || "internal error");
    return result;
}

class Writer {
    constructor() {
        this.parts = [];
        this.length = 0;
    }
    u64(value) {
        const bytes = new Uint8Array(8);
        new DataView(bytes.buffer).setBigUint64(0, BigInt.asUintN(64, BigInt(value)), true);
        this.parts.push(bytes);
        this.length += 8;
        return this;
    }
    bytes(data) {
        this.u64(data.length);
        const padded = new Uint8Array((data.length + 7) & ~7);
        padded.set(data);
        this.parts.push(padded);
        this.length += padded.length;
        return this;
    }
    string(text) {
        return this.bytes(new TextEncoder().encode(String(text ?? "")));
    }
    finish() {
        const out = new Uint8Array(this.length);
        let offset = 0;
        for (const part of this.parts) {
            out.set(part, offset);
            offset += part.length;
        }
        return out;
    }
}

function needGlobal(handle) {
    const global = globals.get(Number(handle));
    if (!global)
        throw validation("invalid global " + handle);
    return global;
}

function gpuBuffer(global, wireId) {
    const entry = global.buffers.get(idFromWire(wireId));
    if (!entry.buffer)
        throw validation(`buffer ${idText(idFromWire(wireId))} is invalid`);
    return entry.buffer;
}

function deviceOf(global, raw) {
    const entry = global.devices.get(raw);
    if (entry.lost)
        throw new WgpuError(ERR.DEVICE_LOST, `device ${idText(raw)} is lost: ${entry.lostMessage}`);
    return entry;
}

function labelOf(memory, ptr, len) {
    if (!Number(len))
        return undefined;
    return new TextDecoder().decode(guestRange(memory, ptr, len).slice());
}

async function requestHostAdapter(powerPreference, forceFallback) {
    if (typeof navigator === "undefined" || !navigator.gpu)
        return null;
    const options = { powerPreference };
    if (forceFallback)
        options.forceFallbackAdapter = true;
    return navigator.gpu.requestAdapter(options);
}

function featureBits(features) {
    let bits = 0n;
    for (const [bit, name] of Object.entries(FEATURE_BITS))
        if (features.has(name))
            bits |= 1n << BigInt(bit);
    return bits;
}

function limitValue(adapter, name) {
    const limits = adapter.limits;
    switch (name) {
        case "maxInterStageShaderComponents":
            return limits.maxInterStageShaderComponents ?? (limits.maxInterStageShaderVariables ?? 16) * 4;
        case "minSubgroupSize":
            return adapter.info?.subgroupMinSize ?? 0;
        case "maxSubgroupSize":
            return adapter.info?.subgroupMaxSize ?? 0;
        case "maxPushConstantSize":
            return 0;
        case "maxNonSamplerBindings":
            return 1000000; // wgt::Limits::default(); WebGPU has no equivalent
        default:
            return limits[name] ?? 0;
    }
}

function deviceType(adapter) {
    const info = adapter.info ?? {};
    if (info.isFallbackAdapter || adapter.isFallbackAdapter)
        return 4; // Cpu
    if (info.vendor === "intel")
        return 1; // IntegratedGpu (heuristic; WebGPU does not expose the device type)
    return 2;     // DiscreteGpu
}

function packInfo(adapter, backend) {
    const info = adapter.info ?? {};
    const w = new Writer();
    w.u64(LIMIT_FIELDS.length);
    for (const name of LIMIT_FIELDS)
        w.u64(limitValue(adapter, name));
    w.u64(featureBits(adapter.features));
    w.u64(PCI_VENDORS[info.vendor] ?? 0);
    w.u64(0); // PCI device id: not exposed by WebGPU
    w.u64(deviceType(adapter));
    w.u64(backend);
    w.u64(info.isFallbackAdapter ? 1 : 0);
    const name = info.description || [info.vendor, info.architecture].filter(Boolean).join(" ") || "WebGPU adapter";
    w.string(name);
    w.string("WebGPU (host passthrough)");
    w.string(`${info.vendor ?? ""} ${info.architecture ?? ""}`.trim());
    w.string(info.vendor ?? "");
    w.string(info.architecture ?? "");
    w.string(info.description ?? "");
    w.string([...adapter.features].sort().join(","));
    return w.finish();
}

function requiredFeatureNames(bits, adapter) {
    const names = [];
    let rest = BigInt.asUintN(64, BigInt(bits));
    for (let bit = 0n; rest; bit++, rest >>= 1n) {
        if (!(rest & 1n))
            continue;
        const name = FEATURE_BITS[Number(bit)];
        if (!name)
            throw validation(`required feature bit ${bit} has no WebGPU equivalent`);
        if (!adapter.features.has(name))
            throw validation(`required feature ${name} is not supported by the adapter`);
        names.push(name);
    }
    return names;
}

function requiredLimits(limits, adapter) {
    const out = {};
    for (const [name, value] of Object.entries(limits ?? {})) {
        const fallback = WEBGPU_DEFAULT_LIMITS[name];
        if (fallback === undefined || !(name in adapter.limits))
            continue;
        const v = Number(value);
        const better = name.startsWith("min") ? v < fallback : v > fallback;
        if (better)
            out[name] = v;
    }
    return out;
}

function attachDevice(global, raw, device) {
    const entry = { device, lost: false, lostMessage: "", lostCallback: null, dropped: false, destroyed: false };
    entry.lostPromise = device.lost.then((info) => {
        entry.lost = true;
        entry.lostMessage = String(info?.message ?? "");
        const reason = entry.dropped ? LOST.DROPPED : info?.reason === "destroyed" ? LOST.DESTROYED : LOST.UNKNOWN;
        global.queue({ kind: EVENT.DEVICE_LOST, id: raw, status: reason, callback: entry.lostCallback?.callback ?? 0n,
            userData: entry.lostCallback?.userData ?? 0n, message: entry.lostMessage });
    });
    device.onuncapturederror = (event) => {
        const error = event.error;
        const type = error instanceof GPUOutOfMemoryError ? ERR.OUT_OF_MEMORY
            : typeof GPUInternalError !== "undefined" && error instanceof GPUInternalError ? ERR.INTERNAL : ERR.VALIDATION;
        global.queue({ kind: EVENT.UNCAPTURED_ERROR, id: raw, status: type, callback: 0n, userData: 0n, message: describe(error) });
    };
    return entry;
}

function releaseBuffersOf(global, device) {
    for (const [index, live] of [...global.buffers.map])
        if (live.object.device === device) {
            try { live.object.buffer?.destroy(); } catch { }
            global.buffers.map.delete(index);
        }
    for (const table of [global.encoders, global.commandBuffers])
        for (const [index, live] of [...table.map])
            if (live.object.device === device)
                table.map.delete(index);
}

function destroyGlobal(global) {
    for (const live of global.buffers.map.values())
        try { live.object.buffer?.destroy(); } catch { }
    for (const live of global.devices.map.values()) {
        live.object.dropped = true;
        try { live.object.device.destroy(); } catch { }
    }
    globals.delete(global.handle);
}

// One call. Returns {type, message, payload, commit}. commit (optional) runs
// right before the response is written, only if the caller still waits.
async function execute(memory, call, f) {
    const w = new Writer();
    let commit = null;
    const arg = (i) => {
        if (i >= f.length)
            throw new TransportError(EINVAL);
        return f[i];
    };
    const n = (i) => {
        const v = arg(i);
        if (v > BigInt(Number.MAX_SAFE_INTEGER))
            throw validation(`argument ${i} out of range`);
        return Number(v);
    };
    switch (call) {
        case CALL.SERVER_NEW: {
            const handle = nextGlobal++;
            globals.set(handle, new Global(handle));
            w.u64(handle);
            break;
        }
        case CALL.SERVER_DELETE:
            destroyGlobal(needGlobal(arg(0)));
            break;
        case CALL.INSTANCE_REQUEST_ADAPTER: {
            const global = needGlobal(arg(0));
            const preference = n(1) === 1 ? "low-power" : "high-performance";
            const raw = arg(3);
            global.adapters.checkFree(raw);
            const adapter = await requestHostAdapter(preference, n(2) !== 0);
            if (adapter)
                global.adapters.insert(raw, { adapter, preference, forceFallback: n(2) !== 0, devices: 0 });
            w.u64(adapter ? 1 : 0);
            break;
        }
        case CALL.ADAPTER_PACK_INFO: {
            const global = needGlobal(arg(0));
            const entry = global.adapters.get(arg(1));
            w.finishOverride = packInfo(entry.adapter, unzipId(arg(1)).backend);
            break;
        }
        case CALL.ADAPTER_REQUEST_DEVICE: {
            const global = needGlobal(arg(0));
            const entry = global.adapters.get(arg(1));
            const raw = arg(2);
            global.devices.checkFree(raw);
            const desc = await decode("DeviceDescriptor", guestRange(memory, arg(3), arg(4)));
            const features = requiredFeatureNames(desc.required_features ?? 0, entry.adapter);
            const limits = requiredLimits(desc.required_limits, entry.adapter);
            // A GPUAdapter yields one device; wgpu adapters yield many. Use a fresh host adapter after the first.
            let adapter = entry.adapter;
            if (entry.devices++ > 0) {
                adapter = await requestHostAdapter(entry.preference, entry.forceFallback);
                if (!adapter)
                    throw new WgpuError(ERR.INTERNAL, "host adapter unavailable for another device");
            }
            let device;
            try {
                device = await adapter.requestDevice({ label: desc.label ?? undefined, requiredFeatures: features, requiredLimits: limits });
            }
            catch (error) {
                throw validation(`requestDevice failed: ${error?.name ?? "Error"}: ${describe(error)}`);
            }
            global.devices.insert(raw, attachDevice(global, raw, device));
            break;
        }
        case CALL.ADAPTER_DROP:
            needGlobal(arg(0)).adapters.remove(arg(1));
            break;
        case CALL.DEVICE_CREATE_BUFFER: {
            const global = needGlobal(arg(0));
            const entry = deviceOf(global, arg(1));
            const raw = arg(2);
            global.buffers.checkFree(raw);
            const size = n(3), usage = n(4), mappedAtCreation = n(5) !== 0;
            const label = labelOf(memory, arg(6), arg(7));
            // Like wgpu-core, a failed creation still binds the id (to an invalid buffer), so the
            // client's later destroy/drop of that id succeeds; the error is returned by this call.
            let created = null, failure = null;
            try {
                await scoped(entry.device, () => { created = entry.device.createBuffer({ label, size, usage, mappedAtCreation }); });
            }
            catch (error) {
                failure = error;
            }
            global.buffers.insert(raw, { buffer: created, device: entry.device, size, usage, invalid: Boolean(failure),
                mapping: mappedAtCreation && !failure ? { mode: 2, ranges: new Map() } : null, mapPending: false });
            if (failure)
                throw failure;
            break;
        }
        case CALL.BUFFER_MAP: {
            const global = needGlobal(arg(0));
            const buffer = global.buffers.get(arg(1));
            const start = n(2), size = n(3), mode = n(4), callback = arg(5), userData = arg(6);
            if (mode !== 1 && mode !== 2)
                throw validation("map mode must be READ (1) or WRITE (2)");
            if (buffer.mapping)
                throw validation("buffer is already mapped");
            if (buffer.mapPending)
                throw validation("buffer map is already pending");
            const raw = arg(1);
            if (!buffer.buffer)
                throw validation("buffer is invalid");
            buffer.mapPending = true;
            // mapAsync validation errors surface as its rejection; complete through the event queue like wgpu.
            const promise = buffer.buffer.mapAsync(mode === 1 ? GPUMapMode.READ : GPUMapMode.WRITE, start, size).then(() => {
                buffer.mapPending = false;
                buffer.mapping = { mode, ranges: new Map() };
                global.queue({ kind: EVENT.BUFFER_MAP, id: raw, status: MAP_STATUS.SUCCESS, callback, userData, message: "" });
            }, (error) => {
                buffer.mapPending = false;
                const status = buffer.device && global.devices.map.size && [...global.devices.map.values()]
                    .some((d) => d.object.device === buffer.device && d.object.lost) ? MAP_STATUS.CONTEXT_LOST
                    : error?.name === "AbortError" ? MAP_STATUS.ABORTED : MAP_STATUS.ERROR;
                global.queue({ kind: EVENT.BUFFER_MAP, id: raw, status, callback, userData, message: describe(error) });
            });
            global.track(promise);
            break;
        }
        case CALL.BUFFER_GET_MAPPED_RANGE: {
            const global = needGlobal(arg(0));
            const buffer = global.buffers.get(arg(1));
            const start = n(2), size = n(3);
            if (!buffer.mapping)
                throw validation("buffer is not mapped");
            const key = start + ":" + size;
            let host = buffer.mapping.ranges.get(key);
            if (!host) {
                try {
                    host = buffer.buffer.getMappedRange(start, size);
                }
                catch (error) {
                    throw validation(`getMappedRange(${start}, ${size}): ${error?.name}: ${describe(error)}`);
                }
                buffer.mapping.ranges.set(key, host);
            }
            const dst = guestRange(memory, arg(4), size);
            commit = () => dst.set(new Uint8Array(host));
            w.u64(size);
            break;
        }
        case CALL.BUFFER_UNMAP: {
            const global = needGlobal(arg(0));
            const buffer = global.buffers.get(arg(1));
            if (!buffer.mapping)
                throw validation("buffer is not mapped");
            const src = arg(2), start = n(3), size = n(4);
            if (src !== 0n) {
                if (buffer.mapping.mode !== 2)
                    throw validation("write-back into a READ mapping");
                const host = buffer.mapping.ranges.get(start + ":" + size);
                if (!host)
                    throw validation("write-back range was not returned by get_mapped_range");
                new Uint8Array(host).set(guestRange(memory, src, size));
            }
            buffer.mapping = null;
            buffer.buffer.unmap();
            break;
        }
        case CALL.BUFFER_DESTROY: {
            const buffer = needGlobal(arg(0)).buffers.get(arg(1));
            buffer.mapping = null;
            buffer.buffer?.destroy();
            break;
        }
        case CALL.BUFFER_DROP: {
            const buffer = needGlobal(arg(0)).buffers.remove(arg(1));
            buffer.buffer?.destroy(); // no garbage collection hint in WebGPU; drop releases the GPU memory now
            break;
        }
        case CALL.DEVICE_CREATE_ENCODER:
        case CALL.DEVICE_ACTION: {
            const global = needGlobal(arg(0));
            const entry = deviceOf(global, arg(1));
            let raw, label;
            if (call === CALL.DEVICE_ACTION) {
                const action = await decode("DeviceAction", guestRange(memory, arg(2), arg(3)));
                if (!action?.CreateCommandEncoder)
                    throw new WgpuError(ERR.INTERNAL, "W4a executes only DeviceAction::CreateCommandEncoder, got " +
                        Object.keys(action ?? {})[0]);
                raw = idFromWire(action.CreateCommandEncoder[0]);
                label = action.CreateCommandEncoder[1]?.label ?? undefined;
            }
            else {
                raw = arg(2);
                label = labelOf(memory, arg(3), arg(4));
            }
            global.encoders.checkFree(raw);
            global.commandBuffers.checkFree(raw);
            const encoder = await scoped(entry.device, () => entry.device.createCommandEncoder({ label }));
            global.encoders.insert(raw, { encoder, device: entry.device });
            break;
        }
        case CALL.COMMAND_ENCODER_ACTION: {
            const global = needGlobal(arg(0));
            const entry = global.encoders.get(arg(1));
            const action = await decode("CommandEncoderAction", guestRange(memory, arg(2), arg(3)));
            const [name] = Object.keys(action ?? {});
            const body = action?.[name];
            await scoped(entry.device, () => {
                switch (name) {
                    case "CopyBufferToBuffer":
                        return entry.encoder.copyBufferToBuffer(gpuBuffer(global, body.src), Number(body.src_offset),
                            gpuBuffer(global, body.dst), Number(body.dst_offset), Number(body.size));
                    case "ClearBuffer":
                        return entry.encoder.clearBuffer(gpuBuffer(global, body.dst), Number(body.offset),
                            body.size === null || body.size === undefined ? undefined : Number(body.size));
                    case "PushDebugGroup":
                        return entry.encoder.pushDebugGroup(String(body));
                    case "PopDebugGroup":
                        return entry.encoder.popDebugGroup();
                    case "InsertDebugMarker":
                        return entry.encoder.insertDebugMarker(String(body));
                    default:
                        throw new WgpuError(ERR.INTERNAL, "W4a does not execute CommandEncoderAction::" + name);
                }
            });
            break;
        }
        case CALL.ENCODER_FINISH: {
            const global = needGlobal(arg(0));
            const raw = arg(1);
            const entry = global.encoders.get(raw);
            const label = labelOf(memory, arg(2), arg(3));
            global.encoders.remove(raw);
            // The command buffer takes the encoder's id (as in wgpu-core), even when finish fails (an invalid buffer).
            let commandBuffer = null, failure = null;
            try {
                commandBuffer = await scoped(entry.device, () => entry.encoder.finish({ label }));
            }
            catch (error) {
                failure = error;
            }
            global.commandBuffers.insert(raw, { commandBuffer, device: entry.device, invalid: Boolean(failure) });
            if (failure)
                throw failure;
            break;
        }
        case CALL.ENCODER_DROP: {
            const global = needGlobal(arg(0));
            if (global.encoders.has(arg(1)))
                global.encoders.remove(arg(1));
            else
                global.commandBuffers.remove(arg(1));
            break;
        }
        case CALL.QUEUE_WRITE_ACTION: {
            const global = needGlobal(arg(0));
            const entry = deviceOf(global, arg(1));
            const action = await decode("QueueWriteAction", guestRange(memory, arg(2), arg(3)));
            if (!action?.Buffer)
                throw new WgpuError(ERR.INTERNAL, "W4a executes only QueueWriteAction::Buffer");
            const target = gpuBuffer(global, action.Buffer.dst);
            const data = guestRange(memory, arg(4), arg(5));
            // Chromium snapshots SharedArrayBuffer views at call time (W2 probe), so no copy.
            await scoped(entry.device, () => entry.device.queue.writeBuffer(target, Number(action.Buffer.offset), data));
            break;
        }
        case CALL.QUEUE_SUBMIT: {
            const global = needGlobal(arg(0));
            const entry = deviceOf(global, arg(1));
            const count = n(3);
            if (count > 4096)
                throw validation("too many command buffers");
            const ids = guestRange(memory, arg(2), count * 8).slice();
            const view = new DataView(ids.buffer);
            const buffers = [];
            for (let i = 0; i < count; i++) {
                const raw = view.getBigUint64(i * 8, true);
                const cb = global.commandBuffers.remove(raw); // consumed by submission, like wgpu-core
                if (cb.invalid)
                    throw validation(`command buffer ${idText(raw)} is invalid`);
                buffers.push(cb.commandBuffer);
            }
            await scoped(entry.device, () => entry.device.queue.submit(buffers));
            w.u64(++global.submissions);
            break;
        }
        case CALL.QUEUE_ON_SUBMITTED_WORK_DONE: {
            const global = needGlobal(arg(0));
            const raw = arg(1), callback = arg(2), userData = arg(3);
            const entry = deviceOf(global, raw);
            global.track(entry.device.queue.onSubmittedWorkDone().then(
                () => global.queue({ kind: EVENT.WORK_DONE, id: raw, status: 0, callback, userData, message: "" }),
                (error) => global.queue({ kind: EVENT.WORK_DONE, id: raw, status: 1, callback, userData, message: describe(error) })));
            break;
        }
        case CALL.DEVICE_SET_LOST_CALLBACK: {
            const entry = needGlobal(arg(0)).devices.get(arg(1));
            entry.lostCallback = { callback: arg(2), userData: arg(3) };
            break;
        }
        case CALL.POLL_ALL_DEVICES: {
            const global = needGlobal(arg(0));
            if (n(1)) {
                // force_wait: all queued work and pending maps settle (bounded at 5 s).
                const waits = [...global.devices.map.values()].filter((d) => !d.object.lost)
                    .map((d) => d.object.device.queue.onSubmittedWorkDone().catch(() => { }));
                await Promise.race([Promise.allSettled([...waits, ...global.pending]), new Promise((r) => setTimeout(r, 5000))]);
            }
            else {
                await new Promise((r) => setTimeout(r, 0)); // let already-resolved host callbacks run
            }
            const events = global.events.splice(0, MAX_EVENTS_PER_POLL);
            w.u64(events.length);
            w.u64(global.events.length); // still queued (more than one poll's worth)
            for (const event of events) {
                w.u64(event.kind).u64(event.id).u64(event.status).u64(event.callback).u64(event.userData);
                w.string(event.message.slice(0, MAX_MESSAGE));
            }
            break;
        }
        case CALL.DEVICE_DESTROY: {
            const global = needGlobal(arg(0));
            const entry = global.devices.get(arg(1));
            entry.destroyed = true;
            entry.device.destroy();
            break;
        }
        case CALL.DEVICE_DROP: {
            const global = needGlobal(arg(0));
            const entry = global.devices.remove(arg(1));
            entry.dropped = !entry.destroyed;
            releaseBuffersOf(global, entry.device);
            entry.device.destroy();
            break;
        }
        case CALL.STATS: {
            const handle = Number(arg(0));
            const list = handle ? [needGlobal(handle)] : [...globals.values()];
            const sum = (pick) => list.reduce((total, g) => total + pick(g), 0);
            w.u64(globals.size);
            w.u64(sum((g) => g.adapters.size));
            w.u64(sum((g) => g.devices.size));
            w.u64(sum((g) => g.buffers.size));
            w.u64(sum((g) => g.encoders.size));
            w.u64(sum((g) => g.commandBuffers.size));
            w.u64(sum((g) => g.pending.size));
            w.u64(sum((g) => g.events.length));
            w.u64(sum((g) => [...g.buffers.map.values()].filter((b) => b.object.mapping).length));
            w.u64(counters.calls);
            w.u64(counters.errors);
            w.u64(sum((g) => g.eventsDropped));
            break;
        }
        default:
            throw new TransportError(EINVAL);
    }
    return { payload: w.finishOverride ?? w.finish(), commit };
}

function response(call, type, message, payload) {
    const text = new TextEncoder().encode(String(message ?? "").slice(0, MAX_MESSAGE));
    const out = new Uint8Array(WGPU_RESP_HEADER + payload.length + text.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, WGPU_RESP_MAGIC, true);
    view.setUint16(4, WGPU_VERSION, true);
    view.setUint16(6, call, true);
    view.setUint32(8, type, true);
    view.setUint32(12, payload.length, true);
    view.setUint32(16, text.length, true);
    out.set(payload, WGPU_RESP_HEADER);
    out.set(text, WGPU_RESP_HEADER + payload.length);
    return out;
}

/**
 * Execute one OP_WGPU hostcall. args = [req_ptr, req_len, resp_ptr, resp_cap, resp_len_out].
 * Resolves to a function that writes the response into guest memory and
 * returns the hostcall result (called by the owner only while the caller still waits).
 */
export async function handleWgpuCall(memory, args) {
    counters.calls++;
    const [reqPtr, reqLen, respPtr, respCap, respLenOut] = args.map((v) => v >>> 0);
    let call = 0, fields;
    try {
        if (reqLen < WGPU_REQ_HEADER || reqLen > MAX_REQUEST)
            throw new TransportError(EINVAL);
        const request = guestRange(memory, reqPtr, reqLen).slice();
        const view = new DataView(request.buffer);
        call = view.getUint16(6, true);
        const payloadLen = view.getUint32(8, true);
        if (view.getUint32(0, true) !== WGPU_REQ_MAGIC || view.getUint16(4, true) !== WGPU_VERSION ||
            view.getUint32(12, true) !== 0 || payloadLen % 8 !== 0 || WGPU_REQ_HEADER + payloadLen !== reqLen)
            throw new TransportError(EINVAL);
        fields = [];
        for (let offset = WGPU_REQ_HEADER; offset < reqLen; offset += 8)
            fields.push(view.getBigUint64(offset, true));
        // Validate the response pointers up front, so a bad pointer is a transport error with no side effects.
        guestRange(memory, respPtr, respCap);
        if (respLenOut)
            guestRange(memory, respLenOut, 4);
        else
            throw new TransportError(EFAULT);
    }
    catch (error) {
        counters.transportErrors++;
        const errno = error instanceof TransportError ? error.errno : EINVAL;
        return () => -errno;
    }
    let bytes, commit = null;
    try {
        const result = await execute(memory, call, fields);
        bytes = response(call, ERR.NONE, "", result.payload);
        commit = result.commit;
    }
    catch (error) {
        if (error instanceof TransportError) {
            counters.transportErrors++;
            return () => -error.errno;
        }
        counters.errors++;
        const type = error instanceof WgpuError ? error.type : ERR.INTERNAL;
        bytes = response(call, type, error instanceof WgpuError ? error.message : `internal: ${error?.name}: ${describe(error)}`,
            new Uint8Array(0));
    }
    return () => {
        try {
            const lenOut = guestRange(memory, respLenOut, 4);
            new DataView(lenOut.buffer, lenOut.byteOffset, 4).setUint32(0, bytes.length, true);
            if (bytes.length > respCap)
                return -ENOSPC; // the call itself was executed; only the response did not fit
            if (commit)
                commit();
            guestRange(memory, respPtr, bytes.length).set(bytes);
            return bytes.length;
        }
        catch (error) {
            counters.transportErrors++;
            return error instanceof TransportError ? -error.errno : -EFAULT;
        }
    };
}

/** Host-side introspection for runners and page tests. */
export function wgpuExecutorStats() {
    return { globals: globals.size, ...counters };
}
