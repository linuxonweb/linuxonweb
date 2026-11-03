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
  const emit = (state2) => report({ id, label, total, loaded, state: state2 });
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
  const keys2 = ["kernel", imageKey];
  async function completeCache() {
    for (const key of keys2) if (!await localCopy(current.assets[key], store)) return false;
    return true;
  }
  let candidate;
  try {
    candidate = await latest();
  } catch (error) {
    if (!await completeCache()) throw error;
    cacheOnlyBoot = new Set(keys2);
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
    cacheOnlyBoot = new Set(keys2);
    return true;
  }
  if (choice !== "update") return false;
  await withSystemLock(async () => {
    if (!store) throw new Error("Browser image cache is unavailable; update was not activated.");
    await Promise.all(keys2.map((key) => fetchVerified(candidate.assets[key], { requireCache: true })));
    const record = { ...snapshot(candidate), previous: snapshot(current) };
    localStorage.setItem(ACTIVE, JSON.stringify(record));
    selected = Promise.resolve(record);
    cacheOnlyBoot = new Set(keys2);
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
function unreachable(_, message = "Unreachable reached") {
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
var MachineTerminationReason = {
  Clean: 0,
  Panic: 1
};
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
var MAX_QUEUE_SECONDS = 0.25;
var validId = (n) => Number.isInteger(n) && n >= 0 && n <= 4294967295;
var validFormat = (frames, rate, channels) => Number.isInteger(frames) && frames > 0 && frames <= MAX_FRAMES && Number.isInteger(rate) && rate >= 8e3 && rate <= 96e3 && (channels === 1 || channels === 2);
function createAudioHost({ Context = globalThis.AudioContext ?? globalThis.webkitAudioContext, now = Date.now } = {}) {
  let context = null;
  let closed = false;
  const streams = /* @__PURE__ */ new Map();
  const stoppedAt = /* @__PURE__ */ new Map();
  const stats = { packets: 0, frames: 0, dropped: 0, stops: 0, peak: 0, available: !!Context };
  const stop2 = (key) => {
    const state2 = streams.get(key);
    if (!state2) return;
    for (const node2 of state2.nodes) {
      node2.onended = null;
      try {
        node2.stop();
      } catch {
      }
      node2.disconnect();
    }
    streams.delete(key);
  };
  return {
    // Call synchronously from a trusted gesture, before any await.
    resume() {
      if (closed || !Context) return;
      try {
        context ??= new Context({ latencyHint: "interactive" });
        if (context.state !== "running") void context.resume().catch(() => {
        });
      } catch {
        stats.available = false;
      }
    },
    write(message) {
      if (closed) return;
      const { pid, stream, frames, rate, channels, pcm, sentAt } = message;
      if (!validId(pid) || !pid || !validId(stream) || !stream || !Number.isFinite(sentAt)) {
        stats.dropped++;
        return;
      }
      const key = `${pid}:${stream}`;
      if (frames === 0) {
        stop2(key);
        stats.stops++;
        stoppedAt.set(key, sentAt);
        if (stoppedAt.size > 64) stoppedAt.delete(stoppedAt.keys().next().value);
        return;
      }
      if (!validFormat(frames, rate, channels) || !(pcm instanceof ArrayBuffer) || pcm.byteLength !== frames * channels * 4 || now() - sentAt > 250 || stoppedAt.has(key) || !context || context.state !== "running") {
        stats.dropped++;
        return;
      }
      let state2 = streams.get(key);
      if (!state2) {
        if (streams.size >= 16) {
          stats.dropped++;
          return;
        }
        state2 = { next: context.currentTime, nodes: /* @__PURE__ */ new Set() };
        streams.set(key, state2);
      }
      const duration = frames / rate;
      const start2 = Math.max(context.currentTime + 0.04, state2.next);
      if (start2 + duration - context.currentTime > MAX_QUEUE_SECONDS || state2.nodes.size >= 64) {
        stats.dropped++;
        return;
      }
      const buffer = context.createBuffer(channels, frames, rate);
      const source = new Float32Array(pcm);
      for (let channel = 0; channel < channels; channel++) {
        const target = buffer.getChannelData(channel);
        for (let frame = 0; frame < frames; frame++) {
          const value = source[frame * channels + channel];
          target[frame] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
          stats.peak = Math.max(stats.peak, Math.abs(target[frame]));
        }
      }
      const node2 = context.createBufferSource();
      node2.buffer = buffer;
      node2.connect(context.destination);
      state2.nodes.add(node2);
      node2.onended = () => {
        node2.disconnect();
        state2.nodes.delete(node2);
        if (!state2.nodes.size && streams.get(key) === state2) streams.delete(key);
      };
      node2.start(start2);
      state2.next = start2 + duration;
      stats.packets++;
      stats.frames += frames;
    },
    get stats() {
      return { ...stats, state: closed ? "closed" : context?.state ?? "idle", streams: streams.size };
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const key of streams.keys()) stop2(key);
      stoppedAt.clear();
      if (context && context.state !== "closed") await context.close().catch(() => {
      });
      context = null;
    }
  };
}

// web/linux/dist/bytes.js
var utf8 = new TextDecoder("utf-8", { fatal: true });
function Struct(layout) {
  let size = 0;
  return class {
    #dv;
    constructor(view) {
      this.#dv = new DataView(view.buffer, view.byteOffset, view.byteLength);
    }
    static {
      for (const [key, type2] of Object.entries(layout)) {
        const offset = size;
        Object.defineProperty(this.prototype, key, {
          get() {
            return type2.get(this.#dv, offset);
          },
          set(value) {
            type2.set(this.#dv, offset, value);
          }
        });
        size += type2.size;
      }
    }
    static get(dv, offset) {
      if (offset !== 0)
        dv = new DataView(dv.buffer, dv.byteOffset + offset);
      return new this(dv);
    }
    static set(dv, offset, value) {
      if (offset !== 0)
        dv = new DataView(dv.buffer, dv.byteOffset + offset);
      Object.assign(new this(dv), value);
    }
    static size = size;
    toJSON() {
      const obj = {};
      for (const key in layout) {
        obj[key] = this[key];
      }
      return obj;
    }
  };
}
function FixedArray(type2, length) {
  assert(Number.isInteger(length) && length > 0);
  return {
    get(dv, offset) {
      const arr = Array(length);
      for (let i = 0; i < length; i++) {
        const element_offset = offset + type2.size * i;
        let value = type2.get(dv, element_offset);
        Object.defineProperty(arr, i, {
          enumerable: true,
          get: () => value,
          set: (next) => {
            type2.set(dv, element_offset, next);
            value = type2.get(dv, element_offset);
          }
        });
      }
      Object.freeze(arr);
      return arr;
    },
    set(dv, offset, value) {
      for (let i = 0; i < length; i++) {
        type2.set(dv, offset + type2.size * i, value[i]);
      }
    },
    size: type2.size * length
  };
}
var U8 = {
  get(dv, offset) {
    return dv.getUint8(offset);
  },
  set(dv, offset, value) {
    dv.setUint8(offset, value);
  },
  size: 1
};
var U16LE = {
  get(dv, offset) {
    return dv.getUint16(offset, true);
  },
  set(dv, offset, value) {
    dv.setUint16(offset, value, true);
  },
  size: 2
};
var U32LE = {
  get(dv, offset) {
    return dv.getUint32(offset, true);
  },
  set(dv, offset, value) {
    dv.setUint32(offset, value, true);
  },
  size: 4
};
var I32LE = {
  get(dv, offset) {
    return dv.getInt32(offset, true);
  },
  set(dv, offset, value) {
    dv.setInt32(offset, value, true);
  },
  size: 4
};
var U64LE = {
  get(dv, offset) {
    return dv.getBigUint64(offset, true);
  },
  set(dv, offset, value) {
    dv.setBigUint64(offset, value, true);
  },
  size: 8
};
var U16BE = {
  get(dv, offset) {
    return dv.getUint16(offset, false);
  },
  set(dv, offset, value) {
    dv.setUint16(offset, value, false);
  },
  size: 2
};
var U32BE = {
  get(dv, offset) {
    return dv.getUint32(offset, false);
  },
  set(dv, offset, value) {
    dv.setUint32(offset, value, false);
  },
  size: 4
};
var U64BE = {
  get(dv, offset) {
    return dv.getBigUint64(offset, false);
  },
  set(dv, offset, value) {
    dv.setBigUint64(offset, value, false);
  },
  size: 8
};
var Reader = class {
  #array;
  #dv;
  /** The number of bytes consumed so far. */
  offset = 0;
  constructor(array) {
    this.#array = array;
    this.#dv = new DataView(array.buffer, array.byteOffset, array.byteLength);
  }
  #take(length) {
    if (length < 0 || this.offset + length > this.#array.byteLength) {
      throw new RangeError("read past the end of the buffer");
    }
    const offset = this.offset;
    this.offset += length;
    return offset;
  }
  u8() {
    return this.#dv.getUint8(this.#take(1));
  }
  u16() {
    return this.#dv.getUint16(this.#take(2), true);
  }
  u32() {
    return this.#dv.getUint32(this.#take(4), true);
  }
  i32() {
    return this.#dv.getInt32(this.#take(4), true);
  }
  u64() {
    return this.#dv.getBigUint64(this.#take(8), true);
  }
  i64() {
    return this.#dv.getBigInt64(this.#take(8), true);
  }
  skip(length) {
    this.#take(length);
  }
  bytes(length) {
    const offset = this.#take(length);
    return this.#array.subarray(offset, offset + length);
  }
  /** Reads a `Type` at the current position and advances past it. */
  struct(type2) {
    return type2.get(this.#dv, this.#take(type2.size));
  }
  /** Reads a NUL-terminated UTF-8 string, consuming the terminator. */
  cstring() {
    const end = this.#array.indexOf(0, this.offset);
    if (end < 0)
      throw new RangeError("unterminated string");
    const bytes = this.bytes(end - this.offset);
    this.skip(1);
    try {
      return utf8.decode(bytes);
    } catch {
      throw new RangeError("string is not valid UTF-8");
    }
  }
};
var Bytes = class {
  #array;
  length = 0;
  get capacity() {
    return this.#array.length;
  }
  get array() {
    return this.#array.slice(0, this.length);
  }
  constructor(capacity = 32) {
    this.#array = new Uint8Array(capacity);
  }
  #ensure_capacity(capacity) {
    if (this.#array.length < capacity) {
      let length = this.#array.length;
      while (length < capacity)
        length *= 2;
      const next = new Uint8Array(length);
      next.set(this.#array);
      this.#array = next;
      this.#dv = void 0;
    }
  }
  bump(length) {
    const offset = this.length;
    this.#ensure_capacity(this.length + length);
    this.length += length;
    return offset;
  }
  append(bytes) {
    const offset = this.bump(bytes.length);
    this.#array.set(bytes, offset);
  }
  #dv;
  get dv() {
    return this.#dv ??= new DataView(this.#array.buffer);
  }
  alloc(type2) {
    const offset = this.bump(type2.size);
    const self2 = this;
    return {
      get value() {
        return type2.get(self2.dv, offset);
      },
      set value(value) {
        type2.set(self2.dv, offset, value);
      }
    };
  }
};

// web/linux/dist/devicetree.js
var FDT_MAGIC = 3490578157;
var FDT_BEGIN_NODE = 1;
var FDT_END_NODE = 2;
var FDT_PROP = 3;
var FDT_END = 9;
var NODE_NAME_MAX_LEN = 31;
var PROPERTY_NAME_MAX_LEN = 31;
var FdtHeader = Struct({
  magic: U32BE,
  totalsize: U32BE,
  off_dt_struct: U32BE,
  off_dt_strings: U32BE,
  off_mem_rsvmap: U32BE,
  version: U32BE,
  last_comp_version: U32BE,
  boot_cpuid_phys: U32BE,
  size_dt_strings: U32BE,
  size_dt_struct: U32BE
});
var FdtReserveEntry = Struct({
  address: U64BE,
  size: U64BE
});
var Property = Struct({
  len: U32BE,
  nameoff: U32BE
});
function align(bytes, alignment) {
  const offset = bytes.length % alignment;
  if (offset !== 0) {
    for (let j = 0; j < alignment - offset; j++)
      bytes.alloc(U8);
  }
}
function generate_devicetree(tree, { memory_reservations = [], boot_cpu_id = 0 } = {}) {
  const bytes = new Bytes(1024);
  const strings = {};
  const header = bytes.alloc(FdtHeader);
  function walk_tree(node2, name) {
    align(bytes, 4);
    bytes.alloc(U32BE).value = FDT_BEGIN_NODE;
    const encodedName = new TextEncoder().encode(name);
    assert(encodedName.byteLength <= NODE_NAME_MAX_LEN, `property name too long: ${name}`);
    bytes.append(encodedName);
    bytes.alloc(U8).value = 0;
    align(bytes, 4);
    const children = Object.entries(node2).filter(([, value]) => typeof value === "object" && value?.constructor === Object);
    const properties = Object.entries(node2).filter(([, value]) => !(typeof value === "object" && value?.constructor === Object));
    for (const [name2, prop] of properties) {
      align(bytes, 4);
      bytes.alloc(U32BE).value = FDT_PROP;
      const property = bytes.alloc(Property);
      assert(new TextEncoder().encode(name2).byteLength <= PROPERTY_NAME_MAX_LEN, `property name too long: ${name2}`);
      (strings[name2] ??= []).push(property);
      let value;
      switch (typeof prop) {
        case "number":
          value = new Uint32Array(1).buffer;
          new DataView(value).setUint32(0, prop);
          break;
        case "bigint":
          value = new BigUint64Array(1).buffer;
          new DataView(value).setBigUint64(0, prop);
          break;
        case "string":
          value = new TextEncoder().encode(`${prop}\0`).buffer;
          break;
        case "object":
          if (prop instanceof Uint8Array || prop instanceof Uint16Array || prop instanceof Uint32Array || prop instanceof BigUint64Array) {
            value = prop.buffer;
          } else if (prop instanceof ArrayBuffer) {
            value = prop;
          } else {
            value = new Uint32Array(prop.length).buffer;
            const dv = new DataView(value);
            for (const [i, n] of prop.entries()) {
              dv.setUint32(i * 4, n);
            }
          }
          break;
        case "undefined":
          value = new Uint8Array().buffer;
          break;
        default:
          unreachable(prop, `unsupported prop type: ${typeof prop}`);
      }
      property.value.len = value.byteLength;
      bytes.append(new Uint8Array(value));
      align(bytes, 4);
    }
    for (const [name2, child] of children)
      walk_tree(child, name2);
    align(bytes, 4);
    bytes.alloc(U32BE).value = FDT_END_NODE;
  }
  Object.assign(header.value, {
    magic: FDT_MAGIC,
    version: 17,
    last_comp_version: 16,
    boot_cpuid_phys: boot_cpu_id
  });
  align(bytes, 8);
  header.value.off_mem_rsvmap = bytes.length;
  for (const { address, size } of memory_reservations) {
    bytes.alloc(FdtReserveEntry).value = {
      address: BigInt(address),
      size: BigInt(size)
    };
  }
  bytes.alloc(FdtReserveEntry).value = { address: 0n, size: 0n };
  const begin_dt_struct = bytes.length;
  header.value.off_dt_struct = begin_dt_struct;
  walk_tree(tree, "");
  bytes.alloc(U32BE).value = FDT_END;
  header.value.size_dt_struct = bytes.length - begin_dt_struct;
  const begin_dt_strings = bytes.length;
  header.value.off_dt_strings = begin_dt_strings;
  for (const [str, refs] of Object.entries(strings)) {
    const offset = bytes.length;
    bytes.append(new TextEncoder().encode(str));
    bytes.alloc(U8).value = 0;
    for (const ref of refs)
      ref.value.nameoff = offset - begin_dt_strings;
  }
  header.value.size_dt_strings = bytes.length - begin_dt_strings;
  header.value.totalsize = bytes.length;
  return bytes.array;
}

// web/linux/dist/worker-pool.mjs
function createWorkerPool({ capacity, load, retire }) {
  if (!Number.isInteger(capacity) || capacity < 1)
    throw new RangeError("Invalid worker pool capacity");
  const idle = [];
  const active = /* @__PURE__ */ new Set();
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
      while (entry = idle.shift()) {
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
    close() {
      closed = true;
      idle.length = 0;
    }
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
  const type2 = bytes.byte();
  if (type2 === 99 || type2 === 100) {
    bytes.signed33(bytes.byte());
  } else if (type2 < 105 || type2 > 116) {
    bytes.fail("invalid reference type");
  }
}
function skip_value_type(bytes) {
  const type2 = bytes.byte();
  if (type2 >= 123 && type2 <= 127)
    return;
  if (type2 === 99 || type2 === 100) {
    bytes.signed33(bytes.byte());
  } else if (type2 < 105 || type2 > 116) {
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

// web/linux/dist/virtio/core.js
var TransportFeatures = {
  VERSION_1: 1n << 32n,
  RING_PACKED: 1n << 34n,
  INDIRECT_DESC: 1n << 28n
};
var DescriptorFlags = {
  NEXT: 1 << 0,
  WRITE: 1 << 1,
  INDIRECT: 1 << 2,
  AVAIL: 1 << 7,
  USED: 1 << 15
};
var VirtqDescriptor = class extends Struct({
  addr: U64LE,
  len: U32LE,
  id: U16LE,
  flags: U16LE
}) {
};
var Chain = class {
  #memory;
  #desc;
  #release;
  constructor(memory, desc, release) {
    this.#memory = memory;
    this.#desc = desc;
    this.#release = release;
  }
  release(written) {
    this.#release(written);
  }
  *[Symbol.iterator]() {
    for (const desc of this.#desc) {
      yield {
        array: new Uint8Array(this.#memory.buffer, Number(desc.addr), desc.len),
        writable: (desc.flags & DescriptorFlags.WRITE) !== 0
      };
    }
  }
};
var PackedVirtqueue = class {
  #memory;
  #size;
  #desc_addr;
  #on_release;
  #avail_wrap = true;
  #used_wrap = true;
  #used_idx = 0;
  #avail_idx = 0;
  #valid = true;
  constructor(memory, size, desc_addr, on_release) {
    assert(size !== 0);
    this.#memory = memory;
    this.#size = size;
    this.#desc_addr = desc_addr;
    this.#on_release = on_release;
  }
  invalidate() {
    this.#valid = false;
  }
  #descriptor(index) {
    const desc = VirtqDescriptor.get(new DataView(this.#memory.buffer), this.#desc_addr + VirtqDescriptor.size * index);
    return {
      addr: desc.addr,
      len: desc.len,
      id: desc.id,
      flags: desc.flags
    };
  }
  #indirect_descriptors(address, count) {
    const descriptors = [];
    for (let i = 0; i < count; i++) {
      const desc = VirtqDescriptor.get(new DataView(this.#memory.buffer), address + VirtqDescriptor.size * i);
      descriptors.push({
        addr: desc.addr,
        len: desc.len,
        id: desc.id,
        flags: desc.flags
      });
    }
    return descriptors;
  }
  #pop() {
    let i = this.#advance();
    if (i === null)
      return null;
    let desc = this.#descriptor(i);
    const id = desc.id;
    let skip = 1;
    let chain_desc = [desc];
    if (desc.flags & DescriptorFlags.NEXT) {
      do {
        i = this.#advance();
        if (i === null)
          throw new Error("no next descriptor is available");
        desc = this.#descriptor(i);
        chain_desc.push(desc);
        skip += 1;
      } while (desc.flags & DescriptorFlags.NEXT);
    } else if (desc.flags & DescriptorFlags.INDIRECT) {
      if (desc.len % VirtqDescriptor.size !== 0) {
        throw new Error("malformed indirect buffer");
      }
      chain_desc = this.#indirect_descriptors(Number(desc.addr), desc.len / VirtqDescriptor.size);
    }
    return new Chain(this.#memory, chain_desc, (written) => this.#release(id, skip, written));
  }
  *[Symbol.iterator]() {
    let chain;
    while (this.#valid && (chain = this.#pop()))
      yield chain;
  }
  #advance() {
    const desc = this.#descriptor(this.#avail_idx);
    const avail = (desc.flags & DescriptorFlags.AVAIL) !== 0;
    const used = (desc.flags & DescriptorFlags.USED) !== 0;
    if (avail === used || avail !== this.#avail_wrap)
      return null;
    const index = this.#avail_idx;
    this.#avail_idx += 1;
    if (this.#avail_idx >= this.#size) {
      this.#avail_idx = 0;
      this.#avail_wrap = !this.#avail_wrap;
    }
    return index;
  }
  #release(id, skip, written) {
    if (!this.#valid)
      return;
    const desc = VirtqDescriptor.get(new DataView(this.#memory.buffer), this.#desc_addr + VirtqDescriptor.size * this.#used_idx);
    const avail = (desc.flags & DescriptorFlags.AVAIL) !== 0;
    const used = (desc.flags & DescriptorFlags.USED) !== 0;
    if (avail === used || avail !== this.#used_wrap) {
      throw new Error("ring full");
    }
    let flags = 0;
    if (this.#used_wrap)
      flags |= DescriptorFlags.AVAIL | DescriptorFlags.USED;
    if (written > 0)
      flags |= DescriptorFlags.WRITE;
    desc.id = id;
    desc.len = written;
    desc.flags = flags;
    this.#used_idx += skip;
    if (this.#used_idx >= this.#size) {
      this.#used_idx -= this.#size;
      this.#used_wrap = !this.#used_wrap;
    }
    this.#on_release();
  }
};
var transport_device = /* @__PURE__ */ Symbol("virtio transport device");
var VirtioController = class {
  /** The attachable device. */
  device;
  /** Pushes a new configuration to the guest and raises a config-change interrupt. */
  updateConfig;
  /** Idempotently starts closing the device. */
  close;
  /** Merges extra methods into the public device object; callable once. */
  expose;
  /** Creates a virtio device backed by `driver`. */
  constructor(options, driver) {
    const config = options.config?.slice() ?? new Uint8Array();
    let get_guest_config;
    let raise_config;
    let config_pending = false;
    let closed = false;
    let close_promise;
    const active = /* @__PURE__ */ new Set();
    let exposed = false;
    const start_close = () => {
      if (close_promise)
        return close_promise;
      closed = true;
      close_promise = (async () => {
        let failure;
        try {
          driver.stop?.();
        } catch (reason) {
          failure = { status: "rejected", reason };
        }
        const results = await Promise.allSettled(active);
        failure ??= results.find((result) => result.status === "rejected");
        try {
          await driver.close?.(this);
        } catch (reason) {
          failure ??= { status: "rejected", reason };
        }
        if (failure)
          throw failure.reason;
      })();
      void close_promise.catch(() => {
      });
      return close_promise;
    };
    const endpoint = {
      device_id: options.deviceId,
      features: TransportFeatures.VERSION_1 | TransportFeatures.RING_PACKED | TransportFeatures.INDIRECT_DESC | (options.features ?? 0n),
      config,
      attach: (next_get_config, next_raise_config) => {
        assert(!closed, "cannot attach a closed virtio device");
        assert(!get_guest_config, "virtio device is already attached");
        next_get_config().set(config);
        get_guest_config = next_get_config;
        raise_config = next_raise_config;
        if (config_pending) {
          config_pending = false;
          raise_config();
        }
      },
      notify: (vq, queue) => {
        if (closed)
          return;
        const handler = driver.queues[vq];
        assert(handler, `virtio device has no queue ${vq}`);
        const completion = Promise.withResolvers();
        active.add(completion.promise);
        try {
          Promise.resolve(handler(queue, this)).then(completion.resolve, completion.reject);
        } catch (error) {
          completion.reject(error);
        }
        void completion.promise.finally(() => active.delete(completion.promise)).catch(() => {
        });
        return completion.promise;
      },
      config_written: () => {
        if (closed || !driver.configWritten)
          return;
        const guest = get_guest_config?.();
        if (guest)
          driver.configWritten(guest);
      },
      reset: () => {
        if (!closed)
          driver.reset?.();
      },
      close: start_close
    };
    const device = {};
    Object.defineProperty(device, transport_device, { value: endpoint });
    this.device = device;
    this.updateConfig = (next_config) => {
      assert(next_config.byteLength === config.byteLength, "virtio config size cannot change");
      config.set(next_config);
      get_guest_config?.().set(config);
      if (closed)
        return;
      if (raise_config)
        raise_config();
      else
        config_pending = true;
    };
    this.close = () => void start_close();
    this.expose = (api) => {
      assert(!exposed, "virtio device API is already exposed");
      exposed = true;
      Object.defineProperties(device, Object.getOwnPropertyDescriptors(api));
      return device;
    };
  }
};
function virtio_device_description(device) {
  const transport = device[transport_device];
  return {
    device_id: transport.device_id,
    features: transport.features,
    config: transport.config
  };
}
function close_virtio_device(device) {
  return device[transport_device].close();
}
function virtio_imports({ memory, devices, trigger_irq, on_error }) {
  const states = devices.map((device) => ({
    device: device[transport_device],
    queues: []
  }));
  function queue_state(device, vq) {
    return device.queues[vq] ??= {
      queue: void 0,
      pending: false,
      notifying: false
    };
  }
  const drain_notifications = async (device, vq) => {
    const state2 = queue_state(device, vq);
    if (state2.notifying || !state2.queue)
      return;
    state2.notifying = true;
    try {
      do {
        state2.pending = false;
        await device.device.notify(vq, state2.queue);
      } while (state2.pending && state2.queue);
    } catch (error) {
      on_error(error);
    } finally {
      state2.notifying = false;
    }
  };
  return {
    set_features(dev, features) {
      const device = states[dev]?.device;
      assert(device);
      assert(device.features === features, "the kernel should accept every feature we offer, and no more");
    },
    enable_vring(dev, vq, size, desc_addr, irq) {
      const device = states[dev];
      assert(device);
      const state2 = queue_state(device, vq);
      state2.queue?.invalidate();
      let armed = false;
      const queue = new PackedVirtqueue(memory, size, desc_addr >>> 0, () => {
        if (armed)
          return;
        armed = true;
        queueMicrotask(() => {
          armed = false;
          if (state2.queue === queue)
            trigger_irq(irq);
        });
      });
      state2.queue = queue;
      if (state2.pending)
        void drain_notifications(device, vq);
    },
    disable_vring(dev, vq) {
      const device = states[dev];
      assert(device);
      const state2 = device.queues[vq];
      state2?.queue?.invalidate();
      if (!state2)
        return;
      state2.queue = void 0;
      state2.pending = false;
    },
    reset(dev) {
      const device = states[dev];
      assert(device);
      for (const state2 of device.queues) {
        if (!state2)
          continue;
        state2.queue?.invalidate();
        state2.queue = void 0;
        state2.pending = false;
      }
      device.device.reset();
    },
    setup(dev, config_irq, config_addr, config_len) {
      const address = config_addr >>> 0;
      const length = config_len >>> 0;
      const device = states[dev]?.device;
      assert(device);
      assert(length >= device.config.byteLength, "config space too small");
      device.attach(() => new Uint8Array(memory.buffer, address, length), () => trigger_irq(config_irq));
    },
    notify(dev, vq) {
      const device = states[dev];
      assert(device);
      queue_state(device, vq).pending = true;
      void drain_notifications(device, vq);
    },
    config_written(dev) {
      const device = states[dev]?.device;
      assert(device);
      device.config_written();
    }
  };
}

// web/linux/dist/framebuffer-presenter.js
function surface(width, height) {
  if (globalThis.OffscreenCanvas) return new OffscreenCanvas(width, height);
  const canvas = globalThis.document?.createElement("canvas");
  if (!canvas) throw new Error("GPU canvas unavailable");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
function createWebGLPresenter(width, height, onLost) {
  const canvas = surface(width, height);
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false
  });
  if (!gl) throw new Error("WebGL unavailable");
  const shaders = [];
  let program, buffer, texture;
  let closed = false;
  const lose = (event) => {
    event.preventDefault();
    if (!closed) onLost("WebGL context lost");
  };
  const close = () => {
    closed = true;
    canvas.removeEventListener?.("webglcontextlost", lose);
    if (texture) gl.deleteTexture(texture);
    if (buffer) gl.deleteBuffer(buffer);
    if (program) gl.deleteProgram(program);
    for (const shader of shaders) gl.deleteShader(shader);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
  try {
    const compile = (type2, source) => {
      const shader = gl.createShader(type2);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) || "shader compilation failed");
      return shader;
    };
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, `
            attribute vec2 position; varying vec2 uv;
            void main() { gl_Position=vec4(position,0.,1.);
                uv=vec2((position.x+1.)*.5,(1.-position.y)*.5); }`));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `
            precision highp float; varying vec2 uv; uniform sampler2D pixels;
            void main() { gl_FragColor=vec4(texture2D(pixels,uv).bgr,1.); }`));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) || "shader linking failed");
    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 3, 3, -1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.uniform1i(gl.getUniformLocation(program, "pixels"), 0);
    gl.disable(gl.DITHER);
    gl.viewport(0, 0, width, height);
    if (gl.getError() !== gl.NO_ERROR) throw new Error("WebGL initialization failed");
    canvas.addEventListener?.("webglcontextlost", lose);
    return {
      backend: "webgl",
      canvas,
      // Upload only rows [from, to) (whole rows: WebGL 1 has no UNPACK_ROW_LENGTH);
      // the texture keeps the other rows.
      draw(bytes, from = 0, to = height) {
        if (closed || gl.isContextLost()) throw new Error("WebGL context lost");
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          from,
          width,
          to - from,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          bytes.subarray(from * width * 4, to * width * 4)
        );
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return canvas;
      },
      close
    };
  } catch (error) {
    close();
    throw error;
  }
}
var MAX_HOLES = 4;
var holeTest = (k) => `
                if (hole[${k}].key.w == 1u && all(c == hole[${k}].key.xyz)) {
                    let q = p - hole[${k}].rect.xy;
                    if (all(q >= vec2i(0)) && all(q < hole[${k}].rect.zw)) { out = vec4f(0.); }
                }`;
async function createWebGPUPresenter(width, height, onLost) {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) throw new Error("WebGPU unavailable");
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error("WebGPU adapter unavailable");
  const device = await adapter.requestDevice();
  let context, texture, closed = false;
  const uniforms = new Int32Array(MAX_HOLES * 8);
  let uniformBuffer;
  const close = () => {
    if (closed) return;
    closed = true;
    texture?.destroy();
    uniformBuffer?.destroy();
    context?.unconfigure();
    device.destroy();
  };
  try {
    const canvas = surface(width, height);
    context = canvas.getContext("webgpu");
    if (!context) throw new Error("WebGPU canvas unavailable");
    const format = gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });
    const shader = device.createShaderModule({ code: `
            struct Vertex { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
            @vertex fn vertex(@builtin(vertex_index) i:u32)->Vertex {
                let p=array<vec2f,3>(vec2f(-1.,-1.),vec2f(-1.,3.),vec2f(3.,-1.))[i];
                var o:Vertex; o.pos=vec4f(p,0.,1.); o.uv=vec2f((p.x+1.)*.5,(1.-p.y)*.5); return o;
            }
            @group(0) @binding(0) var pixels:texture_2d<f32>;
            struct Hole { key: vec4u, rect: vec4i }
            @group(0) @binding(1) var<uniform> hole: array<Hole, ${MAX_HOLES}>;
            @fragment fn fragment(v:Vertex)->@location(0) vec4f {
                let p=vec2i(v.uv*vec2f(textureDimensions(pixels)));
                let t=textureLoad(pixels,p,0);
                let c=vec3u(round(t.bgr*255.));
                var out=vec4f(t.bgr,1.);${Array.from({ length: MAX_HOLES }, (_, k) => holeTest(k)).join("")}
                return out;
            }` });
    const pipeline = await device.createRenderPipelineAsync({
      layout: "auto",
      vertex: { module: shader, entryPoint: "vertex" },
      fragment: { module: shader, entryPoint: "fragment", targets: [{ format }] },
      primitive: { topology: "triangle-list" }
    });
    texture = device.createTexture({
      size: [width, height],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    uniformBuffer = device.createBuffer({ size: uniforms.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: texture.createView() },
      { binding: 1, resource: { buffer: uniformBuffer } }
    ] });
    device.lost.then((info) => {
      if (!closed) onLost(`WebGPU device lost: ${info.reason}`);
    });
    device.addEventListener("uncapturederror", (event) => {
      event.preventDefault();
      if (!closed) onLost(`WebGPU error: ${event.error.message}`);
    });
    return {
      backend: "webgpu",
      canvas,
      fallbackAdapter: adapter.info?.isFallbackAdapter ?? null,
      /** Holes for the next draws: up to MAX_HOLES {key: 0xRRGGBB, x, y, width, height}. */
      setHoles(holes) {
        if (closed) throw new Error("WebGPU presenter closed");
        uniforms.fill(0);
        holes.slice(0, MAX_HOLES).forEach((h, k) => uniforms.set([
          h.key >> 16 & 255,
          h.key >> 8 & 255,
          h.key & 255,
          1,
          h.x,
          h.y,
          h.width,
          h.height
        ], k * 8));
        device.queue.writeBuffer(uniformBuffer, 0, uniforms);
      },
      // Upload only the changed rectangle; the texture keeps the rest.
      // upload false: only the holes changed, the framebuffer texture is current.
      draw(bytes, from = 0, to = height, x0 = 0, x1 = width, upload = true) {
        if (closed) throw new Error("WebGPU presenter closed");
        if (upload) device.queue.writeTexture(
          { texture, origin: [x0, from] },
          bytes,
          { offset: (from * width + x0) * 4, bytesPerRow: width * 4 },
          [x1 - x0, to - from]
        );
        const encoder2 = device.createCommandEncoder();
        const pass = encoder2.beginRenderPass({ colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0, g: 0, b: 0, a: 0 }
        }] });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder2.finish()]);
        return canvas.transferToImageBitmap ? canvas.transferToImageBitmap() : canvas;
      },
      close
    };
  } catch (error) {
    close();
    throw error;
  }
}

