import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import * as timing from './gpt6-codex-timing.mjs';
import { installStartupTiming, instrumentStartupSource } from './gpt6-codex-timing.mjs';

test('constructor timing preserves values, prototypes, static methods and exceptions', () => {
  const failure = new Error('compile failed');
  class Module {
    static exports() { return ['export']; }
    constructor(bytes) { if (bytes === null) throw failure; this.bytes = bytes; }
  }
  class Instance { constructor(module, imports) { this.module = module; this.imports = imports; } }
  const api = { Module, Instance }, events = [];
  let now = 0;
  installStartupTiming(api, { timeOrigin: 1000, now: () => ++now }, event => events.push(event));
  const bytes = new Uint8Array(8), imports = {};
  const module = new api.Module(bytes), instance = new api.Instance(module, imports);
  assert.ok(module instanceof Module);
  assert.ok(instance instanceof Instance);
  assert.equal(module.bytes, bytes);
  assert.equal(instance.module, module);
  assert.equal(instance.imports, imports);
  assert.deepEqual(api.Module.exports(), ['export']);
  assert.throws(() => new api.Module(null), error => error === failure);
  assert.deepEqual(events.map(event => [event.operation, event.phase, event.ok]), [
    ['Module', 'begin', undefined], ['Module', 'end', true],
    ['Instance', 'begin', undefined], ['Instance', 'end', true],
    ['Module', 'begin', undefined], ['Module', 'end', false],
  ]);
  assert.equal(events[0].bytes, 8);
  assert.equal(events[1].durationMs, 1);
  assert.equal(events[0].timestampMs, 1001);
  assert.equal(events[1].id, events[0].id);
});

test('diagnostic delivery failures and event caps do not change constructors', () => {
  class Constructor {}
  const api = { Module: Constructor, Instance: Constructor };
  let delivered = 0;
  installStartupTiming(api, { timeOrigin: 0, now: () => 0 }, () => { delivered++; throw Error('lost'); }, 2);
  for (let index = 0; index < 10; index++) assert.ok(new api.Module() instanceof Constructor);
  assert.equal(delivered, 2);
});

test('native Wasm objects remain valid modules and instances under timing', () => {
  const api = { Module: WebAssembly.Module, Instance: WebAssembly.Instance }, events = [];
  installStartupTiming(api, performance, event => events.push(event));
  const module = new api.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  assert.ok(module instanceof WebAssembly.Module);
  assert.deepEqual(api.Module.exports(module), []);
  const instance = new api.Instance(module);
  assert.ok(instance instanceof WebAssembly.Instance);
  assert.deepEqual(Object.keys(instance.exports), []);
  assert.equal(events.length, 4);
  assert.ok(events.filter(event => event.phase === 'end').every(event => event.ok));
});

test('instrumentation changes only known frozen worker/platform anchors', () => {
  const worker = 'const channel = platform.worker_channel();\nconst postMessage = channel.post;\n';
  const patched = instrumentStartupSource('worker', worker);
  assert.ok(patched.includes(worker));
  assert.ok(patched.includes('installStartupTiming'));
  const platform = 'worker.onmessage = (event) => handlers.on_message(event.data);';
  const received = [], context = { worker: {}, handlers: { on_message: data => received.push(data) } };
  vm.runInNewContext(instrumentStartupSource('platform', platform), context);
  context.worker.onmessage({ data: { type: 'normal' } });
  context.worker.onmessage({ data: { type: '__gpt6StartupTiming', event: { operation: 'Module' } } });
  assert.deepEqual(received, [{ type: 'normal' }]);
  assert.equal(context.__gpt6StartupTimings.length, 1);
  assert.equal(context.__gpt6StartupTimings[0].operation, 'Module');
  for (let index = 0; index < 20010; index++) context.worker.onmessage({ data: { type: '__gpt6StartupTiming', event: {} } });
  assert.equal(context.__gpt6StartupTimings.length, 20000);
  assert.throws(() => instrumentStartupSource('platform', ''), /anchor/);
  assert.throws(() => instrumentStartupSource('worker', worker + worker), /anchor/);
  assert.throws(() => instrumentStartupSource('other', worker), /kind/);
});

test('memory timing preserves native allocation and joins instances to module sizes', () => {
  const api = { Module: WebAssembly.Module, Instance: WebAssembly.Instance, Memory: WebAssembly.Memory };
  const events = [];
  installStartupTiming(api, performance, event => events.push(event));
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const module = new api.Module(bytes);
  const memory = new api.Memory({ initial: 1, maximum: 3, shared: true });
  const instance = new api.Instance(module);
  assert.ok(instance instanceof WebAssembly.Instance);
  assert.ok(memory instanceof WebAssembly.Memory);
  assert.equal(memory.buffer.byteLength, 65536);
  const allocation = events.filter(event => event.operation === 'Memory');
  assert.equal(allocation.length, 2);
  assert.equal(allocation[1].memoryBytes, 65536);
  assert.equal(allocation[1].ok, true);
  assert.equal(events.find(event => event.operation === 'Instance').bytes, bytes.length);
  assert.equal(memory.grow(1), 1);
  assert.equal(memory.buffer.byteLength, 131072);
});

test('memory timing does not read descriptors again or replace allocation errors', () => {
  let reads = 0;
  const events = [], api = { Module: WebAssembly.Module, Instance: WebAssembly.Instance, Memory: WebAssembly.Memory };
  installStartupTiming(api, performance, event => events.push(event));
  new api.Memory({ get initial() { reads++; return 1; } });
  assert.equal(reads, 1);
  assert.throws(() => new api.Memory({ initial: 2, maximum: 1 }), RangeError);
  assert.equal(events.filter(event => event.operation === 'Memory' && event.phase === 'end').at(-1).ok, false);
});

test('memory diagnostic requires timing and remains separate from JIT acceptance', () => {
  assert.equal(typeof timing.startupMemoryPlan, 'function');
  assert.equal(timing.startupMemoryPlan({}), null);
  assert.deepEqual(timing.startupMemoryPlan({ memoryDiagnostic: true, timing: true, candidate: true }), {
    ramMiB: 1024, resolution: '800x600', query: '&gpu=0&compressed-initramfs=1', diagnosticOnly: true,
  });
  for (const config of [
    { memoryDiagnostic: 'yes' }, { memoryDiagnostic: true },
    { memoryDiagnostic: true, timing: true },
    { memoryDiagnostic: true, timing: true, candidate: true, jitArm: 'method' },
    { memoryDiagnostic: true, timing: true, candidate: true, workerPool: true },
    { memoryDiagnostic: true, timing: true, candidate: true, trace: true },
  ]) assert.throws(() => timing.startupMemoryPlan(config));
});

test('desktop memory diagnostic wires opt-in settings and retains timestamped process samples', () => {
  const owner = fs.readFileSync(new URL('./gpt6-codex-browser.mjs', import.meta.url), 'utf8');
  assert.match(owner, /startupMemoryPlan\(config\)/);
  assert.match(owner, /memoryPlan\?\.ramMiB/);
  assert.match(owner, /memoryPlan\?\.query/);
  assert.match(owner, /memory-resources\.jsonl/);
  assert.match(owner, /timestampMs: Date\.now\(\)/);
});
