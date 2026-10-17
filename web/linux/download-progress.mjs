// Package downloads for the download panel. Listeners see
// { id, label, total, loaded, state } where state is 'downloading', 'done' or
// 'error'. Reporting never changes the bytes returned.
//
// A large file is fetched as SEGMENTS parallel byte ranges. A server that
// ignores Range (answers 200) gets one ordinary stream instead.
const listeners = new Set();
export function onDownloadProgress(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
function report(event) {
  for (const listener of listeners) listener(event);
}
export const SEGMENTS = 4;
export const SEGMENT_MIN_BYTES = 4 * 1024 * 1024;

// Reads a body in full, calling onBytes with each chunk's size.
async function readBody(response, bytes, onBytes) {
  if (!response.body) {
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength !== bytes.byteLength) throw new Error('Download has an incomplete or unexpected size.');
    bytes.set(body);
    onBytes(body.byteLength);
    return;
  }
  const reader = response.body.getReader();
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > bytes.byteLength - loaded) throw new Error('Download exceeds its expected size.');
      bytes.set(value, loaded);
      loaded += value.byteLength;
      onBytes(value.byteLength);
    }
    if (loaded !== bytes.byteLength) throw new Error('Download has an incomplete size.');
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

// Downloads url as one or more parallel ranges. Resolves to { bytes, lastModified }
// where lastModified is the server's Last-Modified header (null when absent).
// Failures reject with `${failure} (HTTP status)` or a segment description.
export async function downloadFile(url, { id, label, total, failure = 'Download failed', fetchImpl = fetch, cache = 'no-cache' }) {
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid expected download size.');
  let loaded = 0;
  const emit = state => report({ id, label, total, loaded, state });
  emit('downloading');
  const controller = new AbortController();
  const options = (headers = {}) => ({ cache, signal: controller.signal, headers });
  const count = Math.min(SEGMENTS, Math.floor(total / SEGMENT_MIN_BYTES));
  const add = size => { loaded += size; emit('downloading'); };
  try {
    if (count < 2) {
      const response = await fetchImpl(url, options());
      if (!response.ok) throw new Error(`${failure} (HTTP ${response.status})`);
      const bytes = new Uint8Array(total);
      await readBody(response, bytes, add);
      emit('done');
      return { bytes, lastModified: response.headers.get('Last-Modified') };
    }
    const span = Math.ceil(total / count);
    const ranges = Array.from({ length: count }, (_, index) => [index * span, Math.min(total, (index + 1) * span) - 1]);
    const first = await fetchImpl(url, options({ Range: `bytes=${ranges[0][0]}-${ranges[0][1]}` }));
    // The server ignored Range and sent the whole file in this one response.
    if (first.status === 200) {
      const bytes = new Uint8Array(total);
      await readBody(first, bytes, add);
      emit('done');
      return { bytes, lastModified: first.headers.get('Last-Modified') };
    }
    if (first.status !== 206) throw new Error(`${failure} (HTTP ${first.status})`);
    const bytes = new Uint8Array(total);
    await Promise.all(ranges.map(async ([start, end], index) => {
      const response = index === 0 ? first : await fetchImpl(url, options({ Range: `bytes=${start}-${end}` }));
      if (response.status !== 206) throw new Error(`${failure} (HTTP ${response.status} for bytes ${start}-${end})`);
      await readBody(response, bytes.subarray(start, end + 1), add);
    }));
    emit('done');
    return { bytes, lastModified: first.headers.get('Last-Modified') };
  } catch (error) {
    // Stop any segments still in flight; the first failure decides the result.
    controller.abort();
    report({ id, label, total, loaded, state: 'error', error: error?.message || String(error) });
    throw error;
  }
}
