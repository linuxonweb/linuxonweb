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

/** Copy and validate translator metadata; this is a trust boundary, not reflection of WGSL text. */
export function validateTranslatedShader(input, expectedStage) {
  choice(expectedStage, ['vertex', 'fragment'], 'shader stage');
  record(input, ['wgsl', 'schema', 'profile', 'backend', 'stage', 'originalEntryPoint', 'entryPoint',
    'coordinateAdjustment', 'inputs', 'outputs', 'resources'], 'translated shader');
  if (input.schema !== 1 || input.profile !== 'graphics-empty-v1' || input.backend !== 'wgsl' ||
      input.coordinateAdjustment !== true || input.stage !== expectedStage) fail('unsupported translation contract');
  if (typeof input.wgsl !== 'string' || !input.wgsl.length || bytesOf(input.wgsl) > GRAPHICS_LIMITS.maxShaderBytes) fail('invalid WGSL size');
  if (typeof input.entryPoint !== 'string' || !/^[A-Za-z_][A-Za-z_0-9]*$/.test(input.entryPoint) || input.entryPoint.length > 256) fail('invalid emitted entry point');
  if (typeof input.originalEntryPoint !== 'string' || !input.originalEntryPoint.length ||
      input.originalEntryPoint.includes('\0') || bytesOf(input.originalEntryPoint) > 128) fail('invalid original entry point');
  array(input.resources, 0, 0, 'shader resources');
  const reflect = (items, direction) => {
    const locations = new Set(); let positions = 0;
    const result = array(items, 0, 9, `shader ${direction}`).map(item => {
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
    outputs: reflect(input.outputs, 'outputs'), resources: [] });
}

/** Backend-neutral profile and vertex declarations; no GPU enums/native objects here. */
export function validatePipelineDescriptor(input) {
  record(input, ['vertex', 'fragment', 'vertexBuffers', 'colorFormat', 'topology', 'frontFace', 'cullMode', 'sampleCount'], 'pipeline');
  const vertex = validateTranslatedShader(input.vertex, 'vertex');
  const fragment = validateTranslatedShader(input.fragment, 'fragment');
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
  if (supplied.size > GRAPHICS_LIMITS.maxAttributes || supplied.size !== vertex.inputs.length ||
      vertex.inputs.some(i => supplied.get(i.location) !== i.type.components)) fail('vertex attributes do not match shader inputs');
  const outputs = new Map(vertex.outputs.filter(i => own(i, 'location')).map(i => [i.location, i]));
  for (const input of fragment.inputs.filter(i => own(i, 'location'))) {
    const output = outputs.get(input.location);
    if (!output || output.type.components !== input.type.components ||
        output.interpolation.mode !== input.interpolation.mode ||
        output.interpolation.sampling !== input.interpolation.sampling) fail('vertex/fragment interface mismatch');
  }
  return freeze({ vertex, fragment, vertexBuffers, colorFormat, topology, frontFace, cullMode, sampleCount });
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
export function createGraphicsRenderer(device, { onEvent = () => {} } = {}) {
  if (!device?.queue || !device?.lost?.then) fail('existing WebGPU device required', 'unavailable');
  if (typeof onEvent !== 'function') fail('onEvent must be a function');
  const resources = new Map(), native = new Map(), cancelWaits = new Set();
  let state = 'open', cause = '', bytes = 0, recording = null, tail = Promise.resolve();
  const counters = { buffersCreated: 0, buffersDestroyed: 0, texturesCreated: 0, texturesDestroyed: 0,
    passes: 0, draws: 0, readbacks: 0, uploads: 0 };
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
  const add = (kind, object, descriptor) => {
    available(); const handle = Object.freeze({ kind });
    resources.set(handle, { kind, object, descriptor, initialized: false }); return handle;
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
    record(input, ['pipeline', 'vertexBuffers', 'vertexCount', 'firstVertex', 'instanceCount', 'firstInstance', 'viewport', 'scissor'], 'draw');
    const pipeline = get(input.pipeline, 'pipeline'), descriptor = pipeline.descriptor;
    if (descriptor.colorFormat !== target.descriptor.format) fail('pipeline/target format mismatch');
    const vertexCount = integer(input.vertexCount, 3, GRAPHICS_LIMITS.maxVertices, 'vertex count');
    if (vertexCount % 3) fail('initial triangle profile requires complete triangles');
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
      scissor: rectangle(input.scissor, target.descriptor, false) });
  };

  return Object.freeze({
    limits: GRAPHICS_LIMITS,
    getStats() { return Object.freeze({ state, resources: resources.size, nativeObjects: native.size, allocatedBytes: bytes,
      recordingDraws: recording?.draws.length ?? 0, ...counters }); },
    createPipeline(input) {
      // Take the entire value snapshot synchronously, before queueing/awaiting.
      const descriptor = validatePipelineDescriptor(input); checkDevicePipelineLimits(descriptor);
      return enqueue(async () => {
        budget(0);
        const object = await checked(async () => {
          const vertex = device.createShaderModule({ code: descriptor.vertex.wgsl });
          const fragment = device.createShaderModule({ code: descriptor.fragment.wgsl });
          const info = await wait(Promise.all([vertex.getCompilationInfo(), fragment.getCompilationInfo()]));
          if (info.some(i => i.messages.some(m => m.type === 'error'))) fail('translated WGSL compilation failed');
          const layout = device.createPipelineLayout({ bindGroupLayouts: [] });
          return wait(device.createRenderPipelineAsync(webgpuPipeline(descriptor, vertex, fragment, layout)));
        });
        return add('pipeline', object, descriptor);
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
            render.setPipeline(get(draw.pipeline, 'pipeline').object);
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
