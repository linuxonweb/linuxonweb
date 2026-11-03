var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// web/linux/download-progress.mjs
function report(event) {
  for (const listener of listeners) listener(event);
}
async function readBody(response, bytes, onBytes) {
  if (!response.body) {
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength !== bytes.byteLength) throw new Error("Download has an incomplete or unexpected size.");
    bytes.set(body);
    onBytes(body.byteLength);
    return;
  }
  const reader = response.body.getReader();
  let loaded = 0;
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > bytes.byteLength - loaded) throw new Error("Download exceeds its expected size.");
      bytes.set(value, loaded);
      loaded += value.byteLength;
      onBytes(value.byteLength);
    }
    if (loaded !== bytes.byteLength) throw new Error("Download has an incomplete size.");
  } catch (error) {
    await reader.cancel(error).catch(() => {
    });
    throw error;
  } finally {
    reader.releaseLock();
  }
}
async function downloadFile(url, { id, label, total, failure = "Download failed", fetchImpl = fetch, cache = "no-cache" }) {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error("Invalid expected download size.");
  let loaded = 0;
  const emit = (state) => report({ id, label, total, loaded, state });
  emit("downloading");
  const controller = new AbortController();
  const options = (headers = {}) => ({ cache, signal: controller.signal, headers });
  const count = Math.min(SEGMENTS, Math.floor(total / SEGMENT_MIN_BYTES));
  const add = (size) => {
    loaded += size;
    emit("downloading");
  };
  try {
    if (count < 2) {
      const response = await fetchImpl(url, options());
      if (!response.ok) throw new Error(`${failure} (HTTP ${response.status})`);
      const bytes2 = new Uint8Array(total);
      await readBody(response, bytes2, add);
      emit("done");
      return { bytes: bytes2, lastModified: response.headers.get("Last-Modified") };
    }
    const span = Math.ceil(total / count);
    const ranges = Array.from({ length: count }, (_, index) => [index * span, Math.min(total, (index + 1) * span) - 1]);
    const first = await fetchImpl(url, options({ Range: `bytes=${ranges[0][0]}-${ranges[0][1]}` }));
    if (first.status === 200) {
      const bytes2 = new Uint8Array(total);
      await readBody(first, bytes2, add);
      emit("done");
      return { bytes: bytes2, lastModified: first.headers.get("Last-Modified") };
    }
    if (first.status !== 206) throw new Error(`${failure} (HTTP ${first.status})`);
    const bytes = new Uint8Array(total);
    await Promise.all(ranges.map(async ([start2, end], index) => {
      const response = index === 0 ? first : await fetchImpl(url, options({ Range: `bytes=${start2}-${end}` }));
      if (response.status !== 206) throw new Error(`${failure} (HTTP ${response.status} for bytes ${start2}-${end})`);
      await readBody(response, bytes.subarray(start2, end + 1), add);
    }));
    emit("done");
    return { bytes, lastModified: first.headers.get("Last-Modified") };
  } catch (error) {
    controller.abort();
    report({ id, label, total, loaded, state: "error", error: error?.message || String(error) });
    throw error;
  }
}
var listeners, SEGMENTS, SEGMENT_MIN_BYTES;
var init_download_progress = __esm({
  "web/linux/download-progress.mjs"() {
    listeners = /* @__PURE__ */ new Set();
    SEGMENTS = 4;
    SEGMENT_MIN_BYTES = 4 * 1024 * 1024;
  }
});

// web/linux/boot-assets.mjs
var boot_assets_exports = {};
__export(boot_assets_exports, {
  activeManifest: () => activeManifest,
  assetCacheDiagnostics: () => assetCacheDiagnostics,
  clearSystemCache: () => clearSystemCache,
  confirmSystemBoot: () => confirmSystemBoot,
  onAssetNotice: () => onAssetNotice,
  prepareSystemBoot: () => prepareSystemBoot,
  restorePreviousSystem: () => restorePreviousSystem,
  setImageStoreForTest: () => setImageStoreForTest,
  systemAsset: () => systemAsset,
  systemUsage: () => systemUsage,
  updateSystem: () => updateSystem
});
function assetCacheDiagnostics() {
  return { ...diagnostics, failures: diagnostics.failures.slice() };
}
function onAssetNotice(callback) {
  notice = callback;
}
function validate(manifest) {
  if (manifest?.schema !== 1) throw new Error("Unsupported system image manifest");
  for (const key of ["kernel", "plain", "firefox"]) {
    const asset = manifest.assets?.[key];
    if (!asset || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) throw new Error(`Invalid ${key} image manifest`);
    const url = new URL(asset.url, manifestURL);
    if (url.origin !== manifestURL.origin || !url.pathname.startsWith(new URL(".", manifestURL).pathname)) throw new Error("System image must be served from this application");
  }
  return manifest;
}
function saved(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? validate(JSON.parse(value)) : null;
  } catch {
    return null;
  }
}
function sameImages(a, b) {
  return Boolean(a && b && ["kernel", "plain", "firefox"].every((key) => a.assets[key].sha256 === b.assets[key].sha256 && a.assets[key].bytes === b.assets[key].bytes));
}
function previousManifest(current = saved(ACTIVE)) {
  try {
    const previous = current?.previous ? validate(current.previous) : saved(PREVIOUS);
    return previous && !sameImages(previous, current) ? previous : null;
  } catch {
    return null;
  }
}
async function latest() {
  const response = await fetch(manifestURL, { cache: "no-cache" });
  if (!response.ok) throw new Error(`System manifest unavailable (${response.status})`);
  return validate(await response.json());
}
async function activeManifest() {
  if (!selected) selected = (async () => {
    const current = saved(ACTIVE);
    if (current) return current;
    const manifest = await latest();
    try {
      localStorage.setItem(ACTIVE, JSON.stringify(manifest));
    } catch {
      notice("System version cannot be remembered in this browser.", true);
    }
    return manifest;
  })().catch((error) => {
    selected = null;
    throw error;
  });
  return selected;
}
function setImageStoreForTest(store) {
  imageOverride = store;
}
function openDatabase() {
  database ??= new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "sha256" });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  }).catch((error) => {
    database = null;
    throw error;
  });
  return database;
}
async function images() {
  if (imageOverride) return imageOverride;
  try {
    const db = await openDatabase();
    const store = (mode) => db.transaction(STORE, mode).objectStore(STORE);
    return {
      get: (sha256) => request(store("readonly").get(sha256)),
      all: () => request(store("readonly").getAll()),
      keys: () => request(store("readonly").getAllKeys()),
      put: (record) => request(store("readwrite").put(record)),
      delete: (sha256) => request(store("readwrite").delete(sha256)),
      clear: () => request(store("readwrite").clear())
    };
  } catch {
    return null;
  }
}
async function localCopy(asset, store) {
  const record = await store?.get(asset.sha256).catch(() => null);
  return record && record.sha256 === asset.sha256 && record.bytes === asset.bytes && record.blob?.size === asset.bytes ? record : null;
}
async function deleteLegacyCache() {
  try {
    await caches.delete(LEGACY_CACHE);
  } catch {
  }
}
async function serverCopy(url) {
  let response;
  try {
    response = await fetch(url, { method: "HEAD", cache: "no-cache" });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  return { lastModified: response.headers.get("Last-Modified"), bytes: Number(response.headers.get("Content-Length")) };
}
async function fetchVerified(asset, { requireCache = false, cachedOnly = false } = {}) {
  const store = await images();
  const url = new URL(asset.url, manifestURL);
  url.searchParams.set("sha256", asset.sha256);
  const local = await localCopy(asset, store);
  if (local && cachedOnly) {
    diagnostics.hits++;
    return localResponse(local, asset);
  }
  if (cachedOnly) throw new Error("The cached system is no longer complete. Start again and choose Update.");
  if (local) {
    diagnostics.checks++;
    const server = await serverCopy(url);
    if (!server) {
      diagnostics.hits++;
      return localResponse(local, asset);
    }
    if (server.lastModified && server.lastModified === local.lastModified && server.bytes === asset.bytes) {
      diagnostics.hits++;
      return localResponse(local, asset);
    }
    diagnostics.refreshes++;
    notice(`Updating ${asset.label || "system image"} from the server\u2026`);
  } else {
    notice(`Downloading ${asset.label || "system image"}\u2026`);
  }
  const { bytes, lastModified } = await downloadFile(url, { id: asset.sha256, label: asset.label || "System image", total: asset.bytes, failure: "System image download failed" });
  diagnostics.downloads++;
  if (bytes.byteLength !== asset.bytes) throw new Error("System image is incomplete or has changed on the server. Choose Update & restart to verify the current release. Your home is unchanged.");
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== asset.sha256) throw new Error("The server has a newer system image. Choose Update & restart to verify it. Your home is unchanged.");
  const blob = new Blob([bytes]);
  try {
    if (!store) throw new Error("Browser image cache is unavailable");
    await store.put({ sha256: asset.sha256, bytes: asset.bytes, lastModified, blob, savedAt: Date.now() });
    diagnostics.writes++;
  } catch (error) {
    diagnostics.failures.push(`${asset.label || asset.url}: ${error.name}: ${error.message}`);
    if (diagnostics.failures.length > 10) diagnostics.failures.shift();
    if (requireCache) throw error;
    notice(`System image is ready, but could not be cached: ${error.message}`, true);
  }
  return new Response(blob, { headers: responseHeaders(asset) });
}
async function systemAsset(key) {
  const manifest = await activeManifest();
  return fetchVerified(manifest.assets[key], { cachedOnly: cacheOnlyBoot.has(key) });
}
async function prepareSystemBoot(imageKey, choose) {
  if (!["plain", "firefox"].includes(imageKey)) throw new Error("Invalid boot image");
  const current = await activeManifest(), store = await images();
  const keys = ["kernel", imageKey];
  async function completeCache() {
    for (const key of keys) if (!await localCopy(current.assets[key], store)) return false;
    return true;
  }
  let candidate;
  try {
    candidate = await latest();
  } catch (error) {
    if (!await completeCache()) throw error;
    cacheOnlyBoot = new Set(keys);
    notice("Update check unavailable \xB7 using the complete cached system.");
    return true;
  }
  if (sameImages(current, candidate)) {
    cacheOnlyBoot.clear();
    return true;
  }
  const canContinue = await completeCache();
  const changed = ["kernel", "plain", "firefox"].filter((key) => current.assets[key].sha256 !== candidate.assets[key].sha256 || current.assets[key].bytes !== candidate.assets[key].bytes);
  const choice = await choose({ current, candidate, changed, canContinue });
  if (choice === "continue") {
    if (!canContinue) throw new Error("The previous system is not fully cached. Choose Update to start.");
    cacheOnlyBoot = new Set(keys);
    return true;
  }
  if (choice !== "update") return false;
  await withSystemLock(async () => {
    if (!store) throw new Error("Browser image cache is unavailable; update was not activated.");
    await Promise.all(keys.map((key) => fetchVerified(candidate.assets[key], { requireCache: true })));
    const record = { ...snapshot(candidate), previous: snapshot(current) };
    localStorage.setItem(ACTIVE, JSON.stringify(record));
    selected = Promise.resolve(record);
    cacheOnlyBoot = new Set(keys);
  });
  return true;
}
function updateSystem(onProgress = () => {
}) {
  return withSystemLock(async () => {
    const candidate = await latest(), current = await activeManifest(), store = await images();
    if (!store) throw new Error("Browser image cache is unavailable; system update was not activated");
    onProgress("Preparing system images\u2026");
    await Promise.all(["kernel", "plain", "firefox"].map((key) => fetchVerified(candidate.assets[key], { requireCache: true })));
    const changed = !sameImages(candidate, current);
    const previous = changed ? current : previousManifest();
    localStorage.setItem(ACTIVE, JSON.stringify({
      ...snapshot(candidate),
      ...previous && !sameImages(previous, candidate) ? { previous: snapshot(previous) } : {}
    }));
    return { changed, version: candidate.version };
  });
}
function restorePreviousSystem() {
  return withSystemLock(async () => {
    const current = saved(ACTIVE), previous = previousManifest(current);
    if (!previous) throw new Error("No previous system version is available");
    const store = await images();
    if (!store) throw new Error("Browser image cache is unavailable");
    await Promise.all(["kernel", "plain", "firefox"].map((key) => fetchVerified(previous.assets[key], { requireCache: true })));
    localStorage.setItem(ACTIVE, JSON.stringify({ ...snapshot(previous), ...current ? { previous: snapshot(current) } : {} }));
  });
}
async function systemUsage() {
  const store = await images();
  let bytes = 0;
  if (store) for (const record of await store.all()) bytes += Number(record.bytes || 0);
  const manifest = await activeManifest().catch(() => null);
  return { bytes, version: manifest?.version || "unavailable", previous: Boolean(previousManifest()) };
}
async function clearSystemCache() {
  await withSystemLock(async () => {
    await (await images())?.clear();
    await deleteLegacyCache();
  });
}
async function confirmSystemBoot() {
  const booted = await activeManifest();
  await withSystemLock(async () => {
    const active = saved(ACTIVE);
    if (active?.version !== booted.version) return;
    const keep = new Set([active, previousManifest(active)].filter(Boolean).flatMap((manifest) => Object.values(manifest.assets).map((asset) => asset.sha256)));
    const store = await images();
    if (store) for (const sha256 of await store.keys()) {
      if (!keep.has(sha256)) await store.delete(sha256);
    }
    await deleteLegacyCache();
  });
}
var DB, STORE, LEGACY_CACHE, ACTIVE, PREVIOUS, manifestURL, selected, cacheOnlyBoot, notice, diagnostics, snapshot, responseHeaders, imageOverride, request, database, localResponse, withSystemLock;
var init_boot_assets = __esm({
  "web/linux/boot-assets.mjs"() {
    init_download_progress();
    DB = "linuxonweb.system";
    STORE = "images";
    LEGACY_CACHE = "linuxonweb.system.v1";
    ACTIVE = "linuxonweb.system.active.v1";
    PREVIOUS = "linuxonweb.system.previous.v1";
    manifestURL = new URL("./boot-manifest.json", new URL("/linux/boot-assets.mjs", globalThis.__linuxonwebExecutionURL ?? globalThis.location.href).href);
    cacheOnlyBoot = /* @__PURE__ */ new Set();
    notice = () => {
    };
    diagnostics = { hits: 0, checks: 0, refreshes: 0, downloads: 0, writes: 0, failures: [] };
    snapshot = (manifest) => ({ schema: manifest.schema, version: manifest.version, assets: manifest.assets });
    responseHeaders = (asset) => ({ "Content-Type": asset.url.endsWith(".wasm") ? "application/wasm" : "application/octet-stream", "Content-Length": String(asset.bytes), "X-System-SHA256": asset.sha256 });
    imageOverride = null;
    request = (req) => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    database = null;
    localResponse = (record, asset) => new Response(record.blob, { headers: responseHeaders(asset) });
    withSystemLock = (operation) => globalThis.navigator?.locks ? navigator.locks.request(LEGACY_CACHE, { mode: "exclusive" }, operation) : operation();
  }
});