// web/linux/dist/framebuffer.js
function swizzle_bgra_to_rgba(dst, src, width, height, stride) {
  const pixels = width * height;
  if (dst.byteOffset % 4 || src.byteOffset % 4 || stride % 4) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const s = y * stride + x * 4, d = (y * width + x) * 4;
        dst[d] = src[s + 2];
        dst[d + 1] = src[s + 1];
        dst[d + 2] = src[s];
        dst[d + 3] = 255;
      }
    }
    return;
  }
  const dst32 = new Uint32Array(dst.buffer, dst.byteOffset, pixels);
  if (stride === width * 4 && src.byteOffset % 4 === 0) {
    const src32 = new Uint32Array(src.buffer, src.byteOffset, pixels);
    for (let i = 0; i < pixels; i++) {
      const p = src32[i];
      dst32[i] = p & 4278255360 | (p & 255) << 16 | (p & 16711680) >> 16 | 4278190080;
    }
    return;
  }
  for (let y = 0; y < height; y++) {
    const row_offset = src.byteOffset + y * stride;
    const row = new Uint32Array(src.buffer, row_offset, width);
    const dst_row = y * width;
    for (let x = 0; x < width; x++) {
      const p = row[x];
      dst32[dst_row + x] = p & 4278255360 | (p & 255) << 16 | (p & 16711680) >> 16 | 4278190080;
    }
  }
}
var FBDIFF_WASM = "AGFzbQEAAAABCgFgBX9/f39/AX8CEQEDZW52BWd1ZXN0AgMBgIAEAwIBAAUDAQAABhUEfwFBAAt/AUEAC38BQQALfwFBAAsHMAYHc3RhZ2luZwIBA3RvcAMABmJvdHRvbQMBBGxlZnQDAgVyaWdodAMDBGRpZmYAAAr8AQH5AQEFf0F/JABBACQBIAIkAkEAJAMCQANAIAUgA08NASAAIAUgAWxqIQYgBSACbCEHQQAhCCACQRBrIQkCQCAERQRAAkADQCAIIAJPDQMgBiAIav0ABAAgByAIav0ARAEA/VH9Uw0BIAhBEGohCAwACwsCQANAIAYgCWr9AAQAIAcgCWr9AEQBAP1R/VMNASAJIAhNDQEgCUEQayEJDAALCwsgByAIaiAGIAhqIAlBEGogCGv8CgEAIwBBAEgEQCAFJAALIAVBAWokASAIIwJJBEAgCCQCCyAJQRBqIwNLBEAgCUEQaiQDCwsgBUEBaiEFDAALCyMAQQBOCw==";
var fbdiffModule;
function fbdiff(memory) {
  if (fbdiffModule === void 0) {
    try {
      fbdiffModule = new WebAssembly.Module(Uint8Array.from(atob(FBDIFF_WASM), (c) => c.charCodeAt(0)));
    } catch {
      fbdiffModule = null;
    }
  }
  if (!fbdiffModule) return null;
  try {
    return new WebAssembly.Instance(fbdiffModule, { env: { guest: memory } }).exports;
  } catch {
    return null;
  }
}
function createFramebufferHost(memory, options) {
  const width = options.width ?? 1024;
  const height = options.height ?? 768;
  const bpp = options.bpp ?? 32;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
    throw new Error("invalid framebuffer dimensions");
  if (bpp !== 32)
    throw new Error("framebuffer only supports 32bpp");
  const canvas = options.canvas;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx)
    throw new Error("canvas 2d context unavailable");
  let image = null;
  let closed = false;
  let raf = 0;
  let dirty = false;
  let source = null;
  let staging = null;
  const rowBytes = width * 4;
  let top = 0, bottom = 0, left = 0, right = 0;
  const fast = rowBytes % 16 === 0 ? fbdiff(memory) : null;
  const mark = (t, b, l, r) => {
    top = Math.min(top, t);
    bottom = Math.max(bottom, b);
    left = Math.min(left, l);
    right = Math.max(right, r);
  };
  let ptop = height, pbottom = 0, pleft = width, pright = 0;
  const markPaint = (x, y, w, h) => {
    const x0 = Math.max(0, x), y0 = Math.max(0, y), x1 = Math.min(width, x + w), y1 = Math.min(height, y + h);
    if (x0 >= x1 || y0 >= y1) return;
    ptop = Math.min(ptop, y0);
    pbottom = Math.max(pbottom, y1);
    pleft = Math.min(pleft, x0);
    pright = Math.max(pright, x1);
  };
  const overlays = /* @__PURE__ */ new Map();
  const stage = canvas.parentElement ?? null;
  let overlaySupport = false, holesChanged = false, holeCount = 0;
  let renderer = null;
  let generation = 0;
  const backends = ["auto", "webgpu", "webgl", "canvas2d"];
  const webgpuTimeoutMs = options.webgpuTimeoutMs ?? 1e4;
  const diagnostics2 = {
    backend: "canvas2d",
    requested: options.backend ?? "canvas2d",
    frames: 0,
    presents: 0,
    coalesced: 0,
    unchanged: 0,
    overlayFrames: 0,
    overlayDropped: 0,
    overlays: 0,
    fallbackReason: null,
    fallbackAdapter: null,
    failure: null,
    awaitingChoice: false,
    diff: fast ? "simd" : "js"
  };
  if (!backends.includes(diagnostics2.requested))
    throw new Error("unknown framebuffer backend");
  const message = (error) => String(error?.message ?? error);
  const setBackend = (backend) => {
    if (!backends.includes(backend)) throw new Error("unknown framebuffer backend");
    if (closed) return Promise.resolve();
    diagnostics2.requested = backend;
    return select(backend);
  };
  const publish = () => {
    const support = !!renderer?.setHoles && !!stage && !!globalThis.document;
    if (support !== overlaySupport) {
      overlaySupport = support;
      if (support) {
        stage.style.isolation = "isolate";
        canvas.style.background = "transparent";
      }
      options.onOverlaySupport?.(support);
    }
    if (canvas.dataset) canvas.dataset.framebufferBackend = diagnostics2.backend;
    if (canvas.dispatchEvent && globalThis.CustomEvent)
      canvas.dispatchEvent(new CustomEvent("framebuffer-backend", { detail: { ...diagnostics2, setBackend } }));
  };
  const dropOverlay = (key) => {
    const o = overlays.get(key);
    if (!o) return;
    o.pending?.close();
    o.element?.remove();
    overlays.delete(key);
    diagnostics2.overlays = overlays.size;
    if (o.rect) {
      markPaint(...o.rect);
      holesChanged = true;
      dirty = true;
      schedule_paint();
    }
  };
  const applyOverlays = () => {
    for (const o of overlays.values()) {
      if (!o.pending) continue;
      const bitmap = o.pending, rect = [o.x, o.y, bitmap.width, bitmap.height];
      o.pending = null;
      if (!o.element) {
        o.element = document.createElement("canvas");
        o.element.className = "gl-keyed-surface";
        Object.assign(o.element.style, { position: "absolute", zIndex: "-1", pointerEvents: "none", imageRendering: "pixelated" });
        stage.prepend(o.element);
        o.context = o.element.getContext("bitmaprenderer");
      }
      if (o.element.width !== bitmap.width) o.element.width = bitmap.width;
      if (o.element.height !== bitmap.height) o.element.height = bitmap.height;
      o.context.transferFromImageBitmap(bitmap);
      diagnostics2.overlayFrames++;
      if (o.rect && o.rect.every((v, k) => v === rect[k])) continue;
      if (o.rect) markPaint(...o.rect);
      markPaint(...rect);
      o.rect = rect;
      place(o);
      holesChanged = true;
    }
  };
  const place = (o) => {
    const sx = canvas.clientWidth / width, sy = canvas.clientHeight / height, [x, y, w, h] = o.rect;
    const clip = [Math.max(0, -y) * sy, Math.max(0, x + w - width) * sx, Math.max(0, y + h - height) * sy, Math.max(0, -x) * sx];
    Object.assign(o.element.style, {
      left: `${canvas.offsetLeft + x * sx}px`,
      top: `${canvas.offsetTop + y * sy}px`,
      width: `${w * sx}px`,
      height: `${h * sy}px`,
      clipPath: `inset(${clip.map((v) => `${v}px`).join(" ")})`
    });
  };
  const holes = () => [...overlays.values()].filter((o) => o.rect).map((o) => ({ key: o.key, x: o.rect[0], y: o.rect[1], width: o.rect[2], height: o.rect[3] }));
  const repaint = () => {
    holesChanged = true;
    if (staging || source) {
      dirty = true;
      mark(0, height, 0, width);
      schedule_paint();
    }
  };
  const awaitChoice = (reason) => {
    generation++;
    renderer?.close();
    renderer = null;
    diagnostics2.backend = "none";
    diagnostics2.fallbackAdapter = null;
    diagnostics2.failure = reason;
    diagnostics2.awaitingChoice = true;
    dirty = !!staging;
    publish();
  };
  const startWebGPU = async (lost) => {
    const pending2 = createWebGPUPresenter(width, height, lost);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`WebGPU did not start within ${webgpuTimeoutMs / 1e3} s`)), webgpuTimeoutMs);
    });
    try {
      return await Promise.race([pending2, timeout]);
    } catch (error) {
      pending2.then((late) => late.close(), () => {
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  const select = async (backend, reason = null) => {
    const token = ++generation;
    renderer?.close();
    renderer = null;
    const webgpu = backend === "auto" || backend === "webgpu";
    diagnostics2.backend = webgpu ? "none" : "canvas2d";
    diagnostics2.fallbackAdapter = null;
    diagnostics2.fallbackReason = reason;
    diagnostics2.failure = null;
    diagnostics2.awaitingChoice = false;
    publish();
    if (closed) return;
    if (backend === "canvas2d") {
      repaint();
      return;
    }
    const current = () => !closed && token === generation;
    const lost = (reason2) => {
      if (!current()) return;
      if (webgpu) {
        awaitChoice(reason2);
        return;
      }
      void select("canvas2d", reason2);
    };
    if (webgpu) {
      let candidate2;
      try {
        candidate2 = await startWebGPU(lost);
      } catch (error) {
        if (current()) awaitChoice(message(error));
        return;
      }
      if (!current()) {
        candidate2.close();
        return;
      }
      renderer = candidate2;
      diagnostics2.backend = candidate2.backend;
      diagnostics2.fallbackAdapter = candidate2.fallbackAdapter ?? null;
      publish();
      repaint();
      return;
    }
    let candidate;
    try {
      candidate = createWebGLPresenter(width, height, lost);
    } catch (error) {
      if (current()) {
        diagnostics2.fallbackReason = message(error);
        publish();
        repaint();
      }
      return;
    }
    if (!current()) {
      candidate.close();
      return;
    }
    renderer = candidate;
    diagnostics2.backend = candidate.backend;
    publish();
    repaint();
  };
  const paint2d = (from = 0, to = height, x0 = 0, x1 = width) => {
    if (to <= from && image) return;
    if (!image) {
      image = ctx.createImageData(width, height);
      from = 0;
      to = height;
      x0 = 0;
      x1 = width;
    }
    swizzle_bgra_to_rgba(
      image.data.subarray(from * rowBytes, to * rowBytes),
      staging.subarray(from * rowBytes, to * rowBytes),
      width,
      to - from,
      rowBytes
    );
    ctx.putImageData(image, 0, 0, x0, from, x1 - x0, to - from);
  };
  const snapshot2 = () => {
    const pending2 = source;
    source = null;
    if (!pending2)
      return;
    const { addr, stride } = pending2;
    const bytes = memory_bytes(memory, addr, stride * (height - 1) + rowBytes);
    if (!bytes)
      return;
    const need = rowBytes * height, fresh = !staging || staging.byteLength !== need;
    if (fast) {
      if (fresh) {
        const pages = Math.ceil(need / 65536) - fast.staging.buffer.byteLength / 65536;
        if (pages > 0) fast.staging.grow(pages);
        staging = new Uint8Array(fast.staging.buffer, 0, need);
      }
      if (!fast.diff(addr, stride, rowBytes, height, fresh ? 1 : 0)) {
        diagnostics2.unchanged++;
        return;
      }
      mark(fast.top.value, fast.bottom.value, fast.left.value / 4, fast.right.value / 4);
      return;
    }
    if (fresh) staging = new Uint8Array(need);
    const words = width, old32 = new Uint32Array(staging.buffer, 0, need / 4);
    const aligned = bytes.byteOffset % 4 === 0 && stride % 4 === 0;
    let first = -1, last = -1, x0 = width, x1 = 0;
    for (let y = 0; y < height; y++) {
      let lo = 0, hi = width;
      if (aligned && !fresh) {
        const new32 = new Uint32Array(bytes.buffer, bytes.byteOffset + y * stride, words);
        const o = y * words;
        while (lo < words && new32[lo] === old32[o + lo]) lo++;
        if (lo === words) continue;
        while (hi > lo + 1 && new32[hi - 1] === old32[o + hi - 1]) hi--;
      }
      staging.set(bytes.subarray(y * stride + lo * 4, y * stride + hi * 4), y * rowBytes + lo * 4);
      if (first < 0) first = y;
      last = y;
      x0 = Math.min(x0, lo);
      x1 = Math.max(x1, hi);
    }
    if (first < 0) {
      diagnostics2.unchanged++;
      return;
    }
    mark(first, last + 1, x0, x1);
  };
  const schedule_paint = () => {
    if (raf || closed)
      return;
    const request3 = globalThis.requestAnimationFrame ?? ((cb) => setTimeout(cb, 16));
    raf = request3(() => {
      raf = 0;
      if (closed || !dirty)
        return;
      if (!renderer && diagnostics2.backend === "none")
        return;
      dirty = false;
      snapshot2();
      if (overlaySupport && overlays.size) applyOverlays();
      if (holesChanged && renderer?.setHoles) {
        const list = holes();
        renderer.setHoles(list);
        holeCount = list.length;
        holesChanged = false;
      }
      if (!staging)
        return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        mark(0, height, 0, width);
      }
      if (bottom <= top && pbottom <= ptop)
        return;
      let from = top, to = bottom, x0 = left, x1 = right, upload = bottom > top;
      let pfrom = Math.min(top, ptop), pto = Math.max(bottom, pbottom), px0 = Math.min(left, pleft), px1 = Math.max(right, pright);
      top = height;
      bottom = 0;
      left = width;
      right = 0;
      ptop = height;
      pbottom = 0;
      pleft = width;
      pright = 0;
      if (upload) {
        pfrom = Math.min(pfrom, from);
        pto = Math.max(pto, to);
        px0 = Math.min(px0, x0);
        px1 = Math.max(px1, x1);
      }
      try {
        if (renderer) {
          const frame = renderer.draw(staging, from, to, x0, x1, upload);
          if (holeCount) ctx.clearRect(px0, pfrom, px1 - px0, pto - pfrom);
          try {
            ctx.drawImage(frame, px0, pfrom, px1 - px0, pto - pfrom, px0, pfrom, px1 - px0, pto - pfrom);
          } finally {
            frame.close?.();
          }
        } else paint2d(from, to, x0, x1);
      } catch (error) {
        if (diagnostics2.backend === "webgpu") {
          awaitChoice(message(error));
          return;
        }
        void select("canvas2d", message(error));
        paint2d();
      }
      diagnostics2.frames++;
    });
  };
  const ready = select(diagnostics2.requested);
  return {
    width,
    height,
    bpp,
    ready,
    get diagnostics() {
      return { ...diagnostics2 };
    },
    /** Keyed GL window overlay frames from the GPU owner (guest-gl-remote.js PresentSurface). */
    overlay(frame) {
      if (frame.reset) {
        for (const key of [...overlays.keys()]) dropOverlay(key);
        return;
      }
      if (frame.end) {
        dropOverlay(frame.key);
        return;
      }
      if (!frame.bitmap) return;
      if (closed || !overlaySupport) {
        frame.bitmap.close();
        return;
      }
      let o = overlays.get(frame.key);
      if (!o) {
        overlays.set(frame.key, o = { key: frame.key, pending: null, x: 0, y: 0, element: null, context: null, rect: null });
        diagnostics2.overlays = overlays.size;
      }
      if (o.pending) {
        o.pending.close();
        diagnostics2.overlayDropped++;
      }
      o.pending = frame.bitmap;
      o.x = frame.x;
      o.y = frame.y;
      dirty = true;
      schedule_paint();
    },
    setBackend,
    get_mode(width_ptr, height_ptr, bpp_ptr) {
      const view = new DataView(memory.buffer);
      view.setUint32(width_ptr >>> 0, width, true);
      view.setUint32(height_ptr >>> 0, height, true);
      view.setUint32(bpp_ptr >>> 0, bpp, true);
    },
    present(addr, fb_width, fb_height, stride, fb_bpp) {
      if (closed)
        return;
      if (fb_width !== width || fb_height !== height || fb_bpp !== 32)
        return;
      if (!Number.isSafeInteger(stride) || stride < rowBytes)
        return;
      if (!memory_bytes(memory, addr >>> 0, stride * (height - 1) + rowBytes))
        return;
      source = { addr: addr >>> 0, stride };
      diagnostics2.presents++;
      if (dirty) diagnostics2.coalesced++;
      dirty = true;
      schedule_paint();
    },
    close() {
      closed = true;
      generation++;
      renderer?.close();
      renderer = null;
      for (const o of overlays.values()) {
        o.pending?.close();
        o.element?.remove();
      }
      overlays.clear();
      if (raf) {
        (globalThis.cancelAnimationFrame ?? clearTimeout)(raf);
        raf = 0;
      }
      dirty = false;
      source = null;
      staging = null;
    }
  };
}
function framebuffer_imports(memory, host, defaults = {
  width: 1024,
  height: 768,
  bpp: 32
}) {
  if (host) {
    return {
      get_mode: (w, h, b) => host.get_mode(w, h, b),
      present: (a, w, h, s, b) => host.present(a, w, h, s, b)
    };
  }
  return {
    get_mode(width_ptr, height_ptr, bpp_ptr) {
      const view = new DataView(memory.buffer);
      view.setUint32(width_ptr >>> 0, defaults.width, true);
      view.setUint32(height_ptr >>> 0, defaults.height, true);
      view.setUint32(bpp_ptr >>> 0, defaults.bpp, true);
    },
    present() {
    }
  };
}

// web/linux/dist/guest-gpu-hostcall.js
var MAX_SLOTS = 256;
var MAX_RANGE = 256 << 20;
var H_MAGIC = 0;
var H_OWNER_STATE = 1;
var H_OWNER_GEN = 2;
var H_DOORBELL = 4;
var H_FLAGS = 5;
var H_DEAD_REASON = 7;
var H_STALL_MS = 8;
var H_STARTUP_MS = 9;
var H_SLOTS = 32;
var SLOT_WORDS = 16;
var S_STATE = 1;
var HUB_BYTES = (H_SLOTS + MAX_SLOTS * SLOT_WORDS) * 4;
var MAGIC = 1196443697;
var OWNER_NONE = 0;
var OWNER_STARTING = 1;
var OWNER_DEAD = 3;
var DEAD_ERROR = 1;
var DEAD_STALL = 2;
var DEAD_TERMINATED = 3;
var DEAD_CLOSED = 4;
var DEAD_STARTUP = 5;
var FLAG_TEST_HOOKS = 1;
var DEFAULT_STALL_MS = 3e3;
var DEFAULT_STARTUP_MS = 2e4;
function slotWord(slot, word) {
  return H_SLOTS + slot * SLOT_WORDS + word;
}
function createGpuHostcallHost({
  testHooks = false,
  stallMs = DEFAULT_STALL_MS,
  startupMs = DEFAULT_STARTUP_MS,
  ownerUrl = new URL("./guest-gpu-owner.js", new URL("/linux/dist/guest-gpu-hostcall.js", globalThis.__linuxonwebExecutionURL ?? globalThis.location.href).href),
  log = () => {
  },
  ownerConfig = {},
  onPresent = null
} = {}) {
  if (typeof SharedArrayBuffer !== "function" || typeof Worker !== "function")
    return null;
  const sab = new SharedArrayBuffer(HUB_BYTES);
  const hub = new Int32Array(sab);
  hub[H_FLAGS] = testHooks ? FLAG_TEST_HOOKS : 0;
  hub[H_STALL_MS] = stallMs;
  hub[H_STARTUP_MS] = startupMs;
  hub[H_OWNER_STATE] = OWNER_NONE;
  Atomics.store(hub, H_MAGIC, MAGIC);
  const attachments = /* @__PURE__ */ new Map();
  let owner = null;
  let closed = false;
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
    const state2 = Atomics.load(hub, H_OWNER_STATE);
    if (state2 !== OWNER_DEAD) {
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
    } catch (error) {
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
        if (onPresent) onPresent(data, (message, transfer) => {
          if (owner === worker) worker.postMessage(message, transfer);
        });
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
          if (Atomics.load(hub, H_FLAGS) & FLAG_TEST_HOOKS && Atomics.load(hub, H_OWNER_STATE) === OWNER_DEAD && message.gen === Atomics.load(hub, H_OWNER_GEN))
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
    }
  };
}

