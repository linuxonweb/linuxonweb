// SPDX-License-Identifier: MIT
//
// Firefox's wasm32 build reserves the first three indirect-function-table
// entries for the browser host ABI.  The staged module leaves them null; a
// legacy callback dispatcher can still call one of those entries during
// startup.  Keep this compatibility shim in the browser adapter so the
// Firefox payload and Linux sources remain unchanged.

const FIREFOX_CALLBACK_ADAPTER = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x1c, 0x01, 0x60,
  0x17, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e,
  0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e,
  0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e,
  0x01, 0x7e,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x0c, 0x01, 0x08, 0x63, 0x61, 0x6c, 0x6c,
  0x62, 0x61, 0x63, 0x6b, 0x00, 0x00,
  0x0a, 0x06, 0x01, 0x04, 0x00, 0x42, 0x00, 0x0b,
]);

// Diagnostic variant: the exported callback keeps exactly the same Wasm
// signature, but calls an imported logger before returning zero.  This is
// intentionally separate from the production no-op module.
const FIREFOX_CALLBACK_DIAGNOSTIC_ADAPTER = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x1c, 0x01, 0x60,
  0x17, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e,
  0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e,
  0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e, 0x7e,
  0x01, 0x7e,
  0x02, 0x0b, 0x01, 0x03, 0x65, 0x6e, 0x76, 0x03, 0x6c, 0x6f, 0x67, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x0c, 0x01, 0x08, 0x63, 0x61, 0x6c, 0x6c,
  0x62, 0x61, 0x63, 0x6b, 0x00, 0x01,
  0x0a, 0x37, 0x01, 0x35, 0x00,
  0x20, 0x00, 0x20, 0x01, 0x20, 0x02, 0x20, 0x03,
  0x20, 0x04, 0x20, 0x05, 0x20, 0x06, 0x20, 0x07,
  0x20, 0x08, 0x20, 0x09, 0x20, 0x0a, 0x20, 0x0b,
  0x20, 0x0c, 0x20, 0x0d, 0x20, 0x0e, 0x20, 0x0f,
  0x20, 0x10, 0x20, 0x11, 0x20, 0x12, 0x20, 0x13,
  0x20, 0x14, 0x20, 0x15, 0x20, 0x16,
  0x10, 0x00, 0x1a, 0x42, 0x00, 0x0b,
]);

let callbackAdapterFunction;
let diagnosticCallbackAdapterFunction;
let diagnosticCallbackCount = 0;

// Diagnostics are deliberately opt-in so normal Firefox startup keeps the
// existing callback ABI and logging behavior.  Set this before loading the
// worker when investigating a callback/table failure.
const FIREFOX_CALLBACK_DIAGNOSTICS = (() => {
  if (globalThis.__LINUX_FIREFOX_CALLBACK_DIAGNOSTICS === true) return true;
  try {
    return new URL(globalThis.location?.href ?? "").searchParams.get("firefox_diagnostics") === "1";
  } catch {
    return false;
  }
})();
const FIREFOX_CALLBACK_NO_ADAPTER = (() => {
  try {
    return new URL(globalThis.location?.href ?? "").searchParams.get("firefox_no_adapter") === "1";
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
    ["linux", "copy_siginfo", "function"],
  ].every(([moduleName, name, kind]) =>
    imports.some((item) => item.module === moduleName && item.name === name && item.kind === kind));
  const hasStart = exports.some((item) => item.name === "_start" && item.kind === "function");
  const hasTable = exports.some((item) => item.name === "__indirect_function_table" && item.kind === "table");
  if (FIREFOX_CALLBACK_DIAGNOSTICS && !(hasLinuxAbi && hasStart && hasTable)) {
    console.warn("[firefox-callback-adapter] Firefox module guard rejected", {
      importCount: imports.length,
      exportCount: exports.length,
      hasLinuxAbi,
      hasStart,
      hasTable,
      imports: imports.slice(0, 32).map(({ module, name, kind }) => `${module}.${name}:${kind}`),
      exports: exports.slice(0, 32).map(({ name, kind }) => `${name}:${kind}`),
    });
  }
  return hasLinuxAbi && hasStart && hasTable;
}

function getCallbackAdapterFunction(diagnostics) {
  if (diagnostics) {
    if (!diagnosticCallbackAdapterFunction) {
      const logger = (...args) => {
        diagnosticCallbackCount += 1;
        if (diagnosticCallbackCount <= 8) {
          console.error("[firefox-callback-adapter] callback", {
            count: diagnosticCallbackCount,
            args: args.slice(0, 4).map((value) => String(value)),
          });
        }
        return 0n;
      };
      const adapter = new WebAssembly.Instance(
        new WebAssembly.Module(FIREFOX_CALLBACK_DIAGNOSTIC_ADAPTER),
        { env: { log: logger } },
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

/**
 * Install the minimal reserved-table bridge for the staged Firefox module.
 * Returns the number of table entries filled, which is useful for diagnostics.
 */
export function installFirefoxCallbackAdapter(module, instance) {
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
      reserved: [0, 1, 2].map((index) => table.get(index) === null ? null : "function"),
    });
  }
  return patched;
}

function diagnosticsRequestedByWorkerUrl() {
  try {
    return new URL(globalThis.location?.href ?? "", globalThis.location?.origin).searchParams.get("firefox_diagnostics") === "1";
  } catch {
    return false;
  }
}
