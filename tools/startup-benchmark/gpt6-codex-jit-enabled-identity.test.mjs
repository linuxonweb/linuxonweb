import test from 'node:test';
import assert from 'node:assert/strict';
import { jitIdentityObservation } from './gpt6-codex-jit-identity.mjs';

const nonce = '0123456789abcdef0123456789abcdef';
const disabled = { PBLIC: '0', PBLBC: '0', PBLJIT: '0' };
const enabled = { PBLIC: '1', PBLBC: '1', PBLJIT: '1' };
const identity = environment => ({
  nonce, pid: 96, startTicks: '1723', endStartTicks: '1723',
  exe: '/opt/firefox/firefox', exeAfter: '/opt/firefox/firefox',
  exeInode: '5:1234', endExeInode: '5:1234', imageInode: '5:1234',
  role: 'parent', env: environment,
});
const line = value => `PBLJIT_ENV_V1 ${JSON.stringify(value)}\n`;

test('explicit enabled environments verify identity without claiming JIT execution', () => {
  for (const environment of [enabled, { PBLIC: '1', PBLBC: '0', PBLJIT: '0' }]) {
    const declaration = Object.freeze({ ...environment });
    const result = jitIdentityObservation(line(identity(environment)), nonce, declaration);
    assert.equal(result.state, 'verified');
    assert.equal(result.nativeEnvironmentVerified, true);
    assert.equal(result.jitAcceptance, false);
    assert.deepEqual(result.identity.env, declaration);
  }
});

test('the expected environment is authoritative and defaults remain disabled', () => {
  assert.equal(jitIdentityObservation(line(identity(disabled)), nonce).state, 'verified');
  assert.equal(jitIdentityObservation(line(identity(enabled)), nonce).state, 'error');
  for (const name of Object.keys(enabled)) {
    const mismatched = { ...enabled, [name]: '0' };
    const result = jitIdentityObservation(line(identity(mismatched)), nonce, enabled);
    assert.equal(result.state, 'error');
    assert.equal(result.nativeEnvironmentVerified, false);
  }
  assert.equal(jitIdentityObservation(line(identity(disabled)), nonce, enabled).state, 'error');
});

test('invalid expected environments fail before accepting or waiting for evidence', () => {
  for (const environment of [null, [], {}, { PBLIC: '1', PBLBC: '1' },
    { ...enabled, PBLJIT: 1 }, { ...enabled, PBLJIT: '2' },
    { ...enabled, PBLIC: 'any' }, { ...enabled, EXTRA: '1' }]) {
    assert.throws(() => jitIdentityObservation('', nonce, environment), /environment/i);
  }
});

test('enabled declarations preserve nonce, native identity and framing guards', () => {
  assert.equal(jitIdentityObservation('', nonce, enabled).state, 'pending');
  for (const change of [{ nonce: 'f'.repeat(32) }, { role: 'content' },
    { endStartTicks: '1724' }, { endExeInode: '5:999' },
    { exeAfter: '/bin/sh' }, { imageInode: '5:999' }]) {
    const result = jitIdentityObservation(line({ ...identity(enabled), ...change }), nonce, enabled);
    assert.equal(result.state, 'error');
    assert.equal(result.jitAcceptance, false);
  }
  const duplicate = line(identity(enabled)).repeat(2);
  assert.equal(jitIdentityObservation(duplicate, nonce, enabled).state, 'error');
});
