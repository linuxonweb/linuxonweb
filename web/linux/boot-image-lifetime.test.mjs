import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const sourceUrl = process.env.LINUX_BOOT_IMAGE_TEST_SOURCE
  ? pathToFileURL(process.env.LINUX_BOOT_IMAGE_TEST_SOURCE)
  : new URL('./dist/index.js', import.meta.url);

async function runtime() {
  assert.equal(typeof vm.SourceTextModule, 'function', 'Run with --experimental-vm-modules');
  assert.equal(typeof global.gc, 'function', 'Run with --expose-gc');
  const source = fs.readFileSync(sourceUrl, 'utf8');
  const observer = { framebuffer: null };
  const dependencies = {
    platform: {
      load_wasm: async () => ({ bytes: new Uint8Array(), module: {} }),
      spawn_worker: () => ({ post() {}, async terminate() {} }),
    },
    assert: (condition, message) => assert.ok(condition, message),
    read_wasm_memories: () => ({ definitions: [], imports: [{ module: 'env', name: 'memory', type: { address: 'i32', shared: true, minimum: 1n, maximum: 65535n } }] }),
    allocate_shared_memory: (initial, maximum) => ({ memory: { buffer: new SharedArrayBuffer(initial * 65536) }, maximum_pages: maximum }),
    generate_devicetree: () => new Uint8Array(1),
    kernel_imports: () => ({}),
    virtio_imports: () => ({ config_written() {} }),
    createWorkerPool: () => ({ prewarm() {}, close() {} }),
    createFramebufferHost: (memory, options) => {
      observer.framebuffer = options;
      return { close() {} };
    },
    framebuffer_imports: () => ({}),
    MachineTerminationReason: { Clean: 0, Panic: 1 },
  };
  const context = vm.createContext({
    URL, TextEncoder, TextDecoder, TransformStream, Promise, Uint8Array,
    crypto: webcrypto,
    WebAssembly: {
      Module: { customSections: (module, name) => [name === '.linux.sections' ? new TextEncoder().encode('{}').buffer : new ArrayBuffer(0)] },
      instantiate: async () => ({ exports: { boot() {} } }),
    },
  });
  const namesBySpecifier = new Map();
  for (const match of source.matchAll(/(?:import|export)\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g)) {
    const names = namesBySpecifier.get(match[2]) ?? new Set();
    for (const name of match[1].split(',').map(value => value.trim()).filter(Boolean)) names.add(name);
    namesBySpecifier.set(match[2], names);
  }
  const linked = new Map();
  const module = new vm.SourceTextModule(source, {
    context,
    initializeImportMeta: meta => { meta.url = sourceUrl.href; },
  });
  await module.link(specifier => {
    if (!linked.has(specifier)) {
      const names = [...namesBySpecifier.get(specifier)];
      linked.set(specifier, new vm.SyntheticModule(names, function () {
        for (const name of names) this.setExport(name, dependencies[name] ?? (() => { throw Error('Unexpected dependency: ' + name); }));
      }, { context }));
    }
    return linked.get(specifier);
  });
  await module.evaluate();
  return { spawn: module.namespace.spawnMachine, observer };
}

async function startImage(spawn, promised) {
  const image = new Uint8Array(2 * 1024 * 1024);
  image[0] = 73;
  image[image.length - 1] = 91;
  const options = { devices: [], cpus: 1, initcpio: promised ? Promise.resolve(image) : image, gpuHostcall: false, framebuffer: { width: 8, height: 8, bpp: 32 } };
  Object.freeze(options);
  const machine = await spawn(options);
  assert.equal(options.initcpio instanceof Promise ? await options.initcpio : options.initcpio, image);
  assert.equal(new Uint8Array(machine.memory.buffer)[65536], 73);
  assert.equal(new Uint8Array(machine.memory.buffer)[65536 + image.length - 1], 91);
  return { machine, image: new WeakRef(image) };
}

async function collected(reference) {
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(setImmediate);
    global.gc();
    await new Promise(setImmediate);
    if (!reference.deref()) return true;
  }
  return false;
}

for (const promised of [false, true]) {
  test(`live framebuffer does not retain consumed ${promised ? 'promised' : 'direct'} boot image`, async () => {
    const { spawn, observer } = await runtime();
    const { machine, image } = await startImage(spawn, promised);
    try {
      assert.equal(typeof observer.framebuffer.onOverlaySupport, 'function');
      assert.equal(await collected(image), true, 'Frame callback retains the consumed boot image');
      observer.framebuffer.onOverlaySupport(true);
      assert.equal(new Uint8Array(machine.memory.buffer)[65536], 73);
    } finally {
      machine.close();
      await machine.closed;
    }
  });
}

test('frame callback preserves receiver, dimensions and original caller options', async () => {
  const { spawn, observer } = await runtime();
  const calls = [];
  const framebuffer = { width: 12, height: 9, bpp: 32, onOverlaySupport(value) { calls.push({ value, receiver: this }); } };
  const options = Object.freeze({ devices: [], cpus: 1, initcpio: new Uint8Array(4), gpuHostcall: false, framebuffer });
  const machine = await spawn(options);
  try {
    observer.framebuffer.onOverlaySupport(true);
    observer.framebuffer.onOverlaySupport(false);
    assert.deepEqual(calls, [{ value: true, receiver: framebuffer }, { value: false, receiver: framebuffer }]);
    assert.equal(observer.framebuffer.width, 12);
    assert.equal(observer.framebuffer.height, 9);
    assert.equal(options.initcpio.byteLength, 4);
  } finally {
    machine.close();
    await machine.closed;
  }
});
