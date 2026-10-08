// SPDX-License-Identifier: MIT
//
// Guest GPU hostcall channel (packet W2 of docs/firefox-webgpu-design-20260929.md).
//
// A guest thread issues a private syscall number. Its Worker intercepts that
// number in the linux.syscall closure (worker.js), writes the request into its
// own slot of a page-wide SharedArrayBuffer ("hub"), rings a doorbell, and blocks
// in Atomics.wait. One host GPU-owner Worker per machine (guest-gpu-owner.js)
// waits for the doorbell with Atomics.waitAsync, so it keeps its event loop and
// can run asynchronous WebGPU work while guest threads stay blocked. The owner
// receives every calling process's WebAssembly.Memory (relayed once per slot by
// the page), so it reads and writes guest memory directly.
//
// Private syscall numbers (i386 numbering stops far below this range; the JIT
// primitive uses 0x6a49xxxx):
//   0x6a470001 gpu_hostcall(op, a0, a1, a2, a3, a4)  -> result >= 0 | -errno
//   0x6a470002 gpu_hostcall_stats(out_ptr)           -> 0 | -errno  (local, no owner)
//   0x6a470003 gpu_hostcall_control(cmd, arg)        -> 0 | -errno  (test hooks)
//
// Concurrency: one slot per guest thread (claimed by CAS at the first call,
// released at worker_exit). A thread has at most one syscall in flight, so a
// slot never needs a lock, threads never contend with each other, and a slow
// asynchronous request (mapAsync, adapter request) of one thread does not block
// another thread's request: the owner executes slots concurrently.
//
// Slot state word: (seq << 2) | STATE_*. seq is a per-slot counter (S_SEQ,
// never reset, 30 bits, never 0) taken for every request, so the owner's
// BUSY -> DONE compare-exchange only succeeds for the exact request it served;
// a late completion of an abandoned request can never be taken for a later one,
// even after the slot passed to another thread.
//
// Waiting: guest user code is never preempted, and a Worker blocked in
// Atomics.wait here never enters the kernel, so its virtual CPU would stay
// captive (timer interrupts, other runnable tasks and signal/kill delivery for
// that CPU all wait for the call). After a short pure wait (FAST_WAIT_MS, which
// covers ordinary synchronous calls) the caller therefore alternates
// YIELD_SLICE_MS waits with a sched_yield kernel entry supplied by worker.js.
// That entry processes pending interrupts, lets the scheduler run other tasks,
// delivers signals (a handler that re-enters gpu_hostcall gets -EBUSY) and lets
// exit_group/SIGKILL unwind the thread; an unwinding call abandons its request.
//
// Owner loss: the page marks the owner dead on a Worker error, on test
// termination and on machine close; a caller whose owner heartbeat stalls for
// STALL_MS marks it dead itself and asks the page to terminate it. Dead
// owners wake every slot. A call that was already taken by the owner returns
// -EIO (it may have partially executed); calls that were not taken return
// -ENODEV. The owner stays dead for the rest of the machine (test hook respawn
// only).

export const GPU_HC_CALL = 0x6a470001;
export const GPU_HC_STATS = 0x6a470002;
export const GPU_HC_CONTROL = 0x6a470003;
export const GPU_HC_MIN = GPU_HC_CALL;
export const GPU_HC_MAX = GPU_HC_CONTROL;

