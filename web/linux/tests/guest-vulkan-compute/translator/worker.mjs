// No guest code executes here: Naga translates instructions; WebGPU executes WGSL.
let instance;
const decoder = new TextDecoder('utf-8', { fatal: true });
self.onmessage = async ({ data }) => {
  const { id } = data;
  try {
    if (data.kind === 'init') {
      const module = await WebAssembly.compile(data.bytes);
      if (WebAssembly.Module.imports(module).length) throw new Error('translator must have no imports');
      instance = await WebAssembly.instantiate(module, {});
      if (instance.exports.translator_version() !== 1) throw new Error('translator ABI mismatch');
      self.postMessage({ id, ok: true });
      return;
    }
    if (data.kind !== 'translate' || !instance) throw new Error('translator not initialized');
    const input = data.bytes;
    if (!(input instanceof Uint8Array) || input.byteLength < 20 || input.byteLength > 65536 || input.byteLength % 4) {
      throw new Error('invalid SPIR-V byte length');
    }
    const api = instance.exports;
    const pointer = api.input_reserve(input.byteLength) >>> 0;
    if (!pointer || pointer + input.byteLength > api.memory.buffer.byteLength) throw new Error('invalid translator input storage');
    new Uint8Array(api.memory.buffer, pointer, input.byteLength).set(input);
    const status = api.translate(input.byteLength);
    const outputPointer = api.output_ptr() >>> 0;
    const outputLength = api.output_len() >>> 0;
    if (outputLength === 0 || outputLength > (status === 0 ? 262144 : 2048) ||
        outputPointer + outputLength > api.memory.buffer.byteLength) throw new Error('invalid translator output storage');
    const output = decoder.decode(new Uint8Array(api.memory.buffer, outputPointer, outputLength));
    if (status !== 0) {
      self.postMessage({ id, ok: false, fatal: false, error: output });
    } else {
      const namePointer = api.entry_point_ptr() >>> 0;
      const nameLength = api.entry_point_len() >>> 0;
      if (nameLength === 0 || nameLength > 128 || namePointer + nameLength > api.memory.buffer.byteLength) {
        throw new Error('invalid translator entry name storage');
      }
      const entryPoint = decoder.decode(new Uint8Array(api.memory.buffer, namePointer, nameLength));
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entryPoint)) throw new Error('invalid translator entry name');
      self.postMessage({ id, ok: true, result: { wgsl: output, entryPoint, workgroupSize: [64, 1, 1] } });
    }
  } catch (error) {
    instance = undefined;
    self.postMessage({ id, ok: false, fatal: true, error: String(error?.message ?? error).slice(0, 2048) });
  }
};