// web/linux/dist/virtio/block.js
var BlockDeviceFeatures = {
  RO: 1n << 5n,
  FLUSH: 1n << 9n
};
var BlockDeviceConfig = class extends Struct({ capacity: U64LE }) {
};
var BlockDeviceRequest = class extends Struct({
  type: U32LE,
  reserved: U32LE,
  sector: U64LE
}) {
};

// web/linux/dist/virtio/console.js
var Features = {
  SIZE: 1n << 0n
};
var ConsoleConfig = class extends Struct({
  columns: U16LE,
  rows: U16LE
}) {
};
function consoleDevice(input, output) {
  const reader = input?.getReader();
  const writer2 = output?.getWriter();
  const config_bytes = new Uint8Array(ConsoleConfig.size);
  const config = new ConsoleConfig(config_bytes);
  config.columns = 80;
  config.rows = 24;
  let pumping;
  let reader_cancellation;
  let writer_abortion;
  const receive_chains = [];
  const pending_input = [];
  let guest_ready = false;
  function reset() {
    receive_chains.length = 0;
    guest_ready = false;
  }
  function flush_input() {
    while (guest_ready && receive_chains.length > 0 && pending_input.length > 0) {
      const chain = receive_chains.shift();
      const chunk = pending_input[0];
      const [desc, trailing] = chain;
      assert(desc && desc.writable, "receiver must be writable");
      assert(!trailing, "too many descriptors");
      const n = Math.min(chunk.byteLength, desc.array.byteLength);
      desc.array.set(chunk.subarray(0, n));
      chain.release(n);
      if (n < chunk.byteLength)
        pending_input[0] = chunk.subarray(n);
      else
        pending_input.shift();
    }
  }
  async function pump_input() {
    assert(reader);
    for (; ; ) {
      const { value, done } = await reader.read();
      if (done)
        break;
      pending_input.push(value);
      flush_input();
    }
  }
  function notify_input(queue) {
    for (const chain of queue)
      receive_chains.push(chain);
    flush_input();
    pumping ??= pump_input().catch(console.error);
  }
  async function notify_output(queue) {
    if (!guest_ready) {
      guest_ready = true;
      flush_input();
    }
    for (const chain of queue) {
      let n = 0;
      for (const { array, writable } of chain) {
        assert(!writable, "transmitter must be readable");
        await writer2?.write(array);
        n += array.byteLength;
      }
      chain.release(n);
    }
  }
  const controller = new VirtioController({ deviceId: 3, features: Features.SIZE, config: config_bytes }, {
    queues: [reader ? notify_input : () => {
    }, notify_output],
    reset,
    stop() {
      reset();
      pending_input.length = 0;
      reader_cancellation ??= reader?.cancel();
      writer_abortion ??= writer2?.abort();
    },
    async close() {
      const results = await Promise.allSettled([
        reader_cancellation,
        writer_abortion
      ]);
      const failure = results.find((result) => result.status === "rejected");
      if (failure)
        throw failure.reason;
    }
  });
  function resize(columns, rows) {
    assert(Number.isInteger(columns) && columns > 0 && columns <= 65535, "console columns must be a positive 16-bit integer");
    assert(Number.isInteger(rows) && rows > 0 && rows <= 65535, "console rows must be a positive 16-bit integer");
    if (config.columns === columns && config.rows === rows)
      return;
    config.columns = columns;
    config.rows = rows;
    controller.updateConfig(config_bytes);
  }
  return controller.expose({ resize });
}

// web/linux/dist/virtio/entropy.js
function entropyDevice() {
  function notify(queue) {
    for (const chain of queue) {
      let n = 0;
      for (const { array, writable } of chain) {
        assert(writable);
        const arr = new Uint8Array(array.length);
        crypto.getRandomValues(arr);
        array.set(arr);
        n += array.byteLength;
      }
      chain.release(n);
    }
  }
  return new VirtioController({ deviceId: 4 }, { queues: [notify] }).device;
}

