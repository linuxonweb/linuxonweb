const report = window.graphicsQa = { pass: false, checks: 0, errors: [], rejections: [], rounds: [],
  ownership: { workersCreated: 0, workersTerminated: 0, devicesCreated: 0, devicesDestroyed: 0,
    buffersCreated: 0, buffersDestroyed: 0, texturesCreated: 0, texturesDestroyed: 0, nativeSubmits: 0, nativeEncoders: 0 },
  scope: 'Dedicated Worker translation and real WebGPU graphics; no Linux guest or physical GPU claim',
  untested: ['negative clip-depth and non-unit clip-w', 'injected device/transport loss', 'close during pending native work',
    'resource exhaustion', 'guest Vulkan integration', 'WebGL fallback', 'presentation API', 'Firefox'] };
const digest = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), b => b.toString(16).padStart(2, '0')).join('');
function check(ok, label) { report.checks++; if (!ok) throw Error(label); }
async function rejects(action, name) {
  try { await action(); } catch (error) { report.rejections.push({ name, error: String(error) }); report.checks++; return; }
  throw Error('expected rejection: ' + name);
}
async function load(url, sha256, limit = 262144) {
  const response = await fetch(url, { cache: 'no-store' });
  check(response.ok, 'fetch ' + url);
  const data = await response.arrayBuffer();
  check(data.byteLength <= limit, 'bounded fetch ' + url);
  check(await digest(data) === sha256, 'SHA-256 ' + url);
  return new Uint8Array(data);
}
const width = 73, height = 51;
const positions = [[-.8, -.7], [.2, -.6], [-.5, .6]];
const clear = [0, 255, 0, 255], red = [255, 0, 0, 255], blue = [0, 0, 255, 255];
const interleaved = [{ stride: 20, attributes: [{ location: 0, offset: 0, format: 'float32x2' }, { location: 1, offset: 8, format: 'float32x3' }] }];
const separate = [{ stride: 8, attributes: [{ location: 0, offset: 0, format: 'float32x2' }] },
  { stride: 12, attributes: [{ location: 1, offset: 0, format: 'float32x3' }] }];
const viewport = { x: 0, y: 0, width, height, minDepth: 0, maxDepth: 1 };
function triangle(kind, view = viewport) {
  // Independent Vulkan positive-height viewport oracle: framebuffer Y increases
  // with original Vulkan clip Y. No emitted WGSL or renderer math is inspected.
  return positions.map(([x, y]) => {
    if (kind === 'b') { x = x * .5 + .25; y = y * .75 - .1; }
    return [view.x + (x + 1) * view.width / 2, view.y + (y + 1) * view.height / 2];
  });
}
function weights(x, y, tri) {
  const [[ax, ay], [bx, by], [cx, cy]] = tri;
  const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  const a = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / denominator;
  const b = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / denominator;
  return [a, b, 1 - a - b];
}
const pixel = (pixels, x, y) => Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
function sample(pixels, x, y, expected, name) {
  const actual = pixel(pixels, x, y);
  check(equal(actual, expected), `${name} pixel(${x},${y}): ${actual} != ${expected}`);
  return { x, y, expected, actual };
}
function verify(readback, vertex, fragment, view = viewport, scissor = null) {
  check(readback.width === width && readback.height === height && readback.rowOrder === 'top-to-bottom' &&
    readback.pixels.length === width * height * 4, 'unpadded 73x51 top-to-bottom RGBA readback');
  const points = [], tri = triangle(vertex, view);
  let inside = 0, outside = 0;
  for (let y = 2; y < height; y += 4) for (let x = 2; x < width; x += 4) {
    const minimum = Math.min(...weights(x + .5, y + .5, tri));
    if (minimum > -.12 && minimum < .09) continue; // Never assert rasterization at an edge.
    const inScissor = !scissor || x >= scissor.x && y >= scissor.y && x < scissor.x + scissor.width && y < scissor.y + scissor.height;
    const covered = minimum >= .09 && inScissor;
    covered ? inside++ : outside++;
    points.push(sample(readback.pixels, x, y, covered ? fragment === 'a' ? red : blue : clear, 'safe landmark'));
  }
  check(inside >= 2 && outside >= 20, 'oracle includes interior and clear regions');
  return { inside, outside, points, triangle: tri };
}

