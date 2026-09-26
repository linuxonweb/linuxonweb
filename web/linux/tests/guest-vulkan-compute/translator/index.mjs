/** Dedicated-worker translator with a deadline. Caller must close() on teardown. */
export async function createSpirvTranslator({ url, sha256, timeoutMs = 10000, fetchImpl = fetch } = {}) {
  if (!url || !/^[a-f0-9]{64}$/.test(sha256 ?? '')) throw new TypeError('pinned translator URL and SHA-256 required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new RangeError('invalid translation deadline');
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`translator fetch failed: ${response.status}`);
  if (!response.body) throw new Error('translator response has no body');
  const limit = 8 * 1024 * 1024;
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('translator artifact exceeds 8 MiB');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const buffer = bytes.buffer;
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), b => b.toString(16).padStart(2, '0')).join('');
  if (digest !== sha256) throw new Error('translator artifact hash mismatch');
  let worker;
  let nextId = 1;
  let busy = false;
  let closed = false;
  let active;
  function stop(reason) {
    worker?.terminate(); worker = undefined;
    if (active) { const { reject, timer } = active; active = undefined; clearTimeout(timer); reject(reason); }
  }
  function request(kind, bytes) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => stop(new Error('SPIR-V translator deadline exceeded')), timeoutMs);
      active = { id, resolve, reject, timer };
      worker.postMessage({ id, kind, bytes });
    });
  }
  async function start() {
    worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
    worker.onerror = () => stop(new Error('SPIR-V translator worker failed'));
    worker.onmessage = ({ data }) => {
      if (!active || data.id !== active.id) { stop(new Error('translator response mismatch')); return; }
      const { resolve, reject, timer } = active; active = undefined; clearTimeout(timer);
      if (data.fatal) { worker.terminate(); worker = undefined; }
      if (data.ok) resolve(data.result); else reject(new Error(data.error));
    };
    await request('init', buffer);
  }
  await start();
  return {
    async translate(bytes) {
      if (closed) throw new Error('translator closed');
      if (busy) throw new Error('translator already busy');
      if (!(bytes instanceof Uint8Array) || bytes.byteLength < 20 || bytes.byteLength > 65536 || bytes.byteLength % 4) {
        throw new TypeError('invalid SPIR-V byte length');
      }
      busy = true;
      try {
        if (!worker) await start();
        return await request('translate', bytes.slice());
      } finally { busy = false; }
    },
    close() { closed = true; stop(new Error('translator closed')); },
    sha256,
  };
}