// Operations for GPU_HC_CALL.
export const OP_ECHO = 1;              // (value) -> value & 0x7fffffff
export const OP_CHECKSUM = 2;          // (ptr, len, out_u32_ptr) -> 0; FNV-1a 32 of the range
export const OP_FILL = 3;              // (ptr, len, seed) -> 0; byte i = ((seed ^ i*0x9E3779B1) >>> 13) & 0xff
export const OP_ADAPTER_INFO = 4;      // (out, cap, len_out_ptr) -> bytes of JSON | -ENOSPC (len_out = needed)
export const OP_WRITEBUFFER_PROBE = 5; // (src, len, out, cap, len_out_ptr) -> bytes of JSON | -errno
export const OP_SLEEP = 6;             // (ms <= 10000) -> 0, asynchronous on the owner
export const OP_TEST_HANG = 0x100;     // owner spins forever (heartbeat stops); test hook
export const OP_TEST_CLOSE = 0x101;    // owner calls self.close() without replying; test hook
export const OP_TEST_TERMINATE = 0x102; // owner asks the page to terminate it; test hook

// Commands for GPU_HC_CONTROL (all test hooks, -EPERM unless enabled).
export const CTL_RESPAWN = 1;          // start a fresh owner if the current one is dead
export const CTL_SET_STALL_MS = 2;     // (ms in 100..60000)

export const ENOENT = 2, EIO = 5, EAGAIN = 11, EFAULT = 14, EBUSY = 16, ENODEV = 19, EINVAL = 22, ENOSPC = 28,
    ENOSYS = 38, EPERM = 1, ETIMEDOUT = 110;

export const PROTOCOL_VERSION = 1;
export const MAX_SLOTS = 256;
export const MAX_RANGE = 256 << 20;

// Hub layout, 32-bit words.
export const H_MAGIC = 0, H_OWNER_STATE = 1, H_OWNER_GEN = 2, H_HEARTBEAT = 3, H_DOORBELL = 4, H_FLAGS = 5,
    H_NEXT_GEN = 6, H_DEAD_REASON = 7, H_STALL_MS = 8, H_STARTUP_MS = 9, H_CALLS = 10, H_TOKENS = 11;
export const H_PENDING = 16; // MAX_SLOTS / 32 words
export const H_SLOTS = 32;
export const SLOT_WORDS = 16;
export const S_TOKEN = 0, S_STATE = 1, S_SEQ = 2, S_OP = 3, S_GEN = 4, S_ARGS = 5, S_RESULT = 11, S_RESULT2 = 12;
export const HUB_BYTES = (H_SLOTS + MAX_SLOTS * SLOT_WORDS) * 4;
export const MAGIC = 0x47504831; // "GPH1"

export const OWNER_NONE = 0, OWNER_STARTING = 1, OWNER_ALIVE = 2, OWNER_DEAD = 3;
export const STATE_IDLE = 0, STATE_REQUEST = 1, STATE_BUSY = 2, STATE_DONE = 3;
export const DEAD_ERROR = 1, DEAD_STALL = 2, DEAD_TERMINATED = 3, DEAD_CLOSED = 4, DEAD_STARTUP = 5;
export const FLAG_TEST_HOOKS = 1;

const DEFAULT_STALL_MS = 3000, DEFAULT_STARTUP_MS = 20000, WAIT_SLICE_MS = 100;
export const FAST_WAIT_MS = 1, YIELD_SLICE_MS = 1;

export function slotWord(slot, word) {
    return H_SLOTS + slot * SLOT_WORDS + word;
}
export const SEQ_MASK = 0x3fffffff;
/** Packed slot state word. */
export function slotState(seq, state) {
    return ((seq & SEQ_MASK) << 2) | state;
}

// ---------------------------------------------------------------------------
// Guest-thread side (inside a machine Worker).

/**
 * One per machine Worker (= one guest thread). `post` is the worker channel to
 * the page. Never returns to the event loop; only Atomics and postMessage.
 */
