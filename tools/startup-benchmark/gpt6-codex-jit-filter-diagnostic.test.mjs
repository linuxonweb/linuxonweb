import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { jitEnvironmentFilter, jitIdentityScript } from './gpt6-codex-jit-identity.mjs';

const nonce = '0123456789abcdef0123456789abcdef';
const run = input => spawnSync('awk', [jitEnvironmentFilter(nonce)], {
  input: Buffer.from(input), encoding: 'utf8', timeout: 5000, maxBuffer: 8192,
  env: { ...process.env, LC_ALL: 'C' },
});

test('failed environment filters diagnose counts without exposing values or accepting evidence', () => {
  for (const [input, counts, invalid] of [
    ['', [0, 0, 0], 0],
    ['SECRET=private\0PBLIC=1\0PBLBC=1\0', [1, 1, 0], 0],
    ['PBLIC=1\0PBLBC=1\0PBLJIT=1\0PBLIC=0\0', [2, 1, 1], 1],
    ['PBLIC=private\0PBLBC=1\0PBLJIT=1\0', [1, 1, 1], 1],
  ]) {
    const result = run(input);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.startsWith('PBLJIT_ENV_FILTER_V1 '));
    const diagnostic = JSON.parse(result.stderr.slice('PBLJIT_ENV_FILTER_V1 '.length));
    assert.deepEqual(diagnostic, {
      nonce, bytes: Buffer.byteLength(input), records: input ? input.split('\0').length - 1 : 0,
      invalid, PBLIC: counts[0], PBLBC: counts[1], PBLJIT: counts[2],
    });
    assert.ok(!result.stderr.includes('private'));
    assert.ok(!result.stderr.includes('SECRET'));
  }
});

test('valid environments keep exact output and probes bind diagnostic nonces', () => {
  const result = run('SECRET=private\0PBLIC=1\0PBLBC=1\0PBLJIT=1\0');
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { PBLIC: '1', PBLBC: '1', PBLJIT: '1' });
  assert.equal(result.stderr, '');
  assert.throws(() => jitEnvironmentFilter('bad'), /nonce/i);
  const script = jitIdentityScript(nonce);
  assert.ok(script.includes(jitEnvironmentFilter(nonce)));
  assert.ok(script.includes('PBLJIT_ENV_FILTER_V1'));
});
