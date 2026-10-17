import test from 'node:test';
import assert from 'node:assert/strict';
import { broadCases } from '../nightly-jit-safety/cases-broad.mjs';
import { fullSafetyPlan } from './gpt6-codex-safety.mjs';
import * as owner from './gpt6-codex-safety-owner.mjs';

const hash = 'a'.repeat(64);
const label = 'fixture';
const plan = fullSafetyPlan({ safetyArm: 'reference-enabled', safetyLabel: label,
  candidate: true, workerPool: true, cpus: 3, ramMiB: 2048, seconds: 150 });
const binding = { kind: 'caller-reviewed-full-nightly-jit-build-binding-v1', pass: true,
  target: 'wasm32-linux-musl', version: '159.0a1', localBuildID: '20261004075010',
  environmentSlotCount: 23, broadCoverage: true, restartOnlyPref: 'javascript.options.portable_baseline',
  ...Object.fromEntries(['finalBinarySHA256', 'archiveSHA256', 'runtimeManifestSHA256', 'kernelSHA256',
    'buildReviewSHA256', 'observerPblSha256', 'observerInterpreterSha256', 'optionObserverWorkerSha256',
    'optionObserverStartupSha256'].map(name => [name, hash])) };
const expectedUrl = `file:///home/admin/nightly-jit-safety/${label}/`;
const cases = ['main', 'worker'].flatMap(context => broadCases.map(entry => {
  const name = `${label}-${context}-${entry.id}.js`;
  return { ...entry, context, name, url: expectedUrl + name, line: 1 };
}));
const files = Object.fromEntries([...cases.map(entry => entry.name), ...['debugFresh', 'coverage', 'infinite'].map(name => `${label}-main-${name}.js`),
  `${label}-worker.js`, `${label}.html`].map(name => [name, hash]));
const fixture = { schema: 1, coverage: 'broad', label, expectedUrl, cases, files };
const drivers = Object.fromEntries(['privileged-driver.js', 'guest-content.sys.mjs', 'guest-entry.sys.mjs',
  'NightlyJitSafetyChild.sys.mjs', 'NightlyJitSafetyParent.sys.mjs', 'runner-entry.sys.mjs'].map(name => [name, hash]));

test('session construction keeps all original rows, scopes, bounds and explicit current binding', () => {
  const session = owner.fullSafetySession(plan, fixture, binding, hash, drivers);
  assert.equal(session.kind, 'nightly-jit-guest-session-preparation-v1');
  assert.deepEqual(session.fixtureContract, fixture);
  assert.deepEqual(session.files, drivers);
  assert.deepEqual(session.buildBinding, binding);
  assert.equal(session.buildBindingSHA256, hash);
  assert.equal(session.requestedGuestCpus, 3);
  assert.equal(session.outerWallDeadlineSeconds, 150);
  assert.equal(session.scopeWallDeadlineSeconds, 30);
  assert.equal(session.observerLimitBytes, 2097152);
  assert.equal(session.guestAcceptance, false);
});

test('session construction refuses incomplete or weakened original fixtures', () => {
  for (const change of [{ coverage: 'integer' }, { label: 'other' }, { expectedUrl: 'file:///other/' },
    { cases: cases.slice(0, 49) }, { cases: [...cases].reverse() },
    { cases: cases.map((entry, index) => index ? entry : { ...entry, expected: 0 }) },
    { files: { ...files, '../escape': hash } }, { files: {} }]) {
    assert.throws(() => owner.fullSafetySession(plan, { ...fixture, ...change }, binding, hash, drivers));
  }
  assert.throws(() => owner.fullSafetySession(plan, fixture, { ...binding, pass: false }, hash, drivers));
  assert.throws(() => owner.fullSafetySession(plan, fixture, binding, 'invalid', drivers));
  assert.throws(() => owner.fullSafetySession(plan, fixture, binding, hash, {}));
});

test('session arms never inherit a stale prepared CPU or portable preference', () => {
  const disabledPlan = fullSafetyPlan({ safetyArm: 'reference-disabled', safetyLabel: label,
    candidate: true, workerPool: true, cpus: 6, ramMiB: 2048, seconds: 150 });
  const session = owner.fullSafetySession(disabledPlan, fixture, binding, hash, drivers);
  assert.equal(session.portableBaseline, false);
  assert.equal(session.requestedGuestCpus, 6);
  assert.deepEqual(session.fixtureClaims, plan.fixtureClaims);
});
