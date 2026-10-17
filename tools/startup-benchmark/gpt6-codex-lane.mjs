import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpuCapacity } from './gpt6-codex-contract.mjs';

export function cpuLane(request, affinity) {
  if (typeof request !== 'string' || !/^[1-9]\d*$/.test(request)) throw Error('Invalid CPU lane request');
  const cpus = Number(request);
  const available = cpuCapacity(affinity, ['max 100000']).affinity;
  if (!Number.isSafeInteger(cpus) || cpus > available) throw Error('CPU lane exceeds available affinity');
  const selected = [];
  for (const part of affinity.split(',')) {
    const [first, last = first] = part.split('-').map(Number);
    for (let cpu = first; cpu <= last && selected.length < cpus; cpu++) selected.push(cpu);
    if (selected.length === cpus) break;
  }
  return { cpus, affinity: selected.join(','), quota: `${cpus * 100}%` };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const status = readFileSync('/proc/self/status', 'utf8');
  const affinity = /^Cpus_allowed_list:\s*(\S+)/m.exec(status)?.[1];
  const lane = cpuLane(process.argv[2], affinity);
  process.stdout.write(`${lane.cpus} ${lane.affinity} ${lane.quota}\n`);
}
