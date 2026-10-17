import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateFiles } from './gpt6-codex-overlays.mjs';

test('baseline keeps every frozen route and candidate includes its JIT configuration dependency', () => {
  assert.deepEqual(candidateFiles({ candidate: false }), []);
  assert.deepEqual(candidateFiles({ candidate: true }), ['main.js', 'desktop-extras.mjs', 'firefox-jit-config.mjs']);
});

test('worker pool comparison binds all changed runtime files and no other assets', () => {
  assert.deepEqual(candidateFiles({ candidate: true, workerPool: true }), [
    'main.js', 'desktop-extras.mjs', 'firefox-jit-config.mjs', 'dist/index.js', 'dist/worker.js', 'dist/wasm.js', 'dist/worker-pool.mjs',
  ]);
  assert.throws(() => candidateFiles({ candidate: false, workerPool: true }), /candidate/);
});
