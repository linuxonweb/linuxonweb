import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fullSafetyPlan } from './gpt6-codex-safety.mjs';
import * as owner from './gpt6-codex-safety-owner.mjs';

const plan = fullSafetyPlan({ safetyArm: 'reference-enabled', safetyLabel: 'fixture',
  candidate: true, workerPool: true, cpus: 3, ramMiB: 2048, seconds: 150 });
const session = { label: 'fixture', portableBaseline: true, buildBinding: { localBuildID: '20261004075010' } };
const json = value => Buffer.from(JSON.stringify(value));
const parent = { kind: 'actual-nightly-broad-parent-options-v1', label: 'fixture', version: '159.0a1',
  applicationBuildID: '20261004075010', platformBuildID: '20261004075010', processID: 71, processType: 0,
  startupPref: true, actualJitOptions: { 'pbl.enable': 1, 'pbl.warmup.threshold': 10 }, observerEnabled: '1', logBudget: '0' };
const result = { kind: 'actual-firefox-jit-gate-session', label: 'fixture', portableBaseline: true,
  status: 'recorded', operations: plan.scopes.map(scope => ({ scope, status: 'recorded' })) };
const native = Buffer.from('PBLJIT_OPTION event=startup pid=71 tid=71 pthread=123 option=1 threshold=10 available=1 pref=1 safemode=0\n');
const files = {
  'observer.stderr': native,
  'parent-option.json': json(parent),
  'session-result.json': json(result),
  'firefox-launch.json': json({ kind: 'actual-owned-firefox-launch-v1', pid: 71, observerEnabled: '1', logBudget: '0' }),
  'firefox-exit.json': json({ kind: 'actual-owned-firefox-exit-v1', pid: 71, status: 0, reaped: true, naturalGroupEmpty: true, forced: false }),
  'firefox-start.stat': Buffer.from('71 (firefox) S 1 71 71 0 0 0 0 0 0 0 0 0 0 0 0 0 0 900 10 1'),
  'firefox-limits.txt': Buffer.from('Max file size unlimited unlimited bytes\nMax core file size 0 0 bytes\n'),
  'firefox-group-terminal.txt': Buffer.alloc(0),
  'shell-probe.txt': Buffer.from('PBL_SHELL_PROBE errexit=pass required=pass procTail=pass setsid=pass fileBlocks=2048\n'),
  ...Object.fromEntries(plan.scopes.flatMap(scope => [[scope + '-console.txt', Buffer.from('raw privileged transcript\n')],
    [scope + '-result.json', json({ scope, status: 'recorded' })]])),
};

function filled(changes = {}) {
  const capture = owner.createFullSafetyCollector(plan, session, 1000);
  for (const [name, data] of Object.entries({ ...files, ...changes })) if (data !== null) capture.record(name, data, 2000);
  return capture;
}

test('full safety deadline starts at browser spawn and never resets with navigation or readiness', () => {
  const capture = owner.createFullSafetyCollector(plan, session, 1000);
  assert.equal(capture.remaining(1000), 150000);
  assert.equal(capture.remaining(149999), 1001);
  assert.throws(() => capture.remaining(151000), /150/);
  assert.throws(() => capture.record('observer.stderr', native, 151001), /150/);
  assert.throws(() => filled().complete(151000), /150/);
});

test('capture completion requires original scopes and natural owned guest exit, but grants no JIT acceptance', () => {
  const captured = filled().complete(3000);
  assert.equal(captured.captureComplete, true);
  assert.equal(captured.fullJITAcceptance, false);
  assert.equal(captured.pass, false);
  assert.equal(captured.status, 'captured-awaiting-independent-review');
  assert.deepEqual(captured.scopes, plan.scopes);
});

test('collector waits for publication and rejects missing, failed or mismatched evidence', () => {
  assert.equal(filled({ 'session-result.json': null }).ready(), false);
  assert.equal(filled({ 'firefox-exit.json': null }).ready(), false);
  for (const change of [
    { 'session-result.json': json({ ...result, status: 'pending' }) },
    { 'session-result.json': json({ ...result, operations: result.operations.slice(0, 3) }) },
    { 'parent-option.json': json({ ...parent, processID: 72 }) },
    { 'firefox-exit.json': json({ ...JSON.parse(files['firefox-exit.json']), forced: true }) },
    { 'interrupt-console.txt': null },
    { 'firefox-group-terminal.txt': files['firefox-start.stat'] },
    { 'shell-probe.txt': Buffer.from('not verified') },
    { 'observer.stderr': native.subarray(0, native.length - 1) },
  ]) assert.throws(() => filled(change).complete(3000));
});

test('direct capture rejects truncation, replacement and its original two-MiB boundary', () => {
  for (const data of [native.subarray(0, 10), Buffer.from('replacement\n'), Buffer.alloc(2097152)]) {
    const capture = filled();
    assert.throws(() => capture.record('observer.stderr', data, 3000));
  }
  const capture = filled();
  capture.record('observer.stderr', Buffer.concat([native, Buffer.from('next\n')]), 3000);
  assert.equal(capture.complete(4000).captureComplete, true);
  assert.throws(() => capture.record('../foreign', Buffer.alloc(0), 3000));
});

test('disabled collector retains the same ownership gates and no enabled-only scopes', () => {
  const disabled = fullSafetyPlan({ safetyArm: 'reference-disabled', safetyLabel: 'fixture',
    candidate: true, workerPool: true, cpus: 3, ramMiB: 2048, seconds: 150 });
  const capture = owner.createFullSafetyCollector(disabled, { ...session, portableBaseline: false }, 1000);
  for (const name of capture.names) {
    let data = files[name];
    if (name === 'session-result.json') data = json({ ...result, portableBaseline: false, operations: [] });
    if (name === 'parent-option.json') data = json({ ...parent, startupPref: false, actualJitOptions: { 'pbl.enable': 0, 'pbl.warmup.threshold': 10 } });
    if (name === 'observer.stderr') data = Buffer.from(native.toString().replace('option=1', 'option=0').replace('pref=1', 'pref=0'));
    capture.record(name, data, 2000);
  }
  assert.equal(capture.complete(3000).captureComplete, true);
  assert.deepEqual(capture.complete(3000).scopes, []);
});

test('browser owner wires safety preflight, exact init overlay, seeding and bounded capture', () => {
  const source = readFileSync(new URL('./gpt6-codex-browser.mjs', import.meta.url), 'utf8');
  assert.match(source, /const safetyPlan = fullSafetyPlan\(config\)/);
  assert.match(source, /loadFullSafetyBundle\(/);
  assert.match(source, /instrumentFullSafetyInit\(/);
  assert.match(source, /seedFullSafety\(/);
  assert.match(source, /createFullSafetyCollector\(/);
  assert.match(source, /readFullSafetyArtifact\(/);
  assert.match(source, /safetyCapture\.remaining\(/);
  assert.match(source, /safetyCapture\.complete\(/);
});

test('launcher selects explicit full safety inputs without changing ordinary benchmark deadlines', () => {
  const source = readFileSync(new URL('./gpt6-codex-run.sh', import.meta.url), 'utf8');
  assert.match(source, /STARTUP_SAFETY_ARM/);
  assert.match(source, /STARTUP_SAFETY_LABEL/);
  assert.match(source, /STARTUP_SAFETY_BUNDLE_SHA256/);
  assert.match(source, /safetyArm \? 150 : jitArm \?/);
  assert.match(source, /fullSafetyPlan\(configuration\)/);
  assert.match(source, /STARTUP_RECEIPT/);
});