// web/linux/dist/virtio/fs.js
var utf82 = new TextDecoder("utf-8", { fatal: true });
var utf8_encoder = new TextEncoder();
var FuseOpcode = {
  LOOKUP: 1,
  FORGET: 2,
  GETATTR: 3,
  SETATTR: 4,
  READLINK: 5,
  SYMLINK: 6,
  MKDIR: 9,
  UNLINK: 10,
  RMDIR: 11,
  RENAME: 12,
  OPEN: 14,
  READ: 15,
  WRITE: 16,
  STATFS: 17,
  RELEASE: 18,
  FSYNC: 20,
  FLUSH: 25,
  INIT: 26,
  OPENDIR: 27,
  READDIR: 28,
  RELEASEDIR: 29,
  FSYNCDIR: 30,
  ACCESS: 34,
  CREATE: 35,
  INTERRUPT: 36,
  DESTROY: 38,
  BATCH_FORGET: 42
};
var FuseInitFlags = {
  ASYNC_READ: 1 << 0,
  BIG_WRITES: 1 << 5,
  AUTO_INVAL_DATA: 1 << 12,
  MAX_PAGES: 1 << 22,
  INIT_EXT: 1 << 30
};
var FuseGetattrFlags = {
  FH: 1 << 0
};
var FuseSetattrFlags = {
  MODE: 1 << 0,
  UID: 1 << 1,
  GID: 1 << 2,
  SIZE: 1 << 3,
  ATIME: 1 << 4,
  MTIME: 1 << 5,
  FH: 1 << 6,
  ATIME_NOW: 1 << 7,
  MTIME_NOW: 1 << 8,
  CTIME: 1 << 10
};
var FileType = {
  fifo: 4096,
  character: 8192,
  directory: 16384,
  block: 24576,
  file: 32768,
  symlink: 40960,
  socket: 49152
};
var DirentType = {
  fifo: 1,
  character: 2,
  directory: 4,
  block: 6,
  file: 8,
  symlink: 10,
  socket: 12
};
var Errno = {
  EPERM: 1,
  ENOENT: 2,
  EIO: 5,
  EBADF: 9,
  EACCES: 13,
  EEXIST: 17,
  ENOTDIR: 20,
  EISDIR: 21,
  EINVAL: 22,
  ENOSPC: 28,
  EROFS: 30,
  EPROTO: 71,
  ENAMETOOLONG: 36,
  ENOSYS: 38,
  ENOTEMPTY: 39,
  ELOOP: 40,
  EOPNOTSUPP: 95
};
var FSError = class extends Error {
  errno;
  constructor(code, message = code) {
    super(message);
    this.name = "FSError";
    this.errno = Errno[code];
  }
};
var FuseInHeader = Struct({
  len: U32LE,
  opcode: U32LE,
  unique: U64LE,
  nodeid: U64LE,
  uid: U32LE,
  gid: U32LE,
  pid: U32LE,
  total_extlen: U16LE,
  padding: U16LE
});
var FuseOutHeader = Struct({
  len: U32LE,
  error: I32LE,
  unique: U64LE
});
var FuseAttr = Struct({
  ino: U64LE,
  size: U64LE,
  blocks: U64LE,
  atime: U64LE,
  mtime: U64LE,
  ctime: U64LE,
  atimensec: U32LE,
  mtimensec: U32LE,
  ctimensec: U32LE,
  mode: U32LE,
  nlink: U32LE,
  uid: U32LE,
  gid: U32LE,
  rdev: U32LE,
  blksize: U32LE,
  flags: U32LE
});
var FuseEntryOut = Struct({
  nodeid: U64LE,
  generation: U64LE,
  entry_valid: U64LE,
  attr_valid: U64LE,
  entry_valid_nsec: U32LE,
  attr_valid_nsec: U32LE,
  attr: FuseAttr
});
var FuseAttrOut = Struct({
  attr_valid: U64LE,
  attr_valid_nsec: U32LE,
  dummy: U32LE,
  attr: FuseAttr
});
var FuseOpenOut = Struct({
  fh: U64LE,
  open_flags: U32LE,
  backing_id: I32LE
});
var FuseInitOut = Struct({
  major: U32LE,
  minor: U32LE,
  max_readahead: U32LE,
  flags: U32LE,
  max_background: U16LE,
  congestion_threshold: U16LE,
  max_write: U32LE,
  time_gran: U32LE,
  max_pages: U16LE,
  map_alignment: U16LE,
  flags2: U32LE,
  max_stack_depth: U32LE,
  request_timeout: U16LE,
  unused: FixedArray(U16LE, 11)
});
var FuseWriteOut = Struct({
  size: U32LE,
  padding: U32LE
});
var FuseStatfsOut = Struct({
  blocks: U64LE,
  bfree: U64LE,
  bavail: U64LE,
  files: U64LE,
  ffree: U64LE,
  bsize: U32LE,
  namelen: U32LE,
  frsize: U32LE,
  padding: U32LE,
  spare: FixedArray(U32LE, 6)
});
var FuseInitIn = Struct({
  major: U32LE,
  minor: U32LE,
  max_readahead: U32LE,
  flags: U32LE
});
var FuseForgetIn = Struct({
  nlookup: U64LE
});
var FuseForgetOne = Struct({
  nodeid: U64LE,
  nlookup: U64LE
});
var FuseBatchForgetIn = Struct({
  count: U32LE,
  dummy: U32LE
});
var FuseGetattrIn = Struct({
  getattr_flags: U32LE,
  dummy: U32LE,
  fh: U64LE
});
var FuseMkdirIn = Struct({
  mode: U32LE,
  umask: U32LE
});
var FuseRenameIn = Struct({
  newdir: U64LE
});
var FuseSetattrIn = Struct({
  valid: U32LE,
  padding: U32LE,
  fh: U64LE,
  size: U64LE,
  lock_owner: U64LE,
  atime: U64LE,
  mtime: U64LE,
  ctime: U64LE,
  atimensec: U32LE,
  mtimensec: U32LE,
  ctimensec: U32LE,
  mode: U32LE,
  unused4: U32LE,
  uid: U32LE,
  gid: U32LE,
  unused5: U32LE
});
var FuseOpenIn = Struct({
  flags: U32LE,
  open_flags: U32LE
});
var FuseCreateIn = Struct({
  flags: U32LE,
  mode: U32LE,
  umask: U32LE,
  open_flags: U32LE
});
var FuseReadIn = Struct({
  fh: U64LE,
  offset: U64LE,
  size: U32LE,
  read_flags: U32LE,
  lock_owner: U64LE,
  flags: U32LE,
  padding: U32LE
});
var FuseWriteIn = Struct({
  fh: U64LE,
  offset: U64LE,
  size: U32LE,
  write_flags: U32LE,
  lock_owner: U64LE,
  flags: U32LE,
  padding: U32LE
});
var FuseFlushIn = Struct({
  fh: U64LE,
  unused: U32LE,
  padding: U32LE,
  lock_owner: U64LE
});
var FuseFsyncIn = Struct({
  fh: U64LE,
  fsync_flags: U32LE,
  padding: U32LE
});
var FuseReleaseIn = Struct({
  fh: U64LE,
  flags: U32LE,
  release_flags: U32LE,
  lock_owner: U64LE
});
var FuseAccessIn = Struct({
  mask: U32LE,
  padding: U32LE
});
var FuseDirent = Struct({
  ino: U64LE,
  off: U64LE,
  namelen: U32LE,
  type: U32LE
});
var UnsupportedOperation = class extends FSError {
  constructor() {
    super("ENOSYS");
  }
};
function mode_type(mode) {
  switch (mode & 61440) {
    case FileType.fifo:
      return "fifo";
    case FileType.character:
      return "character";
    case FileType.directory:
      return "directory";
    case FileType.block:
      return "block";
    case FileType.file:
      return "file";
    case FileType.symlink:
      return "symlink";
    case FileType.socket:
      return "socket";
    default:
      throw new FSError("EIO", "filesystem returned an invalid mode");
  }
}
function checked_number(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new FSError("EINVAL", "offset exceeds JavaScript's integer range");
  }
  return number;
}
function validate_name(name) {
  if (name.length === 0 || name === "." || name === ".." || name.includes("/") || name.includes("\0")) {
    throw new FSError("EINVAL", "invalid path component");
  }
  if (utf8_encoder.encode(name).byteLength > 255) {
    throw new FSError("ENAMETOOLONG");
  }
  return name;
}
function concatenate(buffers, writable) {
  const selected2 = buffers.filter((buffer) => buffer.writable === writable);
  const length = selected2.reduce((total, buffer) => total + buffer.array.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const buffer of selected2) {
    result.set(buffer.array, offset);
    offset += buffer.array.byteLength;
  }
  return result;
}
function scatter(buffers, data) {
  let offset = 0;
  for (const buffer of buffers) {
    if (!buffer.writable)
      continue;
    const length = Math.min(buffer.array.byteLength, data.byteLength - offset);
    if (length <= 0)
      break;
    buffer.array.set(data.subarray(offset, offset + length));
    offset += length;
  }
  if (offset !== data.byteLength) {
    throw new Error("guest response buffers are too small");
  }
}
function minimum_response_capacity(opcode) {
  switch (opcode) {
    case FuseOpcode.FORGET:
    case FuseOpcode.BATCH_FORGET:
    case FuseOpcode.INTERRUPT:
      return 0;
    case FuseOpcode.INIT:
      return FuseOutHeader.size + FuseInitOut.size;
    case FuseOpcode.LOOKUP:
    case FuseOpcode.SYMLINK:
    case FuseOpcode.MKDIR:
      return FuseOutHeader.size + FuseEntryOut.size;
    case FuseOpcode.GETATTR:
    case FuseOpcode.SETATTR:
      return FuseOutHeader.size + FuseAttrOut.size;
    case FuseOpcode.OPEN:
    case FuseOpcode.OPENDIR:
      return FuseOutHeader.size + FuseOpenOut.size;
    case FuseOpcode.CREATE:
      return FuseOutHeader.size + FuseEntryOut.size + FuseOpenOut.size;
    case FuseOpcode.WRITE:
      return FuseOutHeader.size + FuseWriteOut.size;
    case FuseOpcode.STATFS:
      return FuseOutHeader.size + FuseStatfsOut.size;
    default:
      return FuseOutHeader.size;
  }
}
function timestamp(value) {
  return [value?.seconds ?? 0n, value?.nanoseconds ?? 0];
}
function attr_fields(nodeid, attributes) {
  const [atime, atimensec] = timestamp(attributes.atime);
  const [mtime, mtimensec] = timestamp(attributes.mtime);
  const [ctime, ctimensec] = timestamp(attributes.ctime);
  return {
    ino: nodeid,
    size: attributes.size,
    blocks: attributes.blocks ?? (attributes.size + 511n) / 512n,
    atime,
    mtime,
    ctime,
    atimensec,
    mtimensec,
    ctimensec,
    mode: attributes.mode,
    nlink: attributes.nlink ?? (mode_type(attributes.mode) === "directory" ? 2 : 1),
    uid: attributes.uid ?? 0,
    gid: attributes.gid ?? 0,
    rdev: attributes.rdev ?? 0,
    blksize: attributes.blockSize ?? 4096,
    flags: 0
  };
}
function write_entry(payload, record, attributes, validity) {
  payload.alloc(FuseEntryOut).value = {
    nodeid: record.id,
    generation: 1n,
    entry_valid: validity,
    attr_valid: validity,
    entry_valid_nsec: 0,
    attr_valid_nsec: 0,
    attr: attr_fields(record.id, attributes)
  };
}
function write_attr_out(payload, validity, nodeid, attributes) {
  payload.alloc(FuseAttrOut).value = {
    attr_valid: validity,
    attr_valid_nsec: 0,
    dummy: 0,
    attr: attr_fields(nodeid, attributes)
  };
}
function create_context(header, mode, umask) {
  return {
    mode: mode & ~umask,
    uid: header.uid,
    gid: header.gid
  };
}
async function async_iterable(source) {
  const result = [];
  for await (const item of source)
    result.push(item);
  return result;
}
function fileSystemDevice(filesystem, options) {
  const { tag, cache = true, cacheSeconds = 1 } = options;
  if (!Number.isSafeInteger(cacheSeconds) || cacheSeconds < 0) {
    throw new RangeError("virtio-fs cacheSeconds must be a non-negative integer");
  }
  const validity = cache ? BigInt(cacheSeconds) : 0n;
  const encoded_tag = utf8_encoder.encode(tag);
  if (encoded_tag.byteLength === 0 || encoded_tag.byteLength > 36) {
    throw new RangeError("virtio-fs tag must be between 1 and 36 UTF-8 bytes");
  }
  if (filesystem.write ?? filesystem.create) {
    if (!filesystem.flush || !filesystem.fsync) {
      throw new Error("a writable filesystem must implement flush() and fsync(); no-op implementations are the explicit way to declare an already-durable or ephemeral backend");
    }
  }
  const config = new Uint8Array(40);
  config.set(encoded_tag);
  new DataView(config.buffer).setUint32(36, 1, true);
  const records = /* @__PURE__ */ new Map();
  const by_node = /* @__PURE__ */ new WeakMap();
  let next_nodeid = 2n;
  const root = {
    id: 1n,
    node: filesystem.root,
    parent: void 0,
    lookups: 1n,
    handles: 0,
    children: 0
  };
  root.parent = root;
  records.set(root.id, root);
  by_node.set(filesystem.root, root);
  const handles = /* @__PURE__ */ new Map();
  let next_handle = 1n;
  let finalize_promise;
  function record_for_node(node2, parent) {
    let record = by_node.get(node2);
    if (!record) {
      record = {
        id: next_nodeid++,
        node: node2,
        parent,
        lookups: 0n,
        handles: 0,
        children: 0
      };
      records.set(record.id, record);
      by_node.set(node2, record);
      parent.children += 1;
    }
    return record;
  }
  function collect_record(record) {
    if (records.get(record.id) !== record)
      return;
    if (record !== root && record.lookups === 0n && record.handles === 0 && record.children === 0) {
      records.delete(record.id);
      by_node.delete(record.node);
      record.parent.children -= 1;
      collect_record(record.parent);
    }
  }
  function forget(record, count) {
    record.lookups = count >= record.lookups ? 0n : record.lookups - count;
    collect_record(record);
  }
  function node_record(nodeid) {
    const record = records.get(nodeid);
    if (!record)
      throw new FSError("ENOENT");
    return record;
  }
  function handle_record(fh, directory, node2) {
    const record = handles.get(fh);
    if (!record || directory !== void 0 && record.directory !== directory || node2 !== void 0 && record.node !== node2) {
      throw new FSError("EBADF");
    }
    return record;
  }
  function add_handle(node2, handle, directory) {
    const fh = next_handle++;
    handles.set(fh, { node: node2, handle, directory });
    node2.handles += 1;
    return fh;
  }
  function remove_handle(fh, handle) {
    handles.delete(fh);
    handle.node.handles -= 1;
    collect_record(handle.node);
  }
  function finalize() {
    if (finalize_promise)
      return finalize_promise;
    finalize_promise = (async () => {
      let failed = false;
      let first_error;
      for (const [fh, handle] of handles) {
        try {
          if (handle.directory) {
            await filesystem.releasedir?.(handle.node.node, handle.handle);
          } else {
            await filesystem.release?.(handle.node.node, handle.handle);
          }
        } catch (error) {
          if (!failed) {
            failed = true;
            first_error = error;
          }
        } finally {
          remove_handle(fh, handle);
        }
      }
      try {
        await filesystem.destroy?.();
      } catch (error) {
        if (!failed) {
          failed = true;
          first_error = error;
        }
      }
      if (failed)
        throw first_error;
    })();
    return finalize_promise;
  }
  async function lookup(parent, name) {
    const node2 = await filesystem.lookup(parent.node, validate_name(name));
    if (!node2)
      throw new FSError("ENOENT");
    const record = record_for_node(node2, parent);
    record.lookups += 1n;
    return record;
  }
  async function process2(header, body, capacity) {
    const payload = new Bytes(Math.max(0, capacity - FuseOutHeader.size));
    const node2 = header.nodeid === 0n ? void 0 : node_record(header.nodeid);
    switch (header.opcode) {
      case FuseOpcode.INIT: {
        const init = body.struct(FuseInitIn);
        if (init.major !== 7) {
          if (init.major < 7)
            throw new FSError("EPROTO");
          payload.alloc(U32LE).value = 7;
          payload.alloc(U32LE).value = 45;
          break;
        }
        const supported_flags = FuseInitFlags.ASYNC_READ | FuseInitFlags.BIG_WRITES | FuseInitFlags.AUTO_INVAL_DATA | FuseInitFlags.MAX_PAGES | FuseInitFlags.INIT_EXT;
        const flags = init.flags & supported_flags;
        payload.alloc(FuseInitOut).value = {
          major: 7,
          minor: Math.min(init.minor, 45),
          max_readahead: Math.min(init.max_readahead, 1024 * 1024),
          flags,
          max_background: 12,
          congestion_threshold: 9,
          max_write: 1024 * 1024,
          time_gran: 1,
          max_pages: (flags & FuseInitFlags.MAX_PAGES) === 0 ? 0 : 16,
          map_alignment: 0,
          flags2: 0,
          max_stack_depth: 0,
          request_timeout: 0,
          unused: Array(11).fill(0)
        };
        break;
      }
      case FuseOpcode.LOOKUP: {
        let record, attributes;
        try {
          const name = body.cstring();
          if (filesystem.lookupWithAttributes) {
            const entry = await filesystem.lookupWithAttributes(node2.node, validate_name(name));
            if (!entry)
              throw new FSError("ENOENT");
            record = record_for_node(entry.node, node2);
            record.lookups += 1n;
            attributes = entry.attributes;
          } else {
            record = await lookup(node2, name);
          }
        } catch (error) {
          if (!(error instanceof FSError && error.errno === Errno.ENOENT && validity > 0n))
            throw error;
          payload.alloc(FuseEntryOut).value = {
            nodeid: 0n,
            generation: 0n,
            entry_valid: validity,
            attr_valid: 0n,
            entry_valid_nsec: 0,
            attr_valid_nsec: 0,
            attr: attr_fields(0n, { size: 0n, blocks: 0n, mode: 0, nlink: 0 })
          };
          break;
        }
        write_entry(payload, record, attributes ?? await filesystem.getattr(record.node), validity);
        break;
      }
      case FuseOpcode.FORGET: {
        const request3 = body.struct(FuseForgetIn);
        forget(node2, request3.nlookup);
        return void 0;
      }
      case FuseOpcode.BATCH_FORGET: {
        const request3 = body.struct(FuseBatchForgetIn);
        const forgotten = [];
        for (let index = 0; index < request3.count; index++) {
          const one = body.struct(FuseForgetOne);
          const record = records.get(one.nodeid);
          if (record)
            forgotten.push({ record, count: one.nlookup });
        }
        for (const entry of forgotten)
          forget(entry.record, entry.count);
        return void 0;
      }
      case FuseOpcode.GETATTR: {
        const request3 = body.struct(FuseGetattrIn);
        const handle = request3.getattr_flags & FuseGetattrFlags.FH ? handle_record(request3.fh, void 0, node2).handle : void 0;
        write_attr_out(payload, validity, node2.id, await filesystem.getattr(node2.node, handle));
        break;
      }
      case FuseOpcode.SETATTR: {
        if (!filesystem.setattr)
          throw new UnsupportedOperation();
        const request3 = body.struct(FuseSetattrIn);
        const changes = {};
        if (request3.valid & FuseSetattrFlags.MODE)
          changes.mode = request3.mode;
        if (request3.valid & FuseSetattrFlags.UID)
          changes.uid = request3.uid;
        if (request3.valid & FuseSetattrFlags.GID)
          changes.gid = request3.gid;
        if (request3.valid & FuseSetattrFlags.SIZE)
          changes.size = request3.size;
        if (request3.valid & FuseSetattrFlags.ATIME) {
          changes.atime = request3.valid & FuseSetattrFlags.ATIME_NOW ? "now" : { seconds: request3.atime, nanoseconds: request3.atimensec };
        }
        if (request3.valid & FuseSetattrFlags.MTIME) {
          changes.mtime = request3.valid & FuseSetattrFlags.MTIME_NOW ? "now" : { seconds: request3.mtime, nanoseconds: request3.mtimensec };
        }
        if (request3.valid & FuseSetattrFlags.CTIME) {
          changes.ctime = { seconds: request3.ctime, nanoseconds: request3.ctimensec };
        }
        const open = request3.valid & FuseSetattrFlags.FH ? handle_record(request3.fh, void 0, node2).handle : void 0;
        const attributes = await filesystem.setattr(node2.node, changes, open);
        write_attr_out(payload, validity, node2.id, attributes);
        break;
      }
      case FuseOpcode.READLINK: {
        if (!filesystem.readlink)
          throw new UnsupportedOperation();
        payload.append(utf8_encoder.encode(await filesystem.readlink(node2.node)));
        break;
      }
      case FuseOpcode.SYMLINK: {
        if (!filesystem.symlink)
          throw new UnsupportedOperation();
        const name = validate_name(body.cstring());
        const target = body.cstring();
        const linked = await filesystem.symlink(node2.node, name, target, create_context(header, FileType.symlink | 511, 0));
        const record = record_for_node(linked, node2);
        record.lookups += 1n;
        write_entry(payload, record, await filesystem.getattr(linked), validity);
        break;
      }
      case FuseOpcode.MKDIR: {
        if (!filesystem.mkdir)
          throw new UnsupportedOperation();
        const request3 = body.struct(FuseMkdirIn);
        const made = await filesystem.mkdir(node2.node, validate_name(body.cstring()), create_context(header, FileType.directory | request3.mode, request3.umask));
        const record = record_for_node(made, node2);
        record.lookups += 1n;
        write_entry(payload, record, await filesystem.getattr(made), validity);
        break;
      }
      case FuseOpcode.UNLINK:
      case FuseOpcode.RMDIR: {
        const method = header.opcode === FuseOpcode.UNLINK ? filesystem.unlink : filesystem.rmdir;
        if (!method)
          throw new UnsupportedOperation();
        await method.call(filesystem, node2.node, validate_name(body.cstring()));
        break;
      }
      case FuseOpcode.RENAME: {
        if (!filesystem.rename)
          throw new UnsupportedOperation();
        const request3 = body.struct(FuseRenameIn);
        const new_parent = node_record(request3.newdir);
        const old_name = validate_name(body.cstring());
        const new_name = validate_name(body.cstring());
        const moved = node2 === new_parent ? void 0 : await filesystem.lookup(node2.node, old_name);
        const moved_record = moved && by_node.get(moved);
        await filesystem.rename(node2.node, old_name, new_parent.node, new_name);
        if (moved_record && records.get(moved_record.id) === moved_record && moved_record.parent !== new_parent) {
          const old_parent = moved_record.parent;
          old_parent.children -= 1;
          moved_record.parent = new_parent;
          new_parent.children += 1;
          collect_record(old_parent);
        }
        break;
      }
      case FuseOpcode.OPEN:
      case FuseOpcode.OPENDIR: {
        const directory = header.opcode === FuseOpcode.OPENDIR;
        const method = directory ? filesystem.opendir : filesystem.open;
        if (!method)
          throw new UnsupportedOperation();
        const request3 = body.struct(FuseOpenIn);
        const handle = await method.call(filesystem, node2.node, request3.flags);
        payload.alloc(FuseOpenOut).value = {
          fh: add_handle(node2, handle, directory),
          // Keep open flags zero even when cache is false. Cache controls only
          // entry/attribute validity; FOPEN_DIRECT_IO would route private
          // owner-worker user buffers through unsupported page extraction.
          open_flags: 0,
          backing_id: -1
        };
        break;
      }
      case FuseOpcode.CREATE: {
        if (!filesystem.create)
          throw new UnsupportedOperation();
        const request3 = body.struct(FuseCreateIn);
        const created = await filesystem.create(node2.node, validate_name(body.cstring()), request3.flags, create_context(header, FileType.file | request3.mode, request3.umask));
        const record = record_for_node(created.node, node2);
        record.lookups += 1n;
        write_entry(payload, record, await filesystem.getattr(created.node), validity);
        payload.alloc(FuseOpenOut).value = {
          fh: add_handle(record, created.handle, false),
          // CREATE returns the same open flags as OPEN; direct I/O is
          // unsupported by this wasm transport even when metadata/name
          // validity is zero.
          open_flags: 0,
          backing_id: -1
        };
        break;
      }
      case FuseOpcode.READ: {
        if (!filesystem.read)
          throw new UnsupportedOperation();
        const request3 = body.struct(FuseReadIn);
        const handle = handle_record(request3.fh, false, node2);
        const data = await filesystem.read(handle.node.node, handle.handle, request3.offset, Math.min(request3.size, capacity - FuseOutHeader.size));
        if (data.byteLength > request3.size || data.byteLength > capacity - FuseOutHeader.size) {
          throw new FSError("EIO", "filesystem returned too much data");
        }
        payload.append(data);
        break;
      }
      case FuseOpcode.WRITE: {
        if (!filesystem.write)
          throw new UnsupportedOperation();
        const request3 = body.struct(FuseWriteIn);
        const data = body.bytes(request3.size);
        const handle = handle_record(request3.fh, false, node2);
        const written = await filesystem.write(handle.node.node, handle.handle, request3.offset, data);
        if (!Number.isInteger(written) || written < 0 || written > request3.size) {
          throw new FSError("EIO", "filesystem returned an invalid write size");
        }
        payload.alloc(FuseWriteOut).value = { size: written, padding: 0 };
        break;
      }
      case FuseOpcode.FLUSH: {
        const request3 = body.struct(FuseFlushIn);
        const handle = handle_record(request3.fh, false, node2);
        if (filesystem.flush) {
          await filesystem.flush(handle.node.node, handle.handle);
        }
        break;
      }
      case FuseOpcode.FSYNC:
      case FuseOpcode.FSYNCDIR: {
        const request3 = body.struct(FuseFsyncIn);
        const handle = handle_record(request3.fh, header.opcode === FuseOpcode.FSYNCDIR, node2);
        if (filesystem.fsync) {
          await filesystem.fsync(handle.node.node, handle.handle, (request3.fsync_flags & 1) !== 0);
        }
        break;
      }
      case FuseOpcode.RELEASE:
      case FuseOpcode.RELEASEDIR: {
        const directory = header.opcode === FuseOpcode.RELEASEDIR;
        const request3 = body.struct(FuseReleaseIn);
        const handle = handle_record(request3.fh, directory, node2);
        if (directory) {
          await filesystem.releasedir?.(handle.node.node, handle.handle);
        } else {
          await filesystem.release?.(handle.node.node, handle.handle);
        }
        remove_handle(request3.fh, handle);
        break;
      }
      case FuseOpcode.READDIR: {
        if (!filesystem.readdir)
          throw new UnsupportedOperation();
        const request3 = body.struct(FuseReadIn);
        const offset = checked_number(request3.offset);
        const handle = handle_record(request3.fh, true, node2);
        const entries = [
          { name: ".", record: handle.node },
          { name: "..", record: handle.node.parent }
        ];
        const directory_entries = await filesystem.readdir(handle.node.node, handle.handle);
        const transient = [];
        const limit = Math.min(request3.size, capacity - FuseOutHeader.size);
        try {
          for (const entry of await async_iterable(directory_entries)) {
            const record = record_for_node(entry.node, handle.node);
            transient.push(record);
            entries.push({
              name: validate_name(entry.name),
              record
            });
          }
          for (let index = offset; index < entries.length; index++) {
            const entry = entries[index];
            const name = utf8_encoder.encode(entry.name);
            const record_length = 24 + name.byteLength + 7 & ~7;
            if (payload.length + record_length > limit)
              break;
            const attributes = await filesystem.getattr(entry.record.node);
            payload.alloc(FuseDirent).value = {
              ino: entry.record.id,
              off: BigInt(index + 1),
              namelen: name.byteLength,
              type: DirentType[mode_type(attributes.mode)]
            };
            payload.append(name);
            payload.bump(-payload.length & 7);
          }
        } finally {
          for (const record of transient)
            collect_record(record);
        }
        break;
      }
      case FuseOpcode.STATFS: {
        const stat = await filesystem.statfs?.(node2.node) ?? {};
        payload.alloc(FuseStatfsOut).value = {
          blocks: stat.blocks ?? 0n,
          bfree: stat.blocksFree ?? 0n,
          bavail: stat.blocksAvailable ?? 0n,
          files: stat.files ?? 0n,
          ffree: stat.filesFree ?? 0n,
          bsize: stat.blockSize ?? 4096,
          namelen: stat.nameLength ?? 255,
          frsize: stat.fragmentSize ?? stat.blockSize ?? 4096,
          padding: 0,
          spare: Array(6).fill(0)
        };
        break;
      }
      case FuseOpcode.ACCESS: {
        const request3 = body.struct(FuseAccessIn);
        if (filesystem.access)
          await filesystem.access(node2.node, request3.mask);
        break;
      }
      case FuseOpcode.INTERRUPT:
        return void 0;
      case FuseOpcode.DESTROY:
        await finalize();
        break;
      default:
        throw new UnsupportedOperation();
    }
    if (payload.length > capacity - FuseOutHeader.size) {
      throw new FSError("EIO", "response exceeds the guest's response buffer");
    }
    return payload;
  }
  async function notify(queue) {
    for (const chain of queue) {
      const buffers = [...chain];
      const request3 = concatenate(buffers, false);
      const capacity = buffers.filter((buffer) => buffer.writable).reduce((total, buffer) => total + buffer.array.byteLength, 0);
      let unique = 0n;
      try {
        let saw_writable = false;
        for (const buffer of buffers) {
          if (!buffer.writable && saw_writable) {
            throw new FSError("EINVAL", "readable descriptor follows response");
          }
          saw_writable ||= buffer.writable;
        }
        const body = new Reader(request3);
        const header = body.struct(FuseInHeader);
        unique = header.unique;
        if (header.len !== request3.byteLength || header.len < FuseInHeader.size) {
          throw new FSError("EINVAL", "invalid FUSE request length");
        }
        if (capacity < minimum_response_capacity(header.opcode)) {
          throw new FSError("EINVAL", "FUSE response buffer is too small");
        }
        const payload = await process2(header, body, capacity);
        if (payload === void 0) {
          chain.release(0);
          continue;
        }
        const response = new Bytes(FuseOutHeader.size + payload.length);
        response.alloc(FuseOutHeader).value = {
          len: FuseOutHeader.size + payload.length,
          error: 0,
          unique
        };
        response.append(payload.array);
        scatter(buffers, response.array);
        chain.release(response.array.byteLength);
      } catch (error) {
        if (capacity < FuseOutHeader.size) {
          chain.release(0);
          continue;
        }
        const response = new Bytes(FuseOutHeader.size);
        const errno = error instanceof FSError ? error.errno : error instanceof RangeError ? Errno.EINVAL : Errno.EIO;
        response.alloc(FuseOutHeader).value = {
          len: FuseOutHeader.size,
          error: -errno,
          unique
        };
        scatter(buffers, response.array);
        chain.release(FuseOutHeader.size);
      }
    }
  }
  return new VirtioController(
    // 26 is the virtio-fs device ID.
    { deviceId: 26, config },
    { queues: [notify, notify], close: finalize }
  ).device;
}

