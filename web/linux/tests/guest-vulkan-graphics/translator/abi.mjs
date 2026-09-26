/** Shared Wasm ABI decoder for browser worker and independent Node checks. */
export function translateGraphics(instance, input) {
  if (!(input instanceof Uint8Array) || input.byteLength < 20 || input.byteLength > 65536 || input.byteLength % 4) {
    throw new TypeError('invalid SPIR-V byte length');
  }
  const api = instance.exports;
  if (api.translator_version() !== 0x47520001) throw new Error('graphics translator ABI mismatch');
  const pointer = api.input_reserve(input.byteLength) >>> 0;
  if (!pointer || pointer + input.byteLength > api.memory.buffer.byteLength) throw new Error('invalid input storage');
  new Uint8Array(api.memory.buffer, pointer, input.byteLength).set(input);
  const status = api.translate(input.byteLength);
  const read = (pointer, length, limit) => {
    pointer >>>= 0; length >>>= 0;
    if (!length || length > limit || pointer + length > api.memory.buffer.byteLength) throw new Error('invalid output storage');
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(api.memory.buffer, pointer, length));
  };
  const output = read(api.output_ptr(), api.output_len(), status === 0 ? 262144 : 2048);
  if (status !== 0) throw new Error(output);
  const metadata = JSON.parse(read(api.metadata_ptr(), api.metadata_len(), 16384));
  if (metadata.schema !== 1 || metadata.profile !== 'graphics-empty-v1' || metadata.backend !== 'wgsl' ||
      !['vertex', 'fragment'].includes(metadata.stage) || metadata.coordinateAdjustment !== true ||
      typeof metadata.originalEntryPoint !== 'string' || !metadata.originalEntryPoint ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(metadata.entryPoint) || metadata.entryPoint.length > 160 ||
      !Array.isArray(metadata.inputs) || !Array.isArray(metadata.outputs) ||
      !Array.isArray(metadata.resources) || metadata.resources.length !== 0) throw new Error('invalid graphics reflection');
  return { ...metadata, wgsl: output };
}
