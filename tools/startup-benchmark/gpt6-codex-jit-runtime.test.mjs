import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as overlays from './gpt6-codex-overlays.mjs';
import { hostJitIdentityPlan } from './gpt6-codex-jit-identity.mjs';
import { jitCaptureBounds, jitPlan } from './gpt6-codex-jit.mjs';

const combined = {
  candidate: true, workerPool: true, jitRuntime: 'worker-pool',
  jitArm: 'method', jitIdentity: true,
};
const nonce = '0123456789abcdef0123456789abcdef';

test('ordinary startup and frozen-runtime JIT retain their existing defaults', () => {
  assert.equal(overlays.jitRuntimePlan({}), null);
  assert.equal(overlays.jitRuntimePlan({ candidate: true, workerPool: true }), null);
  assert.deepEqual(overlays.jitRuntimePlan({ jitArm: 'method' }), {
    variant: 'frozen-runtime', changedRuntime: false, jitAcceptance: false,
  });
});

test('combined JIT admission explicitly labels all runtime changes without granting acceptance', () => {
  for (const jitArm of ['off', 'ic', 'method']) {
    const config = { ...combined, jitArm };
    assert.deepEqual(overlays.jitRuntimePlan(config), {
      variant: 'worker-pool-lifetime', changedRuntime: true, jitAcceptance: false,
    });
    assert.deepEqual(overlays.candidateFiles(config).slice(3), [
      'dist/index.js', 'dist/worker.js', 'dist/wasm.js', 'dist/worker-pool.mjs',
    ]);
    const identity = hostJitIdentityPlan(config, nonce);
    assert.equal(identity.nonce, nonce);
    assert.equal(identity.jitAcceptance, false);
    assert.deepEqual(identity.expectedEnvironment, {
      PBLIC: jitArm === 'off' ? '0' : '1',
      PBLBC: jitArm === 'method' ? '1' : '0',
      PBLJIT: jitArm === 'off' ? '0' : '1',
    });
  }
});

test('worker reuse never silently changes an existing JIT diagnostic', () => {
  for (const jitRuntime of [undefined, null, false, '', 'pool', 'frozen-runtime']) {
    const config = { ...combined, jitRuntime };
    assert.throws(() => overlays.jitRuntimePlan(config), /runtime|explicit/i);
    assert.throws(() => hostJitIdentityPlan(config, nonce));
  }
});

test('combined runtime requires the candidate, actual pool and native identity probe', () => {
  for (const field of ['candidate', 'workerPool', 'jitIdentity']) {
    for (const value of [undefined, false, 'true', 1]) {
      assert.throws(() => overlays.jitRuntimePlan({ ...combined, [field]: value }), /candidate|pool|identity/i);
    }
  }
  assert.throws(() => overlays.jitRuntimePlan({ ...combined, jitArm: null }), /JIT arm/i);
  assert.throws(() => overlays.jitRuntimePlan({ ...combined, jitArm: 'unknown' }), /JIT arm/i);
});

test('neither runtime can combine JIT with constructor timing or tracing', () => {
  for (const config of [combined, { candidate: true, jitArm: 'method', jitIdentity: true }]) {
    for (const flag of ['timing', 'trace']) {
      assert.throws(() => overlays.jitRuntimePlan({ ...config, [flag]: true }), /instrumentation/i);
      assert.throws(() => hostJitIdentityPlan({ ...config, [flag]: true }, nonce));
    }
  }
});

test('runtime selection does not change workload preferences or bounded capture', () => {
  overlays.jitRuntimePlan(combined);
  const plan = jitPlan('method');
  assert.equal(plan.filename, 'gpt6-jit.html');
  assert.equal(plan.query, '&pblic=1&pblbc=1&pbljit=1');
  assert.equal(plan.jitAcceptance, false);
  assert.deepEqual(jitCaptureBounds(false), { observationSeconds: 120, ownerSeconds: 160, serviceSeconds: 170 });
  assert.deepEqual(jitCaptureBounds(true), { observationSeconds: 540, ownerSeconds: 580, serviceSeconds: 590 });
});

test('browser validates runtime selection before allocating resources and records it with JIT results', () => {
  const source = readFileSync(new URL('./gpt6-codex-browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /import \{[^}]*jitRuntimePlan[^}]*\} from '\.\/gpt6-codex-overlays\.mjs'/);
  const admission = source.indexOf('const jitRuntime = jitRuntimePlan(config);');
  assert.ok(admission > 0 && admission < source.indexOf('const started = performance.now();'));
  assert.match(source, /report\.jit = \{[^\n]*runtime: jitRuntime/);
  assert.doesNotMatch(source, /if \(jit && \(config\.trace \|\| config\.timing \|\| config\.workerPool\)\)/);
});
