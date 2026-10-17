import test from 'node:test';
import assert from 'node:assert/strict';
import { admitAndroidRootCpu } from './gpt6-codex-android-cpu.mjs';
import * as androidCpu from './gpt6-codex-android-cpu.mjs';

const evidence = () => ({
  mountinfo: '30 21 0:28 / /dev/cpuctl rw - cgroup none rw,cpu\n',
  namespace: 'cgroup:[4026531835]',
  initNamespace: 'cgroup:[4026531835]',
  online: '0-7',
  hardwareConcurrency: 8,
  cpuset: '0-7',
  threads: [
    { affinity: '0-7', cgroup: '1:cpu:/\n2:cpuset:/top-app\n' },
    { affinity: '0-7', cgroup: '1:cpu:/\n2:cpuset:/top-app\n' },
  ],
});

test('parses actual shell thread delimiters, tabs, newlines and controller records', () => {
  const raw = 'THREAD\nCpus_allowed_list:\t0-7\n1:cpu:/\n2:cpuset:/top-app\nTHREAD\nCpus_allowed_list:\t0-7\n1:cpu:/\n';
  for (const text of [raw, raw.replaceAll('\n', '\r\n')]) {
    assert.deepEqual(androidCpu.parseAndroidThreadRecords(text), [
      { affinity: '0-7', cgroup: '1:cpu:/\n2:cpuset:/top-app' },
      { affinity: '0-7', cgroup: '1:cpu:/' },
    ]);
  }
  for (const text of ['', 'permission denied', 'THREAD\n1:cpu:/\n']) {
    assert.throws(() => androidCpu.parseAndroidThreadRecords(text));
  }
});

test('root CPU group needs no nonexistent CFS config comment', () => {
  assert.deepEqual(admitAndroidRootCpu(evidence()), {
    effectiveCpus: 8,
    quota: 'root-cpu-controller-unlimited',
    threadCount: 2,
  });
});

test('rejects child CPU groups rather than inferring absent quota files', () => {
  const input = evidence();
  input.threads[1].cgroup = '1:cpu:/background\n';
  assert.throws(() => admitAndroidRootCpu(input), /root CPU group/);
});

test('rejects hidden controller ancestors and ambiguous CPU mounts', () => {
  for (const mountinfo of [
    '30 21 0:28 /hidden /dev/cpuctl rw - cgroup none rw,cpu\n',
    evidence().mountinfo + evidence().mountinfo,
    '30 21 0:28 / /sys/fs/cgroup rw - cgroup2 none rw\n',
  ]) assert.throws(() => admitAndroidRootCpu({ ...evidence(), mountinfo }), /CPU mount/);
});

test('requires a verified initial cgroup namespace', () => {
  for (const namespace of ['', 'cgroup:[42]', 'permission denied']) {
    assert.throws(() => admitAndroidRootCpu({ ...evidence(), namespace }), /namespace/);
  }
});

test('Linux 4.9 reserved initial namespace inode works without PID1 read access', () => {
  const input = { ...evidence(), initNamespace: null, kernelRelease: '4.9.337-perf-gaa8adfe9bf21' };
  assert.equal(admitAndroidRootCpu(input).effectiveCpus, 8);
  for (const change of [{ namespace: 'cgroup:[4026532000]' }, { kernelRelease: 'unknown' }]) {
    assert.throws(() => admitAndroidRootCpu({ ...input, ...change }), /namespace/);
  }
});

test('requires online, native browser, cpuset and all thread counts to match', () => {
  for (const change of [
    { hardwareConcurrency: 4 }, { cpuset: '0-3' }, { online: '0-3' },
    { threads: [{ affinity: '0-3', cgroup: '1:cpu:/\n' }] },
    { threads: [] },
  ]) assert.throws(() => admitAndroidRootCpu({ ...evidence(), ...change }), /CPU|thread/);
});

test('rejects missing or duplicate thread CPU controllers', () => {
  for (const cgroup of ['0::/\n', '1:cpu:/\n2:cpu:/\n']) {
    assert.throws(() => admitAndroidRootCpu({ ...evidence(), threads: [{ affinity: '0-7', cgroup }] }), /root CPU group/);
  }
});
