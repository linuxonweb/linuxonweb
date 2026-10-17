import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { getEventListeners } from 'node:events';
import { cpioEntry, desktopInitOverlay, loadDesktopInitramfs } from './desktop-extras.mjs';

const encoder = new TextEncoder();
const join = parts => new Uint8Array(Buffer.concat(parts));
const trailer = cpioEntry('TRAILER!!!', new Uint8Array(), 0);
const system = join([cpioEntry('init', encoder.encode('#!/bin/busybox sh\necho original\n')), trailer]);
const compressed = gzipSync(system);
const extras = join([cpioEntry('bin/preserved-app', new Uint8Array(2 * 1024 * 1024).fill(73)), trailer]);
const options = { gzip: true, preserveGzip: true, compressExtras: true };

test('compressed tail preserves the original gzip and every extras/overlay byte', async () => {
  const actual = await loadDesktopInitramfs(new Response(compressed), extras, options);
  const tailAt = Math.ceil(compressed.length / 4) * 4;
  assert.deepEqual(actual.subarray(0, compressed.length), new Uint8Array(compressed));
  assert.deepEqual(actual.subarray(compressed.length, tailAt), new Uint8Array(tailAt - compressed.length));
  assert.deepEqual([...actual.subarray(tailAt, tailAt + 2)], [0x1f, 0x8b]);
  assert.deepEqual(new Uint8Array(gunzipSync(actual.subarray(tailAt))), join([extras, desktopInitOverlay(system)]));
  assert.ok(actual.length < extras.length / 20);
});

test('compressed tail aligns an unaligned extras buffer before the init overlay', async () => {
  const unaligned = join([extras, new Uint8Array(3)]);
  const actual = await loadDesktopInitramfs(new Response(compressed), unaligned, options);
  const tailAt = Math.ceil(compressed.length / 4) * 4;
  assert.deepEqual(new Uint8Array(gunzipSync(actual.subarray(tailAt))), join([unaligned, new Uint8Array(1), desktopInitOverlay(system)]));
});

test('raw and prior compressed modes remain unchanged without tail opt-in', async () => {
  const actual = await loadDesktopInitramfs(new Response(compressed), extras, { gzip: true, preserveGzip: true });
  const tailAt = Math.ceil(compressed.length / 4) * 4;
  assert.deepEqual(actual.subarray(tailAt), join([extras, desktopInitOverlay(system)]));
  const raw = await loadDesktopInitramfs(new Response(system), extras);
  assert.deepEqual(raw, join([system, extras, desktopInitOverlay(system)]));
});

test('tail compression requires an explicitly preserved gzip image', async () => {
  for (const invalid of [{}, { gzip: true }, { preserveGzip: true }]) {
    await assert.rejects(loadDesktopInitramfs(new Response(invalid.gzip ? compressed : system), extras, {
      ...invalid, compressExtras: true,
    }), /preserved gzip/i);
  }
});

test('compression failures cannot publish a partially assembled boot image', async context => {
  const failure = new Error('tail compressor unavailable');
  context.mock.method(globalThis, 'CompressionStream', function () { throw failure; });
  let ready = false;
  await assert.rejects(loadDesktopInitramfs(new Response(compressed), extras, {
    ...options, onReady: () => { ready = true; },
  }), error => error === failure);
  assert.equal(ready, false);
});

test('abort during tail compression cancels its output and removes the listener', async context => {
  const controller = new AbortController();
  const attached = Promise.withResolvers();
  const failure = new Error('tail compression cancelled');
  let cancelled, ready = false;
  context.mock.method(globalThis, 'CompressionStream', function () {
    return {
      writable: new WritableStream({ write() { attached.resolve(); } }),
      readable: new ReadableStream({ cancel(reason) { cancelled = reason; } }),
    };
  });
  const prepared = loadDesktopInitramfs(new Response(compressed), extras, {
    ...options, signal: controller.signal, onReady: () => { ready = true; },
  });
  const started = await Promise.race([attached.promise.then(() => true), prepared.then(() => false)]);
  assert.equal(started, true, 'Tail compression was never started');
  controller.abort(failure);
  await assert.rejects(prepared, error => error === failure);
  await new Promise(setImmediate);
  assert.equal(cancelled, failure);
  assert.equal(ready, false);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
