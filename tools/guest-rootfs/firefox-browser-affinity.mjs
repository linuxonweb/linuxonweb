// Assign actual cores to an owned test browser; never override browser APIs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { readHostNproc } from './firefox-host-cpus.mjs';

export function expandCpuList(text) {
  if (typeof text !== 'string' || !text.length) throw Error('missing CPU affinity');
  const cpus = [];
  for (const part of text.split(',')) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!match) throw Error('invalid CPU affinity');
    const first = Number(match[1]), last = Number(match[2] ?? match[1]);
    if (last < first || last > 4095 || (cpus.length && first <= cpus.at(-1)))
      throw Error('unsupported or unordered CPU affinity');
    for (let cpu = first; cpu <= last; cpu++) cpus.push(cpu);
  }
  return cpus;
}

export function browserAffinityPlan(hostNproc, runnerCpuList, runnerCgroup) {
  if (!Number.isInteger(hostNproc) || hostNproc < 1 || hostNproc > 64)
    throw Error('exact host count must be within reviewed range 1..64');
  const allowed = expandCpuList(runnerCpuList);
  if (allowed.length < hostNproc) throw Error('host count exceeds actual allowed CPUs');
  return { schema: 1, hostNproc, runnerCpuList, runnerCgroup, assignedCpus: allowed.slice(0, hostNproc) };
}

function validatePlan(plan) {
  const reviewed = browserAffinityPlan(plan?.hostNproc, plan?.runnerCpuList, plan?.runnerCgroup);
  if (plan.schema !== 1 || JSON.stringify(plan.assignedCpus) !== JSON.stringify(reviewed.assignedCpus))
    throw Error('browser affinity differs from exact host allocation');
}

export function browserLaunchCommand(executable, args, plan) {
  validatePlan(plan);
  if (typeof executable !== 'string' || !executable.startsWith('/') || !Array.isArray(args) || args.some(a => typeof a !== 'string'))
    throw Error('explicit executable and argv required');
  return ['/usr/bin/taskset', '-c', plan.assignedCpus.join(','), executable, ...args];
}

export async function prepareBrowserAffinity(out) {
  // This environment moves new tool processes into a quota cgroup shortly
  // after startup. Wait before the launch reading; later drift still fails.
  await new Promise(resolve => setTimeout(resolve, 2000));
  const attempt = {
    hostNproc: readHostNproc(),
    runnerCpuList: /^Cpus_allowed_list:\s*(.+)$/m.exec(await fs.readFile('/proc/self/status', 'utf8'))?.[1],
    runnerCgroup: await fs.readFile('/proc/self/cgroup', 'utf8'),
  };
  await fs.writeFile(out + '/browser-affinity-launch-attempt.json', JSON.stringify(attempt, null, 2) + '\n');
  const plan = browserAffinityPlan(attempt.hostNproc, attempt.runnerCpuList, attempt.runnerCgroup);
  await fs.writeFile(out + '/browser-affinity-launch.json', JSON.stringify(plan, null, 2) + '\n');
  return plan;
}

export function browserAffinityChecks(plan, observed) {
  validatePlan(plan);
  return {
    hostAllocationStable: observed.hostNproc === plan.hostNproc,
    browserCountMatchesHost: observed.browserHardwareConcurrency === plan.hostNproc,
    actualBrowserAffinity: JSON.stringify(expandCpuList(observed.browserCpuList)) === JSON.stringify(plan.assignedCpus),
    runnerQuotaMatchesHost: observed.runnerQuota?.effectiveCpus === plan.hostNproc,
    browserQuotaMatchesHost: observed.browserQuota?.effectiveCpus === plan.hostNproc,
  };
}

export function parseCpuMax(value) {
  const match = /^(max|[1-9]\d*) ([1-9]\d*)\n?$/.exec(value);
  if (!match) throw Error('invalid cgroup cpu.max');
  const period = Number(match[2]);
  const quota = match[1] === 'max' ? null : Number(match[1]);
  if (!Number.isSafeInteger(period) || (quota !== null && !Number.isSafeInteger(quota)))
    throw Error('unsafe cgroup cpu.max');
  return quota === null ? null : quota / period;
}

export function cgroupPath(value) {
  const lines = value.trimEnd().split('\n');
  if (lines.length !== 1) throw Error('expected one unified cgroup');
  const match = /^0::(\/.*)$/.exec(lines[0]);
  if (!match || match[1].split('/').some(part => part === '.' || part === '..'))
    throw Error('invalid unified cgroup path');
  return match[1];
}

export async function readCgroupCpuQuota(cgroupText, allowedCpuCount, root = '/sys/fs/cgroup') {
  const group = cgroupPath(cgroupText);
  if (!Number.isInteger(allowedCpuCount) || allowedCpuCount < 1)
    throw Error('actual allowed CPU count required');
  const segments = group.split('/').filter(Boolean);
  let minimum = Infinity;
  const ancestors = [];
  for (let count = 0; count <= segments.length; count++) {
    const name = '/' + segments.slice(0, count).join('/');
    const filename = path.join(root, ...segments.slice(0, count), 'cpu.max');
    let value;
    try { value = await fs.readFile(filename, 'utf8'); }
    catch (error) {
      // A unified hierarchy need not expose cpu.max on its root node.
      if (count === 0 && error.code === 'ENOENT') continue;
      throw error;
    }
    const quotaCpus = parseCpuMax(value);
    ancestors.push({ cgroup: name, cpuMax: value.trim(), quotaCpus });
    if (quotaCpus !== null) minimum = Math.min(minimum, quotaCpus);
  }
  if (!ancestors.length) throw Error('missing cgroup CPU controller');
  return { cgroup: group, allowedCpuCount, minimumQuotaCpus: Number.isFinite(minimum) ? minimum : null,
    effectiveCpus: Math.min(allowedCpuCount, Math.ceil(minimum)), ancestors };
}

export async function saveBrowserAffinityEvidence(plan, ownedPid, browserHardwareConcurrency, out, label = 'browser-admission') {
  if (!Number.isInteger(ownedPid) || ownedPid < 1 || !/^[a-z0-9-]+$/.test(label)) throw Error('owned PID and evidence label required');
  const evidence = {
    ...plan, launchHostNproc: plan.hostNproc, ownedPid, hostNproc: readHostNproc(), browserHardwareConcurrency,
    browserCpuList: /^Cpus_allowed_list:\s*(.+)$/m.exec(await fs.readFile('/proc/' + ownedPid + '/status', 'utf8'))?.[1],
    runnerCgroupObserved: await fs.readFile('/proc/self/cgroup', 'utf8'),
    browserCgroup: await fs.readFile('/proc/' + ownedPid + '/cgroup', 'utf8'),
  };
  evidence.runnerQuota = await readCgroupCpuQuota(evidence.runnerCgroupObserved, expandCpuList(plan.runnerCpuList).length);
  evidence.browserQuota = await readCgroupCpuQuota(evidence.browserCgroup, expandCpuList(evidence.browserCpuList).length);
  await fs.writeFile(out + '/' + label + '-affinity.json', JSON.stringify(evidence, null, 2) + '\n');
  evidence.checks = browserAffinityChecks(plan, evidence);
  await fs.writeFile(out + '/' + label + '-affinity.json', JSON.stringify(evidence, null, 2) + '\n');
  if (!Object.values(evidence.checks).every(Boolean)) throw Error('owned browser/host CPU affinity mismatch: ' + JSON.stringify(evidence));
  return evidence;
}
