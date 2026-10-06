// Preparation only until the caller explicitly runs the returned browser owner.
// Derivative of the proved frozen browser-session with reviewed root rebind fixes.
import fs from 'node:fs/promises';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
export const gpuSeedPath='/__seed.html';
export function checkedGpuNavigation(result,label) {
  if(!result||typeof result!=='object'||Array.isArray(result)||typeof result.frameId!=='string'||!result.frameId||
    result.isDownload===true||(result.errorText!==undefined&&result.errorText!==''))
    throw Error('owned '+label+' navigation rejected: '+JSON.stringify(result));
  return result;
}
export function scanOwnedGpuGroup(owned,seen=new Map()) {
  if(!Number.isInteger(owned.pid)||owned.pid<1||owned.pgid!==owned.pid||owned.sid!==owned.pid||
    !/^[1-9][0-9]*$/.test(owned.startTicks??''))throw Error('browser group identity unavailable before cleanup');
  const rows=[];
  for(const name of readdirSync('/proc')) {
    if(!/^\d+$/.test(name))continue;
    let fields;
    try{const raw=readFileSync('/proc/'+name+'/stat','utf8');fields=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/);}
    catch(error){if(['ENOENT','ESRCH'].includes(error.code))continue;throw error;}
    const pid=Number(name),startTicks=fields[19],pgid=Number(fields[2]),sid=Number(fields[3]);
    if(pid===owned.pid&&(startTicks!==owned.startTicks||pgid!==owned.pgid||sid!==owned.sid))
      throw Error('browser group identity changed before cleanup');
    if(pgid!==owned.pgid)continue;
    if(sid!==owned.sid||BigInt(startTicks)<BigInt(owned.startTicks)||
      (seen.has(pid)&&seen.get(pid)!==startTicks))throw Error('browser group identity changed before cleanup');
    seen.set(pid,startTicks);
    let status;
    try{status=readFileSync('/proc/'+name+'/status','utf8');}
    catch(error){if(['ENOENT','ESRCH'].includes(error.code))continue;throw error;}
    rows.push({pid,state:fields[0],rssKiB:Number(/^VmRSS:\s*(\d+)/m.exec(status)?.[1]??0),startTicks,pgid,sid});
    if(rows.length>1024)throw Error('bounded owned browser group exceeded');
  }
  return rows;
}
export function signalOwnedGpuGroup(owned,signal,seen=new Map()) {
  const group=scanOwnedGpuGroup(owned,seen);
  if(group.length)try{process.kill(-owned.pgid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}
  return group;
}
export async function drainOwnedGpuGroup(owned,{isReaped,timeoutMs,seen=new Map()}) {
  if(typeof isReaped!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<0||timeoutMs>4000)
    throw Error('bounded owned browser drain required');
  const startedAt=Date.now(),deadlineAt=startedAt+timeoutMs;let probes=0,group;
  do {
    group=scanOwnedGpuGroup(owned,seen);probes++;
    if(isReaped()&&group.length===0)return {pass:true,leaderReaped:true,group,probes,startedAt,deadlineAt,elapsedMs:Date.now()-startedAt};
    const remaining=deadlineAt-Date.now();if(remaining<=0)break;
    await new Promise(resolve=>setTimeout(resolve,Math.min(50,remaining)));
  }while(Date.now()<=deadlineAt);
  return {pass:false,leaderReaped:isReaped(),group,probes,startedAt,deadlineAt,elapsedMs:Date.now()-startedAt};
}
export async function reboundGpuOwner(root) {
  if(typeof root!=='string'||!root.startsWith('/mnt/p3/codex-build/')||path.resolve(root)!==root)throw Error('canonical p3 task root required');
  const ownerPath=repo+'web/linux/tests/guest-vulkan-wgpu/browser-session.mjs';
  const original=await fs.readFile(ownerPath,'utf8');
  let owner=original;
const replacements = [
  ["export const TASK='/mnt/p6/project/build/guest-vulkan-wgpu-20261003';", `export const TASK=${JSON.stringify(root)};`],
  ["const repo=path.resolve(import.meta.dirname,'../../../..');", `const repo=${JSON.stringify(repo.replace(/\/$/, ''))};`],
  ["'../../../../tools/guest-rootfs/firefox-browser-affinity.mjs'", JSON.stringify(pathToFileURL(repo + 'tools/guest-rootfs/firefox-browser-affinity.mjs').href)],
  ["'../../../../tools/guest-rootfs/check-firefox-nightly-benchmark.mjs'", JSON.stringify(pathToFileURL(repo + 'tools/guest-rootfs/check-firefox-nightly-benchmark.mjs').href)],
  ["import {openSync, closeSync, readFileSync} from 'node:fs';", "import {openSync, closeSync, readFileSync, readdirSync, lstatSync} from 'node:fs';"],
  ["export async function runBrowser({out,mode='hardware',routes=new Map(),page='/probe.html',timeoutMs=180000,run}) {", `
${checkedGpuNavigation.toString()}
${scanOwnedGpuGroup.toString()}
${signalOwnedGpuGroup.toString()}
${drainOwnedGpuGroup.toString()}
function taskByteCount(out){
  const ephemeral=[out+'/cache/',out+'/profile/',out+'/xdg/',TASK+'/t/.org.chromium.Chromium.'];
  let bytes=0;const pending=[TASK];
  while(pending.length){const name=pending.pop();
    try{const s=lstatSync(name);bytes+=s.size;if(s.isDirectory())for(const child of readdirSync(name))pending.push(name+'/'+child);}
    catch(e){if(e.code==='ENOENT'&&ephemeral.some(prefix=>name.startsWith(prefix)))continue;throw e;}
  }
  return bytes;
}
export async function runBrowser({out,mode='hardware',routes=new Map(),page='/probe.html',timeoutMs=180000,run}) {`],
  ["Number(execFileSync('du',['-sb',TASK],{encoding:'utf8'}).split(/\\s/)[0])", "taskByteCount(out)"],
  // This host assigns headless Chromium a different CPU quota. Both arms use
  // headed execution and still independently verify their actual quotas.
  ["['--headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']", "['--use-angle=swiftshader','--enable-unsafe-swiftshader']"],
  ["if(child.pid)await fs.writeFile('/proc/'+child.pid+'/oom_score_adj','1000');", "// Post-spawn setup belongs inside the cleanup-protected block below."],
  ["let exitInfo,spawnError,browser,pageSocket,guardRunning=false,guardError,peakRssKiB=0;", "let ownedStart='0';const ownedGroupSeen=new Map(); let exitInfo,spawnError,browser,pageSocket,guardRunning=false,guardError,peakRssKiB=0;"],
  ["let text,stat,version;const deadline=Date.now()+20000;", `
  if(!child.pid)throw Error('owned browser spawn failed');
  const ownedStat=readFileSync('/proc/'+child.pid+'/stat','utf8');
  const ownedFields=ownedStat.slice(ownedStat.lastIndexOf(')')+2).trim().split(/\\s+/);
  ownedStart=ownedFields[19];
  if(Number(ownedFields[2])!==child.pid||Number(ownedFields[3])!==child.pid)throw Error('owned browser session identity');
  await fs.writeFile('/proc/'+child.pid+'/oom_score_adj','1000');
  await fs.writeFile(out+'/owned-process.json',JSON.stringify({pid:child.pid,pgid:child.pid,sid:child.pid,startTicks:ownedStart})+'\\n');
  let text,stat,version;const deadline=Date.now()+20000;`],
  ["const terminate=signal=>{try{process.kill(-child.pid,signal);}catch(e){if(e.code!=='ESRCH')throw e;}};", `
  const terminate=signal=>{
    signalOwnedGpuGroup({pid:child.pid,pgid:child.pid,sid:child.pid,startTicks:ownedStart},signal,ownedGroupSeen);
  };`],
];
const originalSocket=original.slice(original.indexOf('async function socket('),original.indexOf('export async function runBrowser('));
const recordedSocket=String.raw`async function socket(url,live,deadlineAt,transcriptFile) {
  const ws=new WebSocket(url),pending=new Map(),events=[];let seq=0,writes=Promise.resolve(),entries=0;
  const record=entry=>{if(++entries>8192)throw Error('bounded CDP transcript exceeded');
    writes=writes.then(()=>fs.appendFile(transcriptFile,JSON.stringify({at:Date.now(),...entry})+'\n'));return writes;};
  const failPending=reason=>{for(const [id,p]of pending){clearTimeout(p.timer);record({id,status:'closed',method:p.method,expressionSha256:p.expressionSha256}).catch(()=>{});p.reject(Error(reason));}pending.clear();};
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP connect timeout')),Math.max(1,Math.min(5000,deadlineAt-Date.now())));ws.onopen=()=>{clearTimeout(timer);resolve();};ws.onerror=()=>{clearTimeout(timer);reject(Error('CDP connect failure'));};});
  ws.onclose=()=>failPending('owned CDP socket closed');
  ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);
    record({id:r.id,status:r.error?'error':'ok',method:p.method,expressionSha256:p.expressionSha256,error:r.error??null}).then(()=>r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result)).catch(p.reject);
  }else{if(events.length<2048)events.push(r);if(r.method==='Target.attachedToTarget')ws.send(JSON.stringify({id:++seq,method:'Runtime.enable',params:{},sessionId:r.params.sessionId}));}};
  return {events,call(method,params={}){
    if(!live()||Date.now()>=deadlineAt)return Promise.reject(Error('owned CDP lifetime/deadline ended: '+method));
    return new Promise((resolve,reject)=>{const id=++seq,expressionSha256=typeof params.expression==='string'?sha(params.expression):null;
      const timer=setTimeout(()=>{pending.delete(id);record({id,status:'timeout',method,expressionSha256}).then(()=>reject(Error('CDP timeout '+method+' expressionSha256='+expressionSha256))).catch(reject);},Math.max(1,Math.min(30000,deadlineAt-Date.now())));
      pending.set(id,{resolve,reject,timer,method,expressionSha256});
      record({id,status:'issued',method,expressionSha256,paramsSha256:sha(JSON.stringify(params))}).then(()=>ws.send(JSON.stringify({id,method,params}))).catch(error=>{pending.delete(id);clearTimeout(timer);reject(error);});
    });
  },async close(){failPending('owned CDP closed');ws.close();await writes;}};
}
`;
replacements.push(
  [originalSocket,recordedSocket],
  ["socket(endpoint.browserWebSocketURL,()=>state().alive)", "socket(endpoint.browserWebSocketURL,()=>state().alive,spawnedAt+timeoutMs,out+'/cdp-browser.ndjson')"],
  ["socket(ownedPageEndpoint(target,endpoint),()=>state().alive)", "socket(ownedPageEndpoint(target,endpoint),()=>state().alive,spawnedAt+timeoutMs,out+'/cdp-page.ndjson')"],
  ["pageSocket?.close();browser?.close();", "for(const channel of [pageSocket,browser]){try{await channel?.close();}catch(e){report.pass=false;report.cdpTranscriptError=String(e);}}"],
  ["await Promise.race([exited,sleep(4000)]);", "report.naturalGroupDrain=await drainOwnedGpuGroup({pid:child.pid,pgid:child.pid,sid:child.pid,startTicks:ownedStart},{isReaped:()=>exitInfo!==undefined||spawnError!==undefined,timeoutMs:4000,seen:ownedGroupSeen});if(!report.naturalGroupDrain.pass)report.pass=false;"],
  ["let group=await members(child.pid);if(group.some(p=>p.state!=='Z')){terminate('SIGTERM');await Promise.race([exited,sleep(3000)]);group=await members(child.pid);if(group.some(p=>p.state!=='Z')){terminate('SIGKILL');await Promise.race([exited,sleep(3000)]);}report.forcedTermination=true;report.pass=false;}\n    report.remainingGroup=await members(child.pid);", `let group=report.naturalGroupDrain.group;
    if(group.some(p=>p.state!=='Z')){
      terminate('SIGTERM');report.termGroupDrain=await drainOwnedGpuGroup({pid:child.pid,pgid:child.pid,sid:child.pid,startTicks:ownedStart},{isReaped:()=>exitInfo!==undefined||spawnError!==undefined,timeoutMs:3000,seen:ownedGroupSeen});
      group=report.termGroupDrain.group;
      if(group.some(p=>p.state!=='Z')){terminate('SIGKILL');report.killGroupDrain=await drainOwnedGpuGroup({pid:child.pid,pgid:child.pid,sid:child.pid,startTicks:ownedStart},{isReaped:()=>exitInfo!==undefined||spawnError!==undefined,timeoutMs:3000,seen:ownedGroupSeen});}
      report.forcedTermination=true;report.pass=false;
    }
    report.remainingGroup=scanOwnedGpuGroup({pid:child.pid,pgid:child.pid,sid:child.pid,startTicks:ownedStart},ownedGroupSeen);`],
  ["return {pid:child.pid,alive,ownedProfileArgument,exitCode:child.exitCode,signalCode:child.signalCode,spawnError};", "if(alive){try{const raw=readFileSync('/proc/'+child.pid+'/stat','utf8'),a=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\\s+/);alive=a[19]===ownedStart&&Number(a[2])===child.pid&&Number(a[3])===child.pid;}catch{alive=false;}}return {pid:child.pid,alive,ownedProfileArgument,exitCode:child.exitCode,signalCode:child.signalCode,spawnError};"],
  ["rss*1024>4*1024**3||available<2*1024**3||taskBytes>3*1024**3", "rss*1024>8*1024**3||process.memoryUsage().rss>2*1024**3||available<4*1024**3||taskBytes>8*1024**3"],
  ["rssBytes:4*1024**3,availableRamFloorBytes:2*1024**3,taskDiskCapBytes:3*1024**3", "rssBytes:8*1024**3,ownerRssBytes:2*1024**3,availableRamFloorBytes:4*1024**3,taskDiskCapBytes:8*1024**3"],
  ["timeoutMs=180000,run}) {", "timeoutMs=180000,beforeNavigate,run}) {"],
  ["await pageSocket.call('Page.navigate',{url:origin+page});", `if(beforeNavigate){
    const policy=await browser.call('Browser.setDownloadBehavior',{behavior:'deny',eventsEnabled:true});
    await fs.writeFile(out+'/download-policy.json',JSON.stringify({behavior:'deny',eventsEnabled:true,response:policy,at:Date.now()})+'\\n');
    const seedNavigation=await pageSocket.call('Page.navigate',{url:origin+${JSON.stringify(gpuSeedPath)}});
    await fs.writeFile(out+'/seed-navigation.json',JSON.stringify(seedNavigation)+'\\n');
    checkedGpuNavigation(seedNavigation,'seed');
    await beforeNavigate({evaluate,call:pageSocket.call.bind(pageSocket),affinity,origin,spawnedAt,deadlineAt:spawnedAt+timeoutMs});
  }
  const guestNavigation=await pageSocket.call('Page.navigate',{url:origin+page});
  await fs.writeFile(out+'/guest-navigation.json',JSON.stringify(guestNavigation)+'\\n');
  checkedGpuNavigation(guestNavigation,'guest');`],
  ["run({evaluate,call:pageSocket.call.bind(pageSocket),affinity,origin})", "run({evaluate,call:pageSocket.call.bind(pageSocket),affinity,origin,spawnedAt,deadlineAt:spawnedAt+timeoutMs})"],
  ["await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});", "try { await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});"],
  ["  return report;\n}", "  return report;\n} finally {server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));}\n}"],
);
for(const [before,after]of replacements) {
 if(owner.split(before).length!==2)throw Error('browser rebind anchor changed: '+before.slice(0,96));
 owner=owner.replace(before,after);
}
return {source:owner,provenance:{originalPath:ownerPath,originalSha256:sha(original),reboundSha256:sha(owner),adoptedRootFixes:'tools/guest-rootfs/run-shared-rust-gpu.mjs',replacements,frozenFilesChanged:false}};
}
export async function prepareOwnedGpuBrowser(root) {
 const rebound=await reboundGpuOwner(root);
 await fs.writeFile(root+'/owner-original.mjs',await fs.readFile(rebound.provenance.originalPath));
 await fs.writeFile(root+'/owner.mjs',rebound.source);
 await fs.writeFile(root+'/owner-rebind.json',JSON.stringify(rebound.provenance,null,2)+'\n');
 return import(pathToFileURL(root+'/owner.mjs').href);
}
