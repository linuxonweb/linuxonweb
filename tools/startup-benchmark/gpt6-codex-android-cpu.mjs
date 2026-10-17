import { cpuCapacity } from './gpt6-codex-contract.mjs';

export function parseAndroidThreadRecords(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('THREAD\n') && !raw.startsWith('THREAD\r\n')) {
    throw Error('Missing thread record delimiter');
  }
  return raw.replaceAll('\r\n', '\n').split(/^THREAD$/m).map(record => record.trim())
    .filter(Boolean).map(record => {
      const affinities = [...record.matchAll(/^Cpus_allowed_list:[ \t]*(\S+)[ \t]*$/gm)];
      if (affinities.length !== 1) throw Error('Missing or duplicate thread affinity');
      return { affinity: affinities[0][1], cgroup: record.split('\n').filter(line => /^\d+:/.test(line)).join('\n') };
    });
}

export function admitAndroidRootCpu(evidence) {
  const mounts = evidence.mountinfo.split('\n').filter(Boolean).filter(line => {
    const filesystem = line.split(' - ')[1];
    const fields = filesystem?.split(' ');
    return fields?.[0] === 'cgroup' && fields[2]?.split(',').includes('cpu');
  });
  if (mounts.length !== 1 || mounts[0].split(' ')[3] !== '/') {
    throw Error('CPU mount does not expose the controller root');
  }
  const reservedInitial = /^4\.9\.\d+(?:[-+].*)?$/.test(evidence.kernelRelease ?? '') &&
    evidence.namespace === 'cgroup:[4026531835]';
  if (!/^cgroup:\[\d+\]$/.test(evidence.namespace) ||
      (!reservedInitial && evidence.namespace !== evidence.initNamespace)) {
    throw Error('Unverified initial cgroup namespace');
  }
  const { affinity } = cpuCapacity(evidence.online, ['max 100000']);
  if (affinity !== evidence.hardwareConcurrency || evidence.cpuset !== evidence.online) {
    throw Error('CPU online, browser or cpuset mismatch');
  }
  if (!Array.isArray(evidence.threads) || !evidence.threads.length) throw Error('Missing thread CPU evidence');
  for (const thread of evidence.threads) {
    if (thread.affinity !== evidence.online) throw Error('Thread CPU affinity mismatch');
    const controllers = thread.cgroup.trim().split('\n').map(line => line.split(':'))
      .filter(parts => parts[1]?.split(',').includes('cpu'));
    if (controllers.length !== 1 || controllers[0][2] !== '/') {
      throw Error('Thread is not in the root CPU group');
    }
  }
  return { effectiveCpus: affinity, quota: 'root-cpu-controller-unlimited', threadCount: evidence.threads.length };
}
