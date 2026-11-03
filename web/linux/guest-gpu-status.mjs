// Report observed runtime identity without equating an API name with conformance
// or hardware acceleration. The display presenter has its own status/control.
export function newGuestGpuState(backend = 'webgpu') {
  return { selectedBackend: backend, glRenderer: null, vulkanBackend: null, vulkanAdapter: null, vulkanFailure: null };
}
export function observeGuestGpuMessage(state, message) {
  const text = String(message);
  const gl = /gl context \d+ open: (.+)/.exec(text);
  if (gl) return { ...state, glRenderer: gl[1].slice(0, 320) };
  const vk = /(?:vk|gputest:) session \d+ backend=([^\s]+) adapter=(\{.*\})/.exec(text);
  if (vk) {
    try {
      const adapter = JSON.parse(vk[2]);
      const identity = [adapter.description || adapter.name, adapter.vendor, adapter.architecture].filter(v => typeof v === 'string' && v.trim()).join(' · ');
      const software = adapter.fallback === true || adapter.isFallbackAdapter === true || adapter.deviceType === 'Cpu';
      return { ...state, vulkanBackend: vk[1], vulkanAdapter: (identity || 'identity not exposed') + (software ? ' · software adapter' : ''), vulkanFailure: null };
    } catch { return state; }
  }
  const failed = /(?:vk|gputest:) session \d+ failed: (.+)/.exec(text)
    || /(?:vk|gputest:) session \d+ closed[^\n]* error=(.+)/.exec(text);
  return failed ? { ...state, vulkanFailure: failed[1].slice(0, 320) } : state;
}
export function guestGpuLabels(state) {
  const names = { webgpu: 'WebGPU', webgl: 'WebGL', BrowserWebGpu: 'WebGPU', Gl: 'WebGL' };
  return {
    gl: state.glRenderer ? `GLES bridge → WebGL2 · ${state.glRenderer}` : 'GLES bridge → WebGL2 · waiting for an application',
    vulkan: state.vulkanFailure
      ? `Vulkan subset unavailable: ${state.vulkanFailure}. Choose a backend in settings; no automatic switch.`
      : state.vulkanBackend ? `Vulkan subset → ${names[state.vulkanBackend] ?? state.vulkanBackend} · ${state.vulkanAdapter}`
        : `Vulkan subset → ${state.selectedBackend === 'webgl' ? 'WebGL' : 'WebGPU'} selected · waiting for an application`,
  };
}
