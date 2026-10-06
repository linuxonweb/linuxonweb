import init, { Renderer } from './guest_vulkan_wgpu_host.js';

// The builtin vertex index carries a bounded angle through firstVertex. This
// keeps the demo free of vertex/uniform buffers and per-frame queue uploads.
export const TRIANGLE_PIPELINE = {
  vertex: { entryPoint: 'vertex', wgsl: `
    struct Vertex { @builtin(position) position: vec4f, @location(0) color: vec3f };
    @vertex fn vertex(@builtin(vertex_index) index: u32) -> Vertex {
      var positions = array<vec2f,3>(vec2f(0.,.7),vec2f(-.65,-.55),vec2f(.65,-.55));
      var colors = array<vec3f,3>(vec3f(1.,.3,.2),vec3f(.2,1.,.6),vec3f(.3,.5,1.));
      let angle = f32(index / 3u) / 1024.;
      let c = cos(angle); let s = sin(angle); let p = positions[index % 3u];
      var out: Vertex; out.position = vec4f((p.x*c-p.y*s)*.5625,p.x*s+p.y*c,0.,1.);
      out.color = colors[index % 3u]; return out;
    }` },
  fragment: { entryPoint: 'fragment', wgsl: `
    @fragment fn fragment(@location(0) color: vec3f) -> @location(0) vec4f { return vec4f(color,1.); }` },
  vertexBuffers: [], uniforms: [], colorFormat: 'rgba8unorm',
  topology: 'triangle-list', frontFace: 'ccw', cullMode: 'none', sampleCount: 1,
};

// Exposed for lifecycle controls; production uses the exact pinned Rust module.
export function installRendererWorker(scope, load = async () => { await init(); return Renderer; }) {
  let renderer, pipeline, target, closed = false, busy = false, initialized = false, width, height;
  function dispose() {
    let stats;
    if (renderer) { try { renderer.close(); stats = JSON.parse(renderer.stats()); } finally { renderer.free(); renderer = null; } }
    scope.postMessage({ type: 'closed', stats });
  }
  scope.onmessage = async ({ data }) => {
    if (data.type === 'close') { closed = true; if (!busy) dispose(); return; }
    if (closed) return;
    if (busy) { scope.postMessage({ type: 'error', id: data.id, message: 'wgpu operation already in flight' }); return; }
    busy = true;
    let stage = data.type;
    try {
      if (data.type === 'init') {
        if (initialized) throw new Error('wgpu already initialized');
        if (!['webgpu','webgl'].includes(data.backend) || data.width !== 160 || data.height !== 90) throw new Error('Invalid demo configuration');
        initialized = true; width = data.width; height = data.height;
        stage = 'module initialization'; const RustRenderer = await load(); if (closed) return;
        stage = 'device acquisition'; renderer = await RustRenderer.create(data.backend, false); if (closed) return;
        stage = 'pipeline creation'; pipeline = await renderer.create_pipeline(JSON.stringify(TRIANGLE_PIPELINE)); if (closed) return;
        stage = 'target allocation'; target = await renderer.create_target(width, height, false); if (closed) return;
        const adapter = JSON.parse(renderer.adapter_info());
        scope.postMessage({ type: 'ready', id: data.id, adapter, stats: JSON.parse(renderer.stats()) });
      } else if (data.type === 'frame') {
        if (!renderer || !Number.isFinite(data.time)) throw new Error('Invalid frame request');
        const firstVertex = Math.floor(((data.time % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) * 1024) * 3;
        stage = 'render submission';
        await renderer.render(JSON.stringify({ target, loadOp: 'clear', storeOp: 'store', clearColor: [.025,.04,.07,1],
          draws: [{ pipeline, vertexBuffers: [], firstVertex, vertexCount: 3 }] }));
        if (closed) return;
        stage = 'pixel readback'; const pixels = await renderer.readback(target); if (closed) return;
        // wasm-bindgen returns a copied Uint8Array, so transfer owns no Rust heap.
        scope.postMessage({ type: 'frame', id: data.id, pixels: pixels.buffer }, [pixels.buffer]);
      } else throw new Error('Unsupported demo operation');
    } catch (error) {
      closed = true;
      scope.postMessage({ type: 'error', id: data.id, message: `wgpu ${stage}: ${error.message || error}` });
    } finally {
      busy = false;
      if (closed) dispose();
    }
  };
}
if (typeof self !== 'undefined') installRendererWorker(self);
