// Explicit desktop opt-in to the common Rust Vulkan service. Backend selection
// comes from the explicit active setting, mirrored in the gpubackend URL.
export function guestGpuOwnerConfig(search, gpuBackend = 'webgpu') {
  // ?debug=1 also logs guest GL remote call rates every 5 s of activity.
  const gl = new URLSearchParams(search).get('debug') === '1' ? { gl: { stats: true } } : {};
  return { ...gl, ...vulkanOwnerConfig(search, gpuBackend === 'webgl' ? 'webgl' : 'webgpu') };
}
function vulkanOwnerConfig(search, gpuBackend) {
  if (new URLSearchParams(search).get('gpuruntime') !== 'rust') {
    // The direct WebGPU renderer has 512 colour/depth targets and direct presentation.
    // Large sampled colour targets require the direct WebGPU probe. The WebGL
    // backend must not request them: it has neither that probe nor Rust resources.
    const options = new URLSearchParams(search), large = options.get('gpulargetargets') !== '0';
    return { vk: { backend: gpuBackend, ...(large ? { allowLargeColorTargets: true,
      ...(gpuBackend === 'webgpu' && options.get('gpulargesampledtargets') !== '0' ? { allowLargeSampledTargets: true } : {}) } : {}) } };
  }
  const wgpuBackend = gpuBackend === 'webgl' ? 'webgl' : 'webgpu';
  const options = new URLSearchParams(search);
  return { vk: { backend: 'wgpu', wgpuBackend, allowResources: true,
    ...(options.get('gpulargetargets') === '1' ? { allowLargeColorTargets: true } : {}),
    ...(options.get('gpudepthstencil') === '1' ? { allowDepthStencil: true } : {}),
    ...(options.get('gpulargesampledtargets') === '1' ? { allowLargeSampledTargets: true } : {}),
  } };
}

// Match the accepted native Rust renderer's synchronous shader guard. The
// ordinary hostcall path continues to use its existing default guard.
export function guestGpuHostcallOptions(search, gpuBackend = 'webgpu') {
  const ownerConfig = guestGpuOwnerConfig(search, gpuBackend);
  return ownerConfig.vk.backend === 'wgpu' ? { ownerConfig, stallMs: 30000 } : { ownerConfig };
}

// Preserve unrelated query parameters and make the active guest backend explicit.
export function guestGpuUrl(href, backend) {
  if (!['webgpu', 'webgl'].includes(backend)) throw new TypeError('unsupported guest GPU backend');
  const url = new URL(href);
  url.searchParams.set('gpubackend', backend);
  return url.href;
}
