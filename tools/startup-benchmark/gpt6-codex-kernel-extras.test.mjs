import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKernelExtrasProbe, verifyKernelExtrasOutput } from './gpt6-codex-kernel-extras.mjs';
import * as kernelProbe from './gpt6-codex-kernel-extras.mjs';

const nonce = '0123456789abcdef01234567';
const manifest = { members: [{ path: '/bin/app', sha256: 'a'.repeat(64), bytes: 8 }] };
const input = () => ({ archive: new Uint8Array([31, 139, 8, 0, 0]), manifest, nonce, cpus: 8 });

function records(bytes, offset) {
  const decoder = new TextDecoder();
  const result = {};
  while (offset < bytes.length) {
    const header = decoder.decode(bytes.subarray(offset, offset + 110));
    assert.equal(header.slice(0, 6), '070701');
    const size = parseInt(header.slice(54, 62), 16);
    const nameSize = parseInt(header.slice(94, 102), 16);
    const name = decoder.decode(bytes.subarray(offset + 110, offset + 110 + nameSize - 1));
    const start = Math.ceil((offset + 110 + nameSize) / 4) * 4;
    result[name] = decoder.decode(bytes.subarray(start, start + size));
    offset = Math.ceil((start + size) / 4) * 4;
  }
  return result;
}

test('diagnostic preserves the input and appends only an aligned checksum rdinit', () => {
  const options = input();
  const original = options.archive.slice();
  const probe = buildKernelExtrasProbe(options);
  assert.deepEqual(options.archive, original);
  assert.deepEqual(probe.image.subarray(0, original.length), original);
  assert.deepEqual(probe.image.subarray(5, 8), new Uint8Array(3));
  const entries = records(probe.image, 8);
  assert.deepEqual(Object.keys(entries), ['gpt6-codex-check-tail', 'gpt6-codex-extras.sha256', 'TRAILER!!!']);
  assert.equal(probe.cmdline, 'rdinit=/gpt6-codex-check-tail');
  assert.equal(entries['gpt6-codex-extras.sha256'], `${'a'.repeat(64)}  /bin/app\n`);
  assert.match(entries['gpt6-codex-check-tail'], /\/bin\/busybox sha256sum -c \/gpt6-codex-extras.sha256/);
  assert.match(entries['gpt6-codex-check-tail'], /exec \/bin\/busybox poweroff -f/);
  assert.doesNotMatch(entries['gpt6-codex-check-tail'], /firefox|mount|\/init/);
});

test('unsafe or ambiguous probe inputs fail before boot', () => {
  for (const override of [
    { archive: null }, { cpus: 2.4 }, { cpus: 0 }, { nonce: 'unsafe;echo' },
    { manifest: { members: [] } },
    { manifest: { members: [manifest.members[0], manifest.members[0]] } },
    ...['/bin/../init', '/bin/a b', '/bin/app\n', 'bin/app'].map(path => ({ manifest: { members: [{ ...manifest.members[0], path }] } })),
    { manifest: { members: [{ ...manifest.members[0], sha256: 'wrong' }] } },
  ]) assert.throws(() => buildKernelExtrasProbe({ ...input(), ...override }));
});

test('acceptance requires exact nonce, guest CPUs and every checksum result', () => {
  const probe = buildKernelExtrasProbe(input());
  const output = `Core count: 8\nGPT6_TAIL_BEGIN_${nonce}\n/bin/app: OK\nGPT6_TAIL_PASS_${nonce}\n`;
  assert.deepEqual(verifyKernelExtrasOutput(output, probe), { cpus: 8, verifiedMembers: 1 });
  for (const changed of [
    output.replace('Core count: 8', 'Core count: 6'),
    output.replace('BEGIN_', 'UNKNOWN_'), output.replace('PASS_', 'UNKNOWN_'),
    output.replace('/bin/app: OK', '/bin/app: FAILED'),
    output.replace('/bin/app: OK', '/bin/other: OK'),
    output + `/bin/app: OK\n`, output + `GPT6_TAIL_FAIL_${nonce}\n`,
    output.replaceAll(nonce, 'f'.repeat(24)),
  ]) assert.throws(() => verifyKernelExtrasOutput(changed, probe));
});

test('console decoding copies shared subviews and retains split UTF-8 state', () => {
  const shared = new Uint8Array(new SharedArrayBuffer(16));
  const encoded = new TextEncoder().encode('A€B');
  shared.set(encoded, 3);
  const original = shared.slice();
  const decoder = new TextDecoder();
  const browserDecoder = { decode(bytes, options) {
    assert.ok(bytes.buffer instanceof ArrayBuffer, 'Browser TextDecoder rejects shared views');
    return decoder.decode(bytes, options);
  } };
  const first = kernelProbe.decodeKernelConsole(browserDecoder, shared.subarray(3, 5));
  const second = kernelProbe.decodeKernelConsole(browserDecoder, shared.subarray(5, 8));
  assert.equal(first + second, 'A€B');
  assert.deepEqual(shared, original);
});
