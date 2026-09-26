import { createWebGLRenderer } from './modules/guest-vulkan-webgl/renderer.mjs';
import { createGraphicsRenderer } from './modules/guest-vulkan-graphics/renderer.mjs';
const report = { pass: false, cases: [], negatives: [], ownership: [], failures: [] };
let checks = 0;
function check(value, message) { checks++; if (!value) throw Error(message); }
async function rejects(action, label, code = 'validation') {
  let error; try { await action(); } catch (caught) { error = caught; }
  check(error?.code === code, `${label}: expected ${code}, got ${error?.stack ?? 'success'}`);
  report.negatives.push(label);
}
const contexts = [], renderers = [];
function context(noProvoking = false) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { antialias: false, depth: false, stencil: false });
  check(!!gl, 'WebGL2 available');
  const live = new Map(), counts = {}, original = {}, calls = { clear: 0, draw: 0 };
  for (const kind of ['Buffer', 'Texture', 'Framebuffer', 'VertexArray', 'Program', 'Shader', 'Sync']) {
    const createName = kind === 'Sync' ? 'fenceSync' : 'create' + kind, deleteName = 'delete' + kind;
    const create = gl[createName].bind(gl), destroy = gl[deleteName].bind(gl);
    counts[kind] = { created: 0, deleted: 0 };
    gl[createName] = (...args) => { const object = create(...args); if (object) { live.set(object, kind); counts[kind].created++; } return object; };
    gl[deleteName] = object => { if (live.has(object)) { live.delete(object); counts[kind].deleted++; } return destroy(object); };
  }
  for (const name of ['getError', 'clientWaitSync', 'clear', 'drawArrays', 'drawElements']) original[name] = gl[name].bind(gl);
  gl.clear = (...args) => { calls.clear++; return original.clear(...args); };
  gl.drawArrays = (...args) => { calls.draw++; return original.drawArrays(...args); };
  gl.drawElements = (...args) => { calls.draw++; return original.drawElements(...args); };
  if (noProvoking) {
    const getExtension = gl.getExtension.bind(gl);
    gl.getExtension = name => name === 'WEBGL_provoking_vertex' ? null : getExtension(name);
  }
  const entry = { gl, live, counts, original, calls }; contexts.push(entry); return entry;
}
function renderer(entry, options) { const value = createWebGLRenderer(entry.gl, options); renderers.push(value); return value; }
function balanced(entry, label) {
  check(entry.live.size === 0, label + ' independent native live zero');
  for (const [kind, counts] of Object.entries(entry.counts)) check(counts.created === counts.deleted, `${label} ${kind} balance`);
  report.ownership.push({ label, liveBeforeEmergencyCleanup: entry.live.size, counts: structuredClone(entry.counts) });
}
const positions = [[-.83, -.66], [.79, -.28], [-.17, .87]], colors = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const viewport = { x: 7, y: 5, width: 57, height: 39 }, scissor = { x: 10, y: 8, width: 49, height: 30 };
const layouts = {
  interleaved: [{ stride: 20, attributes: [{ location: 0, offset: 0, format: 'float32x2' }, { location: 1, offset: 8, format: 'float32x3' }] }],
  separate: [{ stride: 12, attributes: [{ location: 1, offset: 0, format: 'float32x3' }] }, { stride: 8, attributes: [{ location: 0, offset: 0, format: 'float32x2' }] }]
};
function descriptor(vertex = 'pair-a.vert', fragment = 'pair-a.frag', layout = 'interleaved') {
  return structuredClone({ vertex: TRANSLATIONS[vertex], fragment: TRANSLATIONS[fragment], vertexBuffers: layouts[layout] });
}
const dataFor = layout => layout === 'interleaved' ? [positions.flatMap((p, i) => [...p, ...colors[i]])] : [colors.flat(), positions.flat()];
const byteView = values => new Uint8Array(new Float32Array(values).buffer);
const vertices = ['pair-a.vert', 'pair-b.vert', 'clip-negative.vert', 'clip-far.vert', 'perspective.vert', 'flat.vert'];
const fragmentsFor = vertex => vertex === 'flat.vert' ? ['flat.frag'] : vertex.startsWith('pair-') ?
  ['pair-a.frag', 'pair-b.frag', 'fragcoord.frag'] : vertex === 'perspective.vert' ? ['pair-a.frag', 'fragcoord.frag'] : ['pair-a.frag'];