export class GpuHostcallClient {
    constructor(hub, post, yieldToKernel = null) {
        this.hub = new Int32Array(hub);
        this.post = post;
        this.yieldToKernel = yieldToKernel;
        this.slot = -1;
        this.token = 0;
        this.memory = null;
        this.gen = 0;
        this.calls = 0;
        this.active = false;   // a call of this thread is in progress (reentrancy guard)
        this.inflight = 0;     // packed state word of the outstanding request, 0 if none
        this.yields = 0;
    }
    claim() {
        const hub = this.hub;
        if (this.slot >= 0)
            return this.slot;
        const token = Atomics.add(hub, H_TOKENS, 1) + 1 || 1;
        for (let slot = 0; slot < MAX_SLOTS; slot++) {
            if (Atomics.compareExchange(hub, slotWord(slot, S_TOKEN), 0, token) === 0) {
                Atomics.store(hub, slotWord(slot, S_STATE), STATE_IDLE);
                this.slot = slot;
                this.token = token;
                return slot;
            }
        }
        return -1;
    }
    attach(memory) {
        if (this.memory === memory)
            return;
        this.gen = Atomics.add(this.hub, H_NEXT_GEN, 1) + 1;
        this.memory = memory;
        // The page keeps the latest attach per slot and replays it to a respawned owner.
        this.post({ type: "gpu_hostcall", kind: "attach", slot: this.slot, gen: this.gen, memory });
    }
    release() {
        if (this.slot < 0)
            return;
        const slot = this.slot;
        if (this.inflight !== 0)
            this.abandon(slotWord(slot, 0)); // the thread exits inside a call (exit_group, SIGKILL)
        this.post({ type: "gpu_hostcall", kind: "detach", slot, gen: this.gen });
        Atomics.store(this.hub, slotWord(slot, S_STATE), STATE_IDLE);
        Atomics.store(this.hub, slotWord(slot, S_TOKEN), 0);
        this.slot = -1;
        this.memory = null;
    }
    markDead(expected, reason) {
        const hub = this.hub;
        if (Atomics.compareExchange(hub, H_OWNER_STATE, expected, OWNER_DEAD) === expected) {
            Atomics.store(hub, H_DEAD_REASON, reason);
            Atomics.notify(hub, H_OWNER_STATE);
            this.post({ type: "gpu_hostcall", kind: "dead", reason, gen: Atomics.load(hub, H_OWNER_GEN) });
        }
    }
    call(memory, op, a0, a1, a2, a3, a4) {
        const hub = this.hub;
        if (Atomics.load(hub, H_MAGIC) !== MAGIC)
            return -ENOSYS;
        if (this.active)
            return -EBUSY; // re-entered from a signal handler delivered while waiting
        if (Atomics.load(hub, H_OWNER_STATE) === OWNER_DEAD)
            return -ENODEV;
        const slot = this.claim();
        if (slot < 0)
            return -EAGAIN;
        this.attach(memory);
        const base = slotWord(slot, 0);
        let seq = (Atomics.add(hub, base + S_SEQ, 1) + 1) & SEQ_MASK;
        if (seq === 0) // a zero seq would make REQUEST indistinguishable from an idle word's history
            seq = (Atomics.add(hub, base + S_SEQ, 1) + 1) & SEQ_MASK;
        hub[base + S_OP] = op | 0;
        hub[base + S_GEN] = this.gen;
        hub[base + S_ARGS] = a0 | 0;
        hub[base + S_ARGS + 1] = a1 | 0;
        hub[base + S_ARGS + 2] = a2 | 0;
        hub[base + S_ARGS + 3] = a3 | 0;
        hub[base + S_ARGS + 4] = a4 | 0;
        const done = slotState(seq, STATE_DONE);
        this.active = true;
        this.inflight = slotState(seq, STATE_REQUEST);
        let finished = false;
        try {
            Atomics.store(hub, base + S_STATE, this.inflight);
            Atomics.or(hub, H_PENDING + (slot >>> 5), 1 << (slot & 31));
            Atomics.add(hub, H_DOORBELL, 1);
            Atomics.notify(hub, H_DOORBELL);
            const result = this.wait(base, done);
            finished = true;
            return result;
        }
        finally {
            // Normal completion and owner loss clear inflight; an exception or a
            // kernel halt unwinding through a yield leaves it set.
            if (!finished && this.inflight !== 0 && this.slot === slot)
                this.abandon(base);
            this.active = false;
        }
    }
    wait(base, done) {
        const hub = this.hub;
        const t0 = performance.now();
        let heartbeat = Atomics.load(hub, H_HEARTBEAT);
        let heartbeatAt = t0;
        let state;
        while ((state = Atomics.load(hub, base + S_STATE)) !== done) {
            const owner = Atomics.load(hub, H_OWNER_STATE);
            if (owner === OWNER_DEAD)
                return this.abandon(base);
            let now = performance.now();
            if (this.yieldToKernel === null || now - t0 < FAST_WAIT_MS) {
                Atomics.wait(hub, base + S_STATE, state, this.yieldToKernel === null ? WAIT_SLICE_MS : FAST_WAIT_MS);
            }
            else {
                Atomics.wait(hub, base + S_STATE, state, YIELD_SLICE_MS);
                if (Atomics.load(hub, base + S_STATE) === done)
                    break;
                // Let this virtual CPU's interrupts, other tasks and signals run.
                this.yields++;
                this.yieldToKernel();
            }
            if (Atomics.load(hub, base + S_STATE) === done)
                break;
            now = performance.now();
            const beat = Atomics.load(hub, H_HEARTBEAT);
            if (beat !== heartbeat) {
                heartbeat = beat;
                heartbeatAt = now;
                continue;
            }
            const limit = owner === OWNER_ALIVE ? Atomics.load(hub, H_STALL_MS) : Atomics.load(hub, H_STARTUP_MS);
            if (now - heartbeatAt > limit) {
                this.markDead(owner, owner === OWNER_ALIVE ? DEAD_STALL : DEAD_STARTUP);
                return this.abandon(base);
            }
        }
        const result = hub[base + S_RESULT];
        Atomics.compareExchange(hub, base + S_STATE, done, STATE_IDLE);
        this.inflight = 0;
        this.calls++;
        return result;
    }
    abandon(base) {
        // Retire the request: the owner's BUSY -> DONE exchange for this seq now
        // fails, and a request it has not taken yet is no longer REQUEST.
        const hub = this.hub;
        const state = Atomics.exchange(hub, base + S_STATE, STATE_IDLE);
        Atomics.and(hub, H_PENDING + (this.slot >>> 5), ~(1 << (this.slot & 31)));
        this.inflight = 0;
        return (state & 3) === STATE_BUSY || (state & 3) === STATE_DONE ? -EIO : -ENODEV;
    }
    control(cmd, arg) {
        const hub = this.hub;
        if (Atomics.load(hub, H_MAGIC) !== MAGIC)
            return -ENOSYS;
        if (!(Atomics.load(hub, H_FLAGS) & FLAG_TEST_HOOKS))
            return -EPERM;
        switch (cmd) {
            case CTL_RESPAWN: {
                if (Atomics.load(hub, H_OWNER_STATE) !== OWNER_DEAD)
                    return 0;
                const gen = Atomics.load(hub, H_OWNER_GEN);
                this.post({ type: "gpu_hostcall", kind: "respawn", gen });
                const deadline = performance.now() + Atomics.load(hub, H_STARTUP_MS);
                for (;;) {
                    const state = Atomics.load(hub, H_OWNER_STATE);
                    if (state === OWNER_ALIVE && Atomics.load(hub, H_OWNER_GEN) !== gen)
                        return 0;
                    if (performance.now() > deadline)
                        return -ETIMEDOUT;
                    Atomics.wait(hub, H_OWNER_STATE, state, WAIT_SLICE_MS);
                }
            }
            case CTL_SET_STALL_MS: {
                const ms = arg >>> 0;
                if (ms < 100 || ms > 60000)
                    return -EINVAL;
                Atomics.store(hub, H_STALL_MS, ms);
                return 0;
            }
            default:
                return -EINVAL;
        }
    }
    stats(memory, out) {
        const hub = this.hub;
        if (Atomics.load(hub, H_MAGIC) !== MAGIC)
            return -ENOSYS;
        const words = [PROTOCOL_VERSION, Atomics.load(hub, H_OWNER_STATE), Atomics.load(hub, H_OWNER_GEN), this.slot,
            Atomics.load(hub, H_HEARTBEAT), Atomics.load(hub, H_CALLS), Atomics.load(hub, H_DEAD_REASON),
            Atomics.load(hub, H_FLAGS), this.calls, Atomics.load(hub, H_STALL_MS), this.yields];
        const address = out >>> 0;
        const buffer = memory.buffer;
        if (address === 0 || address + words.length * 4 > buffer.byteLength)
            return -EFAULT;
        const view = new DataView(buffer, address, words.length * 4);
        words.forEach((value, i) => view.setUint32(i * 4, value >>> 0, true));
        return 0;
    }
}

