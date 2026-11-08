#!/usr/bin/env node
import {nativeQuitDialogVisible} from './native-quit-visual.mjs';
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
const productionBase=process.env.LINUXONWEB_PRODUCTION_BASE||null;
if(!runArg || !['firefox','io','idle','home-tests','io-compare','input-timing','home-inventory','cache-export','seed-tests','mount-tests','writeback-tests','compat-export','package-corrupt-setup','barrier-tests','lookup-tests'].includes(mode) || !Number.isInteger(seconds) || seconds<20 || seconds>240) throw Error('usage: RUN_DIRECTORY firefox|io|idle SECONDS [QUERY]');
const run=path.resolve(runArg);
if(fs.existsSync(run))throw Error('fresh run required');
fs.mkdirSync(run,{recursive:true,mode:0o700});
const scratch=path.join(run,'t');fs.mkdirSync(scratch,{mode:0o700});
if(scratch.length>65)throw Error('Use a short disk scratch path');
const requestedRam=Number(process.env.LINUXONWEB_TEST_RAM_MIB||2048);
if(![1024,2048].includes(requestedRam))throw Error('Test RAM must be1024 or2048 MiB');
const profile=path.join(run,'profile');
let reusedTestProfile=null;
if(process.env.LINUXONWEB_REUSE_TEST_PROFILE){
 const source=fs.realpathSync(process.env.LINUXONWEB_REUSE_TEST_PROFILE),sourceRun=path.dirname(source);
 const receipt=JSON.parse(fs.readFileSync(path.join(sourceRun,'report.json'),'utf8'));
 if(path.basename(source)!=='profile'||path.dirname(sourceRun)!==path.dirname(run)||receipt.run!==sourceRun||!receipt.end||receipt.remainingOwned?.length!==0)throw Error('Reuse requires a closed sibling test profile with cleanup receipt');
 const prepared=performance.now();fs.cpSync(source,profile,{recursive:true,filter:entry=>!path.basename(entry).startsWith('Singleton')&&path.basename(entry)!=='DevToolsActivePort'});
 reusedTestProfile={source,sourceRun,start:receipt.start,end:receipt.end,copyMs:performance.now()-prepared};
}else fs.mkdirSync(profile,{mode:0o700});
// Keep this owned browser inside its inherited CPU-limited cgroup. Chromium's
// desktop D-Bus integration otherwise creates an unlimited user app scope.
const env={...process.env,TMPDIR:scratch,TMP:scratch,TEMP:scratch,XDG_CACHE_HOME:path.join(run,'cache'),DBUS_SESSION_BUS_ADDRESS:'unix:path='+path.join(run,'no-session-bus.sock')};
const start=performance.now(),time=()=>+(performance.now()-start).toFixed(3);
const report={schema:1,reusedTestProfile,start:new Date().toISOString(),mode,seconds,run,samples:[],events:[],console:[],errors:[],screenshots:[],configuration:{cpus:os.availableParallelism(),ramMiB:requestedRam,resolution:'1280x720',renderer:'webgl',query,monitorIntervalMs:1000,pssIntervalMs:5000},acceptance:'Unreviewed; screenshots and interaction required'};
function save(){fs.writeFileSync(path.join(run,'report.json'),JSON.stringify(report,null,2)+'\n');}
function identity(pid){try{const st=fs.readFileSync(`/proc/${pid}/stat`,'utf8');const f=st.slice(st.lastIndexOf(')')+2).split(' ');const status=fs.readFileSync(`/proc/${pid}/status`,'utf8');return{pid,ppid:+f[1],group:+f[2],session:+f[3],start:f[19],ticks:+f[11]+ +f[12],rss:+(/VmRSS:\s*(\d+)/.exec(status)?.[1]||0)*1024,affinity:/Cpus_allowed_list:\s*(\S+)/.exec(status)?.[1],cgroup:fs.readFileSync(`/proc/${pid}/cgroup`,'utf8').trim()};}catch{return null;}}
const tracked=new Map([[process.pid,identity(process.pid)]]);
function processes(){const all=fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x)).map(x=>identity(+x)).filter(Boolean);const owned=new Map(all.filter(x=>tracked.get(x.pid)?.start===x.start).map(x=>[x.pid,x]));let changed=true;while(changed){changed=false;for(const p of all)if(!owned.has(p.pid)&&owned.has(p.ppid)){owned.set(p.pid,p);changed=true;}}for(const p of owned.values())tracked.set(p.pid,p);return[...owned.values()];}
// Wait for the executor's inherited quota before spawning any owned child.
const inheritedQuotaDeadline=performance.now()+10000;
for(;;){const group=fs.readFileSync('/proc/self/cgroup','utf8');const quota=fs.readFileSync('/sys/fs/cgroup/cpulimit.slice/cpu.max','utf8').trim().split(/\s+/);if(group.split('\n').some(x=>x.startsWith('0::/cpulimit.slice/'))&&quota[0]!=='max'&&Number(quota[0])/Number(quota[1])<=3)break;if(performance.now()>=inheritedQuotaDeadline)throw Error('Inherited common CPU quota was not established before child launch');await delay(100);}
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
async function typeGuestCommand(command) {
 const unshifted={' ':['Space',32],'-':['Minus',189],'=':['Equal',187],'[':['BracketLeft',219],']':['BracketRight',221],';':['Semicolon',186],"'":['Quote',222],'`':['Backquote',192],'\\':['Backslash',220],',':['Comma',188],'.':['Period',190],'/':['Slash',191]};
 const shifted={'~':'`','!':'1','@':'2','#':'3','$':'4','%':'5','^':'6','&':'7','*':'8','(':'9',')':'0','_':'-','+':'=','{':'[','}':']',':':';','"':"'",'|':'\\','<':',','>':'.','?':'/'};
 for(const c of command){const upper=/^[A-Z]$/.test(c),base=shifted[c]??(upper?c.toLowerCase():c),mod=upper||shifted[c]?8:0;let pair=unshifted[base];if(!pair)pair=/^[a-z]$/.test(base)?['Key'+base.toUpperCase(),base.toUpperCase().charCodeAt(0)]:/^[0-9]$/.test(base)?['Digit'+base,base.charCodeAt(0)]:null;if(!pair)throw Error('Unsupported native command character');
  const shift={key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,nativeVirtualKeyCode:16};if(mod)await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...shift,modifiers:8});try{await pressKey({key:c,code:pair[0],windowsVirtualKeyCode:pair[1],nativeVirtualKeyCode:pair[1],text:c,unmodifiedText:base},mod);}finally{if(mod)await send('Input.dispatchKeyEvent',{type:'keyUp',...shift,modifiers:0});}await delay(10);
 }
 await pressKey({key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
}
const packageBaseCheckScript = `#!/bin/busybox sh
BB=/bin/busybox
failures=0
check() { label="$1"; shift; if "$@" >/dev/console 2>&1; then echo "PACKAGE_BASE_CHECK $label PASS" >/dev/console; else echo "PACKAGE_BASE_CHECK $label FAIL" >/dev/console; failures=$((failures+1)); fi; }
check helper-status /usr/sbin/apk-persist status
check optional-gzip-absent "$BB" test ! -e /usr/bin/gzip
check optional-tar-absent "$BB" test ! -e /usr/bin/tar
check protected-native-database /sbin/apk info --installed apk-tools busybox ca-certificates curl
check protected-world "$BB" cmp /etc/apk/world /etc/linuxonweb-packages/base-world
check user-marker "$BB" grep -qx package-production-20261103 /home/admin/.package-persistence-production
check corruption-evidence "$BB" test -s /home/admin/.package-recovery-original.apk
if "$BB" test "$failures" = 0; then echo PACKAGE_BASE_RECOVERY_VERIFIED >/dev/console; else echo "PACKAGE_BASE_RECOVERY_FAILED failures=$failures" >/dev/console; fi
exit "$failures"
`;
async function preparePackageBaseCheck(script) {
 if(location.origin!=='http://127.0.0.1:38082'||!document.querySelector('#power-stop')?.hidden)throw Error('Base fixture origin or idle state differs');
 const h=await(await import('./persistent-home.mjs')).openPersistentHome();
 try {const admin=await h.lookup(h.root,'admin');if(!admin)throw Error('Owned admin home absent');const marker=await h.lookup(admin,'.package-persistence-production');if(!marker)throw Error('Owned user marker absent');const f=await h.open(marker,0);let value;try{value=new TextDecoder().decode(await h.read(marker,f,0n,128));}finally{await h.release(marker,f);}if(value!=='package-production-20261103\n')throw Error('Owned marker differs');if(await h.lookup(admin,'.package-base-check.sh'))throw Error('Base fixture path already exists');const node=await h.create(admin,'.package-base-check.sh',2,{mode:0o700,uid:1000,gid:1000});const bytes=new TextEncoder().encode(script);await h.write(node.node,node.handle,0n,bytes);await h.release(node.node,node.handle);await h.settle();return {scope:'Owned-clone native assertion fixture, not product payload',path:'/home/admin/.package-base-check.sh',bytes:bytes.length,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join(''),settled:true};}finally{await h.destroy();}
}

async function preparePackageNegativeFixture(expectedGzip) {
   if(location.origin!=='http://127.0.0.1:38082'||!document.querySelector('#power-stop')?.hidden)throw Error('Fixture origin or idle state differs');
   const module=await import('./persistent-home.mjs'),h=await module.openPersistentHome();
   const text=new TextDecoder(),encode=new TextEncoder(),hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
   async function find(parts){let n=h.root;for(const part of parts){n=await h.lookup(n,part);if(!n)throw Error('Controlled fixture path absent: '+parts.join('/'));}return n;}
   async function read(n,limit=16*1024*1024){const size=Number((await h.getattr(n)).size);if(!Number.isSafeInteger(size)||size<0||size>limit)throw Error('Fixture read bound');const f=await h.open(n,0);try{return await h.read(n,f,0n,size);}finally{await h.release(n,f);}}
   let receipt;
   try{
    const marker=text.decode(await read(await find(['admin','.package-persistence-production']),128));if(marker!=='package-production-20261103\n')throw Error('Owned fixture user marker differs');
    const activeNode=await find(['.linuxonweb-packages','active']),active=await read(activeNode,256),pointer=text.decode(active).trim().split(/\s+/);if(pointer.length!==2||!/^generation-[A-Za-z0-9]+$/.test(pointer[0])||!/[a-f0-9]{64}/.test(pointer[1]))throw Error('Fixture pointer protocol differs');
    const packagePath=['.linuxonweb-packages',pointer[0],'packages','gzip-1.14-r0.apk'],node=await find(packagePath),attrs=await h.getattr(node);if(attrs.uid!==0||attrs.gid!==0)throw Error('Fixture package ownership differs');
    const before=await read(node),beforeSha256=await hash(before);if(beforeSha256!==expectedGzip)throw Error('Fixture APK is not the exact accepted signed archive');
    const admin=await find(['admin']);if(await h.lookup(admin,'.package-recovery-original.apk'))throw Error('Fresh fixture backup already exists');
    const backup=await h.create(admin,'.package-recovery-original.apk',2,{mode:0o644,uid:1000,gid:1000});await h.write(backup.node,backup.handle,0n,before);await h.release(backup.node,backup.handle);
    const suffix=encode.encode('recovery-fixture-corruption\n'),f=await h.open(node,2);try{await h.write(node,f,BigInt(before.length),suffix);}finally{await h.release(node,f);}await h.settle();
    const after=await read(node);if(after.length!==before.length+suffix.length||text.decode(after.subarray(before.length))!=='recovery-fixture-corruption\n')throw Error('Fixture corruption write differs');
    receipt={scope:'Controlled negative-fixture preparation only; no guest recovery action performed',origin:location.origin,generation:pointer[0],activePointerSha256:await hash(active),manifestSha256:pointer[1],packagePath:'/home/'+packagePath.join('/'),beforeSha256,afterSha256:await hash(after),beforeBytes:before.length,afterBytes:after.length,originalBackup:'/home/admin/.package-recovery-original.apk',userMarkerVerified:true,rootOwnershipVerified:true,durableSettleAwaited:true};
   }finally{await h.destroy();}
   const verify=await module.openPersistentHome({readOnly:true});try{let n=verify.root;for(const part of receipt.packagePath.slice('/home/'.length).split('/')){n=await verify.lookup(n,part);if(!n)throw Error('Closed fixture path absent');}const f=await verify.open(n,0);try{const bytes=await verify.read(n,f,0n,receipt.afterBytes);if(await hash(bytes)!==receipt.afterSha256)throw Error('Fixture hash changed after close/reopen');}finally{await verify.release(n,f);}}finally{await verify.destroy();}
   return {...receipt,closedReopenedHashVerified:true};

}

async function guestLogs(){return await evaluate("import('./main.js').then(m=>m.guestLogs.history.rows.map(r=>r.text).join('\\n'))");}

function readinessSignals(logs, nonce) {
 const found=[];for(const line of String(logs).split('\n')){const match=/LOW_READY (\{.*\})/.exec(line);if(!match)continue;try{let value;try{value=JSON.parse(match[1]);}catch{value=JSON.parse(JSON.parse('"'+match[1]+'"'));}if(value.schema===1&&value.nonce===nonce&&['paint','focus','keydown','keyup','input','typed','navigate','complete','regression-paint'].includes(value.phase))found.push(value);}catch{}}
 return found;
}
async function readinessProbe(paint,nonce) {
 if(!/^[a-z]{12,32}$/.test(nonce))throw Error('Invalid readiness nonce');
 const gate=report.readiness={nonce,paint,paintObservedLaunchMs:time()-bootAt,observations:[],scope:'Test-only nonce panel appended to original GPU workload; actual Firefox keyboard input/navigation',accepted:false};save();
 const waitPhase=async(phase,boundMs)=>{const until=time()+boundMs;while(time()<until){const logs=await guestLogs();fs.writeFileSync(path.join(run,'guest.log'),logs);const signal=readinessSignals(logs,nonce).find(v=>v.phase===phase);if(signal){const observation={phase,signal,observedLaunchMs:time()-bootAt,observedUtc:new Date().toISOString()};gate.observations.push(observation);save();return observation;}await delay(250);}throw Error('Readiness '+phase+' acknowledgement deadline '+boundMs+'ms');};
 if(paint.dpr!==1||![paint.innerScreenX,paint.innerScreenY,paint.input?.x,paint.input?.y,paint.input?.width,paint.input?.height].every(Number.isFinite))throw Error('Readiness coordinate contract unavailable');
 await shot('readiness-painted');
 const canvas=await evaluate("(()=>{const c=document.querySelector('canvas'),r=c.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,bufferWidth:c.width,bufferHeight:c.height};})()");
 const guestX=paint.innerScreenX+paint.input.x+paint.input.width/2,guestY=paint.innerScreenY+paint.input.y+paint.input.height/2;
 if(!(guestX>0&&guestX<1280&&guestY>0&&guestY<720))throw Error('Readiness input outside guest display');
 const x=canvas.left+guestX*canvas.width/1280,y=canvas.top+guestY*canvas.height/720;gate.inputLocation={canvas,guestX,guestY,x,y};
 gate.inputStartLaunchMs=time()-bootAt;await clickGuest(x,y);gate.focus=await waitPhase('focus',20000);await shot('readiness-focused');
 const keyInfo=c=>({key:c,code:'Key'+c.toUpperCase(),windowsVirtualKeyCode:c.toUpperCase().charCodeAt(0),nativeVirtualKeyCode:c.toUpperCase().charCodeAt(0),text:c,unmodifiedText:c});
 let lastInputSignature=null;
 const exactValue=async(expected,label,boundMs=5000)=>{const until=time()+boundMs;while(time()<until){const logs=await guestLogs();fs.writeFileSync(path.join(run,'guest.log'),logs);const signal=readinessSignals(logs,nonce).filter(v=>v.phase==='input').at(-1);const signature=signal?String(signal.epochMs)+':'+signal.value:null;if(signal?.value===expected){lastInputSignature=signature;return {label,expected,observedLaunchMs:time()-bootAt};}if(signature!==lastInputSignature&&signal?.value&&!expected.startsWith(signal.value)&&signal.value.length>=expected.length)throw Error('Input '+label+' differs: '+JSON.stringify({expected,actual:signal.value}));await delay(100);}throw Error('Input '+label+' deadline');};
 const clearInput=async()=>{const control={key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,nativeVirtualKeyCode:17};await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...control,modifiers:2});try{await pressKey({key:'a',code:'KeyA',windowsVirtualKeyCode:65,nativeVirtualKeyCode:65},2);}finally{await send('Input.dispatchKeyEvent',{type:'keyUp',...control,modifiers:0});}await pressKey({key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8});return exactValue('','modifier-select-all-and-delete');};
 const runInputChecks=async()=>{
  gate.inputChecks=[];
  await send('Input.dispatchKeyEvent',{type:'keyDown',...keyInfo('a')});await delay(650);gate.inputChecks.push(await exactValue('a','held-key-no-invented-repeat'));
  for(let n=2;n<=4;n++){await send('Input.dispatchKeyEvent',{type:'keyDown',...keyInfo('a'),autoRepeat:true});gate.inputChecks.push(await exactValue('a'.repeat(n),'explicit-host-repeat-'+n));}
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,nativeVirtualKeyCode:65});gate.inputChecks.push(await clearInput());
  const shift={key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,nativeVirtualKeyCode:16};await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...shift,modifiers:8});try{await pressKey({...keyInfo('a'),key:'A',text:'A'},8);}finally{await send('Input.dispatchKeyEvent',{type:'keyUp',...shift,modifiers:0});}gate.inputChecks.push(await exactValue('A','shift-combination'));gate.inputChecks.push(await clearInput());
  for(const c of 'taptest'){await pressKey(keyInfo(c));await delay(20);}gate.inputChecks.push(await exactValue('taptest','rapid-taps'));gate.inputChecks.push(await clearInput());
  await send('Input.dispatchKeyEvent',{type:'keyDown',...keyInfo('b')});gate.inputChecks.push(await exactValue('b','focus-loss-start'));await evaluate("document.querySelector('#settings-toggle').focus({preventScroll:true})");await delay(650);gate.inputChecks.push(await exactValue('b','focus-loss-releases-held-key'));await send('Input.dispatchKeyEvent',{type:'keyUp',key:'b',code:'KeyB',windowsVirtualKeyCode:66,nativeVirtualKeyCode:66});await evaluate("document.querySelector('canvas').focus({preventScroll:true})");gate.inputChecks.push(await clearInput());save();
 };
 if(options.get('input-check')==='1'&&options.get('input-check-after-ready')!=='1')await runInputChecks();
 gate.typingProtocol=options.get('input-sequence')==='rapid'?'Physical rapid key sequence, each intended hold20ms and gap20ms; exact native text required':'Controlled pacing: one physical keypress followed by exact native input acknowledgment';gate.inputAcknowledgments=[];
 if(options.get('input-sequence')==='rapid'){
  for(const c of nonce){await pressKey(keyInfo(c));await delay(20);}
 }else for(let index=0;index<nonce.length;index++){
  const c=nonce[index],expected=nonce.slice(0,index+1);
  await pressKey({key:c,code:'Key'+c.toUpperCase(),windowsVirtualKeyCode:c.toUpperCase().charCodeAt(0),nativeVirtualKeyCode:c.toUpperCase().charCodeAt(0),text:c,unmodifiedText:c});
  const until=time()+5000;let acknowledged=false;
  while(time()<until){const logs=await guestLogs();fs.writeFileSync(path.join(run,'guest.log'),logs);const actual=readinessSignals(logs,nonce).filter(v=>v.phase==='input').at(-1);
   if(actual?.value===expected){gate.inputAcknowledgments.push({index,value:actual.value,observedLaunchMs:time()-bootAt});acknowledged=true;break;}
   if(actual?.value&&!expected.startsWith(actual.value))throw Error('Readiness exact input mismatch: '+JSON.stringify({index,expected,actual:actual.value}));
   await delay(250);
  }
  if(!acknowledged)throw Error('Readiness character acknowledgment deadline: '+index);await delay(20);
 }
 gate.keysSentLaunchMs=time()-bootAt;save();

 gate.typed=await waitPhase('typed',20000);if(gate.typed.signal.value!==nonce)throw Error('Readiness typed value differs');await shot('readiness-typed');
 gate.enterLaunchMs=time()-bootAt;await pressKey({key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
 gate.complete=await waitPhase('complete',30000);if(gate.complete.signal.value!==nonce||gate.complete.signal.title!=='READINESS COMPLETE'||gate.complete.signal.href!=='file:///opt/firefox/gpu-check/readiness-complete.html?nonce='+nonce)throw Error('Readiness navigation identity differs');
 await shot('readiness-complete');gate.completeScreenshotLaunchMs=time()-bootAt;gate.completeScreenshotNavigationMs=gate.completeScreenshotLaunchMs+bootAt-report.navigationAtMs;gate.keyboardNavigationPassed=true;gate.thirtySecondGate=gate.completeScreenshotLaunchMs<=30000;gate.acceptance='Keyboard and distinct-navigation protocol passed; visible complete screenshot requires independent review';save();
 if(options.get('input-check')==='1'&&options.get('input-check-after-ready')==='1'){
  const observed=await waitPhase('regression-paint',10000),position=observed.signal;if(position.dpr!==1||![position.innerScreenX,position.innerScreenY,position.input?.x,position.input?.y,position.input?.width,position.input?.height].every(Number.isFinite))throw Error('Post-readiness input coordinates absent');
  const nativeX=position.innerScreenX+position.input.x+position.input.width/2,nativeY=position.innerScreenY+position.input.y+position.input.height/2;if(nativeX<0||nativeX>1280||nativeY<0||nativeY>720)throw Error('Post-readiness input outside display');
  const priorFocus=readinessSignals(await guestLogs(),nonce).filter(v=>v.phase==='focus').at(-1);gate.postReadinessInput={startedLaunchMs:time()-bootAt,readinessTimestampUnchanged:true,priorFocusEpochMs:priorFocus?.epochMs??null};await clickGuest(canvas.left+nativeX*canvas.width/1280,canvas.top+nativeY*canvas.height/720);
  const focusDeadline=time()+10000;let regressionFocused=false;while(time()<focusDeadline){const focus=readinessSignals(await guestLogs(),nonce).filter(v=>v.phase==='focus').at(-1);if(focus&&focus.epochMs>(priorFocus?.epochMs??0)&&focus.epochMs>=gate.complete.signal.epochMs&&focus.value===''){gate.postReadinessInput.nativeFocus={signal:focus,observedLaunchMs:time()-bootAt};regressionFocused=true;break;}await delay(100);}if(!regressionFocused)throw Error('Distinct native post-readiness focus acknowledgment absent');
  const previous=readinessSignals(await guestLogs(),nonce).filter(v=>v.phase==='input').at(-1);lastInputSignature=previous?String(previous.epochMs)+':'+previous.value:null;
  await runInputChecks();gate.postReadinessInput.completedLaunchMs=time()-bootAt;await shot('post-readiness-keyboard');save();
 }
}
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
async function stopProductionGuest(label, checkKeys=false) {
 const before=await evaluate("({timeOrigin:performance.timeOrigin,status:document.querySelector('#status')?.textContent})");
 await send('Target.setDiscoverTargets',{discover:true});
 const targetsBefore=(await send('Target.getTargets')).targetInfos,workerTargets=targetsBefore.filter(t=>t.type==='worker');
 const stop={label,before,targetsBefore,workerTargetsBefore:workerTargets,workerCountBefore:workerTargets.length,dialogRequestedLaunchMs:time()-bootAt};(report.stops??=[]).push(stop);save();
 if(checkKeys){await evaluate("document.querySelector('canvas').focus({preventScroll:true})");await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,nativeVirtualKeyCode:16,modifiers:8});await delay(80);}
 await evaluate("document.querySelector('#power-stop').click()");
 if(checkKeys){await delay(100);const input=await evaluate('({dom:globalThis.__gpt6InputDom??[],queue:globalThis.__gpt6InputQueue??null})');fs.writeFileSync(path.join(run,label+'-stop-input.json'),JSON.stringify(input));const last=input.queue?.events?.filter(e=>e.phase==='enqueued'&&e.type===1&&e.code===42).slice(-2);if(!last||last.length!==2||last[0].value!==1||last[1].value!==0)throw Error('Stop dialog did not release held Shift');stop.keyRelease={pass:true,events:last};await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,nativeVirtualKeyCode:16,modifiers:0});}
 stop.confirmationRequestedLaunchMs=time()-bootAt;
 stop.dispatch=await evaluate("(()=>{const button=document.querySelector('#stop-yes');if(!button||button.closest('[hidden]'))throw Error('Actual Stop confirmation is not visible');const requestedAt=performance.timeOrigin+performance.now();button.click();return {requestedAt,afterDispatchAt:performance.timeOrigin+performance.now(),statusAfterDispatch:document.querySelector('#status')?.textContent};})()");save();
 if(stop.dispatch.statusAfterDispatch!=='stopping…')throw Error('Actual Stop handler did not enter stopping state');
 const until=time()+20000;let idle=null;
 while(time()<until){try{const state=await evaluate("({timeOrigin:performance.timeOrigin,ready:document.readyState,status:document.querySelector('#status')?.textContent,stopHidden:document.querySelector('#power-stop')?.hidden,terminalPresent:!!document.querySelector('#terminal')})");if(state.timeOrigin!==before.timeOrigin&&state.ready==='complete'&&state.stopHidden&&state.status==='idle'){idle=state;break;}}catch(e){if(!/context|Cannot find|destroyed/i.test(String(e)))throw e;}await delay(100);}
 if(!idle)throw Error('Actual Stop did not reload into idle within20s');
 stop.idle=idle;stop.idleObservedLaunchMs=time()-bootAt;
 const old=new Set(workerTargets.map(t=>t.targetId)),workerDeadline=time()+5000;let afterWorkers;stop.workerTeardownObservations=[];
 do {afterWorkers=(await send('Target.getTargets')).targetInfos.filter(t=>t.type==='worker');stop.workerTeardownObservations.push({observedLaunchMs:time()-bootAt,count:afterWorkers.length,oldRemaining:afterWorkers.filter(t=>old.has(t.targetId)).length});if(!afterWorkers.length)break;await delay(250);}while(time()<workerDeadline);
 stop.targetsAfter=(await send('Target.getTargets')).targetInfos;stop.workerTargetsAfter=afterWorkers;stop.workerCountAfter=afterWorkers.length;stop.oldGuestWorkerTargetsRemaining=afterWorkers.filter(t=>old.has(t.targetId)).length;stop.workerTeardownObservedLaunchMs=time()-bootAt;save();
 if(stop.oldGuestWorkerTargetsRemaining||afterWorkers.length)throw Error('Guest workers remain5s after observed UI Stop/reload');
 stop.pass=true;report.stopState=await evaluate("document.body.innerText.slice(-1500)");save();return stop;
}

