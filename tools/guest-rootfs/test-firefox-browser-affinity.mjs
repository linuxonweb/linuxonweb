// Pure admission checks and an optional live owned Chromium handshake.
// Neither mode starts a Linux guest or accepts Nightly/JIT/GPU/a release.
import fs from 'node:fs/promises';
import { readFileSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { browserAffinityPlan, browserAffinityChecks, browserLaunchCommand, expandCpuList, prepareBrowserAffinity, saveBrowserAffinityEvidence } from './firefox-browser-affinity.mjs';
import { ownedBrowserEndpoint, ownedPageEndpoint } from './check-firefox-nightly-benchmark.mjs';

const TASK = '/mnt/p6/build/firefox-nightly-browser-affinity-20261003';
const [mode, outArg] = process.argv.slice(2), out = path.resolve(outArg || '.');
assert(['--self-test', '--live'].includes(mode) && process.argv.length === 4, 'usage: --self-test|--live TASK/NEW');
assert(out.startsWith(TASK + '/'), 'owned output required');
for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
  const p = await fs.realpath(process.env[key]), disk = await fs.statfs(p);
  assert(p.startsWith(TASK + '/') && ![0x01021994, 0x858458f6].includes(disk.type) && disk.bavail * disk.bsize > 20 * 1024 ** 3, 'disk-backed scratch and reserve required');
}
const parent = await fs.realpath(path.dirname(out));
assert(parent === TASK || parent.startsWith(TASK + '/'), 'output parent escapes task');
await fs.mkdir(out);
const inputs = {};
for (const name of ['test-firefox-browser-affinity.mjs', 'firefox-browser-affinity.mjs', 'firefox-host-cpus.mjs', 'check-firefox-nightly-benchmark.mjs']) {
  const p = fileURLToPath(new URL(name, import.meta.url)), b = await fs.readFile(p);
  inputs[p] = createHash('sha256').update(b).digest('hex');
  await fs.writeFile(out + '/' + name, b);
}
const report = { pass:false, mode, inputs, checks:[], guestStarted:false, nightlyAcceptance:false, releaseAcceptance:false };
function check(name, action) { action(); report.checks.push({ name, pass:true }); }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

