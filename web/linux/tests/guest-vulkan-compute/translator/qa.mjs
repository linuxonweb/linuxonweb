import { createSpirvTranslator } from './index.mjs';

const report = window.spirvQa = { pass: false, checks: 0, errors: [], rejections: [], rounds: [],
  ownership: { devicesCreated: 0, devicesDestroyed: 0, buffersCreated: 0, buffersDestroyed: 0 },
  isolated: crossOriginIsolated, visibility: document.visibilityState,
  scope: 'Real browser-worker SPIR-V translation and WebGPU compute only; no guest execution or physical GPU proof' };
const hash = async data => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)),
  byte => byte.toString(16).padStart(2, '0')).join('');
function check(condition, name) { report.checks++; if (!condition) throw Error(name); }
async function reject(action, name) {
  try { await action(); } catch (error) { report.rejections.push({ name, error: String(error) }); report.checks++; return; }
  throw Error('expected rejection: ' + name);
}
async function load(url, expected, limit) {
  const response = await fetch(url);
  if (!response.ok) throw Error('fixture unavailable: ' + url);
  const bytes = await response.arrayBuffer();
  check(bytes.byteLength <= limit, 'fixture byte bound');
  check(await hash(bytes) === expected, 'fixture hash: ' + url);
  return bytes;
}

document.querySelector('#run').onclick = async () => {
  document.querySelector('#run').disabled = true;
  let translator, device;
  const buffers = new Set();
  const destroy = buffer => { if (buffers.delete(buffer)) { buffer.destroy(); report.ownership.buffersDestroyed++; } };
  const createBuffer = descriptor => { const b = device.createBuffer(descriptor); buffers.add(b); report.ownership.buffersCreated++; return b; };
  try {
    check(crossOriginIsolated, 'cross-origin isolation');
    check(document.visibilityState === 'visible', 'foreground page');
    const expectedManifest = new URLSearchParams(location.search).get('manifest');
    check(/^[a-f0-9]{64}$/.test(expectedManifest ?? ''), 'pinned manifest query');
    const manifestBytes = await load('./candidate/qa-inputs.json', expectedManifest, 65536);
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    report.manifest = manifest;
    check(manifest.testOnly === true && manifest.shaders.length === 2, 'bounded fixture manifest');
    for (const [path, sha256] of Object.entries(manifest.sources)) {
      check(['index.mjs', 'worker.mjs', 'qa.mjs', 'qa.html'].includes(path), 'source allowlist');
      await load('./' + path, sha256, 65536);
    }
    check(Object.keys(manifest.sources).length === 4, 'all browser source hashes');
    const url = new URL('./candidate/translator.wasm', location.href);
    translator = await createSpirvTranslator({ url, sha256: manifest.translator.sha256 });
    await reject(() => createSpirvTranslator({ url, sha256: '0'.repeat(64) }), 'artifact hash mismatch');
    const shaderBytes = [];
    for (let i = 0; i < 2; i++) shaderBytes.push(new Uint8Array(await load(`./candidate/formula-${i}.spv`, manifest.shaders[i].sha256, 65536)));
    const adapter = await navigator.gpu?.requestAdapter();
    check(!!adapter, 'WebGPU adapter');
    report.adapter = { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture,
      description: adapter.info?.description, isFallbackAdapter: adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null };
    device = await adapter.requestDevice(); report.ownership.devicesCreated++;
    device.addEventListener('uncapturederror', event => report.errors.push(String(event.error)));
    async function execute(round, translation) {
      const original = new Uint32Array(68);
      for (let i = 0; i < 64; i++) original[i] = i * 17 + 11;
      original.set([0xfeedcafe, 0x12345678, 0x87654321, 0xdeadbeef], 64);
      const expected = Array.from(original, (value, i) => i >= 64 ? value :
        round === 0 ? (Math.imul(value, 3) + 7) >>> 0 : Math.imul((value ^ 85) + 17, 5) >>> 0);
      device.pushErrorScope('validation');
      let storage, staging, actual;
      try {
        const shader = device.createShaderModule({ code: translation.wgsl });
        const info = await shader.getCompilationInfo();
        check(info.messages.every(message => message.type !== 'error'), 'translated WGSL compiles');
        const pipeline = await device.createComputePipelineAsync({ layout: 'auto',
          compute: { module: shader, entryPoint: translation.entryPoint } });
        storage = createBuffer({ size: original.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
        staging = createBuffer({ size: original.byteLength, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(storage, 0, original);
        const binding = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: storage, offset: 0, size: original.byteLength } }] });
        const commands = device.createCommandEncoder(), pass = commands.beginComputePass();
        pass.setPipeline(pipeline); pass.setBindGroup(0, binding); pass.dispatchWorkgroups(1, 1, 1); pass.end();
        commands.copyBufferToBuffer(storage, 0, staging, 0, original.byteLength);
        device.queue.submit([commands.finish()]); await staging.mapAsync(GPUMapMode.READ);
        actual = Array.from(new Uint32Array(staging.getMappedRange()).slice());
        staging.unmap();
        for (let i = 0; i < 68; i++) check(actual[i] === expected[i], `round ${round} word ${i}`);
      } finally {
        if (staging) destroy(staging); if (storage) destroy(storage);
        const error = await device.popErrorScope();
        if (error) throw error;
      }
      report.rounds.push({ round, entryPoint: translation.entryPoint, workgroupSize: translation.workgroupSize,
        shaderSha256: manifest.shaders[round].sha256, wgslSha256: await hash(new TextEncoder().encode(translation.wgsl)),
        wgsl: translation.wgsl, original: Array.from(original), expected, actual, sentinels: actual.slice(64) });
    }
    await execute(0, await translator.translate(shaderBytes[0]));
    const malformed = shaderBytes[0].slice(); new DataView(malformed.buffer).setUint32(20, 0, true);
    await reject(() => translator.translate(malformed), 'zero-length SPIR-V instruction');
    await execute(1, await translator.translate(shaderBytes[1]));
    check(report.rounds[0].wgslSha256 !== report.rounds[1].wgslSha256, 'different translated programs');
    translator.close();
    await reject(() => translator.translate(shaderBytes[0]), 'closed translator');
    check(report.errors.length === 0, 'no uncaptured GPU errors');
    report.pass = true;
  } catch (error) { report.errors.push(String(error?.stack ?? error)); }
  finally {
    translator?.close();
    for (const buffer of buffers) destroy(buffer);
    if (device) { device.destroy(); report.ownership.devicesDestroyed++; await device.lost; }
    report.ownership.liveBuffers = report.ownership.buffersCreated - report.ownership.buffersDestroyed;
    report.ownership.liveDevices = report.ownership.devicesCreated - report.ownership.devicesDestroyed;
    report.pass = report.pass && report.errors.length === 0 && report.ownership.liveBuffers === 0 && report.ownership.liveDevices === 0;
    document.documentElement.dataset.result = report.pass ? 'pass' : 'fail';
    document.querySelector('#log').textContent = JSON.stringify(report, null, 2);
  }
};
