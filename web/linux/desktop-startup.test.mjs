import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { getEventListeners } from 'node:events';
import { cpioEntry, desktopInitramfs, loadDesktopInitramfs } from './desktop-extras.mjs';
import { spawnMachine } from './dist/index.js';
import { platform } from './dist/platform.js';

const encoder = new TextEncoder();
const records = [cpioEntry('init', encoder.encode('#!/bin/busybox sh\necho startup\n')), cpioEntry('TRAILER!!!', new Uint8Array(), 0)];
const system = new Uint8Array(records.reduce((sum, record) => sum + record.length, 0));
let position = 0;
for (const record of records) { system.set(record, position); position += record.length; }
const extras = encoder.encode('desktop-extras');
const expected = desktopInitramfs(system, extras);

test('raw streamed initramfs remains byte identical to synchronous assembly', async () => {
  const stages = [];
  const stream = new ReadableStream({ start(controller) {
    for (let start = 0; start < system.length; start += 7) controller.enqueue(system.slice(start, start + 7));
    controller.close();
  } });
  const response = new Response(stream);
  assert.deepEqual(await loadDesktopInitramfs(Promise.resolve(response), Promise.resolve(extras), {
    onImage: bytes => stages.push(['image', bytes]), onReady: () => stages.push(['ready']),
  }), expected);
  assert.deepEqual(stages, [['image', system.length], ['ready']]);
  assert.equal(response.body.locked, false);
});

test('gzip initramfs decodes to the same archive and reports expanded size', async () => {
  const controller = new AbortController();
  let decoded;
  assert.deepEqual(await loadDesktopInitramfs(new Response(gzipSync(system)), extras, {
    gzip: true, signal: controller.signal, onImage: bytes => { decoded = bytes; },
  }), expected);
  assert.equal(decoded, system.length);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  controller.abort();
});

test('image decoding and unrelated boot work proceed while extras are pending', async () => {
  const controller = new AbortController();
  const delayedExtras = Promise.withResolvers();
  const imageRead = Promise.withResolvers();
  let assembled = false;
  const prepared = loadDesktopInitramfs(new Response(system), delayedExtras.promise, {
    signal: controller.signal, onImage: imageRead.resolve, onReady: () => { assembled = true; },
  });
  assert.ok(prepared instanceof Promise);
  assert.equal(await imageRead.promise, system.length);
  assert.equal(assembled, false);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  delayedExtras.resolve(extras);
  assert.deepEqual(await prepared, expected);
  assert.equal(assembled, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('extras failure is observed even before the image response arrives', async () => {
  const delayedImage = Promise.withResolvers();
  const failure = new Error('extras unavailable');
  const prepared = loadDesktopInitramfs(delayedImage.promise, Promise.reject(failure));
  prepared.catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  delayedImage.resolve(new Response(system));
  await assert.rejects(prepared, error => error === failure);
});

test('image and extras failures remain observed together', async () => {
  const imageError = new Error('image download failed');
  await assert.rejects(loadDesktopInitramfs(Promise.reject(imageError), Promise.reject(new Error('extras download failed'))), error => error === imageError);
  await new Promise(resolve => setImmediate(resolve));
});

test('broken download streams and corrupt gzip cannot produce a boot archive', async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(new Error('truncated download')); } });
  await assert.rejects(loadDesktopInitramfs(new Response(stream), extras), /truncated download/);
  assert.equal(stream.locked, false);
  await assert.rejects(loadDesktopInitramfs(new Response(encoder.encode('not gzip')), extras, { gzip: true }));
});

test('absent body fails clearly and never reports image readiness', async () => {
  let ready = false;
  await assert.rejects(loadDesktopInitramfs(new Response(null), extras, { onReady: () => { ready = true; } }), /body/i);
  assert.equal(ready, false);
});

test('missing init still fails existing CPIO validation', async () => {
  await assert.rejects(loadDesktopInitramfs(new Response(cpioEntry('TRAILER!!!', new Uint8Array(), 0)), extras), /init script/);
});

async function rejectsPromptly(promise, reason) {
  let timer;
  try {
    await assert.rejects(Promise.race([promise, new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('archive preparation did not abort promptly')), 250);
    })]), error => error === reason);
  } finally { clearTimeout(timer); }
}

test('pre-aborted preparation rejects without image callbacks or unhandled inputs', async () => {
  const controller = new AbortController(), reason = new Error('boot already stopped');
  controller.abort(reason);
  const prepared = loadDesktopInitramfs(Promise.reject(new Error('late image failure')), Promise.reject(new Error('late extras failure')), {
    signal: controller.signal, onImage: () => assert.fail('aborted image callback'), onReady: () => assert.fail('aborted ready callback'),
  });
  await rejectsPromptly(prepared, reason);
});