if (mode === '--self-test') {
  const plan = browserAffinityPlan(6, '2-8,10,12-15', 'quota');
  check('quota count selects actual allowed cores', () => assert.deepEqual(plan.assignedCpus, [2,3,4,5,6,7]));
  check('argv uses real scheduler affinity without browser API overrides', () => assert.deepEqual(browserLaunchCommand('/browser', ['--remote-debugging-port=0'], plan), ['/usr/bin/taskset','-c','2,3,4,5,6,7','/browser','--remote-debugging-port=0']));
  for (const count of [1, 6, 8, 64]) check('exact count ' + count, () => assert.equal(browserAffinityPlan(count, '0-63', 'quota').assignedCpus.length, count));
  for (const count of [undefined, null, 0, -1, 1.5, '6', NaN, Infinity, 65, 128]) check('invalid count ' + String(count), () => assert.throws(() => browserAffinityPlan(count, '0-127', 'quota')));
  for (const list of [undefined, '', '3-2', '1,1', '4,2', '0-3,2-5', '0-4096', 'no', '-1', '1,', '1.5']) check('invalid affinity ' + String(list), () => assert.throws(() => expandCpuList(list)));
  check('count cannot exceed real allowed cores', () => assert.throws(() => browserAffinityPlan(8, '0-5', 'quota')));
  check('forged plan cannot change actual assigned cores', () => assert.throws(() => browserLaunchCommand('/browser', [], {...plan,assignedCpus:[0,1,2,3,4,5]})));
  check('relative launcher refuses', () => assert.throws(() => browserLaunchCommand('browser', [], plan)));
  const observed = {hostNproc:6,browserHardwareConcurrency:6,browserCpuList:'2-7'};
  check('actual mask and dynamic counts agree', () => assert(Object.values(browserAffinityChecks(plan,observed)).every(Boolean)));
  check('same mask size on wrong cores refuses', () => assert.equal(browserAffinityChecks(plan,{...observed,browserCpuList:'0-5'}).actualBrowserAffinity,false));
  check('host quota drift refuses', () => assert.equal(browserAffinityChecks(plan,{...observed,hostNproc:8}).hostAllocationStable,false));
  check('browser API count mismatch refuses', () => assert.equal(browserAffinityChecks(plan,{...observed,browserHardwareConcurrency:8}).browserCountMatchesHost,false));
  report.pass = true;
} else {
  const affinity = await prepareBrowserAffinity(out), profile = out + '/profile';
  await fs.mkdir(profile);
  const command = browserLaunchCommand('/home/a/.local/archpkg/pacman/usr/bin/chromium', ['--headless','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'--disk-cache-dir='+out+'/cache','about:blank'], affinity);
  await fs.writeFile(out+'/command.json',JSON.stringify(command,null,2)+'\n');
  const fd=openSync(out+'/browser.log','wx'), spawnedAt=Date.now();
  const child=spawn(command[0],command.slice(1),{detached:true,env:{...process.env,XDG_CACHE_HOME:out+'/xdg'},stdio:['ignore',fd,fd]}); closeSync(fd);
  let exitInfo, spawnError, ws, closing=false, sequence=0;
  const exited=new Promise(resolve=>{child.once('exit',(code,signal)=>{exitInfo={code,signal};resolve();});child.once('error',e=>{spawnError=String(e);resolve();});});
  const pending=new Map();
  const childState=()=>{
    let alive=false,ownedProfileArgument=false;
    if(Number.isInteger(child.pid)&&!exitInfo&&!spawnError&&child.exitCode===null&&child.signalCode===null){try{const argv=readFileSync('/proc/'+child.pid+'/cmdline','utf8').split('\0');ownedProfileArgument=argv.includes('--user-data-dir='+profile)&&argv.includes('--remote-debugging-port=0');alive=ownedProfileArgument;}catch{}}
    return{pid:child.pid,alive,ownedProfileArgument,exitCode:child.exitCode,signalCode:child.signalCode,spawnError};
  };
  async function groupMembers(){const members=[];for(const p of await fs.readdir('/proc')){if(!/^\d+$/.test(p))continue;try{const raw=await fs.readFile('/proc/'+p+'/stat','utf8'),f=raw.slice(raw.lastIndexOf(')')+2).split(' ');if(Number(f[2])===child.pid)members.push({pid:Number(p),pgid:Number(f[2]),session:Number(f[3]),state:f[0]});}catch{}}return members;}
  async function until(fn,ms){const deadline=Date.now()+ms;for(;;){assert(!exitInfo&&!spawnError,'owned browser exited');if(await fn())return;assert(Date.now()<deadline,'owned browser deadline');await pause(100);}}
  function call(method,params={}){return new Promise((resolve,reject)=>{if(!report.endpointOwnership?.verified||!childState().alive){reject(Error('verified owned browser required'));return;}const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP deadline'));},5000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
  try{
    await until(async()=>{report.initialGroup=await groupMembers();return report.initialGroup.some(m=>m.pid===child.pid&&m.session===child.pid);},1000);
    await until(async()=>{
      assert(childState().alive,'owned profile unavailable');let stat,text;
      try{stat=await fs.lstat(profile+'/DevToolsActivePort');text=await fs.readFile(profile+'/DevToolsActivePort','utf8');}catch(e){if(e.code==='ENOENT')return false;throw e;}
      const evidence={...childState(),spawnedAt,activePortMtimeMs:stat.mtimeMs,activePortRegularFile:stat.isFile(),freshProfile:true},[port,browserPath]=text.trim().split('\n');
      const provisional=ownedBrowserEndpoint(text,{webSocketDebuggerUrl:'ws://127.0.0.1:'+port+browserPath},evidence);
      const response=await fetch('http://127.0.0.1:'+provisional.port+'/json/version',{signal:AbortSignal.timeout(2000)});
      if(!response.ok)return false;
      report.endpointOwnership={...ownedBrowserEndpoint(text,await response.json(),{...evidence,...childState()}),activePortText:text};return true;
    },15000);
    const targets=await(await fetch('http://127.0.0.1:'+report.endpointOwnership.port+'/json/list',{signal:AbortSignal.timeout(2000)})).json();
    ws=new WebSocket(ownedPageEndpoint(targets.find(t=>t.type==='page'),report.endpointOwnership));
    ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('socket startup deadline')),5000);ws.onopen=()=>{clearTimeout(timer);resolve();};ws.onerror=()=>{clearTimeout(timer);reject(Error('socket error'));};});
    const result=await call('Runtime.evaluate',{expression:'navigator.hardwareConcurrency',returnByValue:true});
    assert(!result.exceptionDetails,'browser CPU evaluation failed');
    report.affinity=await saveBrowserAffinityEvidence(affinity,child.pid,result.result.value,out);
    // Read the real browser again with a deliberately wrong admission plan.
    // This changes no affinity or browser value and must retain a failed file.
    const allowed = expandCpuList(affinity.runnerCpuList);
    const wrongCount = affinity.hostNproc > 1 ? affinity.hostNproc - 1 : Math.min(2, allowed.length);
    if (wrongCount !== affinity.hostNproc) {
      const wrongPlan = browserAffinityPlan(wrongCount, affinity.runnerCpuList, affinity.runnerCgroup);
      await assert.rejects(saveBrowserAffinityEvidence(wrongPlan,child.pid,result.result.value,out,'deliberately-wrong'), /CPU affinity mismatch/);
      report.rejectedAffinity = JSON.parse(await fs.readFile(out+'/deliberately-wrong-affinity.json','utf8'));
      assert(Object.values(report.rejectedAffinity.checks).includes(false));
      report.negativeAdmissionRetained = true;
    }
    const final=await call('Runtime.evaluate',{expression:'navigator.hardwareConcurrency',returnByValue:true});
    report.finalAffinity=await saveBrowserAffinityEvidence(affinity,child.pid,final.result.value,out,'browser-final');
    closing=true;await call('Browser.close');report.pass=true;
  }catch(e){report.error=String(e.stack||e);}
  finally{
    if(!closing&&ws?.readyState===1&&childState().alive){try{await call('Browser.close');}catch{}}
    for(const p of pending.values())clearTimeout(p.timer);ws?.close();await Promise.race([exited,pause(8000)]);
    const members=await groupMembers();
    if(members.length&&report.initialGroup?.some(m=>m.pid===child.pid&&m.session===child.pid)){
      try{process.kill(-child.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')report.cleanupError=String(e);}
      await pause(1000);
      if((await groupMembers()).some(m=>m.state!=='Z')){try{process.kill(-child.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')report.cleanupError=String(e);}await pause(1000);}
      report.forcedTermination=true;report.pass=false;
    }
    report.browserExit=exitInfo;report.remainingGroup=await groupMembers();report.ownedGroupEmpty=report.remainingGroup.length===0;
    if(exitInfo?.code!==0||!report.ownedGroupEmpty||report.cleanupError)report.pass=false;
  }
}
for(const[p,h]of Object.entries(inputs))if(createHash('sha256').update(await fs.readFile(p)).digest('hex')!==h){report.pass=false;report.changedInput=p;}
await fs.writeFile(out+'/result.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({pass:report.pass,mode,checks:report.checks.length,hostCpus:report.affinity?.hostNproc,error:report.error,out}));
if(!report.pass)process.exitCode=1;
