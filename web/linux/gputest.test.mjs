import test from 'node:test';
import assert from 'node:assert/strict';
import { gputestEnabled, gpuBackendParam, gputestAppParam, gputestCmdlineFlags, loadGputestArchive, appendCpio, startGpuHost, GPUTEST_APPS, GPUTEST_CPIO_URL, GPUTEST_VSOCK_PORT } from './gputest.mjs';

test('gputest query flag', () => {
  assert.equal(gputestEnabled('?gputest=1'), true);
  assert.equal(gputestEnabled('?gputest=1&firefox=1'), true);
  assert.equal(gputestEnabled('?gputest=0'), false);
  assert.equal(gputestEnabled(''), false);
});

test('appendCpio pads the first archive to four bytes', () => {
  const out = appendCpio(new Uint8Array([1, 2, 3, 4, 5]), new Uint8Array([9, 8]));
  assert.deepEqual([...out], [1, 2, 3, 4, 5, 0, 0, 0, 9, 8]);
  assert.deepEqual([...appendCpio(new Uint8Array([1, 2, 3, 4]), new Uint8Array([7]))], [1, 2, 3, 4, 7]);
});

test('missing, failing or non-newc archives keep normal boot', async () => {
  const lines = [];
  const log = line => lines.push(line);
  assert.equal(await loadGputestArchive(log, async () => new Response('no', { status: 404 })), null);
  assert.equal(await loadGputestArchive(log, async () => { throw new Error('offline'); }), null);
  assert.equal(await loadGputestArchive(log, async () => new Response('<!doctype html>'.padEnd(200))), null);
  assert.match(lines[0], /HTTP 404; normal boot/);
  assert.match(lines[1], /offline/);
  const newc = new TextEncoder().encode('070701'.padEnd(120, '0'));
  assert.deepEqual(await loadGputestArchive(log, async () => new Response(newc)), newc);
});

test('host loop retries, serves each session and stops', async () => {
  const calls = [], served = [], lines = [];
  let attempt = 0;
  const vsock = { async connect(port, options) {
    calls.push([port, options.timeoutMs]); attempt++;
    if (attempt < 3) throw new Error('guest reset vsock connection');
    return { close() {} , id: attempt };
  } };
  let host;
  const serveGPU = async (connection, options) => {
    served.push({ id: connection.id, options });
    options.onEvent({ type: 'adapter', backend: 'webgpu', vendor: 'test' });
    if (served.length === 2) host.stop();
    return { commands: 1, graphicsPasses: 0, graphicsDraws: 0, graphicsReadbacks: 0, error: null };
  };
  host = startGpuHost({ vsock, log: line => lines.push(line), gpu: null, retryMs: 5, importHost: async () => ({ serveGPU }) });
  await host.done;
  assert.equal(calls.length, 4);
  assert.ok(calls.every(([port]) => port === GPUTEST_VSOCK_PORT));
  assert.equal(served.length, 2);
  const o = served[0].options;
  assert.ok(o.allowGraphics && o.allowUniforms && o.allowTextures && o.allowDepth);
  assert.equal(o.allowWebGL, false, 'default WebGPU never silently downgrades');
  assert.equal(o.graphicsTranslatorOptions.sha256, '5b78ad4937a5f04011fdc8000207009a5fb4d51f41fc1c7af6ce6a303e67fca5');
  assert.equal(o.webglTranslatorOptions.sha256, '5bf9d0be09b14b2ffdf40efcc4fabf872b2717b658c87039c76ae51efc3740c5');
  assert.equal(lines.filter(line => line.includes('connect retry')).length, 1, 'repeated identical failures are logged once');
  assert.ok(lines.some(line => line.includes('session 2 backend=webgpu')));
});

test('gpubackend query parameter', () => {
  assert.equal(gpuBackendParam('?gputest=1&gpubackend=webgpu'), 'webgpu');
  assert.equal(gpuBackendParam('?gpubackend=webgl&gputest=1&firefox=1'), 'webgl');
  assert.equal(gpuBackendParam('?gpubackend=WebGL2'), 'webgl');
  assert.equal(gpuBackendParam('?gpubackend=auto'), 'webgpu');
  assert.equal(gpuBackendParam('?gpubackend=vulkan'), 'webgpu');
  assert.equal(gpuBackendParam(''), 'webgpu');
});

