import fs from 'node:fs';
// A missing quota is never evidence of exit. Only exact /proc identity/state can
// remove a previously owned process from the common-ancestor intersection.
export function revalidateOwnedIdentity(row, readStat=pid=>fs.readFileSync(`/proc/${pid}/stat`,'utf8')) {
 let raw;
 try { raw=readStat(row.pid); }
 catch(error) {
  if(error?.code==='ENOENT'||error?.code==='ESRCH')return {kind:'terminal',reason:'vanished',pid:row.pid,start:row.start};
  throw new Error(`Owned identity is unreadable for PID ${row.pid}: ${error?.code||'unknown error'}`);
 }
 if(typeof raw!=='string'||raw.lastIndexOf(')')<1)throw new Error(`Malformed owned identity for PID ${row.pid}`);
 const fields=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/);
 const state=fields[0],start=fields[19];
 if(!/^[RSDZTtWXxKPI]$/.test(state)||!/^\d+$/.test(start||''))throw new Error(`Malformed owned identity fields for PID ${row.pid}`);
 if(start!==row.start)return {kind:'terminal',reason:'identity-reused',pid:row.pid,start:row.start};
 if(['Z','X','x'].includes(state))return {kind:'terminal',reason:'terminal-state-'+state,pid:row.pid,start};
 return {kind:'live',state,pid:row.pid,start};
}
