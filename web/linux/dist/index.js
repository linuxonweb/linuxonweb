import { createAudioHost } from "./audio.js";
// SPDX-License-Identifier: MIT
import { generate_devicetree } from "./devicetree.js";
import { platform } from "./platform.js";
import { createWorkerPool } from "./worker-pool.mjs";
import { assert, unreachable } from "./util.js";
import { read_wasm_memories } from "./wasm_binary.js";
import { close_virtio_device, virtio_device_description, virtio_imports, } from "./virtio/core.js";
import { allocate_shared_memory, kernel_imports, MachineTerminationReason, } from "./wasm.js";
import { createFramebufferHost, framebuffer_imports, } from "./framebuffer.js";
import { createGpuHostcallHost } from "./guest-gpu-hostcall.js";
export { VirtioController, } from "./virtio/core.js";
export { blockDevice } from "./virtio/block.js";
export { consoleDevice } from "./virtio/console.js";
export { entropyDevice } from "./virtio/entropy.js";
export { FSError, fileSystemDevice, } from "./virtio/fs.js";
export { ethernetDevice, ethernetNetwork, } from "./virtio/net.js";
export { vsockDevice, } from "./virtio/vsock.js";
export { Abs, Ev, inputDevice, Key, Rel, Syn, } from "./virtio/input.js";
export { createFramebufferHost, swizzle_bgra_to_rgba, } from "./framebuffer.js";
export { attach_guest, connectTcpOverWebSocket, createNetwork, resolveDnsOverProxy, wsTcpProxyNetwork, } from "./network/index.js";
function framebuffer_options(settings, mode, gpu_host) {
    return {
        ...settings,
        ...mode,
        onOverlaySupport(on) {
            gpu_host?.setKeyedPresent(on);
            settings.onOverlaySupport?.(on);
        },
    };
}
export class MachinePanicError extends Error {
    constructor() {
        super("kernel panic");
        this.name = "MachinePanicError";
    }
}
async function load_resources() {
    const { bytes, module: vmlinux } = await platform.load_wasm(new URL("../vmlinux.wasm", import.meta.url));
    const memories = read_wasm_memories(bytes);
    assert(memories.imports.length === 1 && memories.definitions.length === 0, "Kernel must define exactly one imported memory");
    const memory = memories.imports[0];
    assert(memory.module === "env" && memory.name === "memory", "Kernel memory must be imported as env.memory");
    assert(memory.type.address === "i32" && memory.type.shared, "Kernel memory must be a shared memory32");
    const custom_section = (name) => {
        const sections = WebAssembly.Module.customSections(vmlinux, name);
        const section = sections[0];
        assert(section && sections.length === 1, `Missing custom section: ${name}`);
        return section;
    };
    const sections = JSON.parse(new TextDecoder().decode(custom_section(".linux.sections")));
    const initramfs = new Uint8Array(custom_section(".linux.initramfs"));
    return {
        vmlinux,
        memory: memory.type,
        sections,
        initramfs,
    };
}
// Loading starts only after the application's package choice. Loading per boot
// also prevents a newly selected initramfs from using an old compiled kernel.
const PAGE_SIZE = 0x10000;
// Leave the final wasm32 page out so the physical-memory size fits in u32.
const KERNEL_MEMORY_MAXIMUM_PAGES = 0xffff;
function kernel_initial_pages(memory, initcpio_size) {
    const maximum = BigInt(KERNEL_MEMORY_MAXIMUM_PAGES);
    assert(memory.minimum <= maximum &&
        memory.maximum !== undefined && memory.maximum >= maximum, "Kernel memory limits are incompatible with a 4 GiB - 64 KiB memory");
    const initcpio_pages = Math.ceil(initcpio_size / PAGE_SIZE);
    const initial = Number(memory.minimum) + initcpio_pages;
    assert(initial <= KERNEL_MEMORY_MAXIMUM_PAGES, "Initramfs does not fit in kernel memory");
    return initial;
}
function is_devicetree_node(value) {
    return typeof value === "object" && value?.constructor === Object;
}
function merge_devicetree(target, source) {
    for (const [name, value] of Object.entries(source)) {
        const current = target[name];
        if (is_devicetree_node(current) && is_devicetree_node(value)) {
            merge_devicetree(current, value);
        }
        else {
            target[name] = value;
        }
    }
}
/**
 * Boots the packaged kernel and resolves once it is running: the devices
 * are live and the kernel is executing from then on. What runs next is up
 * to the initramfs and kernel command line.
 *
 * In a browser the page must be cross-origin isolated, because the
 * machine's memory is shared between workers.
 *
 * @example
 * ```ts
 * const machine = await spawnMachine({
 *   cpus: Math.min(4, navigator.hardwareConcurrency),
 *   initcpio: initramfs,
 *   devices: [
 *     consoleDevice(input, output),
 *     entropyDevice(),
 *     blockDevice(disk),
 *   ],
 * });
 * ```
 */
