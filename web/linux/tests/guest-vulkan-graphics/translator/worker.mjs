import { translateGraphics } from './abi.mjs';
let instance;
self.onmessage = async ({ data }) => {
  const { id } = data;
  try {
    if (data.kind === 'init') {
      const module = await WebAssembly.compile(data.bytes);
      if (WebAssembly.Module.imports(module).length) throw new Error('translator must have no imports');
      instance = await WebAssembly.instantiate(module, {});
      if (instance.exports.translator_version() !== 0x47520001) throw new Error('graphics ABI mismatch');
      self.postMessage({ id, ok: true });
    } else if (data.kind === 'translate' && instance) {
      try { self.postMessage({ id, ok: true, result: translateGraphics(instance, data.bytes) }); }
      catch (error) {
        if (error instanceof WebAssembly.RuntimeError) throw error;
        self.postMessage({ id, ok: false, fatal: false, error: String(error.message).slice(0, 2048) });
      }
    } else { throw new Error('translator not initialized'); }
  } catch (error) {
    instance = undefined;
    self.postMessage({ id, ok: false, fatal: true, error: String(error?.message ?? error).slice(0, 2048) });
  }
};
