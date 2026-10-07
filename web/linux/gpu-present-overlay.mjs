// Shows directly presented guest Vulkan swapchain frames over the framebuffer
// canvas. Each guest surface gets a click-through canvas positioned in the
// canvas's stage at the window's guest root rectangle. The GPU owner first
// sends ImageBitmap frames and a canvas request; the page answers with the
// surface canvas transferred via transferControlToOffscreen, after which the
// owner draws into it directly and only sends rectangle changes. Bitmap frames:
// only the newest per surface is shown each display frame, older ones are closed.
export function createPresentOverlay({ canvas, view = globalThis } = {}) {
  const stage = canvas.parentElement;
  const surfaces = new Map();
  let scheduled = false;
  const counters = { frames: 0, shown: 0, dropped: 0, attached: 0, moves: 0 };

  function remove(key) {
    const s = surfaces.get(key); if (!s) return;
    s.pending?.bitmap.close(); s.element.remove(); surfaces.delete(key);
  }
  function surfaceFor(key) {
    let s = surfaces.get(key);
    if (!s) {
      const element = document.createElement('canvas');
      element.className = 'gpu-present-surface';
      Object.assign(element.style, { position: 'absolute', pointerEvents: 'none', imageRendering: 'auto' });
      stage.append(element);
      s = { element, context: null, offscreen: false, pending: null, rect: '' };
      surfaces.set(key, s);
    }
    return s;
  }
  function place(s, frame) {
    const scaleX = canvas.clientWidth / canvas.width, scaleY = canvas.clientHeight / canvas.height;
    const left = canvas.offsetLeft + frame.x * scaleX, top = canvas.offsetTop + frame.y * scaleY;
    const rect = `${left},${top},${frame.width * scaleX},${frame.height * scaleY}`;
    if (rect === s.rect) return;
    s.rect = rect;
    Object.assign(s.element.style, { left: `${left}px`, top: `${top}px`, width: `${frame.width * scaleX}px`, height: `${frame.height * scaleY}px` });
  }
  function show() {
    scheduled = false;
    for (const s of surfaces.values()) {
      const frame = s.pending; if (!frame) continue;
      s.pending = null; counters.shown++;
      if (s.offscreen) { frame.bitmap.close(); place(s, frame); continue; }
      const { element } = s;
      s.context ??= element.getContext('bitmaprenderer');
      if (element.width !== frame.bitmap.width || element.height !== frame.bitmap.height) {
        element.width = frame.bitmap.width; element.height = frame.bitmap.height;
      }
      s.context.transferFromImageBitmap(frame.bitmap);
      place(s, frame);
    }
  }
  function present(message, reply) {
    if (message.reset) { for (const key of [...surfaces.keys()]) remove(key); return; }
    const key = `${message.session}:${message.surface}`;
    if (message.end) { remove(key); return; }
    if (message.request) {
      // A bitmaprenderer element cannot be transferred: start a fresh element.
      if (!reply || typeof HTMLCanvasElement.prototype.transferControlToOffscreen !== 'function') return;
      const old = surfaces.get(key);
      if (old?.offscreen) return;
      if (old) remove(key);
      const s = surfaceFor(key);
      const offscreen = s.element.transferControlToOffscreen();
      s.offscreen = true; counters.attached++;
      reply({ type: 'present-canvas', session: message.session, surface: message.surface, canvas: offscreen }, [offscreen]);
      return;
    }
    if (message.attached) { counters.moves++; place(surfaceFor(key), message); return; }
    if (!message.bitmap) return;
    counters.frames++;
    const s = surfaceFor(key);
    if (s.pending) { s.pending.bitmap.close(); counters.dropped++; }
    s.pending = message;
    if (!scheduled) { scheduled = true; view.requestAnimationFrame(show); }
  }
  return { present, counters, get surfaces() { return surfaces.size; } };
}
