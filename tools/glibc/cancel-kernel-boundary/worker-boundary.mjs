/* Owned integration candidate. No production runtime imports this file.
 * Authentication and cancellation state come from genuine GNU helper exports,
 * never caller-supplied booleans. Helpers and frame checkpoints remain an
 * explicit prerequisite for cancellation and escaping ordinary callbacks.
 */
const FIELDS = ["magic", "version", "bytes", "phase", "task", "tp", "pid", "tgid",
    "lo", "hi", "raw", "nr", "result", "restart", "signal", "copyStatus",
    "handler", "trampoline", "flags", "kind"];
const HELPERS = ["slot", "prepare", "inspect", "policy", "dispatch", "callback_enter",
    "callback_leave", "complete", "invalidate", "import_enter", "import_leave"];
const SIGNED = new Set(["raw", "nr", "result", "restart", "copyStatus"]);
const POINTER_HELPERS = new Set(["slot", "import_enter", "callback_enter"]);
function result32(value, pointer = false) {
    if (typeof value === "bigint")
        return Number(pointer ? BigInt.asUintN(32, value) : BigInt.asIntN(32, value));
    if (value === undefined) return value;
    if (!Number.isInteger(value)) throw new Error("GNU helper result type");
    return pointer ? value >>> 0 : value | 0;
}
const key = record => FIELDS.filter(name => !["phase", "result", "restart", "copyStatus"].includes(name))
    .map(name => record[name]).join(":");

export function readKernelBoundary(memory, address, version) {
    const bytes = version === 3 ? 80 : 64;
    const buffer = memory.buffer;
    if (!Number.isInteger(address) || address < 0 || (address & 3) || address > buffer.byteLength - bytes)
        throw new Error("kernel boundary bounds");
    const view = new DataView(buffer, address, bytes);
    const record = {};
    FIELDS.slice(0, bytes / 4).forEach((name, index) => {
        record[name] = SIGNED.has(name) ? view.getInt32(index * 4, true) : view.getUint32(index * 4, true);
    });
    if (record.version !== version || record.bytes !== bytes ||
        record.magic !== (version === 3 ? 0x53424733 : 0x53424732) || !(record.lo || record.hi))
        throw new Error("kernel boundary ABI");
    return Object.freeze(record); // Never retain a kernel-stack pointer.
}

