import test from 'node:test';
import assert from 'node:assert/strict';
import { jitPlan } from './gpt6-codex-jit.mjs';

test('disabled native JIT control requests all three compilers off without changing the workload or preferences', () => {
  const off = jitPlan('off');
  const method = jitPlan('method');
  const ic = jitPlan('ic');
  assert.equal(off.query, '&pblic=0&pblbc=0&pbljit=0');
  assert.equal(ic.query, '&pblic=1&pblbc=0&pbljit=1');
  assert.equal(method.query, '&pblic=1&pblbc=1&pbljit=1');
  assert.equal(off.filename, method.filename);
  assert.equal(off.preferences, method.preferences);
  assert.equal(off.preferences, ic.preferences);
  assert.equal(off.jitAcceptance, false);
});
