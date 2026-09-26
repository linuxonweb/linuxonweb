// Experimental guest-command renderer. Not imported by the accepted runtime.
export const MAGIC = 0x31555047, VERSION = 1, MAX_PAYLOAD = 1048576;
export const OP = Object.freeze({ HELLO: 0, SHADER: 1, BUFFER: 2, PIPELINE: 3, TARGET: 4, DRAW: 5, READBACK: 6, DESTROY: 7, CLOSE: 8, CLEAR: 9, SPIRV_SHADER: 10, COMPUTE_PIPELINE: 11, STORAGE_BUFFER: 12, STORAGE_UPLOAD: 13, COMPUTE_DISPATCH: 14, STORAGE_READBACK: 15,
  GRAPHICS_SHADER: 16, GRAPHICS_PIPELINE: 17, VERTEX_BUFFER: 18, VERTEX_UPLOAD: 19, GRAPHICS_TARGET: 20, GRAPHICS_PASS: 21, GRAPHICS_READBACK: 22 });
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const fail = (message, status = -22) => { throw Object.assign(new Error(message), {status}); };
const words = (...values) => { const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer); values.forEach((n, i) => view.setUint32(i * 4, n, true)); return bytes; };
export function decodeHeader(bytes, allowClear = false, allowCompute = false, allowGraphics = false) {
  if (bytes.byteLength !== 16) fail('short header');
  const v = new DataView(bytes.buffer, bytes.byteOffset, 16);
  if (v.getUint32(0, true) !== MAGIC || v.getUint16(4, true) !== VERSION) fail('unsupported protocol');
  const opcode = v.getUint16(6, true), request = v.getUint32(8, true), length = v.getUint32(12, true);
  if (opcode > (allowGraphics ? OP.GRAPHICS_READBACK : allowCompute ? OP.STORAGE_READBACK : allowClear ? OP.CLEAR : OP.CLOSE) || !request || length > MAX_PAYLOAD) fail('invalid opcode, sequence or length');
  return { opcode, request, length };
}
export function encodeReply(opcode, request, status, body = new Uint8Array()) {
  const result = new Uint8Array(20 + body.byteLength), v = new DataView(result.buffer);
  v.setUint32(0, MAGIC, true); v.setUint16(4, VERSION, true); v.setUint16(6, opcode | 0x8000, true);
  v.setUint32(8, request, true); v.setUint32(12, 4 + body.byteLength, true); v.setInt32(16, status, true);
  result.set(body, 20); return result;
}

/** Ownership transfers to serveGPU; close must synchronously release the lease. */
export function createWebGLContextLease() {
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(1, 1) : globalThis.document?.createElement('canvas');
  if (!canvas) fail('WebGL2 canvas unavailable', -19);
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false });
  if (!gl) fail('WebGL2 context unavailable', -19);
  let closed = false;
  return { gl, close() { if (!closed) { closed = true; gl.getExtension('WEBGL_lose_context')?.loseContext(); } } };
}

