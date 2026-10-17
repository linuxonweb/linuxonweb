import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAndroidSnapshot, captureAndroidSnapshot } from './gpt6-codex-android-snapshot.mjs';

const thread = (tid, affinity = '0-7') => `/proc/123/task/${tid}/status:Cpus_allowed_list:\t${affinity}\n/proc/123/task/${tid}/cgroup:1:cpu:/\n/proc/123/task/${tid}/cgroup:2:cpuset:/top-app\n`;
const snapshot = ({ before = '123 124', after = before, records = thread(123) + thread(124), status = 0 } = {}) =>
  `PROCESS_BEFORE 123 987\nBEFORE ${before}\nBATCH\n${records}CAPTURE_STATUS ${status}\nAFTER ${after}\nPROCESS_AFTER 123 987\n`;

test('batched filename-labelled records retain every thread and CPU controller', () => {
  const result = parseAndroidSnapshot(snapshot(), 123, '987');
  assert.equal(result.state, 'complete');
  assert.deepEqual(result.tids, [123, 124]);
  assert.deepEqual(result.threads, [
    { affinity: '0-7', cgroup: '1:cpu:/\n2:cpuset:/top-app' },
    { affinity: '0-7', cgroup: '1:cpu:/\n2:cpuset:/top-app' },
  ]);
});

test('batch missing data retries only a vanished thread with an explicit read error', async () => {
  const partial = snapshot({ after: '123', records: thread(123) + '/proc/123/task/124/status:Cpus_allowed_list:\t0-7\n', status: 2 });
  const result = parseAndroidSnapshot(partial, 123, '987');
  assert.equal(result.state, 'retry');
  assert.deepEqual(result.failedTids, [124]);
  const raws = [partial, snapshot()];
  const retained = [];
  const captured = await captureAndroidSnapshot({ pid: 123, startTicks: '987',
    read: () => raws.shift(), record: row => retained.push(row), validate: () => {}, pause: async () => {} });
  assert.equal(captured.attempts, 2);
  assert.equal(retained[0].raw, partial);
  assert.throws(() => parseAndroidSnapshot(partial.replace('CAPTURE_STATUS 2', 'CAPTURE_STATUS 0'), 123, '987'));
  assert.throws(() => parseAndroidSnapshot(partial.replace('AFTER 123\n', 'AFTER 123 124\n'), 123, '987'));
});

test('batch transport, duplicate, malformed and incomplete records fail closed', async () => {
  for (const raw of [
    snapshot({ status: 1 }), snapshot({ status: 2 }), snapshot({ status: 127 }),
    snapshot({ records: thread(123) }),
    snapshot({ records: thread(123) + thread(124) + '/proc/123/task/124/status:Cpus_allowed_list:\t0-7\n' }),
    snapshot({ records: thread(123) + thread(124) + '/proc/123/task/124/cgroup:1:cpu:/\n' }),
    snapshot().replace('/proc/123/task/124/status:', '/proc/999/task/124/status:'),
    snapshot().replace('1:cpu:/', 'malformed'),
    snapshot().replace('CAPTURE_STATUS 0\n', ''),
    snapshot({ records: thread(123) + thread(125) }),
  ]) assert.throws(() => parseAndroidSnapshot(raw, 123, '987'));
  let reads = 0;
  await assert.rejects(captureAndroidSnapshot({ pid: 123, startTicks: '987',
    read: () => { reads++; return snapshot({ records: thread(123, '0-1') + thread(124) }); },
    record: () => {}, validate: rows => { if (rows.some(row => row.affinity !== '0-7')) throw Error('CPU restriction'); },
    pause: async () => assert.fail('CPU restriction must not retry') }), /CPU restriction/);
  assert.equal(reads, 1);
});
