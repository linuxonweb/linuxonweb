import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as identity from './gpt6-codex-jit-identity.mjs';
import { jitPlan } from './gpt6-codex-jit.mjs';
import { firefoxJitFlags } from '../../web/linux/firefox-jit-config.mjs';

const nonce = '0123456789abcdef0123456789abcdef';

test('host identity is opt-in and refuses incompatible configurations', () => {
  assert.equal(identity.hostJitIdentityPlan({}, nonce), null);
  assert.equal(identity.hostJitIdentityPlan({ jitIdentity: false }, nonce), null);
  for (const config of [
    { jitIdentity: '1' }, { jitIdentity: true },
    { jitIdentity: true, candidate: false, jitArm: 'method' },
    { jitIdentity: true, candidate: true, jitArm: 'unknown' },
    ...['trace', 'timing', 'workerPool'].map(name => ({ jitIdentity: true, candidate: true, jitArm: 'method', [name]: true })),
  ]) assert.throws(() => identity.hostJitIdentityPlan(config, nonce));
  assert.throws(() => identity.hostJitIdentityPlan({ jitIdentity: true, candidate: true, jitArm: 'method' }, 'bad'));
});

test('host identity expectations agree with explicit guest switches in every arm', () => {
  for (const arm of ['off', 'ic', 'method']) {
    const plan = identity.hostJitIdentityPlan({ jitIdentity: true, candidate: true, jitArm: arm }, nonce);
    assert.equal(plan.nonce, nonce);
    assert.equal(plan.diagnosticOnly, true);
    assert.equal(plan.jitAcceptance, false);
    const expected = { PBLIC: arm === 'off' ? '0' : '1', PBLBC: arm === 'method' ? '1' : '0', PBLJIT: arm === 'off' ? '0' : '1' };
    assert.deepEqual(plan.expectedEnvironment, expected);
    const flags = Object.fromEntries(firefoxJitFlags(jitPlan(arm).query).map(flag => flag.split('=')));
    assert.deepEqual({ PBLIC: flags.pblic, PBLBC: flags.pblbc, PBLJIT: flags.PBLJIT }, expected);
  }
});

test('host owner instruments and pins its private overlay and checks observed native identity', () => {
  const owner = readFileSync(new URL('./gpt6-codex-browser.mjs', import.meta.url), 'utf8');
  assert.match(owner, /hostJitIdentityPlan\(config, crypto\.randomBytes\(16\)\.toString\('hex'\)\)/);
  assert.match(owner, /name === 'desktop-extras\.mjs' && identityPlan/);
  const instrument = owner.indexOf('instrumentJitIdentitySource(');
  const overlayPin = owner.indexOf("const bytes = fs.readFileSync(snapshot);", instrument);
  assert.ok(instrument > 0 && overlayPin > instrument);
  assert.match(owner, /jitIdentityObservation\(logs, identityPlan\.nonce, identityPlan\.expectedEnvironment\)/);
  assert.match(owner, /save\('jit-identity\.json', report\.jitIdentity\)/);
  assert.match(owner, /report\.jitIdentity\.state !== 'verified'/);
});

test('host runner forwards identity only as an explicit boolean option', () => {
  const runner = readFileSync(new URL('./gpt6-codex-run.sh', import.meta.url), 'utf8');
  assert.match(runner, /jitIdentity: process\.env\.STARTUP_JIT_IDENTITY === '1'/);
});