async function warmRestart(){
 const before=await guestLogs();const beforePids=[...new Set([...String(before).matchAll(/\[(\d+), Main Thread\]/g)].map(m=>Number(m[1])))];
 report.warmRestart={kind:'visible-about-profiles-restart',expectedProfile:'/home/admin/.mozilla/firefox/http1-profile',beforePids,preparationAtMs:time()};
 report.warmRestart.beforeProfile=await profileSnapshot('cold');
 report.warmRestart.prepare=await typeGuestAddress('about:profiles','warm-prepare');
 await delay(options.get('warm-restart')==='auto'?10000:4000);await shot('warm-about-profiles');save();
 console.log(JSON.stringify({phase:'awaiting-visible-restart-click',run,controlFile:path.join(run,'warm-control.json'),deadlineMs:90000}));
 const deadline=time()+90000;let action=options.get('warm-restart')==='auto'?{action:'restart-click',x:952,y:370,reference:'Reviewed warm1/warm-about-profiles.png at identical1280x720 guest and1400x960 host viewport',automatic:true}:null;
 while(!action&&time()<deadline){try{action=JSON.parse(fs.readFileSync(path.join(run,'warm-control.json'),'utf8'));break;}catch{}await delay(100);}
 if(action?.action!=='restart-click'||!Number.isFinite(action.x)||!Number.isFinite(action.y)||action.x<0||action.x>1400||action.y<0||action.y>960)throw Error('Visible restart click missing or invalid within90s');
 report.warmRestart.action=action;report.warmRestart.requestAtMs=time();report.warmRestart.requestAtUtc=new Date().toISOString();await clickGuest(action.x,action.y);save();
 let nextShot=0,probed=false,secondProbed=false;
 const newPids=new Set();
 while(time()-report.warmRestart.requestAtMs<90000&&!closed){
  const elapsed=(time()-report.warmRestart.requestAtMs)/1000;
  const logs=await guestLogs();fs.writeFileSync(path.join(run,'warm-guest.log'),String(logs));
  for(const match of String(logs).matchAll(/\[(\d+), Main Thread\]/g)){const pid=Number(match[1]);if(!beforePids.includes(pid)&&!newPids.has(pid)){newPids.add(pid);(report.warmRestart.newPidObservations??=[]).push({pid,requestElapsedMs:time()-report.warmRestart.requestAtMs});}}
  if(elapsed>=nextShot){await shot('warm-at'+Math.round(elapsed)+'s');nextShot+=10;}
  if(elapsed>=20&&!probed){probed=true;report.warmRestart.input20=await typeGuestAddress('about:blank','warm-input20');}
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
 if(options.get('owned-proxy')==='1'){
  if(!env.LINUXONWEB_BOOT_PACKAGE||testPort===3000)throw Error('Owned candidate proxy requires explicit image and nonproduction port');
  const proxy=child(process.execPath,['tools/startup-benchmark/gpt6-astra-timing-proxy.mjs',path.join(run,'proxy'),String(testPort),env.LINUXONWEB_TEST_DIAGNOSTIC_MODE==='performance'?'performance':env.LINUXONWEB_INPUT_DIAGNOSTIC==='1'?'input':'home',...(env.LINUXONWEB_TEST_EXTRAS?[path.resolve(env.LINUXONWEB_TEST_EXTRAS)]:[])],'proxy.log');
  let ready=false;for(let i=0;i<200;i++){if(proxy.exitCode!==null)throw Error('Owned candidate proxy exited '+proxy.exitCode);if(fs.existsSync(path.join(run,'proxy','ready.json'))){ready=true;break;}await delay(100);}if(!ready)throw Error('Owned candidate proxy readiness deadline');
  report.ownedProxy=JSON.parse(fs.readFileSync(path.join(run,'proxy','ready.json'),'utf8'));
 }
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
 const targets=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());report.initialTargets=targets.map(({id,type,url,title})=>({id,type,url,title}));save();const pages=targets.filter(t=>t.type==='page');if(pages.length!==1||pages[0].url!=='about:blank'||targets.some(t=>['worker','shared_worker','service_worker'].includes(t.type)))throw Error('Fresh owned browser has unexpected restored pages or workers before navigation');const target=pages[0];
 if(productionBase&&(mode!=='firefox'||options.get('owned-proxy')==='1'||reusedTestProfile||options.has('readiness-nonce')))throw Error('Production HTTPS smoke requires an unmodified fresh Firefox route');
 const quotaUntil=time()+10000;let quotaReady=false;while(time()<quotaUntil&&!closed){const rows=report.samples.slice(-2);if(rows.length===2&&rows.every(row=>row.processes.some(p=>p.pid===browser.pid)&&row.commonCpuAncestors?.length&&!row.changedMembership?.length&&Object.values(row.quotaByGroup).every(q=>Number.isFinite(q.capacity)&&q.capacity>0&&q.capacity<=3))){quotaReady=true;report.configuration.descendantQuotaGate={samples:rows.map(r=>r.ms),beforeNavigation:true,allEffectiveAncestorCapsAtMostThree:true,commonSharedAncestors:rows[1].commonCpuAncestors};break;}await delay(100);}if(!quotaReady||closed)throw Error('Owned browser descendant quota verification failed before navigation');save();
 if(productionBase){
  const {authenticateOwnedHttps}=await import('./production-https-auth.mjs');
  report.productionAuthentication=await authenticateOwnedHttps({targetWebSocketUrl:target.webSocketDebuggerUrl,productionBase,grantFile:process.env.LINUXONWEB_PRODUCTION_GRANT_FILE,expectedManifestSha256:'9da17bf944a4d25d8f4c4811e93a0dc9ca76b7b37f52579544959c7ae18a4bd5',expectedVersion:'1a3951f0c48d',timeoutMs:30000,shouldAbort:()=>closed});save();
 }
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
 ws.addEventListener('message',e=>{const v=JSON.parse(e.data);if(v.id&&pending.has(v.id)){const p=pending.get(v.id);pending.delete(v.id);clearTimeout(p.timer);v.error?p.reject(Error(JSON.stringify(v.error))):p.resolve(v.result);}else if(v.method==='Target.targetDestroyed'){(report.destroyedTargets??=[]).push({ms:time(),targetId:v.params.targetId});}else if(v.method==='Tracing.tracingComplete'){traceStream=v.params.stream;}else if(v.method==='Network.responseReceived'&&productionBase){const u=new URL(v.params.response.url);if(u.origin===new URL(productionBase).origin&&u.pathname.startsWith('/linux/')){const rows=report.publicAssetResponses??=[];if(rows.length<2048)rows.push({ms:time(),path:u.pathname,status:v.params.response.status,mimeType:v.params.response.mimeType,fromDiskCache:!!v.params.response.fromDiskCache});}}else if(v.method==='Runtime.consoleAPICalled'){if(report.console.length<3000)report.console.push({ms:time(),type:v.params.type,text:v.params.args.map(x=>x.value??x.description??'').join(' ').slice(0,8192)});}else if(v.method==='Runtime.exceptionThrown')report.errors.push({ms:time(),exception:v.params.exceptionDetails});});
 await send('Runtime.enable');await send('Page.enable');report.browserVersion=await send('Browser.getVersion');if(productionBase)await send('Network.enable');

 if(observeAfter>0&&(mode!=='firefox'||options.get('trace-startup')==='1'))throw Error('Quiet observation requires Firefox mode without tracing');
 if(options.get('trace-startup')==='1'){await send('Tracing.start',{transferMode:'ReturnAsStream',categories:'v8,disabled-by-default-v8.wasm,disabled-by-default-v8.runtime_stats'});tracing=true;}
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`globalThis.__gpt6InputDom=[];for(const type of ['keydown','keyup'])document.addEventListener(type,e=>{if(e.target?.tagName==='CANVAS'&&__gpt6InputDom.length<2048)__gpt6InputDom.push({type,code:e.code,key:e.key,repeat:e.repeat,eventTimeStamp:e.timeStamp,eventEpochMs:performance.timeOrigin+e.timeStamp,ms:performance.timeOrigin+performance.now()});},true);`});
 await send('Page.addScriptToEvaluateOnNewDocument',{source:`if(location.protocol==='http:'||location.protocol==='https:')localStorage.setItem('linuxonweb.machine-settings.v1',JSON.stringify({cpus:${report.configuration.cpus},ram:${report.configuration.ramMiB},resolution:'1280x720',backend:'webgl'}));`});
 const url=new URL('/linux/index.html',productionBase||`http://127.0.0.1:${testPort}`);url.searchParams.set('renderer','webgl');url.searchParams.set('gpubackend','webgl');if(mode==='firefox'&&options.get('manual-launch')!=='1')url.searchParams.set('firefox','1');for(const[k,v]of new URLSearchParams(query))url.searchParams.set(k,v);
 report.url=url.href;bootAt=time();report.navigationAtMs=bootAt;report.navigation=await send('Page.navigate',{url:url.href});if(report.navigation.errorText)throw Error('Navigation: '+report.navigation.errorText);
 if(observeAfter>0){report.quietObservation={startBootMs:time()-bootAt,startUtc:new Date().toISOString(),requestedEndBootMs:observeAfter*1000,excludes:['screenshots','Runtime.evaluate','log polling','tracing'],resourceMonitor:'CPU/RSS/quota1s; PSS5s; separateworker',passiveConsoleEvents:true};save();while(time()-bootAt<observeAfter*1000&&!closed)await delay(200);report.quietObservation.endBootMs=time()-bootAt;report.quietObservation.endUtc=new Date().toISOString();if(closed)throw Error('Resource monitor stopped quiet observation');}
 for(let i=0;i<200;i++){try{if(await evaluate("document.readyState==='complete' && !!document.querySelector('#cpu-cores')"))break;}catch{}await delay(100);}
 report.initial=await evaluate("({cores:navigator.hardwareConcurrency,crossOriginIsolated,settings:localStorage.getItem('linuxonweb.machine-settings.v1'),url:location.href,pageTimeOrigin:performance.timeOrigin,pageNow:performance.now()})");if(report.initial.cores!==report.configuration.cpus)throw Error('Native browser CPU count differs from test affinity');save();
 if(productionBase){
  report.productionFooter=await evaluate(`(async()=>{const response=await fetch('./server-build.json',{cache:'no-store',credentials:'same-origin'});if(!response.ok)throw Error('Production footer unavailable');const info=await response.json();const loaded=document.querySelector('meta[name="webapp-revision"]')?.content;if(info.schema!==1||loaded!==info.webapp?.version||info.runtime?.version!=='1a3951f0c48d')throw Error('Production footer identity mismatch');return {loadedRevision:loaded,availableRevision:info.webapp.version,runtimeVersion:info.runtime.version,serverStarted:info.server.started,packageVersions:info.packages};})()`);save();
 }
 if(mode==='firefox'&&reusedTestProfile){report.beforeLaunchProfile=await profileSnapshot('before-launch',true);report.retainedOrigin=await evaluate('location.origin');if(report.retainedOrigin!==`http://127.0.0.1:${testPort}`)throw Error('Retained profile origin differs');if(!JSON.parse(fs.readFileSync(path.join(run,'before-launch-profile.json'),'utf8')).files.some(f=>f.path==='/home/admin/.mozilla/firefox/http1-profile/user.js'))throw Error('Retained Firefox profile marker absent at fixed origin');save();}
 if(mode==='firefox'&&options.get('package-production')==='base'&&options.get('base-script')==='1'){if(!reusedTestProfile)throw Error('Native base assertion requires owned closed profile clone');report.packageBaseFixture=await evaluate('('+preparePackageBaseCheck.toString()+')('+JSON.stringify(packageBaseCheckScript)+')');fs.writeFileSync(path.join(run,'package-base-check.sh'),packageBaseCheckScript);save();}
 if(mode==='firefox'&&options.get('manual-launch')==='1'){if(observeAfter>0)throw Error('Manual launch cannot use quiet startup pre-wait');const desktopOnly=options.get('package-desktop-only')==='1';report.launchRequest={kind:desktopOnly?'production Start desktop WM menu':'production Start Firefox menu',hostMs:time(),utc:new Date().toISOString()};bootAt=report.launchRequest.hostMs;report.launchRequest.page=await evaluate(`(()=>{document.querySelector('#boot').click();const button=document.querySelector('${desktopOnly?'#start-x':'#start-firefox'}');if(!button||button.disabled||button.closest('[hidden]'))throw Error('Production launch menu unavailable');const requestAtMs=performance.now();button.click();return {requestAtMs,pageTimeOrigin:performance.timeOrigin};})()`);save();}
 if(mode==='package-corrupt-setup'){
  if(!reusedTestProfile?.sourceRun.endsWith('/pkgprod-verify1'))throw Error('Negative fixture requires the exact known-good closed owned profile clone');
  const expectedGzip=crypto.createHash('sha256').update(fs.readFileSync('out/gpt-6-astra-pro_builtin-agents_packages-mobile-20261103/public-repository/wasm32/gzip-1.14-r0.apk')).digest('hex');
  report.packageNegativeFixture=await evaluate('('+preparePackageNegativeFixture.toString()+')('+JSON.stringify(expectedGzip)+')');save();
 }else if(mode==='compat-export'){
 const text=await evaluate(`(async()=>{const h=await(await import('./persistent-home.mjs')).openPersistentHome({readOnly:true});try{let n=h.root;for(const part of ['admin','.mozilla','firefox','http1-profile','compatibility.ini']){n=await h.lookup(n,part);if(!n)throw Error('Controlled fixture compatibility file absent');}if(Number((await h.getattr(n)).size)>2048)throw Error('Compatibility file outside bounded generated metadata size');const bytes=await h.read(n,{},0n,2048);return new TextDecoder().decode(bytes);}finally{await h.destroy();}})()`);
 const required=['LastVersion','LastOSABI','LastPlatformDir','LastAppDir'],keys=[...required,'InvalidateCaches'],fields={};
 for(const line of text.split(/\r?\n/)){if(!line||line==='[Compatibility]')continue;const at=line.indexOf('=');const key=line.slice(0,at),value=line.slice(at+1);if(!keys.includes(key)||Object.hasOwn(fields,key)||!value)throw Error('Unexpected compatibility metadata field');fields[key]=value;}
 if(required.some(k=>!fields[k]))throw Error('Compatibility metadata field missing');
 report.compatibilityExport={fields,sourceTestProfile:reusedTestProfile,onlyBuildMetadata:true};fs.writeFileSync(path.join(run,'compatibility.json'),JSON.stringify(report.compatibilityExport,null,2));
 }else if(mode==='cache-export'){await exportCodeCaches();
 }else if(mode==='home-inventory'){report.inventory=await profileSnapshot('inventory',true);
 }else if(mode==='input-timing'){
 await evaluate(`document.body.innerHTML='<textarea id="timing-target" autofocus></textarea>';globalThis.__timingEvents=[];for(const type of ['keydown','keyup'])document.addEventListener(type,e=>__timingEvents.push({type,code:e.code,key:e.key,repeat:e.repeat,eventTimeStamp:e.timeStamp,eventEpochMs:performance.timeOrigin+e.timeStamp,ms:performance.timeOrigin+performance.now()}),true);document.querySelector('#timing-target').focus()`);
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
 }else if(mode==='home-tests'||mode==='seed-tests'||mode==='mount-tests'||mode==='writeback-tests'||mode==='barrier-tests'||mode==='lookup-tests'){
 report.homeTests=[];
 for(const page of (mode==='lookup-tests'?['home-lookup.html','home-lookup-native.html']:mode==='barrier-tests'?['home-barrier.html']:mode==='writeback-tests'?['home-writeback.html']:mode==='mount-tests'?['home-mount.html']:mode==='seed-tests'?['startup-cache-seed.html','startup-cache-seed-v2.html']:['persistent-home.html','persistent-home-write.html'])){
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
 let nextShot=10,lastLogs=0;report.milestones={};while(time()-bootAt<seconds*1000&&!closed){const bootSeconds=(time()-bootAt)/1000;if(bootSeconds<observeAfter){await delay(500);continue;}if(bootSeconds>=nextShot){await shot('at'+Math.round(bootSeconds)+'s');nextShot+=20;}if(bootSeconds-lastLogs>=(options.has('readiness-nonce')?1:5)){try{const logs=await evaluate("import('./main.js').then(m=>m.guestLogs.history.rows.map(r=>r.text).join('\\n'))");fs.writeFileSync(path.join(run,'guest.log'),String(logs));report.lastLogAtMs=time();for(const marker of ['system image','machine started','home: persistent storage mounted','display: starting Xfbdev','starting /bin/aurora-wm','[wm-ready]','starting /bin/firefox','gl context 2 open','PBLJIT compile'])if(String(logs).includes(marker)&&report.milestones[marker]===undefined)report.milestones[marker]=time()-bootAt;}catch(e){report.errors.push({ms:time(),log:String(e)});}lastLogs=bootSeconds;const status=await evaluate("document.querySelector('#status')?.textContent??''");if(/^boot failed/.test(status))throw Error('Actual frontend boot failed; see retained guest.log');if(options.get('package-production')==='recover'&&fs.readFileSync(path.join(run,'guest.log'),'utf8').includes('apk-persist: RESTORE FAILED; desktop startup stopped'))break;if(options.has('readiness-nonce')&&!report.readiness){const nonce=options.get('readiness-nonce'),paint=readinessSignals(fs.readFileSync(path.join(run,'guest.log'),'utf8'),nonce).find(v=>v.phase==='paint');if(paint){if(options.get('cache-lifecycle-only')==='1'){report.readiness={nonce,paint,paintObservedLaunchMs:time()-bootAt,scope:'Cache lifecycle only; no keyboard/navigation usability acceptance',accepted:false};await shot('cache-lifecycle-painted');break;}await readinessProbe(paint,nonce);if(options.get('readiness-autostop')==='1')break;}}}if(options.get('probe-input')==='1'&&!inputProbed&&(options.get('probe-control')==='1'?fs.existsSync(path.join(run,'probe-now.json')):bootSeconds>=Math.max(20,Math.min(seconds-10,Number(options.get('probe-after-seconds')||110))))){
 inputProbed=true;report.inputProbe={startBootMs:time()-bootAt};if(options.get('probe-control')==='1')report.inputProbe.visualTrigger=JSON.parse(fs.readFileSync(path.join(run,'probe-now.json'),'utf8'));await shot('input-before');
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
 if(options.has('readiness-nonce')&&options.get('cache-lifecycle-only')!=='1'&&!report.readiness?.keyboardNavigationPassed)throw Error('Readiness protocol did not complete inside observation deadline');
 if(tracing){await send('Tracing.end');for(let i=0;i<100&&!traceStream;i++)await delay(100);if(!traceStream)throw Error('Trace completion absent');const fd=fs.openSync(path.join(run,'startup-trace.json'),'wx');let total=0;try{for(;;){const part=await send('IO.read',{handle:traceStream,size:1048576});const b=Buffer.from(part.data,part.base64Encoded?'base64':'utf8');total+=b.length;if(total>67108864)throw Error('Trace exceeds64MiB');fs.writeSync(fd,b);if(part.eof)break;}}finally{fs.closeSync(fd);await send('IO.close',{handle:traceStream});}report.traceBytes=total;tracing=false;}
 if(observeAfter>0)fs.writeFileSync(path.join(run,'guest.log'),await guestLogs());
 const startupTimings=await evaluate('globalThis.__gpt6StartupTimings ?? []');if(startupTimings.length){fs.writeFileSync(path.join(run,'startup-timings.json'),JSON.stringify(startupTimings));report.startupTimingEvents=startupTimings.length;}
 const logTimings=await evaluate("import('./main.js').then(m=>m.guestLogs.history.rows.map(r=>({id:r.id,text:r.text,firstAtMs:r.firstAtMs,firstAtEpochMs:r.firstAtEpochMs})))");fs.writeFileSync(path.join(run,'guest-log-timings.json'),JSON.stringify(logTimings));
 report.seedReceipt=await evaluate('globalThis.__gpt6SeedReceipt??null');
 const homeTimings=await evaluate('globalThis.__gpt6HomeTimings??null');if(homeTimings)fs.writeFileSync(path.join(run,'home-timings.json'),JSON.stringify(homeTimings,null,2));
 const inputDiagnostics=await evaluate('({dom:globalThis.__gpt6InputDom??[],queue:globalThis.__gpt6InputQueue??null})');fs.writeFileSync(path.join(run,'input-diagnostics.json'),JSON.stringify(inputDiagnostics));
 report.finalState=await evaluate("({text:document.body.innerText.slice(-6000),cores:navigator.hardwareConcurrency,status:document.querySelector('#status')?.textContent})");await shot('final');
 if(mode==='firefox'&&options.get('close-firefox')==='1'){
  const exitLogFloorId=await evaluate("import('./main.js').then(m=>m.guestLogs.history.rows.at(-1)?.id??-1)");
  report.nativeClose={kind:'Firefox Ctrl+Q, followed by native init exit observation from this launch after request',requestedLaunchMs:time()-bootAt,expectedExitStatus:0,exitLogFloorId};
  await evaluate("document.querySelector('canvas').focus({preventScroll:true})");
  const control={key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,nativeVirtualKeyCode:17};
  await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...control,modifiers:2});
  try{await pressKey({key:'q',code:'KeyQ',windowsVirtualKeyCode:81,nativeVirtualKeyCode:81},2);}finally{await send('Input.dispatchKeyEvent',{type:'keyUp',...control,modifiers:0});}
  const closeSeconds=Number(options.get('close-bound-seconds')||20);
  if(![20,60,90].includes(closeSeconds))throw Error('Unsupported native close bound');
  report.nativeClose.boundSeconds=closeSeconds;
  // Wait for the actual native dialog, not a blind 1.2s delay. The historical
  // cache-final-cold1 click preceded the prompt and could never close Firefox.
  // The visual gate recognizes a white modal, darkened backdrop and purple
  // Nightly confirmation button in the same screenshot. Unknown layouts fail
  // closed; no unverified blind click is allowed.
  const geometry=await evaluate("(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {viewport:{width:innerWidth,height:innerHeight},canvas:{left:r.left,top:r.top,width:r.width,height:r.height}};})()");
  const until=time()+closeSeconds*1000;
  let confirmed=false,exitedWithoutPrompt=false,attempts=0;
  while(time()<until){
   const frame=await send('Page.captureScreenshot',{format:'png'});
   attempts++;
   const bytes=Buffer.from(frame.data,'base64');
   if(nativeQuitDialogVisible(bytes,geometry.viewport,geometry.canvas)){
    const reference='native-quit-dialog-observed.png';
    fs.writeFileSync(path.join(run,reference),bytes);
    report.nativeClose.confirmation={kind:'Visual detection of current-launch native Quit Nightly dialog',reference,guestX:718.5,guestY:229,attempts,observedLaunchMs:time()-bootAt};
    save();
    await clickGuest(geometry.canvas.left+718.5*geometry.canvas.width/1280,geometry.canvas.top+229*geometry.canvas.height/720);
    confirmed=true;break;
   }
   const exitRows=await evaluate("import('./main.js').then(m=>m.guestLogs.history.rows.filter(r=>r.id>"+exitLogFloorId+").map(r=>r.text))");
   if(exitRows.some(row=>/firefox exited with status 0/.test(row))){
    report.nativeClose.confirmation={kind:'Native Firefox exited without a confirmation prompt',attempts,observedLaunchMs:time()-bootAt};
    exitedWithoutPrompt=true;break;
   }
   await delay(800);
  }
  report.nativeClose.dialogProbeAttempts=attempts;
  if(!confirmed&&!exitedWithoutPrompt){await shot('native-quit-dialog-unconfirmed');throw Error('Native Firefox Quit confirmation was not visually observed within close bound; no blind click attempted');}
  report.nativeClose.progress=[];let nextProgress=0;let exited=false;
  while(time()<until){if(time()>=nextProgress){const io=await evaluate('(()=>{const t=globalThis.__gpt6HomeTimings;return t?{active:t.active,busyMs:t.busyMs,writeCalls:t.methods.write?.calls,writeBytes:t.methods.write?.bytes,fsyncCalls:t.methods.fsync?.calls}:null})()');report.nativeClose.progress.push({observedLaunchMs:time()-bootAt,io});nextProgress=time()+5000;save();}const logs=await guestLogs();fs.writeFileSync(path.join(run,'closed-guest.log'),logs);const exitRows=await evaluate("import('./main.js').then(m=>m.guestLogs.history.rows.filter(r=>r.id>"+exitLogFloorId+").map(r=>({id:r.id,text:r.text})))");const exitLine=exitRows.find(r=>/firefox exited with status (\d+)/.test(r.text));const match=exitLine&&/firefox exited with status (\d+)/.exec(exitLine.text);if(match){report.nativeClose.exitLogRow=exitLine;report.nativeClose.status=Number(match[1]);report.nativeClose.observedLaunchMs=time()-bootAt;exited=true;break;}await delay(250);}
  await shot('native-close');if(!exited||report.nativeClose.status!==0)throw Error('Native Firefox Close did not report successful exit');
  report.nativeClose.profile=await profileSnapshot('closed',true);save();
 }
 if(mode==='firefox'&&['1','auto'].includes(options.get('warm-restart')))await warmRestart();
 if(mode==='firefox'&&(options.get('post-apk-check')==='1'||options.get('desktop-apk-check')==='1')){
  report.postApkCheck={startedBootMs:time()-bootAt,afterFixedGraphicsObservation:options.get('post-apk-check')==='1',dedicatedDesktopAcceptance:options.get('desktop-apk-check')==='1'};
  const gate=path.join(run,'allow-post-apk.json');let reviewed=options.get('desktop-apk-check')==='1';for(let i=0;!reviewed&&i<150;i++){if(fs.existsSync(gate)){report.postApkCheck.visualGate=JSON.parse(fs.readFileSync(gate,'utf8'));reviewed=true;break;}await delay(200);}if(!reviewed)throw Error('Post-APK check requires observed completed GPU benchmark before typing');
  if(!String(await guestLogs()).includes('[wm-ready]'))throw Error('Desktop package gate requires actual window-manager readiness');
  await evaluate("document.querySelector('[data-test=uname]').click()");await delay(5000);await shot('apk-terminal-before');
  await evaluate("document.querySelector('canvas')?.focus({preventScroll:true})");
  const commands=[['apk --version',3000],['sudo apk update && sudo apk add python3 coreutils',30000],['python3 --version',3000],['ls --version',3000],['python3 -m json.tool --help && echo python-desktop-ok',25000],['ls -ld /opt/firefox/browser /opt/firefox/browser/.purgecaches',3000]];
  report.postApkCheck.commands=[];
  for(let index=0;index<commands.length;index++){
   const [command,observeMs]=commands[index];
   for(const c of command){
    const special={' ':['Space',32,0],'-':['Minus',189,0],'.':['Period',190,0],'&':['Digit7',55,8],'/':['Slash',191,0]};const [code,vk,mod]=special[c]||(/^\d$/.test(c)?['Digit'+c,c.charCodeAt(0),0]:['Key'+c.toUpperCase(),c.toUpperCase().charCodeAt(0),0]);
    const shift={key:'Shift',code:'ShiftLeft',windowsVirtualKeyCode:16,nativeVirtualKeyCode:16};if(mod===8)await send('Input.dispatchKeyEvent',{type:'rawKeyDown',...shift,modifiers:8});
    try{await pressKey({key:c,code,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk,text:c,unmodifiedText:c},mod);}finally{if(mod===8)await send('Input.dispatchKeyEvent',{type:'keyUp',...shift,modifiers:0});}await delay(20);
   }
   await pressKey({key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13},0);await delay(observeMs);await shot('apk-command-'+index);report.postApkCheck.commands.push({command,observedBootMs:time()-bootAt});save();
  }
  report.postApkCheck.finishedBootMs=time()-bootAt;report.postApkCheck.acceptance='Requires visual review of native terminal output; no automatic pass from keystrokes';fs.writeFileSync(path.join(run,'post-apk-guest.log'),await guestLogs());
 }

 if(mode==='firefox'&&options.has('package-production')){
  const stage=options.get('package-production');
  const commands={"save": "sudo /bin/busybox sh -c 'echo package-production-20261103 > /home/admin/.package-persistence-production && /sbin/apk update >/dev/console 2>&1 && /sbin/apk add gzip tar >/dev/console 2>&1 && cp /etc/apk/world /home/admin/.package-world.ref && sha256sum /usr/bin/gzip /usr/bin/tar > /home/admin/.package-files.sha256 && /usr/sbin/apk-persist save >/dev/console 2>&1'", "verify": "sudo /bin/busybox sh -c '/usr/sbin/apk-persist status >/dev/console 2>&1 && /sbin/apk info --installed gzip tar >/dev/console 2>&1 && cmp /etc/apk/world /home/admin/.package-world.ref && sha256sum -c /home/admin/.package-files.sha256 >/dev/console 2>&1 && grep -qx package-production-20261103 /home/admin/.package-persistence-production && echo package-production-verified >/dev/console'", "corrupt": "sudo /bin/busybox sh -c '/usr/sbin/apk-persist status >/dev/console 2>&1 && g=$(/bin/busybox cut -d \" \" -f 1 /home/.linuxonweb-packages/active) && /bin/busybox cp \"/home/.linuxonweb-packages/$g/packages/gzip-1.14-r0.apk\" /home/admin/.package-recovery-original.apk && /bin/busybox printf \"recovery-fixture-corruption\\n\" >> \"/home/.linuxonweb-packages/$g/packages/gzip-1.14-r0.apk\" && echo PACKAGE_CORRUPTION_FIXTURE_READY >/dev/console'", "recover": "echo PACKAGE_RECOVERY_TYPED && apk-persist disable", "base": "sudo /bin/busybox sh -c '/usr/sbin/apk-persist status >/dev/console 2>&1 && /bin/busybox test ! -e /usr/bin/gzip && /bin/busybox test ! -e /usr/bin/tar && /sbin/apk info --installed apk-tools busybox ca-certificates curl >/dev/console 2>&1 && cmp /etc/apk/world /etc/linuxonweb-packages/base-world && grep -qx package-production-20261103 /home/admin/.package-persistence-production && /bin/busybox test -s /home/admin/.package-recovery-original.apk && echo PACKAGE_BASE_RECOVERY_VERIFIED >/dev/console'"};
  if(!Object.hasOwn(commands,stage))throw Error('Unknown production package stage');
  const before=await guestLogs();
  if(['verify','corrupt'].includes(stage)&&!before.includes('APK_PERSIST_RESTORED'))throw Error('Native restore acknowledgment absent before desktop verification');
  if(stage==='base'&&options.get('base-script')==='1')commands.base='sudo /bin/busybox sh /home/admin/.package-base-check.sh';
  report.productionPackage={stage,command:commands[stage],startedLaunchMs:time()-bootAt,bootImageUnchanged:true,route:stage==='recover'?'Actual GUI restore-failure console; physical keyboard reaches native hvc0 recovery shell':'Actual production test-command menu opens native Aurora terminal; physical keyboard sends native root shell command'};save();
  if(stage==='recover'){
   if(!before.includes('apk-persist: RESTORE FAILED; desktop startup stopped')||before.includes('display: starting Xfbdev'))throw Error('Corrupt generation did not stop desktop before X');
   report.productionPackage.recoveryUi=await evaluate("(()=>{const t=document.querySelector('#terminal'),a=document.querySelector('.xterm-helper-textarea');return {status:document.querySelector('#status')?.textContent,visible:!!t&&!!t.getClientRects().length,focused:document.activeElement===a,textarea:!!a,body:document.body.innerText.slice(-4000)};})()");
   const ui=report.productionPackage.recoveryUi;if(!ui.visible||!ui.textarea||!ui.focused||!ui.status.includes('package restore failed'))throw Error('Recovery console missing, hidden, unfocused, or status incorrect');
   await shot('package-recovery-before');
  }else{
   const desktopAttemptReady=before.includes('[wm-ready]')||(options.get('package-desktop-only')==='1'&&before.includes('aurora-wm: light compositor disabled by setting')&&before.includes('clipboard: X11 bridge ready'));if(!desktopAttemptReady)throw Error('Production package command lacks native desktop initialization evidence');
   await evaluate("document.querySelector('[data-test=uname]').click()");await delay(4000);await shot('package-terminal-before');await evaluate("document.querySelector('canvas').focus({preventScroll:true})");
  }
  await typeGuestCommand(commands[stage]);report.productionPackage.commandEnteredLaunchMs=time()-bootAt;save();
  const expected={save:'APK_PERSIST_SAVED',verify:'package-production-verified',corrupt:'PACKAGE_CORRUPTION_FIXTURE_READY',recover:'APK_PERSIST_DISABLED',base:'PACKAGE_BASE_RECOVERY_VERIFIED'}[stage],until=time()+60000;let acknowledged=false;
  while(time()<until){const logs=await guestLogs();fs.writeFileSync(path.join(run,'package-guest.log'),logs);if(logs.includes(expected)){report.productionPackage.acknowledgment={marker:expected,observedLaunchMs:time()-bootAt,observedUtc:new Date().toISOString()};acknowledged=true;break;}await delay(100);}
  if(!acknowledged){await shot('package-failure');throw Error('Production package native acknowledgment deadline');}
  if(stage==='save'&&options.get('path-audit')==='tar'){
   const auditFloor=(await guestLogs()).length;
   const command=`/bin/busybox sh -c '/bin/busybox id -u; echo "$PATH"; /bin/busybox which tar; tar --version' > /home/admin/.path-audit 2>&1; sudo /bin/busybox sh -c '/bin/busybox cat /home/admin/.path-audit > /dev/console; echo PACKAGE_PATH_AUDIT_DONE > /dev/console'`;
   await delay(500);await typeGuestCommand(command);
   const deadline=time()+30000;let output='';while(time()<deadline&&!closed){output=(await guestLogs()).slice(auditFloor);if(output.includes('PACKAGE_PATH_AUDIT_DONE'))break;await delay(100);}
   report.productionPackage.nonrootPathAudit={command,output,completed:output.includes('PACKAGE_PATH_AUDIT_DONE'),scope:'Ordinary uid1000 shell lookup first; sudo only relays already-collected output. No inference from privileged PATH.'};save();
   await shot('nonroot-path-audit');if(!report.productionPackage.nonrootPathAudit.completed)throw Error('Native ordinary command-path audit did not complete');
  }
  if(stage==='recover'){
   await shot('package-recovery-after');report.productionPackage.recoveryEcho=String(await guestLogs()).includes('PACKAGE_RECOVERY_TYPED');
   const stopped=await stopProductionGuest('recovery-disable');if(stopped.idle.terminalPresent)throw Error('Recovery console survived actual Stop reload');
   const restart=report.productionPackage.restart={kind:'same tab, actual Stop reload then Start Firefox',requestedLaunchMs:time()-bootAt};
   await evaluate("(()=>{document.querySelector('#boot').click();const b=document.querySelector('#start-firefox');if(!b||b.disabled||b.closest('[hidden]'))throw Error('Restart Firefox menu unavailable');b.click();})()");save();
   const restartedAt=time(),windowDeadline=restartedAt+180000;let contentWindow=false;while(time()<windowDeadline&&!closed){const logs=await guestLogs();fs.writeFileSync(path.join(run,'recovery-window-wait.log'),logs);if(logs.includes('gl context 2 open')){contentWindow=true;restart.contentContextObservedLaunchMs=time()-bootAt;break;}await delay(500);}if(!contentWindow)throw Error('Native Firefox content context absent within bounded recovery restart');
   const baseLogs=await guestLogs();fs.writeFileSync(path.join(run,'recovery-restarted-guest.log'),baseLogs);if(!baseLogs.includes('[wm-ready]')||baseLogs.includes('RESTORE FAILED')||baseLogs.includes('APK_PERSIST_RESTORED'))throw Error('Explicit disabled generation did not boot the pristine desktop base');
   restart.ui=await evaluate("({status:document.querySelector('#status')?.textContent,terminalPresent:!!document.querySelector('#terminal')})");if(restart.ui.terminalPresent)throw Error('Recovery-only console remains in normal GUI');await shot('package-recovery-restarted');
   restart.input=await typeGuestAddress('about:blank','recovery-physical-input');restart.input.acceptance='Requires independent visible exact address and completed blank-page review; real physical virtio keyboard path, no synthetic DOM input';save();
   await evaluate("document.querySelector('[data-test=uname]').click()");await delay(4000);await evaluate("document.querySelector('canvas').focus({preventScroll:true})");await typeGuestCommand(commands.base);
   const baseUntil=time()+30000;let verified=false;while(time()<baseUntil){const logs=await guestLogs();fs.writeFileSync(path.join(run,'recovery-base-verified.log'),logs);if(logs.includes('PACKAGE_BASE_RECOVERY_VERIFIED')){restart.verifiedLaunchMs=time()-bootAt;verified=true;break;}await delay(100);}if(!verified)throw Error('Same-tab pristine base and user-data verification failed');await shot('package-recovery-base-verified');
  }
 }
 if(mode==='firefox')await stopProductionGuest('final',options.get('input-check')==='1');
 }
 if(closed)throw Error('Resource monitor stopped the run');
 report.finishedNormally=true;
}catch(e){report.errors.push({ms:time(),error:String(e),stack:e.stack});report.finishedNormally=false;if(ws?.readyState===WebSocket.OPEN){
 try{await shot('failure');}catch{}
 try{fs.writeFileSync(path.join(run,'guest.log'),await guestLogs());}catch{}
 for(const [filename,expression] of [['failure-input-diagnostics.json','({dom:globalThis.__gpt6InputDom??[],queue:globalThis.__gpt6InputQueue??null})'],['failure-home-timings.json','globalThis.__gpt6HomeTimings??null'],['failure-startup-timings.json','globalThis.__gpt6StartupTimings??null']])try{fs.writeFileSync(path.join(run,filename),JSON.stringify(await evaluate(expression),null,2));}catch{}
}}
finally{
 if(monitor){monitor.postMessage('stop');await Promise.race([new Promise(resolve=>monitor.once('exit',resolve)),delay(3000).then(()=>monitor.terminate())]);}
 try{if(ws?.readyState===WebSocket.OPEN){await send('Browser.close',{},5000).catch(()=>{});ws.close();}}catch{}await delay(1500);
 for(const p of processes().reverse())if(p.pid!==process.pid&&identity(p.pid)?.start===p.start){try{process.kill(p.pid,'SIGTERM');}catch{}}
 await delay(1000);for(const p of processes().reverse())if(p.pid!==process.pid&&identity(p.pid)?.start===p.start){try{process.kill(p.pid,'SIGKILL');}catch{}}
 await delay(200);report.remainingOwned=processes().filter(p=>p.pid!==process.pid);report.end=new Date().toISOString();report.elapsedMs=time();report.resourceSummary={pssPeakBytes:Math.max(0,...report.samples.map(s=>s.pssBytes||0)),rssSumPeakBytes:Math.max(0,...report.samples.map(s=>s.rssSumBytes)),minAvailableBytes:Math.min(...report.samples.map(s=>s.availableBytes)),samples:report.samples.length,pssSamples:report.samples.filter(s=>s.pssBytes!==null).length,pssIntervalMs:report.configuration.pssIntervalMs};save();console.log(JSON.stringify({run,mode,finishedNormally:report.finishedNormally,elapsedMs:report.elapsedMs,io:report.io,resources:report.resourceSummary,remainingOwned:report.remainingOwned.length,errors:report.errors.slice(-3)}));process.exitCode=report.finishedNormally&&report.remainingOwned.length===0?0:1;
}
