// Experimental bounded graphics backend. No wire protocol or device ownership.
export const GRAPHICS_LIMITS = Object.freeze({ maxResources: 256, maxBytes: 64 * 1024 * 1024,
  maxTargetSize: 2048, maxVertexBufferBytes: 1048576, maxVertexBuffers: 8,
  maxAttributes: 8, maxStride: 2048, maxDraws: 1024, maxVertices: 65536, maxShaderBytes: 262144 });

export class GraphicsRendererError extends Error {
  constructor(message, code = 'validation') {
    super(message); this.name = 'GraphicsRendererError'; this.code = code;
    this.status = ({ validation: -22, budget: -12, unavailable: -19, gpu: -5 })[code];
  }
}
const fail = (message, code) => { throw new GraphicsRendererError(message, code); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const bytesOf = s => new TextEncoder().encode(s).byteLength;
function record(o, keys, name) {
  if (!o || typeof o !== 'object' || Array.isArray(o) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(o))) fail(`${name} must be a plain record`);
  for (const key of Reflect.ownKeys(o)) if (typeof key !== 'string' || !keys.includes(key)) fail(`unsupported ${name} field: ${String(key)}`);
  return o;
}
function integer(n, min, max, name) {
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(`invalid ${name}`);
  return n;
}
function finite(n, min, max, name) {
  if (!Number.isFinite(n) || n < min || n > max) fail(`invalid ${name}`);
  return n;
}
function choice(n, values, name) { if (!values.includes(n)) fail(`unsupported ${name}`); return n; }
function array(a, min, max, name) {
  if (!Array.isArray(a) || a.length < min || a.length > max) fail(`invalid ${name}`);
  // Reject sparse arrays as well as explicitly missing elements.
  for (let i = 0; i < a.length; i++) if (!own(a, i)) fail(`sparse ${name}`);
  return a;
}
const freeze = o => {
  if (o && typeof o === 'object') { for (const v of Object.values(o)) freeze(v); Object.freeze(o); }
  return o;
};
const FORMAT_COMPONENTS = Object.freeze({ float32x2: 2, float32x3: 3, float32x4: 4 });
// Opt-in A3 uniform-buffer profile. Absent options keep the resource-free contract.
export const UNIFORM_LIMITS = Object.freeze({ maxGroups: 4, maxBindings: 16, maxUniforms: 8, maxRange: 16384,
  offsetAlignment: 256, maxBufferBytes: 65536 });
const UNIFORM_MEMBER_BYTES = Object.freeze({ f32: 4, vec2: 8, vec3: 12, vec4: 16, mat4x4: 64 });
const UNIFORM_MEMBER_ALIGN = Object.freeze({ f32: 4, vec2: 8, vec3: 16, vec4: 16, mat4x4: 16 });
// Opt-in A4 sampled-texture profile (combined image samplers); requires the uniform profile.
export const TEXTURE_LIMITS = Object.freeze({ maxTextures: 16, maxDimension: 128, maxLargeDimension: 2048, maxSamplers: 32, samplerBindingOffset: 16, maxAnisotropy: 16 });
// Opt-in A5 depth-attachment profile; requires the texture profile. Depth does
// not change shader validation, so shaderOptions() never forwards it.
export const DEPTH_FORMATS = Object.freeze(['depth32float', 'depth16unorm']);
export const DEPTH_COMPARE = Object.freeze(['never', 'less', 'equal', 'less-equal', 'greater', 'not-equal', 'greater-equal', 'always']);
const profileOptions = options => {
  if (options === undefined) return { allowUniforms: false, allowTextures: false, allowDepth: false };
  record(options, ['allowUniforms', 'allowTextures', 'allowDepth'], 'shader options');
  const allowUniforms = choice(options.allowUniforms ?? false, [false, true], 'uniform option');
  const allowTextures = choice(options.allowTextures ?? false, [false, true], 'texture option');
  const allowDepth = choice(options.allowDepth ?? false, [false, true], 'depth option');
  if (allowTextures && !allowUniforms) fail('texture profile requires the uniform profile');
  if (allowDepth && !allowTextures) fail('depth profile requires the texture profile');
  return { allowUniforms, allowTextures, allowDepth };
};
/** Pipeline depth state: null (no depth attachment) or format/compare/write. */
export function validateDepthState(input) {
  if (input === null || input === undefined) return null;
  record(input, ['format', 'depthCompare', 'depthWriteEnabled'], 'pipeline depth');
  return { format: choice(input.format, DEPTH_FORMATS, 'depth format'),
    depthCompare: choice(input.depthCompare, DEPTH_COMPARE, 'depth compare'),
    depthWriteEnabled: choice(input.depthWriteEnabled, [false, true], 'depth write') };
}
/** Pass depth attachment: load clear/load, store store/discard, clearValue in [0,1]. */
export function validateDepthAttachment(input) {
  record(input, ['target', 'loadOp', 'storeOp', 'clearValue'], 'depth attachment');
  const loadOp = choice(input.loadOp, ['clear', 'load'], 'depth load operation');
  const storeOp = choice(input.storeOp, ['store', 'discard'], 'depth store operation');
  if (loadOp === 'clear') finite(input.clearValue, 0, 1, 'depth clear value');
  else if (own(input, 'clearValue')) fail('depth clear value requires clear load');
  return { target: input.target, loadOp, storeOp, ...(loadOp === 'clear' ? { clearValue: input.clearValue } : {}) };
}
const uniformsAllowed = options => profileOptions(options).allowUniforms;
const shaderOptions = ({ allowUniforms, allowTextures }) => // allowDepth deliberately excluded
  allowTextures ? [{ allowUniforms, allowTextures }] : allowUniforms ? [{ allowUniforms }] : [];
export { profileOptions };

/** Copy translator uniform reflection: sorted unique set/binding, naturally aligned f32/vecN/mat4 blocks. */
export function validateUniformReflection(resources, allowUniforms, blockNames = false, allowTextures = false) {
  if (!allowUniforms) { array(resources, 0, 0, 'shader resources'); return []; }
  if (allowTextures !== false && allowTextures !== true) fail('invalid texture option');
  let previous = -1, uniformCount = 0, textureCount = 0;
  return array(resources, 0, UNIFORM_LIMITS.maxUniforms + (allowTextures ? TEXTURE_LIMITS.maxTextures : 0), 'shader resources').map(item => {
    if (allowTextures && item?.type === 'texture') {
      record(item, ['group', 'binding', 'type', 'samplerBinding', ...(blockNames ? ['samplerName'] : [])], 'texture resource');
      const group = integer(item.group, 0, UNIFORM_LIMITS.maxGroups - 1, 'texture set');
      const binding = integer(item.binding, 0, UNIFORM_LIMITS.maxBindings - 1, 'texture binding');
      if (group * 16 + binding <= previous) fail('shader resources must be sorted and unique');
      previous = group * 16 + binding;
      if (item.samplerBinding !== binding + TEXTURE_LIMITS.samplerBindingOffset) fail('invalid combined sampler binding');
      if (++textureCount > TEXTURE_LIMITS.maxTextures) fail('too many sampled textures');
      if (blockNames && (typeof item.samplerName !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,159}$/.test(item.samplerName))) fail('invalid sampler name');
      return { group, binding, type: 'texture', samplerBinding: item.samplerBinding, ...(blockNames ? { samplerName: item.samplerName } : {}) };
    }
    record(item, ['group', 'binding', 'type', 'size', 'members', ...(blockNames ? ['blockName'] : [])], 'uniform resource');
    const group = integer(item.group, 0, UNIFORM_LIMITS.maxGroups - 1, 'uniform set');
    const binding = integer(item.binding, 0, UNIFORM_LIMITS.maxBindings - 1, 'uniform binding');
    if (group * 16 + binding <= previous) fail('uniform resources must be sorted and unique');
    previous = group * 16 + binding;
    choice(item.type, ['uniform'], 'resource type');
    if (++uniformCount > UNIFORM_LIMITS.maxUniforms) fail('too many uniform blocks');
    const size = integer(item.size, 16, UNIFORM_LIMITS.maxRange, 'uniform block size');
    let offset = 0;
    const members = array(item.members, 1, 16, 'uniform members').map(member => {
      record(member, ['offset', 'type', 'arrayLength'], 'uniform member');
      const type = choice(member.type, Object.keys(UNIFORM_MEMBER_BYTES), 'uniform member type');
      const arrayLength = integer(member.arrayLength, 0, type === 'vec4' ? 1024 : 0, 'uniform array length');
      if (!Number.isInteger(member.offset) || member.offset < offset || member.offset % UNIFORM_MEMBER_ALIGN[type])
        fail('uniform members must be ordered and naturally aligned');
      offset = member.offset + UNIFORM_MEMBER_BYTES[type] * Math.max(1, arrayLength);
      return { offset: member.offset, type, arrayLength };
    });
    // The translator reports the member span rounded up to 16 bytes.
    if (((offset + 15) & ~15) !== size || size % 16) fail('uniform block size mismatch');
    if (blockNames && (typeof item.blockName !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,159}$/.test(item.blockName))) fail('invalid uniform block name');
    return { group, binding, type: 'uniform', size, members, ...(blockNames ? { blockName: item.blockName } : {}) };
  });
}
/** Vulkan gl_VertexIndex (u32, includes firstVertex); only with the uniform profile. */
export function validateVertexIndex(item, allowUniforms, stage, direction) {
  if (!allowUniforms || item?.builtin !== 'vertex_index') return null;
  record(item, ['builtin', 'type', 'interpolation'], 'vertex index');
  record(item.type, ['scalar', 'components'], 'interface type');
  if (stage !== 'vertex' || direction !== 'inputs' || item.type.scalar !== 'u32' || item.type.components !== 1 ||
      item.interpolation !== null) fail('unsupported vertex_index interface');
  return { builtin: 'vertex_index', type: { scalar: 'u32', components: 1 }, interpolation: null };
}

