// `?gputest=1` host wiring: serve the guest Vulkan ICD protocol over
// virtio-vsock with host WebGPU (high-performance adapter), falling back to
// WebGL2 when WebGPU cannot be acquired. Inactive without the query parameter.

/** Guest port the ICD listens on (guest-gpu.c gpu_accept). */
export const GPUTEST_VSOCK_PORT = 4050;
/** Optional demo archive, appended to the initramfs when present. */
export const GPUTEST_CPIO_URL = new URL('./gpu/gputest.cpio', import.meta.url);
export const GPUTEST_RDINIT = '/gputest-init';
/** Exact accepted translator artifacts (A4/A5; see tests/guest-vulkan-webgl/host.mjs). */
export const GPUTEST_TRANSLATORS = Object.freeze({
  wgsl: Object.freeze({ url: new URL('./gpu/wgsl.wasm', import.meta.url), sha256: '5b78ad4937a5f04011fdc8000207009a5fb4d51f41fc1c7af6ce6a303e67fca5' }),
  glsl: Object.freeze({ url: new URL('./gpu/glsl.wasm', import.meta.url), sha256: '5bf9d0be09b14b2ffdf40efcc4fabf872b2717b658c87039c76ae51efc3740c5' }),
});

export function gputestEnabled(search = globalThis.location?.search ?? '') {
  return new URLSearchParams(search).get('gputest') === '1';
}

/**
 * `?gputestapp=` selects an allowlisted demo archive (default `cube`, the
 * gputest.cpio Vulkan cube). Unknown values fall back to the default.
 */
export const GPUTEST_APPS = Object.freeze({
  cube: GPUTEST_CPIO_URL,
  glgears: new URL('./gpu/gputest-glgears.cpio', import.meta.url),
  vkgears: new URL('./gpu/gputest-vkgears.cpio', import.meta.url),
});
export function gputestAppParam(search = globalThis.location?.search ?? '') {
  const value = (new URLSearchParams(search).get('gputestapp') || '').toLowerCase();
  return Object.hasOwn(GPUTEST_APPS, value) ? value : 'cube';
}

/**
 * Kernel command-line flags for the selected demo's waiter (read from
 * /proc/cmdline after X is up). glgears: `&gldriver=softpipe|zink` (default
 * softpipe), `&glmode=bench|present|nopresent` (default bench) and optional
 * `&glsize=WxH` (1..4096 each, default 300x300). vkgears
 * (Vulkan on the guest ICD, no Mesa driver): `&vkmode=bench|present|nopresent`
 * (default: `glmode`, else bench) and optional `&vksize=WxH` (1..4096 each).
 * Only allowlisted values are passed through.
 */
export const GL_DRIVERS = Object.freeze(['softpipe', 'zink']);
export const GL_MODES = Object.freeze(['bench', 'present', 'nopresent']);
export function gputestCmdlineFlags(search = globalThis.location?.search ?? '') {
  const app = gputestAppParam(search);
  if (app === 'cube') return [];
  const params = new URLSearchParams(search);
  if (app === 'vkgears') {
    const vkmode = (params.get('vkmode') || params.get('glmode') || '').toLowerCase();
    const flags = [`gputest.app=${app}`, `gputest.vkmode=${GL_MODES.includes(vkmode) ? vkmode : 'bench'}`];
    const size = sizeParam(params, 'vksize');
    if (size) flags.push(`gputest.vksize=${size}`);
    return flags;
  }
  const driver = (params.get('gldriver') || '').toLowerCase();
  const mode = (params.get('glmode') || '').toLowerCase();
  const flags = [`gputest.app=${app}`, `gputest.gldriver=${GL_DRIVERS.includes(driver) ? driver : 'softpipe'}`,
    `gputest.glmode=${GL_MODES.includes(mode) ? mode : 'bench'}`];
  const size = sizeParam(params, 'glsize');
  if (size) flags.push(`gputest.glsize=${size}`);
  return flags;
}

function sizeParam(params, name) {
  const size = /^([1-9]\d{0,3})x([1-9]\d{0,3})$/.exec((params.get(name) || '').toLowerCase());
  return size && +size[1] <= 4096 && +size[2] <= 4096 ? `${size[1]}x${size[2]}` : null;
}

/**
 * `?gpubackend=webgpu|webgl` forces the host backend for tests: `webgpu`
 * disables the WebGL2 fallback, `webgl` skips WebGPU acquisition. Anything
 * else (or absent) is `auto`: WebGPU first, WebGL2 on acquisition failure.
 */
export const GPU_BACKENDS = Object.freeze(['auto', 'webgpu', 'webgl']);
export function gpuBackendParam(search = globalThis.location?.search ?? '') {
  const value = (new URLSearchParams(search).get('gpubackend') || '').toLowerCase();
  if (value === 'webgl2') return 'webgl';
  return GPU_BACKENDS.includes(value) ? value : 'auto';
}

