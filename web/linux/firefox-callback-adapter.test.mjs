import test from "node:test";
import assert from "node:assert/strict";
import { installFirefoxCallbackAdapter } from "./dist/firefox-callback-adapter.mjs";

// A small module with the same imports/exports and an empty three-slot table
// used by the staged Firefox wasm artifact. Keeping this fixture inline makes
// the adapter test independent of the 84 MiB initramfs download.
const FIREFOX_ABI_FIXTURE = Uint8Array.from(Buffer.from(
  "AGFzbQEAAAABBAFgAAACPgMFbGludXgHc3lzY2FsbAAABWxpbnV4D2dldF90aHJlYWRfYXJlYQAABWxpbnV4DGNvcHlfc2lnaW5mbwAAAwIBAAQEAXAAAwcmAhlfX2luZGlyZWN0X2Z1bmN0aW9uX3RhYmxlAQAGX3N0YXJ0AAMKBAECAAs=",
  "base64",
));

test("fills the reserved Firefox indirect table entries once", () => {
  const module = new WebAssembly.Module(FIREFOX_ABI_FIXTURE);
  const instance = new WebAssembly.Instance(module, {
    linux: {
      syscall() {},
      get_thread_area() {},
      copy_siginfo() {},
    },
  });
  const table = instance.exports.__indirect_function_table;
  assert.deepEqual([table.get(0), table.get(1), table.get(2)], [null, null, null]);
  assert.equal(installFirefoxCallbackAdapter(module, instance), 3);
  assert.equal(installFirefoxCallbackAdapter(module, instance), 0);
  assert.equal(table.get(0), table.get(1));
  assert.equal(table.get(1), table.get(2));
});

test("ignores modules outside the Firefox ABI", () => {
  const module = new WebAssembly.Module(Uint8Array.from([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  ]));
  const instance = new WebAssembly.Instance(module);
  assert.equal(installFirefoxCallbackAdapter(module, instance), 0);
});
