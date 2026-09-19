const status = document.querySelector("#status");
const terminal = document.querySelector("#terminal");

function pass(message) {
  status.textContent = `PASS: ${message}`;
  status.dataset.result = "pass";
}

function fail(error) {
  status.textContent = `FAIL: ${error instanceof Error ? error.message : error}`;
  status.dataset.result = "fail";
  console.error(error);
}

try {
  // instantiateStreaming is the browser path used for the eventual kernel,
  // X server, and browser modules. It requires application/wasm from the
  // web server.
  let instance;
  const imports = {
    linux_host: {
      log(pointer, length, _level) {
        const bytes = new Uint8Array(instance.exports.memory.buffer, pointer, length);
        terminal.textContent += new TextDecoder().decode(bytes);
        return length;
      },
      clock_monotonic_ns() {
        return BigInt(Math.round(performance.now() * 1_000_000));
      },
    },
  };
  ({ instance } = await WebAssembly.instantiateStreaming(
    fetch("./build/probe.wasm"),
    imports,
  ));
  const value = instance.exports.runtime_probe();
  if (value !== 0x4c574542) {
    throw new Error(`ABI handshake mismatch: 0x${value.toString(16)}`);
  }
  const startResult = instance.exports.runtime_start();
  if (startResult < 0) {
    throw new Error(`linux_host.log failed: ${startResult}`);
  }
  pass("native wasm32 module instantiated (ABI LWEB v1)");
} catch (error) {
  fail(error);
}
