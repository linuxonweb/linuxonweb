/** Shared Wasm ABI decoder for browser worker and independent Node checks. */
export function translateWebGLGraphics(instance, input) {
  if (!(input instanceof Uint8Array) || input.byteLength < 20 || input.byteLength > 65536 || input.byteLength % 4) {
    throw new TypeError('invalid SPIR-V byte length');
  }
  const api = instance.exports;
  if (api.translator_version() !== 0x474c0001) throw new Error('graphics translator ABI mismatch');
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
  if (metadata.schema !== 1 || metadata.profile !== 'graphics-empty-webgl-v1' || metadata.backend !== 'glsl-es-300' ||
      !['vertex', 'fragment'].includes(metadata.stage) || metadata.coordinateAdjustment !== true ||
      metadata.backendCoordinateAdjustment !== true ||
      typeof metadata.originalEntryPoint !== 'string' || !metadata.originalEntryPoint ||
      metadata.originalEntryPoint.length > 128 || metadata.entryPoint !== 'main' ||
      !Array.isArray(metadata.inputs) || !Array.isArray(metadata.outputs) ||
      !Array.isArray(metadata.resources) || metadata.resources.length !== 0 ||
      !Array.isArray(metadata.varyingBindings) || metadata.varyingBindings.length > 16) throw new Error('invalid graphics reflection');
  for (const items of [metadata.inputs, metadata.outputs]) {
    if (items.length > 9) throw new Error('interface exceeds bounds');
    const seen = new Set();
    for (const item of items) {
      const builtin = item.builtin === 'position';
      if (!item.type || item.type.scalar !== 'f32' || ![2, 3, 4].includes(item.type.components) ||
          (builtin ? item.type.components !== 4 || item.location !== undefined :
            item.builtin !== undefined || !Number.isInteger(item.location) || item.location < 0 || item.location >= 8)) {
        throw new Error('invalid interface type/binding');
      }
      const key = builtin ? 'position' : item.location;
      if (seen.has(key)) throw new Error('duplicate interface binding');
      seen.add(key);
      if (item.interpolation !== null && (!item.interpolation ||
          !['perspective', 'flat'].includes(item.interpolation.mode) ||
          ![null, 'center'].includes(item.interpolation.sampling))) throw new Error('invalid interpolation');
    }
  }
  for (const item of metadata.varyingBindings) {
    if (typeof item.name !== 'string' || !item.name || item.name.length > 160 ||
        !Number.isInteger(item.location) || item.location < 0 || item.location >= 8 || item.index !== 0) {
      throw new Error('invalid backend varying binding');
    }
  }
  return { ...metadata, glsl: output };
}
