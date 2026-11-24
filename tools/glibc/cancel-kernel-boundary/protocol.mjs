/* Executable ABI/state-machine proposal, NOT a production worker adapter.
 * inspect/recheck must eventually be genuine GNU nounwind sidecar helpers.
 * Supplying test booleans here proves no signal authentication or cancellation.
 */
export const ABI = Object.freeze({ magic: 0x53424732, version: 2, bytes: 64,
    deliver: 1, restored: 2, restartSys: -512 });

export function readRecord(memory, address) {
    if (!Number.isInteger(address) || address < 0 || (address & 3) ||
        address > memory.byteLength - ABI.bytes) throw new Error("boundary bounds");
    const view = new DataView(memory, address, ABI.bytes);
    const names = ["magic", "version", "bytes", "phase", "task", "tp", "pid", "tgid",
        "lo", "hi", "raw", "nr", "result", "restart", "signal", "copyStatus"];
    const record = {};
    names.forEach((name, i) => record[name] =
        i >= 10 && i !== 14 ? view.getInt32(i * 4, true) : view.getUint32(i * 4, true));
    return Object.freeze(record); // kernel-stack pointer is not retained
}

const identityFields = ["magic", "version", "bytes", "task", "tp", "pid", "tgid",
    "lo", "hi", "raw", "nr", "signal"];
function identity(record) {
    if (record.magic !== ABI.magic || record.version !== ABI.version ||
        record.bytes !== ABI.bytes || !(record.lo || record.hi)) throw new Error("boundary ABI");
    return identityFields.map(field => record[field]).join(":");
}
function enabled(request, binding) {
    return request.authenticated && request.pending && request.enabled &&
        !request.exiting && !request.terminated &&
        request.ownerTP === binding.tp && request.taskEpoch === binding.epoch &&
        request.moduleGeneration === binding.moduleGeneration;
}

export class BoundaryProtocol {
    constructor(binding, inspect, recheck) {
        // One per actual TP/task epoch. No worker-global frame-head or CFA.
        this.binding = Object.freeze({ ...binding });
        this.inspect = inspect;
        this.recheck = recheck;
        this.imports = [];
        this.callbacks = [];
        this.acknowledged = [];
        this.lastGeneration = 0n;
        this.invalid = false;
    }
    enter(nr, cancellable, activation) {
        if (this.invalid) throw new Error("invalid epoch");
        const token = Object.freeze({ nr, cancellable, activation });
        this.imports.push(token);
        return token;
    }
    deliver(record, handler) {
        identity(record);
        const generation = BigInt(record.hi) << 32n | BigInt(record.lo);
        const top = this.imports.at(-1);
        if (this.invalid || !top || record.phase !== ABI.deliver ||
            record.task !== this.binding.task || record.tp !== this.binding.tp ||
            generation <= this.lastGeneration || record.nr !== top.nr)
            throw new Error("delivery identity");
        this.lastGeneration = generation;
        // This hook copies translated GNU siginfo and authenticates the exact
        // registered SIGCANCEL handler + SI_TKILL + same GNU process + TCB state.
        // Ordinary signals use the ordinary trampoline; they are not deferred.
        const request = Object.freeze({ ...this.inspect(record, handler, top) });
        const delivery = { identity: identity(record), record, request, top };
        this.callbacks.push(delivery);
        return delivery;
    }
    restored(record) {
        const delivery = this.callbacks.at(-1);
        if (!delivery || this.invalid || record.phase !== ABI.restored ||
            identity(record) !== delivery.identity || record.copyStatus !== 0)
            throw new Error("restoration identity/copy status");
        this.callbacks.pop();
        // Does not call a handler, import, poll or unwind. The future helper
        // rechecks genuine GNU state and activation identity, not a stale flag.
        const now = this.recheck(delivery.request, delivery.top, this.binding);
        const bridge = now.activation === delivery.top.activation && delivery.top.cancellable;
        const policy = record.raw === ABI.restartSys && enabled(now, this.binding) &&
            (bridge || now.async) ? 1 : 0;
        this.acknowledged.push({ ...delivery, restored: record, policy });
        return policy;
    }
    leave(token, outcome) {
        if (this.imports.at(-1) !== token) throw new Error("import nesting");
        this.imports.pop();
        if (outcome === "exec" || outcome === "exit") {
            this.invalidate();
            return [];
        }
        if (outcome !== "return") { this.invalidate(); return []; }
        if (this.imports.length || this.callbacks.length) return [];
        const deliveries = this.acknowledged.splice(0);
        return deliveries.filter(delivery => {
            const now = this.recheck(delivery.request, delivery.top, this.binding);
            if (!enabled(now, this.binding)) return false;
            const bridge = now.activation === delivery.top.activation &&
                delivery.top.cancellable && delivery.policy === 1 &&
                delivery.record.raw === ABI.restartSys;
            // Async is a deliberately selected GNU behavior: it may terminate
            // after partial side effects, but never converts a positive result
            // into EINTR. Deferred mode requires the current bridge/result.
            return bridge || now.async;
        }).map(delivery => Object.freeze({ ...delivery,
            binding: this.binding, scope: "proposal acknowledgement; not unwind" }));
    }
    invalidate() {
        this.invalid = true;
        this.imports = [];
        this.callbacks = [];
        this.acknowledged = [];
    }
}
