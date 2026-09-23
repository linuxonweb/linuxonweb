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

let callbackAdapterFunction;

function isFirefoxModule(module) {
  const imports = WebAssembly.Module.imports(module);
  const exports = WebAssembly.Module.exports(module);
  const hasLinuxAbi = [
    ["linux", "syscall", "function"],
    ["linux", "get_thread_area", "function"],
    ["linux", "copy_siginfo", "function"],
  ].every(([moduleName, name, kind]) =>
    imports.some((item) => item.module === moduleName && item.name === name && item.kind === kind));
  return hasLinuxAbi && exports.some((item) => item.name === "_start" && item.kind === "function") &&
    exports.some((item) => item.name === "__indirect_function_table" && item.kind === "table");
}

function getCallbackAdapterFunction() {
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
  if (!isFirefoxModule(module)) return 0;
  const table = instance.exports.__indirect_function_table;
  if (!(table instanceof WebAssembly.Table) || table.length < 3) return 0;
  const callback = getCallbackAdapterFunction();
  let patched = 0;
  for (let index = 0; index < 3; index += 1) {
    if (table.get(index) === null) {
      table.set(index, callback);
      patched += 1;
    }
  }
  return patched;
}