// web/linux/dist/virtio/net.js
var MAX_PENDING_FRAMES = 256;
var VirtioNetHeader = class extends Struct({
  flags: U8,
  gso_type: U8,
  header_length: U16LE,
  gso_size: U16LE,
  checksum_start: U16LE,
  checksum_offset: U16LE,
  buffer_count: U16LE
}) {
};
var Mac = FixedArray(U8, 6);
var EthernetHeader = class extends Struct({
  destination: Mac,
  source: Mac,
  type: U16BE
}) {
};
function mac_key(address) {
  return Array.from(address, (byte) => byte.toString(16).padStart(2, "0")).join(":");
}
function is_multicast(address) {
  return (address[0] & 1) !== 0;
}
function ethernetNetwork() {
  const ports = /* @__PURE__ */ new Set();
  const learned = /* @__PURE__ */ new Map();
  let closed = false;
  function addPort(receive) {
    assert(!closed, "cannot add a port to a closed Ethernet network");
    const port = { receive, closed: false };
    ports.add(port);
    return {
      async send(frame) {
        if (closed)
          return;
        assert(!port.closed, "cannot send from a closed Ethernet port");
        assert(frame.byteLength >= EthernetHeader.size, "Ethernet frame is shorter than its header");
        const header = new EthernetHeader(frame);
        learned.set(mac_key(header.source), port);
        const destination = learned.get(mac_key(header.destination));
        const recipients = destination && !is_multicast(header.destination) ? destination === port || destination.closed ? [] : [destination] : Array.from(ports, (candidate) => candidate !== port && !candidate.closed ? candidate : void 0).filter((candidate) => !!candidate);
        await Promise.all(recipients.map((recipient) => recipient.receive(frame.slice())));
      },
      close() {
        if (port.closed)
          return;
        port.closed = true;
        ports.delete(port);
        for (const [mac, owner] of learned) {
          if (owner === port)
            learned.delete(mac);
        }
      }
    };
  }
  return {
    addPort,
    close() {
      if (closed)
        return;
      closed = true;
      for (const port of ports)
        port.closed = true;
      ports.clear();
      learned.clear();
    }
  };
}
function random_mac() {
  const address = crypto.getRandomValues(new Uint8Array(6));
  address[0] = (address[0] | 2) & 254;
  return Array.from(address);
}
function copy_packet(chain, packet) {
  let offset = 0;
  for (const descriptor of chain) {
    assert(descriptor.writable, "virtio-net receive descriptor must be writable");
    const length = Math.min(packet.byteLength - offset, descriptor.array.byteLength);
    if (length > 0)
      descriptor.array.set(packet.subarray(offset, offset + length));
    offset += length;
  }
  assert(offset === packet.byteLength, "virtio-net receive buffer is too small");
  chain.release(offset);
}
function ethernetDevice(network2, { macAddress = random_mac() } = {}) {
  assert(macAddress.length === 6 && macAddress.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255), "invalid MAC address");
  const receive_buffers = [];
  const pending_frames = [];
  let controller;
  function flush_receive() {
    while (receive_buffers.length > 0 && pending_frames.length > 0) {
      const frame = pending_frames.shift();
      const packet = new Bytes(VirtioNetHeader.size + frame.byteLength);
      packet.alloc(VirtioNetHeader).value = {
        flags: 0,
        gso_type: 0,
        header_length: 0,
        gso_size: 0,
        checksum_start: 0,
        checksum_offset: 0,
        buffer_count: 1
      };
      packet.append(frame);
      copy_packet(receive_buffers.shift(), packet.array);
    }
  }
  const port = network2.addPort((frame) => {
    if (pending_frames.length === MAX_PENDING_FRAMES)
      pending_frames.shift();
    pending_frames.push(frame.slice());
    flush_receive();
  });
  function receive(queue) {
    for (const chain of queue)
      receive_buffers.push(chain);
    flush_receive();
  }
  async function transmit(queue, controller2) {
    for (const chain of queue) {
      const chunks = [];
      let length = 0;
      for (const descriptor of chain) {
        assert(!descriptor.writable, "virtio-net transmit descriptor must be readable");
        chunks.push(descriptor.array);
        length += descriptor.array.byteLength;
      }
      assert(length >= VirtioNetHeader.size, "short virtio-net transmit header");
      const frame = new Bytes(length - VirtioNetHeader.size);
      let source_offset = VirtioNetHeader.size;
      for (const chunk of chunks) {
        if (source_offset >= chunk.byteLength) {
          source_offset -= chunk.byteLength;
          continue;
        }
        frame.append(chunk.subarray(source_offset));
        source_offset = 0;
      }
      assert(frame.length === frame.capacity, "short virtio-net transmit frame");
      await port.send(frame.array);
      chain.release(0);
    }
  }
  const config = Uint8Array.from(macAddress);
  controller = new VirtioController({ deviceId: 1, features: 1n << 5n, config }, {
    queues: [receive, transmit],
    reset() {
      receive_buffers.length = 0;
    },
    close() {
      port.close();
      receive_buffers.length = 0;
      pending_frames.length = 0;
    }
  });
  return controller.expose({ macAddress });
}

// web/linux/dist/virtio/vsock.js
var VsockConfig = class extends Struct({ guest_cid: U64LE }) {
};
var VsockHeader = class extends Struct({
  src_cid: U64LE,
  dst_cid: U64LE,
  src_port: U32LE,
  dst_port: U32LE,
  len: U32LE,
  type: U16LE,
  op: U16LE,
  flags: U32LE,
  buf_alloc: U32LE,
  fwd_cnt: U32LE
}) {
};
var DEFAULT_VSOCK_BUF_ALLOC = 256 * 1024;

// web/linux/dist/virtio/input.js
var Ev = {
  SYN: 0,
  KEY: 1,
  REL: 2,
  ABS: 3,
  REP: 20
};
var Syn = {
  REPORT: 0
};
var Rel = {
  X: 0,
  Y: 1,
  WHEEL: 8
};
var Abs = {
  X: 0,
  Y: 1
};
var Key = {
  RESERVED: 0,
  ESC: 1,
  "1": 2,
  "2": 3,
  "3": 4,
  "4": 5,
  "5": 6,
  "6": 7,
  "7": 8,
  "8": 9,
  "9": 10,
  "0": 11,
  MINUS: 12,
  EQUAL: 13,
  BACKSPACE: 14,
  TAB: 15,
  Q: 16,
  W: 17,
  E: 18,
  R: 19,
  T: 20,
  Y: 21,
  U: 22,
  I: 23,
  O: 24,
  P: 25,
  LEFTBRACE: 26,
  RIGHTBRACE: 27,
  ENTER: 28,
  LEFTCTRL: 29,
  A: 30,
  S: 31,
  D: 32,
  F: 33,
  G: 34,
  H: 35,
  J: 36,
  K: 37,
  L: 38,
  SEMICOLON: 39,
  APOSTROPHE: 40,
  GRAVE: 41,
  LEFTSHIFT: 42,
  BACKSLASH: 43,
  Z: 44,
  X: 45,
  C: 46,
  V: 47,
  B: 48,
  N: 49,
  M: 50,
  COMMA: 51,
  DOT: 52,
  SLASH: 53,
  RIGHTSHIFT: 54,
  LEFTALT: 56,
  SPACE: 57,
  CAPSLOCK: 58,
  F1: 59,
  F2: 60,
  F3: 61,
  F4: 62,
  F5: 63,
  F6: 64,
  F7: 65,
  F8: 66,
  F9: 67,
  F10: 68,
  F11: 87,
  F12: 88,
  RIGHTCTRL: 97,
  RIGHTALT: 100,
  KPENTER: 96,
  KPSLASH: 98,
  SYSRQ: 99,
  NUMLOCK: 69,
  SCROLLLOCK: 70,
  KPASTERISK: 55,
  KPMINUS: 74,
  KPPLUS: 78,
  KP0: 82,
  KP1: 79,
  KP2: 80,
  KP3: 81,
  KP4: 75,
  KP5: 76,
  KP6: 77,
  KP7: 71,
  KP8: 72,
  KP9: 73,
  KPDOT: 83,
  LEFTMETA: 125,
  RIGHTMETA: 126,
  MENU: 139,
  PAUSE: 119,
  HOME: 102,
  UP: 103,
  PAGEUP: 104,
  LEFT: 105,
  RIGHT: 106,
  END: 107,
  DOWN: 108,
  PAGEDOWN: 109,
  INSERT: 110,
  DELETE: 111,
  /** Mouse buttons (BTN_*). */
  BTN_LEFT: 272,
  BTN_RIGHT: 273,
  BTN_MIDDLE: 274
};
var CFG_ID_NAME = 1;
var CFG_ID_SERIAL = 2;
var CFG_ID_DEVIDS = 3;
var CFG_PROP_BITS = 16;
var CFG_EV_BITS = 17;
var CFG_ABS_INFO = 18;
var PROP_DIRECT = 1;
var InputEvent = class extends Struct({
  type: U16LE,
  code: U16LE,
  value: U32LE
}) {
};
function set_bit(bitmap, bit) {
  bitmap[bit >> 3] |= 1 << (bit & 7);
}
function write_string(config, text) {
  const bytes = new TextEncoder().encode(text);
  config.fill(0, 8);
  const n = Math.min(bytes.length, 128);
  config.set(bytes.subarray(0, n), 8);
  return n;
}
function write_absinfo(config, min, max, fuzz = 0, flat = 0, res = 0) {
  config.fill(0, 8);
  const view = new DataView(config.buffer, config.byteOffset + 8, 20);
  view.setUint32(0, min >>> 0, true);
  view.setUint32(4, max >>> 0, true);
  view.setUint32(8, fuzz >>> 0, true);
  view.setUint32(12, flat >>> 0, true);
  view.setUint32(16, res >>> 0, true);
  return 20;
}
function inputDevice(options) {
  const name = options?.name ?? "wasm keyboard/mouse";
  const serial = options?.serial ?? "wasm0";
  const absXMax = options?.absXMax ?? 1023;
  const absYMax = options?.absYMax ?? 767;
  const config_bytes = new Uint8Array(8 + 128);
  const keybits = new Uint8Array(64);
  for (let code = 1; code <= 255; code++)
    set_bit(keybits, code);
  set_bit(keybits, Key.BTN_LEFT);
  set_bit(keybits, Key.BTN_RIGHT);
  set_bit(keybits, Key.BTN_MIDDLE);
  const relbits = new Uint8Array(16);
  set_bit(relbits, Rel.X);
  set_bit(relbits, Rel.Y);
  set_bit(relbits, Rel.WHEEL);
  const absbits = new Uint8Array(8);
  set_bit(absbits, Abs.X);
  set_bit(absbits, Abs.Y);
  const propbits = new Uint8Array(1);
  set_bit(propbits, PROP_DIRECT);
  const respond = (guest) => {
    const select = guest[0];
    const subsel = guest[1];
    guest.fill(0, 2);
    guest[0] = select;
    guest[1] = subsel;
    switch (select) {
      case CFG_ID_NAME:
        guest[2] = write_string(guest, name);
        break;
      case CFG_ID_SERIAL:
        guest[2] = write_string(guest, serial);
        break;
      case CFG_ID_DEVIDS:
        guest[2] = 0;
        break;
      case CFG_PROP_BITS:
        guest.fill(0, 8);
        guest.set(propbits, 8);
        guest[2] = propbits.length;
        break;
      case CFG_EV_BITS:
        guest.fill(0, 8);
        if (subsel === Ev.KEY) {
          guest.set(keybits, 8);
          guest[2] = keybits.length;
        } else if (subsel === Ev.REL) {
          guest.set(relbits, 8);
          guest[2] = relbits.length;
        } else if (subsel === Ev.ABS) {
          guest.set(absbits, 8);
          guest[2] = absbits.length;
        } else if (subsel === Ev.REP) {
          guest[8] = 255;
          guest[2] = 1;
        } else {
          guest[2] = 0;
        }
        break;
      case CFG_ABS_INFO:
        if (subsel === Abs.X) {
          guest[2] = write_absinfo(guest, 0, absXMax);
        } else if (subsel === Abs.Y) {
          guest[2] = write_absinfo(guest, 0, absYMax);
        } else {
          guest[2] = 0;
        }
        break;
      default:
        guest[2] = 0;
        break;
    }
  };
  config_bytes[0] = CFG_ID_NAME;
  respond(config_bytes);
  const pending2 = [];
  const event_chains = [];
  const MAX_PENDING_EVENTS = 512;
  function flush() {
    while (pending2.length > 0 && event_chains.length > 0) {
      const chain = event_chains.shift();
      const evt = pending2.shift();
      const [desc, trailing] = chain;
      assert(desc && desc.writable, "input event buffer must be writable");
      assert(!trailing, "input event must be a single descriptor");
      assert(desc.array.byteLength >= InputEvent.size);
      const view = new InputEvent(desc.array.subarray(0, InputEvent.size));
      view.type = evt.type;
      view.code = evt.code;
      view.value = evt.value;
      chain.release(InputEvent.size);
    }
  }
  function enqueue(type2, code, value) {
    if (pending2.length >= MAX_PENDING_EVENTS) {
      pending2.splice(0, pending2.length >> 1);
    }
    pending2.push({ type: type2, code, value });
    flush();
  }
  const controller = new VirtioController({
    deviceId: 18,
    // VIRTIO_ID_INPUT
    config: config_bytes
  }, {
    queues: [
      (queue) => {
        for (const chain of queue)
          event_chains.push(chain);
        flush();
      },
      (queue) => {
        for (const chain of queue)
          chain.release(0);
      }
    ],
    configWritten(guest) {
      respond(guest);
      config_bytes.set(guest.subarray(0, config_bytes.byteLength));
    },
    reset() {
      event_chains.length = 0;
    }
  });
  const api = {
    send(type2, code, value) {
      enqueue(type2, code, value);
    },
    key(code, down) {
      enqueue(Ev.KEY, code, down ? 1 : 0);
      enqueue(Ev.SYN, Syn.REPORT, 0);
    },
    move(dx, dy) {
      if (dx)
        enqueue(Ev.REL, Rel.X, dx);
      if (dy)
        enqueue(Ev.REL, Rel.Y, dy);
      enqueue(Ev.SYN, Syn.REPORT, 0);
    },
    abs(x, y) {
      const cx = Math.max(0, Math.min(absXMax, x | 0));
      const cy = Math.max(0, Math.min(absYMax, y | 0));
      const n = pending2.length;
      if (n >= 3) {
        const a = pending2[n - 3];
        const b = pending2[n - 2];
        const c = pending2[n - 1];
        if (a.type === Ev.ABS && a.code === Abs.X && b.type === Ev.ABS && b.code === Abs.Y && c.type === Ev.SYN && c.code === Syn.REPORT) {
          a.value = cx;
          b.value = cy;
          flush();
          return;
        }
      }
      enqueue(Ev.ABS, Abs.X, cx);
      enqueue(Ev.ABS, Abs.Y, cy);
      enqueue(Ev.SYN, Syn.REPORT, 0);
    },
    button(code, down) {
      enqueue(Ev.KEY, code, down ? 1 : 0);
      enqueue(Ev.SYN, Syn.REPORT, 0);
    },
    wheel(delta) {
      if (!delta)
        return;
      enqueue(Ev.REL, Rel.WHEEL, delta | 0);
      enqueue(Ev.SYN, Syn.REPORT, 0);
    }
  };
  return controller.expose(api);
}

