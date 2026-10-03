// Shared host-count contract for new Firefox/Linux-Wasm diagnostics.
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

function validCount(value, label) {
  if (!Number.isInteger(value) || value < 1) throw Error('invalid ' + label);
  return value;
}

export function readHostNproc() {
  return validCount(Number(execFileSync('nproc', [], { encoding: 'utf8' }).trim()), 'host nproc');
}

export function selectHostCpus(hostNproc, browserHardwareConcurrency) {
  validCount(hostNproc, 'host nproc');
  validCount(browserHardwareConcurrency, 'browser hardwareConcurrency');
  // Match main.js's 1–64 UI range, with no fallback for invalid evidence.
  const hostCores = Math.min(64, Math.max(1, browserHardwareConcurrency));
  const expectedHostCores = Math.min(64, hostNproc);
  const cpu = { hostNproc, browserHardwareConcurrency, hostCores, expectedHostCores, requestedGuestCpus: hostCores };
  if (hostCores !== expectedHostCores) throw Error('browser/host CPU count mismatch: ' + JSON.stringify(cpu));
  return cpu;
}

export const guestCpuStateExpression = '({browserHardwareConcurrency:navigator.hardwareConcurrency,selectedGuestCpus:Number(document.querySelector("#cpu-cores")?.value)})';
export const guestCpuPrebootStateExpression = '({browserHardwareConcurrency:navigator.hardwareConcurrency,selectedGuestCpus:JSON.parse(localStorage.getItem("linuxonweb.machine-settings.v1"))?.cpus})';

export function hostCpuPhaseChecks(cpu, state, observedHostNproc) {
  return {
    hostAllocationStable: Number.isInteger(observedHostNproc) && observedHostNproc > 0 && observedHostNproc === cpu.hostNproc,
    hostCpuSelection: state.browserHardwareConcurrency === cpu.browserHardwareConcurrency && state.selectedGuestCpus === cpu.requestedGuestCpus,
  };
}

export function guestCpuChecks(cpu, state, observedHostNproc) {
  return {
    ...hostCpuPhaseChecks(cpu, state, observedHostNproc),
    guestCpuCountMatchesHost: cpu.guestBootCpus === cpu.requestedGuestCpus,
  };
}

export async function saveHostCpuPhaseEvidence(cpu, state, out, label, observedHostNproc = readHostNproc()) {
  const evidence = { ...cpu, hostNprocObserved: observedHostNproc, browserHardwareConcurrencyObserved: state.browserHardwareConcurrency, selectedGuestCpus: state.selectedGuestCpus, checks: hostCpuPhaseChecks(cpu, state, observedHostNproc) };
  await fs.writeFile(out + '/' + label + '-cpu-phase.json', JSON.stringify(evidence, null, 2) + '\n');
  if (!Object.values(evidence.checks).every(Boolean)) throw Error(label + ' host CPU allocation/selection mismatch: ' + JSON.stringify(evidence));
  return evidence;
}

export function guestCpuEvidence(cpu, logs, state, observedHostNproc) {
  const smpLines = logs.split('\n').filter(line => /smp: Brought up \d+ nodes?, \d+ CPUs?\b/.test(line));
  const guestBootCpus = smpLines.length ? Number(/, (\d+) CPUs?\b/.exec(smpLines.at(-1))[1]) : null;
  const evidence = { ...cpu, hostNprocObserved: observedHostNproc, browserHardwareConcurrencyAtBoot: state.browserHardwareConcurrency, selectedGuestCpus: state.selectedGuestCpus, guestBootCpus, smpLines };
  return { ...evidence, checks: guestCpuChecks(evidence, state, observedHostNproc) };
}

export async function saveGuestCpuEvidence(cpu, logs, state, out, label, observedHostNproc = readHostNproc()) {
  const evidence = guestCpuEvidence(cpu, logs, state, observedHostNproc);
  // Save even failing evidence before throwing, and before later output evicts
  // startup history. Missing SMP evidence must never inherit a previous boot.
  await fs.writeFile(out + '/' + label + '-startup-guest-logs.txt', logs + '\n');
  await fs.writeFile(out + '/' + label + '-cpu.json', JSON.stringify(evidence, null, 2) + '\n');
  if (!Object.values(evidence.checks).every(Boolean)) throw Error(label + ' guest/host CPU count mismatch: ' + JSON.stringify(evidence));
  return evidence;
}
