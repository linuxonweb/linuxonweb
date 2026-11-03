#!/usr/bin/env node
// Current-tree measurement owner. Each run owns its private profile/display.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {Worker} from 'node:worker_threads';
const [runArg,mode='firefox',secondsArg='150',query=''] = process.argv.slice(2);
const seconds=Number(secondsArg);
const testPort=Number(process.env.LINUXONWEB_TEST_PORT||3000);
if(!runArg || !['firefox','io','idle','home-tests','io-compare','input-timing','home-inventory','cache-export','seed-tests','mount-tests','writeback-tests','compat-export','barrier-tests'].includes(mode) || !Number.isInteger(seconds) || seconds<20 || seconds>240) throw Error('usage: RUN_DIRECTORY firefox|io|idle SECONDS [QUERY]');
const run=path.resolve(runArg);
if(fs.existsSync(run))throw Error('fresh run required');
fs.mkdirSync(run,{recursive:true,mode:0o700});
const scratch=path.join(run,'t');fs.mkdirSync(scratch,{mode:0o700});
if(scratch.length>65)throw Error('Use a short disk scratch path');
const profile=path.join(run,'profile');
let reusedTestProfile=null;
if(process.env.LINUXONWEB_REUSE_TEST_PROFILE){
 const source=fs.realpathSync(process.env.LINUXONWEB_REUSE_TEST_PROFILE),sourceRun=path.dirname(source);
 const receipt=JSON.parse(fs.readFileSync(path.join(sourceRun,'report.json'),'utf8'));
 if(path.basename(source)!=='profile'||path.dirname(sourceRun)!==path.dirname(run)||receipt.run!==sourceRun||!receipt.end||receipt.remainingOwned?.length!==0)throw Error('Reuse requires a closed sibling test profile with cleanup receipt');
 const prepared=performance.now();fs.cpSync(source,profile,{recursive:true,filter:entry=>!path.basename(entry).startsWith('Singleton')&&path.basename(entry)!=='DevToolsActivePort'});
 reusedTestProfile={source,sourceRun,start:receipt.start,end:receipt.end,copyMs:performance.now()-prepared};
}else fs.mkdirSync(profile,{mode:0o700});
const env={...process.env,TMPDIR:scratch,TMP:scratch,TEMP:scratch,XDG_CACHE_HOME:path.join(run,'cache')};
const start=performance.now(),time=()=>+(performance.now()-start).toFixed(3);
const report={schema:1,reusedTestProfile,start:new Date().toISOString(),mode,seconds,run,samples:[],events:[],console:[],errors:[],screenshots:[],configuration:{cpus:os.availableParallelism(),ramMiB:2048,resolution:'1280x720',renderer:'webgl',query,monitorIntervalMs:1000,pssIntervalMs:5000},acceptance:'Unreviewed; screenshots and interaction required'};
function save(){fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2)+'\n');}
function identity(pid){try{const st=fs.readFileSync(`/proc/${pid}/stat`,'utf8');const f=st.slice(st.lastIndexOf(')')+2).split(' ');const status=fs.readFileSync(`/proc/${pid}/status`,'utf8');return{pid,ppid:+f[1],group:+f[2],session:+f[3],start:f[19],ticks:+f[11]+ +f[12],rss:+(/VmRSS:\s*(\d+)/.exec(status)?.[1]||0)*1024,affinity:/Cpus_allowed_list:\s*(\S+)/.exec(status)?.[1],cgroup:fs.readFileSync(`/proc/${pid}/cgroup`,'utf8').trim()};}catch{return null;}}
const tracked=new Map([[process.pid,identity(process.pid)]]);
function processes(){const all=fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x)).map(x=>identity(+x)).filter(Boolean);const owned=new Map(all.filter(x=>tracked.get(x.pid)?.start===x.start).map(x=>[x.pid,x]));let changed=true;while(changed){changed=false;for(const p of all)if(!owned.has(p.pid)&&owned.has(p.ppid)){owned.set(p.pid,p);changed=true;}}for(const p of owned.values())tracked.set(p.pid,p);return[...owned.values()];}
const clockTicks=Number(spawnSync('getconf',['CLK_TCK'],{encoding:'utf8'}).stdout.trim())||100;
async function ioWorkload(m){const name='linuxonweb.io-benchmark.'+crypto.randomUUID();const h=await m.openPersistentHome({name});const c={mode:420,uid:1000,gid:1000};const f=await h.create(h.root,'payload',2,c);const chunk=new Uint8Array(1048576);chunk.fill(0x51);const result={};let t=performance.now();for(let i=0;i<16;i++)await h.write(f.node,f.handle,BigInt(i*chunk.length),chunk);result.sequentialWriteMs=performance.now()-t;t=performance.now();for(let i=0;i<16;i++){const b=await h.read(f.node,f.handle,BigInt(i*chunk.length),chunk.length);if(b.length!==chunk.length||b[0]!==0x51||b[b.length-1]!==0x51)throw Error('sequential read mismatch');}result.sequentialReadMs=performance.now()-t;const small=new Uint8Array(4096);small.fill(0x92);t=performance.now();for(let i=0;i<128;i++)await h.write(f.node,f.handle,BigInt(((i*31)%4096)*4096),small);result.random4kWriteMs=performance.now()-t;t=performance.now();for(let i=0;i<128;i++){const b=await h.read(f.node,f.handle,BigInt(((i*31)%4096)*4096),4096);if(b.length!==4096||b[0]!==0x92||b[4095]!==0x92)throw Error('random read mismatch');}result.random4kReadMs=performance.now()-t;t=performance.now();for(let i=0;i<64;i++){const v=await h.create(h.root,'meta'+i,2,c);await h.getattr(v.node);await h.release(v.node,v.handle);await h.unlink(h.root,'meta'+i);}result.metadata64Ms=performance.now()-t;await h.release(f.node,f.handle);await h.destroy();await new Promise((a,b)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=a;r.onerror=()=>b(r.error);});result.pass=true;return result;}
let browser,display,ws,monitor,sequence=0,bootAt,closed=false,tracing=false,traceStream,inputProbed=false;
const options=new URLSearchParams(query);const observeAfter=Number(options.get('observe-after-seconds')||0);if(!Number.isFinite(observeAfter)||observeAfter<0||observeAfter>seconds)throw Error('observe-after-seconds must be finite and within the observation window');report.configuration.browserObserverStartsAfterSeconds=observeAfter;const pending=new Map();
function send(method,params={},timeout=15000){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error(method+' timed out'));},timeout);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression,timeout=15000){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},timeout);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;}