export class WorkerSignalBoundary {
    constructor({ kernelMemory, context, callTyped, ordinary, controls, fault }) {
        this.kernelMemory = kernelMemory;
        this.context = context; // Actual current instance + memory, not a stored pre-exec instance.
        this.callTyped = callTyped;
        this.ordinary = ordinary;
        this.controls = controls; // Exact existing halt/exec trap identities and legacy symbols.
        this.fault = fault;
        this.imports = [];
        this.callbacks = [];
        this.acknowledged = [];
        this.binding = null;
        this.lastGeneration = 0n;
        this.slotIndex = 0;
        this.dead = false;
    }
    admit(rawTP, taskEpoch, moduleGeneration, sidecar) {
        if (this.dead || this.imports.length || this.callbacks.length || this.binding ||
            !rawTP || !taskEpoch || !moduleGeneration || !sidecar)
            throw new Error("boundary admission phase");
        const context = this.context();
        const exports = context.instance.exports;
        if (result32(this.callTyped(exports.__wasm_boundary_v3_abi, [], 0)) !== 3)
            throw new Error("GNU boundary helper ABI");
        for (const name of HELPERS)
            if (typeof exports[`__wasm_boundary_v3_${name}`] !== "function")
                throw new Error(`missing GNU boundary helper ${name}`);
        // The worker integration must validate rawTP against the actual kernel
        // getter before admission, outside a syscall/kernel callback.
        this.binding = Object.freeze({ rawTP, taskEpoch, moduleGeneration, sidecar,
            instance: context.instance, memory: context.memory });
    }
    helper(name, args) {
        const binding = this.binding;
        if (!binding || this.context().instance !== binding.instance)
            throw new Error("stale GNU boundary instance");
        return result32(this.callTyped(binding.instance.exports[`__wasm_boundary_v3_${name}`], args, args.length),
            POINTER_HELPERS.has(name));
    }
    enter(nr) {
        if (this.dead) throw new Error("invalid boundary epoch");
        const bridge = this.binding ? this.helper("import_enter", [this.binding.sidecar, nr]) : 0;
        if (this.binding && !bridge) throw new Error("canonical import bridge rejected");
        const token = { nr, bridge, deliveries: [], parentCallback: this.callbacks.at(-1) ?? null };
        this.imports.push(token);
        return token;
    }
    capture(trampoline, handler, signal, address, version) {
        // Both kernel imports return status without throwing ordinary exceptions
        // through live kernel frames. Real traps/control exits cannot resume.
        let delivery;
        try {
            const record = readKernelBoundary(this.kernelMemory, address, version);
            const token = this.imports.at(-1);
            const generation = BigInt(record.hi) << 32n | BigInt(record.lo);
            if (!token || record.phase !== 1 || record.nr !== token.nr || record.signal !== signal ||
                generation <= this.lastGeneration || (version === 3 &&
                    (record.handler !== handler || record.trampoline !== trampoline ||
                     ![1, 2].includes(record.kind))))
                throw new Error("callback admission identity");
            if (this.binding && (record.tp !== this.binding.rawTP ||
                this.context().instance !== this.binding.instance))
                throw new Error("callback owner/instance");
            if (this.binding && version !== 3)
                throw new Error("admitted GNU boundary module requires kernel version3");
            if (this.taskCookie !== undefined && record.task !== this.taskCookie)
                throw new Error("callback task replacement");
            this.taskCookie = record.task;
            this.lastGeneration = generation;
            delivery = { record, key: key(record), token, status: 0, escape: undefined,
                escaped: false, registered: false, slot: 0, checkpoint: 0 };
            this.callbacks.push(delivery);
            token.deliveries.push(delivery);
            if (this.binding && version === 3) {
                // Slots remain distinct until every outermost delivery has
                // dispatched/drained. Callback depth alone is not an identity.
                delivery.slot = this.helper("slot", [this.binding.sidecar, this.slotIndex++]);
                const buffer = this.binding.memory.buffer;
                if (!Number.isInteger(delivery.slot) || !delivery.slot || (delivery.slot & 3) ||
                    delivery.slot > buffer.byteLength - 80) throw new Error("GNU delivery slot bounds");
                const view = new DataView(buffer, delivery.slot, 80);
                FIELDS.forEach((name, index) => view.setUint32(index * 4, record[name], true));
                delivery.status = this.helper("prepare", [this.binding.sidecar, delivery.slot, token.bridge]);
                if (delivery.status !== 0) return delivery.status;
                const state = this.helper("inspect", [this.binding.sidecar, delivery.slot]);
                if (!Number.isInteger(state) || (state & ~7)) throw new Error("GNU inspect result");
                delivery.registered = Boolean(state & 1);
                // Registered SIGCANCEL is never called in a kernel callback,
                // including forged/ignored/disabled deliveries. GNU dispatch
                // validates again after restoration and the outermost return.
                if (delivery.registered) return 0;
                delivery.checkpoint = this.helper("callback_enter", [this.binding.sidecar, delivery.slot, token.bridge]);
                if (!delivery.checkpoint) throw new Error("GNU callback checkpoint rejected");
            }
            try {
                delivery.status = this.ordinary(trampoline, handler, signal, version === 3 ? record.kind : 1);
            } catch (error) {
                if (this.controls.has(error) || error instanceof WebAssembly.RuntimeError) {
                    this.invalidate(1);
                    throw error; // Preserve exact noncatchable control/trap identity.
                }
                if (version !== 3 || !delivery.checkpoint) {
                    this.fault("escaping callback requires version3 admitted native-frame helpers");
                    delivery.status = -95;
                } else {
                    delivery.escape = error;
                    delivery.escaped = true;
                }
            } finally {
                if (delivery.checkpoint && !this.dead &&
                    this.helper("callback_leave", [this.binding.sidecar, delivery.checkpoint,
                        delivery.escaped ? 1 : 0]) !== 0)
                    throw new Error("GNU callback checkpoint restoration");
            }
            return delivery.status;
        } catch (error) {
            if (this.controls.has(error) || error instanceof WebAssembly.RuntimeError) throw error;
            this.fault(String(error));
            if (delivery) delivery.status = -22;
            return -22;
        } finally {
            // Failed callback/copy has no policy import in the actual kernel.
            // Drain its active callback now, retaining failed evidence on its
            // import token and never disturbing an enclosing callback.
            if (delivery && delivery.status !== 0 && this.callbacks.at(-1) === delivery) {
                this.callbacks.pop();
                delivery.failed = true;
            }
        }
    }
    restored(address, version) {
        // Nounwind inspection only: no handler, kernel import, poll, or unwind.
        try {
            const record = readKernelBoundary(this.kernelMemory, address, version);
            const delivery = this.callbacks.at(-1);
            if (!delivery || record.phase !== 2 || key(record) !== delivery.key)
                throw new Error("restoration acknowledgement");
            this.callbacks.pop();
            if (record.copyStatus !== 0 || delivery.status !== 0) {
                delivery.failed = true;
                throw new Error("restoration copy/callback failure");
            }
            delivery.restored = record;
            if (delivery.escaped) {
                if (version !== 3 || !delivery.checkpoint) throw new Error("unadmitted callback escape");
                delivery.policy = 2;
                return 2;
            }
            let policy = 0;
            if (delivery.registered) {
                const buffer = this.binding.memory.buffer;
                const view = new DataView(buffer, delivery.slot, 80);
                FIELDS.forEach((name, index) => view.setUint32(index * 4, record[name], true));
                // Nested policy1 could make GNU cancellation.c unwind through
                // an outer kernel callback. Until that composition is proven,
                // helpers receive eligibility0 for every nested import.
                const eligible = this.imports.length === 1 && this.callbacks.length === 0 ? 1 : 0;
                policy = this.helper("policy", [this.binding.sidecar, delivery.slot, eligible]);
                if (policy !== 0 && (policy !== 1 || record.raw !== -512 || !eligible))
                    throw new Error("GNU policy result");
                this.acknowledged.push(delivery);
            }
            delivery.policy = policy;
            return policy;
        } catch (error) {
            this.fault(String(error));
            return 3; // Kernel rejects rather than silently authenticating.
        }
    }
    leave(token, outcome) {
        // Terminal callback invalidation already retired every import. Outer
        // catches must preserve the original actual halt/exec/trap identity.
        if (this.dead) {
            if (outcome === "escape" || outcome === "replaced") return;
            throw new Error("invalid boundary epoch");
        }
        if (this.imports.at(-1) !== token) throw new Error("user syscall nesting");
        if (this.binding && outcome === "return" &&
            this.helper("import_leave", [this.binding.sidecar, token.bridge, 0]) !== 0)
            throw new Error("canonical import bridge restoration");
        this.imports.pop();
        if (outcome !== "return") { this.invalidate(2); return; }
        const escaped = token.deliveries.filter(delivery => delivery.escaped);
        if (escaped.length) {
            const delivery = escaped[0];
            if (!delivery.restored || delivery.policy !== 2 ||
                (this.imports.length && (!token.parentCallback || !this.callbacks.includes(token.parentCallback))))
                throw new Error("no guaranteed enclosing callback catcher");
            if (!this.imports.length && !this.callbacks.length) this.complete();
            // If nested, this reaches the enclosing host capture catch before
            // its kernel frames. Raw -ERESTART* is never returned to user code.
            throw delivery.escape;
        }
        if (this.imports.length || this.callbacks.length) return;
        for (const delivery of this.acknowledged.splice(0)) {
            if (!delivery.restored) throw new Error("missing cancellation restoration");
            // The genuine helper rechecks disabled/exiting, task/module/frame
            // and generation, then invokes the genuine GNU registered handler.
            this.helper("dispatch", [this.binding.sidecar, delivery.slot]);
        }
        this.complete();
    }
    complete() {
        // Ordinary nonlocal escape drains deferred records, not GNU pending
        // state or jump registrations. A future genuine poll sees pending state.
        this.acknowledged = [];
        if (this.binding && this.helper("complete", [this.binding.sidecar]) !== 0)
            throw new Error("GNU delivery drain");
        this.slotIndex = 0;
    }
    invalidate(reason) {
        if (this.binding && !this.dead) {
            try { this.helper("invalidate", [this.binding.sidecar, reason]); }
            catch (error) { this.fault(`epoch invalidation: ${String(error)}`); }
        }
        this.dead = true;
        this.imports = [];
        this.callbacks = [];
        this.acknowledged = [];
    }
}
