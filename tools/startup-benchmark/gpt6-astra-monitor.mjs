// Owned-process monitoring runs off the CDP/input event loop. Never changes quotas.
import fs from 'node:fs';
import path from 'node:path';
import {parentPort, workerData} from 'node:worker_threads';
import {revalidateOwnedIdentity} from './owned-process-identity.mjs';

const {rootPid, rootStart, run, startedAtMonotonic, clockTicks, pssIntervalMs=5000} = workerData;
const tracked = new Map([[rootPid, rootStart]]);
const observedGroups = new Map();
let lastProcesses, lastSample, timer, lastPssSample=-Infinity;
const now = () => +(performance.now() - startedAtMonotonic).toFixed(3);

function stat(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const f = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
    return {pid, ppid: +f[1], group: +f[2], session: +f[3], start: f[19], ticks: +f[11] + +f[12]};
  } catch { return null; }
}
function ownedProcesses() {
  // Only stat is read for unrelated processes; detailed accounting is owned only.
  const all = fs.readdirSync('/proc').filter(x => /^\d+$/.test(x)).map(x => stat(+x)).filter(Boolean);
  const enumerated = new Map(all.map(p=>[p.pid,p]));
  for(const [pid,start] of tracked)if(enumerated.get(pid)?.start!==start){
    const state=revalidateOwnedIdentity({pid,start});
    if(state.kind==='live')throw new Error('Known live owned process absent from readable inventory: '+pid);
  }
  const owned = new Map(all.filter(p => tracked.get(p.pid) === p.start).map(p => [p.pid, p]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of all) if (!owned.has(p.pid) && owned.has(p.ppid)) {
      owned.set(p.pid, p); changed = true;
    }
  }
  for (const p of owned.values()) {
    tracked.set(p.pid, p.start);
    try {
      const status = fs.readFileSync(`/proc/${p.pid}/status`, 'utf8');
      p.rss = +(/VmRSS:\s*(\d+)/.exec(status)?.[1] || 0) * 1024;
      p.affinity = /Cpus_allowed_list:\s*(\S+)/.exec(status)?.[1];
      p.cgroup = fs.readFileSync(`/proc/${p.pid}/cgroup`, 'utf8').trim();
    } catch { p.rss = 0; p.cgroup = ''; }
  }
  return [...owned.values()];
}
function affinityCount(value) {
  return value?.split(',').reduce((n, x) => {
    const [a, b] = x.split('-').map(Number); return n + (b === undefined ? 1 : b - a + 1);
  }, 0) ?? null;
}
function quotaSnapshot(group) {
  const unified = group.split('\n').find(x => x.startsWith('0::'));
  if (!unified) return {capacity: null, limits: []};
  let directory = '/sys/fs/cgroup' + unified.slice(3), capacity = Infinity;
  const limits = [];
  for (;;) {
    const file = path.join(directory, 'cpu.max');
    try {
      const raw = fs.readFileSync(file, 'utf8').trim(), [q, period] = raw.split(/\s+/);
      limits.push({path: file, raw});
      if (q !== 'max') capacity = Math.min(capacity, Number(q) / Number(period));
    } catch {}
    if (directory === '/sys/fs/cgroup') break;
    directory = path.dirname(directory);
    if (!directory.startsWith('/sys/fs/cgroup')) break;
  }
  return {capacity: Number.isFinite(capacity) ? capacity : null, limits};
}
function sample() {
  const started = now(); let list = ownedProcesses();
  const enumeratedAt=now(), pssSampled=started-lastPssSample>=pssIntervalMs;
  let pss = 0, complete = true;
  if(pssSampled)lastPssSample=started;
  for (const p of pssSampled ? list : []) {
    try { pss += Number(/^Pss:\s*(\d+)/m.exec(fs.readFileSync(`/proc/${p.pid}/smaps_rollup`, 'utf8'))?.[1] || 0) * 1024; }
    catch { if (stat(p.pid)?.start === p.start) complete = false; }
  }
  const pssFinishedAt=now();
  const ticks = list.reduce((sum, p) => sum + Math.max(0, p.ticks - (lastProcesses?.get(p.pid+':'+p.start) ?? 0)), 0);
  const available = Number(/MemAvailable:\s*(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))?.[1] || 0) * 1024;
  const excludedTerminal=[];
  list=list.filter(p=>{const state=revalidateOwnedIdentity(p);if(state.kind==='terminal'){excludedTerminal.push(state);return false;}p.state=state.state;return true;});
  const quotaByGroup = Object.fromEntries([...new Set(list.map(p => p.cgroup))].map(group => [group, quotaSnapshot(group)]));
  for (const p of list) {
    const count = affinityCount(p.affinity), quota = quotaByGroup[p.cgroup].capacity;
    p.effectiveCpus = count === null ? null : Math.min(count, quota ?? Infinity);
  }
  const groupValues=Object.values(quotaByGroup);
  const capPaths=q=>q.limits.filter(l=>{const [v,p]=l.raw.split(/\s+/);return v!=='max'&&Number(v)>0&&Number(p)>0&&Number(v)/Number(p)<=3;}).map(l=>l.path);
  const commonCpuAncestors=groupValues.length?capPaths(groupValues[0]).filter(file=>groupValues.every(q=>capPaths(q).includes(file))):[];
  const changedMembership=[];for(const p of list){const key=p.pid+':'+p.start;const previous=observedGroups.get(key);if(previous&&previous!==p.cgroup&&stat(p.pid)?.start===p.start)changedMembership.push(p.pid);observedGroups.set(key,p.cgroup);}
  const disk = fs.statfsSync(run);
  const row = {ms: started, completedMs: now(), quotaByGroup, commonCpuAncestors, changedMembership, excludedTerminal,
    cpuPercent: lastProcesses === undefined ? null : ticks / clockTicks / ((started - lastSample) / 1000) * 100,
    cpuAccounting:'per-PID/start counter deltas; CPU after a final sample before process exit may be missed',
    pssBytes: pssSampled&&complete ? pss : null, pssSampled, pssIntervalMs, pssAgeMs:started-lastPssSample,
    processEnumerationMs:enumeratedAt-started, pssReadMs:pssFinishedAt-enumeratedAt, rssSumBytes: list.reduce((n, p) => n + p.rss, 0),
    availableBytes: available, diskFreeBytes: disk.bavail * disk.bsize, processes: list};
  row.samplingMs = row.completedMs - started;
  lastProcesses = new Map(list.map(p => [p.pid+':'+p.start,p.ticks])); lastSample = started;
  fs.appendFileSync(path.join(run, 'resource-samples.jsonl'), JSON.stringify(row) + '\n');
  parentPort.postMessage({sample: row});
  const escaped=list.filter(p=>stat(p.pid)?.start===p.start&&(!Number.isFinite(quotaByGroup[p.cgroup]?.capacity)||quotaByGroup[p.cgroup].capacity<=0||quotaByGroup[p.cgroup].capacity>3));
  if(!commonCpuAncestors.length)parentPort.postMessage({fatal:'Owned processes lack one shared ancestor CPU quota <=3'});
  if(changedMembership.length)parentPort.postMessage({fatal:'Owned process changed cgroup during observation: '+changedMembership.join(',')});
  if(escaped.length)parentPort.postMessage({fatal:'Owned process lacks an effective ancestor CPU quota <=3: '+escaped.map(p=>p.pid+' '+p.cgroup).join('; ')});
  if (available < 2 * 1024 ** 3) parentPort.postMessage({fatal: 'Host available RAM below 2 GiB'});
}
function guardedSample() {
  try { sample(); } catch (e) { parentPort.postMessage({fatal: String(e)}); }
}
parentPort.on('message', message => {
  if (message === 'stop') { clearInterval(timer); parentPort.postMessage({stopped: true}); parentPort.close(); }
});
guardedSample();
timer = setInterval(guardedSample, 1000);