/** Copy and validate translator metadata; this is a trust boundary, not reflection of WGSL text. */
export function validateTranslatedShader(input, expectedStage, options) {
  choice(expectedStage, ['vertex', 'fragment'], 'shader stage');
  const { allowUniforms, allowTextures } = profileOptions(options);
  record(input, ['wgsl', 'schema', 'profile', 'backend', 'stage', 'originalEntryPoint', 'entryPoint',
    'coordinateAdjustment', 'inputs', 'outputs', 'resources'], 'translated shader');
  if (input.schema !== 1 || input.profile !== 'graphics-empty-v1' || input.backend !== 'wgsl' ||
      input.coordinateAdjustment !== true || input.stage !== expectedStage) fail('unsupported translation contract');
  if (typeof input.wgsl !== 'string' || !input.wgsl.length || bytesOf(input.wgsl) > GRAPHICS_LIMITS.maxShaderBytes) fail('invalid WGSL size');
  if (typeof input.entryPoint !== 'string' || !/^[A-Za-z_][A-Za-z_0-9]*$/.test(input.entryPoint) || input.entryPoint.length > 256) fail('invalid emitted entry point');
  if (typeof input.originalEntryPoint !== 'string' || !input.originalEntryPoint.length ||
      input.originalEntryPoint.includes('\0') || bytesOf(input.originalEntryPoint) > 128) fail('invalid original entry point');
  const resources = validateUniformReflection(input.resources, allowUniforms, false, allowTextures);
  const reflect = (items, direction) => {
    const locations = new Set(); let positions = 0, vertexIndex = 0;
    const result = array(items, 0, 9, `shader ${direction}`).map(item => {
      const index = validateVertexIndex(item, allowUniforms, expectedStage, direction);
      if (index) { if (++vertexIndex > 1) fail('duplicate vertex_index'); return index; }
      record(item, ['location', 'builtin', 'type', 'interpolation', 'invariant'], 'interface item');
      record(item.type, ['scalar', 'components'], 'interface type');
      if (item.type.scalar !== 'f32') fail('unsupported interface scalar');
      const components = choice(item.type.components, [1, 2, 3, 4], 'interface vector size');
      const type = { scalar: 'f32', components };
      if (own(item, 'builtin')) {
        if (own(item, 'location') || item.builtin !== 'position' || components !== 4 ||
            item.interpolation !== null || typeof item.invariant !== 'boolean' ||
            !((expectedStage === 'vertex' && direction === 'outputs') ||
              (expectedStage === 'fragment' && direction === 'inputs')) || ++positions > 1) fail('unsupported builtin interface');
        return { builtin: 'position', type, interpolation: null, invariant: item.invariant };
      }
      if (own(item, 'invariant')) fail('invariant is only supported on position');
      const location = integer(item.location, 0, 7, 'interface location');
      if (locations.has(location)) fail('duplicate interface location'); locations.add(location);
      const varying = (expectedStage === 'vertex' && direction === 'outputs') ||
        (expectedStage === 'fragment' && direction === 'inputs');
      let interpolation = null;
      if (varying) {
        record(item.interpolation, ['mode', 'sampling'], 'interpolation');
        const mode = choice(item.interpolation.mode, ['perspective', 'linear', 'flat'], 'interpolation');
        const declaredSampling = choice(item.interpolation.sampling, mode === 'flat' ? [null] : [null, 'center'], 'interpolation sampling');
        // Naga's absent non-flat sampling means center, as does WGSL's default.
        const sampling = mode === 'flat' ? null : declaredSampling ?? 'center';
        interpolation = { mode, sampling };
      } else if (item.interpolation !== null) fail('unexpected interpolation');
      return { location, type, interpolation };
    });
    if (expectedStage === 'vertex' && direction === 'outputs' && positions !== 1) fail('vertex position output required');
    if (expectedStage === 'fragment' && direction === 'outputs' &&
        (result.length !== 1 || result[0].location !== 0 || result[0].type.components !== 4)) fail('fragment location 0 float32x4 output required');
    return result;
  };
  return freeze({ schema: 1, profile: input.profile, backend: 'wgsl', stage: expectedStage,
    coordinateAdjustment: true, wgsl: input.wgsl, entryPoint: input.entryPoint,
    originalEntryPoint: input.originalEntryPoint, inputs: reflect(input.inputs, 'inputs'),
    outputs: reflect(input.outputs, 'outputs'), resources });
}

/** Backend-neutral profile and vertex declarations; no GPU enums/native objects here. */
export function validatePipelineDescriptor(input, validateShader = validateTranslatedShader, options) {
  const profile = profileOptions(options), { allowUniforms, allowTextures, allowDepth } = profile;
  record(input, ['vertex', 'fragment', 'vertexBuffers', 'colorFormat', 'topology', 'frontFace', 'cullMode', 'sampleCount', 'blend', 'colorWriteMask',
    ...(allowUniforms ? ['uniforms'] : []), ...(allowTextures ? ['textures'] : []), ...(allowDepth ? ['depth'] : [])], 'pipeline');
  const vertex = validateShader(input.vertex, 'vertex', ...shaderOptions(profile));
  const fragment = validateShader(input.fragment, 'fragment', ...shaderOptions(profile));
  const colorFormat = choice(input.colorFormat ?? 'rgba8unorm', ['rgba8unorm'], 'color format');
  const topology = choice(input.topology ?? 'triangle-list', ['triangle-list', 'line-list'], 'primitive topology');
  // Vulkan and WebGPU both decide winding as seen in the final image, so the
  // guest's frontFace/cullMode pass through (the WebGL renderer inverts it).
  const frontFace = choice(input.frontFace ?? 'ccw', ['ccw', 'cw'], 'front face');
  const cullMode = choice(input.cullMode ?? 'none', ['none', 'front', 'back'], 'cull mode');
  const sampleCount = choice(input.sampleCount ?? 1, [1], 'sample count');
  const supplied = new Map();
  const vertexBuffers = array(input.vertexBuffers, 0, GRAPHICS_LIMITS.maxVertexBuffers, 'vertex layouts').map(layout => {
    record(layout, ['stride', 'stepMode', 'attributes'], 'vertex layout');
    const stride = integer(layout.stride, 4, GRAPHICS_LIMITS.maxStride, 'vertex stride');
    if (stride % 4) fail('vertex stride must be aligned to four bytes');
    const stepMode = choice(layout.stepMode ?? 'vertex', ['vertex'], 'vertex step mode');
    const attributes = array(layout.attributes, 1, GRAPHICS_LIMITS.maxAttributes, 'vertex attributes').map(a => {
      record(a, ['location', 'offset', 'format'], 'vertex attribute');
      const location = integer(a.location, 0, 7, 'attribute location');
      const offset = integer(a.offset, 0, stride, 'attribute offset');
      const format = choice(a.format, Object.keys(FORMAT_COMPONENTS), 'vertex format');
      if (offset % 4 || offset + FORMAT_COMPONENTS[format] * 4 > stride) fail('attribute exceeds/alignment of stride');
      if (supplied.has(location)) fail('duplicate vertex attribute');
      supplied.set(location, FORMAT_COMPONENTS[format]);
      return { location, offset, format };
    });
    return { stride, stepMode, attributes };
  });
  const attributes = vertex.inputs.filter(i => own(i, 'location'));
  // A format may supply fewer components than the shader reads (Vulkan, WebGPU
  // and WebGL2 all fill the rest from (0, 0, 0, 1)); GL attributes reach Zink as vec4.
  if (supplied.size > GRAPHICS_LIMITS.maxAttributes || supplied.size !== attributes.length ||
      attributes.some(i => !(supplied.get(i.location) <= i.type.components))) fail('vertex attributes do not match shader inputs');
  // Declared Vulkan pipeline-layout bindings (sorted); stages bit0 vertex, bit1 fragment.
  // minSize is the largest statically used shader block, or 0 if no stage uses it.
  let previous = -1;
  const uniforms = !allowUniforms ? [] : array(input.uniforms ?? [], 0, UNIFORM_LIMITS.maxUniforms, 'pipeline uniforms').map(u => {
    record(u, ['group', 'binding', 'stages'], 'pipeline uniform');
    const group = integer(u.group, 0, UNIFORM_LIMITS.maxGroups - 1, 'uniform set');
    const binding = integer(u.binding, 0, UNIFORM_LIMITS.maxBindings - 1, 'uniform binding');
    const stages = integer(u.stages, 1, 3, 'uniform stages');
    if (group * 16 + binding <= previous) fail('pipeline uniforms must be sorted and unique');
    previous = group * 16 + binding;
    const sizes = [[vertex, 1], [fragment, 2]].flatMap(([shader, bit]) => shader.resources
      .filter(r => r.group === group && r.binding === binding).map(r => {
        if (r.type !== 'uniform') fail('shader texture declared as a uniform buffer in the pipeline layout');
        if (!(stages & bit)) fail('shader uniform is not visible to its stage in the pipeline layout');
        return r.size;
      }));
    return { group, binding, stages, minSize: Math.max(0, ...sizes) };
  });
  previous = -1;
  const textures = !allowTextures ? [] : array(input.textures ?? [], 0, TEXTURE_LIMITS.maxTextures, 'pipeline textures').map(t => {
    record(t, ['group', 'binding', 'stages'], 'pipeline texture');
    const group = integer(t.group, 0, UNIFORM_LIMITS.maxGroups - 1, 'texture set');
    const binding = integer(t.binding, 0, UNIFORM_LIMITS.maxBindings - 1, 'texture binding');
    const stages = integer(t.stages, 1, 3, 'texture stages');
    if (group * 16 + binding <= previous) fail('pipeline textures must be sorted and unique');
    previous = group * 16 + binding;
    if (uniforms.some(u => u.group === group && u.binding === binding)) fail('pipeline texture/uniform binding collision');
    for (const [shader, bit] of [[vertex, 1], [fragment, 2]]) for (const r of shader.resources)
      if (r.group === group && r.binding === binding) {
        if (r.type !== 'texture') fail('shader uniform declared as a texture in the pipeline layout');
        if (!(stages & bit)) fail('shader texture is not visible to its stage in the pipeline layout');
      }
    return { group, binding, stages };
  });
  for (const shader of [vertex, fragment]) for (const r of shader.resources)
    if (!(r.type === 'texture' ? textures : uniforms).some(u => u.group === r.group && u.binding === r.binding))
      fail(`shader ${r.type} missing from the pipeline layout`);
  const outputs = new Map(vertex.outputs.filter(i => own(i, 'location')).map(i => [i.location, i]));
  for (const input of fragment.inputs.filter(i => own(i, 'location'))) {
    const output = outputs.get(input.location);
    if (!output || output.type.components !== input.type.components ||
        output.interpolation.mode !== input.interpolation.mode ||
        output.interpolation.sampling !== input.interpolation.sampling)
      fail(`vertex/fragment interface mismatch at location ${input.location}: ` +
        (output ? `out ${output.type.components}/${output.interpolation.mode}/${output.interpolation.sampling}` : 'no output') +
        ` in ${input.type.components}/${input.interpolation.mode}/${input.interpolation.sampling}`);
  }
  const depth = allowDepth ? validateDepthState(input.depth) : null;
  const blend = input.blend === undefined ? null : validateBlendState(input.blend);
  // Pipeline-state profile: RGBA write mask bits (Vulkan R,G,B,A = WebGPU RED,GREEN,BLUE,ALPHA).
  const colorWriteMask = integer(input.colorWriteMask ?? 15, 0, 15, 'colour write mask');
  return freeze({ vertex, fragment, vertexBuffers, colorFormat, topology, frontFace, cullMode, sampleCount, uniforms, colorWriteMask, ...(blend ? { blend } : {}),
    ...(allowTextures ? { textures } : {}), ...(allowDepth ? { depth } : {}) });
}