function pixels(result, vertex, fragment, label, flatColor = [1, 0, 0]) {
  check(result.width === 73 && result.height === 51 && result.rowOrder === 'top-to-bottom', label + ' readback contract');
  const triangle = positions.map(([x, y]) => vertex === 'pair-b.vert' ? [x * .5 + .25, y * .75 - .1] : [x, y])
    .map(([x, y]) => [viewport.x + (x + 1) * viewport.width / 2, viewport.y + (y + 1) * viewport.height / 2]);
  const [[ax, ay], [bx, by], [cx, cy]] = triangle, denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  const weights = positions.map(([x]) => vertex === 'perspective.vert' ? 1.5 + .5 * x : 1);
  const clipped = vertex.startsWith('clip-'); let interior = 0, exterior = 0, skipped = 0;
  for (let y = 0; y < 51; y++) for (let x = 0; x < 73; x++) {
    const a = ((by - cy) * (x + .5 - cx) + (cx - bx) * (y + .5 - cy)) / denominator;
    const b = ((cy - ay) * (x + .5 - cx) + (ax - cx) * (y + .5 - cy)) / denominator, bary = [a, b, 1 - a - b];
    const inside = x >= scissor.x && x < scissor.x + scissor.width && y >= scissor.y && y < scissor.y + scissor.height;
    let expected, tolerance;
    if (!clipped && inside && Math.min(...bary) > .045) {
      const divisor = bary.reduce((sum, value, i) => sum + value / weights[i], 0);
      if (fragment === 'fragcoord.frag') expected = [(x + .5) / 73, (y + .5) / 51, vertex === 'pair-b.vert' ? .75 : .25, divisor].map(value => Math.round(value * 255));
      else {
        expected = fragment === 'flat.frag' ? flatColor.map(value => Math.round(value * 255)) : bary.map((value, i) => Math.round(255 * value / weights[i] / divisor));
        if (fragment === 'pair-b.frag') expected.reverse(); expected.push(255);
      }
      tolerance = 2; interior++;
    } else if (clipped || !inside || Math.min(...bary) < -.045) { expected = [0, 255, 0, 255]; tolerance = 0; exterior++; }
    else { skipped++; continue; }
    const offset = (y * 73 + x) * 4;
    check(expected.every((value, channel) => Math.abs(value - result.pixels[offset + channel]) <= (channel === 3 && fragment !== 'fragcoord.frag' ? 0 : tolerance)), `${label} pixel ${x},${y}`);
  }
  check(clipped ? exterior === 3723 : interior > 30 && exterior > 1500, label + ' coverage');
  report.cases.push({ label, interior, exterior, skipped });
}
async function simpleTarget(r) {
  const target = await r.createTarget({ width: 4, height: 3 });
  r.begin({ target, loadOp: 'clear', storeOp: 'store', clearColor: [1, 0, 0, 1] });
  await r.end(); return target;
}
async function run() {
  const main = context(), r = renderer(main);
  const debug = main.gl.getExtension('WEBGL_debug_renderer_info');
  report.renderer = debug ? main.gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : main.gl.getParameter(main.gl.RENDERER);
  report.provokingExtension = !!main.gl.getExtension('WEBGL_provoking_vertex');
  const bad = descriptor(); bad.vertex.glsl = '#version 300 es\n this is invalid';
  await rejects(() => r.createPipeline(bad), 'compile failure recovers');
  balanced(main, 'failed pipeline');
  const wrong = descriptor(); wrong.fragment = structuredClone(TRANSLATIONS['mismatch.frag']);
  await rejects(() => r.createPipeline(wrong), 'interface mismatch');
  const stride = descriptor(); stride.vertexBuffers[0].stride = 256;
  await rejects(() => r.createPipeline(stride), 'WebGL stride restriction');
  for (const vertex of vertices) {
    for (const fragment of fragmentsFor(vertex)) {
      for (const layout of ['interleaved', 'separate']) {
        const label = `${vertex}/${fragment}/${layout}`, mutable = descriptor(vertex, fragment, layout);
        const pending = r.createPipeline(mutable); mutable.vertex.glsl = 'mutated'; mutable.vertexBuffers[0].stride = 0;
        const pipeline = await pending, target = await r.createTarget({ width: 73, height: 51 }), buffers = [];
        for (const values of dataFor(layout)) buffers.push(await r.createVertexBuffer({ size: values.length * 4 }));
        await rejects(() => r.readback(target), label + ' uninitialized readback');
        r.begin({ target, loadOp: 'load', storeOp: 'store' });
        await rejects(() => r.end(), label + ' uninitialized load');
        const clear = [0, 1, 0, 1]; r.begin({ target, loadOp: 'clear', storeOp: 'store', clearColor: clear }); clear[0] = 1;
        const draw = { pipeline, vertexBuffers: buffers.map(buffer => ({ buffer })), vertexCount: 3,
          viewport: { ...viewport }, scissor: { ...scissor } };
        if (label === 'pair-a.vert/pair-a.frag/interleaved') {
          await rejects(() => r.draw({ ...draw, viewport: { ...viewport, x: 7.5 } }), 'fractional viewport restriction');
          await rejects(() => r.draw({ ...draw, vertexCount: 6 }), 'vertex range');
        }
        r.draw(draw); draw.vertexCount = 6; draw.vertexBuffers[0].offset = 400; draw.viewport.x = 0;
        // The queued pass must read post-record uploads, and upload must copy bytes.
        for (const [index, values] of dataFor(layout).entries()) {
          const bytes = byteView(values), upload = r.uploadVertexBuffer(buffers[index], 0, bytes); bytes.fill(0); await upload;
        }
        await r.end(); const result = await r.readback(target); pixels(result, vertex, fragment, label);
        r.begin({ target, loadOp: 'load', storeOp: 'store' }); await r.end();
        const retained = await r.readback(target); check(retained.pixels.every((value, i) => value === result.pixels[i]), label + ' LOAD preservation');
        // A later stale draw invalidates the entire pass before even its clear.
        const stale = await r.createPipeline(descriptor(vertex, fragment, layout));
        r.begin({ target, loadOp: 'clear', storeOp: 'store', clearColor: [1, 0, 1, 1] });
        const stableDraw = { pipeline, vertexBuffers: buffers.map(buffer => ({ buffer })), vertexCount: 3 };
        r.draw(stableDraw); r.draw({ ...stableDraw, pipeline: stale }); await r.destroy(stale);
        const counts = { ...main.calls }; await rejects(() => r.end(), label + ' whole pass stale rejection');
        check(main.calls.clear === counts.clear && main.calls.draw === counts.draw, label + ' zero native effects before rejection');
        const after = await r.readback(target); check(after.pixels.every((value, i) => value === result.pixels[i]), label + ' rejected pass retains pixels');
        for (const handle of [pipeline, ...buffers, target]) await r.destroy(handle);
        check(r.getStats().resources === 0 && r.getStats().allocatedBytes === 0 && r.getStats().nativeObjects === 0, label + ' zero renderer resources');
      }
    }
  }
  const buffers = [];
  for (let i = 0; i < 64; i++) buffers.push(await r.createVertexBuffer({ size: 4 }));
  await rejects(() => r.createVertexBuffer({ size: 4 }), 'resource budget', 'budget');
  for (const buffer of buffers) await r.destroy(buffer);
  const targets = [];
  for (let i = 0; i < 16; i++) targets.push(await r.createTarget({ width: 512, height: 512 }));
  await rejects(() => r.createTarget({ width: 1, height: 1 }), 'byte budget', 'budget');
  r.begin({ target: targets[0], loadOp: 'clear', storeOp: 'store', clearColor: [0, 0, 0, 1] }); await r.end();
  await rejects(() => r.readback(targets[0]), 'staging budget', 'budget');
  await r.destroy(targets.pop()); check((await r.readback(targets[0])).pixels.length === 512 * 512 * 4, 'staging budget recovery');
  for (const target of targets) await r.destroy(target);
  r.close(); r.close(); balanced(main, 'normal close');
  check(r.getStats().state === 'closed' && r.getStats().pendingWaits === 0, 'closed state');
  const flatContext = context(true), flatRenderer = renderer(flatContext);
  const flatPipeline = await flatRenderer.createPipeline(descriptor('flat.vert', 'flat.frag'));
  const flatTarget = await flatRenderer.createTarget({ width: 73, height: 51 });
  const flatBuffer = await flatRenderer.createVertexBuffer({ size: 120 });
  const originalTriangle = positions.flatMap((p, i) => [...p, ...colors[i]]);
  for (const multiple of [false, true]) {
    const lastColors = [[1, 0, 1], [1, 1, 0], [0, 1, 1]];
    const second = multiple ? positions.flatMap((p, i) => [...p, ...lastColors[i]]) : originalTriangle;
    await flatRenderer.uploadVertexBuffer(flatBuffer, 0, byteView([...originalTriangle, ...second]));
    flatRenderer.begin({ target: flatTarget, loadOp: 'clear', storeOp: 'store', clearColor: [0, 1, 0, 1] });
    flatRenderer.draw({ pipeline: flatPipeline, vertexBuffers: [{ buffer: flatBuffer }], vertexCount: multiple ? 6 : 3,
      firstVertex: multiple ? 0 : 3, viewport, scissor });
    await flatRenderer.end();
    pixels(await flatRenderer.readback(flatTarget), 'flat.vert', 'flat.frag', multiple ? 'flat-fallback/two-primitives' : 'flat-fallback/firstVertex3', multiple ? lastColors[0] : colors[0]);
  }
  check(flatRenderer.getStats().indexDraws === 2, 'base WebGL uses bounded index rotation');
  for (const handle of [flatPipeline, flatTarget, flatBuffer]) await flatRenderer.destroy(handle);
  flatRenderer.close(); balanced(flatContext, 'flat index fallback');
  for (const mode of ['pending-close', 'pending-loss', 'fence-timeout', 'execution-error', 'execution-oom']) {
    const entry = context(), test = renderer(entry, { fenceTimeoutMs: mode === 'fence-timeout' ? 100 : 2000 });
    const target = await simpleTarget(test);
    if (mode.startsWith('execution-')) {
      let inject = false;
      entry.gl.clear = (...args) => { const value = entry.original.clear(...args); inject = true; return value; };
      entry.gl.getError = () => { if (inject) { inject = false; return mode === 'execution-oom' ? entry.gl.OUT_OF_MEMORY : entry.gl.INVALID_OPERATION; } return entry.original.getError(); };
      test.begin({ target, loadOp: 'clear', storeOp: 'store', clearColor: [0, 1, 0, 1] });
      await rejects(() => test.end(), mode + ' after effects is terminal', 'gpu');
      check(test.getStats().state === 'failed', 'failed state after execution error');
    } else {
      entry.gl.clientWaitSync = () => entry.gl.TIMEOUT_EXPIRED;
      const readback = test.readback(target);
      // Attach rejection handling before triggering loss/close.
      const expected = rejects(() => readback, mode, mode === 'fence-timeout' ? 'gpu' : 'unavailable');
      await new Promise(resolve => setTimeout(resolve, 10));
      check(test.getStats().pendingWaits === 1, mode + ' confirmed live fence wait');
      if (mode === 'pending-close') test.close();
      if (mode === 'pending-loss') {
        const lose = entry.gl.getExtension('WEBGL_lose_context'); check(!!lose, 'context loss extension'); lose.loseContext();
      }
      await expected;
      check(test.getStats().state === (mode === 'pending-close' ? 'closed' : mode === 'pending-loss' ? 'lost' : 'failed'), mode + ' terminal state');
    }
    check(test.getStats().pendingWaits === 0 && test.getStats().allocatedBytes === 0 && test.getStats().resources === 0, mode + ' no pending ownership');
    await rejects(() => test.readback(target), mode + ' no reuse', 'unavailable');
    test.close(); balanced(entry, mode);
  }
  // The same supplied SPIR-V is translated independently for WebGPU. Reusing
  // the unchanged oracle also checks the shared pipeline validator refactor.
  check(!!navigator.gpu, 'WebGPU regression API');
  const adapter = await navigator.gpu.requestAdapter(); check(!!adapter, 'WebGPU regression adapter');
  report.webgpuAdapter = { description: adapter.info?.description, isFallbackAdapter: adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null };
  const device = await adapter.requestDevice(), gpuLive = new Set(), gpuCounts = { created: 0, destroyed: 0 };
  for (const method of ['createBuffer', 'createTexture']) {
    const create = device[method].bind(device);
    device[method] = (...args) => {
      const object = create(...args), destroy = object.destroy.bind(object); gpuLive.add(object); gpuCounts.created++;
      object.destroy = () => { if (gpuLive.delete(object)) { gpuCounts.destroyed++; destroy(); } }; return object;
    };
  }
  const gpuRenderer = createGraphicsRenderer(device); renderers.push(gpuRenderer);
  try {
    for (const vertex of vertices) {
      for (const fragment of fragmentsFor(vertex)) {
        for (const layout of ['interleaved', 'separate']) {
          const pipeline = await gpuRenderer.createPipeline({ vertex: WGSL_TRANSLATIONS[vertex], fragment: WGSL_TRANSLATIONS[fragment], vertexBuffers: layouts[layout] });
          const target = await gpuRenderer.createTarget({ width: 73, height: 51 }), buffers = [];
          for (const values of dataFor(layout)) {
            const buffer = await gpuRenderer.createVertexBuffer({ size: values.length * 4 }); buffers.push(buffer);
            await gpuRenderer.uploadVertexBuffer(buffer, 0, byteView(values));
          }
          gpuRenderer.begin({ target, loadOp: 'clear', storeOp: 'store', clearColor: [0, 1, 0, 1] });
          gpuRenderer.draw({ pipeline, vertexBuffers: buffers.map(buffer => ({ buffer })), vertexCount: 3, viewport, scissor });
          await gpuRenderer.end(); pixels(await gpuRenderer.readback(target), vertex, fragment, 'webgpu/' + vertex + '/' + fragment + '/' + layout);
          for (const handle of [pipeline, ...buffers, target]) await gpuRenderer.destroy(handle);
        }
      }
    }
    check(gpuLive.size === 0 && gpuCounts.created === gpuCounts.destroyed, 'WebGPU normal cleanup before emergency');
    report.webgpuOwnership = { ...gpuCounts, liveBeforeEmergencyCleanup: gpuLive.size };
  } finally { gpuRenderer.close(); for (const object of gpuLive) object.destroy(); device.destroy(); }
  report.pass = true;
}
window.rendererGate = run().catch(error => { report.failures.push(String(error.stack || error)); }).finally(() => {
  report.checks = checks;
  report.liveBeforeEmergencyCleanup = contexts.map(entry => entry.live.size);
  for (const r of renderers) r.close();
  for (const entry of contexts) entry.gl.getExtension('WEBGL_lose_context')?.loseContext();
  document.getElementById('result').textContent = JSON.stringify(report);
  window.rendererReport = report;
}).then(() => report);
