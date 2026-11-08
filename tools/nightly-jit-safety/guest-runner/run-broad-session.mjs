// Proposal producer: --prepare is host-only; --run requires actual pinned
// postlink inputs and an independently reviewed finite supervisor launch.
import fs from 'node:fs/promises';
import { openSync,closeSync,readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { spawn,execFileSync } from 'node:child_process';
import { PREPARATION_TASK,RUNTIME_CAP,taskRoot,repoRoot,loadFrameObserver,allocationContract,LIMIT,sha,require,pinFile,pinnedJSON,patchInit,bindingContract,parentChecks,completeCapture,completedSession,exactFirefoxExit } from './contracts.mjs';
import { readHostNproc,selectHostCpus,guestCpuStateExpression,guestCpuPrebootStateExpression,saveGuestCpuEvidence,saveHostCpuPhaseEvidence } from './guest-rootfs/firefox-host-cpus.mjs';
import { prepareBrowserAffinity,browserLaunchCommand,saveBrowserAffinityEvidence } from './guest-rootfs/firefox-browser-affinity.mjs';
import { pinOwnedGroup,drainOwnedGroup,groupSnapshot,parseProcStat } from './guest-rootfs/benchmark-process-group.mjs';
import { ownedBrowserEndpoint,ownedPageEndpoint,fatalLines } from './guest-rootfs/check-firefox-nightly-benchmark.mjs';
import {scopedPath} from '../owned-paths.mjs';
const here=path.dirname(fileURLToPath(import.meta.url)),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const writeJSON=(filename,value)=>fs.writeFile(filename,JSON.stringify(value,null,2)+'\n');
function consoleExpression(label) {
  const base='/home/admin/nightly-jit-safety/'+label+'/',alias='njs-'+label.toLowerCase();
  return '(async()=>{const r=Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler),a='+JSON.stringify(alias)+';if(r.hasSubstitution(a))throw Error("owned resource alias exists");r.setSubstitution(a,Services.io.newURI('+JSON.stringify('file://'+base)+'));try{return await ChromeUtils.importESModule('+JSON.stringify('resource://'+alias+'/runner-entry.sys.mjs')+').run('+JSON.stringify(base+'session.json')+')}finally{r.setSubstitution(a,null)}})();';
}
export function options(argv) {
  const result={};require(argv.length%2===0,'explicit option/value pairs required');
  for(let i=0;i<argv.length;i+=2){const name=argv[i];require(/^--[a-z][a-z0-9-]*$/.test(name)&&!Object.hasOwn(result,name),'invalid/duplicate option');result[name]=argv[i+1];}
  return result;
}
async function scopedFresh(out,TASK) {await scopedPath(TASK,out,{fresh:true});}
export async function storageCheck(TASK,cap=256*1024**2) {
  const usage=Number(execFileSync('du',['-sb',TASK],{encoding:'utf8',timeout:10000}).split(/\s+/)[0]),disk=await fs.statfs(TASK);
  require(Number.isSafeInteger(usage)&&usage<cap&&disk.bavail*disk.bsize>=20*1024**3,'actual task cap/20GiB reserve required');
  require(![0x01021994,0x858458f6].includes(disk.type),'disk-backed task required');
  return {usage,freeBytes:disk.bavail*disk.bsize};
}
export async function prepare(args) {
  require(Object.keys(args).every(name=>['--task-root','--out','--label','--arm','--binding','--binding-sha256'].includes(name)),'unknown preparation option');
  require(['disabled','enabled'].includes(args['--arm'])&&/^[A-Za-z0-9_-]{1,64}$/.test(args['--label']||''),'arm/owned label required');
  const TASK=await taskRoot(args),out=args['--out'];await scopedFresh(out,TASK);await storageCheck(TASK);
  const command=['python3',here+'/safety/prepare-session.py','--task-root',TASK,'--out',out,'--label',args['--label'],'--arm',args['--arm']];
  if(args['--binding']){bindingContract(await pinnedJSON({path:args['--binding'],sha256:args['--binding-sha256']}));command.push('--build-binding',args['--binding']);}
  execFileSync(command[0],command.slice(1),{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:45000});
  await fs.copyFile(here+'/runner-entry.sys.mjs',out+'/runner-entry.sys.mjs');
  const contract=JSON.parse(await fs.readFile(out+'/session.json'));
  contract.files['runner-entry.sys.mjs']=sha(await fs.readFile(out+'/runner-entry.sys.mjs'));
  await writeJSON(out+'/session.json',contract);
  await fs.writeFile(out+'/browser-console-expression.txt',consoleExpression(contract.label)+'\n');
  return {kind:'broad-session-preparation-v1',pass:false,preparationComplete:true,status:contract.status,out,guestAcceptance:false,browserStarted:false};
}
export async function preflight(args) {
  require(Object.keys(args).every(name=>['--task-root','--repo','--launch','--launch-sha256','--implementation','--implementation-sha256','--prelaunch-review','--prelaunch-review-sha256','--arm','--out'].includes(name)),'unknown runner option');
  require(['disabled','enabled'].includes(args['--arm']),'explicit arm required');
  const TASK=await taskRoot(args),repo=await repoRoot(args);require(TASK!==PREPARATION_TASK,'runtime requires a separate admitted4GiB task root');
  const inputs=[],retain=async record=>{const row=await pinFile(record);inputs.push(row);return row;};
  const launch=await pinnedJSON({path:args['--launch'],sha256:args['--launch-sha256']});
  require(launch.kind==='caller-reviewed-nightly-broad-runner-launch-v1'&&launch.pass===true&&launch.repo===repo&&launch.task===TASK&&launch.sameBinaryRuntimeArms===true,'actual reviewed launch contract required');
  const implementation=await pinnedJSON({path:args['--implementation'],sha256:args['--implementation-sha256']});
  require(implementation.kind==='nightly-broad-runner-implementation-v1'&&implementation.implementationRoot===here,'executing implementation differs');
  for(const record of implementation.files)await retain(record);
  const windowObserver=implementation.windowObserver;require(windowObserver?.installMode===0o755&&implementation.files.some(row=>row.path===windowObserver.path&&row.sha256===windowObserver.sha256),'task-only X11 observer pin/install mode required');await retain(windowObserver);
  const frameObserver=implementation.frameObserver;require(frameObserver?.kind==='existing-owned-worker-stall-frames-v1'&&implementation.files.some(row=>row.path===frameObserver.path&&row.sha256===frameObserver.sha256),'task-only frame observer pin required');await retain(frameObserver);
  const startupConfig=implementation.startupConfig;require(startupConfig?.kind==='standard-nightly-autoconfig-startup-v1','task-only AutoConfig binding required');for(const key of ['defaults','config']){const record=startupConfig[key];require(record&&implementation.files.some(row=>row.path===record.path&&row.sha256===record.sha256),'task-only AutoConfig source pin required');await retain(record);}
  for(const name of ['run-broad-session.mjs','contracts.mjs','runner-entry.sys.mjs','capture-launch.sh','supervise-broad-session.py','evaluate-capture.py','safety/prepare-session.py','safety/generate.mjs','safety/cases.mjs','safety/cases-broad.mjs','safety/check-session.py','safety/check-privileged.py','safety/check.py','safety/guest-entry.sys.mjs','safety/guest-content.sys.mjs','safety/privileged-driver.js','safety/NightlyJitSafetyChild.sys.mjs','safety/NightlyJitSafetyParent.sys.mjs','guest-rootfs/firefox-host-cpus.mjs','guest-rootfs/firefox-browser-affinity.mjs','guest-rootfs/benchmark-process-group.mjs','guest-rootfs/check-firefox-nightly-benchmark.mjs','guest-rootfs/benchmark-diagnostics.sys.mjs'])require(implementation.files.some(row=>row.path===here+'/'+name),'missing executing implementation pin: '+name);
  for(const name of ['owned-paths.mjs','owned_paths.py'])require(implementation.files.some(row=>row.path===path.resolve(here,'..',name)),'missing executing owned-path policy pin: '+name);
  const review=await pinnedJSON({path:args['--prelaunch-review'],sha256:args['--prelaunch-review-sha256']});
  require(review.kind==='caller-reviewed-nightly-broad-runner-prelaunch-v1'&&review.pass===true&&review.launchSHA256===args['--launch-sha256']&&review.implementationSHA256===args['--implementation-sha256']&&review.noActiveOwnedBuild===true&&review.freshFinalLinkTerminalReapedEmpty===true,'actual independent postlink/resource launch review required');
  const binding=await pinnedJSON(launch.buildBinding);bindingContract(binding);await retain(launch.buildBinding);
  for(const record of [{path:args['--launch'],sha256:args['--launch-sha256']},{path:args['--implementation'],sha256:args['--implementation-sha256']},{path:args['--prelaunch-review'],sha256:args['--prelaunch-review-sha256']}])await retain(record);
  const roles={binary:'finalBinarySHA256',archive:'archiveSHA256',manifest:'runtimeManifestSHA256',kernel:'kernelSHA256',buildReview:'buildReviewSHA256'};
  for(const [name,key]of Object.entries(roles)){require(launch[name]?.sha256===binding[key],'actual binding differs: '+name);await retain(launch[name]);}
  for(const key of ['observerPblSha256','observerInterpreterSha256','optionObserverWorkerSha256','optionObserverStartupSha256']){require(launch.observerFiles?.[key]?.sha256===binding[key],'actual observer source binding missing');await retain(launch.observerFiles[key]);}
  const manifest=await pinnedJSON(launch.manifest);
  require(manifest.assets?.firefox?.sha256===binding.archiveSHA256&&manifest.assets.firefox.bytes===(await fs.stat(launch.archive.path)).size&&manifest.assets?.kernel?.sha256===binding.kernelSHA256,'actual candidate manifest differs');
  const adoption=await pinnedJSON(launch.captureAdoptionReview);await retain(launch.captureAdoptionReview);await retain(launch.sourceInit);await retain(launch.candidateInit);
  require(adoption.kind==='caller-reviewed-broad-capture-package-adoption-v1'&&adoption.pass===true&&adoption.actualArchiveSHA256===binding.archiveSHA256&&adoption.actualInitMemberSHA256===launch.candidateInit.sha256&&adoption.finalBinarySHA256===binding.finalBinarySHA256&&adoption.nativeBinaryUnchanged===true,'capture init not bound to actual archive member');
  require(patchInit(await fs.readFile(launch.sourceInit.path,'utf8'))===await fs.readFile(launch.candidateInit.path,'utf8'),'actual init is not the exact capture launch patch');
  await retain(launch.profilePrefs);
  require((await fs.stat(launch.profilePrefs.path)).size<65536,'base profile prefs bound');
  const sessions={};
  for(const arm of ['disabled','enabled']){
    const session=await pinnedJSON(launch.sessions?.[arm]);await retain(launch.sessions[arm]);require(session.buildIdentityBound===true&&session.portableBaseline===(arm==='enabled')&&session.buildBindingSHA256===launch.buildBinding.sha256&&JSON.stringify(session.buildBinding)===JSON.stringify(binding),'prepared arm uses different full binary');
    require(session.outerWallDeadlineSeconds===150&&session.scopeWallDeadlineSeconds===30&&session.observerLimitBytes===LIMIT&&JSON.stringify(session.fixtureClaims)===JSON.stringify({compiled:14,bailout:7,excluded:2,'policy-excluded':2}),'session policy weakened');
    require(/^[A-Za-z0-9_-]{1,64}$/.test(session.label)&&session.fixtureContract?.cases?.length===50,'actual broad session inventory missing');
    const dir=path.dirname(launch.sessions[arm].path);
    for(const [name,hash]of Object.entries({...session.files,...session.fixtureContract.files})){
      require(path.basename(name)===name&&name!=='.'&&name!=='..','unsafe session source');await retain({path:dir+'/'+name,sha256:hash});
      if(Object.hasOwn(session.files,name))require(sha(await fs.readFile(here+(name==='runner-entry.sys.mjs'?'/':'/safety/')+name))===hash,'prepared executing guest source differs');
    }
    sessions[arm]=session;
  }
  require(sessions.disabled.label!==sessions.enabled.label,'fresh distinct arm labels required');
  require(Array.isArray(launch.runtimeFiles)&&launch.runtimeFiles.length>0,'actual runtime file inventory required');
  const routes={};for(const record of launch.runtimeFiles){require(/^\/linux\/[A-Za-z0-9_./@-]+$/.test(record.route)&&!record.route.split('/').includes('..')&&!routes[record.route],'unique owned runtime route required');await retain(record);routes[record.route]=record.path;}
  for(const route of ['/linux/index.html','/linux/main.js','/linux/persistent-home.mjs','/linux/boot-assets.mjs','/linux/worker.js','/linux/vmlinux.wasm','/linux/initramfs.cpio'])require(routes[route],'unbound core runtime route '+route);
  require(routes['/linux/vmlinux.wasm']===launch.kernel.path,'served actual kernel differs');
  require(launch.runtimeFiles.some(row=>row.route==='/linux/initramfs.cpio'&&row.sha256===manifest.assets?.plain?.sha256),'served actual plain package differs from candidate manifest');
  await retain(launch.serverSource);require(launch.serverSource.path===repo+'/web/desktop/dev-server.mjs','existing dev server source required');
  const out=args['--out'];await scopedFresh(out,TASK);const storage=await storageCheck(TASK,RUNTIME_CAP),allocation=allocationContract(launch,manifest,storage.usage);
  for(const [key,record]of [['firefox',launch.archive],['kernel',launch.kernel],['plain',launch.runtimeFiles.find(row=>row.route==='/linux/initramfs.cpio')]])require(manifest.assets[key].bytes===(await fs.stat(record.path)).size,'current actual package size differs: '+key);
  for(const record of [launch.binary,launch.archive,launch.kernel,launch.runtimeFiles.find(row=>row.route==='/linux/initramfs.cpio')])require(!record.path.startsWith(TASK+'/'),'large package inputs must stay outside runtime task; no package copy');
  for(const name of ['TMPDIR','TMP','TEMP'])require(await fs.realpath(process.env[name])===TASK+'/t','task-owned disk scratch required');
  const seal=process.env.NIGHTLY_BROAD_SUPERVISOR;
  require(seal===String(process.ppid)&&/^Max address space\s+2199023255552\s+2199023255552\s+bytes[ \t]*$/m.test(readFileSync('/proc/self/limits','utf8'))&&/^Max core file size\s+0\s+0\s+bytes[ \t]*$/m.test(readFileSync('/proc/self/limits','utf8'))&&readFileSync('/proc/self/oom_score_adj','utf8').trim()==='1000','reviewed finite supervisor/inherited actual limits required');
  const supervisorArgv=readFileSync('/proc/'+process.ppid+'/cmdline','utf8').split('\0');require(supervisorArgv.includes(here+'/supervise-broad-session.py')&&supervisorArgv.includes('--run'),'actual exact supervisor parent required');
  // Recheck actual build processes; a stale review cannot permit a live compiler.
  require(Array.isArray(launch.ownedBuildRoots)&&launch.ownedBuildRoots.length>=1,'owned fresh build roots required');
  const active=[];for(const line of execFileSync('ps',['-eo','pid,args'],{encoding:'utf8'}).split('\n')){const m=/^\s*(\d+)\s+(.+)$/.exec(line);if(!m||!/(?:^|[\s/])(?:clang(?:\+\+)?(?:-\d+)?|rustc|cargo|ninja|make|mach)(?:[\s.]|$)|build-full/.test(m[2]))continue;let cwd;try{cwd=await fs.realpath('/proc/'+m[1]+'/cwd');}catch{continue;}if(launch.ownedBuildRoots.some(root=>cwd===root||cwd.startsWith(root+'/')||m[2].includes(root)))active.push({pid:Number(m[1]),cwd,argv:m[2]});}
  require(!active.length,'actual owned build still live; no browser launch');
  return {launch,binding,session:sessions[args['--arm']],manifest,routes,inputs,out,review,TASK,repo,allocation,windowObserver,frameObserver,startupConfig};
}
function homeFunction(operation,argument) {
  return `(async()=>{const h=await(await import('/linux/persistent-home.mjs')).openPersistentHome();try{${operation}}finally{await h.destroy();}})()`;
}
export const readHomeExpression=filename=>homeFunction(`let n=h.root;for(const part of ${JSON.stringify(filename)}.split('/')){n=await h.lookup(n,part);if(!n)return null;}const a=await h.getattr(n);if(a.size>${LIMIT})throw Error('guest artifact exceeds cap');const handle=await h.open(n,0),bytes=await h.read(n,handle,0n,Number(a.size));await h.release(n,handle);if(bytes.length!==Number(a.size))throw Error('short guest artifact');let text='';for(let at=0;at<bytes.length;at+=8192)text+=String.fromCharCode(...bytes.subarray(at,at+8192));return {bytes:bytes.length,base64:btoa(text)};`);
export const installHomeExpression=files=>homeFunction(`async function dir(p){let n=h.root;for(const part of p.split('/'))n=await h.lookup(n,part)||await h.mkdir(n,part,{mode:0o755,uid:1000,gid:1000});return n;}for(const [filename,b64]of Object.entries(${JSON.stringify(files)})){const parts=filename.split('/'),name=parts.pop(),parent=await dir(parts.join('/'));if(await h.lookup(parent,name))throw Error('fresh installed file already exists');const f=await h.create(parent,name,2,{mode:filename==='admin/nightly-jit-safety/wait-firefox-window.wasm'?0o755:0o644,uid:1000,gid:1000});const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));if(await h.write(f.node,f.handle,0n,bytes)!==bytes.length)throw Error('short install');await h.release(f.node,f.handle);}return true;`);
export async function run(args) {
  const prepared=await preflight(args),{launch,binding,manifest,routes,inputs,out,TASK}=prepared,arm=args['--arm'];
  await fs.mkdir(out,{mode:0o700});await writeJSON(out+'/prelaunch.json',{...prepared,inputs});
  const rec={kind:'actual-nightly-broad-runner-capture-v1',arm,label:prepared.session.label,pass:false,fullJITAcceptance:false,guestAcceptance:false,gpuAcceptance:false,missingIndependentGates:['native callback stack/TLS/syscall probes','mutation guards','baseline/update/NSS/TLS/UI','eight-case ABBAAB and v10 performance']};
  let server,service,child,exited,exitInfo,ownedGroup,ws,verified=false,next=0,raw=Buffer.alloc(0),started,deadline,session,frameDiagnostics;
  const pending=new Map(),errors=[],artifacts={};
  const retained=async(role,name,bytes)=>{require(bytes.length<=LIMIT,'retained artifact cap: '+role);const filename=out+'/'+name;await fs.writeFile(filename,bytes);artifacts[role]={path:filename,sha256:sha(bytes)};return bytes;};
  const alive=()=>{try{return child&&child.exitCode===null&&child.signalCode===null&&readFileSync('/proc/'+child.pid+'/cmdline','utf8').split('\0').includes('--user-data-dir='+out+'/profile');}catch{return false;}};
  const remaining=limit=>{const ms=Math.min(limit,deadline-Date.now());require(ms>0,'outer150s timeout: failure, never cancellation');return ms;};
  const call=(method,params={},limit=10000,diagnostic=false,sessionId)=>new Promise((resolve,reject)=>{require(verified&&alive()&&ws?.readyState===1,'live owned CDP browser required');const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('actual CDP query timeout: '+method));},diagnostic?Math.min(limit,1000):remaining(limit));pending.set(id,{resolve,reject,timer,sessionId});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const ev=async(expression,limit,diagnostic=false)=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},limit,diagnostic);require(!result.exceptionDetails,'actual host page exception: '+JSON.stringify(result.exceptionDetails));return result.result.value;};
  const until=async(fn,limit,label)=>{const end=Date.now()+remaining(limit);for(;;){if(await fn())return;require(Date.now()<end,'actual '+label+' timeout: failure, never cancellation');await sleep(100);}};
  const homeRead=async (filename,diagnostic=false)=>{const row=await ev(readHomeExpression(filename),diagnostic?1000:undefined,diagnostic);if(row===null)return null;const bytes=Buffer.from(row.base64,'base64');require(bytes.length===row.bytes,'transport byte-span incomplete');return bytes;};
  const log=(diagnostic=false)=>ev(`(async()=>(await import('/linux/main.js')).guestLogs.history.page(undefined,5000).map(l=>l.text).join(String.fromCharCode(10)))()`,diagnostic?1000:undefined,diagnostic);
  const shot=async(name,diagnostic=false)=>{try{const row=await call('Page.captureScreenshot',{format:'png'},1000,diagnostic);await retained('screenshot:'+name,name+'.png',Buffer.from(row.data,'base64'));}catch(error){(rec.screenshotErrors??=[]).push({name,error:String(error)});}};
  try {
    const servedManifest=structuredClone(manifest);servedManifest.assets.firefox.url='./initramfs-firefox.cpio.gz';
    await writeJSON(out+'/served-manifest.json',servedManifest);routes['/linux/boot-manifest.json']=out+'/served-manifest.json';routes['/linux/initramfs-firefox.cpio.gz']=launch.archive.path;
    let serverSource=await fs.readFile(launch.serverSource.path,'utf8');require(serverSource.includes('server.listen(port,'),'existing server anchor changed');serverSource=serverSource.slice(0,serverSource.indexOf('server.listen(port,'));
    for(const [from,to]of [["const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));",'const root = '+JSON.stringify(prepared.repo)+';'],['const server = createServer',`export const requests=[],sockets=new Set();const routes=${JSON.stringify(routes)};\nconst server = createServer`],["const requestPath = request.url?.split('?')[0];","const requestPath = request.url?.split('?')[0];requests.push({at:Date.now(),path:requestPath,bound:!!routes[requestPath],expectedRefusal:['/dns','/tcp','/favicon.ico'].includes(requestPath)});"],["const target = safePath(request.url || '/');","const target = routes[requestPath];"],["const addresses = await dns.resolve4(name);","throw Error('owned broad session: DNS refused');"],["if (requestPath === '/tcp') { handleTcpWebSocket(request, socket, head); return; }","if (requestPath === '/tcp') { socket.destroy(); return; }"]]){require(serverSource.includes(from),'existing server adapter anchor changed: '+from);serverSource=serverSource.replaceAll(from,to);}
    serverSource+='\nserver.on("connection",socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));});export {server};\n';await fs.writeFile(out+'/server.mjs',serverSource);
    service=await import(pathToFileURL(out+'/server.mjs').href);server=service.server;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const origin='http://127.0.0.1:'+server.address().port;rec.origin=origin;
    await fs.mkdir(out+'/profile');const affinity=await prepareBrowserAffinity(out);
    const browserArgs=['--headless','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+out+'/profile','--disk-cache-dir='+out+'/cache','about:blank'];
    const command=browserLaunchCommand('/home/a/.local/archpkg/pacman/usr/lib/chromium/chromium',browserArgs,affinity);await writeJSON(out+'/command.json',command);
    const fd=openSync(out+'/browser.log','wx');started=Date.now();deadline=started+150000;child=spawn(command[0],command.slice(1),{detached:false,env:{...process.env,XDG_CACHE_HOME:out+'/xdg-cache'},stdio:['ignore',fd,fd]});closeSync(fd);
    exited=new Promise(resolve=>{child.once('exit',(code,signal)=>{exitInfo={code,signal};resolve();});child.once('error',error=>{exitInfo={error:String(error)};resolve();});});
    ownedGroup=await pinOwnedGroup(process.pid);
    await until(async()=>{if(await fs.realpath('/proc/'+child.pid+'/exe')!=='/home/a/.local/archpkg/pacman/usr/lib/chromium/chromium')return false;ownedGroup.observedBrowserExecutable=await fs.realpath('/proc/'+child.pid+'/exe');ownedGroup.observedBrowserArgv=await fs.readFile('/proc/'+child.pid+'/cmdline','utf8');const browserStat=parseProcStat(await fs.readFile('/proc/'+child.pid+'/stat','utf8'));require(browserStat.pid===child.pid&&browserStat.ppid===process.pid&&browserStat.pgid===ownedGroup.pgid&&browserStat.sid===ownedGroup.sid&&BigInt(browserStat.startTicks)>=BigInt(ownedGroup.leaderStartTicks)&&ownedGroup.observedBrowserArgv.split('\0').includes('--user-data-dir='+out+'/profile'),'actual private Chrome session/argv differs');ownedGroup.browserProcess=browserStat;return true;},2000,'actual Chrome ownership publication');
    await writeJSON(out+'/browser-group-owner.pending.json',ownedGroup);await fs.rename(out+'/browser-group-owner.pending.json',out+'/browser-group-owner.json');rec.browserOwner=ownedGroup;
    let active,version,port;
    await until(async()=>{require(alive(),'owned browser exited');const filename=out+'/profile/DevToolsActivePort';let stat;try{stat=await fs.lstat(filename);active=await fs.readFile(filename,'utf8');}catch(error){if(error.code==='ENOENT')return false;throw error;}const state={pid:child.pid,alive:alive(),ownedProfileArgument:true,exitCode:child.exitCode,signalCode:child.signalCode,spawnedAt:started,activePortMtimeMs:stat.mtimeMs,freshProfile:true,activePortRegularFile:stat.isFile()};const [number,browserPath]=active.trim().split('\n');const provisional=ownedBrowserEndpoint(active,{webSocketDebuggerUrl:'ws://127.0.0.1:'+number+browserPath},state);const response=await fetch('http://127.0.0.1:'+provisional.port+'/json/version',{signal:AbortSignal.timeout(2000)});version=await response.json();rec.endpoint=ownedBrowserEndpoint(active,version,state);port=rec.endpoint.port;return true;},20000,'owned endpoint');
    const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(2000)})).json();require(targets.filter(target=>target.type==='page').length===1,'one owned fresh page required');const target=targets.find(target=>target.type==='page');const pageURL=ownedPageEndpoint(target,rec.endpoint);
    require(await fs.readFile(out+'/profile/DevToolsActivePort','utf8')===active,'owned endpoint changed');await writeJSON(out+'/endpoint-ownership.json',{...rec.endpoint,target,version});verified=true;
    ws=new WebSocket(pageURL);ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const entry=pending.get(message.id);if(entry){pending.delete(message.id);clearTimeout(entry.timer);(message.sessionId||undefined)!==entry.sessionId?entry.reject(Error('CDP response worker session mismatch')):message.error?entry.reject(Error(JSON.stringify(message.error))):entry.resolve(message.result);}}else {frameDiagnostics?.handle(message);if(!message.sessionId&&message.method==='Runtime.exceptionThrown')errors.push(message.params);}};await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('owned websocket query timeout')),remaining(10000));ws.onopen=()=>{clearTimeout(timer);resolve();};ws.onerror=error=>{clearTimeout(timer);reject(error);};});
    const createStallFrameDiagnostics=await loadFrameObserver(prepared.frameObserver);
    frameDiagnostics=createStallFrameDiagnostics({filename:out+'/worker-stall-frames.jsonl',origin,pageTargetId:target.id,label:prepared.session.label,call,alive});await frameDiagnostics.start();
    await call('Page.enable');await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:origin+'/linux/boot-manifest.json'});await until(()=>ev("document.readyState==='complete'"),10000,'seed page');
    const browserHardwareConcurrency=await ev('navigator.hardwareConcurrency');rec.affinity=await saveBrowserAffinityEvidence(affinity,child.pid,browserHardwareConcurrency,out);rec.cpu=selectHostCpus(rec.affinity.hostNproc,browserHardwareConcurrency);
    session=structuredClone(prepared.session);session.requestedGuestCpus=rec.cpu.hostNproc;const base='admin/nightly-jit-safety/'+session.label+'/';
    const installed={};const encode=(name,bytes)=>{installed[name]=Buffer.from(bytes).toString('base64');};
    const sourceDir=path.dirname(launch.sessions[arm].path);
    for(const [name,hash]of Object.entries({...session.files,...session.fixtureContract.files})){const bytes=await fs.readFile(sourceDir+'/'+name);require(sha(bytes)===hash,'prepared fixture drift');encode(base+name,bytes);await retained('file:'+name,'installed-'+name,bytes);}
    for(const [key,name]of [['defaults','njs-autoconfig.js'],['config','njs-autoconfig.cfg']]){const bytes=await fs.readFile(prepared.startupConfig[key].path);encode('admin/nightly-jit-safety/'+name,bytes);await retained('acquisition-source:'+name,name,bytes);}
    encode(base+'session.json',JSON.stringify(session,null,2)+'\n');encode('admin/nightly-jit-safety/active-label',session.label+'\n');encode('admin/nightly-jit-safety/capture-launch.sh',await fs.readFile(here+'/capture-launch.sh'));
    const fragment='user_pref("javascript.options.portable_baseline",'+JSON.stringify(session.portableBaseline)+');\nuser_pref("devtools.chrome.enabled",true);\nuser_pref("devtools.console.stdout.chrome",true);\nuser_pref("devtools.console.stdout.content",true);\n';
    const prefs=(await fs.readFile(launch.profilePrefs.path,'utf8'))+'\n'+fragment+'\nuser_pref("webgl.disabled",true);\nuser_pref("dom.webgpu.enabled",false);\nuser_pref("browser.startup.page",0);\nuser_pref("browser.startup.homepage","about:blank");\nuser_pref("datareporting.policy.firstRunURL","");\n';encode('admin/.mozilla/firefox/http1-profile/user.js',prefs);
    await ev(`localStorage.removeItem('linuxonweb.system.active.v1');localStorage.setItem('linuxonweb.machine-settings.v1',JSON.stringify({resolution:'1280x720',cpus:${rec.cpu.hostNproc},ram:4096,backend:'canvas2d'}));true;`);
    await ev(installHomeExpression(installed));
    for(const [name,want]of Object.entries(installed)){const bytes=await homeRead(name);require(bytes&&bytes.equals(Buffer.from(want,'base64')),'actual preboot install differs: '+name);}
    await writeJSON(out+'/installed-beforeboot.json',Object.fromEntries(Object.entries(installed).map(([name,b64])=>[name,sha(Buffer.from(b64,'base64'))])));await retained('contract','session.json',Buffer.from(JSON.stringify(session,null,2)+'\n'));await retained('binding','build-binding.json',await fs.readFile(launch.buildBinding.path));
    await saveHostCpuPhaseEvidence(rec.cpu,await ev(guestCpuPrebootStateExpression),out,'cold-preboot');await call('Page.navigate',{url:origin+'/linux/index.html?firefox=1&renderer=canvas2d&gpu=0'});
    await until(async()=>{const logs=await log();require(!fatalLines(logs).length,'actual fatal startup');return logs.includes('starting /bin/firefox as admin');},60000,'Firefox startup');
    const startup=await log();await retained('startup','startup.txt',Buffer.from(startup));rec.cpu=await saveGuestCpuEvidence(rec.cpu,startup,await ev(guestCpuStateExpression),out,'cold');await retained('cpu','cpu.json',Buffer.from(JSON.stringify(rec.cpu,null,2)+'\n'));
    const capturePath=base+'observer.stderr';
    await until(async()=>{const bytes=await homeRead(capturePath);if(bytes)raw=completeCapture(raw,bytes);return raw.toString('utf8').includes('PBLJIT_OPTION event=startup ');},remaining(120000),'actual native startup options');
    const shellProbe=await homeRead(base+'shell-probe.txt');require(shellProbe&&/^PBL_SHELL_PROBE errexit=pass required=pass procTail=pass setsid=pass fileBlocks=(2048|4096)$/m.test(shellProbe.toString('utf8')),'actual packaged shell compatibility probe missing');await retained('shell-probe','shell-probe.txt',shellProbe);
    rec.startupAcquisition={kind:prepared.startupConfig.kind,config:prepared.startupConfig.config,defaults:prepared.startupConfig.defaults};
    await until(async()=>{const bytes=await homeRead(capturePath);require(bytes,'direct capture disappeared');raw=completeCapture(raw,bytes);require(!fatalLines(raw.toString('utf8')).length,'actual fatal Firefox capture');await frameDiagnostics.observe(raw);return raw.toString('utf8').includes('NJS_RUNNER_DONE ');},remaining(120000),'actual actor/fixture/privileged operations');
    const resultBytes=await homeRead(base+'session-result.json'),parentBytes=await homeRead(base+'parent-option.json');require(resultBytes&&parentBytes,'actual session/parent artifact missing');const result=JSON.parse(resultBytes),parent=JSON.parse(parentBytes);completedSession(result,arm,session.label);parentChecks(parent,session,raw);rec.actualParent=parent;
    await retained('result','session-result.json',resultBytes);await retained('parent','parent-option.json',parentBytes);
    for(const scope of arm==='enabled'?['gc-debug-coverage','incremental','slice-gc','interrupt']:[]){const bytes=await homeRead(base+scope+'-console.txt');require(bytes,'actual scope transcript missing');await retained(scope,scope+'-console.txt',bytes);const operation=await homeRead(base+scope+'-result.json');require(operation,'actual scope result missing');await retained('scope-result:'+scope,scope+'-result.json',operation);}
    // The task startup hook requests normal quit only after the recorded runner returns.
    let exitBytes;await until(async()=>{exitBytes=await homeRead(base+'firefox-exit.json');return !!exitBytes;},remaining(120000),'actual Firefox natural exit/group drain');
    const launchBytes=await homeRead(base+'firefox-launch.json'),statBytes=await homeRead(base+'firefox-start.stat'),limitsBytes=await homeRead(base+'firefox-limits.txt'),terminalBytes=await homeRead(base+'firefox-group-terminal.txt');require(launchBytes&&statBytes&&limitsBytes&&terminalBytes,'actual guest ownership/limits/cleanup capture missing');
    exactFirefoxExit(JSON.parse(launchBytes),JSON.parse(exitBytes),statBytes.toString('utf8'),terminalBytes.toString('utf8'),limitsBytes.toString('utf8'),parent);
    for(const [role,name,bytes]of [['guest-launch','firefox-launch.json',launchBytes],['guest-exit','firefox-exit.json',exitBytes],['guest-start-stat','firefox-start.stat',statBytes],['guest-limits','firefox-limits.txt',limitsBytes],['guest-terminal','firefox-group-terminal.txt',terminalBytes]])await retained(role,name,bytes);
    raw=completeCapture(raw,await homeRead(capturePath));require(raw.length&&raw.at(-1)===10,'complete direct final transcript requires final newline');parentChecks(parent,session,raw);
    await retained('observer','observer.stderr',raw);await retained('combined','combined.txt',raw);await retained('stdout','firefox-stdout-stderr.txt',raw);
    for(const [name,want]of Object.entries({...session.files,...session.fixtureContract.files})){const bytes=await homeRead(base+name);require(bytes&&sha(bytes)===want,'actual installed executing source changed');await retained('file:'+name,'installed-'+name,bytes);}
    rec.finalCpu=await saveHostCpuPhaseEvidence(rec.cpu,await ev(guestCpuStateExpression),out,'cold-final');rec.finalAffinity=await saveBrowserAffinityEvidence(affinity,child.pid,await ev('navigator.hardwareConcurrency'),out,'browser-final');require(errors.length===0,'actual outer Runtime exceptions');
    const snapshot={kind:'nightly-broad-actual-capture-awaiting-review-v1',pass:false,status:'captured-awaiting-independent-review',arm,label:session.label,artifacts,actualDirectCapture:{producer:'guest-firefox',observer:'direct-unrotated-stderr',console:'direct-gecko-console',orderedSnapshots:true},executionProvenance:{startedAt:started,deadline,acquisition:rec.startupAcquisition,guestPID:parent.processID,browserOwner:ownedGroup},acceptance:{guest:false,jit:false,gpu:false}};
    await writeJSON(out+'/capture-for-review.json',snapshot);
    const predicateBytes=execFileSync('python3',[here+'/evaluate-capture.py',out+'/capture-for-review.json',out+'/unreviewed-session-predicates.json'],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},timeout:10000,maxBuffer:LIMIT});
    rec.unreviewedPredicates=JSON.parse(predicateBytes);require(rec.unreviewedPredicates.predicatesPass===true,'actual broad/session predicate failure');rec.captureComplete=true;
  }catch(error){rec.error=String(error.stack||error);rec.captureComplete=false;
    const failureBase='admin/nightly-jit-safety/'+prepared.session.label+'/';
    const diagnostics=await Promise.allSettled([
      shot('failure',true),
      (async()=>{const bytes=await homeRead(failureBase+'observer.stderr',true);if(bytes)raw=completeCapture(raw,bytes);await retained('failure-raw','failure-observer.stderr',raw);})(),
      (async()=>{await retained('failure-startup','failure-startup.txt',Buffer.from(await log(true)));})(),
      (async()=>{const state=await ev('({url:location.href,readyState:document.readyState,activeElement:{tag:document.activeElement?.tagName,id:document.activeElement?.id},browserHardwareConcurrency:navigator.hardwareConcurrency,framebuffer:{width:document.querySelector("#fb")?.width,height:document.querySelector("#fb")?.height}})',1000,true);await retained('failure-browser-state','failure-browser-state.json',Buffer.from(JSON.stringify(state,null,2)+'\n'));})(),
      ...['firefox-launch.json','firefox-start.stat','firefox-limits.txt','shell-probe.txt','input-ready.html','firefox-window-ready.json'].map(async name=>{const bytes=await homeRead(failureBase+name,true);if(bytes)await retained('failure-file:'+name,'failure-'+name,bytes);}),
    ]);
    rec.failureDiagnosticErrors=diagnostics.flatMap((row,index)=>row.status==='rejected'?[{index,error:String(row.reason)}]:[]);
  }
  finally {
    await frameDiagnostics?.stop();
    if(verified&&alive()&&ws?.readyState===1){try{await call('Page.navigate',{url:'about:blank'},1000,true);await call('Browser.close',{},1000,true);}catch{}}
    for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(Error('owned session closing'));}pending.clear();ws?.close();
    if(child){try{ownedGroup??=await pinOwnedGroup(process.pid);rec.groupCleanup=await drainOwnedGroup(ownedGroup,{scan:async pgid=>(await groupSnapshot(pgid)).filter(row=>row.pid!==process.pid),kill:()=>{throw Error('remaining exact Node-group descendants require outer termination; fails');}});rec.groupCleanup.excludedLiveNodePID=process.pid;rec.groupCleanup.fullNodeGroupTerminalProofRequiresOuter=true;await writeJSON(out+'/browser-group-cleanup.json',rec.groupCleanup);await Promise.race([exited,sleep(1000)]);rec.browserExit=exitInfo;}catch(error){rec.cleanupError=String(error);}}
    if(server){for(const socket of service.sockets)socket.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rec.serverClosed=!server.listening;rec.requests=service.requests;}
    rec.elapsedMs=started?Date.now()-started:null;rec.outerErrors=errors;rec.workerFrameDiagnostic=frameDiagnostics?.summary();if(rec.workerFrameDiagnostic?.startedAt){const bytes=await fs.readFile(out+'/worker-stall-frames.jsonl');await retained('worker-frame-diagnostic','worker-stall-frames-retained.jsonl',bytes);}rec.diagnosticOnly=true;
    try{for(const input of inputs)await pinFile(input);rec.inputsUnchanged=true;await storageCheck(TASK,RUNTIME_CAP);}catch(error){rec.finalInputError=String(error);rec.inputsUnchanged=false;}
    rec.captureProducerPass=rec.captureComplete===true&&rec.groupCleanup?.pass===true&&rec.browserExit?.code===0&&rec.elapsedMs<=170000&&rec.inputsUnchanged&&rec.serverClosed&&!rec.requests?.some(row=>!row.bound&&!row.expectedRefusal)&&errors.length===0;
    // Capturing is never independent review or a session checker pass.
    rec.pass=false;rec.status=rec.captureProducerPass?'captured-awaiting-independent-review':'failed';rec.artifacts=artifacts;await writeJSON(out+'/producer-result.json',rec);
  }
  return rec;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const mode=process.argv[2];
  if(mode==='--help')console.log('Host-only: node run-broad-session.mjs --prepare --task-root TASK --out TASK/NEW --label LABEL --arm disabled|enabled [--binding ABS --binding-sha256 SHA]\nActual run only through supervise-broad-session.py --run --repo REPO --task-root TASK --out TASK/NEW --arm disabled|enabled --launch ABS --launch-sha256 SHA --implementation ABS --implementation-sha256 SHA --prelaunch-review ABS --prelaunch-review-sha256 SHA. Missing final binding always fails before spawn. Capture remains pass:false until independent acquisition review plus existing check-session.py.');
  else {try{const args=options(process.argv.slice(3));const report=mode==='--prepare'?await prepare(args):mode==='--run'?await run(args):null;require(report,'--prepare or supervised --run required');console.log(JSON.stringify(report));if(mode==='--run'&&!report.captureProducerPass)process.exitCode=1;}catch(error){console.log(JSON.stringify({pass:false,status:'failed',browserStarted:false,error:String(error)}));process.exitCode=1;}}
}
