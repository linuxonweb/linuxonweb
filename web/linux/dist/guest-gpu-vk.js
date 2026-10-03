// SPDX-License-Identifier: MIT
//
// Guest Vulkan ICD sessions over the gpu_hostcall channel (the default guest
// GPU transport; see docs/guest-vulkan-webgpu-backend-20261001.md). The owner
// Worker runs the same serveGPU protocol executor as the virtio-vsock path
// (tests/guest-gpu/host.mjs), so the command set, validation and the WebGPU-first
// / WebGL2-fallback backends are unchanged; only the byte transport differs:
//
//   OP_VK_OPEN  (flags)                         -> session id > 0 | -errno
//   OP_VK_CALL  (session, io, payload, reply, cap) -> 0 | -errno
//       io: 20 bytes. In: the 16-byte request header (magic, version, opcode,
//       request id, payload length). Out: the 16-byte reply header followed by
//       the int32 protocol status. The reply body (header length - 4 bytes) is
//       written to `reply`; a body larger than `cap` fails with -ENOSPC.
//   OP_VK_CLOSE (session)                       -> 0 | -errno
//
// One call may be in flight per session (-EBUSY otherwise). A session whose
// executor ended (CLOSE, terminal status, device loss) fails later calls with
// -EIO. Transport errors are -errno; protocol errors travel in the status word.

export const OP_VK_OPEN = 0x20;
export const OP_VK_CALL = 0x21;
export const OP_VK_CLOSE = 0x22;
export const VK_OPEN_FLAG_FORCE_WEBGL = 1;
export const VK_OPEN_FLAG_FORCE_WEBGPU = 2;

const EIO = 5, EBUSY = 16, EINVAL = 22, ENOSPC = 28, EMFILE = 24, ENODEV = 19;
const MAX_SESSIONS = 16;
const MAX_PAYLOAD = 1048576;

class Fault extends Error {
    constructor(errno, message = "guest errno " + errno) {
        super(message);
        this.errno = errno;
    }
}

const sessions = new Map();
let nextSession = 1;
let hostModule = null;
// Sessions are opt-in per page: without a `vk` owner config OPEN fails with
// -ENODEV and the guest falls back to virtio-vsock (the test suites rely on it).
let config = { enabled: false, backend: "auto" };

export function configureVk(value) {
    if (!value || typeof value !== "object")
        return;
    config = { enabled: value.enabled !== false, backend: ["auto", "webgpu", "webgl", "wgpu"].includes(value.backend) ? value.backend : "auto", wgpuBackend: value.wgpuBackend ?? "auto", forceFallbackAdapter: value.forceFallbackAdapter === true, allowResources: value.allowResources === true };
}

function view(memory, pointer, length) {
    const buffer = memory.buffer;
    pointer >>>= 0;
    if (length < 0 || pointer + length > buffer.byteLength || (length && !pointer))
        throw new Fault(14);
    return new Uint8Array(buffer, pointer, length);
}

/** A serveGPU connection fed by hostcalls: one request in, one reply out. */
function createSession(id, log) {
    const reads = [];          // queued byte chunks for readExactly
    let readWaiter = null;     // {n, resolve}
    let pending = null;        // {resolve, reject} of the in-flight call
    let ended = false;
    const deliver = () => {
        if (!readWaiter)
            return;
        if (readWaiter.n === 0) {
            // Empty payloads (HELLO, CLOSE) are never queued.
            const { resolve } = readWaiter;
            readWaiter = null;
            resolve(new Uint8Array());
            return;
        }
        if (ended && !reads.length) {
            const { resolve } = readWaiter;
            readWaiter = null;
            resolve(new Uint8Array());
            return;
        }
        const chunk = reads[0];
        if (!chunk)
            return;
        if (chunk.byteLength !== readWaiter.n) {
            // serveGPU reads exactly the header, then exactly the payload.
            const { reject } = readWaiter;
            readWaiter = null;
            reject(new Error("hostcall framing mismatch"));
            return;
        }
        reads.shift();
        const { resolve } = readWaiter;
        readWaiter = null;
        resolve(chunk);
    };
    const end = (reason) => {
        if (ended)
            return;
        ended = true;
        deliver();
        if (pending) {
            const { reject } = pending;
            pending = null;
            reject(new Fault(EIO, reason));
        }
    };
    const connection = {
        readExactly(n) {
            return new Promise((resolve, reject) => {
                readWaiter = { n, resolve, reject };
                deliver();
            });
        },
        async write(bytes) {
            if (!pending)
                return; // the caller abandoned the request
            const { resolve } = pending;
            pending = null;
            resolve(bytes);
        },
        close() {
            end("session closed");
        },
    };
    const session = {
        id,
        get ended() {
            return ended;
        },
        call(header, payload) {
            if (ended)
                return Promise.reject(new Fault(EIO, "session ended"));
            if (pending)
                return Promise.reject(new Fault(EBUSY));
            const promise = new Promise((resolve, reject) => {
                pending = { resolve, reject };
            });
            reads.push(header);
            if (payload.byteLength)
                reads.push(payload);
            deliver();
            return promise;
        },
        abandon() {
            pending = null;
        },
        close() {
            end("session closed");
        },
        done: null,
    };
    return { session, connection };
}

