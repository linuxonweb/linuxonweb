import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker, MessageChannel } from 'node:worker_threads';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const text = value => [...new TextEncoder().encode(value)];
const name = value => [text(value).length, ...text(value)];
const section = (id, bytes) => [id, bytes.length, ...bytes];
const kernel = new WebAssembly.Module(new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0,
  ...section(1, [2, 0x60, 0, 0, 0x60, 1, 0x7f, 0]),
  ...section(2, [1, ...name('kernel'), ...name('halt_worker'), 0, 0]),
  ...section(3, [1, 1]),
  ...section(4, [1, 0x70, 0, 1]),
  ...section(7, [1, ...name('__indirect_function_table'), 1, 0]),
  ...section(9, [1, 0, 0x41, 0, 0x0b, 1, 1]),
  ...section(10, [1, 4, 0, 0x10, 0, 0x0b]),
]));
const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
const task = () => ({ type: 'init', fn: 0, arg: 0, vmlinux: kernel, memory,
  user: null, user_copy_status: null, framebuffer: { width: 1, height: 1, bpp: 32 }, gpu: null });

async function response(worker, send) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const pending = once(worker, 'message', { signal: controller.signal });
    send();
    return (await pending)[0];
  } finally { clearTimeout(timer); }
}

test('the actual worker runs consecutive direct and forwarded kernel tasks before orderly shutdown', async context => {
  const worker = new Worker(new URL('./dist/worker.js', import.meta.url));
  context.after(() => worker.terminate());
  const identity = worker.threadId;
  assert.deepEqual(await response(worker, () => worker.postMessage(task())), { type: 'worker_idle' });
  const channel = new MessageChannel();
  context.after(() => channel.port2.close());
  assert.deepEqual(await response(worker, () => {
    worker.postMessage({ type: 'forwarded_init', port: channel.port1 }, [channel.port1]);
    channel.port2.postMessage(task());
  }), { type: 'worker_idle' });
  assert.equal(worker.threadId, identity);
  assert.deepEqual(await response(worker, () => worker.postMessage(task())), { type: 'worker_idle' });
  const exited = once(worker, 'exit');
  assert.deepEqual(await response(worker, () => worker.postMessage({ type: 'shutdown' })), { type: 'worker_exit' });
  assert.deepEqual(await exited, [0]);
});

test('failed fork memory allocation publishes errno and leaves the worker reusable', async context => {
  const worker = new Worker(new URL('./dist/worker.js', import.meta.url));
  context.after(() => worker.terminate());
  const status = new Int32Array(new SharedArrayBuffer(4));
  const copy = { ...task(), user_copy_status: status, user: { module: kernel, memory, maximum_pages: 0 } };
  assert.deepEqual(await response(worker, () => worker.postMessage(copy)), { type: 'worker_idle' });
  assert.equal(Atomics.load(status, 0), -12);
  assert.deepEqual(await response(worker, () => worker.postMessage(task())), { type: 'worker_idle' });
});

test('task finalization releases the GPU client before publishing idle or propagating failure', () => {
  const source = readFileSync(new URL('./dist/worker.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('function run_task(message)'), source.indexOf('channel.on_message((raw)'));
  for (const failure of [null, new Error('task failed')]) {
    const calls = [];
    const scope = {
      start() { if (failure) throw failure; return true; },
      gpu_client: { release() { calls.push('release'); } },
      gpu_hub: new SharedArrayBuffer(4),
      postMessage(message) {
        assert.equal(scope.gpu_client, null);
        assert.equal(scope.gpu_hub, null);
        calls.push(message.type);
      },
    };
    vm.runInNewContext(body, scope);
    if (failure) assert.throws(() => scope.run_task({}), error => error === failure);
    else scope.run_task({});
    assert.equal(scope.gpu_client, null);
    assert.equal(scope.gpu_hub, null);
    assert.deepEqual(calls, failure ? ['release'] : ['release', 'worker_idle']);
  }
});
