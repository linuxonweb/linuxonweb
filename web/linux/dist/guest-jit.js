// SPDX-License-Identifier: MIT
//
// Guest runtime code-install primitive (packet 1 of docs/guest-jit-design-20260928.md).
//
// A guest process writes a small WebAssembly module image into its own memory
// and issues a private syscall number. The Worker intercepts that number in the
// linux.syscall closure before the kernel sees it, compiles the image against
// the process memory and funcref table, and places the exported functions at
// process-wide table indices. Every thread of the process has its own Instance
// (and therefore its own table), so installs are recorded in a per-process
// control SharedArrayBuffer and replayed by each thread at syscall exit and at
// instance creation. Nothing here is exposed to the kernel.
//
// Private syscall numbers (i386 numbering stops far below this range):
//   0x6a490001 jit_install(module_ptr, module_len, flags, out_ptr) -> 0 | -errno
//              flags JIT_INSTALL_PRIVATE places the functions in the calling
//              thread's table only: the indices stay reserved process-wide
//              but other threads (and fork children) see null there.
//   0x6a490002 jit_free(base_index, count)                        -> 0 | -errno
//   0x6a490003 jit_sync()                                         -> epoch (>= 0)
//   0x6a490004 jit_stats(out_ptr) writes JIT_STATS_WORDS u32 values -> 0 | -errno
//
// Installed modules may import only env.memory (shared i32 memory with a
// maximum), env.table (funcref) and the immutable i32 global
// env.__jit_table_base. They must not have a start function, defined memories,
// active data or element segments, and must export only functions named
// f0..fN-1 (out_ptr[i] receives the table index of fi).

export const JIT_SYSCALL_INSTALL = 0x6a490001;
export const JIT_SYSCALL_FREE = 0x6a490002;
export const JIT_SYSCALL_SYNC = 0x6a490003;
export const JIT_SYSCALL_STATS = 0x6a490004;
export const JIT_SYSCALL_MIN = JIT_SYSCALL_INSTALL;
export const JIT_SYSCALL_MAX = JIT_SYSCALL_STATS;
export const JIT_STATS_WORDS = 12;

export const JIT_MAX_MODULE_BYTES = 1 << 20;
export const JIT_MAX_EXPORTS = 1024;
export const JIT_INSTALL_PRIVATE = 1;

const E2BIG = 7, ENOEXEC = 8, ENOMEM = 12, EFAULT = 14, EINVAL = 22, ENOSPC = 28, ENOSYS = 38;

// Control layout, in 32-bit words.
const MAGIC = 0x4a495431; // "JIT1"
const W_MAGIC = 0, W_LOCK = 1, W_EPOCH = 2, W_TABLE_BASE = 3, W_NEXT = 4, W_ARENA_USED = 5,
    W_NO_REUSE = 6, W_FREE_COUNT = 7, W_INSTALLS = 8, W_FREES = 9;
const SLOT_WORD = 16, MAX_SLOTS = 128; // [in_use, acked_epoch]
const FREE_WORD = SLOT_WORD + MAX_SLOTS * 2, MAX_FREE = 1024; // [base, count, free_epoch]
const LOG_WORD = FREE_WORD + MAX_FREE * 3, LOG_WORDS_PER_ENTRY = 6, MAX_LOG = 16384;
// Log entry: [kind, base, count, arena_offset, length, dead]
const KIND_INSTALL = 1, KIND_FREE = 2;
const LOG_END_BYTE = (LOG_WORD + MAX_LOG * LOG_WORDS_PER_ENTRY) * 4;
const ARENA_BYTE = Math.ceil(LOG_END_BYTE / 4096) * 4096;
const ARENA_MAX = 16 << 20;
const INITIAL_BYTES = Math.ceil(((LOG_WORD + 128 * LOG_WORDS_PER_ENTRY) * 4) / 4096) * 4096;
const MAX_BYTES = ARENA_BYTE + ARENA_MAX;

