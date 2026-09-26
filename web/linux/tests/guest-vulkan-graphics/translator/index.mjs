/** Hash-pinned, disposable worker; translation executes no guest shader code. */
export async function createGraphicsTranslator({ url, sha256, timeoutMs = 10000, fetchImpl = fetch } = {}) {
  if (!url || !/^[a-f0-9]{64}$/.test(sha256 ?? '')) throw new TypeError('pinned translator URL and SHA-256 required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new RangeError('invalid deadline');
  const response = await fetchImpl(url);
  if (!response.ok || !response.body) throw new Error('translator fetch failed');
  const reader = response.body.getReader(); const chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 8 * 1024 * 1024) throw new Error('translator exceeds 8 MiB');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== sha256) throw new Error('translator artifact hash mismatch');
  let worker, active, closed = false, busy = false, nextId = 1;
  function stop(reason) {
    worker?.terminate(); worker = undefined;
    if (active) { const { reject, timer } = active; active = undefined; clearTimeout(timer); reject(reason); }
  }
  function request(kind, bytes) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => stop(new Error('graphics translator deadline exceeded')), timeoutMs);
      active = { id, resolve, reject, timer };
      try { worker.postMessage({ id, kind, bytes }); } catch (error) { stop(error); }
    });
  }
  async function start() {
    worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
    worker.onerror = () => stop(new Error('graphics translator worker failed'));
    worker.onmessage = ({ data }) => {
      if (!active || data.id !== active.id) { stop(new Error('translator response mismatch')); return; }
      const { resolve, reject, timer } = active; active = undefined; clearTimeout(timer);
      if (data.fatal) { worker.terminate(); worker = undefined; }
      if (data.ok) resolve(data.result); else reject(new Error(data.error));
    };
    await request('init', bytes);
  }
  await start();
  return {
    async translate(input, { stage, entryPoint } = {}) {
      if (closed || busy) throw new Error(closed ? 'translator closed' : 'translator busy');
      if (!(input instanceof Uint8Array) || input.byteLength < 20 || input.byteLength > 65536 || input.byteLength % 4) throw new TypeError('invalid SPIR-V byte length');
      busy = true;
      try {
        if (!worker) await start();
        const result = await request('translate', input.slice());
        if (stage !== undefined && result.stage !== stage) throw new Error('requested stage mismatch');
        if (entryPoint !== undefined && result.originalEntryPoint !== entryPoint) throw new Error('requested original entry point mismatch');
        return result;
      } finally { busy = false; }
    },
    close() { closed = true; stop(new Error('translator closed')); },
    sha256,
  };
}
