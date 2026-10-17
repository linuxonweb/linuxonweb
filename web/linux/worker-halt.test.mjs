import test from 'node:test';
import assert from 'node:assert/strict';
import { kernel_imports, HALT_KERNEL } from './dist/wasm.js';
import { platform } from './dist/platform.js';

test('reusable worker halt releases the task and unwinds without closing its isolate', () => {
  const calls = [], original = platform.quit;
  platform.quit = () => calls.push('quit');
  try {
    const imports = kernel_imports({ is_worker: true, recycle_worker: true, worker_exit: () => calls.push('release') });
    assert.throws(() => imports.halt_worker(), error => error === HALT_KERNEL);
    assert.deepEqual(calls, ['release']);
  } finally { platform.quit = original; }
});

test('default worker halt preserves release then orderly isolate closure', () => {
  const calls = [], original = platform.quit;
  platform.quit = () => calls.push('quit');
  try {
    const imports = kernel_imports({ is_worker: true, worker_exit: () => calls.push('release') });
    assert.throws(() => imports.halt_worker(), error => error === HALT_KERNEL);
    assert.deepEqual(calls, ['release', 'quit']);
    assert.throws(() => kernel_imports({ is_worker: false }).halt_worker(), /main thread/);
  } finally { platform.quit = original; }
});
