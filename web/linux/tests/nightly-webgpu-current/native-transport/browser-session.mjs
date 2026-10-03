// Owned, finite diagnostic browser. GPU implementation and benchmark live elsewhere.
import fs from 'node:fs/promises';
import {openSync, closeSync, readFileSync} from 'node:fs';
import {spawn, execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareBrowserAffinity, browserLaunchCommand, saveBrowserAffinityEvidence} from '../../../../../tools/guest-rootfs/firefox-browser-affinity.mjs';
import {ownedBrowserEndpoint, ownedPageEndpoint} from '../../../../../tools/guest-rootfs/check-firefox-nightly-benchmark.mjs';

export const TASK='/mnt/p6/project/build/nightly-current-native-gpu-transport-20261003';
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const repo=path.resolve(import.meta.dirname,'../../../../..');
export async function diskCheck(location) {
  const actual=await fs.realpath(location), s=await fs.statfs(actual);
  if(!(actual===TASK||actual.startsWith(TASK+'/'))||[0x01021994,0x858458f6].includes(s.type)||s.bavail*s.bsize<20*1024**3) throw Error('disk-backed task and 20GiB reserve required: '+location);
}
async function members(pgid) {
  const result=[];
  for(const pid of await fs.readdir('/proc')) {
    if(!/^\d+$/.test(pid)) continue;
    try {const raw=await fs.readFile('/proc/'+pid+'/stat','utf8'), a=raw.slice(raw.lastIndexOf(')')+2).split(' ');
      if(Number(a[2])===pgid) {const status=await fs.readFile('/proc/'+pid+'/status','utf8');result.push({pid:Number(pid),state:a[0],rssKiB:Number(/^VmRSS:\s*(\d+)/m.exec(status)?.[1]??0)});}}
    catch {}
  }
  return result;
}
async function socket(url,live) {
  const ws=new WebSocket(url), pending=new Map(), events=[];let seq=0;
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('CDP connect timeout')),5000);ws.onopen=()=>{clearTimeout(timer);resolve();};ws.onerror=()=>{clearTimeout(timer);reject(Error('CDP connect failure'));};});
  ws.onmessage=e=>{const r=JSON.parse(e.data);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}else {
    if(events.length<2048)events.push(r);
    if(r.method==='Target.attachedToTarget')ws.send(JSON.stringify({id:++seq,method:'Runtime.enable',params:{},sessionId:r.params.sessionId}));
  }};
  return {events,call(method,params={}){if(!live())return Promise.reject(Error('owned browser no longer live'));return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});},close(){for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('session closed'));}pending.clear();ws.close();}};
}
export async function runBrowser({out,mode='hardware',routes=new Map(),page='/probe.html',timeoutMs=180000,run}) {
  if(!['hardware','software'].includes(mode)||!out.startsWith(TASK+'/')||timeoutMs>600000) throw Error('invalid finite browser request');
  for(const key of ['TMPDIR','TMP','TEMP']) await diskCheck(process.env[key]);
  await fs.mkdir(out);await diskCheck(out);
  const affinity=await prepareBrowserAffinity(out), inputs={},requests=[],httpErrors=[];
  const frozen=new Map(routes);
  const server=createServer(async(req,res)=>{try {
    const url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(!['GET','HEAD'].includes(req.method)||url.includes('\0'))throw Error('unsupported request');
    let bytes=frozen.get(url);
    if(!bytes){if(!url.startsWith('/linux/'))throw Error('unsupported route');const source=path.resolve(repo,'web','.'+url);if(!source.startsWith(repo+'/web/linux/'))throw Error('route escape');bytes=await fs.readFile(source);inputs[source]=sha(bytes);frozen.set(url,bytes);await fs.mkdir(path.dirname(out+'/snapshot'+url),{recursive:true});await fs.writeFile(out+'/snapshot'+url,bytes);}
    requests.push({url,sha256:sha(bytes),bytes:bytes.length});
    const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm','.json':'application/json'};
    res.writeHead(200,{'Content-Type':mime[path.extname(url)]||'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'no-store','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch(e){httpErrors.push({url:req.url,error:String(e)});res.writeHead(404);res.end();}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='http://127.0.0.1:'+server.address().port,profile=out+'/profile';await fs.mkdir(profile);
  const args=[...(mode==='software'?['--headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']:['--enable-features=Vulkan','--ignore-gpu-blocklist']), '--enable-unsafe-webgpu','--disable-gpu-vsync','--disable-frame-rate-limit','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'--disk-cache-dir='+out+'/cache','about:blank'];
  // Chromium reserves large virtual cages; group RSS and available RAM are polled.
  const command=['/usr/bin/prlimit','--core=0:0','--as='+2*1024**4+':'+2*1024**4,'--',...browserLaunchCommand('/home/a/.local/archpkg/pacman/usr/bin/chromium',args,affinity)];
  await fs.writeFile(out+'/command.json',JSON.stringify(command,null,2)+'\n');
  const log=openSync(out+'/browser.log','wx'),spawnedAt=Date.now();
  const child=spawn(command[0],command.slice(1),{detached:true,env:{...process.env,XDG_CACHE_HOME:out+'/xdg',TMPDIR:process.env.TMPDIR,TMP:process.env.TMP,TEMP:process.env.TEMP},stdio:['ignore',log,log]});closeSync(log);
  if(child.pid)await fs.writeFile('/proc/'+child.pid+'/oom_score_adj','1000');
  let exitInfo,spawnError,browser,pageSocket,guardRunning=false,guardError,peakRssKiB=0;
  const exited=new Promise(resolve=>{child.once('exit',(code,signal)=>{exitInfo={code,signal};resolve();});child.once('error',error=>{spawnError=String(error);resolve();});});
  const state=()=>{let alive=false,ownedProfileArgument=false;try{const raw=readFileSync('/proc/'+child.pid+'/cmdline','utf8'), argv=raw.split('\0').filter(Boolean),tokens=argv.length===1?argv[0].split(' '):argv;ownedProfileArgument=tokens.includes('--user-data-dir='+profile)&&tokens.includes('--remote-debugging-port=0');alive=!exitInfo&&!spawnError&&ownedProfileArgument;}catch{}return {pid:child.pid,alive,ownedProfileArgument,exitCode:child.exitCode,signalCode:child.signalCode,spawnError};};
  const report={schema:1,mode,out,origin,browserPid:child.pid,scope:'independent-browser-diagnostic',pass:false,guestAcceptance:false,firefoxGpuAcceptance:false,releaseAcceptance:false,guards:{timeoutMs,coreBytes:0,addressSpaceBytes:2*1024**4,rssBytes:12*1024**3,availableRamFloorBytes:4*1024**3,taskDiskCapBytes:4*1024**3,diskReserveBytes:20*1024**3}};
  const terminate=signal=>{try{process.kill(-child.pid,signal);}catch(e){if(e.code!=='ESRCH')throw e;}};
  const guard=setInterval(async()=>{if(guardRunning)return;guardRunning=true;try{const g=await members(child.pid),rss=g.reduce((s,p)=>s+p.rssKiB,0);peakRssKiB=Math.max(peakRssKiB,rss);const available=Number(/^MemAvailable:\s*(\d+)/m.exec(await fs.readFile('/proc/meminfo','utf8'))?.[1])*1024;await diskCheck(out);const taskBytes=Number(execFileSync('du',['-sb',TASK],{encoding:'utf8'}).split(/\s/)[0]);if(Date.now()-spawnedAt>timeoutMs||rss*1024>12*1024**3||available<4*1024**3||taskBytes>4*1024**3)throw Error('browser resource/time guard');}catch(e){guardError=String(e);terminate('SIGTERM');}finally{guardRunning=false;}},2000);
  try {
    let text,stat,version;const deadline=Date.now()+20000;
    for(;;){if(exitInfo||spawnError)throw Error('owned browser startup failure');try{text=await fs.readFile(profile+'/DevToolsActivePort','utf8');stat=await fs.lstat(profile+'/DevToolsActivePort');const port=Number(text.split('\n')[0]);version=await(await fetch('http://127.0.0.1:'+port+'/json/version',{signal:AbortSignal.timeout(3000)})).json();break;}catch(e){if(Date.now()>deadline)throw Error('owned endpoint startup deadline: '+e);await sleep(100);}}
    report.admissionState=state();report.admissionArgv=readFileSync('/proc/'+child.pid+'/cmdline','utf8').split('\0');report.inheritedLimits=await fs.readFile('/proc/'+child.pid+'/limits','utf8');report.oomScoreAdj=Number(await fs.readFile('/proc/'+child.pid+'/oom_score_adj','utf8'));
    const endpoint=ownedBrowserEndpoint(text,version,{...report.admissionState,freshProfile:true,activePortRegularFile:stat.isFile()&&!stat.isSymbolicLink(),spawnedAt,activePortMtimeMs:stat.mtimeMs});report.endpointOwnership={...endpoint,activePortText:text};
    browser=await socket(endpoint.browserWebSocketURL,()=>state().alive);report.systemInfo=await browser.call('SystemInfo.getInfo');
    const targets=await(await fetch('http://127.0.0.1:'+endpoint.port+'/json/list')).json(),target=targets.find(t=>t.type==='page');report.endpointOwnership.pageTarget=target;
    pageSocket=await socket(ownedPageEndpoint(target,endpoint),()=>state().alive);
    const evaluate=async(expression)=>{const r=await pageSocket.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
    await pageSocket.call('Page.enable');await pageSocket.call('Runtime.enable');await pageSocket.call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:false,flatten:true});
    report.affinity=await saveBrowserAffinityEvidence(affinity,child.pid,await evaluate('navigator.hardwareConcurrency'),out);
    await pageSocket.call('Page.navigate',{url:origin+page});await pageSocket.call('Page.bringToFront');
    report.result=await run({evaluate,call:pageSocket.call.bind(pageSocket),affinity,origin});
    report.events=pageSocket.events;report.pass=report.result?.pass===true&&!guardError&&!report.events.some(e=>e.method==='Runtime.exceptionThrown');
    for(const [source,expected]of Object.entries(inputs))if(sha(await fs.readFile(source))!==expected)throw Error('served source changed: '+source);
    report.inputsUnchanged=true;
  }catch(e){report.error=String(e.stack||e);report.pass=false;}
  finally{
    clearInterval(guard);while(guardRunning)await sleep(20);
    try{if(browser&&state().alive)await browser.call('Browser.close');}catch{}
    pageSocket?.close();browser?.close();await Promise.race([exited,sleep(4000)]);
    let group=await members(child.pid);if(group.some(p=>p.state!=='Z')){terminate('SIGTERM');await Promise.race([exited,sleep(3000)]);group=await members(child.pid);if(group.some(p=>p.state!=='Z')){terminate('SIGKILL');await Promise.race([exited,sleep(3000)]);}report.forcedTermination=true;report.pass=false;}
    report.remainingGroup=await members(child.pid);report.browserExit=exitInfo??{spawnError};report.groupEmpty=report.remainingGroup.length===0;
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));report.serverClosed=!server.listening;report.guardError=guardError??null;report.peakGroupRssBytes=peakRssKiB*1024;report.inputs=inputs;report.requests=requests;report.httpErrors=httpErrors;
    if(!report.groupEmpty||exitInfo?.code!==0||guardError||!report.serverClosed)report.pass=false;
    await fs.writeFile(out+'/result.json',JSON.stringify(report,null,2)+'\n');
  }
  return report;
}