document.querySelector('#run').onclick = async () => {
  document.querySelector('#run').disabled = true;
  let translator, renderer, device;
  const NativeWorker = globalThis.Worker, ownedWorkers = new Set(), nativeBuffers = new Set(), nativeTextures = new Set();
  const counts = report.ownership;
  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    renderer?.close(); translator?.close();
    for (const worker of ownedWorkers) worker.terminate();
    for (const buffer of nativeBuffers) buffer.destroy();
    for (const texture of nativeTextures) texture.destroy();
    device?.destroy();
    globalThis.Worker = NativeWorker;
  }
  window.graphicsQaCleanup = cleanup;
  try {
    check(crossOriginIsolated, 'cross-origin isolation');
    check(document.visibilityState === 'visible', 'foreground page');
    report.isolated = crossOriginIsolated; report.visibility = document.visibilityState;
    const expected = new URLSearchParams(location.search).get('manifest');
    check(/^[a-f0-9]{64}$/.test(expected ?? ''), 'runner-pinned manifest');
    const manifest = JSON.parse(new TextDecoder().decode(await load('./qa-inputs.json', expected)));
    check(manifest.schema === 1 && manifest.testOnly === true, 'frozen test manifest');
    report.manifest = manifest;
    const required = ['qa.html', 'qa.mjs', 'renderer.mjs', 'translator/index.mjs', 'translator/worker.mjs', 'translator/abi.mjs', 'run-browser.mjs', 'prepare-qa.py'];
    for (const name of required) check(!!manifest.sources[name], 'required source pin ' + name);
    for (const [name, identity] of Object.entries(manifest.sources)) {
      check(/^[\w./-]+$/.test(name) && !name.includes('..') && !name.startsWith('/'), 'safe source path');
      const data = await load('./' + name, identity.sha256);
      check(data.length === identity.bytes, 'source byte length');
    }
    for (const [name, sha256] of Object.entries(manifest.provenance)) {
      check(['build.json', 'translator-source-lock.json', 'fixtures.json'].includes(name), 'provenance path');
      await load('./' + name, sha256, 16 * 1024 * 1024);
    }
    const { createGraphicsTranslator } = await import('./translator/index.mjs');
    const { createGraphicsRenderer } = await import('./renderer.mjs');
    globalThis.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); ownedWorkers.add(this); counts.workersCreated++; }
      terminate() { if (ownedWorkers.delete(this)) { counts.workersTerminated++; super.terminate(); } }
    };
    const translatorUrl = new URL('./translator.wasm', location.href);
    await rejects(() => createGraphicsTranslator({ url: translatorUrl, sha256: '0'.repeat(64) }), 'translator artifact hash mismatch');
    check(counts.workersCreated === 0, 'hash rejection precedes worker creation');
    translator = await createGraphicsTranslator({ url: translatorUrl, sha256: manifest.translator.sha256 });
    const supplied = {}, translated = {};
    for (const [name, fixture] of Object.entries(manifest.fixtures)) {
      check(/^shaders\/[\w.-]+\.spv$/.test(fixture.url), 'safe shader path');
      supplied[name] = await load('./' + fixture.url, fixture.sha256, 65536);
    }
    for (const name of ['pair-a.vert', 'pair-a.frag', 'pair-b.vert', 'pair-b.frag', 'mismatch.frag']) {
      const fixture = manifest.fixtures[name];
      translated[name] = await translator.translate(supplied[name], { stage: fixture.stage, entryPoint: fixture.entryPoint });
      check(translated[name].originalEntryPoint === fixture.entryPoint, 'original shader entry preserved');
    }
    report.translation = {};
    for (const [name, value] of Object.entries(translated)) report.translation[name] = { ...value,
      wgslSha256: await digest(new TextEncoder().encode(value.wgsl)) };
    check(translated['pair-a.vert'].entryPoint !== translated['pair-a.vert'].originalEntryPoint, 'punctuated vertex entry remapped');
    check(translated['pair-b.frag'].entryPoint !== 'if', 'reserved fragment entry remapped');
    await rejects(() => translator.translate(supplied['pair-a.vert'], { stage: 'fragment' }), 'requested stage mismatch');
    await rejects(() => translator.translate(supplied['pair-a.vert'], { entryPoint: 'wrong' }), 'original entry mismatch');
    await rejects(() => translator.translate(supplied['resource.frag']), 'unsupported shader resource');
    const malformed = supplied['pair-a.vert'].slice(); new DataView(malformed.buffer).setUint32(20, 0, true);
    await rejects(() => translator.translate(malformed), 'zero-length SPIR-V instruction');
    const recovered = await translator.translate(supplied['pair-a.vert'], { stage: 'vertex' });
    check(recovered.wgsl === translated['pair-a.vert'].wgsl, 'valid translation after malformed shader');
    const adapter = await navigator.gpu?.requestAdapter();
    check(!!adapter, 'actual WebGPU adapter');
    report.adapter = { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture,
      description: adapter.info?.description, isFallbackAdapter: adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null };
    device = await adapter.requestDevice(); counts.devicesCreated++;
    device.addEventListener('uncapturederror', event => report.errors.push(String(event.error)));
    const nativeDestroyDevice = device.destroy.bind(device);
    let deviceDestroyed = false;
    Object.defineProperty(device, 'destroy', { value() { if (!deviceDestroyed) { deviceDestroyed = true; counts.devicesDestroyed++; nativeDestroyDevice(); } } });
    for (const [method, live, kind] of [['createBuffer', nativeBuffers, 'buffers'], ['createTexture', nativeTextures, 'textures']]) {
      const create = device[method].bind(device);
      Object.defineProperty(device, method, { value(...args) {
        const resource = create(...args), destroy = resource.destroy.bind(resource);
        counts[kind + 'Created']++; live.add(resource);
        Object.defineProperty(resource, 'destroy', { value() { if (live.delete(resource)) { counts[kind + 'Destroyed']++; destroy(); } } });
        return resource;
      } });
    }
    const submit = device.queue.submit.bind(device.queue), encoder = device.createCommandEncoder.bind(device);
    Object.defineProperty(device.queue, 'submit', { value(...args) { counts.nativeSubmits++; return submit(...args); } });
    Object.defineProperty(device, 'createCommandEncoder', { value(...args) { counts.nativeEncoders++; return encoder(...args); } });
    renderer = createGraphicsRenderer(device);
    const descriptor = (v, f, layout) => ({ vertex: structuredClone(translated[`pair-${v}.vert`]),
      fragment: structuredClone(translated[`pair-${f}.frag`]), vertexBuffers: structuredClone(layout) });
    await rejects(() => renderer.createPipeline({ ...descriptor('a', 'a', interleaved), vertex: translated['pair-a.frag'] }), 'renderer wrong shader stage');
    await rejects(() => renderer.createPipeline({ ...descriptor('a', 'a', interleaved), fragment: translated['mismatch.frag'] }), 'varying interface mismatch');
    const wrongLayout = descriptor('a', 'a', interleaved); wrongLayout.vertexBuffers[0].attributes[1].format = 'float32x2';
    await rejects(() => renderer.createPipeline(wrongLayout), 'vertex attribute type mismatch');
    const badSource = descriptor('a', 'a', interleaved); badSource.vertex.wgsl = 'not valid WGSL';
    await rejects(() => renderer.createPipeline(badSource), 'native shader compilation failure');
    const target = await renderer.createTarget({ width, height });
    await rejects(() => renderer.readback(target), 'uninitialized target readback');
    renderer.begin({ target, loadOp: 'load', storeOp: 'store' });
    await rejects(() => renderer.end(), 'uninitialized attachment load');
    async function buffersFor(layout) {
      const arrays = layout === interleaved ? [new Float32Array(positions.flatMap(p => [...p, 1, 0, 0]))] :
        [new Float32Array(positions.flat()), new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0])];
      const buffers = [];
      for (const values of arrays) {
        const buffer = await renderer.createVertexBuffer({ size: values.byteLength });
        const bytes = new Uint8Array(values.buffer), pending = renderer.uploadVertexBuffer(buffer, 0, bytes);
        bytes.fill(0); // Must not affect the queued upload's immediate snapshot.
        await pending; buffers.push(buffer);
      }
      return buffers;
    }
    let lastReadback;
    for (const layout of [interleaved, separate]) for (const [v, f] of [['a', 'a'], ['b', 'a'], ['a', 'b'], ['b', 'b']]) {
      const desc = descriptor(v, f, layout), pending = renderer.createPipeline(desc);
      desc.vertex.wgsl = 'mutated'; desc.vertex.inputs[0].location = 7;
      desc.fragment.entryPoint = 'mutated'; desc.vertexBuffers[0].stride = 4;
      const pipeline = await pending, buffers = await buffersFor(layout);
      renderer.begin({ target, loadOp: 'clear', storeOp: 'store', clearColor: [0, 1, 0, 1] });
      const draw = { pipeline, vertexBuffers: buffers.map(buffer => ({ buffer })), vertexCount: 3,
        viewport: { ...viewport } };
      renderer.draw(draw); draw.vertexCount = 6; draw.viewport.height = 1;
      await renderer.end();
      const readback = await renderer.readback(target), oracle = verify(readback, v, f);
      const orientation = v === 'a' ? [[18, 15], [18, 44]] : [[37, 18], [37, 40]];
      const landmarks = [sample(readback.pixels, ...orientation[0], f === 'a' ? red : blue, 'Vulkan upper landmark'),
        sample(readback.pixels, ...orientation[1], clear, 'Vulkan lower clear landmark')];
      report.rounds.push({ vertex: v, fragment: f, layout: layout === interleaved ? 'interleaved' : 'separate',
        width, height, alignedRowBytes: 512, oracle, landmarks, pixelsSha256: await digest(readback.pixels) });
      lastReadback = readback;
      for (const buffer of buffers) await renderer.destroy(buffer);
      await renderer.destroy(pipeline);
    }
    renderer.begin({ target, loadOp: 'load', storeOp: 'store' }); await renderer.end();
    const retained = await renderer.readback(target);
    check(equal(retained.pixels, lastReadback.pixels), 'load/store without draw preserves every pixel');
    const pipeline = await renderer.createPipeline(descriptor('a', 'a', interleaved));
    const buffers = await buffersFor(interleaved);
    const scissor = { x: 0, y: 0, width, height: 20 };
    renderer.begin({ target, loadOp: 'clear', storeOp: 'store', clearColor: [0, 1, 0, 1] });
    renderer.draw({ pipeline, vertexBuffers: buffers.map(buffer => ({ buffer })), vertexCount: 3, scissor });
    await renderer.end();
    const clipped = await renderer.readback(target);
    report.scissor = verify(clipped, 'a', 'a', viewport, scissor);
    sample(clipped.pixels, 18, 15, red, 'scissor kept region'); sample(clipped.pixels, 18, 30, clear, 'scissor removed region');
    const customViewport = { x: 5, y: 3, width: 60, height: 40, minDepth: 0, maxDepth: 1 };
    renderer.begin({ target, loadOp: 'clear', storeOp: 'store', clearColor: [0, 1, 0, 1] });
    renderer.draw({ pipeline, vertexBuffers: buffers.map(buffer => ({ buffer })), vertexCount: 3, viewport: customViewport });
    await renderer.end();
    report.viewport = verify(await renderer.readback(target), 'a', 'a', customViewport);
    renderer.begin({ target, loadOp: 'clear', storeOp: 'store', clearColor: [0, 1, 0, 1] });
    renderer.draw({ pipeline, vertexBuffers: buffers.map(buffer => ({ buffer })), vertexCount: 3 });
    const updatedVertices = new Float32Array(positions.flatMap(p => [...p, 0, 0, 1]));
    await renderer.uploadVertexBuffer(buffers[0], 0, new Uint8Array(updatedVertices.buffer));
    await renderer.end();
    report.postRecordUpload = verify(await renderer.readback(target), 'a', 'b');
    report.postRecordUpload.note = 'Pair A shaders emit blue from vertex bytes changed after draw recording';
    const restoredVertices = new Float32Array(positions.flatMap(p => [...p, 1, 0, 0]));
    await renderer.uploadVertexBuffer(buffers[0], 0, new Uint8Array(restoredVertices.buffer));
    const overlay = await renderer.createPipeline(descriptor('b', 'b', interleaved));
    renderer.begin({ target, loadOp: 'clear', storeOp: 'store', clearColor: [0, 1, 0, 1] });
    renderer.draw({ pipeline, vertexBuffers: buffers.map(buffer => ({ buffer })), vertexCount: 3 });
    renderer.draw({ pipeline: overlay, vertexBuffers: buffers.map(buffer => ({ buffer })), vertexCount: 3 });
    const beforeOverlay = { submits: counts.nativeSubmits, draws: renderer.getStats().draws };
    await renderer.end();
    check(counts.nativeSubmits === beforeOverlay.submits + 1 && renderer.getStats().draws === beforeOverlay.draws + 2,
      'two draws share one real native submission');
    const composited = await renderer.readback(target), overlaySamples = [];
    for (let y = 2; y < height; y += 4) for (let x = 2; x < width; x += 4) {
      const a = Math.min(...weights(x + .5, y + .5, triangle('a')));
      const b = Math.min(...weights(x + .5, y + .5, triangle('b')));
      if ([a, b].some(v => v > -.12 && v < .09)) continue;
      overlaySamples.push(sample(composited.pixels, x, y, b >= .09 ? blue : a >= .09 ? red : clear, 'ordered draws'));
    }
    report.multipleDraws = { samples: overlaySamples, before: beforeOverlay, after: renderer.getStats() };
    renderer.begin({ target, loadOp: 'load', storeOp: 'store' });
    renderer.draw({ pipeline, vertexBuffers: buffers.map(buffer => ({ buffer })), vertexCount: 3 });
    await renderer.destroy(buffers[0]);
    const before = { ...renderer.getStats(), submits: counts.nativeSubmits, encoders: counts.nativeEncoders };
    await rejects(() => renderer.end(), 'stale vertex buffer rejects entire pass');
    check(renderer.getStats().draws === before.draws && counts.nativeSubmits === before.submits && counts.nativeEncoders === before.encoders,
      'stale resource rejected before native encoder/submit and draw counter');
    report.stale = { before, after: renderer.getStats() };
    const picture = document.querySelector('#pixels');
    picture.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(lastReadback.pixels), width, height), 0, 0);
    report.beforeClose = renderer.getStats();
    renderer.close(); renderer.close();
    report.afterClose = renderer.getStats();
    check(report.afterClose.resources === 0 && report.afterClose.nativeObjects === 0 && report.afterClose.allocatedBytes === 0, 'renderer close releases all tracked ownership');
    check(nativeBuffers.size === 0 && nativeTextures.size === 0, 'independent native ownership empty before caller cleanup');
    check(counts.devicesDestroyed === 0, 'renderer close preserves caller-owned device');
    await rejects(() => renderer.createTarget({ width, height }), 'renderer rejects after close');
    translator.close(); translator.close();
    await rejects(() => translator.translate(supplied['pair-a.vert']), 'translator rejects after close');
    check(counts.workersCreated > 0 && ownedWorkers.size === 0 && counts.workersCreated === counts.workersTerminated, 'independent worker creation and termination balance');
    check(report.rounds.length === 8 && report.errors.length === 0, 'eight shader/layout rounds without uncaptured errors');
    report.pass = true;
  } catch (error) { report.errors.push(String(error?.stack ?? error)); }
  finally {
    cleanup();
    if (device) await device.lost;
    for (const [kind, end] of [['workers', 'Terminated'], ['devices', 'Destroyed'], ['buffers', 'Destroyed'], ['textures', 'Destroyed']])
      counts['live' + kind[0].toUpperCase() + kind.slice(1)] = counts[kind + 'Created'] - counts[kind + end];
    report.pass = report.pass && report.errors.length === 0 && ['Workers', 'Devices', 'Buffers', 'Textures'].every(kind => counts['live' + kind] === 0);
    document.documentElement.dataset.result = report.pass ? 'pass' : 'fail';
    document.querySelector('#log').textContent = JSON.stringify(report, null, 2);
  }
};