/** Creates the per-process control block, or null if growable SABs are unavailable. */
export function createJitControl() {
    try {
        const sab = new SharedArrayBuffer(INITIAL_BYTES, { maxByteLength: MAX_BYTES });
        if (typeof sab.grow !== "function")
            return null;
        new Int32Array(sab)[W_MAGIC] = MAGIC;
        return sab;
    }
    catch {
        return null;
    }
}

/**
 * Fork with memory COPY: the child gets a private copy of the allocator, log and
 * arena (it must not share allocator state with its parent) and replays the
 * whole log into its fresh table. The parent is blocked in clone and COPY is
 * only permitted for a single-thread mm, so the source is quiescent.
 */
export function cloneJitControl(source) {
    if (!(source instanceof SharedArrayBuffer))
        return null;
    const length = source.byteLength;
    const sab = new SharedArrayBuffer(length, { maxByteLength: MAX_BYTES });
    new Uint8Array(sab).set(new Uint8Array(source, 0, length));
    const ctl = new Int32Array(sab);
    ctl[W_LOCK] = 0;
    // The parent's threads do not exist in the child.
    ctl.fill(0, SLOT_WORD, SLOT_WORD + MAX_SLOTS * 2);
    return sab;
}

function readLeb(bytes, state) {
    let result = 0, shift = 0, byte;
    do {
        if (state.offset >= bytes.length || shift > 28)
            throw new RangeError("bad LEB128");
        byte = bytes[state.offset++];
        result |= (byte & 0x7f) << shift;
        shift += 7;
    } while (byte & 0x80);
    return result >>> 0;
}
function readName(bytes, state) {
    const length = readLeb(bytes, state);
    if (state.offset + length > bytes.length)
        throw new RangeError("bad name");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(state.offset, state.offset + length));
    state.offset += length;
    return name;
}
function readLimits(bytes, state) {
    const flags = bytes[state.offset++];
    const minimum = readLeb(bytes, state);
    const maximum = flags & 1 ? readLeb(bytes, state) : undefined;
    return { flags, minimum, maximum };
}
function skipConstExpr(bytes, state) {
    for (;;) {
        const op = bytes[state.offset++];
        if (op === 0x0b)
            return;
        if (op === 0xd2 || op === 0x23 || op === 0x41) // ref.func, global.get, i32.const
            readLeb(bytes, state);
        else if (op === 0xd0) // ref.null heaptype
            state.offset++;
        else
            throw new RangeError("unsupported constant expression");
    }
}

/**
 * Structural validation of the module image. Returns { importsGlobal } or throws
 * a string reason. The engine performs full validation during compilation.
 */
export function validateJitModuleImage(bytes) {
    if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d ||
        bytes[4] !== 1 || bytes[5] !== 0 || bytes[6] !== 0 || bytes[7] !== 0)
        throw "bad header";
    const state = { offset: 8 };
    let importsGlobal = false;
    while (state.offset < bytes.length) {
        const id = bytes[state.offset++];
        const size = readLeb(bytes, state);
        const end = state.offset + size;
        if (end > bytes.length)
            throw "truncated section";
        if (id === 2) {
            const count = readLeb(bytes, state);
            for (let i = 0; i < count; i++) {
                const module = readName(bytes, state), name = readName(bytes, state), kind = bytes[state.offset++];
                if (module !== "env")
                    throw "import outside env";
                if (kind === 1) {
                    if (name !== "table" || bytes[state.offset++] !== 0x70)
                        throw "only env.table funcref may be imported";
                    const limits = readLimits(bytes, state);
                    if (limits.flags & ~1)
                        throw "unsupported table limits";
                }
                else if (kind === 2) {
                    const limits = readLimits(bytes, state);
                    if (name !== "memory" || limits.flags !== 3)
                        throw "env.memory must be shared i32 memory with a maximum";
                }
                else if (kind === 3) {
                    const type = bytes[state.offset++], mutable = bytes[state.offset++];
                    if (name !== "__jit_table_base" || type !== 0x7f || mutable !== 0)
                        throw "only immutable i32 env.__jit_table_base may be imported";
                    importsGlobal = true;
                }
                else
                    throw "function/tag imports are not permitted";
            }
        }
        else if (id === 5) {
            throw "defined memories are not permitted";
        }
        else if (id === 8) {
            throw "start function is not permitted";
        }
        else if (id === 9) {
            const count = readLeb(bytes, state);
            for (let i = 0; i < count; i++) {
                const flags = readLeb(bytes, state);
                if ((flags & 1) === 0 || flags > 7)
                    throw "active element segments are not permitted";
                const expressions = (flags & 4) !== 0;
                state.offset++; // elemkind or reftype
                const items = readLeb(bytes, state);
                for (let j = 0; j < items; j++) {
                    if (expressions)
                        skipConstExpr(bytes, state);
                    else
                        readLeb(bytes, state);
                }
            }
        }
        else if (id === 11) {
            const count = readLeb(bytes, state);
            for (let i = 0; i < count; i++) {
                const flags = readLeb(bytes, state);
                if (flags !== 1)
                    throw "active data segments are not permitted";
                const length = readLeb(bytes, state);
                state.offset += length;
            }
        }
        if (id === 2 || id === 9 || id === 11) {
            if (state.offset !== end)
                throw "malformed section";
        }
        state.offset = end;
    }
    return { importsGlobal };
}

