// Explicit desktop opt-in to the common Rust Vulkan service. Backend selection
// still comes from the existing gpubackend parser; no setting is persisted.
export function guestGpuOwnerConfig(search, gpuBackend = 'auto') {
  if (new URLSearchParams(search).get('gpuruntime') !== 'rust')
    return { vk: { backend: gpuBackend } };
  const wgpuBackend = ['auto', 'webgpu', 'webgl'].includes(gpuBackend) ? gpuBackend : 'auto';
  return { vk: { backend: 'wgpu', wgpuBackend, allowResources: true } };
}

// Match the accepted native Rust renderer's synchronous shader guard. The
// ordinary hostcall path continues to use its existing default guard.
export function guestGpuHostcallOptions(search, gpuBackend = 'auto') {
  const ownerConfig = guestGpuOwnerConfig(search, gpuBackend);
  return ownerConfig.vk.backend === 'wgpu' ? { ownerConfig, stallMs: 30000 } : { ownerConfig };
}
