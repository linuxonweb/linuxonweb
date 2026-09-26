import test from 'node:test';
import assert from 'node:assert/strict';
import { createFramebufferHost, swizzle_bgra_to_rgba } from './dist/framebuffer.js';

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
    source.fill(0,1,20);
    canvas.width = 1; canvas.height = 1;
    callback(); callback = null;
    assert.deepEqual(painted, [[1,2,30,255,4,5,6,255,7,8,9,255,10,11,12,255]]);
    assert.equal(canvas.width, 2); assert.equal(canvas.height, 2);
    assert.equal(host.diagnostics.coalesced, 1);
    assert.equal(host.diagnostics.frames, 1);
    memory.grow(1);
    new Uint8Array(memory.buffer).set([20,30,40,0, 0,0,0,0, 0,0,0,0, 0,0,0,0], 65536);
    host.present(65536,2,2,8,32); callback(); callback = null;
    assert.deepEqual(painted[1].slice(0,4), [40,30,20,255]);
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

test('unavailable GPU falls through to Canvas2D with an honest diagnostic', async () => {
  const canvas = { getContext: () => ({}), dataset: {} };
  const host = createFramebufferHost({ buffer: new ArrayBuffer(32) }, { canvas, width: 2, height: 2, backend: 'auto' });
  await host.ready;
  assert.equal(host.diagnostics.backend, 'canvas2d');
  assert.ok(host.diagnostics.fallbackReason);
  assert.equal(canvas.dataset.framebufferBackend, 'canvas2d');
  host.close();
});

test('invalid dimensions and backend policy fail early', () => {
  const canvas = { getContext: () => ({}) };
  assert.throws(() => createFramebufferHost({}, { canvas, width: -1 }));
  assert.throws(() => createFramebufferHost({}, { canvas, width: 2, height: 2, backend: 'vulkan' }));
});
