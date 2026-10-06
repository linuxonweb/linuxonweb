import fs from 'node:fs/promises';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function parseProcStat(text) {
  const end = text.lastIndexOf(')'), pid = Number(text.slice(0, text.indexOf(' '))), fields = text.slice(end + 2).trim().split(/\s+/);
  if (end < 0 || !Number.isSafeInteger(pid) || fields.length < 20) throw Error('invalid process stat');
  return { pid, state:fields[0], ppid:Number(fields[1]), pgid:Number(fields[2]), sid:Number(fields[3]), startTicks:fields[19] };
}
export async function groupSnapshot(pgid, proc = fs) {
  if (!Number.isSafeInteger(pgid) || pgid <= 1) throw Error('owned exact PGID required');
  const members = [];
  for (const name of await proc.readdir('/proc')) {
    if (!/^[1-9][0-9]*$/.test(name)) continue;
    let row;
    try { row = parseProcStat(await proc.readFile('/proc/' + name + '/stat', 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') continue; throw error; }
    if (row.pgid === pgid) members.push(row); // zombies count as physical members.
  }
  return members.sort((a,b) => a.pid - b.pid);
}
export async function pinOwnedGroup(pid) {
  const row = parseProcStat(await fs.readFile('/proc/' + pid + '/stat', 'utf8'));
  if (row.pid !== pid || row.pgid !== pid || row.sid !== pid || !/^[0-9]+$/.test(row.startTicks)) throw Error('detached child exact PGID/session not established');
  return { pid, pgid:pid, sid:pid, leaderStartTicks:row.startTicks };
}
export async function drainOwnedGroup(owner, hooks = {}) {
  const scan = hooks.scan || groupSnapshot, sleep = hooks.sleep || delay, now = hooks.now || Date.now, kill = hooks.kill || ((group, signal) => process.kill(-group, signal));
  const stages = [], receipt = { kind:'owned-browser-exact-group-cleanup-v1', owner, forced:false, physicalGroupEmpty:false, pass:false, stages };
  if (!owner || owner.pid !== owner.pgid || owner.sid !== owner.pgid || !/^[0-9]+$/.test(owner.leaderStartTicks)) throw Error('pinned exact detached group required');
  async function members() {
    const rows = await scan(owner.pgid);
    if (rows.some(row => row.sid !== owner.sid || !/^[0-9]+$/.test(row.startTicks) || BigInt(row.startTicks) < BigInt(owner.leaderStartTicks) || (row.pid === owner.pid && row.startTicks !== owner.leaderStartTicks))) throw Error('owned group identity changed');
    return rows;
  }
  async function wait(stage, milliseconds) {
    const started = now(); let rows = await members();
    while (rows.length && now() - started < milliseconds) { await sleep(100); rows = await members(); }
    stages.push({ stage, elapsedMs:now()-started, members:rows }); return rows;
  }
  let rows = await wait('natural', 10000);
  receipt.naturalGroupEmpty = rows.length === 0;
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (!rows.length) break;
    // Revalidate exact identity immediately before group signal. Empty or
    // reused groups never receive a signal; any forced signal fails acceptance.
    rows = await members(); if (!rows.length) break;
    receipt.forced = true;
    try { kill(owner.pgid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    rows = await wait(signal, 5000);
  }
  receipt.physicalGroupEmpty = rows.length === 0;
  receipt.pass = receipt.naturalGroupEmpty && receipt.physicalGroupEmpty && !receipt.forced;
  return receipt;
}
