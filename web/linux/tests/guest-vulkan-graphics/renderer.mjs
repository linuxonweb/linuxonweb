// Experimental bounded graphics backend. No wire protocol or device ownership.
export const GRAPHICS_LIMITS = Object.freeze({ maxResources: 64, maxBytes: 16 * 1024 * 1024,
  maxTargetSize: 512, maxVertexBufferBytes: 65536, maxVertexBuffers: 8,
  maxAttributes: 8, maxStride: 2048, maxDraws: 256, maxVertices: 65536, maxShaderBytes: 262144 });

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
const UNIFORM_MEMBER_BYTES = Object.freeze({ vec4: 16, mat4x4: 64 });
// Opt-in A4 sampled-texture profile (combined image samplers); requires the uniform profile.
export const TEXTURE_LIMITS = Object.freeze({ maxTextures: 4, maxDimension: 128, maxSamplers: 8, samplerBindingOffset: 16 });
const profileOptions = options => {
  if (options === undefined) return { allowUniforms: false, allowTextures: false };
  record(options, ['allowUniforms', 'allowTextures'], 'shader options');
  const allowUniforms = choice(options.allowUniforms ?? false, [false, true], 'uniform option');
  const allowTextures = choice(options.allowTextures ?? false, [false, true], 'texture option');
  if (allowTextures && !allowUniforms) fail('texture profile requires the uniform profile');
  return { allowUniforms, allowTextures };
};
const uniformsAllowed = options => profileOptions(options).allowUniforms;
const shaderOptions = ({ allowUniforms, allowTextures }) =>
  allowTextures ? [{ allowUniforms, allowTextures }] : allowUniforms ? [{ allowUniforms }] : [];
export { profileOptions };

/** Copy translator uniform reflection: sorted unique set/binding, tightly packed vec4/mat4 blocks. */
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
      if (member.offset !== offset) fail('uniform members must be tightly packed');
      offset += UNIFORM_MEMBER_BYTES[type] * Math.max(1, arrayLength);
      return { offset: member.offset, type, arrayLength };
    });
    if (offset !== size || size % 16) fail('uniform block size mismatch');
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
      const components = choice(item.type.components, [2, 3, 4], 'interface vector size');
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
  const profile = profileOptions(options), { allowUniforms, allowTextures } = profile;
  record(input, ['vertex', 'fragment', 'vertexBuffers', 'colorFormat', 'topology', 'frontFace', 'cullMode', 'sampleCount',
    ...(allowUniforms ? ['uniforms'] : []), ...(allowTextures ? ['textures'] : [])], 'pipeline');
  const vertex = validateShader(input.vertex, 'vertex', ...shaderOptions(profile));
  const fragment = validateShader(input.fragment, 'fragment', ...shaderOptions(profile));
  const colorFormat = choice(input.colorFormat ?? 'rgba8unorm', ['rgba8unorm'], 'color format');
  const topology = choice(input.topology ?? 'triangle-list', ['triangle-list'], 'primitive topology');
  const frontFace = choice(input.frontFace ?? 'ccw', ['ccw'], 'front face');
  const cullMode = choice(input.cullMode ?? 'none', ['none'], 'cull mode');
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
  if (supplied.size > GRAPHICS_LIMITS.maxAttributes || supplied.size !== attributes.length ||
      attributes.some(i => supplied.get(i.location) !== i.type.components)) fail('vertex attributes do not match shader inputs');
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
        output.interpolation.sampling !== input.interpolation.sampling) fail('vertex/fragment interface mismatch');
  }
  return freeze({ vertex, fragment, vertexBuffers, colorFormat, topology, frontFace, cullMode, sampleCount, uniforms,
    ...(allowTextures ? { textures } : {}) });
}

