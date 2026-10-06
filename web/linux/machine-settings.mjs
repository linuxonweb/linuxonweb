// Saved machine settings are restored field by field, so one value that no
// longer fits this host (such as more cores than this browser now reports)
// does not discard the user's other choices, in particular memory.
export function restoreConfiguration(saved, defaults, { resolutions, ramValues, maxCpus }) {
  const configuration = { ...defaults };
  if (!saved || typeof saved !== 'object') return { configuration, ramChosen: false };
  if (resolutions.includes(saved.resolution)) configuration.resolution = saved.resolution;
  if (Number.isInteger(saved.cpus) && saved.cpus >= 1 && saved.cpus <= maxCpus) configuration.cpus = saved.cpus;
  const ramChosen = ramValues.includes(saved.ram);
  if (ramChosen) configuration.ram = saved.ram;
  // Records without the current presentation version saved 'canvas2d' as the old
  // default, not as a choice; they now start with the WebGPU default.
  const oldDefault = saved.backend === 'canvas2d' && saved.presentationVersion !== PRESENTATION_VERSION;
  if (['canvas2d', 'auto', 'webgl'].includes(saved.backend) && !oldDefault) configuration.backend = saved.backend;
  return { configuration, ramChosen };
}

// Display presentation defaults to "auto" (WebGPU). Saved records carry this
// version so an explicit Canvas 2D choice is told apart from the old default.
export const PRESENTATION_VERSION = 2;
export function settingsRecord(configuration) {
  return { ...configuration, presentationVersion: PRESENTATION_VERSION };
}

// Firefox asks for memory only while the user has not chosen any and the
// default may not fit the boot image; a saved choice is never asked again.
export function needsFirefoxMemoryChoice(mode, ram, ramChosen) {
  return mode === 'firefox' && !ramChosen && ![1024, 2048].includes(ram);
}

// Display presentation: "auto" means WebGPU. When WebGPU fails the page asks
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
  if (detail.fallbackReason) text += ` · ${presenterNames[detail.requested] ?? detail.requested} failed: ${detail.fallbackReason}`;
  return text;
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
    && active.cpus === next.cpus && active.ram === next.ram;
}