// web/linux/dist/network/gateway.js
var GATEWAY_ADDRESS = "192.0.2.1";
var GATEWAY_IP = ipv4_number(GATEWAY_ADDRESS);
var GATEWAY_MAC = [2, 0, 0, 0, 0, 1];
var TCP_MSS = 1200;
var TCP_RECEIVE_WINDOW = 65535;
var TCP_TIMEOUT_MS = 3e4;
var UDP_READABLE_QUEUE_CAP = 64;
var ETHERNET_MTU = 1500;
var IP_REASSEMBLY_TIMEOUT_MS = 6e4;
var MAX_IP_REASSEMBLIES = 64;
var MAX_IP_FRAGMENTS = 64;
var EthernetType = { IPv4: 2048, ARP: 2054 };
var IpProtocol = { ICMP: 1, TCP: 6, UDP: 17 };
var TcpFlag = { FIN: 1, SYN: 2, RST: 4, PSH: 8, ACK: 16 };
var Mac2 = FixedArray(U8, 6);
var EthernetHeader2 = class extends Struct({
  destination: Mac2,
  source: Mac2,
  type: U16BE
}) {
};
var ArpPacket = class extends Struct({
  hardware_type: U16BE,
  protocol_type: U16BE,
  hardware_length: U8,
  protocol_length: U8,
  operation: U16BE,
  sender_mac: Mac2,
  sender_ip: U32BE,
  target_mac: Mac2,
  target_ip: U32BE
}) {
};
var Ipv4Header = class extends Struct({
  version_and_header_length: U8,
  type_of_service: U8,
  total_length: U16BE,
  identification: U16BE,
  flags_and_fragment_offset: U16BE,
  time_to_live: U8,
  protocol: U8,
  header_checksum: U16BE,
  source: U32BE,
  destination: U32BE
}) {
};
var MAX_IP_PAYLOAD = 65535 - Ipv4Header.size;
var IP_FRAGMENT_PAYLOAD = Math.floor((ETHERNET_MTU - Ipv4Header.size) / 8) * 8;
var TcpHeader = class extends Struct({
  source_port: U16BE,
  destination_port: U16BE,
  sequence: U32BE,
  acknowledgement: U32BE,
  data_offset: U8,
  flags: U8,
  window: U16BE,
  header_checksum: U16BE,
  urgent_pointer: U16BE
}) {
};
var TcpPseudoHeader = class extends Struct({
  source: U32BE,
  destination: U32BE,
  zero: U8,
  protocol: U8,
  length: U16BE
}) {
};
var UdpHeader = class extends Struct({
  source_port: U16BE,
  destination_port: U16BE,
  length: U16BE,
  header_checksum: U16BE
}) {
};
var DnsHeader = class extends Struct({
  id: U16BE,
  flags: U16BE,
  question_count: U16BE,
  answer_count: U16BE,
  authority_count: U16BE,
  additional_count: U16BE
}) {
};
var DnsQuestionFooter = class extends Struct({ type: U16BE, klass: U16BE }) {
};
var DnsIpv4Answer = class extends Struct({
  name: U16BE,
  type: U16BE,
  klass: U16BE,
  ttl: U32BE,
  length: U16BE,
  address: U32BE
}) {
};
var do_attach_guest = /* @__PURE__ */ Symbol("attach guest to network");
function ipv4_number(address) {
  const parts = address.split(".");
  if (parts.length !== 4)
    throw new TypeError(`invalid IPv4 address: ${address}`);
  let result = 0;
  for (const part of parts) {
    const byte = Number(part);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255 || String(byte) !== part) {
      throw new TypeError(`invalid IPv4 address: ${address}`);
    }
    result = result << 8 | byte;
  }
  return result >>> 0;
}
function ipv4_string(address) {
  return [address >>> 24, address >>> 16 & 255, address >>> 8 & 255, address & 255].join(".");
}
function checksum(...parts) {
  let sum = 0;
  let high;
  for (const part of parts) {
    for (const byte of part) {
      if (high === void 0)
        high = byte;
      else {
        sum += high << 8 | byte;
        high = void 0;
      }
    }
  }
  if (high !== void 0)
    sum += high << 8;
  while (sum >>> 16)
    sum = (sum & 65535) + (sum >>> 16);
  return ~sum & 65535;
}
function sequence_add(sequence, amount) {
  return sequence + amount >>> 0;
}
function random_sequence() {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
function valid_port(port) {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}
function tcp_key(guest_ip, guest_port, peer_ip, peer_port) {
  return `${guest_ip}:${guest_port}:${peer_ip}:${peer_port}`;
}
function udp_key(guest_ip, guest_port, host_port) {
  return `${guest_ip}:${guest_port}:${host_port}`;
}
function parse_ip(frame) {
  if (frame.byteLength < EthernetHeader2.size + Ipv4Header.size)
    return;
  if (new EthernetHeader2(frame).type !== EthernetType.IPv4)
    return;
  const bytes = frame.subarray(EthernetHeader2.size);
  const header = new Ipv4Header(bytes);
  const header_length = (header.version_and_header_length & 15) * 4;
  if (header.version_and_header_length >>> 4 !== 4 || header_length < Ipv4Header.size || header_length > bytes.byteLength)
    return;
  if (header.total_length < header_length || header.total_length > bytes.byteLength)
    return;
  const payload = bytes.subarray(header_length, header.total_length);
  const offset = (header.flags_and_fragment_offset & 8191) * 8;
  const more_fragments = (header.flags_and_fragment_offset & 8192) !== 0;
  if ((offset !== 0 || more_fragments) && payload.byteLength === 0)
    return;
  if (more_fragments && payload.byteLength % 8 !== 0)
    return;
  if (offset + payload.byteLength > MAX_IP_PAYLOAD)
    return;
  return {
    source: header.source,
    destination: header.destination,
    protocol: header.protocol,
    payload,
    identification: header.identification,
    header_length,
    offset,
    more_fragments
  };
}
function parse_tcp(payload) {
  if (payload.byteLength < TcpHeader.size)
    return;
  const header = new TcpHeader(payload);
  const header_length = (header.data_offset >>> 4) * 4;
  if (header_length < TcpHeader.size || header_length > payload.byteLength)
    return;
  return {
    source_port: header.source_port,
    destination_port: header.destination_port,
    sequence: header.sequence,
    acknowledgement: header.acknowledgement,
    flags: header.flags,
    window: header.window,
    payload: payload.subarray(header_length)
  };
}
function parse_udp(payload) {
  if (payload.byteLength < UdpHeader.size)
    return;
  const header = new UdpHeader(payload);
  if (header.length < UdpHeader.size || header.length > payload.byteLength)
    return;
  return {
    source_port: header.source_port,
    destination_port: header.destination_port,
    payload: payload.subarray(UdpHeader.size, header.length)
  };
}
function decode_dns_name(packet, offset) {
  const labels = [];
  for (; ; ) {
    const length = packet[offset++];
    if (length === void 0)
      throw new Error("truncated DNS name");
    if (length === 0)
      break;
    if ((length & 192) !== 0 || offset + length > packet.byteLength) {
      throw new Error("unsupported DNS name");
    }
    labels.push(new TextDecoder().decode(packet.subarray(offset, offset + length)));
    offset += length;
  }
  return { hostname: labels.join("."), end: offset };
}
function dns_response(query, addresses) {
  if (query.byteLength < DnsHeader.size)
    throw new Error("short DNS query");
  const input = new DnsHeader(query);
  if (input.question_count !== 1)
    throw new Error("DNS query must have one question");
  const name = decode_dns_name(query, DnsHeader.size);
  if (name.end + DnsQuestionFooter.size > query.byteLength) {
    throw new Error("truncated DNS question");
  }
  const question_end = name.end + DnsQuestionFooter.size;
  const question = new DnsQuestionFooter(query.subarray(name.end));
  const answer_addresses = question.type === 1 && question.klass === 1 ? addresses : [];
  const result = new Bytes(question_end + answer_addresses.length * DnsIpv4Answer.size);
  const header = result.alloc(DnsHeader);
  result.append(query.subarray(DnsHeader.size, question_end));
  header.value = {
    id: input.id,
    flags: 33152,
    question_count: 1,
    answer_count: answer_addresses.length,
    authority_count: 0,
    additional_count: 0
  };
  for (const address of answer_addresses) {
    result.alloc(DnsIpv4Answer).value = {
      name: 49164,
      type: 1,
      klass: 1,
      ttl: 60,
      length: 4,
      address: ipv4_number(address)
    };
  }
  return result.array;
}
function createNetwork({ connectTcp, resolveDns }) {
  const ethernet = ethernetNetwork();
  const attachments = /* @__PURE__ */ new Map();
  const tcp_flows = /* @__PURE__ */ new Map();
  const udp_flows = /* @__PURE__ */ new Map();
  const ip_reassemblies = /* @__PURE__ */ new Map();
  let next_address = 2;
  let next_port = 49152;
  let ip_identifier = 0;
  let closed = false;
  function allocate_port(in_use) {
    for (let attempts = 0; attempts < 65535 - 49152; attempts++) {
      const port = next_port;
      next_port = port === 65535 ? 49152 : port + 1;
      if (!in_use(port))
        return port;
    }
    throw new Error("no network ports available");
  }
  function ip_packet(destination_mac, source_ip, destination_ip, protocol, payload, identification, flags_and_fragment_offset) {
    const frame = new Bytes(EthernetHeader2.size + Ipv4Header.size + payload.byteLength);
    frame.alloc(EthernetHeader2).value = {
      destination: [...destination_mac],
      source: [...GATEWAY_MAC],
      type: EthernetType.IPv4
    };
    const allocated = frame.alloc(Ipv4Header);
    allocated.value = {
      version_and_header_length: 69,
      type_of_service: 0,
      total_length: Ipv4Header.size + payload.byteLength,
      identification,
      flags_and_fragment_offset,
      time_to_live: 64,
      protocol,
      header_checksum: 0,
      source: source_ip,
      destination: destination_ip
    };
    allocated.value.header_checksum = checksum(frame.array.subarray(EthernetHeader2.size, EthernetHeader2.size + Ipv4Header.size));
    frame.append(payload);
    return frame.array;
  }
  async function send_ip(destination_mac, source_ip, destination_ip, protocol, payload) {
    if (payload.byteLength > MAX_IP_PAYLOAD)
      throw new RangeError("IPv4 payload is too large");
    const identification = ip_identifier++ & 65535;
    if (payload.byteLength <= IP_FRAGMENT_PAYLOAD) {
      await gateway.send(ip_packet(destination_mac, source_ip, destination_ip, protocol, payload, identification, 16384));
      return;
    }
    for (let offset = 0; offset < payload.byteLength; offset += IP_FRAGMENT_PAYLOAD) {
      const end = Math.min(offset + IP_FRAGMENT_PAYLOAD, payload.byteLength);
      await gateway.send(ip_packet(destination_mac, source_ip, destination_ip, protocol, payload.subarray(offset, end), identification, (end < payload.byteLength ? 8192 : 0) | offset / 8));
    }
  }
  function tcp_segment(source_ip, destination_ip, source_port, destination_port, sequence, acknowledgement, flags, payload = new Uint8Array(), window2 = TCP_RECEIVE_WINDOW) {
    const pseudo = new Bytes(TcpPseudoHeader.size);
    pseudo.alloc(TcpPseudoHeader).value = {
      source: source_ip,
      destination: destination_ip,
      zero: 0,
      protocol: IpProtocol.TCP,
      length: TcpHeader.size + payload.byteLength
    };
    const segment = new Bytes(TcpHeader.size + payload.byteLength);
    const header = segment.alloc(TcpHeader);
    header.value = {
      source_port,
      destination_port,
      sequence,
      acknowledgement,
      data_offset: 5 << 4,
      flags,
      window: window2,
      header_checksum: 0,
      urgent_pointer: 0
    };
    segment.append(payload);
    header.value.header_checksum = checksum(pseudo.array, segment.array);
    return segment.array;
  }
  function udp_datagram(source_port, destination_port, payload) {
    const datagram = new Bytes(UdpHeader.size + payload.byteLength);
    datagram.alloc(UdpHeader).value = {
      source_port,
      destination_port,
      length: UdpHeader.size + payload.byteLength,
      header_checksum: 0
    };
    datagram.append(payload);
    return datagram.array;
  }
  async function send_tcp(flow, flags, payload = new Uint8Array()) {
    const window2 = tcp_receive_window(flow);
    const segment = tcp_segment(flow.peer_ip, flow.guest.ip, flow.peer_port, flow.guest_port, flow.send_sequence, flow.receive_sequence, flags, payload, window2);
    flow.advertised_window = window2;
    await send_ip(flow.guest.macAddress, flow.peer_ip, flow.guest.ip, IpProtocol.TCP, segment);
  }
  function tcp_receive_window(flow) {
    if (!flow.readable)
      return TCP_RECEIVE_WINDOW;
    if (flow.activation)
      return flow.receive_demand ? TCP_RECEIVE_WINDOW : 0;
    return Math.max(0, Math.min(TCP_RECEIVE_WINDOW, Math.floor(flow.readable.desiredSize ?? 0)));
  }
  function update_tcp_window(flow) {
    flow.receive_tail = flow.receive_tail.then(async () => {
      if (!flow.closed && flow.established && tcp_receive_window(flow) > flow.advertised_window) {
        await send_tcp(flow, TcpFlag.ACK);
      }
    }).catch((error) => {
      abort_tcp_flow(flow, error);
    });
  }
  function wait_for_ack(flow, acknowledgement) {
    return new Promise((resolve, reject) => {
      const waiter = {
        acknowledgement,
        resolve,
        reject,
        timeout: setTimeout(() => {
          const index = flow.ack_waiters.indexOf(waiter);
          if (index !== -1)
            flow.ack_waiters.splice(index, 1);
          reject(new Error("timed out waiting for guest TCP acknowledgement"));
        }, TCP_TIMEOUT_MS)
      };
      flow.ack_waiters.push(waiter);
    });
  }
  function acknowledge_waiters(flow, acknowledgement) {
    for (let index = flow.ack_waiters.length - 1; index >= 0; index--) {
      const waiter = flow.ack_waiters[index];
      if (waiter.acknowledgement !== acknowledgement)
        continue;
      clearTimeout(waiter.timeout);
      flow.ack_waiters.splice(index, 1);
      waiter.resolve();
    }
  }
  function update_peer_window(flow, window2) {
    flow.peer_window = window2;
    if (window2 === 0)
      return;
    for (const waiter of flow.window_waiters.splice(0))
      waiter.resolve();
  }
  async function wait_for_peer_window(flow) {
    while (!flow.closed && flow.peer_window === 0) {
      const waiter = Promise.withResolvers();
      flow.window_waiters.push(waiter);
      await waiter.promise;
    }
    if (flow.closed || flow.local_ended)
      throw new Error("TCP connection is closed");
    return flow.peer_window;
  }
  async function send_tcp_data(flow, data) {
    for (let offset = 0; offset < data.byteLength; ) {
      if (flow.closed || flow.local_ended)
        throw new Error("TCP connection is closed");
      const peer_window = await wait_for_peer_window(flow);
      const length = Math.min(TCP_MSS, peer_window, data.byteLength - offset);
      const payload = data.slice(offset, offset + length);
      const acknowledgement = sequence_add(flow.send_sequence, payload.byteLength);
      const acked = wait_for_ack(flow, acknowledgement);
      await send_tcp(flow, TcpFlag.ACK | TcpFlag.PSH, payload);
      flow.send_sequence = acknowledgement;
      await acked;
      offset += length;
    }
  }
  async function send_tcp_fin(flow) {
    if (flow.closed || flow.local_ended)
      return;
    await wait_for_peer_window(flow);
    flow.local_ended = true;
    const acknowledgement = sequence_add(flow.send_sequence, 1);
    const acked = wait_for_ack(flow, acknowledgement);
    await send_tcp(flow, TcpFlag.ACK | TcpFlag.FIN);
    flow.send_sequence = acknowledgement;
    await acked;
    if (flow.remote_ended)
      close_tcp_flow(flow);
  }
  function close_tcp_flow(flow, error) {
    if (flow.closed)
      return;
    flow.closed = true;
    tcp_flows.delete(flow.key);
    if (flow.handshake_timeout !== void 0)
      clearTimeout(flow.handshake_timeout);
    for (const waiter of flow.ack_waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error ?? new Error("TCP connection closed"));
    }
    flow.ack_waiters.length = 0;
    for (const waiter of flow.window_waiters) {
      waiter.reject(error ?? new Error("TCP connection closed"));
    }
    flow.window_waiters.length = 0;
    flow.remove_external_abort?.();
    flow.activation_waiter?.reject(error ?? new Error("TCP connection closed"));
    flow.activation_waiter = void 0;
    flow.abort?.abort(error ?? new Error("TCP connection closed"));
    if (error !== void 0) {
      try {
        flow.readable?.error(error);
      } catch {
      }
      flow.handshake?.reject(error);
    } else {
      try {
        flow.readable?.close();
      } catch {
      }
    }
  }
  function abort_tcp_flow(flow, error) {
    if (flow.closed)
      return;
    void send_tcp(flow, TcpFlag.RST | TcpFlag.ACK).catch(() => {
    });
    close_tcp_flow(flow, error);
  }
  function expire_tcp_handshake(flow, message) {
    flow.handshake_timeout = setTimeout(() => {
      abort_tcp_flow(flow, new Error(message));
    }, TCP_TIMEOUT_MS);
  }
  function establish_tcp_flow(flow) {
    flow.established = true;
    flow.activation_waiter?.resolve();
    flow.activation_waiter = void 0;
    if (flow.handshake_timeout !== void 0) {
      clearTimeout(flow.handshake_timeout);
      flow.handshake_timeout = void 0;
    }
  }
  function host_tcp_connection(flow, activate) {
    const readable = new ReadableStream({
      start(controller) {
        flow.readable = controller;
      },
      async pull() {
        flow.receive_demand = true;
        await activate?.();
        update_tcp_window(flow);
      },
      cancel(reason) {
        abort_tcp_flow(flow, reason);
      }
    }, {
      highWaterMark: activate ? 0 : TCP_RECEIVE_WINDOW,
      size(chunk) {
        return chunk.byteLength;
      }
    });
    const writable = new WritableStream({
      async write(chunk) {
        await activate?.();
        return send_tcp_data(flow, chunk);
      },
      async close() {
        await activate?.();
        return send_tcp_fin(flow);
      },
      abort(reason) {
        abort_tcp_flow(flow, reason);
      }
    });
    return {
      readable,
      writable,
      localAddr: { transport: "tcp", hostname: GATEWAY_ADDRESS, port: flow.peer_port },
      remoteAddr: { transport: "tcp", hostname: flow.guest.address, port: flow.guest_port },
      close() {
        abort_tcp_flow(flow);
      }
    };
  }
  function reject_outbound_tcp(flow, error) {
    const rst = tcp_segment(flow.peer_ip, flow.guest.ip, flow.peer_port, flow.guest_port, 0, flow.receive_sequence, TcpFlag.RST | TcpFlag.ACK);
    void send_ip(flow.guest.macAddress, flow.peer_ip, flow.guest.ip, IpProtocol.TCP, rst);
    close_tcp_flow(flow, error);
  }
  function start_outbound_tcp(guest, ip, segment) {
    const key = tcp_key(ip.source, segment.source_port, ip.destination, segment.destination_port);
    if (tcp_flows.has(key))
      return;
    const initial = random_sequence();
    const flow = {
      key,
      guest,
      guest_port: segment.source_port,
      peer_ip: ip.destination,
      peer_port: segment.destination_port,
      send_sequence: initial,
      receive_sequence: sequence_add(segment.sequence, 1),
      established: false,
      local_ended: false,
      remote_ended: false,
      closed: false,
      ack_waiters: [],
      window_waiters: [],
      receive_tail: Promise.resolve(),
      advertised_window: TCP_RECEIVE_WINDOW,
      peer_window: segment.window
    };
    tcp_flows.set(key, flow);
    const abort = new AbortController();
    flow.abort = abort;
    expire_tcp_handshake(flow, `timed out connecting from ${guest.address}:${segment.source_port} to ${ipv4_string(ip.destination)}:${segment.destination_port}`);
    const activate = () => {
      if (flow.activation)
        return flow.activation;
      flow.activation = (async () => {
        const waiter = Promise.withResolvers();
        void waiter.promise.catch(() => {
        });
        flow.activation_waiter = waiter;
        await send_tcp(flow, TcpFlag.SYN | TcpFlag.ACK);
        flow.send_sequence = sequence_add(flow.send_sequence, 1);
        await waiter.promise;
      })();
      return flow.activation;
    };
    const streams = host_tcp_connection(flow, activate);
    const session2 = {
      target: {
        hostname: ip.destination === GATEWAY_IP ? "127.0.0.1" : ipv4_string(ip.destination),
        port: segment.destination_port
      },
      readable: streams.readable,
      writable: streams.writable,
      signal: abort.signal
    };
    Promise.resolve().then(() => connectTcp(session2)).then(() => {
      if (flow.closed)
        return;
      if (!flow.activation) {
        reject_outbound_tcp(flow, new Error("TCP handler completed without using the session"));
        return;
      }
      void send_tcp_fin(flow).catch((error) => abort_tcp_flow(flow, error));
    }, (error) => {
      if (flow.closed)
        return;
      if (flow.activation)
        abort_tcp_flow(flow, error);
      else
        reject_outbound_tcp(flow, error);
    });
  }
  async function process_tcp(flow, segment) {
    if (flow.closed)
      return;
    if (segment.flags & TcpFlag.RST) {
      close_tcp_flow(flow, new Error("guest reset TCP connection"));
      return;
    }
    if (segment.flags & TcpFlag.ACK) {
      update_peer_window(flow, segment.window);
      acknowledge_waiters(flow, segment.acknowledgement);
    }
    if (!flow.established) {
      if (flow.handshake) {
        if ((segment.flags & (TcpFlag.SYN | TcpFlag.ACK)) !== (TcpFlag.SYN | TcpFlag.ACK) || segment.acknowledgement !== flow.send_sequence)
          return;
        flow.receive_sequence = sequence_add(segment.sequence, 1);
        establish_tcp_flow(flow);
        await send_tcp(flow, TcpFlag.ACK);
        flow.handshake.resolve(host_tcp_connection(flow));
        flow.handshake = void 0;
        return;
      }
      if (segment.flags & TcpFlag.ACK && segment.acknowledgement === flow.send_sequence) {
        establish_tcp_flow(flow);
      }
      return;
    }
    const consumes = segment.payload.byteLength + (segment.flags & TcpFlag.FIN ? 1 : 0);
    if (consumes === 0)
      return;
    if (segment.sequence !== flow.receive_sequence) {
      await send_tcp(flow, TcpFlag.ACK);
      return;
    }
    if (segment.payload.byteLength > 0 && segment.payload.byteLength > tcp_receive_window(flow)) {
      await send_tcp(flow, TcpFlag.ACK);
      return;
    }
    if (segment.payload.byteLength > 0) {
      flow.readable?.enqueue(segment.payload.slice());
      flow.receive_demand = false;
      flow.receive_sequence = sequence_add(flow.receive_sequence, segment.payload.byteLength);
    }
    if (segment.flags & TcpFlag.FIN) {
      flow.receive_sequence = sequence_add(flow.receive_sequence, 1);
      flow.remote_ended = true;
      flow.readable?.close();
    }
    await send_tcp(flow, TcpFlag.ACK);
    if (flow.local_ended && flow.remote_ended && flow.ack_waiters.length === 0) {
      close_tcp_flow(flow);
    }
  }
  function receive_tcp(ip, source_mac) {
    const segment = parse_tcp(ip.payload);
    if (!segment)
      return;
    const guest = attachments.get(ip.source);
    if (!guest)
      return;
    if (source_mac.some((byte, index) => byte !== guest.macAddress[index]))
      return;
    const key = tcp_key(ip.source, segment.source_port, ip.destination, segment.destination_port);
    const flow = tcp_flows.get(key);
    if (!flow) {
      if (segment.flags & TcpFlag.SYN && !(segment.flags & TcpFlag.ACK)) {
        start_outbound_tcp(guest, ip, segment);
      }
      return;
    }
    flow.receive_tail = flow.receive_tail.then(() => process_tcp(flow, segment)).catch((error) => {
      abort_tcp_flow(flow, error);
    });
  }
  async function receive_dns(guest, datagram) {
    try {
      const { hostname } = decode_dns_name(datagram.payload, 12);
      const response = dns_response(datagram.payload, await resolveDns(hostname));
      const udp = udp_datagram(53, datagram.source_port, response);
      await send_ip(guest.macAddress, GATEWAY_IP, guest.ip, IpProtocol.UDP, udp);
    } catch {
    }
  }
  function receive_udp(ip) {
    const datagram = parse_udp(ip.payload);
    if (!datagram)
      return;
    const guest = attachments.get(ip.source);
    if (!guest)
      return;
    if (ip.destination === GATEWAY_IP && datagram.destination_port === 53) {
      void receive_dns(guest, datagram);
      return;
    }
    if (ip.destination !== GATEWAY_IP)
      return;
    const flow = udp_flows.get(udp_key(ip.source, datagram.source_port, datagram.destination_port));
    if (flow && (flow.controller.desiredSize ?? 0) > 0) {
      flow.controller.enqueue(datagram.payload.slice());
    }
  }
  function receive_arp(frame) {
    if (frame.byteLength < EthernetHeader2.size + ArpPacket.size)
      return;
    const ethernet_header = new EthernetHeader2(frame);
    const request3 = new ArpPacket(frame.subarray(EthernetHeader2.size));
    if (ethernet_header.type !== EthernetType.ARP || request3.hardware_type !== 1 || request3.protocol_type !== EthernetType.IPv4 || request3.hardware_length !== Mac2.size || request3.protocol_length !== 4 || request3.operation !== 1 || request3.target_ip !== GATEWAY_IP)
      return;
    const reply = new Bytes(EthernetHeader2.size + ArpPacket.size);
    reply.alloc(EthernetHeader2).value = {
      destination: request3.sender_mac,
      source: [...GATEWAY_MAC],
      type: EthernetType.ARP
    };
    reply.alloc(ArpPacket).value = {
      hardware_type: 1,
      protocol_type: EthernetType.IPv4,
      hardware_length: Mac2.size,
      protocol_length: 4,
      operation: 2,
      sender_mac: [...GATEWAY_MAC],
      sender_ip: GATEWAY_IP,
      target_mac: request3.sender_mac,
      target_ip: request3.sender_ip
    };
    void gateway.send(reply.array);
  }
  function ip_reassembly_key(fragment) {
    return `${fragment.source}:${fragment.destination}:${fragment.protocol}:${fragment.identification}`;
  }
  function discard_ip_reassembly(key) {
    const reassembly = ip_reassemblies.get(key);
    if (!reassembly)
      return;
    clearTimeout(reassembly.timeout);
    ip_reassemblies.delete(key);
  }
  function reassemble_ip(fragment) {
    const key = ip_reassembly_key(fragment);
    if (fragment.offset === 0 && !fragment.more_fragments) {
      discard_ip_reassembly(key);
      return fragment;
    }
    let reassembly = ip_reassemblies.get(key);
    if (!reassembly) {
      if (ip_reassemblies.size === MAX_IP_REASSEMBLIES) {
        discard_ip_reassembly(ip_reassemblies.keys().next().value);
      }
      reassembly = {
        source: fragment.source,
        destination: fragment.destination,
        protocol: fragment.protocol,
        fragments: [],
        timeout: setTimeout(() => discard_ip_reassembly(key), IP_REASSEMBLY_TIMEOUT_MS)
      };
      ip_reassemblies.set(key, reassembly);
    }
    const end = fragment.offset + fragment.payload.byteLength;
    if (fragment.offset === 0 && end + fragment.header_length > 65535 || reassembly.total_length !== void 0 && end > reassembly.total_length) {
      discard_ip_reassembly(key);
      return;
    }
    const insertion = reassembly.fragments.findIndex((candidate) => fragment.offset < candidate.offset + candidate.payload.byteLength);
    const next = insertion === -1 ? void 0 : reassembly.fragments[insertion];
    const previous = insertion === -1 ? reassembly.fragments.at(-1) : insertion === 0 ? void 0 : reassembly.fragments[insertion - 1];
    if (previous && fragment.offset < previous.offset + previous.payload.byteLength || next && end > next.offset) {
      const duplicate = reassembly.fragments.find((candidate) => candidate.offset === fragment.offset && candidate.payload.byteLength === fragment.payload.byteLength);
      if (duplicate && duplicate.payload.every((byte, index) => byte === fragment.payload[index])) {
        return;
      }
      discard_ip_reassembly(key);
      return;
    }
    if (reassembly.fragments.length === MAX_IP_FRAGMENTS) {
      discard_ip_reassembly(key);
      return;
    }
    reassembly.fragments.splice(insertion === -1 ? reassembly.fragments.length : insertion, 0, {
      offset: fragment.offset,
      payload: fragment.payload.slice()
    });
    if (!fragment.more_fragments) {
      if (reassembly.total_length !== void 0 && reassembly.total_length !== end) {
        discard_ip_reassembly(key);
        return;
      }
      if (reassembly.fragments.some((candidate) => candidate.offset >= end)) {
        discard_ip_reassembly(key);
        return;
      }
      reassembly.total_length = end;
    }
    if (reassembly.total_length === void 0 || reassembly.fragments[0]?.offset !== 0)
      return;
    let length = 0;
    for (const candidate of reassembly.fragments) {
      if (candidate.offset !== length)
        return;
      length += candidate.payload.byteLength;
    }
    if (length !== reassembly.total_length)
      return;
    const payload = new Uint8Array(length);
    for (const candidate of reassembly.fragments)
      payload.set(candidate.payload, candidate.offset);
    discard_ip_reassembly(key);
    return {
      source: reassembly.source,
      destination: reassembly.destination,
      protocol: reassembly.protocol,
      payload
    };
  }
  function receive_frame(frame) {
    receive_arp(frame);
    const fragment = parse_ip(frame);
    if (!fragment)
      return;
    const ip = reassemble_ip(fragment);
    if (!ip)
      return;
    const source_mac = new EthernetHeader2(frame).source;
    if (ip.protocol === IpProtocol.TCP)
      receive_tcp(ip, source_mac);
    else if (ip.protocol === IpProtocol.UDP)
      receive_udp(ip);
  }
  const gateway = ethernet.addPort(receive_frame);
  function connect_tcp(options) {
    if (options.signal?.aborted)
      return Promise.reject(options.signal.reason);
    if (closed)
      return Promise.reject(new Error("network is closed"));
    if (!valid_port(options.port))
      return Promise.reject(new TypeError("invalid TCP port"));
    let address;
    try {
      address = ipv4_number(options.hostname);
    } catch (error) {
      return Promise.reject(error);
    }
    const guest = attachments.get(address);
    if (!guest)
      return Promise.reject(new Error(`${options.hostname} is not attached to this network`));
    const port = allocate_port((candidate) => tcp_flows.has(tcp_key(guest.ip, options.port, GATEWAY_IP, candidate)));
    const initial = random_sequence();
    const handshake = Promise.withResolvers();
    const key = tcp_key(guest.ip, options.port, GATEWAY_IP, port);
    const flow = {
      key,
      guest,
      guest_port: options.port,
      peer_ip: GATEWAY_IP,
      peer_port: port,
      send_sequence: sequence_add(initial, 1),
      receive_sequence: 0,
      established: false,
      local_ended: false,
      remote_ended: false,
      closed: false,
      ack_waiters: [],
      window_waiters: [],
      receive_tail: Promise.resolve(),
      advertised_window: TCP_RECEIVE_WINDOW,
      peer_window: 0,
      handshake
    };
    tcp_flows.set(key, flow);
    expire_tcp_handshake(flow, `timed out connecting to ${options.hostname}:${options.port}`);
    const syn = tcp_segment(GATEWAY_IP, guest.ip, port, options.port, initial, 0, TcpFlag.SYN);
    void send_ip(guest.macAddress, GATEWAY_IP, guest.ip, IpProtocol.TCP, syn).catch((error) => {
      close_tcp_flow(flow, error);
    });
    if (options.signal) {
      const abort = () => abort_tcp_flow(flow, options.signal.reason);
      options.signal.addEventListener("abort", abort, { once: true });
      flow.remove_external_abort = () => options.signal.removeEventListener("abort", abort);
      if (options.signal.aborted)
        abort();
    }
    return handshake.promise;
  }
  function connect_udp(options) {
    if (closed)
      return Promise.reject(new Error("network is closed"));
    if (!valid_port(options.port))
      return Promise.reject(new TypeError("invalid UDP port"));
    let address;
    try {
      address = ipv4_number(options.hostname);
    } catch (error) {
      return Promise.reject(error);
    }
    const guest = attachments.get(address);
    if (!guest)
      return Promise.reject(new Error(`${options.hostname} is not attached to this network`));
    const host_port = allocate_port((candidate) => udp_flows.has(udp_key(guest.ip, options.port, candidate)));
    const key = udp_key(guest.ip, options.port, host_port);
    let controller;
    const readable = new ReadableStream({
      start(value) {
        controller = value;
      },
      cancel() {
        close();
      }
    }, {
      highWaterMark: UDP_READABLE_QUEUE_CAP,
      size() {
        return 1;
      }
    });
    const flow = {
      key,
      guest,
      guest_port: options.port,
      host_port,
      readable,
      controller,
      closed: false
    };
    udp_flows.set(key, flow);
    const close = () => {
      if (flow.closed)
        return;
      flow.closed = true;
      udp_flows.delete(key);
      try {
        controller.close();
      } catch {
      }
    };
    const writable = new WritableStream({
      async write(payload) {
        if (flow.closed)
          throw new Error("UDP connection is closed");
        const datagram = udp_datagram(host_port, options.port, payload);
        await send_ip(guest.macAddress, GATEWAY_IP, guest.ip, IpProtocol.UDP, datagram);
      },
      close,
      abort: close
    });
    return Promise.resolve({
      readable,
      writable,
      localAddr: { transport: "udp", hostname: GATEWAY_ADDRESS, port: host_port },
      remoteAddr: { transport: "udp", hostname: guest.address, port: options.port },
      close
    });
  }
  const network2 = {
    gateway: GATEWAY_ADDRESS,
    connect(options) {
      return options.transport === "udp" ? connect_udp(options) : connect_tcp(options);
    },
    [do_attach_guest]() {
      if (closed)
        throw new Error("network is closed");
      if (next_address > 254)
        throw new Error("network has no guest addresses left");
      const suffix = next_address++;
      const address = `192.0.2.${suffix}`;
      const ip = ipv4_number(address);
      const macAddress = [2, 0, 0, 0, 0, suffix];
      const device = ethernetDevice(ethernet, { macAddress });
      let attached = true;
      const attachment = {
        address,
        ip,
        macAddress,
        device,
        close() {
          if (!attached)
            return;
          attached = false;
          attachments.delete(ip);
          for (const flow of tcp_flows.values()) {
            if (flow.guest === attachment)
              abort_tcp_flow(flow, new Error("guest detached from network"));
          }
          for (const flow of udp_flows.values()) {
            if (flow.guest === attachment) {
              flow.closed = true;
              udp_flows.delete(flow.key);
              flow.controller.close();
            }
          }
          for (const [key, reassembly] of ip_reassemblies) {
            if (reassembly.source === ip)
              discard_ip_reassembly(key);
          }
        }
      };
      attachments.set(ip, attachment);
      return attachment;
    },
    close() {
      if (closed)
        return;
      closed = true;
      for (const flow of tcp_flows.values())
        abort_tcp_flow(flow, new Error("network closed"));
      for (const flow of udp_flows.values()) {
        flow.closed = true;
        flow.controller.close();
      }
      tcp_flows.clear();
      udp_flows.clear();
      for (const key of ip_reassemblies.keys())
        discard_ip_reassembly(key);
      attachments.clear();
      gateway.close();
      ethernet.close();
    },
    [Symbol.dispose]() {
      network2.close();
    }
  };
  return network2;
}
function attach_guest(network2) {
  const attachment = network2[do_attach_guest]();
  const guest_network = {
    address: attachment.address,
    connect(options) {
      return network2.connect({ ...options, hostname: attachment.address });
    }
  };
  return { attachment, guest_network };
}

