import { createInfoWgpuRenderer } from './info-wgpu/renderer.mjs';
// API/configuration support describes capabilities; it does not identify the
// implementation used by a running codec. See https://www.w3.org/TR/webcodecs/.
export const VIDEO_CODECS = [
  ['AV1', 'av01.0.04M.08'], ['VP9', 'vp09.00.10.08'], ['VP8', 'vp8'],
  ['H.264 / AVC', 'avc1.42001E'], ['H.265 / HEVC', 'hvc1.1.6.L93.B0'],
];
const bounded = (promise, ms = 5000) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Probe timed out')), ms); })]).finally(() => clearTimeout(timer));
};
export async function codecSupport(Codec, codec, encode = false) {
  if (!Codec?.isConfigSupported) return { supported: null, hardwareHint: null, softwareHint: null, error: 'API unavailable' };
  const base = encode ? { codec, width: 640, height: 360, bitrate: 1000000, framerate: 30 } : { codec, codedWidth: 640, codedHeight: 360 };
  async function query(hardwareAcceleration) {
    try { return Boolean((await bounded(Codec.isConfigSupported({ ...base, hardwareAcceleration }))).supported); }
    catch { return null; }
  }
  const [supported, hardwareHint, softwareHint] = await Promise.all(['no-preference', 'prefer-hardware', 'prefer-software'].map(query));
  return { supported, hardwareHint, softwareHint };
}
export async function collectBrowserInfo(nav = navigator, makeCanvas = () => document.createElement('canvas'), environment = globalThis) {
  const details = {
    userAgent: nav.userAgent, platform: nav.platform, language: nav.language,
    cpus: nav.hardwareConcurrency, memoryGiB: nav.deviceMemory ?? 'Not exposed',
    isolated: environment.crossOriginIsolated, secure: environment.isSecureContext,
    webgpu: { available: Boolean(nav.gpu), status: 'API unavailable' }, webgl: {}, codecs: [],
  };
  const gpu = (async () => {
    if (!nav.gpu) return;
    try {
      const adapter = await bounded(nav.gpu.requestAdapter());
      details.webgpu.status = adapter ? 'Adapter available' : 'No adapter available';
      if (adapter) {
        const info = adapter.info ?? (adapter.requestAdapterInfo ? await bounded(adapter.requestAdapterInfo()) : {});
        details.webgpu.adapter = Object.fromEntries(['vendor','architecture','device','description'].map(key => [key, info[key] || 'Not exposed']));
        details.webgpu.fallback = adapter.isFallbackAdapter ?? info.isFallbackAdapter ?? 'Not exposed';
      }
    } catch (error) { details.webgpu.status = error.message; }
  })();
  for (const name of ['webgl2', 'webgl']) {
    let gl;
    try {
      gl = makeCanvas().getContext(name);
      if (!gl) { details.webgl[name] = { status: 'Unavailable' }; continue; }
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      details.webgl[name] = { status: 'Context available', vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), model: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), identity: debug ? 'Browser-exposed identity' : 'Masked browser identity', version: gl.getParameter(gl.VERSION) };
    } catch (error) { details.webgl[name] = { status: error.message }; }
    finally { gl?.getExtension('WEBGL_lose_context')?.loseContext(); }
  }
  const codecs = Promise.all(VIDEO_CODECS.map(async ([name, codec]) => ({ name, codec, decoder: await codecSupport(environment.VideoDecoder, codec), encoder: await codecSupport(environment.VideoEncoder, codec, true) })));
  await gpu; details.codecs = await codecs;
  return details;
}
// Each demo owns its canvas, context and device. Nothing here touches the guest.
export function startRenderingDemo(parent, api, environment = globalThis) {
  const document = parent.ownerDocument, view = document.createElement('div');
  view.className = 'info-render-demo'; view.dataset.api = api;
  const makeCanvas = () => { const element = document.createElement('canvas'); element.width = 160; element.height = 90; element.setAttribute('aria-label', `wgpu ${api === 'webgpu' ? 'WebGPU' : 'WebGL2'} live rotating triangle`); return element; };
  let canvas = makeCanvas();
  const label = `wgpu · ${api === 'webgpu' ? 'WebGPU' : 'WebGL2'}`;
  const fps = document.createElement('output'); fps.className = 'info-demo-fps'; fps.textContent = 'Click to start';
  const status = document.createElement('p'); status.textContent = `${label} · click or press Enter/Space to render for 10 seconds.`;
  view.tabIndex = 0; view.setAttribute('role','button'); view.setAttribute('aria-label', `Run ${label} rendering demo for 10 seconds`); view.dataset.state = 'idle';
  view.append(canvas, fps, status); parent.append(view);
  let removed = false, stopRun;
  function start() { if (removed || stopRun) return; const fresh = makeCanvas(); canvas.replaceWith(fresh); canvas = fresh; view.setAttribute('aria-busy','true'); view.dataset.state = 'initializing'; fps.textContent = 'Starting…'; status.textContent = 'Initializing actual rendering…'; stopRun = runRenderingDemo({view,canvas,fps,status,api,environment,finished:()=>{stopRun=null;view.removeAttribute('aria-busy');}}); }
  view.addEventListener('click',start);
  view.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();start();}});
  return () => { if (removed) return; removed = true; stopRun?.(); view.remove(); };
}
function runRenderingDemo({ view, canvas, fps, status, api, environment, finished }) {
  const document = view.ownerDocument;
  let disposed = false, frame = 0, deadline, render, release = () => {}, frames = 0, intervalFrames = 0, lastDraw = -Infinity, intervalStart = 0, backend = '';
  delete view.dataset.frames; delete view.dataset.backend;
  const alive = () => !disposed && view.isConnected;
  const stop = () => { if (disposed) return; disposed = true; environment.cancelAnimationFrame(frame); clearTimeout(deadline); document.removeEventListener('visibilitychange',visibility); render = null; try { release(); } finally { finished(); } };
  const fail = error => { if (!alive()) return; stop(); fps.textContent = 'Unavailable'; status.textContent = `${api} rendering unavailable: ${error.message || error} · click to retry`; view.dataset.state = 'error'; };
  async function tick(now) {
    if (!alive() || document.hidden || !render) return;
    try {
      if (now - lastDraw >= 1000 / 30) {
        await render(now / 1000); if (!alive()) return; lastDraw = now; frames++; intervalFrames++; view.dataset.frames = String(frames);
        if (!intervalStart) intervalStart = now;
        if (now - intervalStart >= 1000) { fps.textContent = `${(intervalFrames * 1000 / (now - intervalStart)).toFixed(1)} FPS`; intervalStart = now; intervalFrames = 0; }
      }
      frame = environment.requestAnimationFrame(tick);
    } catch (error) { fail(error); }
  }
  function visibility() { if (!alive()) return; if (document.hidden) { stop(); view.dataset.state = 'stopped'; status.textContent = 'Rendering stopped while page hidden · click to run again.'; } }
  document.addEventListener('visibilitychange', visibility);
  (async () => {
    const factory = environment.createInfoWgpuRenderer ?? createInfoWgpuRenderer;
    const renderer = factory({ canvas, backend: api, environment });
    release = () => renderer.close();
    const ready = await renderer.ready;
    if (!alive()) return;
    const adapter = ready.adapter;
    const expected = api === 'webgpu' ? 'BrowserWebGpu' : 'Gl';
    if (adapter.backend !== expected) throw new Error(`Requested ${api}, wgpu selected ${adapter.backend}`);
    backend = `wgpu · ${api === 'webgpu' ? 'WebGPU' : 'WebGL2'} · ${adapter.name || 'identity not exposed'} · device type ${adapter.deviceType || 'Unknown'}`;
    view.dataset.backend = adapter.backend;
    render = time => renderer.draw(time);
    if (!alive()) { release(); return; }
    status.textContent = `${backend} · rendering for 10 seconds, up to 30 frames/s. FPS includes readback and presentation.`; view.dataset.state = 'rendering'; fps.textContent = 'Measuring…';
    deadline = setTimeout(() => { stop(); view.dataset.state = 'completed'; status.textContent = `${backend} · 10-second rendering finished · click to run again.`; },10000);
    if (document.hidden) visibility(); else frame = environment.requestAnimationFrame(tick);
  })().catch(fail);
  return stop;
}
export function installBrowserInfo({ dialog, content, close, toggle }) {
  let generation = 0, demos = [], visible = false;
  const dispose = () => { visible = false; generation++; for (const stop of demos) stop(); demos = []; };
  const row = (table, name, value) => {
    const tr = document.createElement('tr'), title = document.createElement('th'), cell = document.createElement('td');
    title.scope = 'row'; title.textContent = name; cell.textContent = String(value ?? 'Unknown'); tr.append(title, cell); table.append(tr);
  };
  const section = (name, values) => {
    const heading = document.createElement('h3'), table = document.createElement('table'); heading.textContent = name;
    for (const [key,value] of Object.entries(values)) row(table,key,value);
    content.append(heading,table);
  };
  const yes = value => value === null ? 'Unknown' : value ? 'Supported' : 'Unsupported';
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { dispose(); toggle.focus(); });
  // External hide/remove and page navigation share the same cleanup path.
  const observer = new MutationObserver(() => { if (visible && (!dialog.open || dialog.hidden || !dialog.isConnected || !dialog.getClientRects().length || (dialog.checkVisibility && !dialog.checkVisibility({ visibilityProperty: true })))) dispose(); });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['open','hidden','style','class'] });
  window.addEventListener('pagehide', dispose);
  return async () => {
    dispose(); const own = generation; content.textContent = 'Checking browser capabilities…'; if (!dialog.open) dialog.showModal(); visible = true;
    try {
      const info = await collectBrowserInfo(); if (generation !== own) return;
      content.replaceChildren();
      section('Host browser', { 'User agent': info.userAgent, Platform: info.platform, Language: info.language, 'Logical CPUs': info.cpus, 'Device memory (GiB)': info.memoryGiB, 'Secure context': info.secure, 'Cross-origin isolated': info.isolated });
      section('WebGPU', { Status: info.webgpu.status, ...(info.webgpu.adapter || {}), 'Fallback adapter': info.webgpu.fallback ?? 'Not exposed' });
      demos.push(startRenderingDemo(content,'webgpu'));
      for (const [name, values] of Object.entries(info.webgl)) { section(name === 'webgl2' ? 'WebGL 2' : 'WebGL 1',values); if (name === 'webgl2') demos.push(startRenderingDemo(content,'webgl'));  }
      const heading=document.createElement('h3');heading.textContent='Video codecs';
      const explanation=document.createElement('p');explanation.textContent='Configuration probes: 640 × 360, encoder 30 fps at 1 Mb/s. Codec support varies by profile, level and settings. Hardware use is unknown: the browser may ignore hardware preferences, and these checks do not encode or decode video.';
      const scroll=document.createElement('div');scroll.className='info-table-scroll';const table=document.createElement('table');
      const head=document.createElement('thead'),titles=document.createElement('tr');
      for(const text of ['Codec / profile','Direction','Support','Hardware preference hint','Software preference hint','Actual hardware use']) { const th=document.createElement('th');th.scope='col';th.textContent=text;titles.append(th); }head.append(titles);table.append(head);
      const body=document.createElement('tbody');
      for(const item of info.codecs) for(const direction of ['decoder','encoder']) {
        const tr=document.createElement('tr'), values=[item.name+' · '+item.codec,direction,yes(item[direction].supported),yes(item[direction].hardwareHint),yes(item[direction].softwareHint),'Unknown'];
        for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}body.append(tr);
      }
      table.append(body);scroll.append(table);content.append(heading,explanation,scroll);
    } catch(error) { if(generation===own)content.textContent='Browser information unavailable: '+error.message; }
  };
}
