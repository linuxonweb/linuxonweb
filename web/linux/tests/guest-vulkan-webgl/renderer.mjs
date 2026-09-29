// Bounded guest graphics backend. Caller exclusively owns the WebGL2 context.
import { GRAPHICS_LIMITS, GraphicsRendererError, validatePipelineDescriptor,
  validateTargetDescriptor, UNIFORM_LIMITS, validateUniformReflection, validateVertexIndex,
  validateDrawUniforms, validateUniformBufferDescriptor } from '../guest-vulkan-graphics/renderer.mjs';
export { GraphicsRendererError };
// WebGL vertexAttribPointer permits at most 255 bytes; this profile aligns to 4.
export const WEBGL_LIMITS = Object.freeze({ ...GRAPHICS_LIMITS, maxStride: 252, integerViewport: true });
const fail = (message, code = 'validation') => { throw new GraphicsRendererError(message, code); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const bytesOf = s => new TextEncoder().encode(s).byteLength;
const components = Object.freeze({ float32x2: 2, float32x3: 3, float32x4: 4 });
function record(o, keys, name) {
  if (!o || typeof o !== 'object' || Array.isArray(o) || ![Object.prototype, null].includes(Object.getPrototypeOf(o))) fail(`${name} must be a plain record`);
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
  for (let i = 0; i < a.length; i++) if (!own(a, i)) fail(`sparse ${name}`);
  return a;
}
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

/** Validate actual GLSL translator metadata, independently of the WGSL contract. */
export function validateWebGLShader(input, stage, options) {
  choice(stage, ['vertex', 'fragment'], 'shader stage');
  if (options !== undefined) record(options, ['allowUniforms'], 'shader options');
  const allowUniforms = choice(options?.allowUniforms ?? false, [false, true], 'uniform option');
  record(input, ['glsl', 'schema', 'profile', 'backend', 'stage', 'originalEntryPoint', 'entryPoint',
    'coordinateAdjustment', 'backendCoordinateAdjustment', 'inputs', 'outputs', 'resources', 'varyingBindings'], 'translated shader');
  if (input.schema !== 1 || input.profile !== 'graphics-empty-webgl-v1' || input.backend !== 'glsl-es-300' ||
      input.stage !== stage || input.coordinateAdjustment !== true || input.backendCoordinateAdjustment !== true || input.entryPoint !== 'main') fail('unsupported WebGL translation contract');
  if (typeof input.glsl !== 'string' || !input.glsl.length || bytesOf(input.glsl) > WEBGL_LIMITS.maxShaderBytes) fail('invalid GLSL size');
  if (typeof input.originalEntryPoint !== 'string' || !input.originalEntryPoint.length || input.originalEntryPoint.includes('\0') || bytesOf(input.originalEntryPoint) > 128) fail('invalid original entry point');
  // Uniform blocks carry the writer's exact block name; bindings are host-assigned.
  const resources = validateUniformReflection(input.resources, allowUniforms, true);
  // The pinned ES300 writer emits explicit locations and returns no host bindings.
  array(input.varyingBindings, 0, 0, 'host-assigned varying bindings');
  const reflect = (items, direction) => {
    const locations = new Set(); let positions = 0, vertexIndex = 0;
    const result = array(items, 0, 9, `shader ${direction}`).map(item => {
      const index = validateVertexIndex(item, allowUniforms, stage, direction);
      if (index) { if (++vertexIndex > 1) fail('duplicate vertex_index'); return index; }
      record(item, ['location', 'builtin', 'type', 'interpolation', 'invariant'], 'interface item');
      record(item.type, ['scalar', 'components'], 'interface type');
      if (item.type.scalar !== 'f32') fail('unsupported interface scalar');
      const count = choice(item.type.components, [2, 3, 4], 'interface vector size'), type = { scalar: 'f32', components: count };
      if (own(item, 'builtin')) {
        if (own(item, 'location') || item.builtin !== 'position' || count !== 4 || item.interpolation !== null ||
            typeof item.invariant !== 'boolean' || ++positions > 1 ||
            !((stage === 'vertex' && direction === 'outputs') || (stage === 'fragment' && direction === 'inputs'))) fail('unsupported builtin interface');
        return { builtin: 'position', type, interpolation: null, invariant: item.invariant };
      }
      if (own(item, 'invariant')) fail('invariant is only supported on position');
      const location = integer(item.location, 0, 7, 'interface location');
      if (locations.has(location)) fail('duplicate interface location'); locations.add(location);
      const varying = (stage === 'vertex' && direction === 'outputs') || (stage === 'fragment' && direction === 'inputs');
      let interpolation = null;
      if (varying) {
        record(item.interpolation, ['mode', 'sampling'], 'interpolation');
        const mode = choice(item.interpolation.mode, ['perspective', 'flat'], 'interpolation');
        const sampling = choice(item.interpolation.sampling, mode === 'flat' ? [null] : [null, 'center'], 'sampling');
        interpolation = { mode, sampling: mode === 'flat' ? null : sampling ?? 'center' };
      } else if (item.interpolation !== null) fail('unexpected interpolation');
      return { location, type, interpolation };
    });
    if (stage === 'vertex' && direction === 'outputs' && positions !== 1) fail('vertex position output required');
    if (stage === 'fragment' && direction === 'outputs' && (result.length !== 1 || result[0].location !== 0 || result[0].type.components !== 4)) fail('fragment location 0 float32x4 output required');
    return result;
  };
  return freeze({ schema: 1, profile: input.profile, backend: input.backend, stage, coordinateAdjustment: true,
    backendCoordinateAdjustment: true, glsl: input.glsl, entryPoint: 'main', originalEntryPoint: input.originalEntryPoint,
    inputs: reflect(input.inputs, 'inputs'), outputs: reflect(input.outputs, 'outputs'), resources, varyingBindings: [] });
}

function rectangle(input, target, viewport) {
  input ??= { x: 0, y: 0, width: target.width, height: target.height };
  record(input, viewport ? ['x', 'y', 'width', 'height', 'minDepth', 'maxDepth'] : ['x', 'y', 'width', 'height'], 'rectangle');
  const x = integer(input.x, 0, target.width, 'rectangle x (integer WebGL viewport required)');
  const y = integer(input.y, 0, target.height, 'rectangle y (integer WebGL viewport required)');
  const width = integer(input.width, viewport ? 1 : 0, target.width - x, 'rectangle width');
  const height = integer(input.height, viewport ? 1 : 0, target.height - y, 'rectangle height');
  return freeze({ x, y, width, height, ...(viewport ? {
    minDepth: finite(input.minDepth ?? 0, 0, 1, 'minimum depth'),
    maxDepth: finite(input.maxDepth ?? 1, input.minDepth ?? 0, 1, 'maximum depth') } : {}) });
}

/** Async API serializes context use. Readback uses a PBO and yielding fence waits. */
export function createWebGLRenderer(gl, { onEvent = () => {}, fenceTimeoutMs = 10000, allowUniforms = false } = {}) {
  if (!gl?.texStorage2D || !gl?.fenceSync || !gl?.getBufferSubData || !gl.canvas?.addEventListener) fail('WebGL2 context required', 'unavailable');
  if (typeof onEvent !== 'function') fail('onEvent must be a function');
  integer(fenceTimeoutMs, 1, 30000, 'fence timeout');
  choice(allowUniforms, [false, true], 'uniform option');
  const uniformOptions = allowUniforms ? { allowUniforms } : undefined;
  const resources = new Map(), native = new Map(), waiters = new Set();
  let state = 'open', cause = '', bytes = 0, recording = null, tail = Promise.resolve();
  const counters = { passes: 0, draws: 0, uploads: 0, uniformUploads: 0, readbacks: 0, fences: 0, indexDraws: 0 };
  const ownership = Object.fromEntries(['Buffer', 'Texture', 'Framebuffer', 'VertexArray', 'Program', 'Shader', 'Sync'].map(kind => [kind, { created: 0, deleted: 0 }]));
  const event = value => { try { onEvent(value); } catch { /* diagnostics do not alter semantics */ } };
  const release = object => {
    const entry = native.get(object); if (!entry) return;
    native.delete(object); bytes -= entry.bytes; ownership[entry.kind].deleted++;
    try { gl['delete' + entry.kind](object); } catch (error) { event({ type: 'delete-error', message: String(error.message) }); }
  };
  const unbind = () => {
    gl.useProgram(null); gl.bindVertexArray(null); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null);
    if (allowUniforms) { gl.bindBuffer(gl.UNIFORM_BUFFER, null); for (let i = 0; i < 8; i++) gl.bindBufferBase(gl.UNIFORM_BUFFER, i, null); }
  };
  const dispose = (next, reason) => {
    if (state !== 'open') return;
    state = next; cause = reason; recording = null; resources.clear();
    gl.canvas.removeEventListener('webglcontextlost', lost);
    for (const cancel of [...waiters]) cancel();
    try { unbind(); } catch { /* context may already be lost */ }
    for (const object of native.keys()) release(object);
    event({ type: next, message: reason });
  };
  const lost = () => dispose('lost', 'WebGL context lost');
  gl.canvas.addEventListener('webglcontextlost', lost);
  const available = () => {
    if (state === 'open' && gl.isContextLost()) lost();
    if (state !== 'open') fail(cause || `renderer ${state}`, 'unavailable');
  };
  const checkGL = () => {
    available(); const error = gl.getError();
    if (error !== gl.NO_ERROR) fail(`WebGL error 0x${error.toString(16)}`, error === gl.OUT_OF_MEMORY ? 'budget' : 'gpu');
  };
  const enqueue = action => {
    const result = tail.then(() => { available(); return action(); });
    tail = result.catch(() => {}); return result;
  };
  const budget = (allocation, publicResource = true) => {
    if ((publicResource && resources.size >= WEBGL_LIMITS.maxResources) || allocation > WEBGL_LIMITS.maxBytes - bytes) fail('renderer resource budget exceeded', 'budget');
  };
  const make = (kind, size = 0, action = () => gl['create' + kind]()) => {
    available(); const object = action();
    if (!object) { checkGL(); fail(`WebGL ${kind} allocation failed`, 'budget'); }
    native.set(object, { kind, bytes: size }); bytes += size; ownership[kind].created++;
    return object;
  };
  const add = (kind, objects, descriptor) => {
    available(); const handle = Object.freeze({ kind });
    resources.set(handle, { kind, objects, descriptor, initialized: false }); return handle;
  };
  const get = (handle, kind) => {
    available(); const entry = resources.get(handle);
    if (!entry || entry.kind !== kind) fail(`stale, foreign or wrong-type ${kind} handle`);
    return entry;
  };
  const fence = async () => {
    let sync;
    try {
      sync = make('Sync', 0, () => gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0));
      gl.flush(); checkGL(); counters.fences++;
      await new Promise((resolve, reject) => {
        const deadline = performance.now() + fenceTimeoutMs; let timer, settled = false;
        const finish = error => {
          if (settled) return; settled = true; clearTimeout(timer); waiters.delete(cancel);
          if (error) reject(error); else resolve();
        };
        const cancel = () => finish(new GraphicsRendererError(cause || 'renderer unavailable', 'unavailable'));
        const poll = () => {
          try {
            available(); const status = gl.clientWaitSync(sync, 0, 0); checkGL();
            if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) finish();
            else if (status !== gl.TIMEOUT_EXPIRED) finish(new GraphicsRendererError('WebGL fence wait failed', 'gpu'));
            else if (performance.now() >= deadline) finish(new GraphicsRendererError('WebGL fence timeout', 'gpu'));
            else timer = setTimeout(poll, 4);
          } catch (error) { finish(error); }
        };
        waiters.add(cancel); poll();
      });
    } finally { release(sync); }
  };
  const terminal = error => {
    if (state === 'closed' || state === 'lost') fail(cause, 'unavailable');
    const message = `WebGL execution failed: ${error.message ?? error}`;
    dispose('failed', message);
    // Even OUT_OF_MEMORY is terminal after a possible upload/attachment effect;
    // preserve -12 only for budget checks made before execution begins.
    fail(message, 'gpu');
  };
  const nativeLimits = { attributes: gl.getParameter(gl.MAX_VERTEX_ATTRIBS), texture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    viewport: gl.getParameter(gl.MAX_VIEWPORT_DIMS),
    ...(allowUniforms ? { uniformBindings: gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS), uniformBlockSize: gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE),
      uniformAlignment: gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT), vertexBlocks: gl.getParameter(gl.MAX_VERTEX_UNIFORM_BLOCKS),
      fragmentBlocks: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_BLOCKS) } : {}) };
  if (allowUniforms && (nativeLimits.uniformBindings < UNIFORM_LIMITS.maxUniforms || nativeLimits.uniformBlockSize < UNIFORM_LIMITS.maxRange ||
      UNIFORM_LIMITS.offsetAlignment % nativeLimits.uniformAlignment || nativeLimits.vertexBlocks < UNIFORM_LIMITS.maxUniforms ||
      nativeLimits.fragmentBlocks < UNIFORM_LIMITS.maxUniforms)) fail('WebGL2 context lacks the uniform profile limits', 'unavailable');
  const provoking = gl.getExtension('WEBGL_provoking_vertex');
  if (provoking) provoking.provokingVertexWEBGL(provoking.FIRST_VERTEX_CONVENTION_WEBGL);
  try { checkGL(); } catch (error) { dispose('failed', error.message); throw error; }
  const validateDraw = (input, target) => {
    record(input, ['pipeline', 'vertexBuffers', 'vertexCount', 'firstVertex', 'instanceCount', 'firstInstance', 'viewport', 'scissor',
      ...(allowUniforms ? ['uniforms'] : [])], 'draw');
    const pipeline = get(input.pipeline, 'pipeline'), descriptor = pipeline.descriptor;
    if (descriptor.colorFormat !== target.descriptor.format) fail('pipeline/target format mismatch');
    const vertexCount = integer(input.vertexCount, 3, WEBGL_LIMITS.maxVertices, 'vertex count');
    if (vertexCount % 3) fail('triangle profile requires complete triangles');
    const uniforms = validateDrawUniforms(input.uniforms, descriptor, allowUniforms, handle => get(handle, 'uniform-buffer'));
    const firstVertex = integer(input.firstVertex ?? 0, 0, WEBGL_LIMITS.maxVertices, 'first vertex');
    choice(input.instanceCount ?? 1, [1], 'instance count'); choice(input.firstInstance ?? 0, [0], 'first instance');
    const bindings = array(input.vertexBuffers, descriptor.vertexBuffers.length, descriptor.vertexBuffers.length, 'draw vertex buffers').map((binding, i) => {
      record(binding, ['buffer', 'offset', 'size'], 'vertex binding');
      const entry = get(binding.buffer, 'vertex-buffer');
      const offset = integer(binding.offset ?? 0, 0, entry.descriptor.size, 'binding offset');
      const size = integer(binding.size ?? entry.descriptor.size - offset, 1, entry.descriptor.size - offset, 'binding size');
      if (offset % 4 || size % 4) fail('vertex binding must be aligned');
      const layout = descriptor.vertexBuffers[i], extent = Math.max(...layout.attributes.map(a => a.offset + components[a.format] * 4));
      if ((firstVertex + vertexCount - 1) * layout.stride + extent > size) fail('vertex draw exceeds binding range');
      return Object.freeze({ buffer: binding.buffer, offset, size });
    });
    const viewport = rectangle(input.viewport, target.descriptor, true);
    if (viewport.width > nativeLimits.viewport[0] || viewport.height > nativeLimits.viewport[1]) fail('viewport exceeds context limits');
    return Object.freeze({ pipeline: input.pipeline, vertexBuffers: Object.freeze(bindings), vertexCount, firstVertex,
      instanceCount: 1, firstInstance: 0, viewport, scissor: rectangle(input.scissor, target.descriptor, false),
      ...(allowUniforms ? { uniforms: Object.freeze(uniforms) } : {}) });
  };
  return Object.freeze({
    limits: WEBGL_LIMITS,
    /** Declared pipeline uniforms: [{group,binding,stages,minSize}] in binding order. */
    pipelineUniforms(handle) { return get(handle, 'pipeline').descriptor.uniforms; },
    getStats() { return freeze({ state, resources: resources.size, nativeObjects: native.size, allocatedBytes: bytes,
      recordingDraws: recording?.draws.length ?? 0, pendingWaits: waiters.size, ...counters,
      ownership: Object.fromEntries(Object.entries(ownership).map(([kind, counts]) => [kind, { ...counts }])) }); },
    createPipeline(input) {
      const descriptor = validatePipelineDescriptor(input, validateWebGLShader, uniformOptions);
      if (descriptor.vertexBuffers.some(b => b.stride > WEBGL_LIMITS.maxStride || b.attributes.some(a => a.location >= nativeLimits.attributes))) fail('vertex layout exceeds WebGL stride/attribute limits');
      const size = bytesOf(descriptor.vertex.glsl) + bytesOf(descriptor.fragment.glsl);
      return enqueue(() => {
        budget(size); let vertex, fragment, program, accepted = false;
        const shader = (type, code) => {
          const object = make('Shader', 0, () => gl.createShader(type));
          // Record ownership before compilation so every failure is covered.
          if (type === gl.VERTEX_SHADER) vertex = object; else fragment = object;
          gl.shaderSource(object, code); gl.compileShader(object); checkGL();
          if (!gl.getShaderParameter(object, gl.COMPILE_STATUS)) fail(`GLSL compilation failed: ${(gl.getShaderInfoLog(object) || '').slice(0, 1024)}`);
          return object;
        };
        try {
          shader(gl.VERTEX_SHADER, descriptor.vertex.glsl); shader(gl.FRAGMENT_SHADER, descriptor.fragment.glsl);
          program = make('Program', size); gl.attachShader(program, vertex); gl.attachShader(program, fragment);
          gl.linkProgram(program); checkGL();
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) fail(`GLSL linking failed: ${(gl.getProgramInfoLog(program) || '').slice(0, 1024)}`);
          // Each reflected block must be active with the translator's std140 size;
          // no default-block uniforms. Binding point = index of the declared
          // pipeline uniform (Vulkan set/binding order), identical in both stages.
          const blocks = [...descriptor.vertex.resources, ...descriptor.fragment.resources];
          const uniformBlocks = [];
          if (gl.getProgramParameter(program, gl.ACTIVE_UNIFORM_BLOCKS) !== new Set(blocks.map(b => b.blockName)).size) fail('linked uniform blocks disagree with translator reflection');
          for (const block of blocks) {
            const index = gl.getUniformBlockIndex(program, block.blockName);
            if (index === gl.INVALID_INDEX || gl.getActiveUniformBlockParameter(program, index, gl.UNIFORM_BLOCK_DATA_SIZE) !== block.size) fail('linked uniform block size disagrees with translator reflection');
            const point = descriptor.uniforms.findIndex(u => u.group === block.group && u.binding === block.binding);
            if (point < 0) fail('uniform block missing from pipeline layout');
            if (uniformBlocks.some(b => b.index === index && b.point !== point)) fail('uniform block name bound to two bindings');
            if (!uniformBlocks.some(b => b.index === index)) { gl.uniformBlockBinding(program, index, point); uniformBlocks.push({ index, point }); }
          }
          const activeUniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
          if (activeUniforms) {
            const indices = Array.from({ length: activeUniforms }, (_, i) => i);
            if (gl.getActiveUniforms(program, indices, gl.UNIFORM_BLOCK_INDEX).some(block => block < 0)) fail('linked shader has prohibited default-block uniforms');
          }
          const typeMap = new Map([[gl.FLOAT_VEC2, 2], [gl.FLOAT_VEC3, 3], [gl.FLOAT_VEC4, 4]]);
          for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES); i++) {
            const active = gl.getActiveAttrib(program, i), location = gl.getAttribLocation(program, active.name);
            // Some GL implementations (ANGLE) list the gl_VertexID built-in as an active
            // attribute; it is accepted only when reflection declared Vulkan vertex_index.
            if (active.name === 'gl_VertexID' && descriptor.vertex.inputs.some(item => item.builtin === 'vertex_index')) continue;
            if (active.name.startsWith('gl_')) fail('unexpected built-in attribute');
            const declared = descriptor.vertex.inputs.find(item => own(item, 'location') && item.location === location);
            if (!declared || active.size !== 1 || declared.type.components !== typeMap.get(active.type)) fail('linked attributes disagree with translator reflection');
          }
          checkGL(); gl.detachShader(program, vertex); gl.detachShader(program, fragment); checkGL();
          const handle = add('pipeline', [program], descriptor); accepted = true; return handle;
        } finally { release(vertex); release(fragment); if (!accepted) release(program); }
      });
    },
    createVertexBuffer(input) {
      record(input, ['size'], 'vertex buffer'); const size = integer(input.size, 4, WEBGL_LIMITS.maxVertexBufferBytes, 'buffer size');
      if (size % 4) fail('vertex buffer size must be aligned');
      return enqueue(() => {
        budget(size); let buffer, accepted = false;
        try {
          buffer = make('Buffer', size); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, size, gl.DYNAMIC_DRAW); checkGL();
          const handle = add('vertex-buffer', [buffer], Object.freeze({ size })); accepted = true; return handle;
        } finally { gl.bindBuffer(gl.ARRAY_BUFFER, null); if (!accepted) release(buffer); }
      });
    },
    createUniformBuffer(input) {
      if (!allowUniforms) fail('uniform profile not enabled');
      const { size } = validateUniformBufferDescriptor(input);
      return enqueue(() => {
        budget(size); let buffer, accepted = false;
        try {
          buffer = make('Buffer', size); gl.bindBuffer(gl.UNIFORM_BUFFER, buffer); gl.bufferData(gl.UNIFORM_BUFFER, size, gl.DYNAMIC_DRAW); checkGL();
          const handle = add('uniform-buffer', [buffer], Object.freeze({ size })); accepted = true; return handle;
        } finally { gl.bindBuffer(gl.UNIFORM_BUFFER, null); if (!accepted) release(buffer); }
      });
    },
    uploadUniformBuffer(handle, offset, data) {
      if (!allowUniforms) fail('uniform profile not enabled');
      get(handle, 'uniform-buffer'); integer(offset, 0, UNIFORM_LIMITS.maxBufferBytes, 'upload offset');
      if (!(data instanceof Uint8Array) || !data.byteLength || data.byteLength > UNIFORM_LIMITS.maxBufferBytes || offset % 4 || data.byteLength % 4) fail('upload requires bounded aligned bytes');
      const copy = data.slice();
      return enqueue(() => {
        const entry = get(handle, 'uniform-buffer');
        if (offset > entry.descriptor.size || copy.byteLength > entry.descriptor.size - offset) fail('upload exceeds uniform buffer');
        try { gl.bindBuffer(gl.UNIFORM_BUFFER, entry.objects[0]); gl.bufferSubData(gl.UNIFORM_BUFFER, offset, copy); checkGL(); counters.uniformUploads++; }
        catch (error) { terminal(error); }
        finally { gl.bindBuffer(gl.UNIFORM_BUFFER, null); }
      });
    },
    uploadVertexBuffer(handle, offset, data) {
      get(handle, 'vertex-buffer'); integer(offset, 0, WEBGL_LIMITS.maxVertexBufferBytes, 'upload offset');
      if (!(data instanceof Uint8Array) || !data.byteLength || data.byteLength > WEBGL_LIMITS.maxVertexBufferBytes || offset % 4 || data.byteLength % 4) fail('upload requires bounded aligned bytes');
      const copy = data.slice();
      return enqueue(() => {
        const entry = get(handle, 'vertex-buffer');
        if (offset > entry.descriptor.size || copy.byteLength > entry.descriptor.size - offset) fail('upload exceeds vertex buffer');
        try { gl.bindBuffer(gl.ARRAY_BUFFER, entry.objects[0]); gl.bufferSubData(gl.ARRAY_BUFFER, offset, copy); checkGL(); counters.uploads++; }
        catch (error) { terminal(error); }
        finally { gl.bindBuffer(gl.ARRAY_BUFFER, null); }
      });
    },
    createTarget(input) {
      const descriptor = validateTargetDescriptor(input), size = descriptor.width * descriptor.height * 4;
      if (Math.max(descriptor.width, descriptor.height) > nativeLimits.texture) fail('target exceeds context limits');
      return enqueue(() => {
        budget(size); let texture, framebuffer, accepted = false;
        try {
          texture = make('Texture', size); gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, descriptor.width, descriptor.height);
          framebuffer = make('Framebuffer'); gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0); checkGL();
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) fail('RGBA8 framebuffer incomplete', 'unavailable');
          const handle = add('target', [framebuffer, texture], descriptor); accepted = true; return handle;
        } finally {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null);
          if (!accepted) { release(framebuffer); release(texture); }
        }
      });
    },
    begin(input) {
      available(); if (recording) fail('render pass already recording');
      record(input, ['target', 'loadOp', 'storeOp', 'clearColor'], 'render pass'); get(input.target, 'target');
      const loadOp = choice(input.loadOp, ['clear', 'load'], 'load operation'), storeOp = choice(input.storeOp, ['store'], 'store operation');
      let clearColor;
      if (loadOp === 'clear') clearColor = Object.freeze(array(input.clearColor, 4, 4, 'clear color').map(c => finite(c, 0, 1, 'clear color component')));
      else if (own(input, 'clearColor')) fail('clear color requires clear load operation');
      recording = { target: input.target, loadOp, storeOp, clearColor, draws: [] };
    },
    draw(input) {
      available(); if (!recording) fail('draw requires a recording pass');
      if (recording.draws.length >= WEBGL_LIMITS.maxDraws) fail('render pass draw budget exceeded', 'budget');
      recording.draws.push(validateDraw(input, get(recording.target, 'target')));
    },
    abort() { available(); recording = null; },
    end() {
      available(); if (!recording) fail('end requires a recording pass');
      const pass = recording; recording = null;
      return enqueue(async () => {
        const target = get(pass.target, 'target');
        if (pass.loadOp === 'load' && !target.initialized) fail('load requires a successfully stored target');
        // This entire loop runs before any native allocation, clear or draw.
        const draws = pass.draws.map(draw => validateDraw(draw, target));
        const needsIndices = draw => !provoking && get(draw.pipeline, 'pipeline').descriptor.fragment.inputs.some(item => item.interpolation?.mode === 'flat');
        const indexCount = Math.max(0, ...draws.filter(needsIndices).map(draw => draw.vertexCount));
        // Reserve one reused index stream before any attachment effects. A
        // cyclic rotation preserves winding and makes original vertex zero
        // the final/provoking vertex on base WebGL's last-vertex convention.
        budget(indexCount * 4, false);
        const indices = indexCount ? new Uint32Array(indexCount) : null;
        let vao, indexBuffer;
        try {
          vao = make('VertexArray'); gl.bindVertexArray(vao); gl.bindFramebuffer(gl.FRAMEBUFFER, target.objects[0]);
          if (indices) {
            indexBuffer = make('Buffer', indices.byteLength); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices.byteLength, gl.STREAM_DRAW);
          }
          gl.disable(gl.DITHER); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST);
          gl.disable(gl.CULL_FACE); gl.disable(gl.RASTERIZER_DISCARD); gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE); gl.disable(gl.SAMPLE_COVERAGE);
          gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true);
          target.initialized = false;
          if (pass.loadOp === 'clear') { gl.clearColor(...pass.clearColor); gl.clear(gl.COLOR_BUFFER_BIT); }
          for (const draw of draws) {
            const pipeline = get(draw.pipeline, 'pipeline'); gl.useProgram(pipeline.objects[0]);
            draw.uniforms?.forEach((u, point) => gl.bindBufferRange(gl.UNIFORM_BUFFER, point, get(u.buffer, 'uniform-buffer').objects[0], u.offset, u.size));
            for (let location = 0; location < Math.min(8, nativeLimits.attributes); location++) gl.disableVertexAttribArray(location);
            draw.vertexBuffers.forEach((binding, slot) => {
              const layout = pipeline.descriptor.vertexBuffers[slot]; gl.bindBuffer(gl.ARRAY_BUFFER, get(binding.buffer, 'vertex-buffer').objects[0]);
              for (const attribute of layout.attributes) {
                gl.enableVertexAttribArray(attribute.location); gl.vertexAttribDivisor(attribute.location, 0);
                gl.vertexAttribPointer(attribute.location, components[attribute.format], gl.FLOAT, false, layout.stride, binding.offset + attribute.offset);
              }
            });
            const v = draw.viewport, s = draw.scissor;
            gl.viewport(v.x, v.y, v.width, v.height); gl.depthRange(v.minDepth, v.maxDepth);
            gl.enable(gl.SCISSOR_TEST); gl.scissor(s.x, s.y, s.width, s.height);
            if (needsIndices(draw)) {
              for (let i = 0; i < draw.vertexCount; i += 3) {
                indices[i] = draw.firstVertex + i + 1; indices[i + 1] = draw.firstVertex + i + 2; indices[i + 2] = draw.firstVertex + i;
              }
              gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, indices.subarray(0, draw.vertexCount));
              gl.drawElements(gl.TRIANGLES, draw.vertexCount, gl.UNSIGNED_INT, 0); counters.indexDraws++;
            } else gl.drawArrays(gl.TRIANGLES, draw.firstVertex, draw.vertexCount);
          }
          checkGL(); await fence(); available(); target.initialized = true;
          counters.passes++; counters.draws += draws.length; event({ type: 'pass', draws: draws.length });
        } catch (error) { terminal(error); }
        finally {
          gl.useProgram(null); gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          if (allowUniforms) for (let point = 0; point < UNIFORM_LIMITS.maxUniforms; point++) gl.bindBufferBase(gl.UNIFORM_BUFFER, point, null);
          release(vao); release(indexBuffer);
        }
      });
    },
    readback(handle) {
      get(handle, 'target');
      return enqueue(async () => {
        const target = get(handle, 'target');
        if (!target.initialized) fail('readback requires a successfully stored target');
        const { width, height } = target.descriptor, size = width * height * 4; budget(size, false);
        let staging;
        try {
          staging = make('Buffer', size); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, staging); gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ);
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.objects[0]); gl.readBuffer(gl.COLOR_ATTACHMENT0);
          gl.pixelStorei(gl.PACK_ALIGNMENT, 4); gl.pixelStorei(gl.PACK_ROW_LENGTH, 0); gl.pixelStorei(gl.PACK_SKIP_ROWS, 0); gl.pixelStorei(gl.PACK_SKIP_PIXELS, 0);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0); checkGL(); await fence();
          const pixels = new Uint8Array(size); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, staging); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels); checkGL();
          counters.readbacks++;
          // Shader adjustment + positive viewport define logical guest row zero.
          return { width, height, format: 'rgba8unorm', rowOrder: 'top-to-bottom', pixels };
        } catch (error) { terminal(error); }
        finally { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.bindFramebuffer(gl.FRAMEBUFFER, null); release(staging); }
      });
    },
    destroy(handle) {
      return enqueue(() => {
        const entry = resources.get(handle); if (!entry) fail('stale or foreign resource handle');
        resources.delete(handle); entry.objects.forEach(release);
      });
    },
    close() { dispose('closed', 'renderer closed'); }
  });
}
