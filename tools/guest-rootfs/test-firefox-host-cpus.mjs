// Fixture-only CPU contract checks; this never starts a browser or guest.
// Usage: node test-firefox-host-cpus.mjs /mnt/p6/build/<task>/OUTPUT
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { saveHostCpuPhaseEvidence, hostCpuPhaseChecks, readHostNproc, selectHostCpus, guestCpuChecks, guestCpuEvidence, saveGuestCpuEvidence } from './firefox-host-cpus.mjs';

const out = path.resolve(process.argv[2]);
if (!out.startsWith('/mnt/p6/build/')) throw Error('disk-backed build output required');
await fs.mkdir(out, { recursive: true });
const stat = await fs.statfs(out);
if ([0x01021994, 0x858458f6].includes(stat.type)) throw Error('disk-backed output required');
const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push({ name, pass: true }); }
  catch (error) { checks.push({ name, pass: false, error: String(error.stack || error) }); }
}
const hostNproc = readHostNproc();
const cpu = selectHostCpus(8, 8), state = { browserHardwareConcurrency: 8, selectedGuestCpus: 8 };
const logs = 'display=1280x720, cpus=8, ram=4 GB (maximum)\n[0.00] smp: Brought up 1 node, 8 CPUs\nstarting /bin/firefox as admin';
await check('actual host nproc is a positive integer', () => assert.ok(Number.isInteger(hostNproc) && hostNproc >= 1));
await check('host/browser agreement selects eight', () => assert.equal(cpu.requestedGuestCpus, 8));
await check('one CPU lower bound', () => assert.equal(selectHostCpus(1, 1).requestedGuestCpus, 1));
await check('64 CPU upper boundary', () => assert.equal(selectHostCpus(64, 64).requestedGuestCpus, 64));
await check('host above UI range rejects instead of accepting a clamped count', () => assert.throws(() => selectHostCpus(128, 128), /exceeds reviewed UI limit/));
await check('above-range host/browser disagreement rejects', () => assert.throws(() => selectHostCpus(128, 32), /CPU count mismatch/));
await check('two different above-range counts cannot agree through clamping', () => assert.throws(() => selectHostCpus(128, 256), /CPU count mismatch/));
await check('forged clamped selection fails phase checks', () => {
  const high = { hostNproc: 128, browserHardwareConcurrency: 128, requestedGuestCpus: 64 };
  assert.equal(hostCpuPhaseChecks(high, { browserHardwareConcurrency: 128, selectedGuestCpus: 64 }, 128).hostCpuSelection, false);
});
for (const value of [undefined, null, 0, -1, 1.5, NaN, Infinity, '8']) {
  const label = String(value);
  await check('invalid host ' + label, () => assert.throws(() => selectHostCpus(value, 8), /invalid host nproc/));
  await check('invalid browser ' + label, () => assert.throws(() => selectHostCpus(8, value), /invalid browser hardwareConcurrency/));
}
await check('ordinary host/browser disagreement rejects', () => assert.throws(() => selectHostCpus(8, 4), /CPU count mismatch/));
await check('kernel count comes from SMP, never config text', () => {
  const evidence = guestCpuEvidence(cpu, logs, state, 8);
  assert.equal(evidence.guestBootCpus, 8);
  assert.deepEqual(evidence.smpLines, ['[0.00] smp: Brought up 1 node, 8 CPUs']);
  assert.ok(Object.values(evidence.checks).every(Boolean));
});
await check('singular and plural SMP nodes/CPUs parse', () => {
  assert.equal(guestCpuEvidence(selectHostCpus(1, 1), 'smp: Brought up 1 node, 1 CPU', { browserHardwareConcurrency: 1, selectedGuestCpus: 1 }, 1).guestBootCpus, 1);
  assert.equal(guestCpuEvidence(cpu, 'smp: Brought up 2 nodes, 8 CPUs', state, 8).guestBootCpus, 8);
});
await check('latest SMP record decides mismatching count', () => assert.equal(guestCpuEvidence(cpu, logs + '\nsmp: Brought up 1 node, 2 CPUs', state, 8).checks.guestCpuCountMatchesHost, false));
await check('missing SMP does not infer count from config', () => {
  const evidence = guestCpuEvidence(cpu, 'display=1280x720, cpus=8, ram=4 GB (maximum)', state, 8);
  assert.equal(evidence.guestBootCpus, null);
  assert.equal(evidence.checks.guestCpuCountMatchesHost, false);
});
await check('malformed SMP evidence fails', () => assert.equal(guestCpuEvidence(cpu, 'smp: Brought up 1 node, eight CPUs', state, 8).checks.guestCpuCountMatchesHost, false));
await check('cold saves and asserts actual kernel evidence', async () => {
  const evidence = await saveGuestCpuEvidence(cpu, logs, state, out, 'cold', 8);
  assert.equal(evidence.guestBootCpus, 8);
  assert.equal(JSON.parse(await fs.readFile(out + '/cold-cpu.json')).guestBootCpus, 8);
  assert.ok((await fs.readFile(out + '/cold-startup-guest-logs.txt', 'utf8')).includes('smp: Brought up 1 node, 8 CPUs'));
});
await check('warm independently saves and asserts actual kernel evidence', async () => {
  const evidence = await saveGuestCpuEvidence(cpu, logs, state, out, 'warm', 8);
  assert.equal(evidence.guestBootCpus, 8);
  assert.equal(JSON.parse(await fs.readFile(out + '/warm-cpu.json')).guestBootCpus, 8);
});
for (const [label, testLogs, testState] of [
  ['missing', '', state],
  ['mismatch', 'smp: Brought up 1 node, 2 CPUs', state],
  ['browser-change', logs, { ...state, browserHardwareConcurrency: 4 }],
  ['ui-change', logs, { ...state, selectedGuestCpus: 2 }],
  ['missing-ui', logs, { browserHardwareConcurrency: 8 }],
]) {
  await check(label + ' fails after retaining diagnostic evidence', async () => {
    await assert.rejects(saveGuestCpuEvidence(cpu, testLogs, testState, out, label, 8), /guest\/host CPU count mismatch/);
    const evidence = JSON.parse(await fs.readFile(out + '/' + label + '-cpu.json'));
    assert.ok(Object.values(evidence.checks).includes(false));
    assert.equal(await fs.readFile(out + '/' + label + '-startup-guest-logs.txt', 'utf8'), testLogs + '\n');
  });
}
await check('later ring eviction preserves startup CPU evidence', () => {
  const evidence = guestCpuEvidence(cpu, logs, state, 8);
  assert.ok(Object.values(guestCpuChecks(evidence, state, 8)).every(Boolean));
  assert.equal(guestCpuEvidence(cpu, 'later Firefox diagnostics', state, 8).guestBootCpus, null);
});
await check('later browser count change fails', () => assert.equal(guestCpuChecks(guestCpuEvidence(cpu, logs, state, 8), { ...state, browserHardwareConcurrency: 4 }, 8).hostCpuSelection, false));
await check('later UI count change fails', () => assert.equal(guestCpuChecks(guestCpuEvidence(cpu, logs, state, 8), { ...state, selectedGuestCpus: 2 }, 8).hostCpuSelection, false));
await check('observed host count is required by pure checks', () => assert.equal(guestCpuChecks(guestCpuEvidence(cpu, logs, state, 8), state).hostAllocationStable, false));
await check('host drift fails even with unchanged browser UI and kernel', () => {
  const evidence = guestCpuEvidence(cpu, logs, state, 6);
  assert.equal(evidence.hostNprocObserved, 6);
  assert.equal(evidence.checks.hostAllocationStable, false);
  assert.equal(evidence.checks.hostCpuSelection, true);
  assert.equal(evidence.checks.guestCpuCountMatchesHost, true);
});
await check('stable six CPU host dynamically selects six', () => {
  const six = selectHostCpus(6, 6), sixState = { browserHardwareConcurrency: 6, selectedGuestCpus: 6 };
  assert.ok(Object.values(guestCpuEvidence(six, 'smp: Brought up 1 node, 6 CPUs', sixState, 6).checks).every(Boolean));
});
for (const observed of [undefined, null, 0, -1, 1.5, NaN, Infinity, '8', 6, 9]) {
  await check('invalid or changed phase host count ' + String(observed), () => assert.equal(hostCpuPhaseChecks(cpu, state, observed).hostAllocationStable, false));
}
for (const label of ['cold-preboot', 'update-preboot', 'warm-preboot', 'cold-final', 'update-final', 'warm-final', 'end']) {
  await check(label + ' stable count saves phase evidence', async () => {
    const evidence = await saveHostCpuPhaseEvidence(cpu, state, out, label, 8);
    assert.equal(evidence.hostNprocObserved, 8);
    assert.equal(JSON.parse(await fs.readFile(out + '/' + label + '-cpu-phase.json')).hostNprocObserved, 8);
  });
  await check(label + ' host drift fails and retains phase evidence', async () => {
    await assert.rejects(saveHostCpuPhaseEvidence(cpu, state, out, label + '-drift', 6), /host CPU allocation\/selection mismatch/);
    const evidence = JSON.parse(await fs.readFile(out + '/' + label + '-drift-cpu-phase.json'));
    assert.equal(evidence.hostNprocObserved, 6);
    assert.equal(evidence.checks.hostAllocationStable, false);
  });
}
await check('startup host drift retains actual kernel and changed host evidence', async () => {
  await assert.rejects(saveGuestCpuEvidence(cpu, logs, state, out, 'startup-host-drift', 6), /guest\/host CPU count mismatch/);
  const evidence = JSON.parse(await fs.readFile(out + '/startup-host-drift-cpu.json'));
  assert.equal(evidence.guestBootCpus, 8);
  assert.equal(evidence.hostNprocObserved, 6);
  assert.equal(evidence.checks.hostAllocationStable, false);
});
const result = { pass: checks.every(c => c.pass), fixtureOnly: true, hostNproc, checks };
await fs.writeFile(out + '/result.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ pass: result.pass, checks: checks.length, hostNproc, out }));
if (!result.pass) process.exitCode = 1;