/** Draw-time combined image samplers, in pipeline-layout order; textures must hold uploaded contents. */
export function validateDrawTextures(input, descriptor, allowTextures, lookupTexture, lookupSampler, allowSwizzle = false) {
  if (!allowTextures) return [];
  const declared = descriptor.textures ?? [];
  return array(input ?? [], declared.length, declared.length, 'draw textures').map((t, i) => {
    record(t, ['group', 'binding', 'texture', 'sampler', 'levels', ...(allowSwizzle ? ['swizzle'] : [])], 'texture binding');
    if (t.group !== declared[i].group || t.binding !== declared[i].binding) fail('draw textures do not match the pipeline layout');
    const entry = lookupTexture(t.texture);
    if (!entry.initialized) fail('sampled texture has no uploaded contents');
    lookupSampler(t.sampler);
    // Optional [baseMipLevel, mipLevelCount] view range within the texture's chain.
    let levels;
    if (t.levels !== undefined) {
      const total = entry.mipLevelCount ?? 1, [base, count] = array(t.levels, 2, 2, 'texture levels');
      levels = Object.freeze([integer(base, 0, total - 1, 'texture base level'), integer(count, 1, total - base, 'texture level count')]);
    }
    // Optional component swizzle (texture-component-swizzle): four of r g b a 0 1.
    const swizzle = t.swizzle ?? 'rgba';
    if (typeof swizzle !== 'string' || !/^[rgba01]{4}$/.test(swizzle)) fail('invalid texture swizzle');
    // Same field set as the input: recorded draws are revalidated at end().
    return Object.freeze({ group: declared[i].group, binding: declared[i].binding, texture: t.texture, sampler: t.sampler, ...(levels ? { levels } : {}),
      ...(swizzle !== 'rgba' ? { swizzle } : {}) });
  });
}
function chainBytes(d) {
  let bytes = 0; for (let l = 0; l < d.mipLevelCount; l++) bytes += Math.max(1, d.width >> l) * Math.max(1, d.height >> l) * 4;
  return bytes;
}
// Mipmap profile: a full or partial chain, at most floor(log2(max extent)) + 1 levels.
function mipLevels(input, width, height) {
  return integer(input.mipLevelCount ?? 1, 1, Math.floor(Math.log2(Math.max(width, height))) + 1, 'mip level count');
}
export function validateTextureDescriptor(input) {
  record(input, ['width', 'height', 'format', 'mipLevelCount'], 'texture');
  // Callers enforce the negotiated 128 or large-profile extent.
  const width = integer(input.width, 1, TEXTURE_LIMITS.maxLargeDimension, 'texture width');
  const height = integer(input.height, 1, TEXTURE_LIMITS.maxLargeDimension, 'texture height');
  return Object.freeze({ width, height, mipLevelCount: mipLevels(input, width, height),
    format: choice(input.format ?? 'rgba8unorm', ['rgba8unorm', 'rgba8unorm-srgb'], 'texture format') });
}
export function validateSamplerDescriptor(input) {
  record(input, ['magFilter', 'minFilter', 'addressModeU', 'addressModeV', 'maxAnisotropy', 'mipmapFilter', 'lodMinClamp', 'lodMaxClamp'], 'sampler');
  const filters = ['nearest', 'linear'], modes = ['repeat', 'clamp-to-edge', 'mirror-repeat'];
  const descriptor = { magFilter: choice(input.magFilter, filters, 'sampler mag filter'),
    minFilter: choice(input.minFilter, filters, 'sampler min filter'),
    addressModeU: choice(input.addressModeU, modes, 'sampler address mode U'),
    addressModeV: choice(input.addressModeV, modes, 'sampler address mode V') };
  // WebGPU accepts anisotropy above 1 only with all-linear filtering.
  if (input.maxAnisotropy !== undefined) {
    descriptor.maxAnisotropy = integer(input.maxAnisotropy, 2, TEXTURE_LIMITS.maxAnisotropy, 'sampler max anisotropy');
    if (descriptor.magFilter !== 'linear' || descriptor.minFilter !== 'linear') fail('sampler anisotropy requires linear filters');
  }
  if (input.mipmapFilter !== undefined) {
    descriptor.mipmapFilter = choice(input.mipmapFilter, filters, 'sampler mipmap filter');
    if (descriptor.maxAnisotropy && descriptor.mipmapFilter !== 'linear') fail('sampler anisotropy requires linear filters');
  }
  if (input.lodMinClamp !== undefined) descriptor.lodMinClamp = finite(input.lodMinClamp, 0, 32, 'sampler minimum LOD');
  if (input.lodMaxClamp !== undefined) descriptor.lodMaxClamp = finite(input.lodMaxClamp, descriptor.lodMinClamp ?? 0, 32, 'sampler maximum LOD');
  return Object.freeze(descriptor);
}
export function validateTextureUpload(entry, data) {
  const { width, height } = entry.descriptor;
  if (!(data instanceof Uint8Array) || data.byteLength !== width * height * 4) fail('texture upload requires exactly width*height*4 RGBA8 bytes');
  return data.slice();
}

/** Shared draw-time uniform range validation for both backends. */
export function validateDrawUniforms(input, descriptor, allowUniforms, lookup) {
  if (!allowUniforms) return [];
  return array(input ?? [], descriptor.uniforms.length, descriptor.uniforms.length, 'draw uniforms').map((u, i) => {
    record(u, ['group', 'binding', 'buffer', 'offset', 'size'], 'uniform binding');
    const declared = descriptor.uniforms[i];
    if (u.group !== declared.group || u.binding !== declared.binding) fail('draw uniforms do not match the pipeline layout');
    const entry = lookup(u.buffer);
    const offset = integer(u.offset, 0, entry.descriptor.size - 16, 'uniform offset');
    const size = integer(u.size, 16, Math.min(UNIFORM_LIMITS.maxRange, entry.descriptor.size - offset), 'uniform range');
    if (offset % UNIFORM_LIMITS.offsetAlignment || size % 16) fail('uniform offset/range alignment');
    if (size < declared.minSize) fail('uniform range is smaller than the shader block');
    return Object.freeze({ group: declared.group, binding: declared.binding, buffer: u.buffer, offset, size });
  });
}
export function validateUniformBufferDescriptor(input) {
  record(input, ['size'], 'uniform buffer');
  const size = integer(input.size, 16, UNIFORM_LIMITS.maxBufferBytes, 'uniform buffer size');
  if (size % 16) fail('uniform buffer size must be aligned to 16 bytes');
  return Object.freeze({ size });
}

export function validateTargetDescriptor(input) {
  record(input, ['width', 'height', 'format', 'mipLevelCount'], 'target');
  const width = integer(input.width, 1, GRAPHICS_LIMITS.maxTargetSize, 'target width');
  const height = integer(input.height, 1, GRAPHICS_LIMITS.maxTargetSize, 'target height');
  return freeze({ width, height, mipLevelCount: mipLevels(input, width, height),
    format: choice(input.format ?? 'rgba8unorm', ['rgba8unorm'], 'target format') });
}

function rectangle(input, target, viewport) {
  if (input === undefined) input = { x: 0, y: 0, width: target.width, height: target.height,
    ...(viewport ? { minDepth: 0, maxDepth: 1 } : {}) };
  record(input, viewport ? ['x', 'y', 'width', 'height', 'minDepth', 'maxDepth'] : ['x', 'y', 'width', 'height'], viewport ? 'viewport' : 'scissor');
  const number = viewport ? finite : integer;
  const x = number(input.x, 0, target.width, 'rectangle x');
  const y = number(input.y, 0, target.height, 'rectangle y');
  const width = number(input.width, viewport ? Number.MIN_VALUE : 0, target.width - x, 'rectangle width');
  const height = number(input.height, viewport ? Number.MIN_VALUE : 0, target.height - y, 'rectangle height');
  return freeze({ x, y, width, height, ...(viewport ? {
    minDepth: finite(input.minDepth ?? 0, 0, 1, 'minimum depth'),
    maxDepth: finite(input.maxDepth ?? 1, input.minDepth ?? 0, 1, 'maximum depth') } : {}) });
}

// Vulkan negative-height viewports (maintenance1) are drawn with the positive
// rectangle and a pipeline variant that omits the translator's clip-space Y
// negation; the framebuffer coordinates, and so facing, then match Vulkan.
// Naga emits exactly one `let _eN: f32 = P.y;` then `P.y = -(_eN);` for the position output P.
export function unflippedVertexWgsl(wgsl) {
  const pattern = /(let (_e\d+): f32 = ([\w.\[\]]+)\.y;\s*\3\.y = )-\(\2\);/g;
  const matches = [...wgsl.matchAll(pattern)];
  if (matches.length !== 1) fail('vertex shader has no single clip-space Y adjustment for a flipped viewport');
  return wgsl.replace(pattern, '$1$2;');
}

// Opt-in blend profile: one colour target, WebGPU factor/operation names
// without constant or dual-source factors. min/max ignore factors (Vulkan),
// which WebGPU expresses as one/one.
const BLEND_FACTORS = ['zero', 'one', 'src', 'one-minus-src', 'dst', 'one-minus-dst', 'src-alpha', 'one-minus-src-alpha',
  'dst-alpha', 'one-minus-dst-alpha', 'src-alpha-saturated'];
function validateBlendState(input) {
  record(input, ['color', 'alpha'], 'blend');
  const component = (c, name) => {
    record(c, ['srcFactor', 'dstFactor', 'operation'], name);
    const operation = choice(c.operation, ['add', 'subtract', 'reverse-subtract', 'min', 'max'], `${name} operation`);
    const srcFactor = choice(c.srcFactor, BLEND_FACTORS, `${name} source factor`);
    const dstFactor = choice(c.dstFactor, BLEND_FACTORS, `${name} destination factor`);
    if ((operation === 'min' || operation === 'max') && (srcFactor !== 'one' || dstFactor !== 'one')) fail(`${name} min/max requires one factors`);
    return freeze({ operation, srcFactor, dstFactor });
  };
  return freeze({ color: component(input.color, 'blend color'), alpha: component(input.alpha, 'blend alpha') });
}

