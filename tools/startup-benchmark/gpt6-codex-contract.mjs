export function cpuCapacity(affinity, limits) {
  if (typeof affinity !== 'string' || !Array.isArray(limits) || !limits.length) throw Error('Missing CPU evidence');
  const selected = new Set();
  for (const part of affinity.split(',')) {
    if (!/^\d+(?:-\d+)?$/.test(part)) throw Error('Invalid CPU affinity');
    const [first, last = first] = part.split('-').map(Number);
    if (last < first || last > 65535) throw Error('Invalid CPU affinity range');
    for (let cpu = first; cpu <= last; cpu++) {
      if (selected.has(cpu)) throw Error('Overlapping CPU affinity');
      selected.add(cpu);
    }
  }
  let capacity = selected.size;
  for (const limit of limits) {
    if (!/^(max|[1-9]\d*) [1-9]\d*$/.test(limit)) throw Error('Invalid CPU quota');
    const [quota, period] = limit.split(' ');
    if (quota !== 'max') capacity = Math.min(capacity, Number(quota) / Number(period));
  }
  if (!Number.isFinite(capacity) || capacity <= 0) throw Error('Invalid CPU capacity');
  return { affinity: selected.size, capacity };
}

export function guestCpus(logs) {
  return Number([...logs.matchAll(/smp: Brought up \d+ nodes?, (\d+) CPUs?\b/g)].at(-1)?.[1]) || null;
}

export function availableMemory(meminfo) {
  const match = /^MemAvailable:\s+(\d+) kB$/m.exec(meminfo);
  const bytes = match ? Number(match[1]) * 1024 : NaN;
  if (!Number.isSafeInteger(bytes)) throw Error('Missing or invalid available memory evidence');
  return { bytes, low: bytes < 1024 ** 3 };
}

export function assertContainment(expected, processes) {
  if (!expected || !processes.length) throw Error('Missing process containment evidence');
  for (const process of processes) {
    if (process.cgroup !== expected && !process.cgroup?.startsWith(expected + '/')) {
      throw Error(`Resource containment lost: PID ${process.pid} moved to ${process.cgroup}`);
    }
  }
}

export function routePath(request) {
  if (typeof request !== 'string' || !request.startsWith('/') || request.startsWith('//')) throw Error('Invalid route');
  const raw = request.split('?')[0];
  if (/%2f|%5c/i.test(raw)) throw Error('Encoded path separator');
  const decoded = decodeURIComponent(raw);
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(part => part === '.' || part === '..')) throw Error('Unsafe route');
  return decoded;
}
