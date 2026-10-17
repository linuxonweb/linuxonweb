import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as identity from './gpt6-codex-jit-identity.mjs';

const nonce = '0123456789abcdef0123456789abcdef';
const run = (kind, input) => {
  const encoded = spawnSync('od', ['-An', '-v', '-t', 'u1'], {
    input: Buffer.from(input), encoding: 'utf8', timeout: 5000, maxBuffer: 524288,
  });
  assert.equal(encoded.status, 0);
  return spawnSync('awk', [identity.jitByteFilter(kind, nonce)], {
    input: encoded.stdout, encoding: 'utf8', timeout: 5000, maxBuffer: 8192,
    env: { ...process.env, LC_ALL: 'C' },
  });
};

test('decimal transport parses every NUL record without newline impersonation', () => {
  const result = run('environment', 'SECRET=private\nPBLIC=0\0PBLIC=1\0PBLBC=1\0PBLJIT=1\0');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), { PBLIC: '1', PBLBC: '1', PBLJIT: '1' });
  for (const input of ['', 'PBLIC=1\0PBLBC=1\0',
    'PBLIC=1\0PBLBC=1\0PBLJIT=1\0PBLIC=0\0',
    'PBLIC=1\0PBLBC=1\0PBLJIT=1\nSECRET=private\0',
    'PBLIC=1\0PBLBC=1\0PBLJIT=1',
    'PBLIC=1\0PBLBC=1\0PBLJIT=1\0SECRET=' + 'x'.repeat(65537)]) {
    const invalid = run('environment', input);
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.stdout, '');
    assert.ok(!invalid.stderr.includes('private'));
    assert.ok(!invalid.stderr.includes('SECRET'));
  }
});

test('environment failure counts describe actual bytes rather than textual od rows', () => {
  const input = 'SECRET=private\0PBLIC=1\0PBLBC=1\0';
  const result = run('environment', input);
  assert.notEqual(result.status, 0);
  assert.deepEqual(JSON.parse(result.stderr.slice('PBLJIT_ENV_FILTER_V1 '.length)), {
    nonce, bytes: Buffer.byteLength(input), records: 3, invalid: 0, PBLIC: 1, PBLBC: 1, PBLJIT: 0,
  });
});

test('parent recognition inspects later arguments and bounds complete records', () => {
  const parent = '/opt/firefox/firefox\0';
  assert.equal(run('role', parent + '--profile\0/private/path\0').stdout, 'parent\n');
  for (const input of ['', '/bin/sh\0', parent + '-contentproc\0',
    parent + '--profile\0/private/path\0--contentproc\0', parent.slice(0, -1),
    parent + 'x'.repeat(8193) + '\0']) {
    const result = run('role', input);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
  }
});

test('probe selects byte-safe readers and validates a known guest control', () => {
  assert.throws(() => identity.jitByteFilter('wrong', nonce), /kind/i);
  assert.throws(() => identity.jitByteFilter('environment', 'bad'), /nonce/i);
  const script = identity.jitIdentityScript(nonce);
  assert.ok(script.includes(identity.jitByteFilter('environment', nonce)));
  assert.ok(script.includes(identity.jitByteFilter('role', nonce)));
  assert.match(script, /busybox od -An -v -t u1/);
  assert.match(script, /PBLJIT_ENV_READER_V1/);
  assert.match(script, /filter-control-failed/);
});