// WebGPU conversion is isolated from the declarative profile above. Translation
// owns clip-coordinate adjustment; there is no additional Y or depth transform.
function webgpuPipeline(descriptor, vertex, fragment, layout) {
  return { layout, vertex: { module: vertex, entryPoint: descriptor.vertex.entryPoint,
    buffers: descriptor.vertexBuffers.map(b => ({ arrayStride: b.stride, stepMode: b.stepMode,
      attributes: b.attributes.map(a => ({ shaderLocation: a.location, offset: a.offset, format: a.format })) })) },
  fragment: { module: fragment, entryPoint: descriptor.fragment.entryPoint,
    targets: [{ format: descriptor.colorFormat, writeMask: descriptor.colorWriteMask ?? 0xf, ...(descriptor.blend ? { blend: descriptor.blend } : {}) }] },
  primitive: { topology: descriptor.topology, frontFace: descriptor.frontFace, cullMode: descriptor.cullMode,
    unclippedDepth: false }, multisample: { count: descriptor.sampleCount, mask: 0xffffffff, alphaToCoverageEnabled: false },
  ...(descriptor.depth ? { depthStencil: { format: descriptor.depth.format, depthWriteEnabled: descriptor.depth.depthWriteEnabled,
    depthCompare: descriptor.depth.depthCompare } } : {}) };
}

/**
 * Uses an existing GPUDevice. Handles are opaque objects scoped to this renderer;
 * the host adapter owns wire IDs and the device. Async methods serialize GPU error
 * scopes. The caller must not interleave its own error scopes on this same device.
 */
const STAGING_CACHE_BYTES = 1 << 20;

