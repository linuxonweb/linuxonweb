import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const nonce = '0123456789abcdef0123456789abcdef';
const helper = () => import('./gpt6-codex-jit-identity.mjs');
const packet = () => ({ nonce, pid: 96, startTicks: '1723', endStartTicks: '1723',
  exe: '/opt/firefox/firefox', exeAfter: '/opt/firefox/firefox',
  exeInode: '5:1234', endExeInode: '5:1234', imageInode: '5:1234',
  role: 'parent', env: { PBLIC: '0', PBLBC: '0', PBLJIT: '0' } });
const line = value => `PBLJIT_ENV_V1 ${JSON.stringify(value)}\n`;

test('no log or compiler silence is not native environment evidence', async () => {
  const { jitIdentityObservation } = await helper();
  for (const logs of ['', 'PBLJIT compiled\n', 'arbitrary startup output\n']) {
    const result = jitIdentityObservation(logs, nonce);
    assert.equal(result.state, 'pending');
    assert.equal(result.nativeEnvironmentVerified, false);
    assert.equal(result.jitAcceptance, false);
  }
});

test('one stable parent executable identity proves only its off-control environment', async () => {
  const { jitIdentityObservation } = await helper();
  const result = jitIdentityObservation(`boot\n${line(packet())}`, nonce);
  assert.equal(result.state, 'verified');
  assert.equal(result.nativeEnvironmentVerified, true);
  assert.equal(result.jitAcceptance, false);
  assert.deepEqual(result.identity, packet());
});

test('identity, environment, framing and duplicate failures fail closed', async () => {
  const { jitIdentityObservation } = await helper();
  for (const change of [
    { nonce: 'f'.repeat(32) }, { pid: 0 }, { pid: 1.5 }, { startTicks: 'oops' },
    { endStartTicks: '1724' }, { exe: '/bin/sh' }, { exeAfter: '/bin/sh' },
    { imageInode: '5:9999' }, { endExeInode: '5:9999' }, { role: 'content' },
    { env: { PBLIC: '0', PBLBC: '0' } },
    { env: { PBLIC: '0', PBLBC: '0', PBLJIT: '1' } },
    { env: { PBLIC: '0', PBLBC: '0', PBLJIT: '0', SECRET: 'no' } },
  ]) {
    const result = jitIdentityObservation(line({ ...packet(), ...change }), nonce);
    assert.equal(result.state, 'error', JSON.stringify(change));
    assert.equal(result.nativeEnvironmentVerified, false);
  }
  for (const logs of [line(packet()) + line(packet()), 'PBLJIT_ENV_V1 nope\n',
    'PBLJIT_ENV_V1 ' + 'x'.repeat(4097) + '\n', line({ nonce, error: 'timeout' })]) {
    assert.equal(jitIdentityObservation(logs, nonce).state, 'error');
  }
});

test('NUL-delimited filter bounds bytes and never emits unrelated environment data', async () => {
  const { jitEnvironmentFilter } = await helper();
  const filter = input => spawnSync('awk', [jitEnvironmentFilter()], {
    input: Buffer.from(input), encoding: 'utf8', timeout: 5000, maxBuffer: 8192,
    env: { ...process.env, LC_ALL: 'C' },
  });
  const valid = filter('SECRET=keep-private\nPBLIC=1\0PBLIC=0\0PBLBC=0\0PBLJIT=0\0');
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout), { PBLIC: '0', PBLBC: '0', PBLJIT: '0' });
  assert.ok(!valid.stdout.includes('private'));
  for (const input of [
    'PBLIC=0\0PBLBC=0\0PBLJIT=0\0PBLIC=1\0',
    'PBLIC=0\0PBLBC=0\0PBLJIT=0\nSECRET=private\0',
    'PBLIC=0\0PBLBC=0\0',
    'PBLIC=0\0PBLBC=0\0PBLJIT=0\0SECRET=' + 'x'.repeat(65537),
  ]) {
    const invalid = filter(input);
    assert.notEqual(invalid.status, 0);
    assert.equal(invalid.stdout, '');
  }
});

test('probe is nonce-bound, finite, read-only and does not dump environment bytes', async () => {
  const { jitIdentityScript } = await helper();
  assert.throws(() => jitIdentityScript('bad; echo hacked'), /nonce/i);
  const script = jitIdentityScript(nonce);
  const syntax = spawnSync('sh', ['-n'], { input: script, encoding: 'utf8', timeout: 5000 });
  assert.equal(syntax.status, 0, syntax.stderr);
  assert.match(script, /65537/);
  assert.match(script, /120/);
  assert.match(script, /sleep 0\.5/);
  assert.match(script, /-contentproc/);
  assert.match(script, /end_start/);
  assert.match(script, new RegExp(nonce));
  assert.doesNotMatch(script, /\/tmp|\/dev\/shm|\brm\b|\bkill\b|tee|PBLJIT_LOG/);
});

test('private instrumentation adds only the executable probe and init hook', async () => {
  const { instrumentJitIdentitySource, jitIdentityScript } = await helper();
  const original = fs.readFileSync(new URL('../../web/linux/desktop-extras.mjs', import.meta.url), 'utf8');
  const changed = instrumentJitIdentitySource(original, nonce);
  assert.throws(() => instrumentJitIdentitySource(changed, nonce), /anchor|already|unique/i);
  assert.throws(() => instrumentJitIdentitySource('unexpected source', nonce), /anchor|unique/i);
  const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, console });
  const module = new vm.SourceTextModule(changed, { context });
  await module.link(specifier => {
    const names = specifier.includes('test-commands') ? ['guestRunAgent', 'guestRunShell'] : ['downloadFile'];
    return new vm.SyntheticModule(names, function () {
      for (const name of names) this.setExport(name, () => 'stub');
    }, { context });
  });
  await module.evaluate();
  const init = new TextEncoder().encode('#!/bin/sh\nexec /original\n');
  const archive = module.namespace.desktopInitOverlay(module.namespace.cpioEntry('init', init));
  const files = new Map();
  for (let offset = 0; offset < archive.length;) {
    const header = new TextDecoder().decode(archive.slice(offset, offset + 110));
    assert.equal(header.slice(0, 6), '070701');
    const size = parseInt(header.slice(54, 62), 16);
    const namesize = parseInt(header.slice(94, 102), 16);
    const name = new TextDecoder().decode(archive.slice(offset + 110, offset + 109 + namesize));
    const dataStart = (offset + 110 + namesize + 3) & ~3;
    files.set(name, { mode: parseInt(header.slice(14, 22), 16), text: new TextDecoder().decode(archive.slice(dataStart, dataStart + size)) });
    offset = (dataStart + size + 3) & ~3;
  }
  assert.equal(files.get('init.desktop-original').text, new TextDecoder().decode(init));
  assert.equal(files.get('bin/jit-control-probe').mode, 0o100755);
  assert.equal(files.get('bin/jit-control-probe').text, jitIdentityScript(nonce));
  assert.match(files.get('init').text, /\/bin\/jit-control-probe &\n/);
  assert.match(files.get('init').text, /exec \/init\.desktop-original "\$@"/);
  assert.equal(files.size, 7);
});
