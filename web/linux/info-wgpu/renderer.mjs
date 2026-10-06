// Rust wgpu renders offscreen; Canvas2D only presents the returned RGBA pixels.
// One worker owns one backend and one serial render/readback stream.
export function createInfoWgpuRenderer({ canvas, backend, environment = globalThis }) {
  if (!['webgpu', 'webgl'].includes(backend)) throw new Error('Unsupported wgpu backend');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Pixel presentation context unavailable');
  const worker = new environment.Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
  let closed = false, sequence = 0, busy = false, closeTimer;
  const pending = new Map();
  const terminate = () => { clearTimeout(closeTimer); worker.terminate(); };
  function rejectAll(error) {
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); }
    pending.clear();
  }
  function close() {
    if (closed) return;
    closed = true; rejectAll(new Error('wgpu demo closed'));
    // The worker closes Rust resources after any active async Rust borrow ends.
    closeTimer = setTimeout(terminate, 5000);
    worker.postMessage({ type: 'close' });
  }
  worker.onmessage = ({ data }) => {
    if (data.type === 'closed') { terminate(); return; }
    const request = pending.get(data.id);
    if (!request || closed) return;
    pending.delete(data.id); clearTimeout(request.timer);
    if (data.type === 'error') request.reject(new Error(data.message));
    else request.resolve(data);
  };
  worker.onerror = event => { rejectAll(new Error(event.message || 'wgpu worker failed')); close(); };
  function request(type, fields = {}) {
    if (closed) return Promise.reject(new Error('wgpu demo closed'));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`wgpu ${type} timed out`)); close(); }, 5000);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ type, id, ...fields });
    });
  }
  const ready = request('init', { backend, width: canvas.width, height: canvas.height });
  return {
    ready, close,
    async draw(time) {
      if (busy) throw new Error('wgpu frame already in flight');
      busy = true;
      try {
        const frame = await request('frame', { time });
        if (closed) return;
        const pixels = new Uint8ClampedArray(frame.pixels);
        if (pixels.length !== canvas.width * canvas.height * 4) throw new Error('Invalid wgpu readback extent');
        context.putImageData(new environment.ImageData(pixels, canvas.width, canvas.height), 0, 0);
      } finally { busy = false; }
    },
  };
}
