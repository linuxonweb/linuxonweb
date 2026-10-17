export function installStartupTiming(api, clock, emit, maxEvents = 4096) {
  let sequence = 0, delivered = 0;
  const moduleSizes = new WeakMap();
  const memoryBuffer = Object.getOwnPropertyDescriptor(api.Memory?.prototype ?? {}, 'buffer')?.get;
  const publish = event => {
    if (delivered >= maxEvents) return;
    delivered++;
    try { emit(event); } catch {}
  };
  for (const operation of ['Module', 'Instance', 'Memory']) {
    if (typeof api[operation] !== 'function') continue;
    api[operation] = new Proxy(api[operation], {
      construct(target, args, newTarget) {
        const id = ++sequence;
        const start = clock.now();
        const bytes = operation === 'Module' ? args[0]?.byteLength
          : operation === 'Instance' ? moduleSizes.get(args[0]) : undefined;
        publish({ id, operation, phase: 'begin', bytes, timestampMs: clock.timeOrigin + start });
        let ok = false;
        let memoryBytes;
        try {
          const value = Reflect.construct(target, args, newTarget);
          ok = true;
          if (operation === 'Module') moduleSizes.set(value, bytes);
          if (operation === 'Memory' && memoryBuffer) {
            try { memoryBytes = memoryBuffer.call(value).byteLength; } catch {}
          }
          return value;
        } finally {
          const end = clock.now();
          publish({ id, operation, phase: 'end', bytes, memoryBytes, ok, timestampMs: clock.timeOrigin + end, durationMs: end - start });
        }
      },
    });
  }
}

export function startupMemoryPlan(config) {
  if (config.ramMiB !== undefined && ![1024, 2048, 4096].includes(config.ramMiB)) throw Error('Invalid host probe RAM choice');
  if (config.memoryDiagnostic === undefined || config.memoryDiagnostic === false) {
    return config.ramMiB === undefined ? null : { ramMiB: config.ramMiB, resolution: '1280x720', query: '', diagnosticOnly: true };
  }
  if (config.memoryDiagnostic !== true || config.timing !== true || config.candidate !== true || config.jitArm || config.trace || config.workerPool) {
    throw Error('Memory diagnostics require candidate timing without JIT, tracing or worker-pool changes');
  }
  if (config.ramMiB !== undefined && config.ramMiB !== 1024) throw Error('RAM choice conflicts with constructor memory diagnostic');
  return { ramMiB: 1024, resolution: '800x600', query: '&gpu=0&compressed-initramfs=1', diagnosticOnly: true };
}

export function instrumentStartupSource(kind, source) {
  let anchor, replacement;
  if (kind === 'worker') {
    anchor = 'const postMessage = channel.post;';
    replacement = `${anchor}
import { installStartupTiming } from './gpt6-codex-timing.mjs';
installStartupTiming(WebAssembly, performance, event => postMessage({
    type: '__gpt6StartupTiming',
    event: { ...event, worker: globalThis.name, workerOrigin: performance.timeOrigin },
}));`;
  } else if (kind === 'platform') {
    anchor = 'worker.onmessage = (event) => handlers.on_message(event.data);';
    replacement = `worker.onmessage = (event) => {
            if (event.data?.type === '__gpt6StartupTiming') {
                const rows = globalThis.__gpt6StartupTimings ??= [];
                if (rows.length < 20000) rows.push(event.data.event);
                return;
            }
            handlers.on_message(event.data);
        };`;
  } else {
    throw Error('Unknown startup instrumentation kind');
  }
  if (source.split(anchor).length !== 2) throw Error(`Expected exactly one ${kind} timing anchor`);
  return source.replace(anchor, replacement);
}
