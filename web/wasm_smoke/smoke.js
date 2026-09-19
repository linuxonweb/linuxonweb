const status = document.querySelector("#status");
const terminal = document.querySelector("#terminal");
const canvas = document.querySelector("#framebuffer");
const context = canvas.getContext("2d");
const pendingEvents = [];
let instance;
window.addEventListener("keydown", (event) => pendingEvents.push(`key:${event.key}`));
window.addEventListener("pointerdown", (event) => pendingEvents.push(`pointer:${event.clientX},${event.clientY}`));
const BAD_ARGUMENT = -14;

function memorySlice(pointer, length, clamped = false) {
  if (!Number.isSafeInteger(pointer) || !Number.isSafeInteger(length) || pointer < 0 || length < 0) {
    return null;
  }
  const memory = instance?.exports?.memory;
  if (!(memory instanceof WebAssembly.Memory) || pointer > memory.buffer.byteLength - length) {
    return null;
  }
  const View = clamped ? Uint8ClampedArray : Uint8Array;
  return new View(memory.buffer, pointer, length);
}

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
  const imports = {
    linux_host: {
      log(pointer, length, _level) {
        const bytes = memorySlice(pointer, length);
        if (bytes === null) return BAD_ARGUMENT;
        terminal.textContent += new TextDecoder().decode(bytes);
        return length;
      },
      clock_monotonic_ns() {
        return BigInt(Math.round(performance.now() * 1_000_000));
      },
      poll_events(pointer, capacity) {
        const bytes = memorySlice(pointer, capacity);
        if (bytes === null) return BAD_ARGUMENT;
        const encoded = new TextEncoder().encode(pendingEvents.splice(0, 8).join("\n"));
        bytes.set(encoded.subarray(0, capacity));
        return Math.min(encoded.length, capacity);
      },
      frame_present(pointer, width, height, stride, format) {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
            width > 4096 || height > 4096 || !Number.isInteger(stride) || stride < width * 4 ||
            (format !== 0 && format !== 1)) {
          return BAD_ARGUMENT;
        }
        const bytes = memorySlice(pointer, stride * height, true);
        if (bytes === null) return BAD_ARGUMENT;
        const packed = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y += 1) {
          const source = bytes.subarray(y * stride, y * stride + width * 4);
          packed.set(source, y * width * 4);
          if (format === 1) {
            for (let x = 0; x < width * 4; x += 4) {
              const red = packed[y * width * 4 + x];
              packed[y * width * 4 + x] = packed[y * width * 4 + x + 2];
              packed[y * width * 4 + x + 2] = red;
            }
          }
        }
        const image = new ImageData(packed, width, height);
        const scratch = document.createElement("canvas");
        scratch.width = width;
        scratch.height = height;
        const scratchContext = scratch.getContext("2d");
        if (scratchContext === null) return BAD_ARGUMENT;
        scratchContext.putImageData(image, 0, 0);
        context.imageSmoothingEnabled = false;
        context.drawImage(scratch, 0, 0, canvas.width, canvas.height);
        return 0;
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
  if (instance.exports.runtime_frame() !== 0) {
    throw new Error("linux_host.frame_present failed");
  }
  const pixel = context.getImageData(0, 0, 1, 1).data;
  if (pixel[0] !== 0 || pixel[1] !== 0 || pixel[2] !== 0x9a || pixel[3] !== 0xff) {
    throw new Error(`framebuffer pixel mismatch: ${Array.from(pixel)}`);
  }
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Smoke" }));
  const eventBytes = instance.exports.runtime_poll();
  if (eventBytes <= 0 || instance.exports.runtime_event_byte(0) !== "k".charCodeAt(0)) {
    throw new Error(`linux_host.poll_events failed: ${eventBytes}`);
  }
  pass("native wasm32 module instantiated (ABI LWEB v1, framebuffer + events)");
} catch (error) {
  fail(error);
}
