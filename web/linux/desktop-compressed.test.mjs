import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { cpioEntry, desktopInitOverlay, loadDesktopInitramfs } from './desktop-extras.mjs';
import * as desktopExtras from './desktop-extras.mjs';

const encoder = new TextEncoder();
const join = parts => new Uint8Array(Buffer.concat(parts));
const init = cpioEntry('init', encoder.encode('#!/bin/busybox sh\necho preserved\n'));
const trailer = cpioEntry('TRAILER!!!', new Uint8Array(), 0);
const system = join([cpioEntry('large', new Uint8Array(2 * 1024 * 1024)), init, trailer]);
const extras = join([cpioEntry('extra', encoder.encode('extra')), trailer]);

test('compressed boot defaults on for Firefox, with an explicit raw diagnostic override', () => {
  assert.equal(desktopExtras.useCompressedInitramfs('firefox', '?compressed-initramfs=1', false), true);
  assert.equal(desktopExtras.useCompressedInitramfs('firefox', '', false), true);
  for (const search of ['?compressed-initramfs=0', '?compressed-initramfs=true']) {
    assert.equal(desktopExtras.useCompressedInitramfs('firefox', search, false), false);
  }
  for (const mode of ['startx', 'console', 'wgpu']) {
    assert.equal(desktopExtras.useCompressedInitramfs(mode, '?compressed-initramfs=1', false), false);
  }
  assert.equal(desktopExtras.useCompressedInitramfs('firefox', '?compressed-initramfs=1', true), false);
});

test('compressed boot retains exact gzip bytes and appends aligned extras and original init overlay', async () => {
  const compressed = gzipSync(system);
  let expandedSize;
  const actual = await loadDesktopInitramfs(new Response(compressed), extras, {
    gzip: true, preserveGzip: true, onImage: bytes => { expandedSize = bytes; },
  });
  assert.deepEqual(actual.subarray(0, compressed.length), new Uint8Array(compressed));
  assert.deepEqual(new Uint8Array(gunzipSync(actual.subarray(0, compressed.length))), system);
  const extrasAt = Math.ceil(compressed.length / 4) * 4;
  assert.deepEqual(actual.subarray(compressed.length, extrasAt), new Uint8Array(extrasAt - compressed.length));
  assert.deepEqual(actual.subarray(extrasAt, extrasAt + extras.length), extras);
  assert.deepEqual(actual.subarray(extrasAt + extras.length), desktopInitOverlay(system));
  assert.equal(expandedSize, system.length);
  assert.ok(actual.length < system.length / 10);
});

test('compressed scanner handles split headers and concatenated archives, using last init', async () => {
  const replacement = cpioEntry('./init', encoder.encode('#!/bin/sh\necho last\n'));
  const source = join([system, new Uint8Array(16), replacement, trailer]);
  const compressed = gzipSync(source);
  const body = new ReadableStream({ start(controller) {
    for (let offset = 0; offset < compressed.length; offset += 7) controller.enqueue(compressed.slice(offset, offset + 7));
    controller.close();
  } });
  const actual = await loadDesktopInitramfs(new Response(body), extras, { gzip: true, preserveGzip: true });
  const expected = desktopInitOverlay(join([replacement, trailer]));
  assert.deepEqual(actual.subarray(actual.length - expected.length), expected);
});

test('compressed mode rejects missing init, truncated entries, malformed names and oversized init', async () => {
  const badName = init.slice();
  badName[114] = 65;
  for (const source of [trailer, init.subarray(0, 115), badName,
    cpioEntry('init', new Uint8Array(1024 * 1024 + 1)), encoder.encode('not cpio')]) {
    await assert.rejects(loadDesktopInitramfs(new Response(gzipSync(source)), extras, { gzip: true, preserveGzip: true }));
  }
});

test('corrupt gzip trailer cannot publish a compressed archive', async () => {
  const compressed = gzipSync(system);
  compressed[compressed.length - 8] ^= 1;
  let ready = false;
  await assert.rejects(loadDesktopInitramfs(new Response(compressed), extras, {
    gzip: true, preserveGzip: true, onReady: () => { ready = true; },
  }));
  assert.equal(ready, false);
});

test('compressed mode abort cancels upstream while waiting for bytes', async () => {
  const controller = new AbortController();
  const reason = new Error('compressed scan cancelled');
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  const prepared = loadDesktopInitramfs(new Response(body), extras, { gzip: true, preserveGzip: true, signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(reason);
  await assert.rejects(prepared, error => error === reason);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
});
