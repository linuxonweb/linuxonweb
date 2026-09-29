import { serveGPU, createWebGLContextLease } from '../guest-gpu/host.mjs';

/** Real guest fixture adapter; independent native ownership before emergency cleanup. */
export async function serveFallback(connection, backend, onEvent, options = {}) {
  if (!['webgl2', 'webgpu'].includes(backend)) throw Error('unknown requested test backend');
  const workers = new Set(), devices = new Set(), buffers = new Set(), textures = new Set(), contexts = new Set(), glObjects = new Map();
  const counts = { workersCreated: 0, workersTerminated: 0, devicesCreated: 0, devicesDestroyed: 0,
    buffersCreated: 0, buffersDestroyed: 0, texturesCreated: 0, texturesDestroyed: 0,
    contextsCreated: 0, contextsClosed: 0, connectionsClosed: 0, submits: 0, adapterRequests: 0, gl: {} };
  const NativeWorker = globalThis.Worker;
  const workerURLs = new Set([new URL('./translator/worker.mjs', import.meta.url).href,
    new URL('../guest-vulkan-graphics/translator/worker.mjs', import.meta.url).href]);
  class ObservedWorker extends NativeWorker {
    constructor(url, options) { super(url, options); if (workerURLs.has(new URL(String(url), location.href).href)) { workers.add(this); counts.workersCreated++; } }
    terminate() { if (workers.delete(this)) counts.workersTerminated++; super.terminate(); }
  }
  globalThis.Worker = ObservedWorker;
  const tracked = (object, set, kind) => {
    set.add(object); counts[kind + 'Created']++; const destroy = object.destroy.bind(object);
    object.destroy = () => { if (set.delete(object)) { counts[kind + 'Destroyed']++; destroy(); } }; return object;
  };
  const nativeGPU = navigator.gpu;
  const gpu = backend === 'webgl2' ? null : nativeGPU && { async requestAdapter(options) {
    counts.adapterRequests++;
    const adapter = await nativeGPU.requestAdapter(options); if (!adapter) return null;
    return { info: adapter.info, isFallbackAdapter: adapter.isFallbackAdapter, async requestDevice(descriptor) {
      const device = tracked(await adapter.requestDevice(descriptor), devices, 'devices');
      const makeBuffer = device.createBuffer.bind(device), makeTexture = device.createTexture.bind(device), submit = device.queue.submit.bind(device.queue);
      device.createBuffer = (...args) => tracked(makeBuffer(...args), buffers, 'buffers');
      device.createTexture = (...args) => tracked(makeTexture(...args), textures, 'textures');
      device.queue.submit = (...args) => { counts.submits++; return submit(...args); }; return device;
    } };
  } };
  function contextFactory() {
    const lease = createWebGLContextLease(), gl = lease.gl;
    contexts.add(lease); counts.contextsCreated++;
    for (const kind of ['Buffer', 'Texture', 'Framebuffer', 'VertexArray', 'Program', 'Shader', 'Sync']) {
      counts.gl[kind] ??= { created: 0, deleted: 0 };
      const createName = kind === 'Sync' ? 'fenceSync' : 'create' + kind, deleteName = 'delete' + kind;
      const create = gl[createName].bind(gl), destroy = gl[deleteName].bind(gl);
      gl[createName] = (...args) => { const object = create(...args); if (object) { glObjects.set(object, { gl, kind }); counts.gl[kind].created++; } return object; };
      gl[deleteName] = object => { if (glObjects.delete(object)) counts.gl[kind].deleted++; return destroy(object); };
    }
    const close = lease.close.bind(lease);
    lease.close = () => { if (contexts.delete(lease)) { counts.contextsClosed++; close(); } };
    return lease;
  }
  let closed = false, cleaned = false;
  const transport = { readExactly: n => connection.readExactly(n), write: bytes => connection.write(bytes), close() {
    if (!closed) { closed = true; counts.connectionsClosed++; connection.close(); }
  } };
  window.guestWebGLCleanup = () => {
    if (cleaned) return; cleaned = true; transport.close();
    for (const worker of workers) worker.terminate();
    for (const [object, { gl, kind }] of glObjects) gl['delete' + kind](object);
    for (const context of contexts) context.close();
    for (const buffer of buffers) buffer.destroy(); for (const texture of textures) texture.destroy(); for (const device of devices) device.destroy();
    if (globalThis.Worker === ObservedWorker) globalThis.Worker = NativeWorker;
  };
  try {
    const host = await serveGPU(transport, { gpu, allowGraphics: true, allowWebGL: true, allowUniforms: !!options.allowUniforms, timeoutMs: 120000, onEvent,
      graphicsTranslatorOptions: { url: new URL('./candidate/wgsl.wasm', import.meta.url), sha256: 'f1df22534091d4c00fab4884e970c03040c7fc1c9353d29c8421e186758d4542' },
      webglTranslatorOptions: { url: new URL('./candidate/glsl.wasm', import.meta.url), sha256: '31d062e7582ab95333cab7eb87c11b031e481ccd30c5ba5b6498aad04a6aa0bd' }, webglContextFactory: contextFactory });
    return { ...host, ownership: { ...counts, gl: structuredClone(counts.gl), liveWorkers: workers.size, liveDevices: devices.size,
      liveBuffers: buffers.size, liveTextures: textures.size, liveContexts: contexts.size, liveGL: glObjects.size, beforeEmergencyCleanup: !cleaned } };
  } finally { if (globalThis.Worker === ObservedWorker) globalThis.Worker = NativeWorker; }
}
