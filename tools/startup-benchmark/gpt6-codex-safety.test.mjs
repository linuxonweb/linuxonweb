import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as safety from './gpt6-codex-safety.mjs';

const configuration = { safetyArm: 'reference-enabled', safetyLabel: 'gpt6-safety-reference',
  candidate: true, workerPool: true, cpus: 3, ramMiB: 2048, seconds: 150 };
const init = 'launch_firefox() {\n  /bin/su -s /bin/sh -c "export HOME=$home; exec /bin/firefox --no-remote --new-instance -profile /home/admin/.mozilla/firefox/http1-profile" "$account"\n}\n';
const capture = readFileSync(new URL('../nightly-jit-safety/guest-runner/capture-launch.sh', import.meta.url), 'utf8');

test('full safety is explicit and cannot be confused with the 24-row benchmark', () => {
  assert.equal(safety.fullSafetyPlan({}), null);
  for (const change of [{ safetyArm: 'off' }, { candidate: false }, { workerPool: false },
    { jitArm: 'method' }, { jitFull: true }, { jitIdentity: true }, { trace: true }, { timing: true },
    { seconds: 900 }, { seconds: 149 }, { cpus: 0 }, { cpus: 1.5 }, { cpus: 65 },
    { ramMiB: 4096 }, { safetyLabel: '../escape' }, { safetyLabel: '' }, { safetyLabel: 'x'.repeat(65) }]) {
    assert.throws(() => safety.fullSafetyPlan({ ...configuration, ...change }), JSON.stringify(change));
  }
});

test('reference enabled retains the original tier policy and finite complete-session bounds', () => {
  const plan = safety.fullSafetyPlan(configuration);
  assert.equal(plan.arm, 'enabled');
  assert.equal(plan.portableBaseline, true);
  assert.equal(plan.originalPolicyCompatible, true);
  assert.deepEqual(plan.environment, { PBLIC: '0', PBLBC: '0', PBLJIT: '1',
    PBLJIT_OBSERVE: '1', PBLJIT_LOG: '0', PBLIC_LOG: '0', PBLBC_LOG: '0' });
  assert.deepEqual(plan.bounds, { outerWallDeadlineSeconds: 150, scopeWallDeadlineSeconds: 30,
    observerLimitBytes: 2097152 });
  assert.deepEqual(plan.scopes, ['gc-debug-coverage', 'incremental', 'slice-gc', 'interrupt']);
  assert.deepEqual(plan.fixtureClaims, { compiled: 14, bailout: 7, excluded: 2, 'policy-excluded': 2 });
  assert.equal(plan.expectedRows, 50);
  assert.equal(plan.fullJITAcceptance, false);
});

test('reference disabled actually disables the portable tier, not just compiler environment switches', () => {
  const plan = safety.fullSafetyPlan({ ...configuration, safetyArm: 'reference-disabled' });
  assert.equal(plan.arm, 'disabled');
  assert.equal(plan.portableBaseline, false);
  assert.deepEqual([plan.environment.PBLIC, plan.environment.PBLBC, plan.environment.PBLJIT], ['0', '0', '0']);
  assert.deepEqual(plan.scopes, []);
  assert.equal(plan.expectedRows, 50);
  assert.match(plan.preferences, /user_pref\("javascript.options.portable_baseline",false\);/);
});

test('method diagnostic records its policy difference without weakening the original workload', () => {
  const plan = safety.fullSafetyPlan({ ...configuration, safetyArm: 'method-enabled' });
  assert.deepEqual([plan.environment.PBLIC, plan.environment.PBLBC, plan.environment.PBLJIT], ['1', '1', '1']);
  assert.equal(plan.portableBaseline, true);
  assert.equal(plan.originalPolicyCompatible, false);
  assert.match(plan.policyDifference, /throw/i);
  assert.equal(plan.fullJITAcceptance, false);
  assert.deepEqual(plan.fixtureClaims, safety.fullSafetyPlan(configuration).fixtureClaims);
  assert.deepEqual(plan.scopes, safety.fullSafetyPlan(configuration).scopes);
});

test('safety preferences preserve slow-script recovery and disable graphics diagnostics', () => {
  const plan = safety.fullSafetyPlan(configuration);
  assert.match(plan.preferences, /user_pref\("devtools.console.stdout.chrome",true\);/);
  assert.match(plan.preferences, /user_pref\("devtools.console.stdout.content",true\);/);
  assert.match(plan.preferences, /user_pref\("webgl.disabled",true\);/);
  assert.match(plan.preferences, /user_pref\("dom.webgpu.enabled",false\);/);
  assert.doesNotMatch(plan.preferences, /max_(?:script|chrome_script)_run_time|warmup|gczeal/);
});

test('capture overlay retains the original direct-stderr, session, wait and cleanup wrapper', () => {
  for (const safetyArm of ['reference-disabled', 'reference-enabled', 'method-enabled']) {
    const plan = safety.fullSafetyPlan({ ...configuration, safetyArm });
    const updated = safety.fullSafetyCapture(capture, plan);
    const exportLine = 'export ' + Object.entries(plan.environment).map(([key, value]) => `${key}=${value}`).join(' ');
    assert.ok(updated.includes(exportLine + '\n'));
    assert.ok(updated.includes(`[ "$label" = '${configuration.safetyLabel}' ] || exit 97\n`));
    assert.equal(updated.replace(exportLine, 'export PBLJIT_OBSERVE=1 PBLJIT_LOG=0')
      .replace(`[ "$label" = '${configuration.safetyLabel}' ] || exit 97\n`, ''), capture);
  }
});

test('capture overlay rejects missing or duplicate export and label anchors', () => {
  const plan = safety.fullSafetyPlan(configuration);
  for (const source of [capture.replace('export PBLJIT_OBSERVE=1 PBLJIT_LOG=0', ''),
    capture + '\nexport PBLJIT_OBSERVE=1 PBLJIT_LOG=0\n',
    capture.replace('label=$(cat /home/admin/nightly-jit-safety/active-label)', ''), capture + capture]) {
    assert.throws(() => safety.fullSafetyCapture(source, plan));
  }
  for (const change of [{ label: 'bad;label' }, { mode: 'unknown' },
    { environment: { ...plan.environment, PBLIC: '1; false' } },
    { environment: { ...plan.environment, PBLJIT_OBSERVE: '0' } }]) {
    assert.throws(() => safety.fullSafetyCapture(capture, { ...plan, ...change }));
  }
});

test('init overlay changes only the owned Firefox launch and installs diagnostic AutoConfig', () => {
  const changed = safety.fullSafetyInit(init);
  assert.match(changed, /cp \/home\/admin\/nightly-jit-safety\/njs-autoconfig.js \/opt\/firefox\/defaults\/pref\/njs-autoconfig.js \|\| return 97/);
  assert.match(changed, /exec \/bin\/sh \/home\/admin\/nightly-jit-safety\/capture-launch.sh" "\$account"/);
  assert.match(changed, /export HOME=\$home;/);
  assert.throws(() => safety.fullSafetyInit(init + init));
  assert.throws(() => safety.fullSafetyInit('#!/bin/sh\n'));
});
