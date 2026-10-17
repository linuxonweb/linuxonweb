import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadFile, onDownloadProgress } from './download-progress.mjs';

async function collected(reference) {
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(setImmediate);
    global.gc();
    await new Promise(setImmediate);
    if (!reference.deref()) return true;
  }
  return false;
}

test('consumed download chunks can be collected before the full body arrives', async () => {
  assert.equal(typeof global.gc, 'function', 'Run with --expose-gc');
  const halfway = Promise.withResolvers();
  const finish = Promise.withResolvers();
  let first, position = 0;
  const body = new ReadableStream({
    async pull(controller) {
      position++;
      if (position === 3) await finish.promise;
      if (position > 3) { controller.close(); return; }
      const chunk = new Uint8Array(16).fill(position);
      if (position === 1) first = new WeakRef(chunk);
      controller.enqueue(chunk);
    },
  }, { highWaterMark: 0 });
  const unsubscribe = onDownloadProgress(event => {
    if (event.id === 'memory' && event.loaded === 32) halfway.resolve();
  });
  const pending = downloadFile('https://fixture.invalid/image', {
    id: 'memory', label: 'Image', total: 48,
    fetchImpl: async () => new Response(body),
  });
  try {
    await halfway.promise;
    assert.equal(await collected(first), true, 'Downloader retains an already consumed network chunk');
  } finally {
    finish.resolve();
    unsubscribe();
    const result = await pending;
    assert.deepEqual(result.bytes, Uint8Array.from({ length: 48 }, (_, index) => Math.floor(index / 16) + 1));
  }
});

test('short and oversized whole-file bodies fail instead of returning another size', async () => {
  for (const size of [3, 5]) {
    await assert.rejects(downloadFile('https://fixture.invalid/image', {
      id: 'size', label: 'Image', total: 4,
      fetchImpl: async () => new Response(new Uint8Array(size)),
    }), /incomplete|size|length/i);
  }
});

test('an oversized stream is cancelled without requesting another chunk', async () => {
  let pulls = 0, cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      pulls++;
      if (pulls === 1) controller.enqueue(new Uint8Array(5));
      else controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  await assert.rejects(downloadFile('https://fixture.invalid/image', {
    id: 'overflow', label: 'Image', total: 4,
    fetchImpl: async () => new Response(body),
  }), /incomplete|size|length/i);
  assert.equal(pulls, 1);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('invalid expected lengths fail before network or allocation', async () => {
  for (const total of [-1, NaN, Infinity, 1.5, '4', undefined]) {
    let fetched = false;
    await assert.rejects(downloadFile('https://fixture.invalid/image', {
      id: 'invalid', label: 'Image', total,
      fetchImpl: async () => { fetched = true; return new Response(new Uint8Array(4)); },
    }), /size|length/i);
    assert.equal(fetched, false);
  }
});