function exportCount(module) {
    const exports = WebAssembly.Module.exports(module);
    if (exports.length < 1 || exports.length > JIT_MAX_EXPORTS)
        return -1;
    const seen = new Set();
    for (const { name, kind } of exports) {
        const match = /^f(0|[1-9][0-9]*)$/.exec(name);
        if (kind !== "function" || !match)
            return -1;
        seen.add(Number(match[1]));
    }
    for (let i = 0; i < exports.length; i++)
        if (!seen.has(i))
            return -1;
    return exports.length;
}

function fnv1a(bytes) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}
function sameBytes(a, b) {
    if (a.length !== b.length)
        return false;
    for (let i = 0; i < a.length; i++)
        if (a[i] !== b[i])
            return false;
    return true;
}

/** One per (Worker, user Instance). */
export class JitThread {
    constructor(control, memory, table) {
        this.sab = control;
        this.ctl = new Int32Array(control); // length-tracking
        this.memory = memory;
        this.table = table instanceof WebAssembly.Table ? table : null;
        this.epoch = 0;
        this.cache = new Map();
        this.stats = { compiles: 0, cacheHits: 0, replayedInstalls: 0, replayedFrees: 0, replayErrors: 0 };
        this.slot = -1;
        for (let i = 0; i < MAX_SLOTS; i++) {
            const word = SLOT_WORD + i * 2;
            if (Atomics.compareExchange(this.ctl, word, 0, 1) === 0) {
                Atomics.store(this.ctl, word + 1, 0);
                this.slot = i;
                break;
            }
        }
        if (this.slot < 0) // Unknown threads may hold stale indices: never reuse.
            Atomics.store(this.ctl, W_NO_REUSE, 1);
    }
    release() {
        if (this.slot >= 0) {
            Atomics.store(this.ctl, SLOT_WORD + this.slot * 2, 0);
            this.slot = -1;
        }
    }
    pending() {
        return Atomics.load(this.ctl, W_EPOCH) !== this.epoch;
    }
    lock() {
        const ctl = this.ctl;
        while (Atomics.compareExchange(ctl, W_LOCK, 0, 1) !== 0)
            Atomics.wait(ctl, W_LOCK, 1, 1);
    }
    unlock() {
        Atomics.store(this.ctl, W_LOCK, 0);
        Atomics.notify(this.ctl, W_LOCK, 1);
    }
    ensureBytes(byteLength) {
        if (this.sab.byteLength < byteLength)
            this.sab.grow(Math.min(MAX_BYTES, Math.ceil(byteLength / 65536) * 65536));
    }
    compile(bytes) {
        const key = `${bytes.length}:${fnv1a(bytes)}`;
        const bucket = this.cache.get(key);
        if (bucket) {
            for (const entry of bucket) {
                if (sameBytes(entry.bytes, bytes)) {
                    this.stats.cacheHits++;
                    return entry.module;
                }
            }
        }
        const module = new WebAssembly.Module(bytes);
        this.stats.compiles++;
        if (bucket)
            bucket.push({ bytes, module });
        else
            this.cache.set(key, [{ bytes, module }]);
        return module;
    }
    // Instantiates and fills [base, base + count) in this thread's table.
    place(module, base, count) {
        const table = this.table;
        if (!table)
            throw new Error("no exported function table");
        const instance = new WebAssembly.Instance(module, {
            env: { memory: this.memory, table, __jit_table_base: base },
        });
        const end = base + count;
        if (table.length < end)
            table.grow(end - table.length, null);
        for (let i = 0; i < count; i++)
            table.set(base + i, instance.exports["f" + i]);
    }
    clear(base, count) {
        const table = this.table;
        if (!table)
            return;
        const end = Math.min(base + count, table.length);
        for (let i = base; i < end; i++)
            table.set(i, null);
    }
    /** Applies every log entry published since this thread's last replay. */
    replay() {
        const ctl = this.ctl;
        const target = Atomics.load(ctl, W_EPOCH);
        for (let e = this.epoch; e < target; e++) {
            const word = LOG_WORD + e * LOG_WORDS_PER_ENTRY;
            const kind = ctl[word], base = ctl[word + 1], count = ctl[word + 2];
            try {
                if (kind === KIND_INSTALL) {
                    if (Atomics.load(ctl, word + 5) !== 0)
                        continue; // Already freed; its tombstone follows in the log.
                    const offset = ARENA_BYTE + ctl[word + 3], length = ctl[word + 4];
                    const bytes = new Uint8Array(this.sab, offset, length).slice();
                    this.place(this.compile(bytes), base, count);
                    this.stats.replayedInstalls++;
                }
                else if (kind === KIND_FREE) {
                    this.clear(base, count);
                    this.stats.replayedFrees++;
                }
            }
            catch (error) {
                // The slot stays null: calling it traps instead of running stale code.
                this.stats.replayErrors++;
                if (this.stats.replayErrors <= 4)
                    console.warn("[guest-jit] replay failed", { entry: e, base, count, error: String(error) });
            }
        }
        this.epoch = target;
        if (this.slot >= 0)
            Atomics.store(ctl, SLOT_WORD + this.slot * 2 + 1, target);
        return target;
    }
    minAcked() {
        const ctl = this.ctl;
        let min = Atomics.load(ctl, W_EPOCH);
        for (let i = 0; i < MAX_SLOTS; i++) {
            const word = SLOT_WORD + i * 2;
            if (Atomics.load(ctl, word) !== 0)
                min = Math.min(min, Atomics.load(ctl, word + 1));
        }
        return min;
    }
    appendLog(kind, base, count, arenaOffset, length) {
        const ctl = this.ctl;
        const epoch = ctl[W_EPOCH];
        const word = LOG_WORD + epoch * LOG_WORDS_PER_ENTRY;
        ctl[word] = kind;
        ctl[word + 1] = base;
        ctl[word + 2] = count;
        ctl[word + 3] = arenaOffset;
        ctl[word + 4] = length;
        ctl[word + 5] = 0;
        Atomics.store(ctl, W_EPOCH, epoch + 1); // Publishes the entry.
    }
    install(memory, modulePtr, moduleLength, flags, outPtr) {
        if (!this.table)
            return -ENOSYS;
        if (flags !== 0 && flags !== JIT_INSTALL_PRIVATE)
            return -EINVAL;
        if (moduleLength > JIT_MAX_MODULE_BYTES)
            return -E2BIG;
        const buffer = memory.buffer;
        if (moduleLength < 8 || modulePtr + moduleLength > buffer.byteLength)
            return -EFAULT;
        const bytes = new Uint8Array(buffer, modulePtr, moduleLength).slice();
        let module, count;
        try {
            validateJitModuleImage(bytes);
            module = this.compile(bytes);
            count = exportCount(module);
        }
        catch {
            return -ENOEXEC;
        }
        if (count < 0)
            return -ENOEXEC;
        if ((outPtr & 3) !== 0 || outPtr + count * 4 > buffer.byteLength || outPtr === 0)
            return -EFAULT;
        const ctl = this.ctl;
        this.lock();
        try {
            // Under the lock nobody else appends: bring this thread up to date so
            // that the entry appended below is the only one not yet applied.
            this.replay();
            if (flags === JIT_INSTALL_PRIVATE)
                return this.installPrivate(module, count, memory, outPtr);
            if (ctl[W_EPOCH] >= MAX_LOG)
                return -ENOSPC;
            const arenaUsed = ctl[W_ARENA_USED];
            const arenaOffset = Math.ceil(arenaUsed / 8) * 8;
            if (arenaOffset + moduleLength > ARENA_MAX)
                return -ENOMEM;
            if (ctl[W_TABLE_BASE] === 0)
                ctl[W_TABLE_BASE] = Math.max(1, this.table.length);
            // Choose a range: a free range acknowledged by every live thread, else bump.
            let freeIndex = -1;
            if (ctl[W_NO_REUSE] === 0 && ctl[W_FREE_COUNT] > 0) {
                const acked = this.minAcked();
                const free = ctl[W_FREE_COUNT];
                for (let i = 0; i < free; i++) {
                    const word = FREE_WORD + i * 3;
                    if (ctl[word + 1] >= count && ctl[word + 2] <= acked) {
                        freeIndex = i;
                        break;
                    }
                }
            }
            const base = freeIndex >= 0 ? ctl[FREE_WORD + freeIndex * 3] : Math.max(ctl[W_NEXT], ctl[W_TABLE_BASE]);
            if (base + count > 0x7fffffff)
                return -ENOMEM;
            try {
                this.ensureBytes(Math.max((LOG_WORD + (ctl[W_EPOCH] + 2) * LOG_WORDS_PER_ENTRY) * 4,
                    ARENA_BYTE + arenaOffset + moduleLength));
            }
            catch {
                return -ENOMEM;
            }
            try {
                this.place(module, base, count);
            }
            catch (error) {
                if (error instanceof WebAssembly.LinkError)
                    return -ENOEXEC;
                return -ENOMEM; // table growth refused (e.g. fixed-size table)
            }
            // Commit allocation.
            if (freeIndex >= 0) {
                const word = FREE_WORD + freeIndex * 3;
                if (ctl[word + 1] > count) {
                    ctl[word] += count;
                    ctl[word + 1] -= count;
                }
                else {
                    const last = FREE_WORD + (ctl[W_FREE_COUNT] - 1) * 3;
                    ctl[word] = ctl[last];
                    ctl[word + 1] = ctl[last + 1];
                    ctl[word + 2] = ctl[last + 2];
                    ctl[W_FREE_COUNT]--;
                }
            }
            else {
                ctl[W_NEXT] = base + count;
            }
            new Uint8Array(this.sab, ARENA_BYTE + arenaOffset, moduleLength).set(bytes);
            ctl[W_ARENA_USED] = arenaOffset + moduleLength;
            ctl[W_INSTALLS]++;
            this.appendLog(KIND_INSTALL, base, count, arenaOffset, moduleLength);
            this.epoch = ctl[W_EPOCH]; // Already applied locally.
            if (this.slot >= 0)
                Atomics.store(ctl, SLOT_WORD + this.slot * 2 + 1, this.epoch);
            const view = new DataView(memory.buffer);
            for (let i = 0; i < count; i++)
                view.setUint32(outPtr + i * 4, base + i, true);
            return 0;
        }
        finally {
            this.unlock();
        }
    }
    // Called with the lock held. Private installs are not logged, so they use
    // no log or arena space and are never replayed; fresh indices only.
    installPrivate(module, count, memory, outPtr) {
        const ctl = this.ctl;
        if (ctl[W_TABLE_BASE] === 0)
            ctl[W_TABLE_BASE] = Math.max(1, this.table.length);
        const base = Math.max(ctl[W_NEXT], ctl[W_TABLE_BASE]);
        if (base + count > 0x7fffffff)
            return -ENOMEM;
        try {
            this.place(module, base, count);
        }
        catch (error) {
            if (error instanceof WebAssembly.LinkError)
                return -ENOEXEC;
            return -ENOMEM;
        }
        ctl[W_NEXT] = base + count;
        ctl[W_INSTALLS]++;
        const view = new DataView(memory.buffer);
        for (let i = 0; i < count; i++)
            view.setUint32(outPtr + i * 4, base + i, true);
        return 0;
    }
    free(base, count) {
        const ctl = this.ctl;
        this.replay();
        this.lock();
        try {
            const epoch = ctl[W_EPOCH];
            let found = -1;
            for (let e = epoch - 1; e >= 0; e--) {
                const word = LOG_WORD + e * LOG_WORDS_PER_ENTRY;
                if (ctl[word] === KIND_INSTALL && ctl[word + 1] === base && ctl[word + 5] === 0) {
                    found = word;
                    break;
                }
            }
            if (found < 0 || ctl[found + 2] !== count)
                return -EINVAL;
            if (epoch + 1 > MAX_LOG)
                return -ENOSPC;
            const free = ctl[W_FREE_COUNT];
            if (free >= MAX_FREE && ctl[W_NO_REUSE] === 0)
                return -ENOSPC;
            try {
                this.ensureBytes((LOG_WORD + (epoch + 2) * LOG_WORDS_PER_ENTRY) * 4);
            }
            catch {
                return -ENOMEM;
            }
            Atomics.store(ctl, found + 5, 1);
            this.appendLog(KIND_FREE, base, count, 0, 0);
            if (free < MAX_FREE) {
                const word = FREE_WORD + free * 3;
                ctl[word] = base;
                ctl[word + 1] = count;
                ctl[word + 2] = epoch + 1; // Reusable once every live thread has replayed this tombstone.
                ctl[W_FREE_COUNT] = free + 1;
            }
            ctl[W_FREES]++;
        }
        finally {
            this.unlock();
        }
        this.replay();
        return 0;
    }
    writeStats(memory, outPtr) {
        if ((outPtr & 3) !== 0 || outPtr === 0 || outPtr + JIT_STATS_WORDS * 4 > memory.buffer.byteLength)
            return -EFAULT;
        const ctl = this.ctl, s = this.stats;
        const values = [Atomics.load(ctl, W_EPOCH), this.epoch, s.compiles, s.cacheHits, s.replayedInstalls,
            s.replayedFrees, s.replayErrors, this.table ? this.table.length : 0, ctl[W_TABLE_BASE], ctl[W_NEXT],
            ctl[W_FREE_COUNT], this.slot];
        const view = new DataView(memory.buffer);
        values.forEach((value, i) => view.setUint32(outPtr + i * 4, value >>> 0, true));
        return 0;
    }
}

/** Dispatches one private syscall. `thread` may be null (no control block). */
export function jitSyscall(thread, memory, nr, a0, a1, a2, a3) {
    const n = Number(nr);
    let result;
    if (!thread)
        result = -ENOSYS;
    else if (n === JIT_SYSCALL_INSTALL)
        result = thread.install(memory, Number(a0) >>> 0, Number(a1) >>> 0, Number(a2) >>> 0, Number(a3) >>> 0);
    else if (n === JIT_SYSCALL_FREE)
        result = thread.free(Number(a0) >>> 0, Number(a1) >>> 0);
    else if (n === JIT_SYSCALL_SYNC)
        result = thread.replay();
    else if (n === JIT_SYSCALL_STATS)
        result = thread.writeStats(memory, Number(a0) >>> 0);
    else
        result = -ENOSYS;
    return typeof nr === "bigint" ? BigInt(result) : result;
}
