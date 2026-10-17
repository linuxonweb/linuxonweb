import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';
import { allocate_shared_memory, memory_bytes, user_module_imports_supported, HALT_KERNEL } from './dist/wasm.js';
import { read_wasm_memories } from './dist/wasm_binary.js';
import { ensureUserDestination } from './dist/user-memory-growth-adapter.js';

const sourceUrl = process.env.LINUX_USER_CONTEXT_TEST_SOURCE
  ? pathToFileURL(process.env.LINUX_USER_CONTEXT_TEST_SOURCE)
  : new URL('./dist/worker.js', import.meta.url);
const encodeName = value => [value.length, ...new TextEncoder().encode(value)];
const section = (identifier, bytes) => [identifier, bytes.length, ...bytes];
const executable = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0,
  ...section(1, [2, 0x60, 0, 0, 0x60, 1, 0x7f, 0]),
  ...section(2, [1, ...encodeName('env'), ...encodeName('memory'), 2, 3, 1, 8]),
  ...section(3, [2, 0, 1]),
  ...section(4, [1, 0x70, 0, 1]),
  ...section(7, [2, ...encodeName('_start'), 0, 0, ...encodeName('__indirect_function_table'), 1, 0]),
  ...section(9, [1, 0, 0x41, 0, 0x0b, 1, 1]),
  ...section(10, [2, 2, 0, 0x0b, 10, 0, 0x41, 0, 0x20, 0, 0x36, 2, 0, 0, 0x0b]),
]);

function runtime() {
  assert.equal(typeof global.gc, 'function', 'Run with --expose-gc');
  const source = fs.readFileSync(sourceUrl, 'utf8');
  const begin = 'function user_imports(';
  const end = '\nfunction start(';
  assert.equal(source.split(begin).length, 2);
  assert.equal(source.split(end).length, 2);
  const body = source.slice(source.indexOf(begin), source.indexOf(end));
  const observer = { instances: 0, traps: 0 };
  const makeUser = vm.runInNewContext(`(${body})`, {
    assert: (condition, message) => assert.ok(condition, message),
    URL, Uint8Array, Int32Array, SharedArrayBuffer, DataView, Atomics,
    WebAssembly: {
      ...WebAssembly,
      Module: WebAssembly.Module,
      Table: WebAssembly.Table,
      RuntimeError: WebAssembly.RuntimeError,
      Instance: new Proxy(WebAssembly.Instance, {
        construct(target, args) {
          observer.instances++;
          return Reflect.construct(target, args);
        },
      }),
    },
    allocate_shared_memory, memory_bytes, user_module_imports_supported, read_wasm_memories,
    ensureUserDestination, HALT_KERNEL,
    createJitControl: () => null,
    createAudioWrite: () => () => {},
    installFirefoxCallbackAdapter: () => 0,
    postMessage() {},
    console: { debug() {}, warn() {}, error(message) {
      assert.equal(message, '[user-module] WebAssembly runtime trap');
      observer.traps++;
    } },
  });
  return { makeUser, observer };
}

function startUser(makeUser, inherited = true) {
  const kernel = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
  const parent = inherited ? {
    module: new WebAssembly.Module(executable),
    ...allocate_shared_memory(2, 8),
    jit: null,
  } : null;
  if (parent) new Uint8Array(parent.memory.buffer)[12] = 91;
  const user = makeUser({ kernel_memory: kernel, get_kernel_instance: () => ({ exports: {} }), parent_user: parent });
  user.prepare();
  return { user, kernel, previous: parent && {
    context: new WeakRef(parent),
    memory: new WeakRef(parent.memory),
    module: new WeakRef(parent.module),
  } };
}

function compile(user, kernel, bytes = executable) {
  assert.equal(user.imports.compile_begin(bytes.length), 0);
  new Uint8Array(kernel.buffer).set(bytes);
  assert.equal(user.imports.compile_write(0, 0, bytes.length), 0);
  return user.imports.compile_end(8);
}

async function collected(references) {
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(setImmediate);
    global.gc();
    await new Promise(setImmediate);
    if (Object.values(references).every(reference => !reference.deref())) return true;
  }
  return false;
}

for (const instantiateParent of [false, true]) {
  test(`exec releases the ${instantiateParent ? 'instantiated' : 'deferred'} inherited context while the worker remains live`, async () => {
    const { makeUser, observer } = runtime();
    const { user, kernel, previous } = startUser(makeUser);
    assert.equal(observer.instances, 0);
    if (instantiateParent) user.imports.instantiate(0);
    assert.equal(compile(user, kernel), 0);
    user.imports.instantiate(1);
    assert.equal(observer.instances, instantiateParent ? 2 : 1);
    assert.equal(await collected(previous), true, 'Live user imports retain the replaced context/module/memory');
    assert.equal(user.context.memory.buffer.byteLength, 65536);
    assert.equal(user.imports.write(16, 0, 4), 0);
    assert.deepEqual([...new Uint8Array(user.context.memory.buffer, 16, 4)], [0, 97, 115, 109]);
  });
}

test('inherited memory survives pending, failed and aborted exec before replacement', async () => {
  const { makeUser } = runtime();
  const { user, kernel, previous } = startUser(makeUser);
  assert.equal(compile(user, kernel), 0);
  assert.equal(await collected(previous), false);
  assert.equal(user.context, previous.context.deref());
  user.imports.compile_abort();
  assert.equal(compile(user, kernel, new Uint8Array([1, 2, 3])), -8);
  user.imports.compile_abort();
  assert.equal(await collected(previous), false);
  assert.equal(user.context.memory, previous.memory.deref());
  assert.equal(new Uint8Array(user.context.memory.buffer)[12], 91);
});

test('clone entry remains lazy, writes inherited memory and reports its guest trap', () => {
  const { makeUser, observer } = runtime();
  const { user } = startUser(makeUser);
  user.imports.switch_entry(0, 73);
  assert.equal(observer.instances, 0);
  user.imports.call();
  assert.equal(observer.instances, 1);
  assert.equal(observer.traps, 1);
  assert.equal(new DataView(user.context.memory.buffer).getUint32(0, true), 73);
  user.imports.call();
  assert.equal(observer.instances, 1);
  assert.equal(observer.traps, 2);
});

test('a worker without inherited context rejects clone entry but supports exec', () => {
  const { makeUser, observer } = runtime();
  const { user, kernel } = startUser(makeUser, false);
  assert.equal(observer.instances, 0);
  assert.throws(() => user.imports.switch_entry(0, 1));
  assert.equal(compile(user, kernel), 0);
  user.imports.instantiate(1);
  assert.equal(observer.instances, 1);
  assert.equal(user.context.memory.buffer.byteLength, 65536);
});
