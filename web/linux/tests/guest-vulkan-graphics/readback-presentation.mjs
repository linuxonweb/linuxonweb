// Explicit WebGPU rendering -> CPU readback -> opaque 2D canvas presentation.
// This adapter never selects a rendering backend or falls back after failure.
const MAX_DIMENSION = 512, MAX_SURFACES = 16, MAX_CANVAS_BYTES = 16 * 1024 * 1024;
const fail = message => { throw Object.assign(new Error(message), { status: -22 }); };

export function createReadbackPresentation(renderer) {
  if (!renderer || typeof renderer.readback !== 'function' || typeof renderer.targetExtent !== 'function' ||
      typeof renderer.close !== 'function' || typeof renderer.getStats !== 'function')
    fail('readback presentation requires the direct WebGPU renderer');
  const surfaces = new Map();
  let closed = false, pending = null, canvasBytes = 0;
  const counters = { frames: 0, bitmapFrames: 0, attachedFrames: 0, rejectedLateFrames: 0 };
  const live = () => { if (closed || renderer.getStats().state !== 'open') fail('readback presentation is closed'); };
  const extent = handle => {
    const value = renderer.targetExtent(handle);
    if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1 || value.height < 1 ||
        value.width > MAX_DIMENSION || value.height > MAX_DIMENSION || value.format !== 'rgba8unorm')
      fail('readback presentation supports rgba8unorm targets up to 512x512');
    return value;
  };
  const drop = surface => {
    const entry = surfaces.get(surface);
    if (!entry) return;
    surfaces.delete(surface); canvasBytes -= entry.bytes;
    // Release the owned backing store, including a transferred page canvas.
    entry.canvas.width = 0; entry.canvas.height = 0;
  };
  const wrapper = Object.create(renderer);
  Object.defineProperties(wrapper, {
    presentable: { value: typeof OffscreenCanvas === 'function' && typeof ImageData === 'function' },
    present: { value: async (handle, surface, output, sink) => {
      live();
      if (pending) fail('readback presentation already has an in-flight frame');
      if (!Number.isInteger(surface) || surface < 0 || surface > 0xffffffff || typeof sink !== 'function')
        fail('invalid readback presentation surface or sink');
      if (output !== null && (!(output instanceof OffscreenCanvas))) fail('invalid transferred 2D canvas');
      const expected = extent(handle), bytes = expected.width * expected.height * 4;
      const existing = surfaces.get(surface);
      if (!existing && surfaces.size >= MAX_SURFACES) fail('readback presentation surface budget exceeded');
      if (canvasBytes - (existing?.bytes ?? 0) + bytes > MAX_CANVAS_BYTES) fail('readback presentation canvas budget exceeded');
      const token = { surface, cancelled: false }; pending = token;
      try {
        const image = await renderer.readback(handle);
        if (closed || token.cancelled) { counters.rejectedLateFrames++; fail('readback frame cancelled before presentation'); }
        live();
        if (image.width !== expected.width || image.height !== expected.height || image.format !== 'rgba8unorm' ||
            image.rowOrder !== 'top-to-bottom' || !(image.pixels instanceof Uint8Array) || image.pixels.byteLength !== bytes)
          fail('readback presentation returned an invalid pixel layout');
        let entry = surfaces.get(surface);
        if (!entry || entry.width !== image.width || entry.height !== image.height ||
            (output !== null && entry.canvas !== output) || (output === null && entry.attached)) {
          if (entry) drop(surface);
          const canvas = output ?? new OffscreenCanvas(image.width, image.height);
          canvas.width = image.width; canvas.height = image.height;
          let context;
          try { context = canvas.getContext('2d', { alpha: false }); if (!context) fail('readback presentation requires a 2D context'); }
          catch (error) { canvas.width = 0; canvas.height = 0; throw error; }
          entry = { canvas, context, width: image.width, height: image.height, bytes, attached: output !== null };
          surfaces.set(surface, entry); canvasBytes += bytes;
        }
        const pixels = new Uint8ClampedArray(image.pixels.buffer, image.pixels.byteOffset, image.pixels.byteLength);
        entry.context.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
        if (output !== null) { sink(null); counters.attachedFrames++; }
        else {
          const bitmap = entry.canvas.transferToImageBitmap();
          try { sink(bitmap); } catch (error) { bitmap.close(); throw error; }
          counters.bitmapFrames++;
        }
        counters.frames++;
      } finally { if (pending === token) pending = null; }
    } },
    forgetSurface: { value: surface => {
      if (pending?.surface === surface) pending.cancelled = true;
      try { drop(surface); } finally { renderer.forgetSurface?.(surface); }
    } },
    getStats: { value: () => Object.freeze({ ...renderer.getStats(), readbackPresentation: Object.freeze({
      mode: 'readback-2d', renderingBackend: 'webgpu', closed, surfaces: surfaces.size, canvasBytes,
      pending: pending !== null, maxDimension: MAX_DIMENSION, maxSurfaces: MAX_SURFACES, ...counters }) }) },
    close: { value: () => {
      if (closed) return;
      closed = true; if (pending) pending.cancelled = true;
      let failure;
      for (const surface of [...surfaces.keys()]) { try { drop(surface); } catch (error) { failure ??= error; } }
      try { renderer.close(); } catch (error) { failure ??= error; }
      if (failure) throw failure;
    } }
  });
  return Object.freeze(wrapper);
}
