// Own only this fixture's adapter/device/connection. Renderer implementation is
// reused without changing the guest-gpu protocol or its existing behavior.
import {serveGPU} from '../guest-gpu/host.mjs';

export async function serveLifecycle(connection, mode, onEvent) {
  const ownership = {devicesCreated: 0, devicesDestroyed: 0, connectionsClosed: 0};
  const transport = {
    readExactly: size => connection.readExactly(size),
    write: bytes => connection.write(bytes),
    close() { ownership.connectionsClosed++; connection.close(); },
  };
  const nativeGPU = navigator.gpu;
  const gpu = mode === 'unavailable' ? null : nativeGPU && {
    async requestAdapter(options) {
      const adapter = await nativeGPU.requestAdapter(options);
      if (!adapter) return null;
      return {
        info: adapter.info,
        isFallbackAdapter: adapter.isFallbackAdapter,
        async requestDevice(descriptor) {
          const device = await adapter.requestDevice(descriptor);
          ownership.devicesCreated++;
          return new Proxy(device, {
            get(target, key) {
              if (key === 'destroy') return () => { ownership.devicesDestroyed++; target.destroy(); };
              const value = Reflect.get(target, key, target);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
        },
      };
    },
  };
  const result = await serveGPU(transport, {gpu, timeoutMs: 60000, onEvent});
  return {...result, ownership};
}
