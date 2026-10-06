import test from 'node:test';
import assert from 'node:assert/strict';
import { nonSharedBytes } from './console-bytes.mjs';
import { LogHistory } from './log-viewer.mjs';

test('shared console views copy only their byte span, including DataView offsets', () => {
  const shared = new SharedArrayBuffer(1024);
  new Uint8Array(shared).fill(33);
  const encoded = new TextEncoder().encode('guest ✓\n');
  new Uint8Array(shared, 37, encoded.length).set(encoded);
  for (const view of [new Uint8Array(shared, 37, encoded.length), new DataView(shared, 37, encoded.length)]) {
    const bytes = nonSharedBytes(view);
    assert.ok(bytes.buffer instanceof ArrayBuffer);
    assert.equal(bytes.buffer.byteLength, encoded.length);
    assert.deepEqual(bytes, encoded);
    assert.equal(new TextDecoder().decode(bytes), 'guest ✓\n');
  }
  assert.equal(nonSharedBytes(shared).length, shared.byteLength);
});

test('ordinary decoder input passes through without copying', () => {
  const bytes = new Uint8Array([65, 66]);
  for (const value of [bytes, bytes.buffer, new DataView(bytes.buffer)]) assert.equal(nonSharedBytes(value), value);
});

test('shared chunks preserve streaming UTF-8 and exit lines in the guest log path', () => {
  const history = new LogHistory();
  const encoded = new TextEncoder().encode('guest ✓\nGUEST_WGPU_EXIT status=0\n');
  const shared = new SharedArrayBuffer(encoded.length + 8);
  new Uint8Array(shared, 4, encoded.length).set(encoded);
  const split = 7; // Split within the checkmark's UTF-8 sequence.
  history.write(nonSharedBytes(new Uint8Array(shared, 4, split)));
  history.write(nonSharedBytes(new Uint8Array(shared, 4 + split, encoded.length - split)));
  assert.deepEqual(history.page().map(row => row.text), ['guest ✓', 'GUEST_WGPU_EXIT status=0']);
});
