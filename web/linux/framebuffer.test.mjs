import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFramebufferHost, swizzle_bgra_to_rgba, FBDIFF_WASM } from './dist/framebuffer.js';

test('unaligned padded BGRA input is opaque RGBA without reading padding', () => {
  const source = new Uint8Array(24).subarray(1);
  source.set([3,2,1,0, 6,5,4,128], 0);
  source.set([9,8,7,255, 12,11,10,0], 11);
  const dst = new Uint8ClampedArray(17).subarray(1);
  swizzle_bgra_to_rgba(dst, source, 2, 2, 11);
  assert.deepEqual([...dst], [1,2,3,255,4,5,6,255,7,8,9,255,10,11,12,255]);
});

test('host snapshots shared padded data, coalesces presents, handles resize/growth and closes', async () => {
  const oldRAF = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  let callback = null, cancelled = 0, painted = [];
  globalThis.requestAnimationFrame = fn => { callback = fn; return 1; };
  globalThis.cancelAnimationFrame = () => { callback = null; cancelled++; };
  try {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 2, shared: true });
    const canvas = { width: 0, height: 0, dataset: {}, getContext: () => ({
      createImageData: (w,h) => ({ data: new Uint8ClampedArray(w*h*4) }),
      putImageData: image => painted.push([...image.data]),
    }) };
    const host = createFramebufferHost(memory, { canvas, width: 2, height: 2 });
    await host.ready;
    const source = new Uint8Array(memory.buffer);
    source.set([3,2,1,0, 6,5,4,0], 1);
    source.set([9,8,7,0, 12,11,10,0], 12);
    host.present(1,2,2,11,32);
    source[1] = 30;
    host.present(1,2,2,11,32);
    // The guest never waits for a present: the paint reads its latest bytes.
    source[5] = 60;
    canvas.width = 1; canvas.height = 1;
    callback(); callback = null;
    assert.deepEqual(painted, [[1,2,30,255,4,5,60,255,7,8,9,255,10,11,12,255]]);
    assert.equal(canvas.width, 2); assert.equal(canvas.height, 2);
    assert.equal(host.diagnostics.coalesced, 1);
    assert.equal(host.diagnostics.frames, 1);
    memory.grow(1);
    new Uint8Array(memory.buffer).set([20,30,40,0, 0,0,0,0, 0,0,0,0, 0,0,0,0], 65536);
    host.present(65536,2,2,8,32); callback(); callback = null;
    assert.deepEqual(painted[1].slice(0,4), [40,30,20,255]);
    // Presents between paints share one compare; identical bytes draw nothing.
    host.present(65536,2,2,8,32); host.present(65536,2,2,8,32); host.present(65536,2,2,8,32);
    callback(); callback = null;
    assert.equal(host.diagnostics.unchanged, 1);
    assert.equal(host.diagnostics.frames, 2);
    assert.equal(painted.length, 2);
    for (const stride of [7, 8.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) host.present(1,2,2,stride,32);
    host.present(131072,2,2,8,32);
    assert.equal(callback, null);
    host.present(1,2,2,8,32); host.close(); host.close();
    assert.equal(cancelled, 1);
    host.present(1,2,2,8,32); assert.equal(callback, null);
  } finally {
    globalThis.requestAnimationFrame = oldRAF; globalThis.cancelAnimationFrame = oldCancel;
  }
});

function fakeCanvas() {
  const painted = [], drawn = [], events = [];
  const canvas = { width: 0, height: 0, dataset: {},
    getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: image => painted.push([...image.data]),
      drawImage: frame => drawn.push(frame),
    }),
    dispatchEvent: event => events.push(event.detail) };
  return { canvas, painted, drawn, events };
}

// Runs fn with requestAnimationFrame captured and an optional navigator.gpu fake.
async function withHostGlobals(gpu, fn) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldRAF = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  const oldOffscreen = globalThis.OffscreenCanvas, oldUsage = globalThis.GPUTextureUsage;
  let callback = null;
  globalThis.requestAnimationFrame = cb => { callback = cb; return 1; };
  globalThis.cancelAnimationFrame = () => { callback = null; };
  Object.defineProperty(globalThis, 'navigator', { value: { gpu }, configurable: true });
  try {
    return await fn(() => { const cb = callback; callback = null; cb?.(); return Boolean(cb); });
  } finally {
    Object.defineProperty(globalThis, 'navigator', saved);
    globalThis.requestAnimationFrame = oldRAF; globalThis.cancelAnimationFrame = oldCancel;
    globalThis.OffscreenCanvas = oldOffscreen; globalThis.GPUTextureUsage = oldUsage;
  }
}

