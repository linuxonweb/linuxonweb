import test from 'node:test';
import assert from 'node:assert/strict';
import { jitPlan, jitPackets, seedJitBenchmark } from './gpt6-codex-jit.mjs';
import * as diagnostic from './gpt6-codex-jit.mjs';

test('full workload capture reserves cleanup time within ten minutes without extending startup probes', () => {
  assert.deepEqual(diagnostic.jitCaptureBounds(false), { observationSeconds: 120, ownerSeconds: 160, serviceSeconds: 170 });
  assert.deepEqual(diagnostic.jitCaptureBounds(true), { observationSeconds: 540, ownerSeconds: 580, serviceSeconds: 590 });
  for (const value of [undefined, 1, '1', null]) assert.throws(() => diagnostic.jitCaptureBounds(value));
});

const startPacket = { event: 'start', label: 'gpt6-jit', hc: 4 };
const donePacket = { event: 'done', label: 'gpt6-jit', ok: true, elapsedMs: 20000 };
const observation = (packets, elapsedMs = 50000) => diagnostic.jitObservation(packets, elapsedMs, 540000, 'gpt6-jit', 4);

test('workload observation retains a fixed navigation deadline before and after start', () => {
  assert.equal(observation([], 539999).state, 'running');
  assert.equal(observation([startPacket], 539999).state, 'running');
  assert.equal(observation([], 540000).state, 'timeout');
  assert.equal(observation([startPacket], 540000).state, 'timeout');
  assert.equal(observation([startPacket, donePacket], 540001).state, 'timeout');
});

test('done ends capture but cannot claim workload or native JIT acceptance', () => {
  const result = observation([startPacket, donePacket]);
  assert.equal(result.state, 'done');
  assert.equal(result.jitAcceptance, false);
  assert.equal(result.originalBenchmarkAcceptance, false);
});

test('workload observation rejects errors, duplicate sessions and mismatched CPU or label', () => {
  for (const packets of [
    [donePacket], [startPacket, startPacket], [startPacket, donePacket, donePacket],
    [{ ...startPacket, hc: 8 }], [{ ...startPacket, label: 'other' }],
    [startPacket, { ...donePacket, ok: false }],
    [startPacket, { ...donePacket, elapsedMs: -1 }],
    [startPacket, { ...donePacket, label: 'other' }],
    [startPacket, { event: 'error', label: 'gpt6-jit', error: 'checksum failure' }],
  ]) assert.equal(observation(packets).state, 'error', JSON.stringify(packets));
});

test('native compiler diagnostic summary retains IC mismatches rather than filtering them out', () => {
  const lines = ['PBLBC enabled', 'PBLBC ic mismatch at GetArg off=0 dyn=-1 static=0', 'PBLIC warning: rejected stub', 'other noise'];
  assert.deepEqual(diagnostic.jitCompilerLines(lines.join('\n')), lines.slice(0, 3));
});

test('JIT comparison changes only the method switch between IC and method arms', () => {
  const ic = jitPlan('ic'), method = jitPlan('method');
  assert.equal(ic.query, '&pblic=1&pblbc=0&pbljit=1');
  assert.equal(method.query, '&pblic=1&pblbc=1&pbljit=1');
  assert.equal(ic.filename, method.filename);
  assert.equal(ic.preferences, method.preferences);
  assert.match(ic.preferences, /browser.startup.homepage/);
  assert.match(ic.preferences, /devtools.console.stdout.content/);
  assert.equal(ic.jitAcceptance, false);
  for (const arm of ['', 'disabled', 'method&gpu=0', undefined]) assert.throws(() => jitPlan(arm), /arm/);
});

test('benchmark packets retain exact original content and reject malformed matching lines', () => {
  const packet = { event: 'case', label: 'gpt6-jit', round: 0, name: 'int-loop' };
  const encoded = `console.log: ${JSON.stringify('PBLBENCH ' + JSON.stringify(packet))}`;
  assert.deepEqual(jitPackets('noise\n' + encoded), [packet]);
  assert.deepEqual(jitPackets('PBLBENCH not a native console record'), []);
  assert.throws(() => jitPackets('console.log: "PBLBENCH bad"'), /JSON/);
});

function homeFixture() {
  const nodes = new Map([['', { path: '' }]]), writes = [], releases = [];
  const home = {
    root: nodes.get(''),
    async lookup(parent, name) { return nodes.get(`${parent.path}/${name}`); },
    async mkdir(parent, name, attributes) {
      const node = { path: `${parent.path}/${name}`, attributes };
      nodes.set(node.path, node);
      return node;
    },
    async create(parent, name, flags, attributes) {
      const node = { path: `${parent.path}/${name}`, flags, attributes };
      nodes.set(node.path, node);
      return { node, handle: node.path };
    },
    async write(node, handle, offset, bytes) { writes.push({ path: node.path, offset, text: new TextDecoder().decode(bytes) }); return bytes.length; },
    async release(node, handle) { releases.push(handle); },
  };
  return { home, nodes, writes, releases };
}

test('private preboot seed writes the unmodified workload and identical profile preferences', async () => {
  const { home, nodes, writes, releases } = homeFixture(), plan = jitPlan('method');
  await seedJitBenchmark(home, 'exact workload bytes', plan);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].path, '/admin/pblbench/gpt6-jit.html');
  assert.equal(writes[0].text, 'exact workload bytes');
  assert.equal(writes[1].text, plan.preferences);
  assert.ok(writes.every(row => row.offset === 0n));
  assert.equal(releases.length, 2);
  assert.equal(nodes.get('/admin/pblbench/gpt6-jit.html').attributes.uid, 1000);
});

test('seeding refuses an existing profile before any file writes', async () => {
  const fixture = homeFixture();
  await seedJitBenchmark(fixture.home, 'first', jitPlan('ic'));
  fixture.writes.length = 0;
  await assert.rejects(seedJitBenchmark(fixture.home, 'second', jitPlan('method')), /existing/);
  assert.deepEqual(fixture.writes, []);
});

test('failed seed writes still release their owned handle', async () => {
  const fixture = homeFixture(), failure = new Error('disk failed');
  fixture.home.write = async () => { throw failure; };
  await assert.rejects(seedJitBenchmark(fixture.home, 'workload', jitPlan('ic')), error => error === failure);
  assert.equal(fixture.releases.length, 1);
});
