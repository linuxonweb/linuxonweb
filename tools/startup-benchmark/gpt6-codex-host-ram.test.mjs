import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startupMemoryPlan } from './gpt6-codex-timing.mjs';

test('host probes can explicitly select 2 GiB without constructor instrumentation', () => {
  for (const ramMiB of [1024, 2048, 4096]) {
    assert.deepEqual(startupMemoryPlan({ ramMiB, candidate: true, jitArm: 'method' }), {
      ramMiB, resolution: '1280x720', query: '', diagnosticOnly: true,
    });
  }
  assert.equal(startupMemoryPlan({}), null);
});

test('host probes reject invalid or conflicting RAM choices', () => {
  for (const ramMiB of [null, true, '2048', 0, -1, 2048.5, 8192, NaN, Infinity]) {
    assert.throws(() => startupMemoryPlan({ ramMiB }), /RAM/);
  }
  assert.throws(() => startupMemoryPlan({
    ramMiB: 2048, memoryDiagnostic: true, timing: true, candidate: true,
  }), /RAM/);
});

test('the runner forwards an explicit RAM choice and the owner records observed guest selection', () => {
  const runner = readFileSync(new URL('./gpt6-codex-run.sh', import.meta.url), 'utf8');
  const owner = readFileSync(new URL('./gpt6-codex-browser.mjs', import.meta.url), 'utf8');
  assert.match(runner, /ramMiB: process\.env\.STARTUP_RAM_MIB === undefined \? undefined : Number\(process\.env\.STARTUP_RAM_MIB\)/);
  assert.match(owner, /selectedRamMiB:Number\(document\.querySelector\('#ram'\)\?\.value\)/);
  assert.match(owner, /sample\.selectedRamMiB !== \(memoryPlan\?\.ramMiB \?\? 4096\)/);
});