test('abort before image arrival rejects promptly and cancels its later body', async () => {
  const controller = new AbortController(), image = Promise.withResolvers();
  const reason = new Error('kernel failed before download');
  let cancelled;
  const prepared = loadDesktopInitramfs(image.promise, extras, { signal: controller.signal });
  prepared.catch(() => {});
  controller.abort(reason);
  try { await rejectsPromptly(prepared, reason); }
  finally {
    image.resolve(new Response(new ReadableStream({ cancel: cause => { cancelled = cause; } })));
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(cancelled, reason);
});

test('abort during reader attachment cancels the response without waiting for source cancellation', async () => {
  const controller = new AbortController(), reading = Promise.withResolvers();
  const reason = new Error('kernel compile failed');
  let cancelled;
  const body = new ReadableStream({
    pull: () => { reading.resolve(); },
    cancel: cause => { cancelled = cause; return new Promise(() => {}); },
  });
  const prepared = loadDesktopInitramfs(new Response(body), extras, { signal: controller.signal });
  prepared.catch(() => {});
  await reading.promise;
  controller.abort(reason);
  await rejectsPromptly(prepared, reason);
  assert.equal(cancelled, reason);
  assert.equal(body.locked, false);
});

test('abort cancels an attached pending reader and removes its signal listener', async () => {
  const controller = new AbortController(), reading = Promise.withResolvers();
  const reason = new Error('pending read stopped');
  let cancelled;
  const body = new ReadableStream({
    pull: () => { reading.resolve(); }, cancel: cause => { cancelled = cause; return new Promise(() => {}); },
  }, { highWaterMark: 0 });
  const prepared = loadDesktopInitramfs(new Response(body), extras, { signal: controller.signal });
  prepared.catch(() => {});
  await reading.promise;
  assert.equal(body.locked, true);
  controller.abort(reason);
  await rejectsPromptly(prepared, reason);
  assert.equal(cancelled, reason);
  assert.equal(body.locked, false);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('aborting gzip decoding cancels the compressed input and suppresses readiness', async () => {
  const controller = new AbortController(), reading = Promise.withResolvers();
  const reason = new Error('gzip boot stopped');
  let cancelled;
  const body = new ReadableStream({
    pull: () => { reading.resolve(); }, cancel: cause => { cancelled = cause; },
  }, { highWaterMark: 0 });
  const prepared = loadDesktopInitramfs(new Response(body), extras, {
    gzip: true, signal: controller.signal, onImage: () => assert.fail('incomplete gzip ready'), onReady: () => assert.fail('cancelled gzip assembled'),
  });
  prepared.catch(() => {});
  await reading.promise;
  controller.abort(reason);
  await rejectsPromptly(prepared, reason);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, reason);
  assert.equal(body.locked, false);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('abort after decoding releases the wait for extras and never assembles', async () => {
  const controller = new AbortController(), decoded = Promise.withResolvers(), delayedExtras = Promise.withResolvers();
  const reason = new Error('boot failed during extras download');
  const prepared = loadDesktopInitramfs(new Response(system), delayedExtras.promise, {
    signal: controller.signal, onImage: decoded.resolve, onReady: () => assert.fail('aborted archive assembled'),
  });
  prepared.catch(() => {});
  await decoded.promise;
  controller.abort(reason);
  try { await rejectsPromptly(prepared, reason); }
  finally { delayedExtras.reject(new Error('later extras failure')); }
  await new Promise(resolve => setImmediate(resolve));
});

test('machine starts kernel loading before its promised initcpio is ready and propagates failure', async () => {
  const image = Promise.withResolvers(), kernel = Promise.withResolvers();
  const failure = new Error('kernel compilation failed');
  const original = platform.load_wasm;
  let kernelStarted = false, imageReady = false;
  platform.load_wasm = () => { kernelStarted = true; return kernel.promise; };
  try {
    const archive = loadDesktopInitramfs(image.promise, extras, { onReady: () => { imageReady = true; } });
    const machine = spawnMachine({ devices: [], gpuHostcall: false, initcpio: archive });
    const rejected = assert.rejects(machine, error => error === failure);
    assert.equal(kernelStarted, true);
    assert.equal(imageReady, false);
    image.resolve(new Response(system));
    assert.deepEqual(await archive, expected);
    assert.equal(imageReady, true);
    kernel.reject(failure);
    await rejected;
  } finally {
    platform.load_wasm = original;
  }
});