test('forced backends shape serveGPU options', async () => {
  const fakeGpu = { requestAdapter() {} };
  for (const [backend, gpu, allowWebGL] of [['auto', fakeGpu, true], ['webgpu', fakeGpu, false], ['webgl', null, true]]) {
    const lines = [];
    let host, seen;
    const vsock = { async connect() { return { close() {} }; } };
    const serveGPU = async (connection, options) => { seen = options; host.stop();
      return { commands: 0, graphicsPasses: 0, graphicsDraws: 0, graphicsReadbacks: 0, acquisitionError: 'WebGPU API unavailable', error: null }; };
    host = startGpuHost({ vsock, log: line => lines.push(line), gpu: fakeGpu, backend, retryMs: 5, importHost: async () => ({ serveGPU }) });
    await host.done;
    assert.equal(seen.gpu, gpu, backend);
    assert.equal(seen.allowWebGL, allowWebGL, backend);
    assert.ok(lines[0].includes(`gpubackend=${backend}`), lines[0]);
    assert.equal(lines.some(line => line.includes('webgpu-unavailable')), backend !== 'webgl');
  }
  assert.throws(() => startGpuHost({ vsock: {}, log() {}, backend: 'vulkan' }), /unknown GPU backend/);
});

test('gputestapp selects allowlisted archives and glgears flags', async () => {
  assert.equal(gputestAppParam('?gputest=1'), 'cube');
  assert.equal(gputestAppParam('?gputest=1&gputestapp=GLGEARS'), 'glgears');
  assert.equal(gputestAppParam('?gputestapp=../../etc'), 'cube');
  assert.equal(GPUTEST_APPS.cube, GPUTEST_CPIO_URL);
  assert.match(GPUTEST_APPS.glgears.pathname, /\/gpu\/gputest-glgears\.cpio$/);
  assert.deepEqual(gputestCmdlineFlags('?gputest=1'), []);
  assert.deepEqual(gputestCmdlineFlags('?gputest=1&gputestapp=glgears'), ['gputest.app=glgears', 'gputest.gldriver=softpipe', 'gputest.glmode=bench']);
  assert.deepEqual(gputestCmdlineFlags('?gputestapp=glgears&gldriver=zink&glmode=nopresent'), ['gputest.app=glgears', 'gputest.gldriver=zink', 'gputest.glmode=nopresent']);
  assert.deepEqual(gputestCmdlineFlags('?gputestapp=glgears&gldriver=x%20y&glmode=rm'), ['gputest.app=glgears', 'gputest.gldriver=softpipe', 'gputest.glmode=bench']);
  assert.deepEqual(gputestCmdlineFlags('?gputestapp=glgears&glsize=128x128'), ['gputest.app=glgears', 'gputest.gldriver=softpipe', 'gputest.glmode=bench', 'gputest.glsize=128x128']);
  assert.deepEqual(gputestCmdlineFlags('?gputestapp=glgears&glsize=0x5'), ['gputest.app=glgears', 'gputest.gldriver=softpipe', 'gputest.glmode=bench']);
  assert.equal(gputestAppParam('?gputest=1&gputestapp=VKgears'), 'vkgears');
  assert.match(GPUTEST_APPS.vkgears.pathname, /\/gpu\/gputest-vkgears\.cpio$/);
  assert.deepEqual(gputestCmdlineFlags('?gputest=1&gputestapp=vkgears'), ['gputest.app=vkgears', 'gputest.vkmode=bench']);
  assert.deepEqual(gputestCmdlineFlags('?gputestapp=vkgears&vkmode=nopresent&gldriver=zink'), ['gputest.app=vkgears', 'gputest.vkmode=nopresent']);
  assert.deepEqual(gputestCmdlineFlags('?gputestapp=vkgears&glmode=present'), ['gputest.app=vkgears', 'gputest.vkmode=present']);
  assert.deepEqual(gputestCmdlineFlags('?gputestapp=vkgears&vkmode=rm&vksize=128x128'), ['gputest.app=vkgears', 'gputest.vkmode=bench', 'gputest.vksize=128x128']);
  for (const bad of ['0x10', '5000x10', '10x', 'x10', '10x10%20rdinit=/bin/sh', '-1x5', '012x5'])
    assert.deepEqual(gputestCmdlineFlags(`?gputestapp=vkgears&vksize=${bad}`), ['gputest.app=vkgears', 'gputest.vkmode=bench'], bad);
  let fetched;
  const newc = new TextEncoder().encode('070701'.padEnd(120, '0'));
  assert.deepEqual(await loadGputestArchive(() => {}, async url => { fetched = url; return new Response(newc); }, GPUTEST_APPS.glgears), newc);
  assert.equal(fetched, GPUTEST_APPS.glgears);
});
