export function jitRuntimePlan(config) {
  if (config.jitRuntime !== undefined && config.jitRuntime !== 'worker-pool') {
    throw Error('Invalid JIT runtime variant');
  }
  if (!config.jitArm) {
    if (config.jitRuntime) throw Error('Runtime selection requires an explicit JIT arm');
    return null;
  }
  if (!['off', 'ic', 'method'].includes(config.jitArm)) throw Error('Invalid JIT arm');
  if (config.trace || config.timing) throw Error('JIT diagnostics cannot include startup instrumentation');
  if (config.jitRuntime === 'worker-pool') {
    if (config.candidate !== true || config.workerPool !== true || config.jitIdentity !== true) {
      throw Error('Worker-pool JIT runtime requires candidate, pool and native identity');
    }
    return { variant: 'worker-pool-lifetime', changedRuntime: true, jitAcceptance: false };
  }
  if (config.workerPool) throw Error('Worker-pool JIT runtime requires explicit selection');
  return { variant: 'frozen-runtime', changedRuntime: false, jitAcceptance: false };
}

export function candidateFiles({ candidate, workerPool }) {
  if (workerPool && !candidate) throw Error('Worker pool requires the candidate variant');
  if (!candidate) return [];
  return [
    'main.js', 'desktop-extras.mjs', 'firefox-jit-config.mjs',
    ...(workerPool ? ['dist/index.js', 'dist/worker.js', 'dist/wasm.js', 'dist/worker-pool.mjs'] : []),
  ];
}