/** Draw-time combined image samplers, in pipeline-layout order; textures must hold uploaded contents. */
export function validateDrawTextures(input, descriptor, allowTextures, lookupTexture, lookupSampler) {
  if (!allowTextures) return [];
  const declared = descriptor.textures ?? [];
  return array(input ?? [], declared.length, declared.length, 'draw textures').map((t, i) => {
    record(t, ['group', 'binding', 'texture', 'sampler'], 'texture binding');
    if (t.group !== declared[i].group || t.binding !== declared[i].binding) fail('draw textures do not match the pipeline layout');
    if (!lookupTexture(t.texture).initialized) fail('sampled texture has no uploaded contents');
    lookupSampler(t.sampler);
    // Same field set as the input: recorded draws are revalidated at end().
    return Object.freeze({ group: declared[i].group, binding: declared[i].binding, texture: t.texture, sampler: t.sampler });
  });
}
export function validateTextureDescriptor(input) {
  record(input, ['width', 'height', 'format'], 'texture');
  return Object.freeze({ width: integer(input.width, 1, TEXTURE_LIMITS.maxDimension, 'texture width'),
    height: integer(input.height, 1, TEXTURE_LIMITS.maxDimension, 'texture height'),
    format: choice(input.format ?? 'rgba8unorm', ['rgba8unorm'], 'texture format') });
}
export function validateSamplerDescriptor(input) {
  record(input, ['magFilter', 'minFilter', 'addressModeU', 'addressModeV'], 'sampler');
  const filters = ['nearest', 'linear'], modes = ['repeat', 'clamp-to-edge', 'mirror-repeat'];
  return Object.freeze({ magFilter: choice(input.magFilter, filters, 'sampler mag filter'),
    minFilter: choice(input.minFilter, filters, 'sampler min filter'),
    addressModeU: choice(input.addressModeU, modes, 'sampler address mode U'),
    addressModeV: choice(input.addressModeV, modes, 'sampler address mode V') });
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
  record(input, ['width', 'height', 'format'], 'target');
  return freeze({ width: integer(input.width, 1, GRAPHICS_LIMITS.maxTargetSize, 'target width'),
    height: integer(input.height, 1, GRAPHICS_LIMITS.maxTargetSize, 'target height'),
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

// WebGPU conversion is isolated from the declarative profile above. Translation
// owns clip-coordinate adjustment; there is no additional Y or depth transform.
function webgpuPipeline(descriptor, vertex, fragment, layout) {
  return { layout, vertex: { module: vertex, entryPoint: descriptor.vertex.entryPoint,
    buffers: descriptor.vertexBuffers.map(b => ({ arrayStride: b.stride, stepMode: b.stepMode,
      attributes: b.attributes.map(a => ({ shaderLocation: a.location, offset: a.offset, format: a.format })) })) },
  fragment: { module: fragment, entryPoint: descriptor.fragment.entryPoint,
    targets: [{ format: descriptor.colorFormat, writeMask: 0xf }] },
  primitive: { topology: descriptor.topology, frontFace: descriptor.frontFace, cullMode: descriptor.cullMode,
    unclippedDepth: false }, multisample: { count: descriptor.sampleCount, mask: 0xffffffff, alphaToCoverageEnabled: false } };
}

/**
 * Uses an existing GPUDevice. Handles are opaque objects scoped to this renderer;
 * the host adapter owns wire IDs and the device. Async methods serialize GPU error
 * scopes. The caller must not interleave its own error scopes on this same device.
 */
export function createGraphicsRenderer(device, { onEvent = () => {}, allowUniforms = false, allowTextures = false } = {}) {
  if (!device?.queue || !device?.lost?.then) fail('existing WebGPU device required', 'unavailable');
  if (typeof onEvent !== 'function') fail('onEvent must be a function');
  choice(allowUniforms, [false, true], 'uniform option'); choice(allowTextures, [false, true], 'texture option');
  if (allowTextures && !allowUniforms) fail('texture profile requires the uniform profile');
  const uniformOptions = allowTextures ? { allowUniforms, allowTextures } : allowUniforms ? { allowUniforms } : undefined;
  const resources = new Map(), native = new Map(), cancelWaits = new Set();
  let state = 'open', cause = '', bytes = 0, recording = null, tail = Promise.resolve();
  const counters = { buffersCreated: 0, buffersDestroyed: 0, texturesCreated: 0, texturesDestroyed: 0,
    passes: 0, draws: 0, readbacks: 0, uploads: 0, uniformUploads: 0, ...(allowTextures ? { textureUploads: 0, samplersCreated: 0 } : {}) };
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
  const dispose = (nextState, reason) => {
    if (state !== 'open') return;
    state = nextState; cause = reason; recording = null; resources.clear();
    for (const cancel of cancelWaits) cancel(); cancelWaits.clear();
    for (const object of native.keys()) releaseNative(object);
    event({ type: nextState, message: reason });
  };
  device.lost.then(info => dispose('lost', `device lost: ${info?.message ?? 'unknown'}`),
    error => dispose('lost', `device loss notification failed: ${error?.message ?? error}`));
  const enqueue = action => {
    const result = tail.then(() => { available(); return action(); });
    tail = result.catch(() => {}); return result;
  };
  const checked = async action => {
    available();
    const filters = ['internal', 'out-of-memory', 'validation']; let count = 0, result, caught;
    try {
      for (const filter of filters) { device.pushErrorScope(filter); count++; }
      result = await wait(action());
    } catch (error) { caught = error; }
    const pending = [];
    while (count) { const filter = filters[--count];
      try { pending.push(Promise.resolve(device.popErrorScope()).then(error => ({ filter, error }))); }
      catch (error) { caught ??= error; }
    }
    let errors = [];
    try { errors = await wait(Promise.all(pending)); } catch (error) { caught ??= error; }
    available();
    const scoped = errors.find(e => e.error);
    if (scoped) fail(`WebGPU ${scoped.filter}: ${scoped.error.message}`,
      scoped.filter === 'out-of-memory' ? 'budget' : scoped.filter === 'validation' ? 'validation' : 'gpu');
    if (caught) { if (caught instanceof GraphicsRendererError) throw caught; fail(`WebGPU operation: ${caught.message ?? caught}`, 'gpu'); }
    return result;
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
  const makeNative = async (kind, size, action) => {
    let object;
    try { await checked(() => { object = track(action(), kind, size); }); return object; }
    catch (error) { releaseNative(object); throw error; }
  };
  const limits = device.limits ?? {};
  const checkDevicePipelineLimits = descriptor => {
    if (descriptor.vertexBuffers.length > (limits.maxVertexBuffers ?? 8) ||
        descriptor.vertexBuffers.flatMap(b => b.attributes).length > (limits.maxVertexAttributes ?? 16) ||
        descriptor.vertexBuffers.some(b => b.stride > (limits.maxVertexBufferArrayStride ?? 2048))) fail('pipeline exceeds device limits');
  };
  const validateDraw = (input, target) => {
    record(input, ['pipeline', 'vertexBuffers', 'vertexCount', 'firstVertex', 'instanceCount', 'firstInstance', 'viewport', 'scissor',
      ...(allowUniforms ? ['uniforms'] : []), ...(allowTextures ? ['textures'] : [])], 'draw');
    const pipeline = get(input.pipeline, 'pipeline'), descriptor = pipeline.descriptor;
    const textures = validateDrawTextures(input.textures, descriptor, allowTextures, handle => get(handle, 'sampled-texture'), handle => get(handle, 'sampler'));
    if (descriptor.colorFormat !== target.descriptor.format) fail('pipeline/target format mismatch');
    const vertexCount = integer(input.vertexCount, 3, GRAPHICS_LIMITS.maxVertices, 'vertex count');
    if (vertexCount % 3) fail('initial triangle profile requires complete triangles');
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
      scissor: rectangle(input.scissor, target.descriptor, false), ...(allowUniforms ? { uniforms: Object.freeze(uniforms) } : {}),
      ...(allowTextures ? { textures: Object.freeze(textures) } : {}) });
  };

  return Object.freeze({
    limits: GRAPHICS_LIMITS,
    /** Declared pipeline uniforms: [{group,binding,stages,minSize}] in binding order. */
    pipelineUniforms(handle) { return get(handle, 'pipeline').descriptor.uniforms; },
    getStats() { return Object.freeze({ state, resources: resources.size, nativeObjects: native.size, allocatedBytes: bytes,
      recordingDraws: recording?.draws.length ?? 0, ...counters }); },
    createPipeline(input) {
      // Take the entire value snapshot synchronously, before queueing/awaiting.
      const descriptor = validatePipelineDescriptor(input, validateTranslatedShader, uniformOptions); checkDevicePipelineLimits(descriptor);
      return enqueue(async () => {
        budget(0); let groupLayouts = [];
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
          const layout = device.createPipelineLayout({ bindGroupLayouts: groupLayouts });
          return wait(device.createRenderPipelineAsync(webgpuPipeline(descriptor, vertex, fragment, layout)));
        });
        return add('pipeline', object, descriptor, { groupLayouts: Object.freeze(groupLayouts) });
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
        await checked(() => device.queue.writeBuffer(entry.object, offset, copy)); counters.uniformUploads++;
      });
    },
    createTexture(input) {
      if (!allowTextures) fail('texture profile not enabled');
      const descriptor = validateTextureDescriptor(input), size = descriptor.width * descriptor.height * 4;
      return enqueue(async () => {
        budget(size);
        const object = await makeNative('texture', size, () => device.createTexture({
          size: [descriptor.width, descriptor.height, 1], format: descriptor.format, sampleCount: 1, mipLevelCount: 1,
          dimension: '2d', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST }));
        return add('sampled-texture', object, descriptor);
      });
    },
    uploadTexture(handle, data) {
      if (!allowTextures) fail('texture profile not enabled');
      const copy = validateTextureUpload(get(handle, 'sampled-texture'), data);
      return enqueue(async () => {
        const entry = get(handle, 'sampled-texture'), { width, height } = entry.descriptor;
        if (copy.byteLength !== width * height * 4) fail('texture upload size changed');
        entry.initialized = false;
        await checked(() => device.queue.writeTexture({ texture: entry.object }, copy, { offset: 0, bytesPerRow: width * 4, rowsPerImage: height }, [width, height, 1]));
        entry.initialized = true; counters.textureUploads++;
      });
    },
    createSampler(input) {
      if (!allowTextures) fail('texture profile not enabled');
      const descriptor = validateSamplerDescriptor(input);
      return enqueue(async () => {
        budget(0);
        // GPUSampler has no destroy(); it is not a byte-accounted native object.
        const object = await checked(() => device.createSampler({ ...descriptor, addressModeW: 'clamp-to-edge',
          mipmapFilter: 'nearest', lodMinClamp: 0, lodMaxClamp: 32, maxAnisotropy: 1 }));
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
          usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }));
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
        await checked(() => device.queue.writeBuffer(entry.object, offset, copy)); counters.uploads++;
      });
    },
    createTarget(input) {
      const descriptor = validateTargetDescriptor(input), size = descriptor.width * descriptor.height * 4;
      if (Math.max(descriptor.width, descriptor.height) > (limits.maxTextureDimension2D ?? 8192)) fail('target exceeds device limits');
      return enqueue(async () => {
        budget(size);
        const object = await makeNative('texture', size, () => device.createTexture({
          size: [descriptor.width, descriptor.height, 1], format: descriptor.format, sampleCount: 1, mipLevelCount: 1,
          dimension: '2d', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }));
        return add('target', object, descriptor);
      });
    },
    begin(input) {
      available(); if (recording) fail('a render pass is already being recorded');
      record(input, ['target', 'loadOp', 'storeOp', 'clearColor'], 'render pass'); get(input.target, 'target');
      const loadOp = choice(input.loadOp, ['clear', 'load'], 'attachment load operation');
      const storeOp = choice(input.storeOp, ['store'], 'attachment store operation');
      let clearColor;
      if (loadOp === 'clear') clearColor = Object.freeze(array(input.clearColor, 4, 4, 'clear color')
        .map(c => finite(c, 0, 1, 'clear color component')));
      else if (own(input, 'clearColor')) fail('clear color is only accepted with clear load operation');
      recording = { target: input.target, loadOp, storeOp, clearColor, draws: [] };
    },
    draw(input) {
      available(); if (!recording) fail('draw requires a recording render pass');
      if (recording.draws.length >= GRAPHICS_LIMITS.maxDraws) fail('render pass draw budget exceeded', 'budget');
      recording.draws.push(validateDraw(input, get(recording.target, 'target')));
    },
    abort() { available(); recording = null; },
    end() {
      available(); if (!recording) fail('end requires a recording render pass');
      const pass = recording; recording = null;
      return enqueue(async () => {
        const target = get(pass.target, 'target');
        if (pass.loadOp === 'load' && !target.initialized) fail('load requires a successfully stored target');
        // Recheck all live references and ranges before any native encoder or submit.
        const draws = pass.draws.map(d => validateDraw(d, target));
        const command = await checked(() => {
          const encoder = device.createCommandEncoder();
          const attachment = { view: target.object.createView(), loadOp: pass.loadOp, storeOp: pass.storeOp };
          if (pass.clearColor) attachment.clearValue = pass.clearColor;
          const render = encoder.beginRenderPass({ colorAttachments: [attachment] });
          for (const draw of draws) {
            const pipeline = get(draw.pipeline, 'pipeline'); render.setPipeline(pipeline.object);
            pipeline.groupLayouts.forEach((layout, group) => render.setBindGroup(group, device.createBindGroup({ layout,
              entries: [...draw.uniforms.filter(u => u.group === group).map(u => ({ binding: u.binding,
                resource: { buffer: get(u.buffer, 'uniform-buffer').object, offset: u.offset, size: u.size } })),
                ...(draw.textures ?? []).filter(t => t.group === group).flatMap(t => [
                  { binding: t.binding, resource: get(t.texture, 'sampled-texture').object.createView() },
                  { binding: t.binding + TEXTURE_LIMITS.samplerBindingOffset, resource: get(t.sampler, 'sampler').object }])] })));
            draw.vertexBuffers.forEach((b, slot) => render.setVertexBuffer(slot, get(b.buffer, 'vertex-buffer').object, b.offset, b.size));
            const v = draw.viewport, s = draw.scissor;
            render.setViewport(v.x, v.y, v.width, v.height, v.minDepth, v.maxDepth);
            render.setScissorRect(s.x, s.y, s.width, s.height);
            render.draw(draw.vertexCount, 1, draw.firstVertex, 0);
          }
          render.end(); return encoder.finish();
        });
        target.initialized = false;
        await checked(async () => { device.queue.submit([command]); await wait(device.queue.onSubmittedWorkDone()); });
        target.initialized = true; counters.passes++; counters.draws += draws.length;
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
        let staging;
        try {
          staging = await makeNative('buffer', size, () => device.createBuffer({ size,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
          const command = await checked(() => {
            const encoder = device.createCommandEncoder();
            encoder.copyTextureToBuffer({ texture: target.object }, { buffer: staging, bytesPerRow: row, rowsPerImage: height }, [width, height, 1]);
            return encoder.finish();
          });
          await checked(async () => { device.queue.submit([command]); await wait(staging.mapAsync(GPUMapMode.READ)); });
          const mapped = new Uint8Array(staging.getMappedRange()), pixels = new Uint8Array(width * height * 4);
          for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * row, y * row + width * 4), y * width * 4);
          staging.unmap(); counters.readbacks++;
          return { width, height, format: 'rgba8unorm', rowOrder: 'top-to-bottom', pixels };
        } finally { releaseNative(staging); }
      });
    },
    destroy(handle) {
      return enqueue(() => {
        const entry = resources.get(handle); if (!entry) fail('stale or foreign resource handle');
        resources.delete(handle); releaseNative(entry.object);
      });
    },
    close() { dispose('closed', 'renderer closed'); }
  });
}
