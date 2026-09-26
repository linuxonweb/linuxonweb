// Experimental guest-command renderer. Not imported by the accepted runtime.
export const MAGIC = 0x31555047, VERSION = 1, MAX_PAYLOAD = 1048576;
export const OP = Object.freeze({ HELLO: 0, SHADER: 1, BUFFER: 2, PIPELINE: 3, TARGET: 4, DRAW: 5, READBACK: 6, DESTROY: 7, CLOSE: 8, CLEAR: 9 });
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const fail = message => { throw new Error(message); };
const words = (...values) => { const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer); values.forEach((n, i) => view.setUint32(i * 4, n, true)); return bytes; };
export function decodeHeader(bytes, allowClear = false) {
  if (bytes.byteLength !== 16) fail('short header');
  const v = new DataView(bytes.buffer, bytes.byteOffset, 16);
  if (v.getUint32(0, true) !== MAGIC || v.getUint16(4, true) !== VERSION) fail('unsupported protocol');
  const opcode = v.getUint16(6, true), request = v.getUint32(8, true), length = v.getUint32(12, true);
  if (opcode > (allowClear ? OP.CLEAR : OP.CLOSE) || !request || length > MAX_PAYLOAD) fail('invalid opcode, sequence or length');
  return { opcode, request, length };
}
export function encodeReply(opcode, request, status, body = new Uint8Array()) {
  const result = new Uint8Array(20 + body.byteLength), v = new DataView(result.buffer);
  v.setUint32(0, MAGIC, true); v.setUint16(4, VERSION, true); v.setUint16(6, opcode | 0x8000, true);
  v.setUint32(8, request, true); v.setUint32(12, 4 + body.byteLength, true); v.setInt32(16, status, true);
  result.set(body, 20); return result;
}

/** One device and resource table per connection. No guest memory/shared views. */
export async function serveGPU(connection, { gpu = globalThis.navigator?.gpu, timeoutMs = 60000, onEvent = () => {}, allowClear = false } = {}) {
  const resources = new Map(); let device, lost = false, closed = false, nextId = 1, allocation = 0, lastRequest = 0;
  const report = { commands: 0, draws: 0, clears: 0, readbacks: 0, released: 0, adapter: null, error: null };
  const cleanup = () => {
    if (closed) return; closed = true;
    for (const entry of resources.values()) entry.object.destroy?.();
    report.released += resources.size; resources.clear(); allocation = 0;
    device?.destroy(); connection.close();
  };
  const timer = setTimeout(() => { report.error = 'session deadline'; cleanup(); }, timeoutMs);
  const add = (kind, object, bytes = 0, extra = {}) => {
    if (closed || nextId > 0xffffffff || resources.size >= 64 || allocation + bytes > 16 * 1024 * 1024) { object.destroy?.(); fail('resource budget exceeded'); }
    const id = nextId++; resources.set(id, { kind, object, bytes, ...extra }); allocation += bytes;
    return new Uint8Array(words(id).buffer);
  };
  const get = (id, kind) => { const r = resources.get(id); if (!r || r.kind !== kind) fail('unknown resource or wrong type'); return r; };
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
    if (!gpu) fail('WebGPU unavailable: no renderer fallback is implied');
    const adapter = await gpu.requestAdapter(); if (!adapter || closed) fail('WebGPU adapter unavailable');
    report.adapter = { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, description: adapter.info?.description,
      isFallbackAdapter: adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null };
    device = await adapter.requestDevice(); if (closed) { device.destroy(); fail('session closed'); }
    device.lost.then(info => { if (!closed) { lost = true; report.error = `device lost: ${info.message}`; cleanup(); } });
    onEvent({ type: 'adapter', ...report.adapter });
    while (!closed) {
      const header = await connection.readExactly(16); if (!header.length) break;
      const { opcode, request, length } = decodeHeader(header, allowClear);
      if (request <= lastRequest) fail('non-monotonic request id'); lastRequest = request;
      const payload = await connection.readExactly(length); if (payload.length !== length) fail('truncated payload');
      const v = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      const exact = n => { if (length !== n) fail('invalid payload length'); };
      let body = new Uint8Array(), status = 0;
      try {
        switch (opcode) {
          case OP.HELLO: exact(0); body = encoder.encode(JSON.stringify({ version: VERSION, maxResources: 64, maxTarget: 512, shader: 'WGSL', ...(allowClear ? { clearImage: true } : {}), adapter: report.adapter })); break;
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
          case OP.DESTROY: {
            exact(4); const id = v.getUint32(0, true), resource = resources.get(id); if (!resource) fail('unknown resource');
            resource.object.destroy?.(); resources.delete(id); allocation -= resource.bytes; report.released++; break;
          }
          case OP.CLOSE: exact(0); break;
        }
      } catch (error) { status = lost ? -19 : -22; body = encoder.encode(String(error.message).slice(0, 512)); }
      await connection.write(encodeReply(opcode, request, status, body)); report.commands++;
      onEvent({ type: 'command', opcode, request, status });
      if (opcode === OP.CLOSE) break;
    }
  } catch (error) { report.error ??= error.message; }
  finally { clearTimeout(timer); cleanup(); onEvent({ type: 'closed', ...report }); }
  return report;
}
