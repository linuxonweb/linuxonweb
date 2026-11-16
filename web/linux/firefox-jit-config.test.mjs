import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { jitPlan, jitCaptureBounds } from '../../tools/startup-benchmark/gpt6-codex-jit.mjs';
import { startupMemoryPlan } from '../../tools/startup-benchmark/gpt6-codex-timing.mjs';

async function flags(search) {
  const { firefoxJitFlags } = await import('./firefox-jit-config.mjs');
  return firefoxJitFlags(search);
}

test('ordinary boots do not override native JIT defaults', async () => {
  assert.deepEqual(await flags(''), []);
  assert.deepEqual(await flags('?firefox=1&gpu=0'), []);
});

test('compiler switches preserve wrapper arguments and map loop control to the native environment', async () => {
  assert.deepEqual(await flags('?pblic=0&pblbc=0&pbljit=0'), ['pblic=0', 'pblbc=0', 'PBLJIT=0']);
  assert.deepEqual(await flags('?pblic=1&pblbc=1&pbljit=1'), ['pblic=1', 'pblbc=1', 'PBLJIT=1']);
  assert.deepEqual(await flags('?pblic=9&pblbc=2'), ['pblic=9', 'pblbc=2']);
});

test('invalid switch values cannot inject kernel arguments or environment variables', async () => {
  for (const value of ['', '00', '-1', '1 PBLJIT=0', '1\nPBLJIT=0', 'true', '1;echo bad']) {
    const search = new URLSearchParams({ pblic: value, pblbc: value, pbljit: value });
    assert.deepEqual(await flags(search.toString()), []);
  }
  assert.deepEqual(await flags('?pbljit=9'), []);
  assert.deepEqual(await flags('?pbljit=0&pbljit=1'), ['PBLJIT=0']);
});

test('direct-call and method threshold switches map to native environment variables', async () => {
  assert.deepEqual(await flags('?pblbc_direct=0'), ['PBLBC_DIRECT=0']);
  assert.deepEqual(await flags('?pblbc_direct=1'), ['PBLBC_DIRECT=1']);
  assert.deepEqual(await flags('?pblbc_hits=2'), ['PBLBC_HITS=2']);
  assert.deepEqual(await flags('?pblbc_hits=999999'), ['PBLBC_HITS=999999']);
  assert.deepEqual(await flags('?pbljit=1&pblbc_direct=1&pblbc_hits=2'), ['PBLJIT=1', 'PBLBC_DIRECT=1', 'PBLBC_HITS=2']);
  for (const value of ['', '2', '00', '-1', 'true', '1 PBLJIT=0', '1\nPBLJIT=0', '1;echo bad']) {
    assert.deepEqual(await flags(new URLSearchParams({ pblbc_direct: value }).toString()), []);
  }
  for (const value of ['', '0', '000000', '1000000', '-1', '1.5', '1e3', ' 2', '2 PBLJIT=0', '2\nPBLJIT=0']) {
    assert.deepEqual(await flags(new URLSearchParams({ pblbc_hits: value }).toString()), []);
  }
});

test('off control disables all three compilers without altering the benchmark or preferences', async () => {
  const off = jitPlan('off');
  assert.deepEqual(await flags(off.query), ['pblic=0', 'pblbc=0', 'PBLJIT=0']);
  for (const arm of ['ic', 'method']) {
    assert.equal(off.filename, jitPlan(arm).filename);
    assert.equal(off.preferences, jitPlan(arm).preferences);
  }
  assert.equal(off.jitAcceptance, false);
});

test('the actual boot path includes the tested JIT flags in its kernel command line', () => {
  const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ firefoxJitFlags \} from ['"]\.\/firefox-jit-config\.mjs['"]/);
  const start = source.indexOf('const modeFlags = [');
  const end = source.indexOf('.join(" ")', start);
  assert.ok(start >= 0 && end > start);
  assert.match(source.slice(start, end), /\.\.\.firefoxJitFlags\(location\.search\)/);
  assert.ok(source.includes('cmdline: `${rootCommand} ${modeFlags}`'));
});

test('the owner rejects an off control served by the old frozen boot path', () => {
  const source = fs.readFileSync(new URL('../../tools/startup-benchmark/gpt6-codex-browser.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const memoryPlan =');
  const end = source.indexOf('const { output, scratch, cpus, seconds } = config;');
  assert.ok(start >= 0 && end > start);
  const admit = config => vm.runInNewContext(source.slice(start, end), { config, jitPlan, jitCaptureBounds, startupMemoryPlan });
  assert.throws(() => admit({ jitArm: 'off', candidate: false }), /Off control requires candidate boot flags/);
  assert.throws(() => admit({ jitArm: 'off' }), /Off control requires candidate boot flags/);
  assert.doesNotThrow(() => admit({ jitArm: 'off', candidate: true }));
  assert.doesNotThrow(() => admit({ jitArm: 'method', candidate: false }));
});

test('the try/catch admission policy is forwarded only for 0 or 1', async () => {
  assert.deepEqual(await flags('?firefox=1&pblbc_direct=1&pbl_trypolicy=0'), ['PBLBC_DIRECT=1', 'PBL_TRYPOLICY=0']);
  assert.deepEqual(await flags('?pbl_trypolicy=1'), ['PBL_TRYPOLICY=1']);
  assert.deepEqual(await flags('?pbl_trypolicy=2'), []);
  assert.deepEqual(await flags('?pbl_trypolicy=0%20init=/bin/sh'), []);
});