// Minimal WebGPU fake: enough for createWebGPUPresenter to configure and draw.
function fakeGpu() {
  const state = { draws: 0, destroyed: 0, failDraw: false };
  let loseDevice;
  const makeDevice = () => ({
    lost: new Promise(resolve => { loseDevice = resolve; }),
    addEventListener() {},
    createShaderModule: () => ({}),
    createRenderPipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
    createTexture: () => ({ createView: () => ({}), destroy() {} }),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({ beginRenderPass: () => ({ setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }), finish: () => ({}) }),
    queue: { writeTexture() { if (state.failDraw) throw new Error('fake draw failure'); }, submit() { state.draws++; } },
    destroy() { state.destroyed++; },
  });
  globalThis.GPUTextureUsage = { TEXTURE_BINDING: 4, COPY_DST: 2 };
  globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; }
    getContext(kind) { return kind === 'webgpu' ? { configure() {}, unconfigure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) } : null; }
    transferToImageBitmap() { return { bitmap: true, close() {} }; } };
  const gpu = { getPreferredCanvasFormat: () => 'bgra8unorm',
    requestAdapter: async () => ({ info: { isFallbackAdapter: false }, requestDevice: async () => makeDevice() }) };
  return { gpu, state, lose: reason => loseDevice({ reason }) };
}

test('Auto without WebGPU does not fall back: display pauses and asks for a choice', async () => {
  await withHostGlobals(undefined, async frame => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const { canvas, painted, events } = fakeCanvas();
    const host = createFramebufferHost(memory, { canvas, width: 2, height: 2, backend: 'auto' });
    await host.ready;
    assert.equal(host.diagnostics.backend, 'none');
    assert.equal(host.diagnostics.awaitingChoice, true);
    assert.equal(host.diagnostics.failure, 'WebGPU unavailable');
    assert.equal(host.diagnostics.fallbackReason, null);
    assert.equal(canvas.dataset.framebufferBackend, 'none');
    assert.equal(events.at(-1).awaitingChoice, true);
    assert.equal(typeof events.at(-1).setBackend, 'function');
    new Uint8Array(memory.buffer).set([3,2,1,0, 6,5,4,0, 9,8,7,0, 12,11,10,0]);
    host.present(0,2,2,8,32); frame();
    assert.deepEqual(painted, [], 'no silent Canvas2D painting while the user chooses');
    await events.at(-1).setBackend('canvas2d');
    assert.equal(host.diagnostics.backend, 'canvas2d');
    assert.equal(host.diagnostics.awaitingChoice, false);
    assert.equal(host.diagnostics.requested, 'canvas2d');
    frame();
    assert.deepEqual(painted, [[1,2,3,255,4,5,6,255,7,8,9,255,10,11,12,255]], 'retained frame paints after the choice');
    host.close();
    await host.setBackend('auto');
    assert.equal(host.diagnostics.requested, 'canvas2d', 'a closed host ignores switching');
    assert.throws(() => host.setBackend('vulkan'));
  });
});

test('a WebGPU start that never answers times out into the same choice', async () => {
  const gpu = { requestAdapter: () => new Promise(() => {}) };
  await withHostGlobals(gpu, async () => {
    const { canvas } = fakeCanvas();
    const host = createFramebufferHost({ buffer: new ArrayBuffer(32) }, { canvas, width: 2, height: 2, backend: 'webgpu', webgpuTimeoutMs: 20 });
    await host.ready;
    assert.equal(host.diagnostics.awaitingChoice, true);
    assert.match(host.diagnostics.failure, /did not start within 0.02 s/);
    host.close();
  });
});

test('WebGPU presents frames, and device loss or draw failure pauses for a choice', async () => {
  const fake = fakeGpu();
  await withHostGlobals(fake.gpu, async frame => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const { canvas, painted, drawn, events } = fakeCanvas();
    const host = createFramebufferHost(memory, { canvas, width: 2, height: 2, backend: 'auto' });
    await host.ready;
    assert.equal(host.diagnostics.backend, 'webgpu');
    assert.equal(host.diagnostics.fallbackAdapter, false);
    host.present(0,2,2,8,32); frame();
    assert.equal(fake.state.draws, 1); assert.equal(drawn.length, 1); assert.deepEqual(painted, []);
    fake.lose('unknown');
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(host.diagnostics.backend, 'none');
    assert.equal(host.diagnostics.awaitingChoice, true);
    assert.equal(host.diagnostics.failure, 'WebGPU device lost: unknown');
    assert.equal(fake.state.destroyed, 1);
    frame();
    assert.deepEqual(painted, []);
    assert.equal(fake.state.draws, 1);
    await host.setBackend('auto');
    assert.equal(host.diagnostics.backend, 'webgpu', 'retrying WebGPU is possible');
    frame();
    assert.equal(fake.state.draws, 2, 'the retained frame repaints on the next presenter');
    fake.state.failDraw = true;
    new Uint8Array(memory.buffer)[0] = 1; // a changed frame; unchanged presents are not redrawn
    host.present(0,2,2,8,32); frame();
    assert.equal(host.diagnostics.awaitingChoice, true);
    assert.equal(host.diagnostics.failure, 'fake draw failure');
    assert.deepEqual(painted, [], 'a draw failure is not hidden by Canvas2D');
    assert.ok(events.filter(detail => detail.awaitingChoice).length >= 2);
    host.close();
  });
});