export function createGraphicsRenderer(device, { onEvent = () => {}, allowUniforms = false, allowTextures = false, allowDepth = false } = {}) {
  const textureSwizzle = allowTextures && device.features?.has?.('texture-component-swizzle') === true;
  if (!device?.queue || !device?.lost?.then) fail('existing WebGPU device required', 'unavailable');
  if (typeof onEvent !== 'function') fail('onEvent must be a function');
  choice(allowUniforms, [false, true], 'uniform option'); choice(allowTextures, [false, true], 'texture option');
  if (allowTextures && !allowUniforms) fail('texture profile requires the uniform profile');
  choice(allowDepth, [false, true], 'depth option');
  if (allowDepth && !allowTextures) fail('depth profile requires the texture profile');
  const uniformOptions = allowDepth ? { allowUniforms, allowTextures, allowDepth } :
    allowTextures ? { allowUniforms, allowTextures } : allowUniforms ? { allowUniforms } : undefined;
  const resources = new Map(), native = new Map(), cancelWaits = new Set();
  let state = 'open', cause = '', bytes = 0, recording = null, tail = Promise.resolve();
  // P1: error-scope results of acknowledged uploads that are still in flight, and one
  // cached readback staging buffer (outside the logical byte budget while idle).
  let deferred = new Set(), staging = null;
  // Direct presentation: one OffscreenCanvas per guest swapchain surface id. A
  // page-owned canvas is updated mailbox-style: each guest present only copies into
  // the surface's frame texture, and the newest frame is copied to the canvas once
  // per display frame, so the guest queue is never paced by canvas presentation.
  const presentSurfaces = new Map();
  let presentScheduled = false;
  const nextDisplayFrame = callback => typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(callback) : setTimeout(callback, 16);
  const showPresented = () => {
    presentScheduled = false;
    if (state !== 'open') return;
    const encoder = device.createCommandEncoder(); let copies = 0;
    for (const entry of presentSurfaces.values()) {
      if (!entry.dirty) continue;
      entry.dirty = false; copies++;
      encoder.copyTextureToTexture({ texture: entry.frame }, { texture: entry.context.getCurrentTexture() }, [entry.width, entry.height, 1]);
    }
    if (copies) { device.queue.submit([encoder.finish()]); counters.presentsShown += copies; }
  };
  const forgetPresent = entry => {
    try { entry.context.unconfigure(); } catch {}
    try { entry.frame?.destroy(); } catch {}
  };
  const counters = { flippedPipelines: 0, presentsShown: 0, buffersCreated: 0, buffersDestroyed: 0, texturesCreated: 0, texturesDestroyed: 0,
    passes: 0, draws: 0, readbacks: 0, uploads: 0, uniformUploads: 0, ...(allowTextures ? { textureUploads: 0, samplersCreated: 0, blits: 0 } : {}) };
  const event = e => { try { onEvent(e); } catch { /* diagnostics cannot change renderer state */ } };
  const unavailable = () => new GraphicsRendererError(cause || `renderer ${state}`, 'unavailable');
  const available = () => { if (state !== 'open') throw unavailable(); };
  const wait = promise => new Promise((resolve, reject) => {
    if (state !== 'open') { Promise.resolve(promise).catch(() => {}); reject(unavailable()); return; }
    const cancel = () => reject(unavailable()); cancelWaits.add(cancel);
    Promise.resolve(promise).then(resolve, reject).finally(() => cancelWaits.delete(cancel));
  });
  const releaseNative = object => {
    const entry = native.get(object); if (!entry) return;
    native.delete(object); bytes -= entry.bytes;
    counters[entry.kind === 'buffer' ? 'buffersDestroyed' : 'texturesDestroyed']++;
    try { object.destroy(); } catch (error) { event({ type: 'destroy-error', message: String(error.message) }); }
  };
  const dropStaging = () => {
    if (!staging) return;
    const { object } = staging; staging = null; counters.buffersDestroyed++;
    try { object.destroy(); } catch (error) { event({ type: 'destroy-error', message: String(error.message) }); }
  };
  const dispose = (nextState, reason) => {
    if (state !== 'open') return;
    state = nextState; cause = reason; recording = null; resources.clear(); deferred = new Set();
    for (const cancel of cancelWaits) cancel(); cancelWaits.clear();
    for (const object of native.keys()) releaseNative(object);
    dropStaging();
    for (const surface of presentSurfaces.values()) forgetPresent(surface);
    presentSurfaces.clear();
    event({ type: nextState, message: reason });
  };
  device.lost.then(info => dispose('lost', `device lost: ${info?.message ?? 'unknown'}`),
    error => dispose('lost', `device loss notification failed: ${error?.message ?? error}`));
  const PASSES_IN_FLIGHT = 8, inflight = [];
  const enqueue = action => {
    const result = tail.then(() => { available(); return action(); });
    tail = result.catch(() => {}); return result;
  };
  // Error scopes. Attribution happens when the native call is made, so a scope set
  // is pushed around each native call and popped immediately; the pop promises are
  // awaited later, together with any other promise of the same operation (one GPU
  // process round trip instead of one per call). Pops resolve in wire order.
  const FILTERS = ['internal', 'out-of-memory', 'validation'];
  const scoped = action => {
    let count = 0, result, caught;
    try {
      for (const filter of FILTERS) { device.pushErrorScope(filter); count++; }
      result = action();
    } catch (error) { caught = error; }
    const pops = [];
    while (count) { const filter = FILTERS[--count];
      try { pops.push(Promise.resolve(device.popErrorScope()).then(error => ({ filter, error }))); }
      catch (error) { caught ??= error; }
    }
    return { result, caught, pops: Promise.all(pops) };
  };
  // Classification is unchanged from the serial version: the first scoped error in
  // pop order wins (validation, out-of-memory, internal), then a thrown exception.
  const classify = (errors, caught) => {
    const hit = errors.find(e => e.error);
    if (hit) fail(`WebGPU ${hit.filter}: ${hit.error.message}`,
      hit.filter === 'out-of-memory' ? 'budget' : hit.filter === 'validation' ? 'validation' : 'gpu');
    if (caught) { if (caught instanceof GraphicsRendererError) throw caught; fail(`WebGPU operation: ${caught.message ?? caught}`, 'gpu'); }
  };
  // Bind groups are reused while the layout, bound objects and ranges are the same.
  // Native objects get unique ids, so a destroyed object's group is never matched.
  const objectIds = new WeakMap(), views = new WeakMap(), bindGroups = new WeakMap();
  let nextObjectId = 1;
  const objectId = object => { let id = objectIds.get(object); if (!id) objectIds.set(object, id = nextObjectId++); return id; };
  const viewOf = texture => { let view = views.get(texture); if (!view) views.set(texture, view = texture.createView()); return view; };
  // Level-range views (mipmap profile); a one-level texture's full view is its only level.
  const levelViews = new WeakMap();
  const levelView = (texture, base, count, swizzle = 'rgba') => {
    if (base === 0 && count === texture.mipLevelCount && swizzle === 'rgba') return viewOf(texture);
    let map = levelViews.get(texture); if (!map) levelViews.set(texture, map = new Map());
    const key = `${base}:${count}:${swizzle}`; let view = map.get(key);
    // Swizzled views may only be sampled, so they narrow the view usage.
    if (!view) map.set(key, view = texture.createView({ baseMipLevel: base, mipLevelCount: count,
      ...(swizzle !== 'rgba' ? { swizzle, usage: GPUTextureUsage.TEXTURE_BINDING } : {}) }));
    return view;
  };
  const attachmentView = texture => levelView(texture, 0, 1);
  // Blits draw one quad into a destination level: the viewport is the destination
  // rectangle and the vertex shader maps it to normalised source coordinates.
  const BLIT_WGSL = `struct Rect { uv: vec4f };
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var linearOrNearest: sampler;
@group(0) @binding(2) var<uniform> rect: Rect;
struct Out { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> Out {
  let corner = vec2f(f32(index & 1u), f32(index >> 1u));
  var out: Out; out.position = vec4f(corner.x * 2.0 - 1.0, 1.0 - corner.y * 2.0, 0.0, 1.0);
  out.uv = mix(rect.uv.xy, rect.uv.zw, corner); return out;
}
@fragment fn fs(v: Out) -> @location(0) vec4f { return textureSampleLevel(source, linearOrNearest, v.uv, 0.0); }`;
  let blitState = null; const blitPipelines = new Map();
  const blitPipeline = async format => {
    if (!blitState) blitState = await checked(() => {
      const layout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }] });
      const sampler = filter => device.createSampler({ magFilter: filter, minFilter: filter, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
      return { layout, module: device.createShaderModule({ code: BLIT_WGSL }), nearest: sampler('nearest'), linear: sampler('linear'),
        uniform: device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }) };
    });
    let pipeline = blitPipelines.get(format);
    if (!pipeline) blitPipelines.set(format, pipeline = await checked(() => device.createRenderPipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [blitState.layout] }),
      vertex: { module: blitState.module, entryPoint: 'vs' }, fragment: { module: blitState.module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-strip' } })));
    return pipeline;
  };
  const bindGroup = (layout, group, draw) => {
    const entries = [], key = [];
    for (const u of draw.uniforms) if (u.group === group) {
      const buffer = get(u.buffer, 'uniform-buffer').object;
      entries.push({ binding: u.binding, resource: { buffer, offset: u.offset, size: u.size } });
      key.push(`u${u.binding}:${objectId(buffer)}:${u.offset}:${u.size}`);
    }
    for (const t of draw.textures ?? []) if (t.group === group) {
      const texture = sampled(t.texture).object, sampler = get(t.sampler, 'sampler').object;
      const [base, count] = t.levels ?? [0, texture.mipLevelCount], swizzle = t.swizzle ?? 'rgba';
      entries.push({ binding: t.binding, resource: levelView(texture, base, count, swizzle) },
        { binding: t.binding + TEXTURE_LIMITS.samplerBindingOffset, resource: sampler });
      key.push(`t${t.binding}:${objectId(texture)}:${objectId(sampler)}:${base}:${count}:${swizzle}`);
    }
    let cache = bindGroups.get(layout);
    if (!cache) bindGroups.set(layout, cache = new Map());
    const name = key.join(','); let object = cache.get(name);
    if (!object) {
      if (cache.size >= 256) cache.clear();
      cache.set(name, object = device.createBindGroup({ layout, entries }));
    }
    return object;
  };
  const takeDeferred = () => Promise.all([...deferred]);
  // Deferred scope sets settle in the background (no GPU process round trip on the
  // guest's path); the first error found disposes the renderer, so every later
  // operation fails. settle() still awaits whatever is outstanding.
  const defer = pops => {
    const set = deferred; set.add(pops);
    pops.then(list => {
      set.delete(pops);
      const hit = list.find(e => e.error);
      if (hit && set === deferred) dispose('failed', `WebGPU ${hit.filter} after acknowledged operation: ${hit.error.message}`);
    }, () => set.delete(pops));
  };
  // An upload already acknowledged to the guest cannot be failed retroactively:
  // any scoped error it produced is terminal for the renderer.
  const settleDeferred = results => {
    const hit = results.flat().find(e => e.error);
    if (!hit) return;
    const message = `WebGPU ${hit.filter} after acknowledged upload: ${hit.error.message}`;
    dispose('failed', message); fail(message, 'gpu');
  };
  // Awaits this operation's scope sets (and extra promises) together with every
  // deferred upload scope set. Returns the per-set error lists for classification.
  const settle = async (sets, extra = []) => {
    // A rejected extra promise (work-done, mapAsync) is captured separately so the
    // scope results are still classified first, as in the serial version.
    let prior = [], lists = [], caught, rejected = null;
    const work = Promise.all(extra).then(() => {}, error => { rejected = { error }; });
    try { [prior, lists] = await wait(Promise.all([takeDeferred(), Promise.all(sets), work])); }
    catch (error) { caught = error; }
    if (rejected) caught ??= rejected.error;
    available(); settleDeferred(prior);
    return { lists: lists.length ? lists : sets.map(() => []), caught };
  };
  const checked = async action => {
    available();
    let count = 0, result, caught;
    try {
      for (const filter of FILTERS) { device.pushErrorScope(filter); count++; }
      result = await wait(action());
    } catch (error) { caught = error; }
    const pops = [];
    while (count) { const filter = FILTERS[--count];
      try { pops.push(Promise.resolve(device.popErrorScope()).then(error => ({ filter, error }))); }
      catch (error) { caught ??= error; }
    }
    const settled = await settle([Promise.all(pops)]);
    classify(settled.lists[0], caught ?? settled.caught);
    return result;
  };
  // Uploads: JavaScript range/alignment checks already ran, so the queue write can
  // only fail natively (out of memory, internal, device loss). Its scope results are
  // deferred and settle in the background; at most MAX_DEFERRED pend.
  const MAX_DEFERRED = 1024;
  const deferredWrite = async action => {
    available();
    const write = scoped(action);
    if (write.caught) { const settled = await settle([write.pops]); classify(settled.lists[0], write.caught ?? settled.caught); }
    defer(write.pops);
    if (deferred.size >= MAX_DEFERRED) { const settled = await settle([]); classify([], settled.caught); }
  };
  const budget = allocation => {
    if (resources.size >= GRAPHICS_LIMITS.maxResources || allocation > GRAPHICS_LIMITS.maxBytes - bytes) fail('renderer resource budget exceeded', 'budget');
  };
  const track = (object, kind, size) => {
    native.set(object, { kind, bytes: size }); bytes += size;
    counters[kind === 'buffer' ? 'buffersCreated' : 'texturesCreated']++;
    return object;
  };
  const add = (kind, object, descriptor, extra = {}) => {
    available(); const handle = Object.freeze({ kind });
    resources.set(handle, { ...extra, kind, object, descriptor, initialized: false }); return handle;
  };
  const get = (handle, kind) => {
    available(); const entry = resources.get(handle);
    if (!entry || entry.kind !== kind) fail(`stale, foreign or wrong-type ${kind} handle`);
    return entry;
  };
  // Colour targets are also sampleable (Zink allocates GL colour resources with
  // SAMPLED usage); WebGPU zero-initialises them, so they need no prior upload.
  // Sampled depth (depth sample profile): a depth target is sampled through an
  // r32float companion holding (d, 0, 0, 1), converted before the sampling pass
  // whenever a pass stored the depth since the last conversion.
  const depthSampling = allowTextures && device.features?.has?.('float32-filterable') === true;
  const sampled = handle => {
    const entry = resources.get(handle);
    if (entry?.kind === 'target') return (available(), entry);
    if (depthSampling && entry?.kind === 'depth-target') return (available(), depthCompanion(entry));
    return get(handle, 'sampled-texture');
  };
  const DEPTH_SAMPLE_WGSL = `@group(0) @binding(0) var depth: texture_depth_2d;
@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  return vec4f(f32(index & 1u) * 4.0 - 1.0, f32(index >> 1u) * 4.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f { return vec4f(textureLoad(depth, vec2i(p.xy), 0), 0.0, 0.0, 1.0); }`;
  let depthSampleState = null;
  const depthCompanion = entry => {
    if (!entry.companion) {
      const { width, height } = entry.descriptor, size = width * height * 4;
      budget(size);
      const object = track(device.createTexture({ size: [width, height, 1], format: 'r32float', mipLevelCount: 1, dimension: '2d',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT }), 'texture', size);
      entry.companion = { kind: 'depth-sample', object, descriptor: { width, height, mipLevelCount: 1 }, initialized: true, depth: entry, version: -1 };
    }
    return entry.companion;
  };
  // Encodes the conversions a pass needs ahead of it on the same encoder.
  const convertSampledDepth = (encoder, draws, attached) => {
    for (const draw of draws) for (const t of draw.textures ?? []) {
      const entry = resources.get(t.texture);
      if (entry?.kind !== 'depth-target') continue;
      if (entry === attached) fail('depth target sampled while attached');
      const companion = depthCompanion(entry);
      if (companion.version === (entry.version ?? 0)) continue;
      if (!depthSampleState) {
        const module = device.createShaderModule({ code: DEPTH_SAMPLE_WGSL });
        const layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } }] });
        depthSampleState = { layout, pipeline: device.createRenderPipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
          vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'r32float' }] }, primitive: { topology: 'triangle-list' } }) };
      }
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: viewOf(companion.object), loadOp: 'clear', storeOp: 'store', clearValue: [1, 0, 0, 1] }] });
      pass.setPipeline(depthSampleState.pipeline);
      pass.setBindGroup(0, device.createBindGroup({ layout: depthSampleState.layout, entries: [{ binding: 0, resource: companion.depthView ??= entry.object.createView({ aspect: 'depth-only' }) }] }));
      pass.draw(3); pass.end();
      companion.version = entry.version ?? 0;
    }
  };
  let sampledTargetCapabilities = null;
  // Created once per pipeline, on its first flipped-viewport draw.
  const flippedPipeline = async entry => {
    if (entry.flipped) return;
    const { descriptor } = entry, code = unflippedVertexWgsl(descriptor.vertex.wgsl);
    entry.flipped = await checked(async () => {
      const vertex = device.createShaderModule({ code }), fragment = device.createShaderModule({ code: descriptor.fragment.wgsl });
      return wait(device.createRenderPipelineAsync(webgpuPipeline(descriptor, vertex, fragment, entry.layout)));
    });
    counters.flippedPipelines++;
  };
  // Buffers and textures are created from descriptors JavaScript already validated
  // against the device limits and byte budget, so, as for uploads, their scope
  // results settle in the background (no GPU process round trip per creation, which
  // cost Firefox WebGL a compositor-paced wait for every new frame target); a
  // native error found later is terminal for the renderer.
  const makeNative = async (kind, size, action) => {
    available();
    let object;
    const made = scoped(() => { object = track(action(), kind, size); });
    if (made.caught) {
      const settled = await settle([made.pops]);
      releaseNative(object); classify(settled.lists[0], made.caught ?? settled.caught); throw made.caught;
    }
    defer(made.pops);
    if (deferred.size >= MAX_DEFERRED) { const settled = await settle([]); classify([], settled.caught); }
    return object;
  };
  const limits = device.limits ?? {};
  const checkDevicePipelineLimits = descriptor => {
    if (descriptor.vertexBuffers.length > (limits.maxVertexBuffers ?? 8) ||
        descriptor.vertexBuffers.flatMap(b => b.attributes).length > (limits.maxVertexAttributes ?? 16) ||
        descriptor.vertexBuffers.some(b => b.stride > (limits.maxVertexBufferArrayStride ?? 2048))) fail('pipeline exceeds device limits');
  };
  const validateDraw = (input, target, depthTarget = null) => {
    record(input, ['pipeline', 'vertexBuffers', 'vertexCount', 'firstVertex', 'instanceCount', 'firstInstance', 'viewport', 'scissor', 'flipY',
      ...(allowUniforms ? ['uniforms'] : []), ...(allowTextures ? ['textures'] : []), ...(input.index !== undefined ? ['index'] : [])], 'draw');
    const flipY = choice(input.flipY ?? false, [false, true], 'viewport flip');
    const pipeline = get(input.pipeline, 'pipeline'), descriptor = pipeline.descriptor;
    const textures = validateDrawTextures(input.textures, descriptor, allowTextures,
      handle => { const entry = sampled(handle); return { initialized: entry.kind === 'target' || entry.initialized, mipLevelCount: entry.descriptor.mipLevelCount }; },
      handle => get(handle, 'sampler'), textureSwizzle);
    if (descriptor.colorFormat !== target.descriptor.format) fail('pipeline/target format mismatch');
    if (allowDepth && (descriptor.depth?.format ?? null) !== (depthTarget?.descriptor.format ?? null)) fail('pipeline/pass depth format mismatch');
    const lines = descriptor.topology === 'line-list';
    // Indexed lists: vertexCount is the vertex window the indices (plus
    // baseVertex) address; complete primitives are checked on the index count.
    const index = input.index === undefined ? null : (() => {
      record(input.index, ['buffer', 'offset', 'size', 'format', 'count', 'baseVertex'], 'index binding');
      const entry = get(input.index.buffer, 'vertex-buffer');
      const format = choice(input.index.format, ['uint16', 'uint32'], 'index format'), bytes = format === 'uint16' ? 2 : 4;
      const offset = integer(input.index.offset, 0, entry.descriptor.size, 'index offset');
      const count = integer(input.index.count, lines ? 2 : 3, GRAPHICS_LIMITS.maxVertexBufferBytes / 2, 'index count');
      const size = integer(input.index.size, count * bytes, entry.descriptor.size - offset, 'index size');
      if (offset % bytes || size % 4 || count % (lines ? 2 : 3)) fail('index draw requires aligned complete primitives');
      const baseVertex = integer(input.index.baseVertex, -0x80000000, 0x7fffffff, 'base vertex');
      return Object.freeze({ buffer: input.index.buffer, offset, size, format, count, baseVertex });
    })();
    const vertexCount = integer(input.vertexCount, index ? 1 : lines ? 2 : 3, GRAPHICS_LIMITS.maxVertices, 'vertex count');
    if (!index && vertexCount % (lines ? 2 : 3)) fail('draw requires complete primitives');
    const uniforms = validateDrawUniforms(input.uniforms, descriptor, allowUniforms, handle => get(handle, 'uniform-buffer'));
    if (uniforms.some(u => u.size > (limits.maxUniformBufferBindingSize ?? 65536) ||
        u.offset % (limits.minUniformBufferOffsetAlignment ?? 256))) fail('uniform binding exceeds device limits');
    const firstVertex = integer(input.firstVertex ?? 0, 0, GRAPHICS_LIMITS.maxVertices, 'first vertex');
    choice(input.instanceCount ?? 1, [1], 'instance count'); choice(input.firstInstance ?? 0, [0], 'first instance');
    const bindings = array(input.vertexBuffers, descriptor.vertexBuffers.length, descriptor.vertexBuffers.length, 'draw vertex buffers').map((b, i) => {
      record(b, ['buffer', 'offset', 'size'], 'vertex binding');
      const entry = get(b.buffer, 'vertex-buffer');
      const offset = integer(b.offset ?? 0, 0, entry.descriptor.size, 'binding offset');
      const size = integer(b.size ?? entry.descriptor.size - offset, 1, entry.descriptor.size - offset, 'binding size');
      if (offset % 4 || size % 4) fail('vertex binding must be aligned to four bytes');
      const layout = descriptor.vertexBuffers[i];
      const extent = Math.max(...layout.attributes.map(a => a.offset + FORMAT_COMPONENTS[a.format] * 4));
      if ((firstVertex + vertexCount - 1) * layout.stride + extent > size) fail('vertex draw exceeds binding range');
      return { buffer: b.buffer, offset, size };
    });
    return Object.freeze({ pipeline: input.pipeline, vertexBuffers: Object.freeze(bindings.map(Object.freeze)), vertexCount, firstVertex,
      instanceCount: 1, firstInstance: 0, viewport: rectangle(input.viewport, target.descriptor, true),
      scissor: rectangle(input.scissor, target.descriptor, false), ...(flipY ? { flipY } : {}), ...(index ? { index } : {}), ...(allowUniforms ? { uniforms: Object.freeze(uniforms) } : {}),
      ...(allowTextures ? { textures: Object.freeze(textures) } : {}) });
  };

  return Object.freeze({
    limits: GRAPHICS_LIMITS,
    largeDepth: true,
    supportsSampledTargets: allowTextures,
    supportsLargeTextures: allowTextures,
    supportsBlend: true,
    supportsViewportFlip: true,
    supportsMipmaps: allowTextures,
    // Strips/fans arrive gathered into lists; WGSL flat inputs take the first vertex.
    pipelineStateProfile: 1,
    triangleProvokingVertex: 'first',
    // One-pixel line lists; strips arrive gathered into lists like triangles.
    supportsLineList: true,
    supportsTextureSwizzle: textureSwizzle,
    supportsIndexedDraw: true,
    supportsLargeVertexBuffers: true,
    supportsDepthSampling: depthSampling,
    wideTextureProfile: allowTextures,
    get sampledTargetCapabilities() { return sampledTargetCapabilities; },
    /** Actual render-to-sample probe: clear a 512x512 target in a render pass, sample its
     *  far corner into a 1x1 target and read the pixel back. Only a matching pixel
     *  enables the 512 sampled colour target profile; every probe object is destroyed. */
    probeSampledTargets() {
      if (!allowTextures) fail('texture profile not enabled');
      return enqueue(async () => {
        const made = [], expected = [51, 153, 255, 255];
        let pixel = null, error = null;
        device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory');
        try {
          const texture = (size, usage) => { const t = device.createTexture({ size: [size, size, 1], format: 'rgba8unorm', usage }); made.push(t); return t; };
          const source = texture(512, GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
          const output = texture(1, GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC);
          const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }); made.push(buffer);
          const module = device.createShaderModule({ code: `@group(0) @binding(0) var t: texture_2d<f32>; @group(0) @binding(1) var s: sampler;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0)); return vec4f(p[i], 0.0, 1.0); }
@fragment fn fs() -> @location(0) vec4f { return textureSampleLevel(t, s, vec2f(0.999, 0.999), 0.0); }` });
          const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
            fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] } });
          const encoder = device.createCommandEncoder();
          encoder.beginRenderPass({ colorAttachments: [{ view: source.createView(), loadOp: 'clear', storeOp: 'store',
            clearValue: expected.map(c => c / 255) }] }).end();
          const pass = encoder.beginRenderPass({ colorAttachments: [{ view: output.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: source.createView() }, { binding: 1, resource: device.createSampler() }] }));
          pass.draw(3); pass.end();
          encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow: 256 }, [1, 1, 1]);
          device.queue.submit([encoder.finish()]);
          await wait(buffer.mapAsync(GPUMapMode.READ));
          pixel = [...new Uint8Array(buffer.getMappedRange(), 0, 4)]; buffer.unmap();
        } catch (e) { error = String(e?.message ?? e); }
        finally {
          const scopes = await Promise.all([device.popErrorScope(), device.popErrorScope()]).catch(e => [e]);
          for (const e of scopes) if (e && !error) error = String(e.message ?? e);
          for (const object of made) object.destroy();
        }
        const actual = !error && pixel?.every((c, i) => Math.abs(c - expected[i]) <= 2);
        sampledTargetCapabilities = Object.freeze({ sampledColorTargetProfile: actual ? 1 : 0, maxSampledColorTargetDimension: 512,
          maxSampledColorTargetBytes: 1048576, maxSampledColorTargetBindings: 4,
          actualRenderToSamplePixels: actual === true, pixel, ...(error ? { error } : {}),
          closedProbe: Object.freeze({ resources: 0, state: 'closed' }) });
        event({ type: 'sampled-target-probe', ...sampledTargetCapabilities });
        return sampledTargetCapabilities;
      });
    },
    presentable: typeof OffscreenCanvas === 'function',
    /** Copy a stored target to the surface's canvas. With a page-owned (transferred)
     *  canvas the browser shows the frame itself and sink(null) is called; otherwise
     *  a private canvas's frame is handed to sink(ImageBitmap). */
    present(handle, surface, output, sink) {
      get(handle, 'target');
      return enqueue(async () => {
        const target = get(handle, 'target');
        if (!target.initialized) fail('present requires a successfully stored target');
        const { width, height, format } = target.descriptor;
        let entry = presentSurfaces.get(surface);
        if (!entry || entry.width !== width || entry.height !== height || entry.format !== format || (output && entry.canvas !== output)) {
          if (entry) forgetPresent(entry);
          const canvas = output ?? new OffscreenCanvas(width, height);
          if (canvas.width !== width) canvas.width = width;
          if (canvas.height !== height) canvas.height = height;
          const context = canvas.getContext('webgpu');
          if (!context) fail('present canvas has no webgpu context');
          context.configure({ device, format, usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT, alphaMode: 'opaque' });
          const frame = output ? device.createTexture({ size: [width, height, 1], format, usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC }) : null;
          entry = { canvas, context, width, height, format, frame, dirty: false }; presentSurfaces.set(surface, entry);
        }
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToTexture({ texture: target.object }, { texture: entry.frame ?? entry.context.getCurrentTexture() }, [width, height, 1]);
        device.queue.submit([encoder.finish()]);
        counters.presents = (counters.presents ?? 0) + 1;
        if (!output) { sink(entry.canvas.transferToImageBitmap()); return; }
        entry.dirty = true; sink(null);
        if (!presentScheduled) { presentScheduled = true; nextDisplayFrame(showPresented); }
      });
    },
    forgetSurface(surface) {
      const entry = presentSurfaces.get(surface); if (!entry) return;
      presentSurfaces.delete(surface); forgetPresent(entry);
    },
    /** Declared pipeline uniforms: [{group,binding,stages,minSize}] in binding order. */
    pipelineUniforms(handle) { return get(handle, 'pipeline').descriptor.uniforms; },
    getStats() { return Object.freeze({ state, resources: resources.size, nativeObjects: native.size, allocatedBytes: bytes,
      recordingDraws: recording?.draws.length ?? 0, ...counters }); },
    createPipeline(input) {
      // Take the entire value snapshot synchronously, before queueing/awaiting.
      const descriptor = validatePipelineDescriptor(input, validateTranslatedShader, uniformOptions); checkDevicePipelineLimits(descriptor);
      return enqueue(async () => {
        budget(0); let groupLayouts = [], layout;
        const object = await checked(async () => {
          const vertex = device.createShaderModule({ code: descriptor.vertex.wgsl });
          const fragment = device.createShaderModule({ code: descriptor.fragment.wgsl });
          const info = await wait(Promise.all([vertex.getCompilationInfo(), fragment.getCompilationInfo()]));
          if (info.some(i => i.messages.some(m => m.type === 'error'))) fail('translated WGSL compilation failed');
          // Vulkan set N maps to WebGPU group N; bindings keep their numbers.
          // Combined image sampler (set, b) becomes texture @binding(b) plus sampler @binding(b+16).
          const textures = descriptor.textures ?? [], used = [...descriptor.uniforms, ...textures];
          const groups = used.length ? Math.max(...used.map(u => u.group)) + 1 : 0;
          const visibility = u => (u.stages & 1 ? GPUShaderStage.VERTEX : 0) | (u.stages & 2 ? GPUShaderStage.FRAGMENT : 0);
          groupLayouts = Array.from({ length: groups }, (_, group) => device.createBindGroupLayout({ entries: [
            ...descriptor.uniforms.filter(u => u.group === group).map(u => ({ binding: u.binding, visibility: visibility(u),
              buffer: { type: 'uniform', hasDynamicOffset: false, minBindingSize: u.minSize } })),
            ...textures.filter(t => t.group === group).flatMap(t => [
              { binding: t.binding, visibility: visibility(t), texture: { sampleType: 'float', viewDimension: '2d', multisampled: false } },
              { binding: t.binding + TEXTURE_LIMITS.samplerBindingOffset, visibility: visibility(t), sampler: { type: 'filtering' } }])] }));
          layout = device.createPipelineLayout({ bindGroupLayouts: groupLayouts });
          return wait(device.createRenderPipelineAsync(webgpuPipeline(descriptor, vertex, fragment, layout)));
        });
        return add('pipeline', object, descriptor, { groupLayouts: Object.freeze(groupLayouts), layout, flipped: null });
      });
    },
    createUniformBuffer(input) {
      if (!allowUniforms) fail('uniform profile not enabled');
      const { size } = validateUniformBufferDescriptor(input);
      if (size > (limits.maxBufferSize ?? Infinity)) fail('uniform buffer exceeds device limits');
      return enqueue(async () => {
        budget(size);
        const object = await makeNative('buffer', size, () => device.createBuffer({ size,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
        return add('uniform-buffer', object, Object.freeze({ size }));
      });
    },
    uploadUniformBuffer(handle, offset, data) {
      if (!allowUniforms) fail('uniform profile not enabled');
      get(handle, 'uniform-buffer'); integer(offset, 0, UNIFORM_LIMITS.maxBufferBytes, 'upload offset');
      if (!(data instanceof Uint8Array) || !data.byteLength || data.byteLength > UNIFORM_LIMITS.maxBufferBytes ||
          offset % 4 || data.byteLength % 4) fail('upload requires aligned, bounded Uint8Array data');
      const copy = data.slice();
      return enqueue(async () => {
        const entry = get(handle, 'uniform-buffer');
        if (offset > entry.descriptor.size || copy.byteLength > entry.descriptor.size - offset) fail('upload exceeds uniform buffer');
        await deferredWrite(() => device.queue.writeBuffer(entry.object, offset, copy)); counters.uniformUploads++;
      });
    },
    createTexture(input) {
      if (!allowTextures) fail('texture profile not enabled');
      const descriptor = validateTextureDescriptor(input), size = chainBytes(descriptor);
      return enqueue(async () => {
        budget(size);
        // Render-attachment usage lets blit() fill mip levels and copy into textures.
        const object = await makeNative('texture', size, () => device.createTexture({
          size: [descriptor.width, descriptor.height, 1], format: descriptor.format, sampleCount: 1, mipLevelCount: descriptor.mipLevelCount,
          dimension: '2d', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT }));
        return add('sampled-texture', object, descriptor);
      });
    },
    uploadTexture(handle, data) {
      if (!allowTextures) fail('texture profile not enabled');
      const copy = validateTextureUpload(sampled(handle), data);
      return enqueue(async () => {
        const entry = sampled(handle), { width, height } = entry.descriptor;
        if (copy.byteLength !== width * height * 4) fail('texture upload size changed');
        entry.initialized = false;
        await deferredWrite(() => device.queue.writeTexture({ texture: entry.object }, copy, { offset: 0, bytesPerRow: width * 4, rowsPerImage: height }, [width, height, 1]));
        entry.initialized = true; counters.textureUploads++;
      });
    },
    /** Large texture profile: rewrite rows [y, y+rows) of one level of a sampled texture. */
    uploadTextureRows(handle, y, rows, data, level = 0) {
      if (!allowTextures) fail('texture profile not enabled');
      const descriptor = sampled(handle).descriptor;
      integer(level, 0, descriptor.mipLevelCount - 1, 'texture upload level');
      const width = Math.max(1, descriptor.width >> level), height = Math.max(1, descriptor.height >> level);
      integer(y, 0, height - 1, 'texture upload row'); integer(rows, 1, height - y, 'texture upload rows');
      if (!(data instanceof Uint8Array) || data.byteLength !== width * rows * 4) fail('texture row upload requires width*rows*4 RGBA8 bytes');
      const copy = data.slice();
      return enqueue(async () => {
        const entry = sampled(handle);
        await deferredWrite(() => device.queue.writeTexture({ texture: entry.object, mipLevel: level, origin: [0, y, 0] }, copy, { offset: 0, bytesPerRow: width * 4, rowsPerImage: rows }, [width, rows, 1]));
        entry.initialized = true; counters.textureUploads++;
      });
    },
    createSampler(input) {
      if (!allowTextures) fail('texture profile not enabled');
      const descriptor = validateSamplerDescriptor(input);
      return enqueue(async () => {
        budget(0);
        // GPUSampler has no destroy(); it is not a byte-accounted native object.
        // Without an explicit mipmap filter the default only matters as WebGPU's
        // all-linear precondition for anisotropy.
        const object = await checked(() => device.createSampler({ maxAnisotropy: 1, lodMinClamp: 0, lodMaxClamp: 32,
          mipmapFilter: descriptor.maxAnisotropy ? 'linear' : 'nearest', ...descriptor, addressModeW: 'clamp-to-edge' }));
        counters.samplersCreated++;
        const handle = add('sampler', object, descriptor); resources.get(handle).initialized = true; return handle;
      });
    },
    createVertexBuffer(input) {
      record(input, ['size'], 'vertex buffer');
      const size = integer(input.size, 4, GRAPHICS_LIMITS.maxVertexBufferBytes, 'vertex buffer size');
      if (size % 4 || size > (limits.maxBufferSize ?? Infinity)) fail('invalid vertex buffer size/alignment');
      return enqueue(async () => {
        budget(size);
        const object = await makeNative('buffer', size, () => device.createBuffer({ size,
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }));
        return add('vertex-buffer', object, Object.freeze({ size }));
      });
    },
    uploadVertexBuffer(handle, offset, data) {
      get(handle, 'vertex-buffer'); integer(offset, 0, GRAPHICS_LIMITS.maxVertexBufferBytes, 'upload offset');
      if (!(data instanceof Uint8Array) || !data.byteLength || data.byteLength > GRAPHICS_LIMITS.maxVertexBufferBytes ||
          offset % 4 || data.byteLength % 4) fail('upload requires aligned, bounded Uint8Array data');
      const copy = data.slice();
      return enqueue(async () => {
        const entry = get(handle, 'vertex-buffer');
        if (offset > entry.descriptor.size || copy.byteLength > entry.descriptor.size - offset) fail('upload exceeds vertex buffer');
        await deferredWrite(() => device.queue.writeBuffer(entry.object, offset, copy)); counters.uploads++;
      });
    },
    createTarget(input) {
      const descriptor = validateTargetDescriptor(input), size = chainBytes(descriptor);
      if (Math.max(descriptor.width, descriptor.height) > (limits.maxTextureDimension2D ?? 8192)) fail('target exceeds device limits');
      if (descriptor.mipLevelCount > 1 && !allowTextures) fail('mipmapped targets require the texture profile');
      return enqueue(async () => {
        budget(size);
        const object = await makeNative('texture', size, () => device.createTexture({
          size: [descriptor.width, descriptor.height, 1], format: descriptor.format, sampleCount: 1, mipLevelCount: descriptor.mipLevelCount,
          dimension: '2d', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC |
            (allowTextures ? GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST : 0) }));
        return add('target', object, descriptor);
      });
    },
    createDepthTarget(input) {
      if (!allowDepth) fail('depth profile not enabled');
      record(input, ['width', 'height', 'format'], 'depth target');
      // Depth attachments follow the colour target limit (large depth profile).
      const width = integer(input.width, 1, GRAPHICS_LIMITS.maxTargetSize, 'depth width');
      const height = integer(input.height, 1, GRAPHICS_LIMITS.maxTargetSize, 'depth height');
      const format = choice(input.format, DEPTH_FORMATS, 'depth format');
      const descriptor = Object.freeze({ width, height, format }), size = width * height * (format === 'depth16unorm' ? 2 : 4);
      return enqueue(async () => {
        budget(size);
        const object = await makeNative('texture', size, () => device.createTexture({
          size: [width, height, 1], format, sampleCount: 1, mipLevelCount: 1,
          dimension: '2d', usage: GPUTextureUsage.RENDER_ATTACHMENT | (depthSampling ? GPUTextureUsage.TEXTURE_BINDING : 0) }));
        return add('depth-target', object, descriptor);
      });
    },
    begin(input) {
      available(); if (recording) fail('a render pass is already being recorded');
      record(input, ['target', 'loadOp', 'storeOp', 'clearColor', ...(allowDepth ? ['depth'] : [])], 'render pass');
      const colorTarget = get(input.target, 'target');
      let depth = null;
      if (allowDepth && input.depth !== undefined && input.depth !== null) {
        depth = Object.freeze(validateDepthAttachment(input.depth));
        const entry = get(depth.target, 'depth-target');
        if (entry.descriptor.width !== colorTarget.descriptor.width || entry.descriptor.height !== colorTarget.descriptor.height)
          fail('depth attachment extent must match the color target');
      }
      const loadOp = choice(input.loadOp, ['clear', 'load'], 'attachment load operation');
      const storeOp = choice(input.storeOp, ['store'], 'attachment store operation');
      let clearColor;
      if (loadOp === 'clear') clearColor = Object.freeze(array(input.clearColor, 4, 4, 'clear color')
        .map(c => finite(c, 0, 1, 'clear color component')));
      else if (own(input, 'clearColor')) fail('clear color is only accepted with clear load operation');
      recording = { target: input.target, loadOp, storeOp, clearColor, depth, draws: [] };
    },
    draw(input) {
      available(); if (!recording) fail('draw requires a recording render pass');
      if (recording.draws.length >= GRAPHICS_LIMITS.maxDraws) fail('render pass draw budget exceeded', 'budget');
      recording.draws.push(validateDraw(input, get(recording.target, 'target'),
        recording.depth ? get(recording.depth.target, 'depth-target') : null));
    },
    abort() { available(); recording = null; },
    end() {
      available(); if (!recording) fail('end requires a recording render pass');
      const pass = recording; recording = null;
      return enqueue(async () => {
        const target = get(pass.target, 'target');
        if (pass.loadOp === 'load' && !target.initialized) fail('load requires a successfully stored target');
        const depthTarget = pass.depth ? get(pass.depth.target, 'depth-target') : null;
        if (pass.depth?.loadOp === 'load' && !depthTarget.initialized) fail('depth load requires a successfully stored depth target');
        // Recheck all live references and ranges before any native encoder or submit.
        const draws = pass.draws.map(d => validateDraw(d, target, depthTarget));
        for (const draw of draws) if (draw.flipY) await flippedPipeline(get(draw.pipeline, 'pipeline'));
        available();
        const encode = scoped(() => {
          const encoder = device.createCommandEncoder();
          if (depthSampling) convertSampledDepth(encoder, draws, depthTarget);
          const attachment = { view: attachmentView(target.object), loadOp: pass.loadOp, storeOp: pass.storeOp };
          if (pass.clearColor) attachment.clearValue = pass.clearColor;
          const render = encoder.beginRenderPass({ colorAttachments: [attachment], ...(depthTarget ? { depthStencilAttachment: {
            view: viewOf(depthTarget.object), depthLoadOp: pass.depth.loadOp, depthStoreOp: pass.depth.storeOp,
            ...(pass.depth.loadOp === 'clear' ? { depthClearValue: pass.depth.clearValue } : {}) } } : {}) });
          for (const draw of draws) {
            const pipeline = get(draw.pipeline, 'pipeline'); render.setPipeline(draw.flipY ? pipeline.flipped : pipeline.object);
            pipeline.groupLayouts.forEach((layout, group) => render.setBindGroup(group, bindGroup(layout, group, draw)));
            draw.vertexBuffers.forEach((b, slot) => render.setVertexBuffer(slot, get(b.buffer, 'vertex-buffer').object, b.offset, b.size));
            const v = draw.viewport, s = draw.scissor;
            render.setViewport(v.x, v.y, v.width, v.height, v.minDepth, v.maxDepth);
            render.setScissorRect(s.x, s.y, s.width, s.height);
            if (draw.index) {
              render.setIndexBuffer(get(draw.index.buffer, 'vertex-buffer').object, draw.index.format, draw.index.offset, draw.index.size);
              render.drawIndexed(draw.index.count, 1, 0, draw.index.baseVertex, 0);
            } else render.draw(draw.vertexCount, 1, draw.firstVertex, 0);
          }
          render.end(); return encoder.finish();
        });
        if (encode.caught) { const settled = await settle([encode.pops]); classify(settled.lists[0], encode.caught ?? settled.caught); }
        // Submit without waiting for the encode scopes. If encoding failed, the command
        // buffer is invalid and the submit is a no-op (validation error, no effects), so
        // restoring the attachment state below matches the serial version exactly.
        const previous = [target.initialized, depthTarget?.initialized];
        target.initialized = false; if (depthTarget) { depthTarget.initialized = false; depthTarget.version = (depthTarget.version ?? 0) + 1; }
        // Later queue operations (passes, presents, readback maps) are ordered after this
        // submit by the WebGPU queue, so completion is not awaited here; at most
        // PASSES_IN_FLIGHT earlier passes may still be executing on the GPU.
        const submit = scoped(() => { device.queue.submit([encode.result]); return device.queue.onSubmittedWorkDone(); });
        const waited = !submit.caught && inflight.length >= PASSES_IN_FLIGHT;
        if (!submit.caught) {
          // Acknowledge without a GPU process round trip: Chromium runs WebGPU on the
          // thread that also blocks in compositor swaps, so a per-pass wait paces the
          // guest at the display swap. The scope results join the deferred set, where an
          // error is terminal as for acknowledged uploads; only the oldest of
          // PASSES_IN_FLIGHT submits is awaited.
          submit.result.catch(() => {}); inflight.push(submit.result);
          defer(Promise.all([encode.pops, submit.pops]).then(lists => lists.flat()));
          target.initialized = true; if (depthTarget) depthTarget.initialized = pass.depth.storeOp === 'store';
          if (waited) { try { await wait(inflight.shift()); } catch (error) { classify([], error); } }
          if (deferred.size >= MAX_DEFERRED) { const drained = await settle([]); classify([], drained.caught); }
          counters.passes++; counters.draws += draws.length;
          event({ type: 'pass', draws: draws.length });
          return;
        }
        const settled = await settle([encode.pops, submit.pops]);
        if (settled.lists[0].some(e => e.error)) {
          target.initialized = previous[0]; if (depthTarget) depthTarget.initialized = previous[1];
          classify(settled.lists[0]);
        }
        classify(settled.lists[1], submit.caught ?? settled.caught);
        target.initialized = true; if (depthTarget) depthTarget.initialized = pass.depth.storeOp === 'store';
        counters.passes++; counters.draws += draws.length;
        event({ type: 'pass', draws: draws.length });
      });
    },
    readback(handle) {
      get(handle, 'target');
      return enqueue(async () => {
        const target = get(handle, 'target');
        if (!target.initialized) fail('readback requires a successfully stored target');
        const { width, height } = target.descriptor, row = Math.ceil(width * 4 / 256) * 256, size = row * height;
        // Staging does not consume a public resource handle, but does consume bytes.
        if (size > GRAPHICS_LIMITS.maxBytes - bytes || size > (limits.maxBufferSize ?? Infinity)) fail('readback budget exceeded', 'budget');
        // One cached staging buffer of the exact size is reused across readbacks. While
        // in use it is a tracked native object (same byte budget as a fresh buffer);
        // while idle it is held outside the budget, bounded by STAGING_CACHE_BYTES.
        let buffer = null, keep = false;
        try {
          if (staging?.size === size) { buffer = staging.object; staging = null; native.set(buffer, { kind: 'buffer', bytes: size }); bytes += size; }
          else {
            dropStaging();
            buffer = await makeNative('buffer', size, () => device.createBuffer({ size,
              usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
          }
          const encode = scoped(() => {
            const encoder = device.createCommandEncoder();
            encoder.copyTextureToBuffer({ texture: target.object }, { buffer, bytesPerRow: row, rowsPerImage: height }, [width, height, 1]);
            return encoder.finish();
          });
          if (encode.caught) { const settled = await settle([encode.pops]); classify(settled.lists[0], encode.caught ?? settled.caught); }
          const submit = scoped(() => { device.queue.submit([encode.result]); return buffer.mapAsync(GPUMapMode.READ); });
          const settled = await settle([encode.pops, submit.pops], submit.caught ? [] : [submit.result]);
          classify(settled.lists[0]);
          classify(settled.lists[1], submit.caught ?? settled.caught);
          const mapped = new Uint8Array(buffer.getMappedRange()), pixels = new Uint8Array(width * height * 4);
          for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * row, y * row + width * 4), y * width * 4);
          buffer.unmap(); counters.readbacks++; keep = size <= STAGING_CACHE_BYTES;
          return { width, height, format: 'rgba8unorm', rowOrder: 'top-to-bottom', pixels };
        } finally {
          if (keep && state === 'open' && native.has(buffer)) { native.delete(buffer); bytes -= size; staging = { object: buffer, size }; }
          else releaseNative(buffer);
        }
      });
    },
    /** Mipmap profile (vkCmdBlitImage): render one source level into a rectangle of one
     *  destination level. Rectangles are [x0, y0, x1, y1] texel corners and may mirror. */
    blit(input) {
      if (!allowTextures) fail('texture profile not enabled');
      available(); if (recording) fail('blit inside a render pass');
      record(input, ['src', 'srcLevel', 'srcRect', 'dst', 'dstLevel', 'dstRect', 'filter'], 'blit');
      const filter = choice(input.filter ?? 'nearest', ['nearest', 'linear'], 'blit filter');
      const side = (handle, level, rect, name) => {
        const d = sampled(handle).descriptor;
        integer(level, 0, d.mipLevelCount - 1, `${name} level`);
        const w = Math.max(1, d.width >> level), h = Math.max(1, d.height >> level), r = array(rect, 4, 4, `${name} rectangle`);
        return { w, h, format: d.format, r: r.map((c, i) => integer(c, 0, i % 2 ? h : w, `${name} rectangle`)) };
      };
      const src = side(input.src, input.srcLevel, input.srcRect, 'blit source'), dst = side(input.dst, input.dstLevel, input.dstRect, 'blit destination');
      if (input.src === input.dst && input.srcLevel === input.dstLevel) fail('blit within one level is unsupported');
      // A mirrored destination becomes a mirrored source.
      let [sx0, sy0, sx1, sy1] = src.r, [dx0, dy0, dx1, dy1] = dst.r;
      if (dx0 > dx1) { [dx0, dx1] = [dx1, dx0]; [sx0, sx1] = [sx1, sx0]; }
      if (dy0 > dy1) { [dy0, dy1] = [dy1, dy0]; [sy0, sy1] = [sy1, sy0]; }
      if (dx0 === dx1 || dy0 === dy1) fail('empty blit destination');
      const uv = new Float32Array([sx0 / src.w, sy0 / src.h, sx1 / src.w, sy1 / src.h]);
      return enqueue(async () => {
        const source = sampled(input.src), target = sampled(input.dst);
        if (source.kind !== 'target' && !source.initialized) fail('blit source has no contents');
        const pipeline = await blitPipeline(dst.format);
        available();
        // writeBuffer is ordered before this submit on the queue, so one buffer serves every blit.
        const encode = scoped(() => {
          device.queue.writeBuffer(blitState.uniform, 0, uv);
          const group = device.createBindGroup({ layout: blitState.layout, entries: [
            { binding: 0, resource: levelView(source.object, input.srcLevel, 1) },
            { binding: 1, resource: filter === 'linear' ? blitState.linear : blitState.nearest },
            { binding: 2, resource: { buffer: blitState.uniform } }] });
          const encoder = device.createCommandEncoder();
          const render = encoder.beginRenderPass({ colorAttachments: [{ view: levelView(target.object, input.dstLevel, 1), loadOp: 'load', storeOp: 'store' }] });
          render.setPipeline(pipeline); render.setBindGroup(0, group);
          render.setViewport(dx0, dy0, dx1 - dx0, dy1 - dy0, 0, 1); render.draw(4); render.end();
          device.queue.submit([encoder.finish()]);
        });
        if (encode.caught) { const settled = await settle([encode.pops]); classify(settled.lists[0], encode.caught ?? settled.caught); }
        defer(encode.pops);
        target.initialized = true; counters.blits++;
      });
    },
    destroy(handle) {
      return enqueue(() => {
        const entry = resources.get(handle); if (!entry) fail('stale or foreign resource handle');
        resources.delete(handle); releaseNative(entry.object);
        if (entry.companion) releaseNative(entry.companion.object);
      });
    },
    close() { dispose('closed', 'renderer closed'); }
  });
}
