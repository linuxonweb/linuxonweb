// Saved machine settings are restored field by field, so one value that no
// longer fits this host (such as more cores than this browser now reports)
// does not discard the user's other choices, in particular memory.
export function restoreConfiguration(saved, defaults, { resolutions, ramValues, maxCpus }) {
  const configuration = { ...defaults };
  if (!saved || typeof saved !== 'object') return { configuration, ramChosen: false };
  if (resolutions.includes(saved.resolution)) configuration.resolution = saved.resolution;
  // Records without the current CPU version saved 2 as the old default (also
  // when only the Firefox memory choice was saved); they now get the new default.
  const oldCpuDefault = saved.cpus === 2 && saved.cpuVersion !== CPU_VERSION;
  if (Number.isInteger(saved.cpus) && saved.cpus >= 1 && saved.cpus <= maxCpus && !oldCpuDefault) configuration.cpus = saved.cpus;
  const ramChosen = ramValues.includes(saved.ram);
  if (ramChosen) configuration.ram = saved.ram;
  // Records without the current presentation version saved 'canvas2d' as the old
  // default, not as a choice; they now start with the WebGPU default.
  const oldDefault = saved.backend === 'canvas2d' && saved.presentationVersion !== PRESENTATION_VERSION;
  if (['canvas2d', 'auto', 'webgpu', 'webgl'].includes(saved.backend) && !oldDefault) configuration.backend = saved.backend;
  if ('guestBackend' in defaults && ['webgpu', 'webgl'].includes(saved.guestBackend)) configuration.guestBackend = saved.guestBackend;
  return { configuration, ramChosen };
}

// The page URL's "renderer" parameter and the Settings display presentation
// stay in sync: a valid parameter selects the presentation for this page load,
// and the URL always shows the active one. "webgpu" stays an Auto alias because
// earlier pages wrote it for Auto; "webgpu-only" is the explicit WebGPU choice.
const RENDERER_PARAMS = { webgpu: 'auto', auto: 'auto', 'webgpu-only': 'webgpu', webgl: 'webgl', canvas2d: 'canvas2d' };
export function presentationFromUrl(search) {
  return RENDERER_PARAMS[new URLSearchParams(search).get('renderer')] ?? null;
}
export function presentationUrl(href, backend) {
  const url = new URL(href);
  url.searchParams.set('renderer', backend === 'webgpu' ? 'webgpu-only' : backend);
  return url.href;
}

// Display presentation defaults to "auto" (WebGPU). Saved records carry this
// version so an explicit Canvas 2D choice is told apart from the old default.
export const PRESENTATION_VERSION = 2;
export const CPU_VERSION = 1;
export function settingsRecord(configuration) {
  return { ...configuration, presentationVersion: PRESENTATION_VERSION, cpuVersion: CPU_VERSION };
}

// Firefox asks for memory only while the user has not chosen any and the
// default may not fit the boot image; a saved choice is never asked again.
export function needsFirefoxMemoryChoice(mode, ram, ramChosen) {
  return mode === 'firefox' && !ramChosen && ![1024, 2048].includes(ram);
}

// Display presentation: "auto" tries WebGPU and continues with WebGL or Canvas 2D
// when it does not work. When an explicit "webgpu" choice fails the page asks
// the user for one of these instead of falling back on its own.
export const PRESENTATION_FALLBACKS = ['webgl', 'canvas2d'];
const presenterNames = { webgpu: 'WebGPU', webgl: 'WebGL', canvas2d: 'Canvas 2D' };

// Short Settings status for a framebuffer-backend event detail.
export function presentationStatus(detail) {
  if (!detail) return '';
  if (detail.awaitingChoice) return `WebGPU not working: ${detail.failure || 'unknown reason'} · display paused`;
  if (detail.backend === 'none') return 'starting WebGPU…';
  let text = presenterNames[detail.backend] ?? String(detail.backend);
  if (detail.backend === 'webgpu' && detail.fallbackAdapter === true) text += ' · software fallback adapter';
  if (detail.webgpuSkipped) text += ` · Auto skipped WebGPU: ${detail.webgpuSkipped}`;
  if (detail.fallbackReason) text += ` · ${presenterNames[detail.backend === 'canvas2d' && detail.webgpuSkipped ? 'webgl' : detail.requested] ?? detail.requested} failed: ${detail.fallbackReason}`;
  return text;
}

// Non-blocking notice when Auto continued without WebGPU, or null.
export function autoFallbackNotice(detail) {
  if (!detail || detail.requested !== 'auto' || !detail.webgpuSkipped || detail.backend === 'none') return null;
  const name = presenterNames[detail.backend] ?? String(detail.backend);
  return `Display uses ${name}: WebGPU is not working in this browser (${detail.webgpuSkipped}). Auto tries WebGPU again on the next page load.`;
}

// The dialog's return value, or null when the user cancelled.
export function presentationChoice(returnValue) {
  return PRESENTATION_FALLBACKS.includes(returnValue) ? returnValue : null;
}

// Settings to save after a presentation choice. A memory size the user never
// chose stays unsaved, so Firefox still offers its memory choice later.
export function withPresentationChoice(configuration, backend, ramChosen) {
  const saved = settingsRecord({ ...configuration, backend });
  if (!ramChosen) delete saved.ram;
  return saved;
}

// Only the presenter differs, so a running guest can switch without restarting.
export function displayOnlyChange(active, next) {
  return active.backend !== next.backend && active.resolution === next.resolution
    && active.cpus === next.cpus && active.ram === next.ram
    && (active.guestBackend ?? 'webgpu') === (next.guestBackend ?? 'webgpu');
}