export const GPU_HC_STATS_WORDS = 11;

/**
 * Dispatch for worker.js: `client` may be null (no hub delivered to this Worker).
 * Stats words: version, owner_state, owner_gen, slot, heartbeat, calls,
 * dead_reason, flags, thread_calls, stall_ms, thread_yields.
 */
export function gpuHostcallSyscall(client, memory, nr, a0, a1, a2, a3, a4, a5) {
    if (client === null || !memory)
        return -ENOSYS;
    switch (Number(nr)) {
        case GPU_HC_CALL:
            return client.call(memory, a0 | 0, a1, a2, a3, a4, a5);
        case GPU_HC_STATS:
            return client.stats(memory, a0);
        case GPU_HC_CONTROL:
            return client.control(a0 | 0, a1);
        default:
            return -ENOSYS;
    }
}

// ---------------------------------------------------------------------------
// Page side: creates the hub, starts the owner lazily at the first attach,
// relays memory attachments, and marks/terminates dead owners.

export function createGpuHostcallHost({ testHooks = false, stallMs = DEFAULT_STALL_MS, startupMs = DEFAULT_STARTUP_MS,
    ownerUrl = new URL("./guest-gpu-owner.js", import.meta.url), log = () => { }, ownerConfig = {}, onPresent = null } = {}) {
    if (typeof SharedArrayBuffer !== "function" || typeof Worker !== "function")
        return null;
    const sab = new SharedArrayBuffer(HUB_BYTES);
    const hub = new Int32Array(sab);
    hub[H_FLAGS] = testHooks ? FLAG_TEST_HOOKS : 0;
    hub[H_STALL_MS] = stallMs;
    hub[H_STARTUP_MS] = startupMs;
    hub[H_OWNER_STATE] = OWNER_NONE;
    Atomics.store(hub, H_MAGIC, MAGIC);
    const attachments = new Map(); // slot -> {gen, memory}
    let owner = null;
    let closed = false;
    // The page can show keyed GL window overlays (framebuffer.js); told to every owner.
    let keyedPresent = false;
    const events = [];
    const note = (event) => {
        if (events.length < 256)
            events.push({ ...event, at: performance.now() });
        log(event);
    };
    function wakeAll() {
        Atomics.notify(hub, H_OWNER_STATE);
        for (let slot = 0; slot < MAX_SLOTS; slot++)
            Atomics.notify(hub, slotWord(slot, S_STATE));
        Atomics.notify(hub, H_DOORBELL);
    }
    function markDead(reason, gen = Atomics.load(hub, H_OWNER_GEN)) {
        if (gen !== Atomics.load(hub, H_OWNER_GEN))
            return;
        const state = Atomics.load(hub, H_OWNER_STATE);
        if (state !== OWNER_DEAD) {
            onPresent?.({ type: "gpu-present", reset: true });
            Atomics.store(hub, H_OWNER_STATE, OWNER_DEAD);
            Atomics.store(hub, H_DEAD_REASON, reason);
        }
        if (owner !== null) {
            owner.terminate();
            owner = null;
            note({ kind: "owner-dead", reason, gen });
        }
        wakeAll();
    }
    function spawn() {
        if (closed)
            return;
        const gen = Atomics.add(hub, H_OWNER_GEN, 1) + 1;
        Atomics.store(hub, H_DEAD_REASON, 0);
        Atomics.store(hub, H_OWNER_STATE, OWNER_STARTING);
        Atomics.notify(hub, H_OWNER_STATE);
        let worker;
        try {
            worker = new Worker(ownerUrl, { type: "module", name: "gpu-owner-" + gen });
        }
        catch (error) {
            note({ kind: "spawn-failed", error: String(error) });
            markDead(DEAD_STARTUP, gen);
            return;
        }
        owner = worker;
        worker.onmessage = ({ data }) => {
            if (data?.type === "terminate_me")
                markDead(DEAD_TERMINATED, gen);
            else if (data?.type === "log")
                note({ kind: "owner-log", gen, message: data.message });
            else if (data?.type === "gpu-present") {
                // Direct guest presentation for the page overlay: ImageBitmap frames,
                // canvas requests (answered with a transferred OffscreenCanvas) and moves.
                if (onPresent) onPresent(data, (message, transfer) => { if (owner === worker) worker.postMessage(message, transfer); });
                else data.bitmap?.close();
            }
        };
        worker.onerror = (event) => {
            event.preventDefault?.();
            note({ kind: "owner-error", gen, message: String(event.message ?? event) });
            markDead(DEAD_ERROR, gen);
        };
        worker.postMessage({ type: "init", hub: sab, gen, config: ownerConfig, keyedPresent, attachments: [...attachments].map(([slot, a]) => ({ slot, ...a })) });
        note({ kind: "owner-spawned", gen });
    }
    return {
        hub: sab,
        events,
        get owner() {
            return owner;
        },
        /** Whether the page presenter shows keyed GL window overlays now. */
        setKeyedPresent(on) {
            keyedPresent = !!on;
            owner?.postMessage({ type: "keyed-present", on: keyedPresent });
        },
        handle(message) {
            if (closed)
                return;
            switch (message.kind) {
                case "attach":
                    attachments.set(message.slot, { gen: message.gen, memory: message.memory });
                    if (Atomics.load(hub, H_OWNER_STATE) === OWNER_NONE)
                        spawn();
                    else
                        owner?.postMessage({ type: "attach", slot: message.slot, gen: message.gen, memory: message.memory });
                    break;
                case "detach":
                    if (attachments.get(message.slot)?.gen === message.gen) {
                        attachments.delete(message.slot);
                        owner?.postMessage({ type: "detach", slot: message.slot, gen: message.gen });
                    }
                    break;
                case "dead":
                    markDead(Atomics.load(hub, H_DEAD_REASON) || DEAD_STALL, message.gen);
                    break;
                case "respawn":
                    if (Atomics.load(hub, H_FLAGS) & FLAG_TEST_HOOKS && Atomics.load(hub, H_OWNER_STATE) === OWNER_DEAD &&
                        message.gen === Atomics.load(hub, H_OWNER_GEN))
                        spawn();
                    break;
                default:
                    note({ kind: "unknown-message", message: String(message.kind) });
            }
        },
        /** Test hook for the page: terminate the owner as if it crashed. */
        killOwner(reason = DEAD_TERMINATED) {
            markDead(reason);
        },
        close() {
            if (closed)
                return;
            markDead(DEAD_CLOSED);
            closed = true;
            Atomics.store(hub, H_OWNER_STATE, OWNER_DEAD);
            Atomics.store(hub, H_DEAD_REASON, DEAD_CLOSED);
            attachments.clear();
            wakeAll();
        },
    };
}