async function openSession(flags, log) {
    if (!config.enabled)
        throw new Fault(ENODEV);
    if (sessions.size >= MAX_SESSIONS)
        throw new Fault(EMFILE);
    if ((flags & ~3) || flags === 3)
        throw new Fault(EINVAL);
    hostModule ??= Promise.all([import("../tests/guest-gpu/host.mjs"), import("../gputest.mjs")]);
    const [{ serveGPU }, { GPUTEST_TRANSLATORS }] = await hostModule;
    const backend = flags & VK_OPEN_FLAG_FORCE_WEBGL ? "webgl" : flags & VK_OPEN_FLAG_FORCE_WEBGPU ? "webgpu" : config.backend;
    const gpu = backend === "webgl" || backend === "wgpu" ? null : globalThis.navigator?.gpu;
    const wgpuFactory = backend === "wgpu" ? async () => {
        const { createWgpuRenderer } = await import("../tests/guest-vulkan-wgpu/bridge.mjs");
        const renderer = await createWgpuRenderer({backend: config.wgpuBackend, forceFallbackAdapter: config.forceFallbackAdapter, allowResources:config.allowResources});
        return { renderer, backend: "wgpu", adapter: renderer.adapter };
    } : undefined;
    const id = nextSession++;
    const { session, connection } = createSession(id, log);
    sessions.set(id, session);
    session.done = serveGPU(connection, {
        gpu, allowGraphics: true, allowWebGL: backend !== "webgpu" && backend !== "wgpu", allowUniforms: backend !== "wgpu" || config.allowResources, allowTextures: backend !== "wgpu" || config.allowResources, allowDepth: backend !== "wgpu" || config.allowResources,
        graphicsBackendFactory: wgpuFactory,
        timeoutMs: 0x7fffffff,
        graphicsTranslatorOptions: GPUTEST_TRANSLATORS.wgsl, webglTranslatorOptions: GPUTEST_TRANSLATORS.glsl,
        onEvent(event) {
            if (event.type === "adapter")
                log(`vk session ${id} backend=${event.backend} adapter=${JSON.stringify({ vendor: event.vendor, architecture: event.architecture, description: event.description, name:event.name, driver:event.driver, driverInfo:event.driverInfo, deviceType:event.deviceType, wgpuBackend:event.backend, forceFallbackAdapter:event.forceFallbackAdapter })}`);
        },
    }).then((report) => {
        log(`vk session ${id} closed commands=${report.commands} passes=${report.graphicsPasses} draws=${report.graphicsDraws}${report.error ? " error=" + JSON.stringify(report.error) : ""}`);
        if (backend === "wgpu") log("GUEST_WGPU_HOST_REPORT " + JSON.stringify(report));
        return report;
    }, (error) => {
        log(`vk session ${id} failed: ${error?.message ?? error}`);
    }).finally(() => {
        session.close();
        sessions.delete(id);
    });
    return id;
}

/**
 * Executes one ICD hostcall. Returns a promise of a `write` function that the
 * owner runs only if the caller still waits (completeWith), so guest memory is
 * never written for an abandoned request.
 */
export async function handleVkCall(memory, op, a, log) {
    switch (op) {
        case OP_VK_OPEN: {
            const id = await openSession(a[0] >>> 0, log);
            return () => id;
        }
        case OP_VK_CLOSE: {
            const session = sessions.get(a[0] >>> 0);
            if (!session)
                throw new Fault(EINVAL);
            session.close();
            return () => 0;
        }
        case OP_VK_CALL: {
            const session = sessions.get(a[0] >>> 0);
            if (!session)
                throw new Fault(session === undefined ? ENODEV : EINVAL);
            const io = view(memory, a[1], 20);
            const header = io.slice(0, 16);
            const length = new DataView(header.buffer).getUint32(12, true);
            if (length > MAX_PAYLOAD)
                throw new Fault(EINVAL);
            // Copy: the executor may keep the payload past this call.
            const payload = view(memory, a[2], length).slice();
            const replyPointer = a[3] >>> 0, capacity = a[4] >>> 0;
            const reply = await session.call(header, payload);
            return () => {
                if (reply.byteLength < 20)
                    throw new Fault(EIO);
                const body = reply.subarray(20);
                if (body.byteLength > capacity)
                    return -ENOSPC;
                if (body.byteLength)
                    view(memory, replyPointer, body.byteLength).set(body);
                view(memory, a[1], 20).set(reply.subarray(0, 20));
                return 0;
            };
        }
        default:
            throw new Fault(EINVAL);
    }
}
