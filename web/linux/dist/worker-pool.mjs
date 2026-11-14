export function createWorkerPool({ capacity, load, retire }) {
    if (!Number.isInteger(capacity) || capacity < 1)
        throw new RangeError("Invalid worker pool capacity");
    const idle = [];
    const active = new Set();
    let closed = false;
    return {
        prewarm() {
            while (!closed && idle.length < capacity)
                idle.push(load("linux-worker"));
        },
        take(name) {
            if (closed)
                throw new Error("Worker pool is closed");
            let entry;
            while ((entry = idle.shift())) {
                if (!entry.slot.error)
                    break;
                retire(entry, true);
            }
            entry ??= load(name);
            active.add(entry);
            return entry;
        },
        release(entry) {
            if (!active.delete(entry))
                throw new Error("Worker is not active in this pool");
            if (closed || idle.length >= capacity) {
                retire(entry, false);
                return;
            }
            entry.slot.handlers = null;
            idle.push(entry);
        },
        // Forget an active entry whose worker closed itself (spawndiag_noreuse).
        retire_active(entry) {
            active.delete(entry);
        },
        // Retire every idle worker (spawn_reclaim); returns how many.
        reclaim_idle() {
            const retired = idle.splice(0);
            for (const entry of retired)
                retire(entry, Boolean(entry.slot.error));
            return retired.length;
        },
        close() {
            closed = true;
            idle.length = 0;
        },
    };
}