/** One device and resource table per connection. No guest memory/shared views. */
export async function serveGPU(connection, { gpu = globalThis.navigator?.gpu, timeoutMs = 60000, onEvent = () => {}, allowClear = false, allowCompute = false, translatorOptions, translatorFactory,
  allowGraphics = false, graphicsTranslatorOptions, graphicsTranslatorFactory,
  allowWebGL = false, webglTranslatorOptions, webglTranslatorFactory, webglContextFactory = createWebGLContextLease } = {}) {
  const resources = new Map(); let translator, graphicsTranslator, graphicsRenderer, validateGraphicsShader;
  let device, contextLease, lost = false, closed = false, nextId = 1, allocation = 0, lastRequest = 0;
  const initializing = new Set();
  const report = { commands: 0, draws: 0, clears: 0, readbacks: 0, dispatches: 0, uploads: 0, translations: 0, translatorsCreated: 0, translatorsClosed: 0, released: 0, adapter: null, error: null,
    graphicsTranslations: 0, graphicsPasses: 0, graphicsDraws: 0, graphicsUploads: 0, graphicsReadbacks: 0,
    graphicsTranslatorsCreated: 0, graphicsTranslatorsClosed: 0, graphics: null,
    backend: null, acquisitionError: null, contextsCreated: 0, contextsClosed: 0, cleanupErrors: [] };
  const attempt = action => { try { action(); } catch (error) { report.cleanupErrors.push(String(error.message).slice(0, 512)); } };
  const releaseContext = lease => { report.contextsClosed++; attempt(() => lease.close()); };
  const cleanup = () => {
    if (closed) return; closed = true;
    for (const cancel of [...initializing]) cancel();
    attempt(() => graphicsRenderer?.close());
    if (graphicsRenderer) report.graphics = graphicsRenderer.getStats();
    for (const entry of resources.values()) if (!entry.graphics) attempt(() => entry.object.destroy?.());
    report.released += resources.size; resources.clear(); allocation = 0;
    if (translator) { attempt(() => translator.close()); translator = undefined; report.translatorsClosed++; }
    if (graphicsTranslator) { attempt(() => graphicsTranslator.close()); graphicsTranslator = undefined; report.graphicsTranslatorsClosed++; }
    attempt(() => device?.destroy());
    if (contextLease) { const lease = contextLease; contextLease = undefined; releaseContext(lease); }
    attempt(() => connection.close());
  };
  const timer = setTimeout(() => { report.error = 'session deadline'; cleanup(); }, timeoutMs);
  // Browser acquisition APIs are not cancellable. Stop waiting on session close,
  // while retaining a release handler for any resource they deliver afterward.
  const initialize = (promise, releaseLate = () => {}) => new Promise((resolve, reject) => {
    let settled = false;
    const cancel = () => { if (!settled) { settled = true; initializing.delete(cancel); reject(Object.assign(new Error('session closed during initialization'), { status: -19 })); } };
    initializing.add(cancel);
    Promise.resolve(promise).then(value => {
      initializing.delete(cancel);
      if (settled || closed) { attempt(() => releaseLate(value)); cancel(); return; }
      settled = true; resolve(value);
    }, error => { initializing.delete(cancel); if (!settled) { settled = true; reject(error); } });
    if (closed) cancel();
  });
  const add = (kind, object, bytes = 0, extra = {}) => {
    if (closed || nextId > 0xffffffff || resources.size >= 64 || allocation + bytes > 16 * 1024 * 1024) { object.destroy?.(); fail('resource budget exceeded', -12); }
    const id = nextId++; resources.set(id, { kind, object, bytes, ...extra }); allocation += bytes;
    return new Uint8Array(words(id).buffer);
  };
  const get = (id, kind) => { const r = resources.get(id); if (!r || r.kind !== kind) fail('unknown resource or wrong type'); return r; };
  const budget = bytes => {
    if (closed || lost) fail('device unavailable', -19);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || nextId > 0xffffffff || resources.size >= 64 || allocation + bytes > 16 * 1024 * 1024) fail('resource budget exceeded', -12);
  };
  const addGraphics = async (kind, bytes, create, extra = {}) => {
    budget(bytes);
    const object = await create();
    // The host loop is serial; only timeout/device loss can change ownership here.
    if (closed || lost) fail('device unavailable', -19); // renderer.close already releases its objects
    return add(kind, object, bytes, { ...extra, graphics: true });
  };
  const record = (value, keys, name) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
        Object.keys(value).some(key => !keys.includes(key))) fail(`invalid ${name} record`);
    return value;
  };
  const parseGraphics = payload => {
    if (!payload.length || payload.length > 65536) fail('invalid graphics JSON size');
    return JSON.parse(decoder.decode(payload), (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail('reserved JSON field');
      return value;
    });
  };
  const shaderReference = (reference, stage) => {
    record(reference, ['shader', 'entryPoint'], 'shader reference');
    const shader = get(reference.shader, 'graphics-shader');
    if (shader.object.stage !== stage || reference.entryPoint !== shader.object.originalEntryPoint) fail('shader stage or original entry point mismatch');
    return shader;
  };
  const checked = async action => {
    if (closed || lost) fail('device unavailable');
    device.pushErrorScope('validation');
    let result, caught;
    try { result = await action(); } catch (error) { caught = error; }
    const error = await device.popErrorScope();
    if (caught || error || closed || lost) { result?.destroy?.(); throw caught || error || new Error('device lost'); }
    return result;
  };
  try {
    if (allowWebGL && !allowGraphics) fail('WebGL fallback requires the graphics profile');
    let adapter;
    try {
      if (!gpu) fail('WebGPU API unavailable', -19);
      adapter = await initialize(gpu.requestAdapter());
      if (!adapter) fail('WebGPU adapter unavailable', -19);
      device = await initialize(adapter.requestDevice(), value => value?.destroy());
      if (!device) fail('WebGPU device unavailable', -19);
    } catch (error) {
      report.acquisitionError = String(error.message).slice(0, 512);
      if (closed || !allowWebGL) throw error;
    }
    if (closed) fail('session closed', -19);
    if (device) {
      report.backend = 'webgpu';
      report.adapter = { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, description: adapter.info?.description,
        isFallbackAdapter: adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null };
      device.lost.then(info => { if (!closed) { lost = true; report.error = `device lost: ${info.message}`; cleanup(); } });
    } else {
      const acquireContext = async () => {
        const lease = await webglContextFactory();
        if (!lease?.gl || typeof lease.close !== 'function') { attempt(() => lease?.close?.()); fail('invalid WebGL context lease', -19); }
        report.contextsCreated++; return lease;
      };
      contextLease = await initialize(acquireContext(), releaseContext);
      report.backend = 'webgl2'; allowCompute = false; allowClear = false;
      const gl = contextLease.gl, debug = gl.getExtension('WEBGL_debug_renderer_info');
      report.adapter = { vendor: String(gl.getParameter(gl.VENDOR)).slice(0, 128),
        description: String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)).slice(0, 512), isFallbackAdapter: null };
    }
    if (allowCompute) {
      const factory = translatorFactory ?? (await import('../guest-vulkan-compute/translator/index.mjs')).createSpirvTranslator;
      const created = await initialize(factory(translatorOptions), value => value.close());
      if (closed) { created.close(); fail('session closed', -19); }
      translator = created; report.translatorsCreated++;
    }
    if (allowGraphics) {
      const webgl = report.backend === 'webgl2';
      const factory = webgl ? webglTranslatorFactory ?? (await import('../guest-vulkan-webgl/translator/index.mjs')).createWebGLGraphicsTranslator :
        graphicsTranslatorFactory ?? (await import('../guest-vulkan-graphics/translator/index.mjs')).createGraphicsTranslator;
      const created = await initialize(factory(webgl ? webglTranslatorOptions : graphicsTranslatorOptions), value => value.close());
      if (closed) { created.close(); fail('session closed', -19); }
      graphicsTranslator = created; report.graphicsTranslatorsCreated++;
      const renderer = webgl ? await import('../guest-vulkan-webgl/renderer.mjs') : await import('../guest-vulkan-graphics/renderer.mjs');
      if (closed) fail('session closed', -19);
      validateGraphicsShader = webgl ? renderer.validateWebGLShader : renderer.validateTranslatedShader;
      graphicsRenderer = webgl ? renderer.createWebGLRenderer(contextLease.gl, { onEvent(event) {
        if (event.type === 'lost' && !closed) { lost = true; report.error = event.message; cleanup(); }
      } }) : renderer.createGraphicsRenderer(device);
    }
    onEvent({ type: 'adapter', backend: report.backend, ...report.adapter });
    while (!closed) {
      const header = await connection.readExactly(16); if (!header.length) break;
      const { opcode, request, length } = decodeHeader(header, allowClear, allowCompute, allowGraphics);
      if (request <= lastRequest) fail('non-monotonic request id'); lastRequest = request;
      const payload = await connection.readExactly(length); if (payload.length !== length) fail('truncated payload');
      const v = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const exact = n => { if (length !== n) fail('invalid payload length'); };
      let body = new Uint8Array(), status = 0, terminal = false;
      try {
        if (report.backend === 'webgl2' && opcode >= OP.SHADER && opcode <= OP.STORAGE_READBACK && opcode !== OP.DESTROY && opcode !== OP.CLOSE)
          fail('operation unavailable on the WebGL graphics backend');
        switch (opcode) {
          case OP.HELLO: exact(0); body = encoder.encode(JSON.stringify({ version: VERSION, maxResources: 64, maxTarget: 512, backend: report.backend,
            shader: report.backend === 'webgl2' ? 'SPIR-V' : 'WGSL', ...(allowClear ? { clearImage: true } : {}),
            ...(allowCompute ? {computeProfile: 1, maxStorageBuffer:65536, workgroupSize:[64,1,1]} : {}),
            ...(allowGraphics ? {graphicsProfile:1,maxVertexBuffer:65536,maxGraphicsDraws:256,maxVertexStride:graphicsRenderer.limits.maxStride,integerViewport:report.backend==='webgl2'} : {}), adapter: report.adapter })); break;
          case OP.SHADER: {
            if (!length || length > 65536) fail('invalid shader size');
            const shader = await checked(() => device.createShaderModule({ code: decoder.decode(payload) }));
            const info = await shader.getCompilationInfo();
            if (info.messages.some(m => m.type === 'error')) fail('WGSL compilation failed');
            body = add('shader', shader); break;
          }
          case OP.BUFFER: {
            if (!length || length > 65536 || length % 20) fail('vertices require packed float32 x,y,r,g,b');
            const buffer = await checked(() => {
              const b = device.createBuffer({ size: length, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
              device.queue.writeBuffer(b, 0, payload); return b;
            });
            body = add('buffer', buffer, length, { vertices: length / 20 }); break;
          }
          case OP.PIPELINE: {
            exact(4); const shader = get(v.getUint32(0, true), 'shader').object;
            body = add('pipeline', await checked(() => device.createRenderPipelineAsync({ layout: 'auto',
              vertex: { module: shader, entryPoint: 'vs', buffers: [{ arrayStride: 20, attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x2' }, { shaderLocation: 1, offset: 8, format: 'float32x3' }] }] },
              fragment: { module: shader, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
              primitive: { topology: 'triangle-list' } }))); break;
          }
          case OP.TARGET: {
            exact(8); const width = v.getUint32(0, true), height = v.getUint32(4, true);
            if (!width || !height || width > 512 || height > 512) fail('target exceeds limits');
            body = add('target', await checked(() => device.createTexture({ size: [width, height], format: 'rgba8unorm',
              usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC })), width * height * 4, { width, height }); break;
          }
          case OP.DRAW: {
            exact(16); const target = get(v.getUint32(0, true), 'target'), pipeline = get(v.getUint32(4, true), 'pipeline');
            const buffer = get(v.getUint32(8, true), 'buffer'), count = v.getUint32(12, true);
            if (!count || count > buffer.vertices || count % 3) fail('invalid vertex count');
            await checked(async () => {
              const commands = device.createCommandEncoder(), pass = commands.beginRenderPass({ colorAttachments: [{ view: target.object.createView(),
                clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
              pass.setPipeline(pipeline.object); pass.setVertexBuffer(0, buffer.object); pass.draw(count); pass.end();
              device.queue.submit([commands.finish()]); await device.queue.onSubmittedWorkDone();
            }); report.draws++; break;
          }
          case OP.CLEAR: {
            if (!allowClear) fail('clear not negotiated');
            exact(20); const target = get(v.getUint32(0, true), 'target');
            const color = Array.from({length:4}, (_, i) => v.getFloat32(4 + 4*i, true));
            if (color.some(n => !Number.isFinite(n) || n < 0 || n > 1)) fail('invalid clear color');
            await checked(async () => {
              const commands = device.createCommandEncoder();
              const pass = commands.beginRenderPass({colorAttachments:[{view:target.object.createView(),
                clearValue:{r:color[0],g:color[1],b:color[2],a:color[3]},loadOp:'clear',storeOp:'store'}]});
              pass.end(); device.queue.submit([commands.finish()]); await device.queue.onSubmittedWorkDone();
            }); report.clears++; break;
          }
          case OP.READBACK: {
            exact(4); const target = get(v.getUint32(0, true), 'target');
            const row = Math.ceil(target.width * 4 / 256) * 256;
            if (allocation + row * target.height > 16 * 1024 * 1024) fail('readback exceeds resource budget');
            let staging;
            try {
              staging = await checked(() => device.createBuffer({ size: row * target.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
              await checked(async () => {
                const commands = device.createCommandEncoder();
                commands.copyTextureToBuffer({ texture: target.object }, { buffer: staging, bytesPerRow: row }, [target.width, target.height]);
                device.queue.submit([commands.finish()]); await staging.mapAsync(GPUMapMode.READ);
              });
              const mapped = new Uint8Array(staging.getMappedRange()); body = new Uint8Array(target.width * target.height * 4);
              for (let y = 0; y < target.height; y++) body.set(mapped.subarray(y * row, y * row + target.width * 4), y * target.width * 4);
              staging.unmap(); report.readbacks++;
            } finally { staging?.destroy(); } break;
          }
          case OP.SPIRV_SHADER: {
            if (!allowCompute || length < 20 || length > 65536 || length % 4) fail('invalid SPIR-V profile/length');
            const translated = await translator.translate(payload.slice());
            if (typeof translated.wgsl !== 'string' || !translated.wgsl.length || encoder.encode(translated.wgsl).length > 262144 ||
                typeof translated.entryPoint !== 'string' || !/^[A-Za-z_][A-Za-z_0-9]*$/.test(translated.entryPoint) ||
                JSON.stringify(translated.workgroupSize) !== '[64,1,1]') fail('invalid translated profile');
            const shader = await checked(() => device.createShaderModule({code:translated.wgsl}));
            const info = await shader.getCompilationInfo();
            if (info.messages.some(m => m.type === 'error')) fail('translated shader compilation failed');
            body = add('compute-shader', shader, length, {entryPoint:translated.entryPoint}); report.translations++; break;
          }
          case OP.COMPUTE_PIPELINE: {
            if (!allowCompute) fail('compute not negotiated');
            exact(4); const shader = get(v.getUint32(0,true), 'compute-shader');
            const layout = await checked(() => device.createBindGroupLayout({entries:[{binding:0, visibility:GPUShaderStage.COMPUTE, buffer:{type:'storage'}}]}));
            const pipeline = await checked(() => device.createComputePipelineAsync({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),
              compute:{module:shader.object,entryPoint:shader.entryPoint}}));
            body=add('compute-pipeline',pipeline,0,{layout}); break;
          }
          case OP.STORAGE_BUFFER: {
            if (!allowCompute) fail('compute not negotiated');
            exact(4); const size=v.getUint32(0,true);
            if (!size || size > 65536 || size % 4) fail('invalid storage size');
            body=add('storage',await checked(() => device.createBuffer({size,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST})),size); break;
          }
          case OP.STORAGE_UPLOAD: {
            if (!allowCompute || length < 12) fail('invalid storage upload');
            const storage=get(v.getUint32(0,true),'storage'), offset=v.getUint32(4,true), size=v.getUint32(8,true);
            if (!size || offset % 4 || size % 4 || offset > storage.bytes || size > storage.bytes-offset || length !== size+12) fail('invalid storage upload bounds');
            await checked(async () => {device.queue.writeBuffer(storage.object,offset,payload.subarray(12)); await device.queue.onSubmittedWorkDone();});
            report.uploads++; break;
          }
          case OP.COMPUTE_DISPATCH: {
            if (!allowCompute) fail('compute not negotiated');
            exact(28); const pipeline=get(v.getUint32(0,true),'compute-pipeline'), storage=get(v.getUint32(4,true),'storage');
            const offset=v.getUint32(8,true),size=v.getUint32(12,true);
            if (offset || size < 256 || size > storage.bytes || size % 4 || v.getUint32(16,true)!==1 || v.getUint32(20,true)!==1 || v.getUint32(24,true)!==1) fail('invalid dispatch bounds');
            await checked(async () => {
              const group=device.createBindGroup({layout:pipeline.layout,entries:[{binding:0,resource:{buffer:storage.object,offset,size}}]});
              const commands=device.createCommandEncoder(),pass=commands.beginComputePass();
              pass.setPipeline(pipeline.object);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1,1,1);pass.end();
              device.queue.submit([commands.finish()]);await device.queue.onSubmittedWorkDone();
            });report.dispatches++;break;
          }
          case OP.STORAGE_READBACK: {
            if (!allowCompute) fail('compute not negotiated');
            exact(12);const storage=get(v.getUint32(0,true),'storage'),offset=v.getUint32(4,true),size=v.getUint32(8,true);
            if (!size || offset % 4 || size % 4 || offset > storage.bytes || size > storage.bytes-offset) fail('invalid storage readback bounds');
            if (allocation+size > 16*1024*1024) fail('readback exceeds resource budget',-12);
            let staging;
            try {
              staging=await checked(() => device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}));
              await checked(async () => {const commands=device.createCommandEncoder();commands.copyBufferToBuffer(storage.object,offset,staging,0,size);
                device.queue.submit([commands.finish()]);await staging.mapAsync(GPUMapMode.READ);});
              body=new Uint8Array(staging.getMappedRange()).slice();staging.unmap();report.readbacks++;
            } finally {staging?.destroy();}break;
          }
          case OP.GRAPHICS_SHADER: {
            if (!allowGraphics || length < 20 || length > 65536 || length % 4) fail('invalid graphics SPIR-V profile/length');
            const translated = await graphicsTranslator.translate(payload.slice());
            const shader = validateGraphicsShader(translated, translated.stage);
            const bytes = encoder.encode(JSON.stringify(shader)).length;
            budget(bytes); body = add('graphics-shader', shader, bytes, {graphics:true});
            report.graphicsTranslations++; break;
          }
          case OP.GRAPHICS_PIPELINE: {
            if (!allowGraphics) fail('graphics not negotiated');
            const descriptor = record(parseGraphics(payload), ['vertex','fragment','vertexBuffers','colorFormat','topology','frontFace','cullMode','sampleCount'], 'graphics pipeline');
            const vertex = shaderReference(descriptor.vertex, 'vertex'), fragment = shaderReference(descriptor.fragment, 'fragment');
            // Charge copies retained by the pipeline even after shader IDs are destroyed.
            const bytes = vertex.bytes + fragment.bytes + length;
            body = await addGraphics('graphics-pipeline', bytes, () => graphicsRenderer.createPipeline({ ...descriptor, vertex:vertex.object, fragment:fragment.object }));
            break;
          }
          case OP.VERTEX_BUFFER: {
            if (!allowGraphics) fail('graphics not negotiated');
            exact(4); const size = v.getUint32(0,true);
            if (!size || size > 65536 || size % 4) fail('invalid vertex buffer size');
            body = await addGraphics('graphics-vertex', size, () => graphicsRenderer.createVertexBuffer({size})); break;
          }
          case OP.VERTEX_UPLOAD: {
            if (!allowGraphics || length < 12) fail('invalid graphics upload');
            const buffer = get(v.getUint32(0,true), 'graphics-vertex'), offset = v.getUint32(4,true), size = v.getUint32(8,true);
            if (!size || size % 4 || offset % 4 || offset > buffer.bytes || size > buffer.bytes-offset || length !== size+12) fail('invalid vertex upload bounds');
            await graphicsRenderer.uploadVertexBuffer(buffer.object, offset, payload.subarray(12)); report.graphicsUploads++; break;
          }
          case OP.GRAPHICS_TARGET: {
            if (!allowGraphics) fail('graphics not negotiated');
            exact(8); const width = v.getUint32(0,true), height = v.getUint32(4,true);
            if (!width || !height || width > 512 || height > 512) fail('invalid graphics target size');
            body = await addGraphics('graphics-target', width*height*4, () => graphicsRenderer.createTarget({width,height}), {width,height}); break;
          }
          case OP.GRAPHICS_PASS: {
            if (!allowGraphics) fail('graphics not negotiated');
            const pass = record(parseGraphics(payload), ['target','loadOp','storeOp','clearColor','draws'], 'graphics pass');
            const target = get(pass.target, 'graphics-target');
            if (!Array.isArray(pass.draws) || pass.draws.length > 256) fail('invalid graphics draw count');
            const draws = pass.draws.map(draw => {
              record(draw, ['pipeline','vertexBuffers','vertexCount','firstVertex','instanceCount','firstInstance','viewport','scissor'], 'graphics draw');
              const pipeline = get(draw.pipeline, 'graphics-pipeline');
              if (!Array.isArray(draw.vertexBuffers) || draw.vertexBuffers.length > 8) fail('invalid graphics vertex bindings');
              const vertexBuffers = draw.vertexBuffers.map(binding => {
                record(binding, ['buffer','offset','size'], 'vertex binding');
                return { ...binding, buffer:get(binding.buffer, 'graphics-vertex').object };
              });
              return { ...draw, pipeline:pipeline.object, vertexBuffers };
            });
            try {
              graphicsRenderer.begin({target:target.object,loadOp:pass.loadOp,storeOp:pass.storeOp,...(Object.hasOwn(pass,'clearColor') ? {clearColor:pass.clearColor} : {})});
              for (const draw of draws) graphicsRenderer.draw(draw);
              await graphicsRenderer.end();
            } catch (error) { if (graphicsRenderer.getStats().state === 'open') graphicsRenderer.abort(); throw error; }
            report.graphicsPasses++; report.graphicsDraws += draws.length; break;
          }
          case OP.GRAPHICS_READBACK: {
            if (!allowGraphics) fail('graphics not negotiated');
            exact(4); const target = get(v.getUint32(0,true), 'graphics-target');
            const stagingSize = report.backend === 'webgl2' ? target.width*target.height*4 : Math.ceil(target.width*4/256)*256*target.height;
            if (allocation + stagingSize > 16*1024*1024) fail('graphics staging exceeds budget', -12);
            body = (await graphicsRenderer.readback(target.object)).pixels; report.graphicsReadbacks++; break;
          }
          case OP.DESTROY: {
            exact(4); const id = v.getUint32(0, true), resource = resources.get(id); if (!resource) fail('unknown resource');
            if (resource.graphics && resource.kind !== 'graphics-shader') await graphicsRenderer.destroy(resource.object);
            else resource.object.destroy?.();
            resources.delete(id); allocation -= resource.bytes; report.released++; break;
          }
          case OP.CLOSE: exact(0); break;
        }
      } catch (error) {
        status = lost || closed || error.status === -19 ? -19 : error.status === -5 ? -5 : error.status === -12 ? -12 : -22;
        terminal = status === -19 || status === -5;
        if (terminal) report.error ??= String(error.message);
        body = encoder.encode(String(error.message)).slice(0, 512);
      }
      await connection.write(encodeReply(opcode, request, status, body)); report.commands++;
      onEvent({ type: 'command', opcode, request, status });
      if (opcode === OP.CLOSE || terminal) break;
    }
  } catch (error) { report.error ??= error.message; }
  finally { clearTimeout(timer); cleanup(); onEvent({ type: 'closed', ...report }); }
  return report;
}