async function pressKey(info,modifiers=0,holdMs=20){
 const sentDown=time();const down=send('Input.dispatchKeyEvent',{type:'keyDown',...info,modifiers});
 // Queue release on its own timer; a delayed CDP acknowledgement must never
 // turn an intended short keypress into a long-held autorepeating key.
 const up=delay(holdMs).then(()=>{const sentUp=time();(report.keyDispatches??=[]).push({code:info.code,sentDownMs:sentDown,sentUpMs:sentUp,intendedHoldMs:holdMs});return send('Input.dispatchKeyEvent',{type:'keyUp',key:info.key,code:info.code,windowsVirtualKeyCode:info.windowsVirtualKeyCode,nativeVirtualKeyCode:info.nativeVirtualKeyCode,modifiers});});
 const results=await Promise.allSettled([down,up]);for(const result of results)if(result.status==='rejected')throw result.reason;
}
async function clickGuest(x,y){
 const down=send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
 const up=delay(20).then(()=>send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1}));
 const results=await Promise.allSettled([down,up]);for(const r of results)if(r.status==='rejected')throw r.reason;
}
async function typeGuestAddress(text,label){
 const result={startedMs:time(),text};await shot(label+'-before');
 await clickGuest(500,110);
 const control={key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,nativeVirtualKeyCode:17};
 await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...control,modifiers:2});
 try{await pressKey({key:'a',code:'KeyA',windowsVirtualKeyCode:65,nativeVirtualKeyCode:65},2);}
 finally{await send('Input.dispatchKeyEvent',{type:'keyUp',...control,modifiers:0});}
 for(const c of text){
  if(!/[a-z:]/.test(c))throw Error('Unsupported diagnostic address character');
  const shifted=c===':',code=shifted?'Semicolon':'Key'+c.toUpperCase(),vk=shifted?186:c.toUpperCase().charCodeAt(0);
  const shift={key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,nativeVirtualKeyCode:16};
  if(shifted)await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...shift,modifiers:8});
  try{await pressKey({key:c,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,text:c,unmodifiedText:c},shifted?8:0);}
  finally{if(shifted)await send('Input.dispatchKeyEvent',{type:'keyUp',...shift,modifiers:0});}
  await delay(10);
 }
 result.typedMs=time();await delay(1000);await shot(label+'-typed');
 await pressKey({key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
 result.enterMs=time();await delay(2000);await shot(label+'-navigation');result.observedMs=time();return result;
}
async function guestLogs(){return await evaluate("import('./main.js').then(m=>m.guestLogs.history.rows.map(r=>r.text).join('\\n'))");}
async function profileSnapshot(label,includeAll=false){
 const snapshot=await evaluate(`new Promise((resolve,reject)=>{const request=indexedDB.open('linuxonweb.home.v1');request.onupgradeneeded=()=>request.transaction.abort();request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('nodes','readonly'),r=tx.objectStore('nodes').getAll(undefined,10000);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const nodes=r.result,map=new Map(nodes.map(n=>[n.id,n]));const pathname=n=>{const parts=[];for(let depth=0;n&&n.parent&&depth<32;depth++){parts.push(n.name);n=map.get(n.parent);}return '/home/'+parts.reverse().join('/');};resolve({nodes:nodes.length,truncated:nodes.length===10000,files:nodes.map(n=>({id:n.id,path:pathname(n),bytes:n.size,mode:n.mode})).filter(n=>${includeAll}||/startupcache|startupCache|\.cache|prefs\.js|user\.js|profiles\.ini|sessionstore/i.test(n.path))});};tx.oncomplete=()=>db.close();};})`);
 fs.writeFileSync(path.join(run,label+'-profile.json'),JSON.stringify(snapshot,null,2));
 const timings=await evaluate('globalThis.__gpt6HomeTimings??null');if(timings)fs.writeFileSync(path.join(run,label+'-home-timings.json'),JSON.stringify(timings,null,2));
 return{atMs:time(),nodes:snapshot.nodes,files:snapshot.files.length,truncated:snapshot.truncated};
}
async function exportCodeCaches(){
 const allowed=['startupCache.4.little','scriptCache.bin','urlCache.bin'];
 const directory='admin/.cache/mozilla/firefox/http1-profile/startupCache';
 const output=path.join(run,'code-cache');fs.mkdirSync(output,{mode:0o700});
 report.codeCacheExport={directory,files:[],sourceTestProfile:reusedTestProfile};
 await evaluate(`(async()=>{globalThis.__codeCacheHome=await(await import('./persistent-home.mjs')).openPersistentHome({readOnly:true});return true;})()`);
 try{
  for(const filename of allowed){
   const metadata=await evaluate(`(async()=>{const h=__codeCacheHome;let n=h.root;for(const part of ${JSON.stringify(directory+'/'+filename)}.split('/')){n=await h.lookup(n,part);if(!n)return null;}globalThis.__codeCacheNode=n;globalThis.__codeCacheHandle=await h.open(n,0);return {bytes:Number((await h.getattr(n)).size)};})()`);
   if(!metadata)throw Error('Expected code cache absent: '+filename);
   if(!Number.isSafeInteger(metadata.bytes)||metadata.bytes<1||metadata.bytes>24*1024**2)throw Error('Code cache size outside bound');
   const fd=fs.openSync(path.join(output,filename),'wx'),digest=crypto.createHash('sha256');
   try{for(let offset=0;offset<metadata.bytes;offset+=1048576){
    const encoded=await evaluate(`(async()=>{const bytes=await __codeCacheHome.read(__codeCacheNode,__codeCacheHandle,BigInt(${offset}),${Math.min(1048576,metadata.bytes-offset)});const strings=[];for(let i=0;i<bytes.length;i+=32768)strings.push(String.fromCharCode(...bytes.subarray(i,i+32768)));return btoa(strings.join(''));})()`);
    const bytes=Buffer.from(encoded,'base64');if(bytes.length!==Math.min(1048576,metadata.bytes-offset))throw Error('Cache export short read');fs.writeSync(fd,bytes);digest.update(bytes);
   }}finally{fs.closeSync(fd);await evaluate('__codeCacheHome.release(__codeCacheNode,__codeCacheHandle)');}
   report.codeCacheExport.files.push({filename,bytes:metadata.bytes,sha256:digest.digest('hex')});
  }
 }finally{await evaluate('__codeCacheHome.destroy()');}
 fs.writeFileSync(path.join(output,'export.json'),JSON.stringify(report.codeCacheExport,null,2));
}
async function warmRestart(){
 const before=await guestLogs();const beforePids=[...new Set([...String(before).matchAll(/\[(\d+), Main Thread\]/g)].map(m=>Number(m[1])))];
 report.warmRestart={kind:'visible-about-profiles-restart',expectedProfile:'/home/admin/.mozilla/firefox/http1-profile',beforePids,preparationAtMs:time()};
 report.warmRestart.beforeProfile=await profileSnapshot('cold');
 report.warmRestart.prepare=await typeGuestAddress('about:profiles','warm-prepare');
 await delay(4000);await shot('warm-about-profiles');save();
 console.log(JSON.stringify({phase:'awaiting-visible-restart-click',run,controlFile:path.join(run,'warm-control.json'),deadlineMs:90000}));
 const deadline=time()+90000;let action;
 while(time()<deadline){try{action=JSON.parse(fs.readFileSync(path.join(run,'warm-control.json'),'utf8'));break;}catch{}await delay(100);}
 if(action?.action!=='restart-click'||!Number.isFinite(action.x)||!Number.isFinite(action.y)||action.x<0||action.x>1400||action.y<0||action.y>960)throw Error('Visible restart click missing or invalid within90s');
 report.warmRestart.requestAtMs=time();await clickGuest(action.x,action.y);save();
 let nextShot=0,probed=false,secondProbed=false;
 const newPids=new Set();
 while(time()-report.warmRestart.requestAtMs<90000&&!closed){
  const elapsed=(time()-report.warmRestart.requestAtMs)/1000;
  const logs=await guestLogs();fs.writeFileSync(path.join(run,'warm-guest.log'),String(logs));
  for(const match of String(logs).matchAll(/\[(\d+), Main Thread\]/g)){const pid=Number(match[1]);if(!beforePids.includes(pid)&&!newPids.has(pid)){newPids.add(pid);(report.warmRestart.newPidObservations??=[]).push({pid,requestElapsedMs:time()-report.warmRestart.requestAtMs});}}
  if(elapsed>=nextShot){await shot('warm-at'+Math.round(elapsed)+'s');nextShot+=10;}
  if(elapsed>=25&&!probed){probed=true;report.warmRestart.input25=await typeGuestAddress('about:blank','warm-input25');}
  if(elapsed>=60&&!secondProbed){secondProbed=true;report.warmRestart.input60=await typeGuestAddress('about:blank','warm-input60');}
  await delay(500);
 }
 report.warmRestart.observationEndedAtMs=time();report.warmRestart.newProcessObserved=newPids.size>0;
 report.warmRestart.afterProfile=await profileSnapshot('warm');
 report.warmRestart.acceptance='Unreviewed; require new process, exact profile and visible input outcome';
 await shot('warm-final');save();
}
async function shot(name){const requestedAtMs=time(),requestedAtUtc=new Date().toISOString();const r=await send('Page.captureScreenshot',{format:'png'});const completedAtMs=time(),completedAtUtc=new Date().toISOString();fs.writeFileSync(path.join(run,name+'.png'),Buffer.from(r.data,'base64'));report.screenshots.push({name:name+'.png',ms:completedAtMs,bootMs:bootAt===undefined?null:completedAtMs-bootAt,requestedAtMs,completedAtMs,durationMs:completedAtMs-requestedAtMs,requestedAtUtc,completedAtUtc});save();}
function child(command,args,log){const fd=fs.openSync(path.join(run,log),'a');const p=spawn(command,args,{env,stdio:['ignore',fd,fd],detached:true});fs.closeSync(fd);p.on('error',e=>report.errors.push(String(e)));return p;}
try{
 const displayNumber=Array.from({length:40},(_,i)=>90+i).find(n=>!fs.existsSync(`/tmp/.X${n}-lock`));if(displayNumber===undefined)throw Error('No free owned X display');
 env.DISPLAY=':'+displayNumber;env.XAUTHORITY=path.join(run,'xauth');fs.writeFileSync(env.XAUTHORITY,'',{mode:0o600});
 const auth=spawnSync('xauth',['-f',env.XAUTHORITY,'add',env.DISPLAY,'.',crypto.randomBytes(16).toString('hex')],{env,encoding:'utf8'});if(auth.status!==0)throw Error('xauth: '+auth.stderr);
 display=child('Xvfb',[env.DISPLAY,'-screen','0','1440x1000x24','-nolisten','tcp','-auth',env.XAUTHORITY,'-noreset'],'xvfb.log');await delay(400);
 const chrome=process.env.LINUXONWEB_CHROMIUM||'/home/a/.local/archpkg/pacman/usr/bin/chromium';
 browser=child(chrome,['--user-data-dir='+profile,'--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--disable-dev-shm-usage','--disable-background-networking','--window-size=1400,960','--disable-features=Translate','about:blank'],'chrome.log');
 monitor=new Worker(new URL('./gpt6-astra-monitor.mjs',import.meta.url),{workerData:{rootPid:process.pid,rootStart:identity(process.pid).start,run,startedAtMonotonic:start,clockTicks,pssIntervalMs:report.configuration.pssIntervalMs}});
 monitor.on('message',message=>{if(message.sample){report.samples.push(message.sample);for(const p of message.sample.processes)tracked.set(p.pid,p);}if(message.fatal){report.errors.push(message.fatal);closed=true;}});
 monitor.on('error',error=>{report.errors.push('Resource monitor: '+error);closed=true;});
 let port;for(let i=0;i<200;i++){if(browser.exitCode!==null)throw Error('Chromium exited '+browser.exitCode);try{port=+fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];if(port)break;}catch{}await delay(100);}if(!port)throw Error('No owned CDP port');
 const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());const target=targets.find(t=>t.type==='page');if(!target)throw Error('No page target');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',e=>{const v=JSON.parse(e.data);if(v.id&&pending.has(v.id)){const p=pending.get(v.id);pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);}else if(v.method==='Tracing.tracingComplete'){traceStream=v.params.stream;}else if(v.method==='Runtime.consoleAPICalled'){if(report.console.length<3000)report.console.push({ms:time(),type:v.params.type,text:v.params.args.map(x=>x.value??x.description??'').join(' ').slice(0,8192)});}else if(v.method==='Runtime.exceptionThrown')report.errors.push({ms:time(),exception:v.params.exceptionDetails});});
 await send('Runtime.enable');await send('Page.enable');report.browserVersion=await send('Browser.getVersion');
 if(observeAfter>0&&(mode!=='firefox'||options.get('trace-startup')==='1'))throw Error('Quiet observation requires Firefox mode without tracing');
 if(options.get('trace-startup')==='1'){await send('Tracing.start',{transferMode:'ReturnAsStream',categories:'v8,disabled-by-default-v8.wasm,disabled-by-default-v8.runtime_stats'});tracing=true;}
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`globalThis.__gpt6InputDom=[];for(const type of ['keydown','keyup'])document.addEventListener(type,e=>{if(e.target?.tagName==='CANVAS'&&__gpt6InputDom.length<2048)__gpt6InputDom.push({type,code:e.code,key:e.key,repeat:e.repeat,ms:performance.timeOrigin+performance.now()});},true);`});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.protocol==='http:')localStorage.setItem('linuxonweb.machine-settings.v1',JSON.stringify({cpus:${report.configuration.cpus},ram:2048,resolution:'1280x720',backend:'webgl'}));`});
 const url=new URL(`http://127.0.0.1:${testPort}/linux/index.html`);url.searchParams.set('renderer','webgl');url.searchParams.set('gpubackend','webgl');if(mode==='firefox')url.searchParams.set('firefox','1');for(const[k,v]of new URLSearchParams(query))url.searchParams.set(k,v);
 report.url=url.href;bootAt=time();report.navigationAtMs=bootAt;report.navigation=await send('Page.navigate',{url:url.href});if(report.navigation.errorText)throw Error('Navigation: '+report.navigation.errorText);
 if(observeAfter>0){report.quietObservation={startBootMs:time()-bootAt,startUtc:new Date().toISOString(),requestedEndBootMs:observeAfter*1000,excludes:['screenshots','Runtime.evaluate','log polling','tracing'],resourceMonitor:'CPU/RSS/quota1s; PSS5s; separateworker',passiveConsoleEvents:true};save();while(time()-bootAt<observeAfter*1000&&!closed)await delay(200);report.quietObservation.endBootMs=time()-bootAt;report.quietObservation.endUtc=new Date().toISOString();if(closed)throw Error('Resource monitor stopped quiet observation');}
 for(let i=0;i<200;i++){try{if(await evaluate("document.readyState==='complete' && !!document.querySelector('#cpu-cores')"))break;}catch{}await delay(100);}
 report.initial=await evaluate("({cores:navigator.hardwareConcurrency,crossOriginIsolated,settings:localStorage.getItem('linuxonweb.machine-settings.v1'),url:location.href,pageTimeOrigin:performance.timeOrigin,pageNow:performance.now()})");if(report.initial.cores!==report.configuration.cpus)throw Error('Native browser CPU count differs from test affinity');save();
 if(mode==='compat-export'){
 const text=await evaluate(`(async()=>{const h=await(await import('./persistent-home.mjs')).openPersistentHome({readOnly:true});try{let n=h.root;for(const part of ['admin','.mozilla','firefox','http1-profile','compatibility.ini']){n=await h.lookup(n,part);if(!n)throw Error('Controlled fixture compatibility file absent');}if(Number((await h.getattr(n)).size)>2048)throw Error('Compatibility file outside bounded generated metadata size');const bytes=await h.read(n,{},0n,2048);return new TextDecoder().decode(bytes);}finally{await h.destroy();}})()`);
 const keys=['LastVersion','LastOSABI','LastPlatformDir','LastAppDir'],fields={};
 for(const line of text.split(/\r?\n/)){if(!line||line==='[Compatibility]')continue;const at=line.indexOf('=');const key=line.slice(0,at),value=line.slice(at+1);if(!keys.includes(key)||Object.hasOwn(fields,key)||!value)throw Error('Unexpected compatibility metadata field');fields[key]=value;}
 if(keys.some(k=>!fields[k]))throw Error('Compatibility metadata field missing');
 report.compatibilityExport={fields,sourceTestProfile:reusedTestProfile,onlyBuildMetadata:true};fs.writeFileSync(path.join(run,'compatibility.json'),JSON.stringify(report.compatibilityExport,null,2));
 }else if(mode==='cache-export'){await exportCodeCaches();
 }else if(mode==='home-inventory'){report.inventory=await profileSnapshot('inventory',true);
 }else if(mode==='input-timing'){
 await evaluate(`document.body.innerHTML='<textarea id="timing-target" autofocus></textarea>';globalThis.__timingEvents=[];for(const type of ['keydown','keyup'])document.addEventListener(type,e=>__timingEvents.push({type,code:e.code,key:e.key,repeat:e.repeat,ms:performance.timeOrigin+performance.now()}),true);document.querySelector('#timing-target').focus()`);
 const expected='about:blank'.repeat(16);
 for(const c of expected){const shifted=c===':',code=shifted?'Semicolon':'Key'+c.toUpperCase(),vk=shifted?186:c.toUpperCase().charCodeAt(0);await pressKey({key:c,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,text:c,unmodifiedText:c},shifted?8:0);await delay(10);}
 report.inputTiming=await evaluate(`({value:document.querySelector('#timing-target').value,events:__timingEvents})`);
 report.inputTiming.expected=expected;
 const dom=report.inputTiming.events,holds=report.keyDispatches.map(x=>x.sentUpMs-x.sentDownMs);
 report.inputTiming.dispatchHoldMaxMs=Math.max(...holds);
 report.inputTiming.domHoldsMs=[];
 for(let i=0;i<dom.length;i+=2){if(dom[i]?.type!=='keydown'||dom[i+1]?.type!=='keyup'||dom[i].code!==dom[i+1].code)throw Error('Input event order differs');report.inputTiming.domHoldsMs.push(dom[i+1].ms-dom[i].ms);}
 if(report.inputTiming.value!==expected||dom.length!==expected.length*2)throw Error('Input text/event count differs');
 if(report.inputTiming.dispatchHoldMaxMs>100||Math.max(...report.inputTiming.domHoldsMs)>100)throw Error('Input holds exceeded100ms for intended20ms');
 report.inputTiming.pass=true;
 }else if(mode==='home-tests'||mode==='seed-tests'||mode==='mount-tests'||mode==='writeback-tests'||mode==='barrier-tests'){
 report.homeTests=[];
 for(const page of (mode==='barrier-tests'?['home-barrier.html']:mode==='writeback-tests'?['home-writeback.html']:mode==='mount-tests'?['home-mount.html']:mode==='seed-tests'?['startup-cache-seed.html','startup-cache-seed-v2.html']:['persistent-home.html','persistent-home-write.html'])){
   await send('Page.navigate',{url:'http://127.0.0.1:'+testPort+'/linux/tests/'+page});
   let state;for(let i=0;i<seconds*5;i++){state=await evaluate("({result:document.documentElement?.dataset.result,text:document.body?.innerText})");if(state.result)break;await delay(200);}
   report.homeTests.push({page,...state});if(state?.result!=='pass')throw Error('Home test failed: '+page+' '+state?.text);save();
 }
 }else if(mode==='io-compare'){
 const base=spawnSync('git',['show','49fc26e:web/linux/persistent-home.mjs'],{encoding:'utf8',maxBuffer:1048576});if(base.status!==0)throw Error('Missing checkpoint baseline');
 const source=base.stdout.replace("'./dist/virtio/fs.js'", "'http://127.0.0.1:3000/linux/dist/virtio/fs.js'");
 report.baselineSourceSha256=crypto.createHash('sha256').update(base.stdout).digest('hex');
 report.candidateSourceSha256=crypto.createHash('sha256').update(fs.readFileSync('web/linux/persistent-home.mjs')).digest('hex');
 report.ioCompare=await evaluate(`(async()=>{const u=URL.createObjectURL(new Blob([${JSON.stringify(source)}],{type:'text/javascript'}));const baseline=await import(u);const candidate=await import('./persistent-home.mjs');const rows=[];for(const variant of ['baseline','candidate','candidate','baseline']){rows.push({variant,...await (${ioWorkload})(variant==='baseline'?baseline:candidate)});}URL.revokeObjectURL(u);return rows;})()`,Math.min(180000,seconds*1000));save();
 }else if(mode==='io'){
 const result=await evaluate(`(async()=>(${ioWorkload})(await import('./persistent-home.mjs')))()`,Math.min(180000,seconds*1000));
 report.io=result;save();
 }else{
 let nextShot=10,lastLogs=0;report.milestones={};while(time()-bootAt<seconds*1000&&!closed){const bootSeconds=(time()-bootAt)/1000;if(bootSeconds<observeAfter){await delay(500);continue;}if(bootSeconds>=nextShot){await shot('at'+Math.round(bootSeconds)+'s');nextShot+=20;}if(bootSeconds-lastLogs>=5){try{const logs=await evaluate("import('./main.js').then(m=>m.guestLogs.history.rows.map(r=>r.text).join('\\n'))");fs.writeFileSync(path.join(run,'guest.log'),String(logs));report.lastLogAtMs=time();for(const marker of ['system image','machine started','home: persistent storage mounted','display: starting Xfbdev','starting /bin/aurora-wm','[wm-ready]','starting /bin/firefox','gl context 2 open','PBLJIT compile'])if(String(logs).includes(marker)&&report.milestones[marker]===undefined)report.milestones[marker]=time()-bootAt;}catch(e){report.errors.push({ms:time(),log:String(e)});}lastLogs=bootSeconds;const status=await evaluate("document.querySelector('#status')?.textContent??''");if(/^boot failed/.test(status))throw Error('Actual frontend boot failed; see retained guest.log');}if(options.get('probe-input')==='1'&&!inputProbed&&bootSeconds>=Math.max(20,Math.min(seconds-10,Number(options.get('probe-after-seconds')||110)))){
 inputProbed=true;report.inputProbe={startBootMs:time()-bootAt};await shot('input-before');
 await send('Input.dispatchMouseEvent',{type:'mousePressed',x:500,y:110,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:500,y:110,button:'left',clickCount:1});
 const control={key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,nativeVirtualKeyCode:17};
 await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...control,modifiers:2});
 await pressKey({key:'a',code:'KeyA',windowsVirtualKeyCode:65,nativeVirtualKeyCode:65},2);
 await send('Input.dispatchKeyEvent',{type:'keyUp',...control,modifiers:0});
 for(const c of 'about:blank'){
 const shifted=c===':',code=shifted?'Semicolon':'Key'+c.toUpperCase(),vk=shifted?186:c.toUpperCase().charCodeAt(0);const shift={key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,nativeVirtualKeyCode:16};
 if(shifted)await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...shift,modifiers:8});
 await pressKey({key:c,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,text:c,unmodifiedText:c},shifted?8:0);
 if(shifted)await send('Input.dispatchKeyEvent',{type:'keyUp',...shift,modifiers:0});await delay(10);
 }
 report.inputProbe.typedBootMs=time()-bootAt;await delay(1000);await shot('input-typed');
 await pressKey({key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13},0);report.inputProbe.enterBootMs=time()-bootAt;await delay(2000);await shot('input-navigation');report.inputProbe.observedBootMs=time()-bootAt;
 }
 await delay(500);}
 if(tracing){await send('Tracing.end');for(let i=0;i<100&&!traceStream;i++)await delay(100);if(!traceStream)throw Error('Trace completion absent');const fd=fs.openSync(path.join(run,'startup-trace.json'),'wx');let total=0;try{for(;;){const part=await send('IO.read',{handle:traceStream,size:1048576});const b=Buffer.from(part.data,part.base64Encoded?'base64':'utf8');total+=b.length;if(total>67108864)throw Error('Trace exceeds64MiB');fs.writeSync(fd,b);if(part.eof)break;}}finally{fs.closeSync(fd);await send('IO.close',{handle:traceStream});}report.traceBytes=total;tracing=false;}
 if(observeAfter>0)fs.writeFileSync(path.join(run,'guest.log'),await guestLogs());
 const startupTimings=await evaluate('globalThis.__gpt6StartupTimings ?? []');if(startupTimings.length){fs.writeFileSync(path.join(run,'startup-timings.json'),JSON.stringify(startupTimings));report.startupTimingEvents=startupTimings.length;}
 const logTimings=await evaluate("import('./main.js').then(m=>m.guestLogs.history.rows.map(r=>({id:r.id,text:r.text,firstAtMs:r.firstAtMs,firstAtEpochMs:r.firstAtEpochMs})))");fs.writeFileSync(path.join(run,'guest-log-timings.json'),JSON.stringify(logTimings));
 report.seedReceipt=await evaluate('globalThis.__gpt6SeedReceipt??null');
 const homeTimings=await evaluate('globalThis.__gpt6HomeTimings??null');if(homeTimings)fs.writeFileSync(path.join(run,'home-timings.json'),JSON.stringify(homeTimings,null,2));
 const inputDiagnostics=await evaluate('({dom:globalThis.__gpt6InputDom??[],queue:globalThis.__gpt6InputQueue??null})');fs.writeFileSync(path.join(run,'input-diagnostics.json'),JSON.stringify(inputDiagnostics));
 report.finalState=await evaluate("({text:document.body.innerText.slice(-6000),cores:navigator.hardwareConcurrency,status:document.querySelector('#status')?.textContent})");await shot('final');
 if(mode==='firefox'&&options.get('warm-restart')==='1')await warmRestart();
 if(mode==='firefox'&&(options.get('post-apk-check')==='1'||options.get('desktop-apk-check')==='1')){
  report.postApkCheck={startedBootMs:time()-bootAt,afterFixedGraphicsObservation:options.get('post-apk-check')==='1',dedicatedDesktopAcceptance:options.get('desktop-apk-check')==='1'};
  const gate=path.join(run,'allow-post-apk.json');let reviewed=options.get('desktop-apk-check')==='1';for(let i=0;!reviewed&&i<150;i++){if(fs.existsSync(gate)){report.postApkCheck.visualGate=JSON.parse(fs.readFileSync(gate,'utf8'));reviewed=true;break;}await delay(200);}if(!reviewed)throw Error('Post-APK check requires observed completed GPU benchmark before typing');
  if(!String(await guestLogs()).includes('[wm-ready]'))throw Error('Desktop package gate requires actual window-manager readiness');
  await evaluate("document.querySelector('[data-test=uname]').click()");await delay(5000);await shot('apk-terminal-before');
  await evaluate("document.querySelector('canvas')?.focus({preventScroll:true})");
  const commands=[['apk --version',3000],['sudo apk update && sudo apk add python3',25000],['python3 --version',3000],['python3 -m json.tool --help && echo python-desktop-ok',25000]];
  report.postApkCheck.commands=[];
  for(let index=0;index<commands.length;index++){
   const [command,observeMs]=commands[index];
   for(const c of command){
    const special={' ':['Space',32,0],'-':['Minus',189,0],'.':['Period',190,0],'&':['Digit7',55,8]};const [code,vk,mod]=special[c]||(/^\d$/.test(c)?['Digit'+c,c.charCodeAt(0),0]:['Key'+c.toUpperCase(),c.toUpperCase().charCodeAt(0),0]);
    const shift={key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,nativeVirtualKeyCode:16};if(mod===8)await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...shift,modifiers:8});
    try{await pressKey({key:c,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,text:c,unmodifiedText:c},mod);}finally{if(mod===8)await send('Input.dispatchKeyEvent',{type:'keyUp',...shift,modifiers:0});}await delay(20);
   }
   await pressKey({key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13},0);await delay(observeMs);await shot('apk-command-'+index);report.postApkCheck.commands.push({command,observedBootMs:time()-bootAt});save();
  }
  report.postApkCheck.finishedBootMs=time()-bootAt;report.postApkCheck.acceptance='Requires visual review of native terminal output; no automatic pass from keystrokes';fs.writeFileSync(path.join(run,'post-apk-guest.log'),await guestLogs());
 }

 if(mode==='firefox'){try{await evaluate("document.querySelector('#power-stop').click()");await delay(300);await evaluate("document.querySelector('#stop-yes').click()");await delay(7000);report.stopState=await evaluate("document.body.innerText.slice(-1500)");}catch(e){report.errors.push('Stop guest: '+e);}}
 }
 if(closed)throw Error('Resource monitor stopped the run');
 report.finishedNormally=true;
}catch(e){report.errors.push({ms:time(),error:String(e),stack:e.stack});report.finishedNormally=false;}
finally{
 if(monitor){monitor.postMessage('stop');await Promise.race([new Promise(resolve=>monitor.once('exit',resolve)),delay(3000).then(()=>monitor.terminate())]);}
 try{if(ws?.readyState===WebSocket.OPEN){await send('Browser.close',{},5000).catch(()=>{});ws.close();}}catch{}await delay(1500);
 for(const p of processes().reverse())if(p.pid!==process.pid&&identity(p.pid)?.start===p.start){try{process.kill(p.pid,'SIGTERM');}catch{}}
 await delay(1000);for(const p of processes().reverse())if(p.pid!==process.pid&&identity(p.pid)?.start===p.start){try{process.kill(p.pid,'SIGKILL');}catch{}}
 await delay(200);report.remainingOwned=processes().filter(p=>p.pid!==process.pid);report.end=new Date().toISOString();report.elapsedMs=time();report.resourceSummary={pssPeakBytes:Math.max(0,...report.samples.map(s=>s.pssBytes||0)),rssSumPeakBytes:Math.max(0,...report.samples.map(s=>s.rssSumBytes)),minAvailableBytes:Math.min(...report.samples.map(s=>s.availableBytes)),samples:report.samples.length,pssSamples:report.samples.filter(s=>s.pssBytes!==null).length,pssIntervalMs:report.configuration.pssIntervalMs};save();console.log(JSON.stringify({run,mode,finishedNormally:report.finishedNormally,elapsedMs:report.elapsedMs,io:report.io,resources:report.resourceSummary,remainingOwned:report.remainingOwned.length,errors:report.errors.slice(-3)}));process.exitCode=report.finishedNormally&&report.remainingOwned.length===0?0:1;
}
