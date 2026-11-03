import test from 'node:test';
import assert from 'node:assert/strict';
import { hasInitialNativePrompt } from './package-prompt.mjs';

test('APK progress and replay acknowledgments never enable input', () => {
  for (let percentage = 0; percentage <= 100; percentage++) {
    for (const prefix of ['', '\x1b7', '\r\x1b7']) {
      assert.equal(hasInitialNativePrompt(prefix + String(percentage).padStart(3) + '% # '), false);
      assert.equal(hasInitialNativePrompt(prefix + String(percentage).padStart(3) + '% #### '), false);
    }
  }
  for (const text of ['', '# ', 'root # ', 'APK_PERSIST_RESTORED generation=generation-demo optional=1 elapsed=4.284 offline=1 exactWorld=1', 'APK_PERSIST_RECOVERY_REQUIRED']) {
    assert.equal(hasInitialNativePrompt(text), false);
  }
});

test('only a complete initial native prompt enables normal or recovery input', () => {
  const prompt = 'linux:/home/admin # ';
  for (let split = 0; split < prompt.length; split++) {
    assert.equal(hasInitialNativePrompt(prompt.slice(0, split)), false);
    assert.equal(hasInitialNativePrompt(prompt.slice(0, split) + prompt.slice(split)), true);
  }
  assert.equal(hasInitialNativePrompt(prompt), true);
  assert.equal(hasInitialNativePrompt('\r' + prompt), true);
  assert.equal(hasInitialNativePrompt('not a shell ' + prompt), false);
  assert.equal(hasInitialNativePrompt(prompt + 'extra'), false);
});

test('split replay/progress chunks stay disabled until the actual prompt', () => {
  let pending = '';
  let ready = false;
  const chunks = ['\x1b7  1% # ', '\x1b8\x1b[0K', '\r\x1b7 99% #### ', '\x1b8\x1b[0KOK: 22 MiB in 5 packages\n', 'APK_PERSIST_RESTORED generation=generation-demo optional=1 elapsed=4.284 offline=1 exactWorld=1\n', 'Linux package console\n', 'linux:/home/', 'admin #', ' '];
  for (let index = 0; index < chunks.length; index++) {
    pending += chunks[index];
    pending = pending.split('\n').pop();
    if (hasInitialNativePrompt(pending)) ready = true;
    assert.equal(ready, index === chunks.length - 1);
  }
});
