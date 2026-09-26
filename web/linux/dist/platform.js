// SPDX-License-Identifier: MIT
// The seam between web APIs (browsers) and node builtins (node, deno).
// Selected at runtime by the presence of process.getBuiltinModule, so bundlers
// only ever see the web path and never try to resolve node builtins.
import { assert } from "./util.js";
/** @internal */
export function worker_script_url(module_url, execution_url) {
    const url = new URL("./worker.js", module_url);
    if (!execution_url) {
        try {
            execution_url = globalThis.location?.href;
        } catch {
            execution_url = null;
        }
        if (!execution_url)
            return url;
    }
    const execution = new URL(execution_url);
    const run = execution.searchParams.get("run");
    if (run)
        url.searchParams.set("run", run);
    if (execution.searchParams.get("firefox_diagnostics") === "1")
        url.searchParams.set("firefox_diagnostics", "1");
    if (execution.searchParams.get("firefox_start_guard") === "1")
        url.searchParams.set("firefox_start_guard", "1");
    if (execution.searchParams.get("firefox_guard_bypass") === "1")
        url.searchParams.set("firefox_guard_bypass", "1");
    if (execution.searchParams.get("firefox_guard_bypass_all") === "1")
        url.searchParams.set("firefox_guard_bypass_all", "1");
    if (execution.searchParams.get("firefox_guard_memory_diag") === "1")
        url.searchParams.set("firefox_guard_memory_diag", "1");
    if (execution.searchParams.get("firefox_memory_pregrow") === "1")
        url.searchParams.set("firefox_memory_pregrow", "1");
    if (execution.searchParams.get("firefox_syscall_trace") === "1")
        url.searchParams.set("firefox_syscall_trace", "1");
    if (execution.searchParams.get("firefox_abort_trace") === "1")
        url.searchParams.set("firefox_abort_trace", "1");
    if (execution.searchParams.get("firefox_tls_adapter") === "1")
        url.searchParams.set("firefox_tls_adapter", "1");
    const firefoxDiagnostics = new URL(execution_url).searchParams.get("firefox_diagnostics");
    if (firefoxDiagnostics === "1")
        url.searchParams.set("firefox_diagnostics", "1");
    const firefoxNoAdapter = new URL(execution_url).searchParams.get("firefox_no_adapter");
    if (firefoxNoAdapter === "1")
        url.searchParams.set("firefox_no_adapter", "1");
    return url;
}
function current_execution_url() {
    return globalThis.location?.href;
}
const web = {
    async load_wasm(url) {
        const response = url.pathname.endsWith('/vmlinux.wasm')
            ? await (await import('../boot-assets.mjs')).systemAsset('kernel')
            : await fetch(url, { cache: 'default' });
        // native code caching is only supported with the *Streaming functions, so use it:
        const module = await WebAssembly.compileStreaming(response.clone());
        const bytes = new Uint8Array(await response.arrayBuffer());
        return { bytes, module };
    },
    spawn_worker(name, handlers) {
        const worker = new Worker(worker_script_url(import.meta.url, current_execution_url()), {
            type: "module",
            name,
        });
        worker.onmessage = (event) => handlers.on_message(event.data);
        worker.onerror = (event) => {
            event.preventDefault();
            if (event.error instanceof Error) {
                handlers.on_error(event.error);
                return;
            }
            // Browsers often leave event.error null for wasm traps / OOMs; keep the
            // location so the demo status line is actionable.
            const where = event.filename != null && event.filename !== ""
                ? ` (${event.filename}:${event.lineno}:${event.colno})`
                : "";
            handlers.on_error(new Error(`${event.message || "machine worker failed"}${where}`));
        };
        worker.addEventListener("unhandledrejection", (event) => {
            event.preventDefault();
            const reason = event.reason;
            handlers.on_error(reason instanceof Error ? reason : new Error(String(reason)));
        });
        return {
            post: (message, transfer) => worker.postMessage(message, transfer ?? []),
            terminate: async () => worker.terminate(),
        };
    },
    worker_channel() {
        return {
            post: (message, transfer) => self.postMessage(message, transfer ?? []),
            on_message: (handler) => {
                self.onmessage = (event) => handler(event.data);
            },
        };
    },
    quit() {
        self.close();
    },
};
function node(getBuiltinModule, process) {
    const { readFile } = getBuiltinModule("node:fs/promises");
    const { Worker, parentPort } = getBuiltinModule("node:worker_threads");
    return {
        async load_wasm(url) {
            const bytes = await readFile(url);
            return { bytes, module: await WebAssembly.compile(bytes) };
        },
        spawn_worker(name, handlers) {
            const worker = new Worker(worker_script_url(import.meta.url), {
                name,
            });
            worker.on("message", handlers.on_message);
            worker.on("error", handlers.on_error);
            return {
                post: (message, transfer) => worker.postMessage(message, transfer),
                terminate: async () => void await worker.terminate(),
            };
        },
        worker_channel() {
            assert(parentPort, "not in a worker");
            return {
                post: (message, transfer) => parentPort.postMessage(message, transfer),
                on_message: (handler) => parentPort.on("message", handler),
            };
        },
        quit() {
            process.exit(0);
        },
    };
}
const process = globalThis.process;
const getBuiltinModule = process?.getBuiltinModule;
export const platform = getBuiltinModule && process
    ? node(getBuiltinModule, process)
    : web;