export async function spawnMachine(options) {
    const devices = options.devices;
    // Optional, content-addressed browser worker. The normal desktop URL is unchanged.
    let workerScriptURL = options.workerScriptURL == null ? undefined : new URL(options.workerScriptURL, import.meta.url);
    if (workerScriptURL && (workerScriptURL.origin !== new URL(import.meta.url).origin ||
        !/^https?:$/.test(workerScriptURL.protocol) || workerScriptURL.username || workerScriptURL.password || workerScriptURL.search || workerScriptURL.hash ||
        workerScriptURL.pathname !== new URL(`./immutable/${workerScriptURL.pathname.split('/').pop()}`, import.meta.url).pathname ||
        !/\/immutable\/worker-[a-f0-9]{64}\.mjs$/.test(workerScriptURL.pathname))) {
        throw new TypeError('workerScriptURL must be a same-origin content-addressed worker module');
    }
    let ownedWorkerBlobURL;
    const workers = new Set();
    let closed = false;
    let failed = false;
    let finish_error;
    let finish_promise;
    let worker_pool;
    let framebuffer_host = null;
    const audio_host = options.audio ? createAudioHost() : null;
    // Guest GPU hostcall hub; its owner Worker starts only at the first guest call.
    // Keyed GL window frames (guest-gl-remote.js PresentSurface) go to the
    // framebuffer presenter; the rest to the page's own onPresent.
    const gpu_options = options.gpuHostcall ?? {};
    const gpu_host = options.gpuHostcall === false ? null : createGpuHostcallHost({
        ...gpu_options,
        onPresent: (data, reply) => {
            if (data.keyed || data.reset) framebuffer_host?.overlay(data);
            if (data.keyed) { if (!framebuffer_host) data.bitmap?.close(); return; }
            if (gpu_options.onPresent) gpu_options.onPresent(data, reply);
            else data.bitmap?.close();
        },
    });
    const framebuffer_mode = {
        width: options.framebuffer?.width ?? 1024,
        height: options.framebuffer?.height ?? 768,
        bpp: options.framebuffer?.bpp ?? 32,
    };
    const closed_promise = Promise.withResolvers();
    // Lifecycle promises on platform objects do not cause unhandled rejections
    // merely because a consumer chooses not to observe them.
    void closed_promise.promise.catch(() => { });
    const boot_console = new TransformStream();
    const boot_console_writer = boot_console.writable.getWriter();
    const boot_console_write = (message) => {
        void boot_console_writer.write(new Uint8Array(message)).catch(() => { });
    };
    const boot_console_close = () => {
        void boot_console_writer.close().catch(() => { });
    };
    const finish = () => {
        if (finish_promise)
            return finish_promise;
        closed = true;
        worker_pool?.close();
        finish_promise = (async () => {
            framebuffer_host?.close();
            framebuffer_host = null;
            gpu_host?.close();
            await audio_host?.close();
            const device_closes = devices.map((device) => close_virtio_device(device));
            for (const result of await Promise.allSettled(device_closes)) {
                if (result.status === "rejected" && !failed) {
                    failed = true;
                    finish_error = result.reason;
                }
            }
            try {
                await Promise.all(Array.from(workers, (worker) => worker.terminate()));
            }
            catch (termination_error) {
                if (!failed) {
                    failed = true;
                    finish_error = termination_error;
                }
            }
            if (ownedWorkerBlobURL) {
                URL.revokeObjectURL(ownedWorkerBlobURL);
                ownedWorkerBlobURL = undefined;
            }
            boot_console_close();
            if (failed)
                closed_promise.reject(finish_error);
            else
                closed_promise.resolve();
        })().finally(() => {
            if (ownedWorkerBlobURL) {
                URL.revokeObjectURL(ownedWorkerBlobURL);
                ownedWorkerBlobURL = undefined;
            }
        });
        return finish_promise;
    };
    const fail = (error) => {
        if (!failed) {
            failed = true;
            finish_error = error;
        }
        return finish();
    };
    const close = () => void finish();
    try {
        if (workerScriptURL) {
            const controller = new AbortController();
            const signal = options.workerScriptSignal;
            const abort = () => controller.abort(signal.reason);
            signal?.addEventListener('abort', abort, { once: true });
            if (signal?.aborted) abort();
            const timeout = setTimeout(() => controller.abort(), 30000);
            let bytes;
            try {
                const response = await fetch(workerScriptURL, { signal: controller.signal });
                if (!response.ok) throw new Error(`Worker bundle HTTP ${response.status}`);
                const declared = Number(response.headers.get('content-length') || 0);
                if (declared > 4 * 1024 * 1024) { controller.abort(); await response.body?.cancel().catch(() => {}); throw new Error('Worker bundle is too large'); }
                if (!response.body) throw new Error('Worker bundle body is missing');
                const reader = response.body.getReader(), chunks = [];
                let length = 0;
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (length + value.byteLength > 4 * 1024 * 1024) {
                            controller.abort();
                            await reader.cancel().catch(() => {});
                            throw new Error('Worker bundle is too large');
                        }
                        chunks.push(value); length += value.byteLength;
                    }
                } finally { reader.releaseLock(); }
                bytes = new Uint8Array(length);
                let offset = 0;
                for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
            const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
                value => value.toString(16).padStart(2, '0')).join('');
            if (!workerScriptURL.pathname.endsWith(`worker-${digest}.mjs`))
                throw new Error('Worker bundle integrity check failed');
            signal?.throwIfAborted();
            // The generated bundle has no imports and preserves each source module's
            // original asset base. One verified Blob serves every worker in this machine.
            const bootstrap = `globalThis.__linuxonwebExecutionURL=${JSON.stringify(globalThis.location.href)};\n`;
            ownedWorkerBlobURL = URL.createObjectURL(new Blob([bootstrap, bytes], { type: 'text/javascript' }));
            workerScriptURL = new URL(ownedWorkerBlobURL);
        }
        const { sections, vmlinux, initramfs, memory: memory_type } = await load_resources();
        const initcpio = options.initcpio ? await options.initcpio : undefined;
        const module_pages = Number(memory_type.minimum);
        const initcpio_addr = module_pages * PAGE_SIZE;
        const pages = kernel_initial_pages(memory_type, initcpio?.byteLength ?? 0);
        const requested_memory = options.devicetree?.memory?.reg?.[1];
        if (requested_memory !== undefined && (!Number.isSafeInteger(requested_memory) || requested_memory < pages * PAGE_SIZE + 64 * 1024 * 1024)) {
            const required_mib = Math.ceil((pages * PAGE_SIZE + 64 * 1024 * 1024) / (1024 * 1024));
            throw new RangeError(`Selected RAM is too small for this kernel and boot image. This image needs at least ${required_mib} MB including boot workspace. Select more memory.`);
        }
        const preferred_maximum_pages = requested_memory === undefined ? KERNEL_MEMORY_MAXIMUM_PAGES : Math.min(KERNEL_MEMORY_MAXIMUM_PAGES, Math.floor(requested_memory / PAGE_SIZE));
        const { memory: wasm_memory, maximum_pages } = allocate_shared_memory(pages, preferred_maximum_pages);
        if (requested_memory !== undefined && requested_memory > maximum_pages * PAGE_SIZE) {
            throw new RangeError("This browser could not reserve the selected RAM. Select less memory or close other tabs.");
        }
        assert(wasm_memory.buffer.byteLength === pages * PAGE_SIZE);
        // Opt-in (?memgrow_kernel_mb=N, default off): pre-grow the kernel memory to
        // N MiB before any worker exists.  The kernel's arch_alloc_page() otherwise
        // grows it page-by-page (memory.grow inside vmlinux.wasm) and every grow
        // interrupts every worker isolate sharing it.  Guest RAM size is set by the
        // devicetree from maximum_pages and is unchanged by this.
        try {
            const kernel_mb = Number(new URL(globalThis.location?.href ?? "").searchParams.get("memgrow_kernel_mb") ?? 0);
            if (Number.isSafeInteger(kernel_mb) && kernel_mb > 0) {
                const target_pages = Math.min(maximum_pages, Math.ceil(kernel_mb * 1024 * 1024 / PAGE_SIZE));
                const before = wasm_memory.buffer.byteLength / PAGE_SIZE;
                if (target_pages > before)
                    wasm_memory.grow(target_pages - before);
                console.log("MEMGROW kernel-pregrow", JSON.stringify({ before, after: wasm_memory.buffer.byteLength / PAGE_SIZE, maximum_pages }));
            }
            if (kernel_mb > 0 || new URL(globalThis.location?.href ?? "").searchParams.get("memgrow_log") === "1") {
                // Diagnostic only: report kernel memory size changes for 180 s.
                let last = -1, ticks = 0;
                const timer = setInterval(() => {
                    const now = wasm_memory.buffer.byteLength / PAGE_SIZE;
                    if (now !== last) console.log("MEMGROW kernel-pages", JSON.stringify({ t: Math.round(performance.now()), pages: now }));
                    last = now;
                    if (++ticks >= 180) clearInterval(timer);
                }, 1000);
            }
        }
        catch (error) {
            console.warn("MEMGROW kernel-pregrow failed", String(error));
        }
        const devicetree = {
            "#address-cells": 1,
            "#size-cells": 1,
            chosen: {
                "rng-seed": crypto.getRandomValues(new Uint8Array(64)),
                bootargs: `console=hvc0 ${options.cmdline ?? ""}`,
                // Default: four CPUs, capped at the host CPU count.
                ncpus: options.cpus ?? Math.min(4, navigator.hardwareConcurrency || 1),
            },
            aliases: {},
            memory: {
                device_type: "memory",
                reg: [0, maximum_pages * PAGE_SIZE],
            },
            "reserved-memory": {
                "#address-cells": 1,
                "#size-cells": 1,
                ranges: undefined,
            },
        };
        for (const [i, dev] of devices.entries()) {
            const device = virtio_device_description(dev);
            devicetree[`virtio${i}`] = {
                compatible: `virtio,wasm`,
                "host-id": i,
                "virtio-device-id": device.device_id,
                features: device.features,
                config: device.config,
            };
        }
        const memory_reservations = [];
        if (initcpio) {
            const chosen = devicetree.chosen;
            chosen["linux,initrd-start"] = initcpio_addr;
            chosen["linux,initrd-end"] = initcpio_addr + initcpio.byteLength;
            new Uint8Array(wasm_memory.buffer).set(new Uint8Array(initcpio.buffer, initcpio.byteOffset, initcpio.byteLength), initcpio_addr);
            memory_reservations.push({
                address: initcpio_addr,
                size: initcpio.byteLength,
            });
        }
        devicetree.chosen.sections = sections;
        if (options.devicetree)
            merge_devicetree(devicetree, options.devicetree);
        const generated_devicetree = generate_devicetree(devicetree, {
            memory_reservations,
        });
        // The imports must exist before instantiation returns the instance they
        // call back into, but they only run once exports.boot() starts the kernel.
        let instance;
        let virtio_config_written;
        // A guest fork blocks its parent until the child worker has started
        // (~200 ms for a fresh module worker), so keep a few workers loaded
        // ahead of time; a spawn then only posts the init message.
        const SPARE_WORKERS = 8;
        const load_worker = (name) => {
            const slot = { handlers: null, error: null };
            const worker = platform.spawn_worker(name, {
                on_message: (message) => slot.handlers?.on_message(message),
                on_error: (error) => {
                    if (slot.handlers)
                        slot.handlers.on_error(error);
                    else
                        slot.error = error;
                },
            }, workerScriptURL);
            workers.add(worker);
            return { worker, slot };
        };
        worker_pool = createWorkerPool({
            capacity: SPARE_WORKERS,
            load: load_worker,
            retire(entry, failed) {
                if (failed) {
                    workers.delete(entry.worker);
                    void entry.worker.terminate();
                }
                else {
                    entry.worker.post({ type: "shutdown" });
                }
            },
        });
        const start_worker = (name, init) => {
            if (closed)
                return;
            const entry = worker_pool.take(name);
            const { worker, slot } = entry;
            slot.handlers = {
                on_message(raw) {
                    const message = raw;
                    switch (message.type) {
                        case "spawn_worker":
                            try {
                                start_worker(message.name, {
                                    type: "forwarded_init",
                                    port: message.port,
                                });
                            }
                            catch (error) {
                                void fail(error);
                            }
                            break;
                        case "audio_write":
                            audio_host?.write(message);
                            break;
                        case "boot_console_write":
                            boot_console_write(message.message);
                            break;
                        case "boot_console_close":
                            boot_console_close();
                            break;
                        case "terminate_machine":
                            switch (message.reason) {
                                case MachineTerminationReason.Clean:
                                    void finish();
                                    break;
                                case MachineTerminationReason.Panic:
                                    void fail(new MachinePanicError());
                                    break;
                                default:
                                    void fail(new Error(`unknown machine termination reason: ${message.reason}`));
                            }
                            break;
                        case "run_on_main":
                            assert(instance);
                            instance.exports.__indirect_function_table.get(message.fn >>> 0)(message.arg);
                            break;
                        case "virtio_config_written":
                            try {
                                assert(virtio_config_written);
                                virtio_config_written(message.dev);
                                Atomics.store(message.status, 0, 1);
                            }
                            catch (error) {
                                Atomics.store(message.status, 0, -1);
                                void fail(error);
                            }
                            finally {
                                Atomics.notify(message.status, 0);
                            }
                            break;
                        case "gpu_hostcall":
                            gpu_host?.handle(message);
                            break;
                        case "worker_idle":
                            if (!closed)
                                worker_pool.release(entry);
                            break;
                        case "worker_exit": {
                            // The worker closes itself after posting this message. Calling
                            // terminate() here races that orderly shutdown and leaks the
                            // worker's address-space reservations in WebKit.
                            workers.delete(worker);
                            // Only spawndiag_noreuse sends refill: keep spares loaded.
                            if (message.refill === true && !closed) {
                                worker_pool.retire_active?.(entry);
                                worker_pool.prewarm();
                            }
                            break;
                        }
                        default:
                            unreachable(message);
                    }
                },
                on_error: (error) => {
                    const stack = error && typeof error.stack === "string"
                        ? error.stack.slice(0, 8192)
                        : "";
                    if (stack)
                        console.error("[linux-worker] error stack", stack);
                    fail(error);
                },
            };
            worker.post(init, init.type === "forwarded_init" ? [init.port] : undefined);
        };
        const spawn_worker = (fn, arg, name, user, copy_user_memory) => {
            // COPY originates only from userspace clone in a worker; never block the
            // browser's main agent waiting for a memory snapshot.
            assert(!copy_user_memory);
            start_worker(name, {
                type: "init",
                fn,
                arg,
                vmlinux,
                memory: wasm_memory,
                user,
                user_copy_status: null,
                framebuffer: framebuffer_mode,
                gpu: gpu_host?.hub ?? null,
            });
            return 0;
        };
        const unavailable = () => {
            throw new Error("not available on main thread");
        };
        if (options.framebuffer) {
            framebuffer_host = createFramebufferHost(wasm_memory, framebuffer_options(options.framebuffer, framebuffer_mode, gpu_host));
        }
        const imports = {
            env: { memory: wasm_memory },
            boot: {
                get_devicetree: (buf, size) => {
                    const address = buf >>> 0;
                    const capacity = size >>> 0;
                    if (capacity === 0)
                        return generated_devicetree.byteLength;
                    assert(capacity >= generated_devicetree.byteLength, "Device tree truncated");
                    new Uint8Array(wasm_memory.buffer).set(generated_devicetree, address);
                    return generated_devicetree.byteLength;
                },
                get_initramfs: (buf, size) => {
                    const address = buf >>> 0;
                    const capacity = size >>> 0;
                    assert(capacity >= initramfs.byteLength, "Initramfs truncated");
                    new Uint8Array(wasm_memory.buffer).set(initramfs, address);
                    return initramfs.byteLength;
                },
            },
            kernel: kernel_imports({
                is_worker: false,
                memory: wasm_memory,
                spawn_worker,
                boot_console_write,
                boot_console_close,
                terminate_machine: unavailable,
                run_on_main: unavailable,
                get_user_context: unavailable,
                worker_exit: unavailable,
            }),
            user: {
                compile_begin: unavailable,
                compile_write: unavailable,
                compile_end: unavailable,
                compile_abort: unavailable,
                instantiate: unavailable,
                call: unavailable,
                switch_entry: unavailable,
                call_signal_handler: unavailable,
                call_siginfo_handler: unavailable,
                read: unavailable,
                write: unavailable,
                write_zeroes: unavailable,
                futex_atomic_op: unavailable,
                futex_atomic_cmpxchg: unavailable,
            },
            virtio: (() => {
                const imports = virtio_imports({
                    memory: wasm_memory,
                    devices,
                    on_error: fail,
                    trigger_irq(irq) {
                        assert(instance);
                        instance.exports.trigger_irq(irq);
                    },
                });
                virtio_config_written = imports.config_written;
                return imports;
            })(),
            fb: framebuffer_imports(wasm_memory, framebuffer_host, framebuffer_mode),
        };
        worker_pool.prewarm();
        instance = (await WebAssembly.instantiate(vmlinux, imports));
        instance.exports.boot();
        return {
            memory: wasm_memory,
            resumeAudio: () => audio_host?.resume(),
            get audioStats() { return audio_host?.stats ?? null; },
            gpuHostcall: gpu_host,
            bootConsole: boot_console.readable,
            closed: closed_promise.promise,
            close,
            [Symbol.dispose]: close,
        };
    }
    catch (error) {
        await fail(error);
        throw error;
    }
}
