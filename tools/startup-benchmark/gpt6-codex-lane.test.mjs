import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cpuLane } from './gpt6-codex-lane.mjs';

test('explicit CPU lanes select only available CPUs without changing browser-reported counts', () => {
  assert.deepEqual(cpuLane('2', '0-7'), { cpus: 2, affinity: '0,1', quota: '200%' });
  assert.deepEqual(cpuLane('4', '0-7'), { cpus: 4, affinity: '0,1,2,3', quota: '400%' });
  assert.deepEqual(cpuLane('2', '2,4-5,7'), { cpus: 2, affinity: '2,4', quota: '200%' });
  assert.deepEqual(cpuLane('1', '7'), { cpus: 1, affinity: '7', quota: '100%' });
});

test('CPU lanes reject invalid requests or insufficient affinity before any launch', () => {
  for (const request of ['', '0', '-1', '1.5', '02', '2 ', '2;echo', undefined, 2, '9']) {
    assert.throws(() => cpuLane(request, '0-7'));
  }
  for (const affinity of ['', '3-1', '0-3,3', '0-', '1.5']) {
    assert.throws(() => cpuLane('2', affinity));
  }
});

test('runner binds the requested CPU lane to quota, affinity and guest configuration', () => {
  const runner = readFileSync(new URL('./gpt6-codex-run.sh', import.meta.url), 'utf8');
  assert.match(runner, /gpt6-codex-lane\.mjs" "\$\{STARTUP_CPUS:-4\}"/);
  assert.match(runner, /read -r cpus cpu_affinity cpu_quota/);
  assert.match(runner, /CPUQuota=\$cpu_quota/);
  assert.match(runner, /taskset -c "\$cpu_affinity"/);
  assert.match(runner, /cpus: Number\(cpus\)/);
  assert.doesNotMatch(runner, /cpus: 4|CPUQuota=400%|taskset -c 0-3/);
  assert.ok(runner.indexOf('gpt6-codex-lane.mjs') < runner.indexOf('truncate -s'));
});

test('runner establishes disk scratch before spawning the CPU-lane helper', () => {
  const runner = readFileSync(new URL('./gpt6-codex-run.sh', import.meta.url), 'utf8');
  const helper = runner.indexOf('gpt6-codex-lane.mjs');
  assert.ok(helper > runner.indexOf('export TMPDIR='));
  assert.ok(helper > runner.indexOf('findmnt -n -o FSTYPE'));
});
