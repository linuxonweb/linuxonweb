import test from 'node:test';
import assert from 'node:assert/strict';
import { cpuCapacity, guestCpus, routePath, assertContainment, availableMemory } from './gpt6-codex-contract.mjs';

test('CPU capacity includes all ancestors, not just affinity', () => {
  assert.deepEqual(cpuCapacity('0-7', ['max 100000', '560000 100000']), { affinity: 8, capacity: 5.6 });
  assert.deepEqual(cpuCapacity('0-3', ['400000 100000', '560000 100000']), { affinity: 4, capacity: 4 });
  assert.deepEqual(cpuCapacity('0,2-3,7', ['max 100000']), { affinity: 4, capacity: 4 });
});

test('CPU evidence fails closed on missing or malformed limits', () => {
  for (const affinity of ['', '3-1', '0-3,3', '0-', '1.5']) assert.throws(() => cpuCapacity(affinity, ['max 100000']));
  for (const limits of [[], [''], ['0 100000'], ['max 0'], ['2'], ['x 100000']]) assert.throws(() => cpuCapacity('0-7', limits));
});

test('guest CPU evidence is from current supplied logs only', () => {
  assert.equal(guestCpus('smp: Brought up 1 node, 4 CPUs\n'), 4);
  assert.equal(guestCpus('smp: Brought up 1 node, 6 CPUs\nsmp: Brought up 1 node, 4 CPUs'), 4);
  assert.equal(guestCpus('Firefox was launched'), null);
});

test('route lookup rejects encoded traversal and uses explicit allowlist paths', () => {
  assert.equal(routePath('/linux/main.js?v=12'), '/linux/main.js');
  assert.equal(routePath('/linux/a%20b.js'), '/linux/a b.js');
  for (const route of ['/../etc/passwd', '/linux/%2e%2e/etc/passwd', '/linux/%2fetc', '/linux/%00', '/linux/%zz', 'https://other/linux/main.js']) assert.throws(() => routePath(route));
});

test('process migration cannot inherit the old service memory accounting', () => {
  const expected = '/user.slice/test.service';
  assert.doesNotThrow(() => assertContainment(expected, [
    { pid: 123, cgroup: expected }, { pid: 124, cgroup: `${expected}/child` },
  ]));
  for (const cgroup of ['/cpulimit.slice/cpulimit-70.slice', '/user.slice/app-org.chromium.scope', `${expected}-other`, null]) {
    assert.throws(() => assertContainment(expected, [{ pid: 123, cgroup }]), /containment/i);
  }
  assert.throws(() => assertContainment(expected, []), /containment/i);
});

test('RAM guard uses available memory, not free memory or the old unit limit', () => {
  assert.deepEqual(availableMemory('MemFree: 100 kB\nMemAvailable: 1048576 kB\n'), { bytes: 1073741824, low: false });
  assert.deepEqual(availableMemory('MemAvailable: 1048575 kB\n'), { bytes: 1073740800, low: true });
  assert.deepEqual(availableMemory('MemAvailable: 20000000 kB\n'), { bytes: 20480000000, low: false });
  for (const input of ['', 'MemFree: 20000000 kB', 'MemAvailable: -1 kB', 'MemAvailable: 10 MB']) {
    assert.throws(() => availableMemory(input), /available memory/i);
  }
});