test('unchanged presents are skipped and only changed rows repaint', async () => {
  await withHostGlobals(undefined, async frame => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const { canvas, painted } = fakeCanvas();
    const host = createFramebufferHost(memory, { canvas, width: 2, height: 2, backend: 'canvas2d' });
    await host.ready;
    host.present(0,2,2,8,32); frame();
    assert.equal(painted.length, 1, 'the first frame paints even when it is all zero');
    host.present(0,2,2,8,32); frame();
    assert.equal(host.diagnostics.unchanged, 1);
    assert.equal(painted.length, 1);
    new Uint8Array(memory.buffer)[8] = 1;
    host.present(0,2,2,8,32); frame();
    assert.equal(painted.length, 2);
    host.close();
  });
});

test('explicit WebGL keeps its Canvas2D fallback with an honest diagnostic', async () => {
  await withHostGlobals(undefined, async () => {
    const canvas = { getContext: () => ({}), dataset: {} };
    const host = createFramebufferHost({ buffer: new ArrayBuffer(32) }, { canvas, width: 2, height: 2, backend: 'webgl' });
    await host.ready;
    assert.equal(host.diagnostics.backend, 'canvas2d');
    assert.ok(host.diagnostics.fallbackReason);
    assert.equal(host.diagnostics.awaitingChoice, false);
    assert.equal(canvas.dataset.framebufferBackend, 'canvas2d');
    host.close();
  });
});

test('invalid dimensions and backend policy fail early', () => {
  const canvas = { getContext: () => ({}) };
  assert.throws(() => createFramebufferHost({}, { canvas, width: -1 }));
  assert.throws(() => createFramebufferHost({}, { canvas, width: 2, height: 2, backend: 'vulkan' }));
});

test('embedded SIMD diff matches fbdiff.wasm', () => {
  assert.equal(FBDIFF_WASM, readFileSync(new URL('./fbdiff/fbdiff.wasm', import.meta.url)).toString('base64'));
});

// Both compare paths (SIMD: 16-byte rows; JavaScript: other widths) paint only
// the changed rectangle and keep the rest of the frame.
for (const width of [8, 6]) test(`changed rectangle is detected and painted (width ${width})`, async () => {
  const oldRAF = globalThis.requestAnimationFrame;
  let callback = null; const puts = [];
  globalThis.requestAnimationFrame = fn => { callback = fn; return 1; };
  try {
    const height = 5, memory = new WebAssembly.Memory({ initial: 1, maximum: 4, shared: true });
    const canvas = { width: 0, height: 0, dataset: {}, getContext: () => ({
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: (image, dx, dy, x, y, w, h) => puts.push({ rect: [x, y, w, h], data: [...image.data] }),
    }) };
    const host = createFramebufferHost(memory, { canvas, width, height });
    await host.ready;
    assert.equal(host.diagnostics.diff, width === 8 ? 'simd' : 'js');
    const fb = new Uint32Array(memory.buffer, 256, width * height);
    for (let i = 0; i < fb.length; i++) fb[i] = 0x010203 * (i + 1);
    host.present(256, width, height, width * 4, 32); callback();
    assert.deepEqual(puts.at(-1).rect, [0, 0, width, height]);
    fb[1 * width + 2] = 0xff0000; fb[3 * width + 4] = 0x00ff00;
    host.present(256, width, height, width * 4, 32); callback();
    const { rect, data } = puts.at(-1);
    const [x, y, w, h] = rect;
    // SIMD compares 4-pixel chunks, so its rectangle may be wider, never narrower.
    assert.ok(x <= 2 && x + w >= 5 && y === 1 && h === 3, `rect ${rect}`);
    assert.ok(width === 8 ? x + w <= width : (x === 2 && w === 3), `rect ${rect}`);
    const pixel = (px, py) => data.slice((py * width + px) * 4, (py * width + px) * 4 + 4);
    assert.deepEqual(pixel(2, 1), [255, 0, 0, 255]);
    assert.deepEqual(pixel(4, 3), [0, 255, 0, 255]);
    const before = puts.length;
    host.present(256, width, height, width * 4, 32); callback();
    assert.equal(puts.length, before, 'unchanged frame draws nothing');
    assert.equal(host.diagnostics.unchanged, 1);
  } finally { globalThis.requestAnimationFrame = oldRAF; }
});
