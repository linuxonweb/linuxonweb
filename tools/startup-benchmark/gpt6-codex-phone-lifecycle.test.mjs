import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCleanupSteps, admitPhoneLaunch } from './gpt6-codex-phone-lifecycle.mjs';
import * as lifecycle from './gpt6-codex-phone-lifecycle.mjs';

test('cleanup attempts every owned step despite evidence and target-close failures', async () => {
  const visited = [];
  const steps = ['evidence', 'target', 'forward', 'reverse', 'server', 'preservation'].map(name => [name, async () => {
    visited.push(name);
    if (['evidence', 'target'].includes(name)) throw Error(`${name} failure`);
  }]);
  const errors = await runCleanupSteps(steps);
  assert.deepEqual(visited, ['evidence', 'target', 'forward', 'reverse', 'server', 'preservation']);
  assert.deepEqual(errors, [{ step: 'evidence', error: 'Error: evidence failure' }, { step: 'target', error: 'Error: target failure' }]);
  assert.deepEqual(await runCleanupSteps([['empty', () => {}]]), []);
});

test('launch admission preserves the full 900-second observation plus cleanup margin', () => {
  for (const elapsed of [0, 15000, 240000]) assert.equal(admitPhoneLaunch(elapsed), true);
  for (const elapsed of [-1, NaN, Infinity, '10', 240001, 300000]) assert.throws(() => admitPhoneLaunch(elapsed), /Full phone observation/);
});

test('navigation waits for the admitted loader instead of rejecting transient empty target URLs', async () => {
  const expectedUrl = 'http://localhost:54321/linux/index.html?firefox=1';
  const previousUrl = 'http://localhost:54321/owner-setup';
  const samples = [
    { url: '', frameUrl: previousUrl, frameId: 'owned', loaderId: 'old' },
    { url: previousUrl, frameUrl: expectedUrl, frameId: 'owned', loaderId: 'new' },
    { url: expectedUrl, frameUrl: expectedUrl, frameId: 'owned', loaderId: 'new' },
  ];
  let elapsed = 0;
  const result = await lifecycle.waitForOwnedNavigation({ expectedUrl, previousUrl, frameId: 'owned', loaderId: 'new', read: async () => samples.shift(), now: () => elapsed, pause: async milliseconds => { elapsed += milliseconds; } });
  assert.equal(result.url, expectedUrl);
  assert.equal(samples.length, 0);
  assert.ok(elapsed > 0);
});

test('navigation never admits unrelated URLs, missing targets or mismatched frames', async () => {
  const expectedUrl = 'http://localhost:54321/linux/index.html?firefox=1';
  const previousUrl = 'http://localhost:54321/owner-setup';
  for (const sample of [null, { url: 'https://unrelated.test', frameUrl: expectedUrl, frameId: 'owned', loaderId: 'new' }, { url: expectedUrl, frameUrl: expectedUrl, frameId: 'other', loaderId: 'new' }]) {
    await assert.rejects(lifecycle.waitForOwnedNavigation({ expectedUrl, previousUrl, frameId: 'owned', loaderId: 'new', read: async () => sample, pause: async () => {}, now: () => 0 }), /Owned navigation/);
  }
});

test('navigation timeout does not accept a stale loader or missing navigation identity', async () => {
  const expectedUrl = 'http://localhost:54321/linux/index.html?firefox=1';
  const previousUrl = 'http://localhost:54321/owner-setup';
  let elapsed = 0;
  const input = { expectedUrl, previousUrl, frameId: 'owned', loaderId: 'new', read: async () => ({ url: expectedUrl, frameUrl: expectedUrl, frameId: 'owned', loaderId: 'old' }), now: () => elapsed, pause: async milliseconds => { elapsed += milliseconds; }, timeoutMs: 300 };
  await assert.rejects(lifecycle.waitForOwnedNavigation(input), /Owned navigation deadline/);
  assert.equal(elapsed, 300);
  await assert.rejects(lifecycle.waitForOwnedNavigation({ ...input, loaderId: undefined }), /Owned navigation identity/);
});