// web/linux/dist/network/ws-tcp.js
function join_url(base, path, query) {
  const url = new URL(path, base.endsWith("/") ? base : `${base}/`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url;
}
function ws_url(httpish) {
  const url = new URL(httpish);
  if (url.protocol === "http:")
    url.protocol = "ws:";
  else if (url.protocol === "https:")
    url.protocol = "wss:";
  return url;
}
async function connectTcpOverWebSocket(session2, options) {
  const target = join_url(options.proxyUrl, "tcp", {
    host: session2.target.hostname,
    port: String(session2.target.port)
  });
  const socket2 = new WebSocket(ws_url(target));
  socket2.binaryType = "arraybuffer";
  const opened = Promise.withResolvers();
  const on_open = () => opened.resolve();
  const on_early_error = (event) => {
    opened.reject(new Error(`websocket proxy failed for ${session2.target.hostname}:${session2.target.port}`, { cause: event }));
  };
  socket2.addEventListener("open", on_open, { once: true });
  socket2.addEventListener("error", on_early_error, { once: true });
  const abort = () => {
    try {
      socket2.close();
    } catch {
    }
  };
  session2.signal.addEventListener("abort", abort, { once: true });
  options.signal?.addEventListener("abort", abort, { once: true });
  if (session2.signal.aborted || options.signal?.aborted)
    abort();
  try {
    await opened.promise;
  } finally {
    socket2.removeEventListener("error", on_early_error);
  }
  const from_socket = new ReadableStream({
    start(controller) {
      socket2.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          controller.enqueue(new TextEncoder().encode(event.data));
          return;
        }
        controller.enqueue(new Uint8Array(event.data));
      });
      socket2.addEventListener("close", () => {
        try {
          controller.close();
        } catch {
        }
      });
      socket2.addEventListener("error", () => {
        controller.error(new Error("websocket proxy connection error"));
      });
    },
    cancel() {
      abort();
    }
  });
  const to_socket = new WritableStream({
    write(chunk) {
      if (socket2.readyState !== WebSocket.OPEN) {
        throw new Error("websocket proxy is not open");
      }
      const copy = new Uint8Array(chunk.byteLength);
      copy.set(chunk);
      socket2.send(copy);
    },
    close() {
      if (socket2.readyState === WebSocket.OPEN)
        socket2.close();
    },
    abort() {
      abort();
    }
  });
  await Promise.all([
    session2.readable.pipeTo(to_socket, { signal: session2.signal }).catch((error) => {
      abort();
      throw error;
    }),
    from_socket.pipeTo(session2.writable, { signal: session2.signal }).catch((error) => {
      abort();
      throw error;
    })
  ]);
}
async function resolveDnsOverProxy(hostname, options) {
  const url = join_url(options.proxyUrl, "dns", { name: hostname });
  if (url.protocol === "ws:")
    url.protocol = "http:";
  else if (url.protocol === "wss:")
    url.protocol = "https:";
  const response = await fetch(url, { signal: options.signal });
  if (!response.ok) {
    throw new Error(`dns proxy HTTP ${response.status} for ${hostname}`);
  }
  const body = await response.json();
  if (!Array.isArray(body.addresses) || body.addresses.length === 0) {
    throw new Error(`dns proxy returned no addresses for ${hostname}`);
  }
  return body.addresses;
}
function wsTcpProxyNetwork(options) {
  return {
    connectTcp: (session2) => connectTcpOverWebSocket(session2, options),
    resolveDns: (hostname) => resolveDnsOverProxy(hostname, options)
  };
}

// web/linux/dist/index.js
function framebuffer_options(settings, mode, gpu_host) {
  return {
    ...settings,
    ...mode,
    onOverlaySupport(on) {
      gpu_host?.setKeyedPresent(on);
      settings.onOverlaySupport?.(on);
    }
  };
}
var MachinePanicError = class extends Error {
  constructor() {
    super("kernel panic");
    this.name = "MachinePanicError";
  }
};
async function load_resources() {
  const { bytes, module: vmlinux } = await platform.load_wasm(new URL("../vmlinux.wasm", new URL("/linux/dist/index.js", globalThis.__linuxonwebExecutionURL ?? globalThis.location.href).href));
  const memories = read_wasm_memories(bytes);
  assert(memories.imports.length === 1 && memories.definitions.length === 0, "Kernel must define exactly one imported memory");
  const memory = memories.imports[0];
  assert(memory.module === "env" && memory.name === "memory", "Kernel memory must be imported as env.memory");
  assert(memory.type.address === "i32" && memory.type.shared, "Kernel memory must be a shared memory32");
  const custom_section = (name) => {
    const sections2 = WebAssembly.Module.customSections(vmlinux, name);
    const section = sections2[0];
    assert(section && sections2.length === 1, `Missing custom section: ${name}`);
    return section;
  };
  const sections = JSON.parse(new TextDecoder().decode(custom_section(".linux.sections")));
  const initramfs = new Uint8Array(custom_section(".linux.initramfs"));
  return {
    vmlinux,
    memory: memory.type,
    sections,
    initramfs
  };
}
var PAGE_SIZE = 65536;
var KERNEL_MEMORY_MAXIMUM_PAGES = 65535;
function kernel_initial_pages(memory, initcpio_size) {
  const maximum = BigInt(KERNEL_MEMORY_MAXIMUM_PAGES);
  assert(memory.minimum <= maximum && memory.maximum !== void 0 && memory.maximum >= maximum, "Kernel memory limits are incompatible with a 4 GiB - 64 KiB memory");
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
    } else {
      target[name] = value;
    }
  }
}
async function spawnMachine(options) {
  const devices = options.devices;
  let workerScriptURL = options.workerScriptURL == null ? void 0 : new URL(options.workerScriptURL, new URL("/linux/dist/index.js", globalThis.__linuxonwebExecutionURL ?? globalThis.location.href).href);
  if (workerScriptURL && (workerScriptURL.origin !== new URL(new URL("/linux/dist/index.js", globalThis.__linuxonwebExecutionURL ?? globalThis.location.href).href).origin || !/^https?:$/.test(workerScriptURL.protocol) || workerScriptURL.username || workerScriptURL.password || workerScriptURL.search || workerScriptURL.hash || workerScriptURL.pathname !== new URL(`./immutable/${workerScriptURL.pathname.split("/").pop()}`, new URL("/linux/dist/index.js", globalThis.__linuxonwebExecutionURL ?? globalThis.location.href).href).pathname || !/\/immutable\/worker-[a-f0-9]{64}\.mjs$/.test(workerScriptURL.pathname))) {
    throw new TypeError("workerScriptURL must be a same-origin content-addressed worker module");
  }
  let ownedWorkerBlobURL;
  const workers = /* @__PURE__ */ new Set();
  let closed = false;
  let failed = false;
  let finish_error;
  let finish_promise;
  let worker_pool;
  let framebuffer_host = null;
  const audio_host = options.audio ? createAudioHost() : null;
  const gpu_options = options.gpuHostcall ?? {};
  const gpu_host = options.gpuHostcall === false ? null : createGpuHostcallHost({
    ...gpu_options,
    onPresent: (data, reply) => {
      if (data.keyed || data.reset) framebuffer_host?.overlay(data);
      if (data.keyed) {
        if (!framebuffer_host) data.bitmap?.close();
        return;
      }
      if (gpu_options.onPresent) gpu_options.onPresent(data, reply);
      else data.bitmap?.close();
    }
  });
  const framebuffer_mode = {
    width: options.framebuffer?.width ?? 1024,
    height: options.framebuffer?.height ?? 768,
    bpp: options.framebuffer?.bpp ?? 32
  };
  const closed_promise = Promise.withResolvers();
  void closed_promise.promise.catch(() => {
  });
  const boot_console = new TransformStream();
  const boot_console_writer = boot_console.writable.getWriter();
  const boot_console_write = (message) => {
    void boot_console_writer.write(new Uint8Array(message)).catch(() => {
    });
  };
  const boot_console_close = () => {
    void boot_console_writer.close().catch(() => {
    });
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
      } catch (termination_error) {
        if (!failed) {
          failed = true;
          finish_error = termination_error;
        }
      }
      if (ownedWorkerBlobURL) {
        URL.revokeObjectURL(ownedWorkerBlobURL);
        ownedWorkerBlobURL = void 0;
      }
      boot_console_close();
      if (failed)
        closed_promise.reject(finish_error);
      else
        closed_promise.resolve();
    })().finally(() => {
      if (ownedWorkerBlobURL) {
        URL.revokeObjectURL(ownedWorkerBlobURL);
        ownedWorkerBlobURL = void 0;
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
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const timeout = setTimeout(() => controller.abort(), 3e4);
      let bytes;
      try {
        const response = await fetch(workerScriptURL, { signal: controller.signal });
        if (!response.ok) throw new Error(`Worker bundle HTTP ${response.status}`);
        const declared = Number(response.headers.get("content-length") || 0);
        if (declared > 4 * 1024 * 1024) {
          controller.abort();
          await response.body?.cancel().catch(() => {
          });
          throw new Error("Worker bundle is too large");
        }
        if (!response.body) throw new Error("Worker bundle body is missing");
        const reader = response.body.getReader(), chunks = [];
        let length = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (length + value.byteLength > 4 * 1024 * 1024) {
              controller.abort();
              await reader.cancel().catch(() => {
              });
              throw new Error("Worker bundle is too large");
            }
            chunks.push(value);
            length += value.byteLength;
          }
        } finally {
          reader.releaseLock();
        }
        bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
      }
      const digest = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (value) => value.toString(16).padStart(2, "0")
      ).join("");
      if (!workerScriptURL.pathname.endsWith(`worker-${digest}.mjs`))
        throw new Error("Worker bundle integrity check failed");
      signal?.throwIfAborted();
      const bootstrap = `globalThis.__linuxonwebExecutionURL=${JSON.stringify(globalThis.__linuxonwebExecutionURL ?? globalThis.location.href)};
`;
      ownedWorkerBlobURL = URL.createObjectURL(new Blob([bootstrap, bytes], { type: "text/javascript" }));
      workerScriptURL = new URL(ownedWorkerBlobURL);
    }
    const { sections, vmlinux, initramfs, memory: memory_type } = await load_resources();
    const initcpio = options.initcpio ? await options.initcpio : void 0;
    const module_pages = Number(memory_type.minimum);
    const initcpio_addr = module_pages * PAGE_SIZE;
    const pages = kernel_initial_pages(memory_type, initcpio?.byteLength ?? 0);
    const requested_memory = options.devicetree?.memory?.reg?.[1];
    if (requested_memory !== void 0 && (!Number.isSafeInteger(requested_memory) || requested_memory < pages * PAGE_SIZE + 64 * 1024 * 1024)) {
      const required_mib = Math.ceil((pages * PAGE_SIZE + 64 * 1024 * 1024) / (1024 * 1024));
      throw new RangeError(`Selected RAM is too small for this kernel and boot image. This image needs at least ${required_mib} MB including boot workspace. Select more memory.`);
    }
    const preferred_maximum_pages = requested_memory === void 0 ? KERNEL_MEMORY_MAXIMUM_PAGES : Math.min(KERNEL_MEMORY_MAXIMUM_PAGES, Math.floor(requested_memory / PAGE_SIZE));
    const { memory: wasm_memory, maximum_pages } = allocate_shared_memory(pages, preferred_maximum_pages);
    if (requested_memory !== void 0 && requested_memory > maximum_pages * PAGE_SIZE) {
      throw new RangeError("This browser could not reserve the selected RAM. Select less memory or close other tabs.");
    }
    assert(wasm_memory.buffer.byteLength === pages * PAGE_SIZE);
    const devicetree = {
      "#address-cells": 1,
      "#size-cells": 1,
      chosen: {
        "rng-seed": crypto.getRandomValues(new Uint8Array(64)),
        bootargs: `console=hvc0 ${options.cmdline ?? ""}`,
        // Default: four CPUs, capped at the host CPU count.
        ncpus: options.cpus ?? Math.min(4, navigator.hardwareConcurrency || 1)
      },
      aliases: {},
      memory: {
        device_type: "memory",
        reg: [0, maximum_pages * PAGE_SIZE]
      },
      "reserved-memory": {
        "#address-cells": 1,
        "#size-cells": 1,
        ranges: void 0
      }
    };
    for (const [i, dev] of devices.entries()) {
      const device = virtio_device_description(dev);
      devicetree[`virtio${i}`] = {
        compatible: `virtio,wasm`,
        "host-id": i,
        "virtio-device-id": device.device_id,
        features: device.features,
        config: device.config
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
        size: initcpio.byteLength
      });
    }
    devicetree.chosen.sections = sections;
    if (options.devicetree)
      merge_devicetree(devicetree, options.devicetree);
    const generated_devicetree = generate_devicetree(devicetree, {
      memory_reservations
    });
    let instance;
    let virtio_config_written;
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
        }
      }, workerScriptURL);
      workers.add(worker);
      return { worker, slot };
    };
    worker_pool = createWorkerPool({
      capacity: SPARE_WORKERS,
      load: load_worker,
      retire(entry, failed2) {
        if (failed2) {
          workers.delete(entry.worker);
          void entry.worker.terminate();
        } else {
          entry.worker.post({ type: "shutdown" });
        }
      }
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
                  port: message.port
                });
              } catch (error) {
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
              } catch (error) {
                Atomics.store(message.status, 0, -1);
                void fail(error);
              } finally {
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
              workers.delete(worker);
              break;
            }
            default:
              unreachable(message);
          }
        },
        on_error: (error) => {
          const stack = error && typeof error.stack === "string" ? error.stack.slice(0, 8192) : "";
          if (stack)
            console.error("[linux-worker] error stack", stack);
          fail(error);
        }
      };
      worker.post(init, init.type === "forwarded_init" ? [init.port] : void 0);
    };
    const spawn_worker = (fn, arg, name, user, copy_user_memory) => {
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
        gpu: gpu_host?.hub ?? null
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
        }
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
        worker_exit: unavailable
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
        futex_atomic_cmpxchg: unavailable
      },
      virtio: (() => {
        const imports2 = virtio_imports({
          memory: wasm_memory,
          devices,
          on_error: fail,
          trigger_irq(irq) {
            assert(instance);
            instance.exports.trigger_irq(irq);
          }
        });
        virtio_config_written = imports2.config_written;
        return imports2;
      })(),
      fb: framebuffer_imports(wasm_memory, framebuffer_host, framebuffer_mode)
    };
    worker_pool.prewarm();
    instance = await WebAssembly.instantiate(vmlinux, imports);
    instance.exports.boot();
    return {
      memory: wasm_memory,
      resumeAudio: () => audio_host?.resume(),
      get audioStats() {
        return audio_host?.stats ?? null;
      },
      gpuHostcall: gpu_host,
      bootConsole: boot_console.readable,
      closed: closed_promise.promise,
      close,
      [Symbol.dispose]: close
    };
  } catch (error) {
    await fail(error);
    throw error;
  }
}

