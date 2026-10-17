import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const helper = () => import('./gpt6-codex-android-snapshot.mjs');
const thread = (tid, affinity = '0-7') => `THREAD ${tid}\nCpus_allowed_list:\t${affinity}\n1:cpu:/\n2:cpuset:/top-app\nEND_THREAD ${tid}\n`;
const snapshot = ({ before = '123 124', after = before, records = thread(123) + thread(124), start = '987', end = start } = {}) =>
  `PROCESS_BEFORE 123 ${start}\nBEFORE ${before}\n${records}AFTER ${after}\nPROCESS_AFTER 123 ${end}\n`;

test('complete stable snapshot retains every thread and process identity', async () => {
  const { parseAndroidSnapshot } = await helper();
  const result = parseAndroidSnapshot(snapshot(), 123, '987');
  assert.equal(result.state, 'complete');
  assert.deepEqual(result.tids, [123, 124]);
  assert.equal(result.threads.length, 2);
  assert.equal(result.threads[0].affinity, '0-7');
  assert.match(result.threads[0].cgroup, /^1:cpu:\//);
});

test('only explicitly observed thread churn is retryable', async () => {
  const { parseAndroidSnapshot } = await helper();
  assert.equal(parseAndroidSnapshot(snapshot({ after: '123', records: thread(123) + 'FAILED 124 status\n' }), 123, '987').state, 'retry');
  assert.equal(parseAndroidSnapshot(snapshot({ after: '123 124 125' }), 123, '987').state, 'retry');
  for (const raw of [
    snapshot({ records: thread(123) + 'FAILED 124 status\n' }),
    snapshot({ records: thread(123) }),
    snapshot({ records: thread(123) + thread(123) }),
    snapshot({ before: '123 123' }), snapshot({ end: '988' }),
    snapshot({ records: thread(123).replace('Cpus_allowed_list:\t0-7\n', '') + thread(124) }),
    snapshot().replace('PROCESS_AFTER 123 987\n', ''), snapshot() + 'extra\n',
    'x'.repeat(131073),
  ]) assert.throws(() => parseAndroidSnapshot(raw, 123, '987'));
});

test('driver retains failed raw attempt, retries churn and returns only a complete capture', async () => {
  const { captureAndroidSnapshot } = await helper();
  const raws = [snapshot({ after: '123', records: thread(123) + 'FAILED 124 status\n' }), snapshot()];
  const records = [], pauses = [], validated = [];
  const result = await captureAndroidSnapshot({ pid: 123, startTicks: '987',
    read: async () => raws.shift(), record: value => records.push(value),
    validate: threads => validated.push(threads), pause: async ms => pauses.push(ms) });
  assert.equal(result.attempts, 2);
  assert.equal(result.threads.length, 2);
  assert.equal(records.length, 2);
  assert.match(records[0].raw, /FAILED 124/);
  assert.deepEqual(pauses, [25]);
  assert.equal(validated.length, 2);
});

test('real CPU restrictions, malformed data and transport errors do not trigger retries', async () => {
  const { captureAndroidSnapshot } = await helper();
  for (const kind of ['restriction', 'malformed', 'transport']) {
    let calls = 0;
    const records = [];
    await assert.rejects(captureAndroidSnapshot({ pid: 123, startTicks: '987',
      read: async () => {
        calls++;
        if (kind === 'transport') throw Object.assign(Error('private device command'), { stdout: 'partial', stderr: 'read failure', status: 1 });
        if (kind === 'malformed') return 'malformed';
        return snapshot({ after: '123', records: thread(123, '0-1') + 'FAILED 124 status\n' });
      }, record: value => records.push(value),
      validate: threads => { if (threads.some(row => row.affinity !== '0-7')) throw Error('CPU restriction'); },
      pause: async () => assert.fail('Must not retry') }), kind === 'transport' ? /transport/ : undefined);
    assert.equal(calls, 1);
    assert.equal(records.length, 1);
    assert.ok(!JSON.stringify(records).includes('private device command'));
  }
});

test('retry count and elapsed deadline are bounded without resetting the workload clock', async () => {
  const { captureAndroidSnapshot } = await helper();
  const raw = snapshot({ after: '123', records: thread(123) + 'FAILED 124 status\n' });
  let calls = 0;
  const config = { pid: 123, startTicks: '987', read: async () => { calls++; return raw; },
    record: () => {}, validate: () => {}, pause: async () => {} };
  await assert.rejects(captureAndroidSnapshot(config), /exhausted/);
  assert.equal(calls, 5);
  await assert.rejects(captureAndroidSnapshot({ ...config, maxAttempts: 6 }), /attempt/i);
  let now = 0;
  await assert.rejects(captureAndroidSnapshot({ ...config, now: () => now,
    read: async () => { now = 2001; return snapshot(); } }), /deadline/);
});

test('collector uses one batched grep and guards its PID and thread count', async () => {
  const { androidSnapshotScript } = await helper();
  assert.throws(() => androidSnapshotScript('123; echo bad'), /PID/);
  const script = androidSnapshotScript(123);
  const result = spawnSync('sh', ['-n'], { input: script, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(script, /\b(?:cat|awk|sed|ls|sleep|kill|rm)\b|\/tmp|\/dev\/shm/);
  assert.equal((script.match(/\bgrep\b/g) || []).length, 1);
  assert.match(script, /1024/);
  assert.match(script, /PROCESS_BEFORE/);
  assert.match(script, /PROCESS_AFTER/);
  assert.match(script, /CAPTURE_STATUS/);
});

test('the generated collector executes against a live host proc tree', async () => {
  const { captureAndroidSnapshot } = await helper();
  const stat = fs.readFileSync(`/proc/${process.pid}/stat`, 'utf8');
  const startTicks = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[19];
  const records = [];
  const result = await captureAndroidSnapshot({ pid: process.pid, startTicks,
    read: command => {
      const run = spawnSync('sh', ['-c', command], { encoding: 'utf8', timeout: 2000, maxBuffer: 131072 });
      assert.equal(run.status, 0, run.stderr);
      return run.stdout;
    }, record: value => records.push(value), validate: () => {} });
  assert.equal(result.state, 'complete');
  assert.ok(result.tids.includes(process.pid));
  assert.equal(result.threads.length, result.tids.length);
  assert.ok(records.length > 0 && records.length <= 5);
});
