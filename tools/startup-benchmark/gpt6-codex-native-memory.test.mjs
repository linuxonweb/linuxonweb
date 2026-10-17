import test from 'node:test';
import assert from 'node:assert/strict';

const encodeName = value => [value.length, ...new TextEncoder().encode(value)];
const section = (identifier, bytes) => [identifier, bytes.length, ...bytes];
function fixture({ start = false, initializer = false, importName = 'memory' } = {}) {
  return new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 0x60, 0, 0]),
    ...section(2, [1, ...encodeName('env'), ...encodeName(importName), 2, 3, 1, 8]),
    ...section(3, initializer ? [2, 0, 0] : [1, 0]),
    ...section(7, [1, ...encodeName('_start'), 0, 0]),
    ...(start || initializer ? section(8, [initializer ? 1 : 0]) : []),
    ...section(10, initializer ? [2, 3, 0, 0, 0x0b, 2, 0, 0x0b] : [1, 3, 0, 0, 0x0b]),
  ]);
}

async function probe(options = {}) {
  const { createNativeMemoryProbe } = await import('./gpt6-codex-native-memory.mjs');
  const bytes = options.bytes ?? fixture();
  const events = [];
  const response = {
    ok: true, status: 200,
    headers: new Headers({ 'Content-Length': String(bytes.byteLength) }),
    arrayBuffer: async () => bytes.slice().buffer,
  };
  const instance = createNativeMemoryProbe({
    url: '/native.wasm', expectedBytes: bytes.byteLength,
    expectedPages: { minimum: 1, maximum: 8 },
    emit: event => events.push(event),
    fetch: async () => response,
    ...options.config,
  });
  return { instance, events };
}

test('real native constructors run in fixed stages without calling the trapping _start export', async () => {
  const { instance, events } = await probe();
  const stages = ['download', 'compile', 'drop-input', 'memory', 'instance', 'release'];
  const results = [];
  for (const stage of stages) results.push(await instance.step(stage));
  assert.ok(results[0].inputBytes > 0);
  assert.equal(results[1].inputBytes, results[0].inputBytes);
  assert.equal(results[2].inputBytes, 0);
  assert.equal(results[3].memoryBytes, 65536);
  assert.equal(results[3].maximumPages, 8);
  assert.deepEqual(results[4].exports, ['_start']);
  assert.equal(results[5].memoryBytes, 0);
  assert.equal(results[5].moduleHeld, false);
  assert.equal(results[5].instanceHeld, false);
  assert.equal(events.length, stages.length * 2);
  assert.deepEqual(events.filter(event => event.event === 'begin').map(event => event.phase), stages);
  assert.ok(events.every(event => Number.isFinite(event.timestampMs)));
  assert.ok(events.filter(event => event.event === 'end').every(event => event.ok && event.durationMs >= 0));
  await assert.rejects(instance.step('download'), /stage|phase|complete/i);
});

test('ordering and concurrent commands cannot start an extra allocation', async () => {
  let resolveResponse;
  const response = new Promise(resolve => { resolveResponse = resolve; });
  const { instance } = await probe({ config: { fetch: () => response } });
  await assert.rejects(instance.step('compile'), /stage|phase/i);
  const pending = instance.step('download');
  await assert.rejects(instance.step('download'), /busy|running/i);
  const bytes = fixture();
  resolveResponse({ ok: true, status: 200, headers: new Headers({ 'Content-Length': String(bytes.length) }), arrayBuffer: async () => bytes.buffer });
  assert.equal((await pending).inputBytes, bytes.length);
});

test('an automatic Wasm start section is rejected before native instantiation', async () => {
  const { instance, events } = await probe({ bytes: fixture({ start: true }) });
  await instance.step('download');
  await assert.rejects(instance.step('compile'), /start section/i);
  await assert.rejects(instance.step('memory'), /failed|terminal/i);
  assert.equal(events.at(-1).ok, false);
  assert.equal(events.at(-1).phase, 'compile');
});

test('declared and received input sizes are both required', async () => {
  for (const response of [
    { ok: false, status: 404 },
    { ok: true, status: 200, headers: new Headers({ 'Content-Length': '7' }) },
    { ok: true, status: 200, headers: new Headers(), arrayBuffer: async () => fixture().buffer },
    { ok: true, status: 200, headers: new Headers({ 'Content-Length': String(fixture().length) }), arrayBuffer: async () => new ArrayBuffer(7) },
  ]) {
    const { instance, events } = await probe({ config: { fetch: async () => response } });
    await assert.rejects(instance.step('download'), /response|size|length/i);
    assert.equal(events.at(-1).ok, false);
    await assert.rejects(instance.step('download'), /failed|terminal/i);
  }
});

test('memory identity and limits must match the pinned native plan', async () => {
  for (const options of [
    { bytes: fixture({ importName: 'other' }) },
    { config: { expectedPages: { minimum: 2, maximum: 8 } } },
    { config: { expectedPages: { minimum: 1, maximum: 16 } } },
  ]) {
    const { instance } = await probe(options);
    await instance.step('download');
    await assert.rejects(instance.step('compile'), /memory|import/i);
  }
});

test('malformed and truncated sections fail without an instance', async () => {
  for (const bytes of [fixture().slice(0, -1), new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 0, 128])]) {
    const { instance, events } = await probe({ bytes });
    await instance.step('download');
    await assert.rejects(instance.step('compile'));
    assert.equal(events.at(-1).ok, false);
    await assert.rejects(instance.step('instance'), /failed|terminal/i);
  }
});

test('an explicitly pinned initializer may run without invoking the separate trapping _start', async () => {
  const { instance } = await probe({ bytes: fixture({ initializer: true }), config: { expectedStart: { index: 1, bodyHex: '000b' } } });
  for (const phase of ['download', 'compile', 'drop-input', 'memory']) await instance.step(phase);
  const result = await instance.step('instance');
  assert.equal(result.startFunction, 1);
  assert.equal(result.instanceHeld, true);
  assert.deepEqual(result.exports, ['_start']);
  await instance.step('release');
});

test('initializer approval requires the exact function index and body, not merely an opt-in', async () => {
  for (const expectedStart of [{ index: 0, bodyHex: '000b' }, { index: 1, bodyHex: '00000b' }]) {
    const { instance } = await probe({ bytes: fixture({ initializer: true }), config: { expectedStart } });
    await instance.step('download');
    await assert.rejects(instance.step('compile'), /start|initializer/i);
  }
});
