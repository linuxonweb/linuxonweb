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
      !Array.isArray(metadata.resources)) throw new Error('invalid graphics reflection');
  validateUniformResources(metadata.resources, false);
  return { ...metadata, wgsl: output };
}

/** Bounded resource reflection: uniform buffers (A3, sorted, unique, tightly
 * packed) and combined 2D sampled textures (A4, sampler at binding + 16). */
export function validateUniformResources(resources, blockNames) {
  if (!Array.isArray(resources) || resources.length > 12) throw new Error('invalid graphics reflection');
  let previous = -1; let uniforms = 0; let textures = 0;
  for (const item of resources) {
    if (item?.type === 'texture') {
      const keys = ['group', 'binding', 'type', 'samplerBinding', ...(blockNames ? ['samplerName'] : [])];
      if (typeof item !== 'object' || Object.keys(item).length !== keys.length || keys.some((key) => !(key in item)) ||
          !Number.isInteger(item.group) || item.group < 0 || item.group >= 4 ||
          !Number.isInteger(item.binding) || item.binding < 0 || item.binding >= 16 ||
          item.group * 16 + item.binding <= previous || item.samplerBinding !== item.binding + 16 ||
          ++textures > 4 || (blockNames && (typeof item.samplerName !== 'string' ||
            !/^[A-Za-z_][A-Za-z0-9_]{0,159}$/.test(item.samplerName)))) throw new Error('invalid texture reflection');
      previous = item.group * 16 + item.binding;
      continue;
    }
    if (++uniforms > 8) throw new Error('invalid graphics reflection');
    const keys = ['group', 'binding', 'type', 'size', 'members', ...(blockNames ? ['blockName'] : [])];
    if (!item || typeof item !== 'object' || Object.keys(item).length !== keys.length || keys.some((key) => !(key in item)) ||
        item.type !== 'uniform' || !Number.isInteger(item.group) || item.group < 0 || item.group >= 4 ||
        !Number.isInteger(item.binding) || item.binding < 0 || item.binding >= 16 ||
        item.group * 16 + item.binding <= previous || !Number.isInteger(item.size) || item.size < 16 ||
        item.size > 16384 || item.size % 16 || !Array.isArray(item.members) || !item.members.length ||
        item.members.length > 16 || (blockNames && (typeof item.blockName !== 'string' ||
          !/^[A-Za-z_][A-Za-z0-9_]{0,159}$/.test(item.blockName)))) throw new Error('invalid uniform reflection');
    previous = item.group * 16 + item.binding;
    let offset = 0;
    for (const member of item.members) {
      const bytes = member?.type === 'mat4x4' && member.arrayLength === 0 ? 64 :
        member?.type === 'vec4' && Number.isInteger(member.arrayLength) && member.arrayLength >= 0 &&
          member.arrayLength <= 1024 ? 16 * Math.max(1, member.arrayLength) : 0;
      if (!bytes || member.offset !== offset || Object.keys(member).length !== 3) throw new Error('invalid uniform member');
      offset += bytes;
    }
    if (offset !== item.size) throw new Error('invalid uniform size');
  }
  return resources;
}