/** Fetches the demo archive; null (logged) when absent or unavailable. */
export async function loadGputestArchive(log, fetchImpl = fetch, url = GPUTEST_CPIO_URL) {
  let response;
  try { response = await fetchImpl(url, { cache: 'no-store' }); }
  catch (error) { log(`gputest: ${url.pathname} unavailable (${error.message}); normal boot`); return null; }
  if (!response.ok) { log(`gputest: ${url.pathname} HTTP ${response.status}; normal boot`); return null; }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Every newc header starts with "070701"; reject HTML fallbacks and gzip.
  if (bytes.length < 110 || new TextDecoder().decode(bytes.subarray(0, 6)) !== '070701') {
    log(`gputest: ${url.pathname} is not an uncompressed newc CPIO; normal boot`, 'error');
    return null;
  }
  log(`gputest: appending ${bytes.length}-byte demo archive, rdinit=${GPUTEST_RDINIT}`);
  return bytes;
}

/** Concatenates newc archives; the kernel unpacks each after zero padding. */
export function appendCpio(base, extra) {
  const offset = Math.ceil(base.byteLength / 4) * 4;
  const out = new Uint8Array(offset + extra.byteLength);
  out.set(base, 0); out.set(extra, offset);
  return out;
}

/**
 * Accepts guest GPU sessions until stopped: retry connect(4050), serve one
 * session, then wait for the next listener. `wake()` retries immediately
 * (e.g. when the guest prints GUEST_GPU_LISTENING).
 */
export function startGpuHost({ vsock, log, gpu = globalThis.navigator?.gpu, backend = 'auto', retryMs = 2000, connectTimeoutMs = 3000, importHost } = {}) {
  if (!GPU_BACKENDS.includes(backend)) throw new TypeError(`unknown GPU backend ${backend}`);
  // Forced WebGL: serveGPU sees no WebGPU API and takes its WebGL2 path.
  const serveGpu = backend === 'webgl' ? null : gpu;
  const allowWebGL = backend !== 'webgpu';
  const describe = backend === 'webgpu' ? `forced WebGPU (${gpu ? 'available' : 'unavailable'}), no WebGL2 fallback`
    : backend === 'webgl' ? 'forced WebGL2'
    : `WebGPU ${gpu ? 'available' : 'unavailable'}, WebGL2 fallback`;
  let stopped = false, wakeUp = null, sessions = 0, lastFailure = '';
  const wake = () => { const resolve = wakeUp; wakeUp = null; resolve?.(); };
  const pause = ms => new Promise(resolve => { const timer = setTimeout(() => { wakeUp = null; resolve(); }, ms); wakeUp = () => { clearTimeout(timer); resolve(); }; });
  const done = (async () => {
    const { serveGPU } = await (importHost ? importHost() : import('./tests/guest-gpu/host.mjs'));
    log(`gputest: waiting for guest GPU listener on vsock port ${GPUTEST_VSOCK_PORT} (gpubackend=${backend}: ${describe})`);
    while (!stopped) {
      let connection;
      try { connection = await vsock.connect(GPUTEST_VSOCK_PORT, { timeoutMs: connectTimeoutMs }); }
      catch (error) {
        if (stopped) break;
        // Log each distinct failure once; "guest reset" is the normal not-listening reply.
        if (error.message !== lastFailure) { lastFailure = error.message; log(`gputest: connect retry (${error.message})`); }
        await pause(retryMs); continue;
      }
      lastFailure = ''; const session = ++sessions;
      log(`gputest: session ${session} connected`);
      try {
        const report = await serveGPU(connection, {
          gpu: serveGpu, allowGraphics: true, allowWebGL, allowUniforms: true, allowTextures: true, allowDepth: true,
          timeoutMs: 0x7fffffff, // demo sessions are long-lived; closed by guest or machine
          graphicsTranslatorOptions: GPUTEST_TRANSLATORS.wgsl, webglTranslatorOptions: GPUTEST_TRANSLATORS.glsl,
          onEvent(event) {
            if (event.type === 'adapter') log(`gputest: session ${session} backend=${event.backend} adapter=${JSON.stringify({ vendor: event.vendor, architecture: event.architecture, description: event.description, fallback: event.isFallbackAdapter })}`);
          },
        });
        log(`gputest: session ${session} closed commands=${report.commands} passes=${report.graphicsPasses} draws=${report.graphicsDraws} readbacks=${report.graphicsReadbacks}${report.acquisitionError && backend !== 'webgl' ? ` webgpu-unavailable=${JSON.stringify(report.acquisitionError)}` : ''}${report.error ? ` error=${JSON.stringify(report.error)}` : ''}`);
      } catch (error) {
        if (!stopped) log(`gputest: session ${session} failed: ${error.message}`, 'error');
      } finally { try { connection.close(); } catch { /* already closed */ } }
    }
  })();
  return {
    wake,
    stop() { stopped = true; wake(); },
    get sessions() { return sessions; },
    done: done.catch(error => { log(`gputest: host loop failed: ${error?.stack || error}`, 'error'); }),
  };
}
