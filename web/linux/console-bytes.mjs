// TextDecoder rejects shared memory. Copy only the supplied byte span; ordinary
// console chunks can pass through without allocating another buffer.
export function nonSharedBytes(value) {
  const view = ArrayBuffer.isView(value);
  const buffer = view ? value.buffer : value;
  if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
    return new Uint8Array(buffer, view ? value.byteOffset : 0, view ? value.byteLength : buffer.byteLength).slice();
  }
  return value;
}