// web/linux/persistent-home.mjs
var HOME_DATABASE = "linuxonweb.home.v1";
var CHUNK_SIZE = 65536;
var BLOCK_SIZE = 4096;
var HOME_VERSION = 2;
var WRITE_BATCH_BLOCKS = 32;
var DIRECTORY = 16384;
var FILE = 32768;
var SYMLINK = 40960;
var request2 = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
var timestamp2 = () => ({ seconds: BigInt(Math.floor(Date.now() / 1e3)), nanoseconds: Date.now() % 1e3 * 1e6 });
var type = (node2) => node2.mode & 61440;
function nameCheck(name) {
  if (!name || name === "." || name === ".." || /[\0/]/.test(name)) throw new FSError("EINVAL");
  if (new TextEncoder().encode(name).length > 255) throw new FSError("ENAMETOOLONG");
}
function offsetNumber(value) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new FSError("EINVAL");
  return Number(value);
}
async function openPersistentHome({ indexedDB: indexedDB2 = globalThis.indexedDB, name = HOME_DATABASE, onError = () => {
}, readOnly = false } = {}) {
  if (!indexedDB2) throw new Error("This browser does not provide IndexedDB storage.");
  const opening = indexedDB2.open(name, HOME_VERSION);
  opening.onupgradeneeded = (event) => {
    if (readOnly) {
      opening.transaction.abort();
      return;
    }
    if (event.oldVersion >= 1) return;
    const db2 = opening.result;
    const nodes = db2.createObjectStore("nodes", { keyPath: "id", autoIncrement: true });
    nodes.createIndex("entry", ["parent", "name"], { unique: true });
    nodes.createIndex("parent", "parent");
    const chunks = db2.createObjectStore("chunks", { keyPath: ["inode", "index"] });
    chunks.createIndex("inode", "inode");
    const now = timestamp2();
    nodes.put({ id: 1, parent: 0, name: "", mode: DIRECTORY | 493, uid: 0, gid: 0, size: 0, atime: now, mtime: now, ctime: now });
  };
  const db = await request2(opening);
  const refs = /* @__PURE__ */ new Map(), opens = /* @__PURE__ */ new Map();
  let closed = false;
  db.onversionchange = () => {
    closed = true;
    db.close();
  };
  const ref = (id) => {
    if (!refs.has(id)) refs.set(id, Object.freeze({ id }));
    return refs.get(id);
  };
  async function transaction(write, operation) {
    if (closed) throw new FSError("EIO", "Home storage is closed");
    if (write && readOnly) throw new FSError("EROFS", "Home observer is read-only");
    let tx;
    try {
      try {
        tx = db.transaction(["nodes", "chunks"], write ? "readwrite" : "readonly", write ? { durability: "strict" } : {});
      } catch {
        tx = db.transaction(["nodes", "chunks"], write ? "readwrite" : "readonly");
      }
      const completed = new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error || new FSError("EIO", "Home transaction aborted"));
        tx.onerror = () => {
        };
      });
      completed.catch(() => {
      });
      let result;
      try {
        result = await operation(tx.objectStore("nodes"), tx.objectStore("chunks"));
      } catch (error) {
        try {
          tx.abort();
        } catch {
        }
        await completed.catch(() => {
        });
        throw error;
      }
      await completed;
      return result;
    } catch (error) {
      if (error instanceof FSError) throw error;
      onError(error);
      throw new FSError(error?.name === "QuotaExceededError" ? "ENOSPC" : "EIO", error?.message || "Browser storage failed");
    }
  }
  const get = async (store, node2) => {
    const value = await request2(store.get(node2.id));
    if (!value) throw new FSError("ENOENT");
    return value;
  };
  const directory = async (store, node2) => {
    const value = await get(store, node2);
    if (type(value) !== DIRECTORY) throw new FSError("ENOTDIR");
    return value;
  };
  const entry = (store, parent, name2) => request2(store.index("entry").get([parent.id, name2]));
  const blockOf = (node2) => node2.block || CHUNK_SIZE;
  const attrs = (node2) => ({ ...node2, size: BigInt(node2.size), blocks: BigInt(Math.ceil(node2.size / 512)), nlink: node2.parent === null ? 0 : type(node2) === DIRECTORY ? 2 : 1, blockSize: blockOf(node2) });
  async function removeChunks(chunks, id, from = 0) {
    const range = IDBKeyRange.bound([id, from], [id, Number.MAX_SAFE_INTEGER]);
    await request2(chunks.delete(range));
  }
  async function removeNode(nodes, chunks, node2) {
    if (opens.get(node2.id)) {
      node2.parent = null;
      node2.name = "";
      await request2(nodes.put(node2));
    } else {
      await removeChunks(chunks, node2.id);
      await request2(nodes.delete(node2.id));
    }
  }
  async function create(parent, name2, context, kind, target) {
    nameCheck(name2);
    const id = await transaction(true, async (nodes) => {
      const dir = await directory(nodes, parent);
      if (await entry(nodes, parent, name2)) throw new FSError("EEXIST");
      const now = timestamp2();
      const value = { parent: parent.id, name: name2, mode: kind | context.mode & 4095, uid: context.uid, gid: context.gid, size: target ? new TextEncoder().encode(target).length : 0, target, atime: now, mtime: now, ctime: now };
      if (kind === FILE) value.block = BLOCK_SIZE;
      const id2 = await request2(nodes.add(value));
      dir.mtime = dir.ctime = now;
      await request2(nodes.put(dir));
      return id2;
    });
    return ref(id);
  }
  const api = {
    root: ref(1),
    async lookup(parent, name2) {
      return transaction(false, async (nodes) => {
        await directory(nodes, parent);
        const node2 = await entry(nodes, parent, name2);
        return node2 ? ref(node2.id) : void 0;
      });
    },
    // Return the entry and its metadata from one readonly transaction. This
    // is a request snapshot, never a cross-request metadata cache.
    lookupWithAttributes(parent, name2) {
      return transaction(false, async (nodes) => {
        await directory(nodes, parent);
        const node2 = await entry(nodes, parent, name2);
        return node2 ? { node: ref(node2.id), attributes: attrs(node2) } : void 0;
      });
    },
    getattr(node2) {
      return transaction(false, async (nodes) => attrs(await get(nodes, node2)));
    },
    setattr(node2, attributes) {
      return transaction(true, async (nodes, chunks) => {
        const value = await get(nodes, node2);
        if (attributes.size !== void 0) {
          if (type(value) !== FILE) throw new FSError("EINVAL");
          const size = offsetNumber(attributes.size);
          if (size === 0) {
            await removeChunks(chunks, node2.id);
            value.block = BLOCK_SIZE;
          } else if (size < value.size) {
            const block = blockOf(value), index = Math.floor(size / block), tail = size % block;
            await removeChunks(chunks, node2.id, index + (tail ? 1 : 0));
            if (tail) {
              const chunk = await request2(chunks.get([node2.id, index]));
              if (chunk) {
                chunk.data.fill(0, tail);
                await request2(chunks.put(chunk));
              }
            }
          }
          value.size = size;
        }
        if (attributes.mode !== void 0) value.mode = type(value) | attributes.mode & 4095;
        for (const key of ["uid", "gid"]) if (attributes[key] !== void 0) value[key] = attributes[key];
        for (const key of ["atime", "mtime"]) if (attributes[key] !== void 0) value[key] = attributes[key] === "now" ? timestamp2() : attributes[key];
        value.ctime = attributes.ctime || timestamp2();
        await request2(nodes.put(value));
        return attrs(value);
      });
    },
    mkdir(parent, name2, context) {
      return create(parent, name2, context, DIRECTORY);
    },
    symlink(parent, name2, target, context) {
      return create(parent, name2, { ...context, mode: 511 }, SYMLINK, target);
    },
    readlink(node2) {
      return transaction(false, async (nodes) => {
        const value = await get(nodes, node2);
        if (type(value) !== SYMLINK) throw new FSError("EINVAL");
        return value.target;
      });
    },
    async create(parent, name2, flags, context) {
      const node2 = await create(parent, name2, context, FILE);
      opens.set(node2.id, (opens.get(node2.id) || 0) + 1);
      return { node: node2, handle: { flags } };
    },
    async open(node2, flags) {
      if (readOnly && (flags & 3 || flags & 512)) throw new FSError("EROFS", "Home observer is read-only");
      const value = await api.getattr(node2);
      if (type(value) !== FILE) throw new FSError("EISDIR");
      if (flags & 512 && flags & 3) await api.setattr(node2, { size: 0n });
      opens.set(node2.id, (opens.get(node2.id) || 0) + 1);
      return { flags };
    },
    read(node2, handle, offset, length) {
      return transaction(false, async (nodes, chunks) => {
        const value = await get(nodes, node2), start2 = offsetNumber(offset), block = blockOf(value);
        const bytes = new Uint8Array(Math.max(0, Math.min(length, value.size - start2)));
        if (!bytes.length) return bytes;
        const first = Math.floor(start2 / block), last = Math.floor((start2 + bytes.length - 1) / block);
        const found = first === last ? [await request2(chunks.get([node2.id, first]))] : await request2(chunks.getAll(IDBKeyRange.bound([node2.id, first], [node2.id, last])));
        for (const chunk of found) {
          if (!chunk) continue;
          const from = Math.max(start2, chunk.index * block), to = Math.min(start2 + bytes.length, (chunk.index + 1) * block);
          bytes.set(chunk.data.subarray(from - chunk.index * block, to - chunk.index * block), from - start2);
        }
        return bytes;
      });
    },
    write(node2, handle, offset, data) {
      const bytes = data.slice();
      return transaction(true, async (nodes, chunks) => {
        const value = await get(nodes, node2);
        if (type(value) !== FILE) throw new FSError("EISDIR");
        const start2 = offsetNumber(offset), block = blockOf(value);
        if (!Number.isSafeInteger(start2 + bytes.length)) throw new FSError("EINVAL");
        const first = Math.floor(start2 / block), end = start2 + bytes.length;
        const last = Math.ceil(end / block);
        for (let batch = first; bytes.length && batch < last; batch += WRITE_BATCH_BLOCKS) {
          const writes = [];
          for (let index = batch; index < Math.min(last, batch + WRITE_BATCH_BLOCKS); index++) {
            writes.push((async () => {
              const from = Math.max(start2, index * block), to = Math.min(end, (index + 1) * block);
              const chunk = to - from < block && await request2(chunks.get([node2.id, index])) || { inode: node2.id, index, data: new Uint8Array(block) };
              chunk.data.set(bytes.subarray(from - start2, to - start2), from - index * block);
              await request2(chunks.put(chunk));
            })());
          }
          await Promise.all(writes);
        }
        value.size = Math.max(value.size, start2 + bytes.length);
        value.mtime = value.ctime = timestamp2();
        await request2(nodes.put(value));
        return bytes.length;
      });
    },
    // Every write has committed before it returns, so the guest's flush and
    // fsync have nothing left to wait for; they cost no browser transaction.
    flush() {
    },
    fsync() {
    },
    /** Resolves after every transaction started before it has finished. */
    settle() {
      return transaction(false, () => {
      });
    },
    async release(node2) {
      const count = (opens.get(node2.id) || 1) - 1;
      if (count) opens.set(node2.id, count);
      else {
        opens.delete(node2.id);
        if (!readOnly) {
          const orphaned = await transaction(false, async (nodes) => (await request2(nodes.get(node2.id)))?.parent === null);
          if (orphaned) await transaction(true, async (nodes, chunks) => {
            const value = await request2(nodes.get(node2.id));
            if (value && value.parent === null) await removeNode(nodes, chunks, value);
          });
        }
      }
    },
    opendir(node2) {
      return transaction(false, async (nodes) => {
        await directory(nodes, node2);
        return {};
      });
    },
    readdir(node2) {
      return transaction(false, async (nodes) => {
        await directory(nodes, node2);
        return (await request2(nodes.index("parent").getAll(node2.id))).map((value) => ({ name: value.name, node: ref(value.id) }));
      });
    },
    releasedir() {
    },
    unlink(parent, name2) {
      return remove(parent, name2, false);
    },
    rmdir(parent, name2) {
      return remove(parent, name2, true);
    },
    rename(oldParent, oldName, newParent, newName) {
      nameCheck(oldName);
      nameCheck(newName);
      return transaction(true, async (nodes, chunks) => {
        await directory(nodes, oldParent);
        await directory(nodes, newParent);
        const value = await entry(nodes, oldParent, oldName);
        if (!value) throw new FSError("ENOENT");
        if (oldParent.id === newParent.id && oldName === newName) return;
        if (type(value) === DIRECTORY) {
          let ancestor = await get(nodes, newParent);
          while (ancestor) {
            if (ancestor.id === value.id) throw new FSError("EINVAL");
            ancestor = ancestor.parent ? await request2(nodes.get(ancestor.parent)) : null;
          }
        }
        const destination = await entry(nodes, newParent, newName);
        if (destination) {
          if (type(value) === DIRECTORY && type(destination) !== DIRECTORY) throw new FSError("ENOTDIR");
          if (type(value) !== DIRECTORY && type(destination) === DIRECTORY) throw new FSError("EISDIR");
          if (type(destination) === DIRECTORY && await request2(nodes.index("parent").count(destination.id))) throw new FSError("ENOTEMPTY");
          await removeNode(nodes, chunks, destination);
        }
        value.parent = newParent.id;
        value.name = newName;
        value.ctime = timestamp2();
        await request2(nodes.put(value));
        for (const parent of [oldParent, newParent]) {
          const dir = await get(nodes, parent);
          dir.mtime = dir.ctime = value.ctime;
          await request2(nodes.put(dir));
        }
      });
    },
    access(node2) {
      return transaction(false, (nodes) => get(nodes, node2).then(() => {
      }));
    },
    async statfs() {
      const estimate = await globalThis.navigator?.storage?.estimate?.() || {};
      const quota = estimate.quota || 1024 ** 3, free = Math.max(0, quota - (estimate.usage || 0));
      return { blocks: BigInt(Math.floor(quota / CHUNK_SIZE)), blocksFree: BigInt(Math.floor(free / CHUNK_SIZE)), blocksAvailable: BigInt(Math.floor(free / CHUNK_SIZE)), blockSize: CHUNK_SIZE, nameLength: 255 };
    },
    usage() {
      return transaction(false, async (nodes, chunks) => {
        const block = new Map((await request2(nodes.getAll())).map((value) => [value.id, blockOf(value)]));
        const inodes = (await request2(chunks.getAllKeys())).map((key) => key[0]);
        return { files: block.size, bytes: inodes.reduce((sum, id) => sum + (block.get(id) || CHUNK_SIZE), 0) };
      });
    },
    async destroy() {
      if (!closed) {
        await api.settle();
        closed = true;
        db.close();
      }
    }
  };
  async function remove(parent, name2, isDirectory) {
    nameCheck(name2);
    return transaction(true, async (nodes, chunks) => {
      await directory(nodes, parent);
      const value = await entry(nodes, parent, name2);
      if (!value) throw new FSError("ENOENT");
      if (isDirectory && type(value) !== DIRECTORY) throw new FSError("ENOTDIR");
      if (!isDirectory && type(value) === DIRECTORY) throw new FSError("EISDIR");
      if (isDirectory && await request2(nodes.index("parent").count(value.id))) throw new FSError("ENOTEMPTY");
      await removeNode(nodes, chunks, value);
      const dir = await get(nodes, parent);
      dir.mtime = dir.ctime = timestamp2();
      await request2(nodes.put(dir));
    });
  }
  if (!readOnly) await transaction(true, async (nodes, chunks) => {
    for (const value of await request2(nodes.getAll())) if (value.parent === null) await removeNode(nodes, chunks, value);
  });
  return api;
}

// web/linux/packages/v1/package-shell.mjs
var $ = (id) => document.getElementById(id);
var state = window.packageConsoleState = { phase: "idle", ready: false, lines: [], errors: [], guestMemoryBytes: 536870912 };
var machine;
var network;
var writer;
var home;
var releaseLock;
var lockTask;
var terminal;
var fit;
var stopping = false;
var encoder = new TextEncoder();
var pending = "";
var session = 0;
var bootAbort;
var pendingSpawn;
var keys = { "ctrl-c": "", tab: "	", up: "\x1B[A", down: "\x1B[B", escape: "\x1B", enter: "\n" };
function status(text, phase) {
  $("status").textContent = text;
  if (phase) state.phase = phase;
}
function controls(ready) {
  state.ready = ready;
  for (const id of ["command", "send", "python-check"]) $(id).disabled = !ready;
  document.querySelectorAll("[data-key]").forEach((x) => x.disabled = !ready);
}
function send(text) {
  if (!writer || !state.ready) return;
  writer.enqueue(encoder.encode(text));
}
async function acquireLock() {
  if (!navigator.locks) throw Error("This browser lacks the lock needed for safe persistent home access.");
  let accepted;
  const granted = new Promise((r) => accepted = r);
  const released = new Promise((r) => releaseLock = r);
  lockTask = navigator.locks.request("linuxonweb.package-console.home.v1", { ifAvailable: true }, async (lock) => {
    accepted(!!lock);
    if (lock) await released;
  });
  if (!await granted) throw Error("Another package console owns this home. Stop that console first.");
}
async function stop() {
  if (stopping) return;
  stopping = true;
  ++session;
  bootAbort?.abort();
  controls(false);
  $("stop").disabled = true;
  status("Stopping Linux\u2026", "stopping");
  const spawning = pendingSpawn;
  let failure;
  try {
    const active = machine ?? await spawning?.catch(() => null);
    if (active) {
      active.close();
      await active.closed;
    }
  } catch (e) {
    failure = e;
    state.errors.push(String(e));
  } finally {
    for (const resource of [network, home]) {
      try {
        if (resource === network) await resource?.close();
        else await resource?.destroy();
      } catch (e) {
        failure ??= e;
        state.errors.push(String(e));
      }
    }
    machine = network = home = writer = pendingSpawn = null;
    window.packageConsole.machine = null;
    releaseLock?.();
    releaseLock = null;
    await lockTask?.catch(() => {
    });
    lockTask = null;
    $("start").disabled = false;
    status(failure ? "Stopped with an error; review the terminal." : "Stopped. Your acknowledged home writes are saved.", failure ? "error" : "stopped");
    stopping = false;
  }
}
async function start() {
  if (machine || stopping || state.phase === "starting") return;
  const own = ++session;
  bootAbort = new AbortController();
  const ensure = () => {
    if (own !== session) throw new DOMException("Start cancelled", "AbortError");
  };
  state.errors = [];
  state.lines = [];
  state.bootLog = "";
  state.stage = "loading";
  pending = "";
  status("Starting a real Linux guest\u2026", "starting");
  $("start").disabled = true;
  $("stop").disabled = false;
  controls(false);
  terminal.reset();
  try {
    if (!crossOriginIsolated || typeof SharedArrayBuffer === "undefined") throw Error("Cross-origin isolation and SharedArrayBuffer are required. Open the HTTPS preview link.");
    await acquireLock();
    ensure();
    const fetchStart = performance.now();
    const manifest = await (await fetch("./console-manifest.json", { cache: "no-store", signal: bootAbort.signal })).json();
    const image = new Uint8Array(await (await fetch(manifest.image.url, { signal: bootAbort.signal })).arrayBuffer());
    ensure();
    state.imageFetchMs = performance.now() - fetchStart;
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", image)), (x) => x.toString(16).padStart(2, "0")).join("");
    ensure();
    if (sha !== manifest.image.sha256 || image.length !== manifest.image.bytes) throw Error("Guest image integrity check failed.");
    state.imageSha256 = sha;
    state.startedAt = (/* @__PURE__ */ new Date()).toISOString();
    const requested = Number(new URLSearchParams(location.search).get("cpus") || 2);
    state.cpus = Math.min(Number.isInteger(requested) && requested >= 1 ? requested : 2, 2, Math.max(1, navigator.hardwareConcurrency || 1));
    const openedHome = await openPersistentHome({ name: "linuxonweb.package-console.home.v1" });
    if (own !== session) {
      await openedHome.destroy();
      return;
    }
    home = openedHome;
    network = createNetwork(wsTcpProxyNetwork({ proxyUrl: location.origin + "/" }));
    const attachment = attach_guest(network);
    const input = new ReadableStream({ start(c) {
      writer = c;
    } });
    const decoder = new TextDecoder();
    const output = new WritableStream({ write(bytes) {
      const b = new Uint8Array(bytes);
      terminal.write(b);
      pending += decoder.decode(b, { stream: true });
      const rows = pending.split("\n");
      pending = rows.pop();
      for (const raw of rows) {
        state.lines.push(raw.replaceAll("\r", ""));
        if (state.lines.length > 1e3) state.lines.shift();
      }
      if (!state.ready && /(?:^|\n)[^\n]*# $/.test(pending.replaceAll("\r", ""))) {
        controls(true);
        status("Linux is ready. Your home folder is persistent.", "running");
        state.readyAt = (/* @__PURE__ */ new Date()).toISOString();
      }
    } });
    state.stage = "kernel";
    const spawnStart = performance.now();
    pendingSpawn = spawnMachine({ workerScriptURL: true ? "/linux/dist/immutable/worker-d4ffec4ec28122798e730b4db2797ecb2df9983a71a260190299c93c72e59f15.mjs" : void 0, workerScriptSignal: bootAbort.signal, cpus: state.cpus, devicetree: { memory: { reg: [0, state.guestMemoryBytes] } }, initcpio: image, cmdline: "console=hvc0 rdinit=/init", devices: [consoleDevice(input, output), entropyDevice(), inputDevice(), attachment.attachment.device, fileSystemDevice(home, { tag: "home", cache: false })] });
    const spawned = await pendingSpawn;
    if (own !== session) return;
    pendingSpawn = null;
    machine = spawned;
    state.spawnMs = performance.now() - spawnStart;
    window.packageConsole.machine = machine;
    void (async () => {
      const reader = machine.bootConsole.getReader(), bootDecoder = new TextDecoder();
      try {
        while (true) {
          const r = await reader.read();
          if (r.done) break;
          const bytes = new Uint8Array(r.value);
          terminal.write(bytes);
          state.bootLog = (state.bootLog + bootDecoder.decode(bytes, { stream: true })).slice(-32e3);
        }
      } finally {
        reader.releaseLock();
      }
    })();
    machine.closed.then(() => {
      if (own === session && !stopping) void stop();
    }, (e) => {
      state.errors.push(String(e));
      if (own === session && !stopping) {
        status("Guest stopped: " + e.message, "error");
        void stop();
      }
    });
  } catch (e) {
    if (own !== session) return;
    state.errors.push(String(e));
    await stop();
    status(e.message, "error");
    terminal.writeln("\r\n" + e.message);
  }
}
function installPython() {
  send(`apk update && apk add python3 && python3 -c 'import json,zlib,hashlib,ssl; assert json.loads(json.dumps([1,2,3]))==[1,2,3]; assert zlib.decompress(zlib.compress(b"phone"))==b"phone"; assert ssl.create_default_context().cert_store_stats()["x509_ca"]>0; print("MOBILE_PYTHON_OK",2**20,hashlib.sha256(b"phone").hexdigest())'
`);
}
window.packageConsole = { start, stop, send, state };
async function loadClassic(src) {
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(Error("Terminal asset failed: " + src));
    document.head.append(script);
  });
}
await loadClassic("/linux/node_modules/@xterm/xterm/lib/xterm.js");
await loadClassic("/linux/node_modules/@xterm/addon-fit/lib/addon-fit.js");
terminal = new window.Terminal({ fontSize: 14, convertEol: true, scrollback: 1500, cursorBlink: true, theme: { background: "#101a27", foreground: "#e5edf7", cursor: "#85c8ff" }, allowProposedApi: false });
fit = new window.FitAddon.FitAddon();
terminal.loadAddon(fit);
terminal.open($("terminal"));
fit.fit();
terminal.onData(send);
new ResizeObserver(() => {
  try {
    fit.fit();
  } catch {
  }
}).observe($("terminal"));
window.visualViewport?.addEventListener("resize", () => {
  try {
    fit.fit();
  } catch {
  }
});
$("start").onclick = start;
$("stop").onclick = stop;
$("python-check").onclick = installPython;
$("command-form").onsubmit = (e) => {
  e.preventDefault();
  if (!$("command").value) return;
  send($("command").value + "\n");
  $("command").value = "";
  $("command").focus({ preventScroll: true });
};
document.querySelectorAll("[data-key]").forEach((button) => button.onclick = () => send(keys[button.dataset.key]));
if (!crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
  $("start").disabled = true;
  status("This page needs cross-origin isolation and SharedArrayBuffer. Use the HTTPS preview link.", "unsupported");
} else status("Ready to start. The guest will use a 512 MiB RAM limit.", "idle");
var socket;
var ping = 0;
var pings = /* @__PURE__ */ new Map();
var rtt = null;
function metrics(d) {
  if (d.progress) $("iteration").textContent = `Iteration ${d.progress.iteration} \xB7 ${d.progress.score ?? "?"}/100`;
  if (d.metrics) {
    const m = d.metrics;
    $("health").textContent = `CPU ${Number(m.cpuPercent).toFixed(1)}% \xB7 RAM ${Number(m.ram?.availableGB).toFixed(1)} / ${Number(m.ram?.totalGB).toFixed(1)} GB available \xB7 WebSocket round trip ${rtt === null ? "\u2014" : rtt + " ms"}`;
    $("disks").textContent = (m.disks || []).map((x) => `${x.mount}: ${Number(x.availableGB).toFixed(1)} / ${Number(x.totalGB).toFixed(1)} GB available`).join("\n");
  }
}
function health() {
  socket = new WebSocket((location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/__progress/ws");
  socket.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.type === "metrics") metrics(d);
      if (d.type === "pong" && pings.has(d.id)) {
        rtt = Math.round(performance.now() - pings.get(d.id));
        pings.delete(d.id);
      }
    } catch {
    }
  };
  socket.onclose = () => setTimeout(health, 2e3);
  socket.onerror = () => socket.close();
}
health();
setInterval(() => {
  if (socket?.readyState === WebSocket.OPEN) {
    const id = ++ping;
    pings.set(id, performance.now());
    for (const [k, v] of pings) if (performance.now() - v > 1e4) pings.delete(k);
    socket.send(JSON.stringify({ type: "ping", id }));
  }
}, 2e3);