// web/linux/dist/util.js
function assert(cond, message = "Assertation failed") {
  if (!cond)
    throw new Error(message);
}

// web/linux/dist/platform.js
function worker_script_url(module_url, execution_url, override_url) {
  const url = new URL(override_url ?? "./worker.js", module_url);
  if (url.protocol === "blob:") return url;
  if (!execution_url) {
    try {
      execution_url = globalThis.__linuxonwebExecutionURL ?? globalThis.location?.href;
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
  return globalThis.__linuxonwebExecutionURL ?? globalThis.location?.href;
}
var web = {
  async load_wasm(url) {
    const response = url.pathname.endsWith("/vmlinux.wasm") ? await (await Promise.resolve().then(() => (init_boot_assets(), boot_assets_exports))).systemAsset("kernel") : await fetch(url, { cache: "default" });
    const module = await WebAssembly.compileStreaming(response.clone());
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes, module };
  },
  spawn_worker(name, handlers, script_url) {
    const worker = new Worker(worker_script_url(new URL("/linux/dist/platform.js", globalThis.__linuxonwebExecutionURL ?? globalThis.location.href).href, current_execution_url(), script_url), {
      type: "module",
      name
    });
    worker.onmessage = (event) => handlers.on_message(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      if (event.error instanceof Error) {
        handlers.on_error(event.error);
        return;
      }
      const where = event.filename != null && event.filename !== "" ? ` (${event.filename}:${event.lineno}:${event.colno})` : "";
      handlers.on_error(new Error(`${event.message || "machine worker failed"}${where}`));
    };
    worker.addEventListener("unhandledrejection", (event) => {
      event.preventDefault();
      const reason = event.reason;
      handlers.on_error(reason instanceof Error ? reason : new Error(String(reason)));
    });
    return {
      post: (message, transfer) => worker.postMessage(message, transfer ?? []),
      terminate: async () => worker.terminate()
    };
  },
  worker_channel() {
    return {
      post: (message, transfer) => self.postMessage(message, transfer ?? []),
      on_message: (handler) => {
        self.onmessage = (event) => handler(event.data);
      }
    };
  },
  quit() {
    self.close();
  }
};
function node(getBuiltinModule2, process2) {
  const { readFile } = getBuiltinModule2("node:fs/promises");
  const { Worker: Worker2, parentPort } = getBuiltinModule2("node:worker_threads");
  return {
    async load_wasm(url) {
      const bytes = await readFile(url);
      return { bytes, module: await WebAssembly.compile(bytes) };
    },
    spawn_worker(name, handlers, script_url) {
      const worker = new Worker2(worker_script_url(new URL("/linux/dist/platform.js", globalThis.__linuxonwebExecutionURL ?? globalThis.location.href).href, void 0, script_url), {
        name
      });
      worker.on("message", handlers.on_message);
      worker.on("error", handlers.on_error);
      return {
        post: (message, transfer) => worker.postMessage(message, transfer),
        terminate: async () => void await worker.terminate()
      };
    },
    worker_channel() {
      assert(parentPort, "not in a worker");
      return {
        post: (message, transfer) => parentPort.postMessage(message, transfer),
        on_message: (handler) => parentPort.on("message", handler)
      };
    },
    quit() {
      process2.exit(0);
    }
  };
}
var process = globalThis.process;
var getBuiltinModule = process?.getBuiltinModule;
var platform = getBuiltinModule && process ? node(getBuiltinModule, process) : web;

// web/linux/dist/wasm.js
var supported_user_module_imports = /* @__PURE__ */ new Set([
  "env\0memory\0memory",
  "linux\0syscall\0function",
  "linux\0get_thread_area\0function",
  "linux\0copy_siginfo\0function",
  "linux\0audio_write\0function"
]);
function user_module_imports_supported(module) {
  return WebAssembly.Module.imports(module).every(({ module: module2, name, kind }) => supported_user_module_imports.has(`${module2}\0${name}\0${kind}`));
}
function allocate_shared_memory(initial_pages, preferred_maximum_pages, allocate = (descriptor) => new WebAssembly.Memory(descriptor)) {
  if (!Number.isSafeInteger(initial_pages) || initial_pages < 0 || !Number.isSafeInteger(preferred_maximum_pages) || preferred_maximum_pages < initial_pages) {
    throw new RangeError("Shared-memory page limits are invalid");
  }
  let maximum_pages = preferred_maximum_pages;
  for (; ; ) {
    try {
      return {
        memory: allocate({
          initial: initial_pages,
          maximum: maximum_pages,
          shared: true
        }),
        maximum_pages
      };
    } catch (error) {
      const smaller_maximum = Math.max(initial_pages, Math.floor(maximum_pages / 2));
      const allocation_failure = error instanceof RangeError || error?.name === "RangeError" || error?.name === "OutOfMemoryError" || /\bout of memory\b/i.test(String(error?.message ?? error));
      if (!allocation_failure || smaller_maximum >= maximum_pages) {
        throw error;
      }
      maximum_pages = smaller_maximum;
    }
  }
}
function memory_bytes(memory, address, length) {
  try {
    const buffer = memory.buffer;
    const view_length = length ?? buffer.byteLength - address;
    if (!Number.isSafeInteger(address) || !Number.isSafeInteger(view_length) || address < 0 || view_length < 0 || view_length > buffer.byteLength || address > buffer.byteLength - view_length) {
      return null;
    }
    return new Uint8Array(buffer, address, view_length);
  } catch {
    return null;
  }
}
var WASM_USER_MEMORY_NONE = 0;
var WASM_USER_MEMORY_SHARE = 1;
var WASM_USER_MEMORY_COPY = 2;
var HALT_KERNEL = /* @__PURE__ */ Symbol("halt kernel");
function kernel_imports({ is_worker, memory, spawn_worker, boot_console_write, boot_console_close, terminate_machine, run_on_main, get_user_context, worker_exit, recycle_worker = false }) {
  return {
    breakpoint: () => {
      debugger;
    },
    halt_worker: () => {
      if (!is_worker)
        throw new Error("Halt called in main thread");
      worker_exit();
      if (!recycle_worker)
        platform.quit();
      throw HALT_KERNEL;
    },
    terminate_machine: (reason) => {
      if (!is_worker) {
        throw new Error("Machine termination called in main thread");
      }
      terminate_machine(reason);
      throw HALT_KERNEL;
    },
    boot_console_write: (msg, len) => {
      const address = msg >>> 0;
      const length = len >>> 0;
      boot_console_write(new Uint8Array(memory.buffer, address, length).slice().buffer);
    },
    boot_console_close,
    return_address: (_level) => {
      return 0;
    },
    get_now_nsec: () => {
      return BigInt(Math.round((performance.now() + performance.timeOrigin) * 200)) * 5000n;
    },
    get_stacktrace: (buf, size) => {
      const address = buf >>> 0;
      const capacity = size >>> 0;
      const trace = new TextEncoder().encode(new Error().stack?.split("\n").slice(5).join("\n"));
      if (trace.byteLength > capacity && capacity >= 3) {
        trace[capacity - 1] = 46;
        trace[capacity - 2] = 46;
        trace[capacity - 3] = 46;
      }
      new Uint8Array(memory.buffer).set(trace.subarray(0, capacity), address);
    },
    spawn_worker: (fn, arg, comm, comm_len, user_memory) => {
      const comm_address = comm >>> 0;
      const comm_length = comm_len >>> 0;
      const name = new TextDecoder().decode(new Uint8Array(memory.buffer, comm_address, comm_length).slice());
      let user = null;
      let copy_user_memory = false;
      if (user_memory !== WASM_USER_MEMORY_NONE) {
        const context = get_user_context();
        if (!context)
          return -22;
        switch (user_memory) {
          case WASM_USER_MEMORY_SHARE:
            user = context;
            break;
          case WASM_USER_MEMORY_COPY:
            user = context;
            copy_user_memory = true;
            break;
          default:
            return -22;
        }
      }
      return spawn_worker(fn, arg, name, user, copy_user_memory);
    },
    run_on_main
  };
}

// web/linux/dist/audio.js
var MAX_FRAMES = 2048;
var validFormat = (frames, rate, channels) => Number.isInteger(frames) && frames > 0 && frames <= MAX_FRAMES && Number.isInteger(rate) && rate >= 8e3 && rate <= 96e3 && (channels === 1 || channels === 2);
function createAudioWrite(memory, post, now = Date.now) {
  const pacing = /* @__PURE__ */ new Map();
  return (pid, stream, pointer, frames, rate, channels) => {
    pid >>>= 0;
    stream >>>= 0;
    if (!pid || !stream) return -22;
    const key = `${pid}:${stream}`;
    if (frames === 0) {
      pacing.delete(key);
      post({ type: "audio_write", pid, stream, frames: 0, sentAt: now() });
      return 0;
    }
    if (!validFormat(frames, rate, channels) || pointer & 3) return -22;
    const bytes = memory_bytes(memory, pointer >>> 0, frames * channels * 4);
    if (!bytes) return -22;
    const sentAt = now();
    let budget = pacing.get(key);
    if (!budget || sentAt - budget.window >= 250) {
      budget = { window: sentAt, packets: 0, until: sentAt };
      if (!pacing.has(key) && pacing.size >= 16) {
        for (const [oldKey, old] of pacing) if (old.until < sentAt) pacing.delete(oldKey);
        if (pacing.size >= 16) return 0;
      }
      pacing.set(key, budget);
    }
    const until = Math.max(sentAt, budget.until) + frames / rate * 1e3;
    if (until > sentAt + 250 || budget.packets >= 64) return 0;
    budget.until = until;
    budget.packets++;
    const pcm = bytes.slice().buffer;
    post({ type: "audio_write", pid, stream, frames, rate, channels, pcm, sentAt }, [pcm]);
    return 0;
  };
}

// web/linux/dist/wasm_binary.js
var WasmParseError = class extends Error {
  constructor(message, offset) {
    super(`${message} at byte ${offset}`);
    this.name = "WasmParseError";
  }
};
var text_decoder = new TextDecoder("utf-8", { fatal: true });
var Cursor = class _Cursor {
  #bytes;
  #end;
  #offset;
  constructor(bytes, offset = 0, end = bytes.length) {
    this.#bytes = bytes;
    this.#offset = offset;
    this.#end = end;
  }
  get done() {
    return this.#offset === this.#end;
  }
  get offset() {
    return this.#offset;
  }
  byte() {
    if (this.#offset === this.#end)
      this.fail("unexpected end of module");
    return this.#bytes[this.#offset++];
  }
  u32() {
    return Number(this.#unsigned(32));
  }
  u64() {
    return this.#unsigned(64);
  }
  #unsigned(bits) {
    let value = 0n;
    const bytes = Math.ceil(bits / 7);
    for (let i = 0; i < bytes; i++) {
      const byte = this.byte();
      const payload = byte & 127;
      const remaining = bits - i * 7;
      if (remaining < 7 && payload >= 1 << remaining) {
        this.fail(`u${bits} LEB128 overflows`);
      }
      value |= BigInt(payload) << BigInt(i * 7);
      if (!(byte & 128))
        return value;
    }
    this.fail(`u${bits} LEB128 is too long`);
  }
  // Heap types can be type indices encoded as s33. Their value is immaterial
  // here, but consuming the complete, bounded encoding lets us skip table and
  // global imports without parsing unrelated type sections.
  signed33(first) {
    let byte = first;
    for (let i = 0; i < 5; i++) {
      const payload = byte & 127;
      const remaining = 33 - i * 7;
      if (!(byte & 128)) {
        if (remaining < 7) {
          const used = (1 << remaining) - 1;
          const unused = 127 ^ used;
          const sign = 1 << remaining - 1;
          const extension = payload & sign ? unused : 0;
          if ((payload & unused) !== extension) {
            this.fail("s33 LEB128 overflows");
          }
        }
        return;
      }
      if (i === 4)
        this.fail("s33 LEB128 is too long");
      byte = this.byte();
    }
  }
  span() {
    const length = this.u32();
    const start2 = this.#offset;
    const end = start2 + length;
    if (end > this.#end)
      this.fail("span extends past its section");
    this.#offset = end;
    return new _Cursor(this.#bytes, start2, end);
  }
  text() {
    try {
      return text_decoder.decode(this.view());
    } catch {
      return this.fail("name is not valid UTF-8");
    }
  }
  view() {
    return this.#bytes.subarray(this.#offset, this.#end);
  }
  expect_done(what) {
    if (!this.done)
      this.fail(`trailing bytes in ${what}`);
  }
  fail(message) {
    throw new WasmParseError(message, this.#offset);
  }
};
function read_memory_type(bytes) {
  const flags = bytes.byte();
  if (flags & ~7)
    bytes.fail("unknown memory limits flags");
  const has_maximum = !!(flags & 1);
  const shared = !!(flags & 2);
  const address = flags & 4 ? "i64" : "i32";
  const read_limit = address === "i64" ? () => bytes.u64() : () => BigInt(bytes.u32());
  const minimum = read_limit();
  const maximum = has_maximum ? read_limit() : void 0;
  return { address, minimum, maximum, shared };
}
function skip_reference_type(bytes) {
  const type = bytes.byte();
  if (type === 99 || type === 100) {
    bytes.signed33(bytes.byte());
  } else if (type < 105 || type > 116) {
    bytes.fail("invalid reference type");
  }
}
function skip_value_type(bytes) {
  const type = bytes.byte();
  if (type >= 123 && type <= 127)
    return;
  if (type === 99 || type === 100) {
    bytes.signed33(bytes.byte());
  } else if (type < 105 || type > 116) {
    bytes.fail("invalid value type");
  }
}
function skip_limits(bytes) {
  const flags = bytes.byte();
  if (flags & ~5)
    bytes.fail("unknown limits flags");
  const read_limit = flags & 4 ? () => bytes.u64() : () => bytes.u32();
  read_limit();
  if (flags & 1)
    read_limit();
}
function read_imports(bytes, imports) {
  const count = bytes.u32();
  for (let i = 0; i < count; i++) {
    const module = bytes.span();
    const name = bytes.span();
    switch (bytes.byte()) {
      case 0:
        bytes.u32();
        break;
      case 1:
        skip_reference_type(bytes);
        skip_limits(bytes);
        break;
      case 2:
        imports.push({
          module: module.text(),
          name: name.text(),
          type: read_memory_type(bytes)
        });
        break;
      case 3:
        skip_value_type(bytes);
        if (bytes.byte() > 1)
          bytes.fail("invalid global mutability");
        break;
      case 4:
        if (bytes.byte() !== 0)
          bytes.fail("unknown tag attribute");
        bytes.u32();
        break;
      default:
        bytes.fail("unknown import type");
    }
  }
  bytes.expect_done("import section");
}
function read_definitions(bytes, definitions) {
  const count = bytes.u32();
  for (let i = 0; i < count; i++)
    definitions.push(read_memory_type(bytes));
  bytes.expect_done("memory section");
}
function read_wasm_memories(module) {
  const bytes = new Cursor(module);
  const header = [0, 97, 115, 109, 1, 0, 0, 0];
  for (const expected of header) {
    if (bytes.byte() !== expected)
      bytes.fail("invalid WebAssembly header");
  }
  const memories = { imports: [], definitions: [] };
  let saw_imports = false;
  let saw_definitions = false;
  while (!bytes.done) {
    const id = bytes.byte();
    const section = bytes.span();
    if (id === 2) {
      if (saw_imports)
        bytes.fail("duplicate import section");
      saw_imports = true;
      read_imports(section, memories.imports);
    } else if (id === 5) {
      if (saw_definitions)
        bytes.fail("duplicate memory section");
      saw_definitions = true;
      read_definitions(section, memories.definitions);
    }
  }
  return memories;
}

// web/linux/dist/user-memory-growth-adapter.js
var PAGE_BYTES = 64 * 1024;
var MAX_SAFE = Number.MAX_SAFE_INTEGER;
function diagnostic(message, details = {}) {
  try {
    if (typeof console !== "undefined" && typeof console.debug === "function") {
      console.debug(`[user-memory-growth] ${message}`, details);
    }
  } catch (_) {
  }
}
function asSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`unsafe ${name}: ${String(value)}`);
  }
  return value;
}
function ensureUserBytes(context, address, length, reason = "user") {
  address = asSafeInteger(address, "address");
  length = asSafeInteger(length, "length");
  if (address > MAX_SAFE - length) {
    throw new RangeError(`user range overflow: ${address}+${length}`);
  }
  const end = address + length;
  const memory = context && context.memory ? context.memory : context;
  if (!memory || typeof memory.grow !== "function" || !memory.buffer) {
    throw new RangeError("user memory is unavailable");
  }
  let currentPages = memory.buffer.byteLength / PAGE_BYTES;
  if (!Number.isSafeInteger(currentPages) || currentPages < 0) {
    throw new RangeError(`invalid user memory size: ${memory.buffer.byteLength}`);
  }
  const requiredPages = Math.ceil(end / PAGE_BYTES);
  const maximumPages = Number.isSafeInteger(context && context.maximum_pages) ? context.maximum_pages : Number.isSafeInteger(memory.maximum) ? memory.maximum : 65536;
  if (requiredPages > maximumPages) {
    diagnostic("user range exceeds memory maximum", { address, length, requiredPages, maximumPages, reason });
    throw new RangeError(`user memory maximum exceeded: ${requiredPages}>${maximumPages}`);
  }
  if (requiredPages > currentPages) {
    const delta = requiredPages - currentPages;
    if (!Number.isSafeInteger(delta) || delta < 0 || delta > maximumPages - currentPages) {
      throw new RangeError(`invalid user memory growth: ${delta}`);
    }
    try {
      memory.grow(delta);
    } catch (error) {
      diagnostic("user memory growth failed", { delta, requiredPages, currentPages, reason, error });
      throw error;
    }
    currentPages = memory.buffer.byteLength / PAGE_BYTES;
    diagnostic("grew user memory", { fromPages: requiredPages - delta, toPages: currentPages, address, length, reason });
    if (currentPages < requiredPages) {
      throw new RangeError(`user memory growth incomplete: ${currentPages}<${requiredPages}`);
    }
  }
  return new Uint8Array(memory.buffer, address, length);
}
function ensureUserDestination(context, address, length, reason = "destination") {
  return ensureUserBytes(context, address, length, reason);
}
function growForSyscallResult(context, resultOrNr, lengthOrArg0, arg1, arg2, ret) {
  if (arguments.length <= 4 || typeof ret === "undefined") {
    const result = resultOrNr;
    const length2 = lengthOrArg0;
    const reason = arg1 || "syscall";
    if (Number.isSafeInteger(result) && result >= 0 && Number.isSafeInteger(length2) && length2 >= 0) {
      ensureUserBytes(context, result, length2, reason);
    }
    return;
  }
  const nr = resultOrNr;
  if (!Number.isSafeInteger(ret) || ret < 0) return;
  let address = 0;
  let length = 0;
  if (nr === 9 || nr === 90 || nr === 192 || nr === 222) {
    address = ret;
    length = arg1;
  } else if (nr === 12 || nr === 45) {
    address = lengthOrArg0;
    length = ret >= address ? ret - address : 0;
  } else if (nr === 25 || nr === 163) {
    address = ret;
    length = arg2;
  } else {
    return;
  }
  if (Number.isSafeInteger(address) && address >= 0 && Number.isSafeInteger(length) && length >= 0) {
    ensureUserBytes(context, address, length, `syscall:${nr}`);
  }
}

// web/linux/dist/firefox-callback-adapter.mjs
var FIREFOX_CALLBACK_ADAPTER = new Uint8Array([
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0,
  1,
  28,
  1,
  96,
  23,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  1,
  126,
  3,
  2,
  1,
  0,
  7,
  12,
  1,
  8,
  99,
  97,
  108,
  108,
  98,
  97,
  99,
  107,
  0,
  0,
  10,
  6,
  1,
  4,
  0,
  66,
  0,
  11
]);
var FIREFOX_CALLBACK_DIAGNOSTIC_ADAPTER = new Uint8Array([
  0,
  97,
  115,
  109,
  1,
  0,
  0,
  0,
  1,
  28,
  1,
  96,
  23,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  126,
  1,
  126,
  2,
  11,
  1,
  3,
  101,
  110,
  118,
  3,
  108,
  111,
  103,
  0,
  0,
  3,
  2,
  1,
  0,
  7,
  12,
  1,
  8,
  99,
  97,
  108,
  108,
  98,
  97,
  99,
  107,
  0,
  1,
  10,
  55,
  1,
  53,
  0,
  32,
  0,
  32,
  1,
  32,
  2,
  32,
  3,
  32,
  4,
  32,
  5,
  32,
  6,
  32,
  7,
  32,
  8,
  32,
  9,
  32,
  10,
  32,
  11,
  32,
  12,
  32,
  13,
  32,
  14,
  32,
  15,
  32,
  16,
  32,
  17,
  32,
  18,
  32,
  19,
  32,
  20,
  32,
  21,
  32,
  22,
  16,
  0,
  26,
  66,
  0,
  11
]);
var callbackAdapterFunction;
var diagnosticCallbackAdapterFunction;
var diagnosticCallbackCount = 0;
var FIREFOX_CALLBACK_DIAGNOSTICS = (() => {
  if (globalThis.__LINUX_FIREFOX_CALLBACK_DIAGNOSTICS === true) return true;
  try {
    return new URL(globalThis.__linuxonwebExecutionURL ?? globalThis.location?.href ?? "").searchParams.get("firefox_diagnostics") === "1";
  } catch {
    return false;
  }
})();
var FIREFOX_CALLBACK_NO_ADAPTER = (() => {
  try {
    return new URL(globalThis.__linuxonwebExecutionURL ?? globalThis.location?.href ?? "").searchParams.get("firefox_no_adapter") === "1";
  } catch {
    return false;
  }
})();
function isFirefoxModule(module) {
  const imports = WebAssembly.Module.imports(module);
  const exports = WebAssembly.Module.exports(module);
  const hasLinuxAbi = [
    ["linux", "syscall", "function"],
    ["linux", "get_thread_area", "function"],
    ["linux", "copy_siginfo", "function"]
  ].every(([moduleName, name, kind]) => imports.some((item) => item.module === moduleName && item.name === name && item.kind === kind));
  const hasStart = exports.some((item) => item.name === "_start" && item.kind === "function");
  const hasTable = exports.some((item) => item.name === "__indirect_function_table" && item.kind === "table");
  if (FIREFOX_CALLBACK_DIAGNOSTICS && !(hasLinuxAbi && hasStart && hasTable)) {
    console.warn("[firefox-callback-adapter] Firefox module guard rejected", {
      importCount: imports.length,
      exportCount: exports.length,
      hasLinuxAbi,
      hasStart,
      hasTable,
      imports: imports.slice(0, 32).map(({ module: module2, name, kind }) => `${module2}.${name}:${kind}`),
      exports: exports.slice(0, 32).map(({ name, kind }) => `${name}:${kind}`)
    });
  }
  return hasLinuxAbi && hasStart && hasTable;
}
function getCallbackAdapterFunction(diagnostics2) {
  if (diagnostics2) {
    if (!diagnosticCallbackAdapterFunction) {
      const logger = (...args) => {
        diagnosticCallbackCount += 1;
        if (diagnosticCallbackCount <= 8) {
          console.error("[firefox-callback-adapter] callback", {
            count: diagnosticCallbackCount,
            args: args.slice(0, 4).map((value) => String(value))
          });
        }
        return 0n;
      };
      const adapter = new WebAssembly.Instance(
        new WebAssembly.Module(FIREFOX_CALLBACK_DIAGNOSTIC_ADAPTER),
        { env: { log: logger } }
      );
      diagnosticCallbackAdapterFunction = adapter.exports.callback;
    }
    return diagnosticCallbackAdapterFunction;
  }
  if (!callbackAdapterFunction) {
    const adapter = new WebAssembly.Instance(new WebAssembly.Module(FIREFOX_CALLBACK_ADAPTER));
    callbackAdapterFunction = adapter.exports.callback;
  }
  return callbackAdapterFunction;
}
function installFirefoxCallbackAdapter(module, instance) {
  if (FIREFOX_CALLBACK_NO_ADAPTER) {
    if (FIREFOX_CALLBACK_DIAGNOSTICS)
      console.error("[firefox-callback-adapter] disabled by firefox_no_adapter=1");
    return 0;
  }
  if (!isFirefoxModule(module)) return 0;
  const table = instance.exports.__indirect_function_table;
  if (!(table instanceof WebAssembly.Table) || table.length < 3) return 0;
  const callback = getCallbackAdapterFunction(FIREFOX_CALLBACK_DIAGNOSTICS);
  let patched = 0;
  const patchedSlots = [];
  for (let index = 0; index < 3; index += 1) {
    if (table.get(index) === null) {
      table.set(index, callback);
      patched += 1;
      patchedSlots.push(index);
    }
  }
  if (FIREFOX_CALLBACK_DIAGNOSTICS || diagnosticsRequestedByWorkerUrl()) {
    console.warn("[FIREFOX_CALLBACK_DIAGNOSTICS] table diagnostics", {
      length: table.length,
      patchedSlots,
      reserved: [0, 1, 2].map((index) => table.get(index) === null ? null : "function")
    });
  }
  return patched;
}
function diagnosticsRequestedByWorkerUrl() {
  try {
    return new URL(globalThis.__linuxonwebExecutionURL ?? globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_diagnostics") === "1";
  } catch {
    return false;
  }
}

// web/linux/dist/guest-jit.js
var JIT_SYSCALL_INSTALL = 1783169025;
var JIT_SYSCALL_FREE = 1783169026;
var JIT_SYSCALL_SYNC = 1783169027;
var JIT_SYSCALL_STATS = 1783169028;
var JIT_SYSCALL_MIN = JIT_SYSCALL_INSTALL;
var JIT_SYSCALL_MAX = JIT_SYSCALL_STATS;
var JIT_STATS_WORDS = 12;
var JIT_MAX_MODULE_BYTES = 1 << 20;
var JIT_MAX_EXPORTS = 1024;
var JIT_INSTALL_PRIVATE = 1;
var JIT_CACHE_MAX_ENTRIES = 1024;
var JIT_CACHE_MAX_BYTES = 8 << 20;
var E2BIG = 7;
var ENOEXEC = 8;
var ENOMEM = 12;
var EFAULT = 14;
var EINVAL = 22;
var ENOSPC = 28;
var ENOSYS = 38;
var MAGIC = 1246319665;
var W_MAGIC = 0;
var W_LOCK = 1;
var W_EPOCH = 2;
var W_TABLE_BASE = 3;
var W_NEXT = 4;
var W_ARENA_USED = 5;
var W_NO_REUSE = 6;
var W_FREE_COUNT = 7;
var W_INSTALLS = 8;
var W_FREES = 9;
var SLOT_WORD = 16;
var MAX_SLOTS = 128;
var FREE_WORD = SLOT_WORD + MAX_SLOTS * 2;
var MAX_FREE = 1024;
var LOG_WORD = FREE_WORD + MAX_FREE * 3;
var LOG_WORDS_PER_ENTRY = 6;
var MAX_LOG = 16384;
var KIND_INSTALL = 1;
var KIND_FREE = 2;
var LOG_END_BYTE = (LOG_WORD + MAX_LOG * LOG_WORDS_PER_ENTRY) * 4;
var ARENA_BYTE = Math.ceil(LOG_END_BYTE / 4096) * 4096;
var ARENA_MAX = 16 << 20;
var INITIAL_BYTES = Math.ceil((LOG_WORD + 128 * LOG_WORDS_PER_ENTRY) * 4 / 4096) * 4096;
var MAX_BYTES = ARENA_BYTE + ARENA_MAX;
function createJitControl() {
  try {
    const sab = new SharedArrayBuffer(INITIAL_BYTES, { maxByteLength: MAX_BYTES });
    if (typeof sab.grow !== "function")
      return null;
    new Int32Array(sab)[W_MAGIC] = MAGIC;
    return sab;
  } catch {
    return null;
  }
}
function cloneJitControl(source) {
  if (!(source instanceof SharedArrayBuffer))
    return null;
  const length = source.byteLength;
  const sab = new SharedArrayBuffer(length, { maxByteLength: MAX_BYTES });
  new Uint8Array(sab).set(new Uint8Array(source, 0, length));
  const ctl = new Int32Array(sab);
  ctl[W_LOCK] = 0;
  ctl.fill(0, SLOT_WORD, SLOT_WORD + MAX_SLOTS * 2);
  return sab;
}
function readLeb(bytes, state) {
  let result = 0, shift = 0, byte;
  do {
    if (state.offset >= bytes.length || shift > 28)
      throw new RangeError("bad LEB128");
    byte = bytes[state.offset++];
    result |= (byte & 127) << shift;
    shift += 7;
  } while (byte & 128);
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
  const maximum = flags & 1 ? readLeb(bytes, state) : void 0;
  return { flags, minimum, maximum };
}
function skipConstExpr(bytes, state) {
  for (; ; ) {
    const op = bytes[state.offset++];
    if (op === 11)
      return;
    if (op === 210 || op === 35 || op === 65)
      readLeb(bytes, state);
    else if (op === 208)
      state.offset++;
    else
      throw new RangeError("unsupported constant expression");
  }
}
function validateJitModuleImage(bytes) {
  if (bytes.length < 8 || bytes[0] !== 0 || bytes[1] !== 97 || bytes[2] !== 115 || bytes[3] !== 109 || bytes[4] !== 1 || bytes[5] !== 0 || bytes[6] !== 0 || bytes[7] !== 0)
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
          if (name !== "table" || bytes[state.offset++] !== 112)
            throw "only env.table funcref may be imported";
          const limits = readLimits(bytes, state);
          if (limits.flags & ~1)
            throw "unsupported table limits";
        } else if (kind === 2) {
          const limits = readLimits(bytes, state);
          if (name !== "memory" || limits.flags !== 3)
            throw "env.memory must be shared i32 memory with a maximum";
        } else if (kind === 3) {
          const type = bytes[state.offset++], mutable = bytes[state.offset++];
          if (name !== "__jit_table_base" || type !== 127 || mutable !== 0)
            throw "only immutable i32 env.__jit_table_base may be imported";
          importsGlobal = true;
        } else
          throw "function/tag imports are not permitted";
      }
    } else if (id === 5) {
      throw "defined memories are not permitted";
    } else if (id === 8) {
      throw "start function is not permitted";
    } else if (id === 9) {
      const count = readLeb(bytes, state);
      for (let i = 0; i < count; i++) {
        const flags = readLeb(bytes, state);
        if ((flags & 1) === 0 || flags > 7)
          throw "active element segments are not permitted";
        const expressions = (flags & 4) !== 0;
        state.offset++;
        const items = readLeb(bytes, state);
        for (let j = 0; j < items; j++) {
          if (expressions)
            skipConstExpr(bytes, state);
          else
            readLeb(bytes, state);
        }
      }
    } else if (id === 11) {
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
  const seen = /* @__PURE__ */ new Set();
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
  let hash = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 16777619);
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
var JitThread = class {
  constructor(control, memory, table, cacheLimits = {}) {
    this.sab = control;
    this.ctl = new Int32Array(control);
    this.memory = memory;
    this.table = table instanceof WebAssembly.Table ? table : null;
    this.epoch = 0;
    this.cache = /* @__PURE__ */ new Map();
    this.cacheOrder = /* @__PURE__ */ new Map();
    this.cacheMaxEntries = cacheLimits.entries ?? JIT_CACHE_MAX_ENTRIES;
    this.cacheMaxBytes = cacheLimits.bytes ?? JIT_CACHE_MAX_BYTES;
    if (!Number.isInteger(this.cacheMaxEntries) || this.cacheMaxEntries < 0 || this.cacheMaxEntries > JIT_CACHE_MAX_ENTRIES || !Number.isInteger(this.cacheMaxBytes) || this.cacheMaxBytes < 0 || this.cacheMaxBytes > JIT_CACHE_MAX_BYTES)
      throw new RangeError("invalid JIT compile-cache budget");
    this.stats = {
      compiles: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheEvictions: 0,
      cacheEntries: 0,
      cacheBytes: 0,
      liveFunctions: 0,
      replayedInstalls: 0,
      replayedFrees: 0,
      replayErrors: 0
    };
    const firstJit = Atomics.load(this.ctl, W_TABLE_BASE) || this.table?.length || 0;
    if (this.table) {
      for (let i = firstJit; i < this.table.length; i++)
        if (this.table.get(i) !== null) this.stats.liveFunctions++;
    }
    this.slot = -1;
    for (let i = 0; i < MAX_SLOTS; i++) {
      const word = SLOT_WORD + i * 2;
      if (Atomics.compareExchange(this.ctl, word, 0, 1) === 0) {
        Atomics.store(this.ctl, word + 1, 0);
        this.slot = i;
        break;
      }
    }
    if (this.slot < 0)
      Atomics.store(this.ctl, W_NO_REUSE, 1);
  }
  release() {
    this.cache.clear();
    this.cacheOrder.clear();
    this.stats.cacheEntries = this.stats.cacheBytes = 0;
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
          this.cacheOrder.delete(entry);
          this.cacheOrder.set(entry, true);
          return entry.module;
        }
      }
    }
    this.stats.cacheMisses++;
    const module = new WebAssembly.Module(bytes);
    this.stats.compiles++;
    if (this.cacheMaxEntries && bytes.length <= this.cacheMaxBytes) {
      const entry = { key, bytes: bytes.slice(), module };
      if (bucket) bucket.push(entry);
      else this.cache.set(key, [entry]);
      this.cacheOrder.set(entry, true);
      this.stats.cacheEntries++;
      this.stats.cacheBytes += bytes.length;
      while (this.stats.cacheEntries > this.cacheMaxEntries || this.stats.cacheBytes > this.cacheMaxBytes) {
        const oldest = this.cacheOrder.keys().next().value;
        const entries = this.cache.get(oldest.key);
        entries.splice(entries.indexOf(oldest), 1);
        if (!entries.length) this.cache.delete(oldest.key);
        this.cacheOrder.delete(oldest);
        this.stats.cacheEntries--;
        this.stats.cacheBytes -= oldest.bytes.length;
        this.stats.cacheEvictions++;
      }
    }
    return module;
  }
  // Instantiates and fills [base, base + count) in this thread's table.
  place(module, base, count) {
    const table = this.table;
    if (!table)
      throw new Error("no exported function table");
    const instance = new WebAssembly.Instance(module, {
      env: { memory: this.memory, table, __jit_table_base: base }
    });
    const end = base + count;
    if (table.length < end)
      table.grow(end - table.length, null);
    for (let i = 0; i < count; i++) {
      const wasNull = table.get(base + i) === null;
      table.set(base + i, instance.exports["f" + i]);
      if (wasNull) this.stats.liveFunctions++;
    }
  }
  clear(base, count) {
    const table = this.table;
    if (!table)
      return;
    const end = Math.min(base + count, table.length);
    for (let i = base; i < end; i++) {
      const wasLive = table.get(i) !== null;
      table.set(i, null);
      if (wasLive) this.stats.liveFunctions--;
    }
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
            continue;
          const offset = ARENA_BYTE + ctl[word + 3], length = ctl[word + 4];
          const bytes = new Uint8Array(this.sab, offset, length).slice();
          this.place(this.compile(bytes), base, count);
          this.stats.replayedInstalls++;
        } else if (kind === KIND_FREE) {
          this.clear(base, count);
          this.stats.replayedFrees++;
        }
      } catch (error) {
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
    Atomics.store(ctl, W_EPOCH, epoch + 1);
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
    } catch {
      return -ENOEXEC;
    }
    if (count < 0)
      return -ENOEXEC;
    if ((outPtr & 3) !== 0 || outPtr + count * 4 > buffer.byteLength || outPtr === 0)
      return -EFAULT;
    const ctl = this.ctl;
    this.lock();
    try {
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
      if (base + count > 2147483647)
        return -ENOMEM;
      try {
        this.ensureBytes(Math.max(
          (LOG_WORD + (ctl[W_EPOCH] + 2) * LOG_WORDS_PER_ENTRY) * 4,
          ARENA_BYTE + arenaOffset + moduleLength
        ));
      } catch {
        return -ENOMEM;
      }
      try {
        this.place(module, base, count);
      } catch (error) {
        if (error instanceof WebAssembly.LinkError)
          return -ENOEXEC;
        return -ENOMEM;
      }
      if (freeIndex >= 0) {
        const word = FREE_WORD + freeIndex * 3;
        if (ctl[word + 1] > count) {
          ctl[word] += count;
          ctl[word + 1] -= count;
        } else {
          const last = FREE_WORD + (ctl[W_FREE_COUNT] - 1) * 3;
          ctl[word] = ctl[last];
          ctl[word + 1] = ctl[last + 1];
          ctl[word + 2] = ctl[last + 2];
          ctl[W_FREE_COUNT]--;
        }
      } else {
        ctl[W_NEXT] = base + count;
      }
      new Uint8Array(this.sab, ARENA_BYTE + arenaOffset, moduleLength).set(bytes);
      ctl[W_ARENA_USED] = arenaOffset + moduleLength;
      ctl[W_INSTALLS]++;
      this.appendLog(KIND_INSTALL, base, count, arenaOffset, moduleLength);
      this.epoch = ctl[W_EPOCH];
      if (this.slot >= 0)
        Atomics.store(ctl, SLOT_WORD + this.slot * 2 + 1, this.epoch);
      const view = new DataView(memory.buffer);
      for (let i = 0; i < count; i++)
        view.setUint32(outPtr + i * 4, base + i, true);
      return 0;
    } finally {
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
    if (base + count > 2147483647)
      return -ENOMEM;
    try {
      this.place(module, base, count);
    } catch (error) {
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
      } catch {
        return -ENOMEM;
      }
      Atomics.store(ctl, found + 5, 1);
      this.appendLog(KIND_FREE, base, count, 0, 0);
      if (free < MAX_FREE) {
        const word = FREE_WORD + free * 3;
        ctl[word] = base;
        ctl[word + 1] = count;
        ctl[word + 2] = epoch + 1;
        ctl[W_FREE_COUNT] = free + 1;
      }
      ctl[W_FREES]++;
    } finally {
      this.unlock();
    }
    this.replay();
    return 0;
  }
  writeStats(memory, outPtr) {
    if ((outPtr & 3) !== 0 || outPtr === 0 || outPtr + JIT_STATS_WORDS * 4 > memory.buffer.byteLength)
      return -EFAULT;
    const ctl = this.ctl, s = this.stats;
    const values = [
      Atomics.load(ctl, W_EPOCH),
      this.epoch,
      s.compiles,
      s.cacheHits,
      s.replayedInstalls,
      s.replayedFrees,
      s.replayErrors,
      this.table ? this.table.length : 0,
      ctl[W_TABLE_BASE],
      ctl[W_NEXT],
      ctl[W_FREE_COUNT],
      this.slot
    ];
    const view = new DataView(memory.buffer);
    values.forEach((value, i) => view.setUint32(outPtr + i * 4, value >>> 0, true));
    return 0;
  }
};
function jitSyscall(thread, memory, nr, a0, a1, a2, a3) {
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

// web/linux/dist/guest-gpu-hostcall.js
var GPU_HC_CALL = 1783037953;
var GPU_HC_STATS = 1783037954;
var GPU_HC_CONTROL = 1783037955;
var GPU_HC_MIN = GPU_HC_CALL;
var GPU_HC_MAX = GPU_HC_CONTROL;
var CTL_RESPAWN = 1;
var CTL_SET_STALL_MS = 2;
var EIO = 5;
var EAGAIN = 11;
var EFAULT2 = 14;
var EBUSY = 16;
var ENODEV = 19;
var EINVAL2 = 22;
var ENOSYS2 = 38;
var EPERM = 1;
var ETIMEDOUT = 110;
var PROTOCOL_VERSION = 1;
var MAX_SLOTS2 = 256;
var MAX_RANGE = 256 << 20;
var H_MAGIC = 0;
var H_OWNER_STATE = 1;
var H_OWNER_GEN = 2;
var H_HEARTBEAT = 3;
var H_DOORBELL = 4;
var H_FLAGS = 5;
var H_NEXT_GEN = 6;
var H_DEAD_REASON = 7;
var H_STALL_MS = 8;
var H_STARTUP_MS = 9;
var H_CALLS = 10;
var H_TOKENS = 11;
var H_PENDING = 16;
var H_SLOTS = 32;
var SLOT_WORDS = 16;
var S_TOKEN = 0;
var S_STATE = 1;
var S_SEQ = 2;
var S_OP = 3;
var S_GEN = 4;
var S_ARGS = 5;
var S_RESULT = 11;
var HUB_BYTES = (H_SLOTS + MAX_SLOTS2 * SLOT_WORDS) * 4;
var MAGIC2 = 1196443697;
var OWNER_ALIVE = 2;
var OWNER_DEAD = 3;
var STATE_IDLE = 0;
var STATE_REQUEST = 1;
var STATE_BUSY = 2;
var STATE_DONE = 3;
var DEAD_STALL = 2;
var DEAD_STARTUP = 5;
var FLAG_TEST_HOOKS = 1;
var WAIT_SLICE_MS = 100;
var FAST_WAIT_MS = 1;
var YIELD_SLICE_MS = 1;
function slotWord(slot, word) {
  return H_SLOTS + slot * SLOT_WORDS + word;
}
var SEQ_MASK = 1073741823;
function slotState(seq, state) {
  return (seq & SEQ_MASK) << 2 | state;
}
var GpuHostcallClient = class {
  constructor(hub, post, yieldToKernel = null) {
    this.hub = new Int32Array(hub);
    this.post = post;
    this.yieldToKernel = yieldToKernel;
    this.slot = -1;
    this.token = 0;
    this.memory = null;
    this.gen = 0;
    this.calls = 0;
    this.active = false;
    this.inflight = 0;
    this.yields = 0;
  }
  claim() {
    const hub = this.hub;
    if (this.slot >= 0)
      return this.slot;
    const token = Atomics.add(hub, H_TOKENS, 1) + 1 || 1;
    for (let slot = 0; slot < MAX_SLOTS2; slot++) {
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
    this.post({ type: "gpu_hostcall", kind: "attach", slot: this.slot, gen: this.gen, memory });
  }
  release() {
    if (this.slot < 0)
      return;
    const slot = this.slot;
    if (this.inflight !== 0)
      this.abandon(slotWord(slot, 0));
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
    if (Atomics.load(hub, H_MAGIC) !== MAGIC2)
      return -ENOSYS2;
    if (this.active)
      return -EBUSY;
    if (Atomics.load(hub, H_OWNER_STATE) === OWNER_DEAD)
      return -ENODEV;
    const slot = this.claim();
    if (slot < 0)
      return -EAGAIN;
    this.attach(memory);
    const base = slotWord(slot, 0);
    let seq = Atomics.add(hub, base + S_SEQ, 1) + 1 & SEQ_MASK;
    if (seq === 0)
      seq = Atomics.add(hub, base + S_SEQ, 1) + 1 & SEQ_MASK;
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
    } finally {
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
      } else {
        Atomics.wait(hub, base + S_STATE, state, YIELD_SLICE_MS);
        if (Atomics.load(hub, base + S_STATE) === done)
          break;
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
    const hub = this.hub;
    const state = Atomics.exchange(hub, base + S_STATE, STATE_IDLE);
    Atomics.and(hub, H_PENDING + (this.slot >>> 5), ~(1 << (this.slot & 31)));
    this.inflight = 0;
    return (state & 3) === STATE_BUSY || (state & 3) === STATE_DONE ? -EIO : -ENODEV;
  }
  control(cmd, arg) {
    const hub = this.hub;
    if (Atomics.load(hub, H_MAGIC) !== MAGIC2)
      return -ENOSYS2;
    if (!(Atomics.load(hub, H_FLAGS) & FLAG_TEST_HOOKS))
      return -EPERM;
    switch (cmd) {
      case CTL_RESPAWN: {
        if (Atomics.load(hub, H_OWNER_STATE) !== OWNER_DEAD)
          return 0;
        const gen = Atomics.load(hub, H_OWNER_GEN);
        this.post({ type: "gpu_hostcall", kind: "respawn", gen });
        const deadline = performance.now() + Atomics.load(hub, H_STARTUP_MS);
        for (; ; ) {
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
        if (ms < 100 || ms > 6e4)
          return -EINVAL2;
        Atomics.store(hub, H_STALL_MS, ms);
        return 0;
      }
      default:
        return -EINVAL2;
    }
  }
  stats(memory, out) {
    const hub = this.hub;
    if (Atomics.load(hub, H_MAGIC) !== MAGIC2)
      return -ENOSYS2;
    const words = [
      PROTOCOL_VERSION,
      Atomics.load(hub, H_OWNER_STATE),
      Atomics.load(hub, H_OWNER_GEN),
      this.slot,
      Atomics.load(hub, H_HEARTBEAT),
      Atomics.load(hub, H_CALLS),
      Atomics.load(hub, H_DEAD_REASON),
      Atomics.load(hub, H_FLAGS),
      this.calls,
      Atomics.load(hub, H_STALL_MS),
      this.yields
    ];
    const address = out >>> 0;
    const buffer = memory.buffer;
    if (address === 0 || address + words.length * 4 > buffer.byteLength)
      return -EFAULT2;
    const view = new DataView(buffer, address, words.length * 4);
    words.forEach((value, i) => view.setUint32(i * 4, value >>> 0, true));
    return 0;
  }
};
function gpuHostcallSyscall(client, memory, nr, a0, a1, a2, a3, a4, a5) {
  if (client === null || !memory)
    return -ENOSYS2;
  switch (Number(nr)) {
    case GPU_HC_CALL:
      return client.call(memory, a0 | 0, a1, a2, a3, a4, a5);
    case GPU_HC_STATS:
      return client.stats(memory, a0);
    case GPU_HC_CONTROL:
      return client.control(a0 | 0, a1);
    default:
      return -ENOSYS2;
  }
}

// web/linux/dist/worker.js
var unavailable = () => {
  throw new Error("not available on worker thread");
};
var channel = platform.worker_channel();
var postMessage = channel.post;
var gpu_hub = null;
var gpu_client = null;
function user_imports({ kernel_memory, get_kernel_instance, parent_user: parent }) {
  const HALT_USER = /* @__PURE__ */ Symbol("halt user");
  const has_parent = Boolean(parent);
  let context = parent;
  let instance = null;
  let instance_deferred = false;
  let pending_module_bytes = null;
  let pending = null;
  let jit_thread = null;
  const siginfo_copy_results = [];
  function copy_bytes(destination_memory, destination, source_memory, source, length, grow_user_destination = false) {
    if (grow_user_destination) {
      try {
        ensureUserDestination(destination_memory, destination, length, "copy_bytes");
      } catch {
        return length;
      }
    }
    const to = memory_bytes(destination_memory, destination, length);
    const from = memory_bytes(source_memory, source, length);
    if (!to || !from)
      return length;
    try {
      to.set(from);
      return 0;
    } catch {
      return length;
    }
  }
  function user_atomic_word(uaddr) {
    const address = uaddr >>> 0;
    if (!context || (address & 3) !== 0)
      return null;
    try {
      ensureUserDestination(context.memory, address, Int32Array.BYTES_PER_ELEMENT, "atomic");
    } catch {
      return null;
    }
    const bytes = memory_bytes(context.memory, address, Int32Array.BYTES_PER_ELEMENT);
    return bytes ? new Int32Array(bytes.buffer, bytes.byteOffset, 1) : null;
  }
  function write_kernel_u32(addr, value) {
    const bytes = memory_bytes(kernel_memory, addr >>> 0, Uint32Array.BYTES_PER_ELEMENT);
    if (!bytes)
      return false;
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(0, value, true);
    return true;
  }
  function firefox_diagnostics_enabled() {
    try {
      return new URL(globalThis.__linuxonwebExecutionURL ?? globalThis.location?.href ?? "").searchParams.get("firefox_diagnostics") === "1";
    } catch {
      return false;
    }
  }
  function firefox_memory_pregrow_enabled() {
    try {
      return new URL(globalThis.__linuxonwebExecutionURL ?? globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_memory_pregrow") === "1";
    } catch {
      return false;
    }
  }
  function firefox_memory_pregrow_before_start(memory) {
    if (!firefox_memory_pregrow_enabled() || !firefox_memory_pregrow_allowed || !memory?.buffer)
      return null;
    try {
      const pageSize = 65536;
      const oldPages = memory.buffer.byteLength / pageSize;
      const targetPages = 1024;
      if (oldPages >= targetPages) {
        console.warn("[FIREFOX_MEMORY_PREGROW]", JSON.stringify({ moduleGate: firefox_strict_module_allowed, oldPages, newPages: oldPages, delta: 0 }));
        return oldPages;
      }
      const delta = targetPages - oldPages;
      const grownFrom = memory.grow(delta);
      const newPages = memory.buffer.byteLength / pageSize;
      console.warn("[FIREFOX_MEMORY_PREGROW]", JSON.stringify({ moduleGate: firefox_strict_module_allowed, oldPages: grownFrom, newPages, delta }));
      return newPages;
    } catch (error) {
      console.warn("[FIREFOX_MEMORY_PREGROW] grow failed", JSON.stringify({ moduleGate: firefox_strict_module_allowed, error: String(error) }));
      return null;
    }
  }
  function firefox_guard_memory_diag_enabled() {
    try {
      return new URL(globalThis.__linuxonwebExecutionURL ?? globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_guard_memory_diag") === "1";
    } catch {
      return false;
    }
  }
  function firefox_guard_memory_diag_before_start(memory) {
    if (!firefox_guard_memory_diag_enabled() || !firefox_strict_module_allowed || !memory?.buffer)
      return null;
    const addresses = {
      mutex: 46209940,
      cond: 46209920,
      guardA: 45757056,
      guardB: 45757072
    };
    const values = {};
    try {
      const view = new DataView(memory.buffer);
      for (const [name, address] of Object.entries(addresses)) {
        if (name === "guardA" || name === "guardB") {
          values[name] = address < view.byteLength ? view.getUint8(address) : null;
        } else {
          values[name] = address + 4 <= view.byteLength ? view.getUint32(address, true) : null;
        }
      }
      console.warn("[FIREFOX_GUARD_MEMORY_DIAG]", JSON.stringify({ moduleGate: firefox_strict_module_allowed, values }));
      return values;
    } catch (error) {
      console.warn("[FIREFOX_GUARD_MEMORY_DIAG] read failed", JSON.stringify({ moduleGate: firefox_strict_module_allowed, error: String(error), values }));
      return null;
    }
  }
  function firefox_guard_bypass_all_enabled() {
    try {
      return new URL(globalThis.__linuxonwebExecutionURL ?? globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_guard_bypass_all") === "1";
    } catch {
      return false;
    }
  }
  function firefox_guard_bypass_all_before_start(memory) {
    if (!firefox_guard_bypass_all_enabled() || !firefox_strict_module_allowed || !memory?.buffer)
      return null;
    const addresses = [45757056, 45757072];
    const writes = [];
    try {
      const buffer = memory.buffer;
      const shared = typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer;
      for (const address of addresses) {
        if (address + 1 > buffer.byteLength)
          continue;
        const bytes = new Uint8Array(buffer, address, 1);
        const oldValue = shared ? Atomics.load(bytes, 0) : bytes[0];
        if (shared)
          Atomics.store(bytes, 0, 1);
        else
          bytes[0] = 1;
        writes.push({ address, old: oldValue, new: 1 });
      }
      console.warn("[FIREFOX_GUARD_BYPASS_ALL]", JSON.stringify({ moduleGate: firefox_strict_module_allowed, writes }));
      return writes;
    } catch (error) {
      console.warn("[FIREFOX_GUARD_BYPASS_ALL] write failed", JSON.stringify({ moduleGate: firefox_strict_module_allowed, error: String(error), writes }));
      return null;
    }
  }
  function firefox_guard_bypass_enabled() {
    try {
      return new URL(globalThis.__linuxonwebExecutionURL ?? globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_guard_bypass") === "1";
    } catch {
      return false;
    }
  }
  function firefox_guard_bypass_before_start(memory) {
    if (!firefox_guard_bypass_enabled() || !memory?.buffer)
      return null;
    const address = 45744128;
    try {
      const buffer = memory.buffer;
      if (address + 1 > buffer.byteLength)
        return null;
      const shared = typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer;
      const bytes = new Uint8Array(buffer, address, 1);
      const oldValue = shared ? Atomics.load(bytes, 0) : bytes[0];
      if (shared)
        Atomics.store(bytes, 0, 1);
      else
        bytes[0] = 1;
      console.warn("[FIREFOX_GUARD_BYPASS]", JSON.stringify({ address, old: oldValue, new: 1 }));
      return oldValue;
    } catch (error) {
      console.warn("[FIREFOX_GUARD_BYPASS] write failed", JSON.stringify({ address, error: String(error) }));
      return null;
    }
  }
  function firefox_start_guard_enabled() {
    try {
      return new URL(globalThis.__linuxonwebExecutionURL ?? globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_start_guard") === "1";
    } catch {
      return false;
    }
  }
  function firefox_start_guard_snapshot(memory, phase) {
    if (!firefox_start_guard_enabled() || !memory?.buffer)
      return null;
    const address = 37277824;
    try {
      const buffer = memory.buffer;
      if (address + 4 > buffer.byteLength)
        return null;
      let value;
      if (typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer)
        value = Atomics.load(new Uint32Array(buffer, address, 1), 0);
      else
        value = new DataView(buffer).getUint32(address, true);
      console.warn("[FIREFOX_START_GUARD] memory", JSON.stringify({ phase, address, value }));
      return value;
    } catch (error) {
      console.warn("[FIREFOX_START_GUARD] memory read failed", JSON.stringify({ phase, address, error: String(error) }));
      return null;
    }
  }
  function call_start() {
    const { _start } = ready_instance().exports;
    assert(typeof _start === "function", "_start not found");
    if (firefox_diagnostics_enabled())
      console.error("[firefox-callback-adapter] before _start");
    firefox_memory_pregrow_before_start(firefox_start_guard_memory);
    firefox_guard_memory_diag_before_start(firefox_start_guard_memory);
    firefox_guard_bypass_before_start(firefox_start_guard_memory);
    firefox_guard_bypass_all_before_start(firefox_start_guard_memory);
    firefox_start_guard_snapshot(firefox_start_guard_memory, "before-start");
    try {
      _start();
    } catch (error) {
      if (firefox_abort_trace_instances.has(instance)) {
        try {
          console.warn("[FIREFOX_ABORT_TRACE] start error", JSON.stringify({
            message: String(error?.message ?? error).slice(0, 1024),
            stack: String(error?.stack ?? "").slice(0, 8192)
          }));
        } catch {
        }
      }
      firefox_start_guard_snapshot(firefox_start_guard_memory, "after-start-error");
      throw error;
    }
    firefox_start_guard_snapshot(firefox_start_guard_memory, "after-start");
    throw new Error("_start reached the end without exiting");
  }
  const FPCAST_EMU_ARITY = 23;
  function call_user_table_function(f, args, expected_arity, error_message) {
    assert(typeof f === "function", error_message);
    if (f.length === expected_arity)
      return f(...args);
    assert(f.length === FPCAST_EMU_ARITY, error_message);
    const abi_args = Array(FPCAST_EMU_ARITY).fill(0n);
    for (let index = 0; index < args.length; index += 1) {
      abi_args[index] = BigInt(args[index] >>> 0);
    }
    return f(...abi_args);
  }
  let call_entry = call_start;
  let firefox_start_guard_memory = null;
  const firefox_abort_trace_instances = /* @__PURE__ */ new WeakSet();
  function firefox_abort_trace_enabled() {
    try {
      return new URL(globalThis.__linuxonwebExecutionURL ?? globalThis.location.href).searchParams.get("firefox_abort_trace") === "1";
    } catch {
      return false;
    }
  }
  let firefox_memory_pregrow_allowed = false;
  let firefox_strict_module_allowed = false;
  function firefox_syscall_trace_enabled() {
    try {
      return new URL(globalThis.__linuxonwebExecutionURL ?? globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_syscall_trace") === "1";
    } catch {
      return false;
    }
  }
  function firefox_tls_adapter_enabled() {
    try {
      return new URL(globalThis.__linuxonwebExecutionURL ?? globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_tls_adapter") === "1";
    } catch {
      return false;
    }
  }
  function isFirefoxSyscallTraceModule(module) {
    try {
      const hasStart = WebAssembly.Module.exports(module).some(({ name }) => name === "_start");
      const hasLinuxSyscalls = WebAssembly.Module.imports(module).some(({ module: name, name: field }) => name === "linux" && field === "syscall");
      return hasStart && hasLinuxSyscalls;
    } catch {
      return false;
    }
  }
  function isFirefoxTlsModule(module) {
    try {
      const exports = WebAssembly.Module.exports(module);
      return exports.some(({ name }) => name === "_start") && exports.some(({ name }) => name === "__indirect_function_table");
    } catch {
      return false;
    }
  }
  function create_instance(context2) {
    firefox_start_guard_memory = context2.memory;
    firefox_strict_module_allowed = isFirefoxSyscallTraceModule(context2.module);
    firefox_memory_pregrow_allowed = firefox_strict_module_allowed;
    const kernel_instance = get_kernel_instance();
    const traceSyscalls = firefox_syscall_trace_enabled() && isFirefoxSyscallTraceModule(context2.module);
    const tlsAdapter = firefox_tls_adapter_enabled() && (isFirefoxSyscallTraceModule(context2.module) || isFirefoxTlsModule(context2.module));
    let tracedSyscalls = 0;
    let threadAreaPointer = null;
    let threadAreaLogged = false;
    let threadAreaGetLogged = false;
    let local_jit = null;
    firefox_start_guard_snapshot(context2.memory, "before-instance");
    const abortTrace = firefox_abort_trace_enabled() && isFirefoxSyscallTraceModule(context2.module);
    if (abortTrace) Error.stackTraceLimit = 64;
    let abortTraceWrites = 0;
    let abortTraceBytes = 0;
    function traceAbortWrite(nr, fd, pointer, length) {
      if (!abortTrace || abortTraceWrites >= 16 || abortTraceBytes >= 4096)
        return;
      const callNumber = Number(nr);
      const descriptor = Number(fd);
      if (callNumber !== 4 && callNumber !== 146 || descriptor !== 1 && descriptor !== 2)
        return;
      abortTraceWrites += 1;
      try {
        let copyRange = function(address2, count2) {
          if (!Number.isSafeInteger(address2) || !Number.isSafeInteger(count2) || address2 < 0 || count2 < 0 || address2 + count2 > buffer.byteLength)
            return;
          const take = Math.min(count2, limit - captured.length);
          const bytes = new Uint8Array(buffer, address2, take);
          for (const byte of bytes) captured.push(byte);
        };
        const buffer = context2.memory.buffer;
        const view = new DataView(buffer);
        const limit = Math.min(512, 4096 - abortTraceBytes);
        const captured = [];
        const address = Number(pointer);
        const count = Number(length);
        if (callNumber === 4) {
          copyRange(address, count);
        } else if (Number.isSafeInteger(address) && Number.isSafeInteger(count) && address >= 0 && count >= 0 && address + Math.min(count, 8) * 8 <= buffer.byteLength) {
          for (let i = 0; i < Math.min(count, 8) && captured.length < limit; i += 1) {
            copyRange(view.getUint32(address + i * 8, true), view.getUint32(address + i * 8 + 4, true));
          }
        }
        abortTraceBytes += captured.length;
        console.warn("[FIREFOX_ABORT_TRACE] write attempt", JSON.stringify({
          nr: callNumber,
          fd: descriptor,
          bytes: captured.length,
          text: new TextDecoder().decode(new Uint8Array(captured)),
          stack: String(new Error().stack ?? "").slice(0, 4096)
        }));
      } catch {
      }
    }
    const user_instance = new WebAssembly.Instance(context2.module, {
      env: { memory: context2.memory },
      linux: {
        audio_write: createAudioWrite(context2.memory, postMessage),
        syscall: (nr, arg0, arg1, arg2, arg3, arg4, arg5) => {
          if (nr >= JIT_SYSCALL_MIN && nr <= JIT_SYSCALL_MAX)
            return jitSyscall(local_jit, context2.memory, nr, arg0, arg1, arg2, arg3);
          if (nr >= GPU_HC_MIN && nr <= GPU_HC_MAX)
            return gpuHostcallSyscall(gpu_client, context2.memory, nr, arg0, arg1, arg2, arg3, arg4, arg5);
          const original_instance = instance;
          traceAbortWrite(nr, arg0, arg1, arg2);
          const ret = kernel_instance.exports.syscall(nr, arg0, arg1, arg2, arg3, arg4, arg5);
          if (tlsAdapter && (nr === 244 || nr === 244n)) {
            let descriptorValue = null;
            try {
              const descriptor = Number(arg0);
              const buffer = firefox_start_guard_memory?.buffer;
              if (Number.isSafeInteger(descriptor) && buffer && descriptor >= 0 && descriptor + 8 <= buffer.byteLength)
                descriptorValue = new DataView(buffer).getUint32(descriptor + 4, true);
            } catch {
              descriptorValue = null;
            }
            if (descriptorValue !== null)
              threadAreaPointer = typeof arg0 === "bigint" ? BigInt(descriptorValue) : descriptorValue;
            else
              threadAreaPointer = null;
            if (!threadAreaLogged) {
              threadAreaLogged = true;
              console.warn("[FIREFOX_TLS_ADAPTER]", JSON.stringify({ nr: String(nr), descriptor: String(arg0), pointer: descriptorValue === null ? null : String(threadAreaPointer) }));
            }
          }
          if (traceSyscalls && tracedSyscalls < 128) {
            tracedSyscalls += 1;
            const marker = nr === 60 ? "exit" : nr === 231 ? "exit_group" : nr === 1 ? "write" : null;
            console.warn("[FIREFOX_SYSCALL_TRACE]", JSON.stringify({ call: tracedSyscalls, nr, args: [arg0, arg1, arg2], result: ret, marker }));
          }
          try {
            growForSyscallResult(context2, nr, arg0, arg1, arg2, ret);
          } catch (error) {
            console.debug("[user-memory-growth] syscall range unavailable", { nr, ret, error });
          }
          if (instance !== original_instance) {
            call_entry = call_start;
            throw HALT_USER;
          }
          if (local_jit !== null && local_jit.pending())
            local_jit.replay();
          return ret;
        },
        get_thread_area: (addr) => {
          const original = kernel_instance.exports.get_thread_area(addr);
          const returned = tlsAdapter && threadAreaPointer !== null ? threadAreaPointer : original;
          if (tlsAdapter && !threadAreaGetLogged) {
            threadAreaGetLogged = true;
            console.warn("[FIREFOX_TLS_ADAPTER] get_thread_area", JSON.stringify({
              addr: String(addr),
              original: String(original),
              returned: String(returned),
              returnedType: typeof returned,
              cached: threadAreaPointer !== null
            }));
          }
          return returned;
        },
        copy_siginfo: (to) => {
          const result = kernel_instance.exports.copy_siginfo(to);
          const current = siginfo_copy_results.length - 1;
          if (current >= 0)
            siginfo_copy_results[current] = result;
          return result;
        }
      }
    });
    const diagnostics2 = firefox_diagnostics_enabled();
    if (diagnostics2)
      console.error("[firefox-callback-adapter] before install");
    firefox_start_guard_snapshot(context2.memory, "after-instance");
    if (abortTrace) firefox_abort_trace_instances.add(user_instance);
    const patched = installFirefoxCallbackAdapter(context2.module, user_instance);
    if (diagnostics2)
      console.error("[firefox-callback-adapter] after install", { patched });
    if (patched) {
      console.debug(`[firefox-callback-adapter] filled ${patched} reserved indirect-table entries`);
    }
    if (jit_thread !== null) {
      jit_thread.release();
      jit_thread = null;
    }
    if (context2.jit instanceof SharedArrayBuffer) {
      local_jit = new JitThread(context2.jit, context2.memory, user_instance.exports.__indirect_function_table);
      local_jit.replay();
      jit_thread = local_jit;
    }
    return user_instance;
  }
  function instantiate(fresh_memory) {
    if (fresh_memory) {
      assert(pending);
      context = pending;
      pending = null;
    }
    assert(context);
    instance_deferred = false;
    instance = create_instance(context);
  }
  function ready_instance() {
    if (instance_deferred)
      instantiate(false);
    assert(instance);
    return instance;
  }
  return {
    get context() {
      return context;
    },
    release_jit() {
      if (jit_thread !== null) {
        jit_thread.release();
        jit_thread = null;
      }
    },
    prepare() {
      if (has_parent)
        instance_deferred = true;
    },
    imports: {
      // program management:
      compile_begin(size) {
        pending_module_bytes = null;
        pending = null;
        try {
          pending_module_bytes = new Uint8Array(size >>> 0);
          return 0;
        } catch {
          return -12;
        }
      },
      compile_write(buf, offset, size) {
        const source = buf >>> 0;
        const destination = offset >>> 0;
        const length = size >>> 0;
        const kernel_buffer = kernel_memory.buffer;
        if (!pending_module_bytes || source > kernel_buffer.byteLength - length || destination > pending_module_bytes.length - length) {
          return -22;
        }
        pending_module_bytes.set(new Uint8Array(kernel_buffer, source, length), destination);
        return 0;
      },
      compile_end(maximum_memory_pages) {
        const bytes = pending_module_bytes;
        pending_module_bytes = null;
        if (!bytes)
          return -22;
        const rlimit_pages = maximum_memory_pages >>> 0;
        let module;
        let minimum;
        let maximum;
        try {
          const memories = read_wasm_memories(bytes);
          const memory_import = memories.imports[0];
          if (memories.definitions.length !== 0 || memories.imports.length !== 1 || !memory_import || memory_import.module !== "env" || memory_import.name !== "memory" || memory_import.type.address !== "i32" || !memory_import.type.shared || memory_import.type.maximum === void 0) {
            return -8;
          }
          module = new WebAssembly.Module(bytes);
          if (!user_module_imports_supported(module)) {
            return -8;
          }
          minimum = Number(memory_import.type.minimum);
          maximum = Math.min(Number(memory_import.type.maximum), rlimit_pages);
        } catch {
          return -8;
        }
        if (maximum < minimum)
          return -12;
        let allocated;
        try {
          allocated = allocate_shared_memory(minimum, maximum);
        } catch {
          return -12;
        }
        const next_context = { module, ...allocated, jit: createJitControl() };
        pending = next_context;
        return 0;
      },
      compile_abort() {
        pending_module_bytes = null;
        pending = null;
      },
      instantiate(fresh_memory) {
        instantiate(Boolean(fresh_memory));
      },
      call() {
        for (; ; ) {
          try {
            call_entry();
          } catch (error) {
            if (error === HALT_USER)
              continue;
            if (error === HALT_KERNEL)
              throw error;
            const wasm_runtime_error = typeof WebAssembly !== "undefined" && typeof WebAssembly.RuntimeError === "function" && error instanceof WebAssembly.RuntimeError;
            if (wasm_runtime_error) {
              let exports = [];
              try {
                exports = context?.module ? WebAssembly.Module.exports(context.module).map(({ name }) => name) : [];
              } catch {
              }
              console.error("[user-module] WebAssembly runtime trap", {
                name: error?.name,
                message: error?.message,
                entry: call_entry === call_start ? "_start" : "indirect",
                exports,
                stack: error?.stack
              });
              if (firefox_abort_trace_enabled()) {
                const stack = typeof error?.stack === "string" ? error.stack : String(error);
                console.error("[FIREFOX_ABORT_TRACE] RuntimeError.stack\n" + stack.slice(0, 8192));
              }
            } else {
              console.error("[user-module] bridge exception", error);
            }
            return;
          }
        }
      },
      switch_entry(fn, arg) {
        assert(has_parent);
        call_entry = () => {
          const { __indirect_function_table } = ready_instance().exports;
          assert(__indirect_function_table instanceof WebAssembly.Table, "Invalid function table");
          call_user_table_function(__indirect_function_table.get(fn >>> 0), [arg], 1, "Invalid function signature");
          console.warn("thread entrypoint reached the end without exiting");
        };
      },
      // signal handling:
      call_signal_handler(fn, sig) {
        const { __indirect_function_table } = ready_instance().exports;
        assert(__indirect_function_table instanceof WebAssembly.Table, "Invalid function table");
        call_user_table_function(__indirect_function_table.get(fn >>> 0), [sig], 1, "Invalid function signature");
      },
      call_siginfo_handler(trampoline, fn, sig) {
        const { __indirect_function_table } = ready_instance().exports;
        assert(__indirect_function_table instanceof WebAssembly.Table, "Invalid function table");
        siginfo_copy_results.push(null);
        try {
          call_user_table_function(__indirect_function_table.get(trampoline >>> 0), [fn, sig], 2, "Invalid siginfo trampoline");
          return siginfo_copy_results.at(-1) ?? -22;
        } finally {
          try {
            get_kernel_instance().exports.clear_siginfo();
          } finally {
            siginfo_copy_results.pop();
          }
        }
      },
      // memory:
      read(to, from, n) {
        const length = n >>> 0;
        if (!context)
          return length;
        return copy_bytes(kernel_memory, to >>> 0, context.memory, from >>> 0, length);
      },
      write(to, from, n) {
        const length = n >>> 0;
        if (!context)
          return length;
        return copy_bytes(context.memory, to >>> 0, kernel_memory, from >>> 0, length, true);
      },
      write_zeroes(to, n) {
        const length = n >>> 0;
        if (!context)
          return length;
        let destination;
        try {
          destination = ensureUserDestination(context.memory, to >>> 0, length, "write_zeroes");
        } catch {
          return length;
        }
        if (!destination)
          return length;
        try {
          destination.fill(0);
          return 0;
        } catch {
          return length;
        }
      },
      futex_atomic_op(oldval, uaddr, op, oparg) {
        const word = user_atomic_word(uaddr);
        if (!word)
          return -14;
        let old;
        switch (op) {
          case 0:
            old = Atomics.exchange(word, 0, oparg);
            break;
          case 1:
            old = Atomics.add(word, 0, oparg);
            break;
          case 2:
            old = Atomics.or(word, 0, oparg);
            break;
          case 3:
            old = Atomics.and(word, 0, ~oparg);
            break;
          case 4:
            old = Atomics.xor(word, 0, oparg);
            break;
          default:
            return -38;
        }
        return write_kernel_u32(oldval, old) ? 0 : -14;
      },
      futex_atomic_cmpxchg(oldval, uaddr, expected, replacement) {
        const word = user_atomic_word(uaddr);
        if (!word)
          return -14;
        const old = Atomics.compareExchange(word, 0, expected, replacement);
        return write_kernel_u32(oldval, old) ? 0 : -14;
      }
    }
  };
}
function start({ fn, arg, vmlinux, memory, user: initial_user_context, user_copy_status, framebuffer, gpu }) {
  let retired = false;
  gpu_hub = gpu instanceof SharedArrayBuffer ? gpu : null;
  gpu_client = gpu_hub ? new GpuHostcallClient(gpu_hub, postMessage, () => instance.exports.syscall(124, 0, 0, 0, 0, 0, 0)) : null;
  let user_context = initial_user_context;
  if (user_copy_status) {
    assert(user_context);
    try {
      const source = memory_bytes(user_context.memory, 0);
      if (!source)
        throw new RangeError("invalid source memory");
      const copied = allocate_shared_memory(source.byteLength / 65536, user_context.maximum_pages);
      const destination = memory_bytes(copied.memory, 0, source.byteLength);
      if (!destination)
        throw new RangeError("invalid destination memory");
      destination.set(source);
      const jit = cloneJitControl(user_context.jit);
      user_context = { module: user_context.module, ...copied, jit };
      Atomics.store(user_copy_status, 0, 1);
    } catch {
      Atomics.store(user_copy_status, 0, -12);
    }
    Atomics.notify(user_copy_status, 0);
    if (Atomics.load(user_copy_status, 0) < 0) {
      return true;
    }
  }
  const user = user_imports({
    kernel_memory: memory,
    get_kernel_instance: () => instance,
    parent_user: user_context
  });
  const imports = {
    env: { memory },
    boot: {
      get_devicetree: unavailable,
      get_initramfs: unavailable
    },
    user: user.imports,
    kernel: kernel_imports({
      is_worker: true,
      recycle_worker: true,
      memory,
      spawn_worker(fn2, arg2, name, user2, copy_user_memory) {
        const direct = new MessageChannel();
        postMessage({
          type: "spawn_worker",
          name,
          port: direct.port1
        }, [direct.port1]);
        const user_copy_status2 = copy_user_memory ? new Int32Array(new SharedArrayBuffer(4)) : null;
        direct.port2.postMessage({
          type: "init",
          fn: fn2,
          arg: arg2,
          vmlinux,
          memory,
          user: user2,
          user_copy_status: user_copy_status2,
          framebuffer,
          gpu: gpu_hub
        });
        if (!user_copy_status2)
          return 0;
        Atomics.wait(user_copy_status2, 0, 0);
        const result = Atomics.load(user_copy_status2, 0);
        assert(result === 1 || result < 0, "copy wait completed without a result");
        return result === 1 ? 0 : result;
      },
      boot_console_write(message) {
        postMessage({ type: "boot_console_write", message });
      },
      boot_console_close() {
        postMessage({ type: "boot_console_close" });
      },
      terminate_machine(reason) {
        postMessage({ type: "terminate_machine", reason });
      },
      run_on_main(fn2, arg2) {
        postMessage({ type: "run_on_main", fn: fn2, arg: arg2 });
      },
      get_user_context() {
        return user.context;
      },
      worker_exit() {
        user.release_jit();
        gpu_client?.release();
        retired = true;
      }
    }),
    virtio: {
      set_features: unavailable,
      setup: unavailable,
      reset: unavailable,
      enable_vring: unavailable,
      disable_vring: unavailable,
      notify: unavailable,
      // Probe runs on workers and needs a synchronous config rewrite.
      config_written(dev) {
        const status = new Int32Array(new SharedArrayBuffer(4));
        postMessage({
          type: "virtio_config_written",
          dev: dev >>> 0,
          status
        });
        Atomics.wait(status, 0, 0);
      }
    },
    // get_mode must work on workers (probe runs there). present() is only
    // invoked from the main agent after run_on_main.
    fb: {
      get_mode(width_ptr, height_ptr, bpp_ptr) {
        const view = new DataView(memory.buffer);
        view.setUint32(width_ptr >>> 0, framebuffer.width, true);
        view.setUint32(height_ptr >>> 0, framebuffer.height, true);
        view.setUint32(bpp_ptr >>> 0, framebuffer.bpp, true);
      },
      present: unavailable
    }
  };
  const instance = new WebAssembly.Instance(vmlinux, imports);
  user.prepare();
  try {
    instance.exports.__indirect_function_table.get(fn >>> 0)(arg);
  } catch (error) {
    if (error === HALT_KERNEL)
      return retired;
    throw error;
  }
}
function run_task(message) {
  let reusable;
  try {
    reusable = start(message);
  } finally {
    gpu_client?.release();
    gpu_client = null;
    gpu_hub = null;
  }
  if (reusable)
    postMessage({ type: "worker_idle" });
}
channel.on_message((raw) => {
  const message = raw;
  if (message.type === "shutdown") {
    postMessage({ type: "worker_exit" });
    platform.quit();
    return;
  }
  if (message.type === "forwarded_init") {
    message.port.onmessage = ({ data }) => {
      message.port.close();
      run_task(data);
    };
    message.port.start();
    return;
  }
  run_task(message);
});
