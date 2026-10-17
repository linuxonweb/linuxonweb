import test from 'node:test';
import assert from 'node:assert/strict';
import { collectTrace } from './gpt6-codex-trace.mjs';

test('trace stream writes decoded chunks, includes EOF data and closes its handle', async () => {
  const calls = [], chunks = [];
  const replies = [{ data: '{"traceEvents":', eof: false }, { data: Buffer.from('[]}').toString('base64'), base64Encoded: true, eof: true }];
  const result = await collectTrace(async (method, params) => {
    calls.push({ method, params });
    if (method === 'IO.read') return replies.shift();
  }, 'private-trace', bytes => chunks.push(bytes), { maxBytes: 1024 });
  assert.equal(Buffer.concat(chunks).toString(), '{"traceEvents":[]}');
  assert.equal(result.bytes, 18);
  assert.equal(result.chunks, 2);
  assert.equal(calls.at(-1).method, 'IO.close');
  assert.ok(calls.every(call => call.params.handle === 'private-trace'));
});

test('trace byte limit fails before writing an oversized chunk and still closes', async () => {
  const calls = [], chunks = [];
  await assert.rejects(collectTrace(async method => {
    calls.push(method);
    return { data: 'too large', eof: true };
  }, 'bounded', bytes => chunks.push(bytes), { maxBytes: 4 }), /byte limit/);
  assert.deepEqual(chunks, []);
  assert.deepEqual(calls, ['IO.read', 'IO.close']);
});

test('trace chunk limit prevents an empty non-EOF stream from running forever', async () => {
  const calls = [];
  await assert.rejects(collectTrace(async method => {
    calls.push(method);
    return { data: '', eof: false };
  }, 'empty', () => {}, { maxChunks: 2 }), /chunk limit/);
  assert.deepEqual(calls, ['IO.read', 'IO.read', 'IO.close']);
});

test('trace transport and output failures retain their original error and close', async () => {
  for (const stage of ['read', 'write']) {
    const failure = new Error(stage), calls = [];
    await assert.rejects(collectTrace(async method => {
      calls.push(method);
      if (method === 'IO.close') throw new Error('secondary close failure');
      if (stage === 'read') throw failure;
      return { data: '{}', eof: true };
    }, 'failing', () => { throw failure; }), error => error === failure);
    assert.equal(calls.at(-1), 'IO.close');
  }
});

test('falsy thrown values are not masked by a secondary close error', async () => {
  for (const failure of [undefined, null, false, 0, '']) {
    await assert.rejects(collectTrace(async method => {
      if (method === 'IO.close') throw new Error('secondary close failure');
      throw failure;
    }, 'falsy', () => {}), error => Object.is(error, failure));
  }
});

test('trace finalization closes only the owned page before requesting the flush', async () => {
  const { finishTrace } = await import('./gpt6-codex-trace.mjs');
  const calls = [];
  await finishTrace(async (method, params) => {
    calls.push({ method, params });
    return { success: true };
  }, 'owned-page');
  assert.deepEqual(calls, [
    { method: 'Target.closeTarget', params: { targetId: 'owned-page' } },
    { method: 'Tracing.end', params: {} },
  ]);
});

test('trace finalization refuses missing ownership or an unclosed target', async () => {
  const { finishTrace } = await import('./gpt6-codex-trace.mjs');
  const calls = [];
  const send = async method => { calls.push(method); return { success: false }; };
  await assert.rejects(finishTrace(send, ''), /owned page/i);
  assert.deepEqual(calls, []);
  await assert.rejects(finishTrace(send, 'owned-page'), /close/i);
  assert.deepEqual(calls, ['Target.closeTarget']);
});
