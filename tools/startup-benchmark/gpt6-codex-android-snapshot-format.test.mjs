import test from 'node:test';
import assert from 'node:assert/strict';
import { androidSnapshotScript } from './gpt6-codex-android-snapshot.mjs';

test('thread-set formatting does not invoke printf once per thread', () => {
  const source = androidSnapshotScript(123);
  assert.doesNotMatch(source, /for entry do printf/);
  assert.equal((source.match(/for entry do thread_list=/g) || []).length, 2);
});
