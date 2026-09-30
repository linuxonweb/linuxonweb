// Firefox 128 WebGPU wire decoder wrapper (packet W3).
//
// Works in browsers, Workers and Node. The Wasm module has no imports.
//
//   const dec = await createDecoder(bytesOrModuleOrResponse);
//   const r = dec.decode("DeviceAction", u8);  // or numeric kind 1..7
//   // r = { status, ok, kind, canonical?, value?, error? }
//
// status: 0 ok, 1 decode error, 2 bad kind, 3 input too large,
//         4 bad pointer (wrapper never passes one), -1 wrapper refusal.
// A decode failure never traps; the instance stays usable.

export const KINDS = Object.freeze([
  "DeviceAction",          // 1 wgpu_server_device_action
  "CommandEncoderAction",  // 2 wgpu_server_command_encoder_action
  "RenderPass",            // 3 wgpu_server_render_pass
  "ComputePass",           // 4 wgpu_server_compute_pass
  "QueueWriteAction",      // 5 wgpu_server_queue_write_action
  "TextureAction",         // 6 wgpu_server_texture_action
  "DeviceDescriptor",      // 7 wgpu_server_adapter_request_device
]);

// Integers above 2^53 (u64 sizes, offsets, masks) are returned as BigInt so
// no value is silently rounded. Uses JSON.parse source-text access when the
// engine has it (V8 >= 11.4, Firefox >= 135), else a string-aware tokenizer.
const HAS_SOURCE = (() => {
  let ok = false;
  try { JSON.parse("1", (k, v, ctx) => { ok = ctx?.source === "1"; return v; }); } catch {}
  return ok;
})();
const BIG = "__w3_u64__";
const TOKENS = /"(?:[^"\\]|\\.)*"|(?<![\d.eE+-])-?\d{16,}(?![.\deE])/g;

export function parseWireJson(text, { forceTokenizer = false, forceReviver = false } = {}) {
  // Fast path: an integer needs >= 16 digits to exceed 2^53, so text without
  // such a run parses exactly with plain JSON.parse (no per-value callback).
  if (!forceTokenizer && !forceReviver && !/\d{16}/.test(text)) return JSON.parse(text);
  if (HAS_SOURCE && !forceTokenizer) {
    return JSON.parse(text, (k, v, ctx) =>
      typeof v === "number" && !Number.isSafeInteger(v) && Number.isInteger(v) && /^-?\d+$/.test(ctx?.source ?? "")
        ? BigInt(ctx.source) : v);
  }
  const marked = text.replace(TOKENS, (t) => (t[0] === '"' ? t : `{"${BIG}":"${t}"}`));
  return JSON.parse(marked, (k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof v[BIG] === "string" && Object.keys(v).length === 1) {
      const b = BigInt(v[BIG]);
      return b >= BigInt(Number.MIN_SAFE_INTEGER) && b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : b;
    }
    return v;
  });
}

const EXPORTS = ["memory", "alloc", "free", "decode", "result_ptr", "result_len", "max_input"];

async function toInstance(source) {
  if (source instanceof WebAssembly.Instance) return source;
  if (source instanceof WebAssembly.Module) return new WebAssembly.Instance(source, {});
  if (typeof Response !== "undefined" && source instanceof Response) {
    source = await source.arrayBuffer();
  }
  const { instance } = await WebAssembly.instantiate(source, {});
  return instance;
}

export function kindNumber(kind) {
  if (typeof kind === "number") return kind;
  const i = KINDS.indexOf(kind);
  return i < 0 ? 0 : i + 1;
}

export async function createDecoder(source, options = {}) {
  const instance = await toInstance(source);
  const ex = instance.exports;
  for (const name of EXPORTS) {
    if (!(name in ex)) throw new Error(`decoder module missing export ${name}`);
  }
  const maxInput = Number(ex.max_input());
  const utf8 = new TextDecoder("utf-8", { fatal: true });

  function readResult() {
    return parseWireJson(readResultText(), options);
  }

  function readResultText() {
    const ptr = ex.result_ptr() >>> 0;
    const len = ex.result_len() >>> 0;
    // Copy out before parsing: memory may grow on the next call.
    return utf8.decode(new Uint8Array(ex.memory.buffer, ptr, len).slice());
  }

  function decode(kind, bytes) {
    const k = kindNumber(kind);
    if (!(bytes instanceof Uint8Array)) {
      bytes = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    let ptr = 0;
    if (bytes.length > maxInput) {
      // Let the module report it (status 3) without copying anything.
      const status = ex.decode(k, 0, bytes.length);
      return { status, ...readResult() };
    }
    if (bytes.length > 0) {
      ptr = ex.alloc(bytes.length) >>> 0;
      if (ptr === 0) return { status: -1, ok: false, kind: KINDS[k - 1] ?? "?", error: "alloc failed" };
      new Uint8Array(ex.memory.buffer, ptr, bytes.length).set(bytes);
    }
    try {
      const status = ex.decode(k, ptr, bytes.length);
      return { status, ...readResult() };
    } finally {
      if (ptr) ex.free(ptr, bytes.length);
    }
  }

  return {
    decode,
    lastResultText: readResultText,
    maxInput,
    memoryBytes: () => ex.memory.buffer.byteLength,
    exports: ex,
  };
}
