// Isolated current159 native GPU diagnostic. Preparing this file launches nothing.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {prepareOwnedGpuBrowser,gpuSeedPath} from './owned-gpu-browser.mjs';
import {readHostNproc,selectHostCpus,guestCpuEvidence} from './firefox-host-cpus.mjs';
import {admitFirefoxGpuPipeline} from './admit-firefox-gpu-pipeline.mjs';
const repo=fileURLToPath(new URL('../../',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sourceSha='c0eaffe22a66bb97f94ff53dcb645e402eb50dea98b0976b66000ea615d4ac9f';
const probePrefix='FIREFOX_GPU_NATIVE_V1 ';
const rootPrefix='/mnt/p3/codex-build/gpu-service-root-oct06/';
const rendererIdentitySources=[
  {path:'/mnt/p6/build/firefox-nightly-musl-jit-full-20261002/source/firefox-159.0a1/dom/canvas/ClientWebGLContext.cpp',sha256:'8249d56c56703f68fbfe740c95637ed4f474da65faac0f9f67b0ae0e8bc8eaf8',line:2514},
  {path:'/mnt/p6/build/firefox-nightly-musl-jit-full-20261002/source/firefox-159.0a1/modules/libpref/init/StaticPrefList.yaml',sha256:'bfbb872d3dc180e111eefa5af1e85f451807e155e5647654a5d830763b9fe622',line:20667},
];
export const memoryDialogExpression=`(()=>{const d=document.querySelector('#firefox-memory-dialog'),b=d?.querySelector('button[value="current"]'),r=b?.getBoundingClientRect();return {href:location.href,open:d?.open===true,current:document.querySelector('#firefox-memory-current')?.textContent??null,box:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null};})()`;
export function validateMemoryChoiceReply(reply,request,now=Date.now()) {
  const point=reply?.point,box=request.box;
  if(reply?.schema!==1||reply.approve!==true||reply.actualImageReviewed!==true||reply.nonce!==request.nonce||
    !/^[a-f0-9]{32}$/.test(reply.nonce??'')||reply.imageSha256!==request.imageSha256||
    !['pid','startTicks','pgid','sid'].every(key=>reply.owned?.[key]===request.owned[key])||
    reply.currentRamMiB!==4096||request.currentRamMiB!==4096||request.current!=='4 GB'||reply.choice!=='current'||
    reply.deadlineAt!==request.deadlineAt||!Number.isInteger(reply.reviewedAt)||reply.reviewedAt<request.at||reply.reviewedAt>now||now>=request.deadlineAt-15000||
    !Number.isInteger(point?.x)||!Number.isInteger(point?.y)||
    !(point.x>=box.x&&point.x<box.x+box.width&&point.y>=box.y&&point.y<box.y+box.height))
    throw Error('root memory choice reply rejected');
  return reply;
}
export function parseMemoryChoiceReply(bytes,request,now=Date.now()) {
  if(!bytes.length||bytes.length>16384)throw Error('bounded nonempty memory choice reply required');
  return validateMemoryChoiceReply(JSON.parse(bytes.toString('utf8')),request,now);
}
export function trustedMemoryChoiceProof(proof,reply) {
  return proof?.open===false&&proof.returnValue==='current'&&proof.click?.isTrusted===true&&
    proof.click.value==='current'&&proof.click.x===reply.point.x&&proof.click.y===reply.point.y;
}
export async function awaitRootMemoryChoice(evaluate,call,root,observed,deadlineAt) {
  const receipt={pass:false,deadlineReset:false};let pointerPressed=false;
  try {
    if(observed.current!=='4 GB'||!observed.box||Date.now()>=deadlineAt-15000)throw Error('actual4GB memory dialog/deadline required');
    const owner=JSON.parse(await fs.readFile(root+'/run/owned-process.json','utf8')),nonce=randomBytes(16).toString('hex');
    const imagePath=root+'/run/memory-choice-review-'+nonce+'.png',requestPath=root+'/run/memory-choice-review-request.json',replyPath=root+'/run/memory-choice-review-reply.json';
    try{await fs.lstat(replyPath);throw Error('memory review reply was not fresh');}catch(error){if(error.code!=='ENOENT')throw error;}
    const screen=await call('Page.captureScreenshot',{format:'png'}),bytes=Buffer.from(screen.data,'base64');await fs.writeFile(imagePath,bytes);
    const request={schema:1,kind:'firefox-native-memory-review',nonce,owned:owner,imagePath,imageSha256:sha(bytes),requestPath,replyPath,
      href:observed.href,current:observed.current,currentRamMiB:4096,box:observed.box,at:Date.now(),deadlineAt};
    receipt.request=request;await fs.writeFile(requestPath,JSON.stringify(request,null,2)+'\n');
    console.log(JSON.stringify({...request,kind:'awaitrootmemorychoice'}));
    let reply;
    while(Date.now()<deadlineAt-15000){
      try {
        const info=await fs.lstat(replyPath);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw Error('invalid memory review reply file');
        const raw=await fs.readFile(replyPath);if(raw.length){
          // Keep every nonempty reply byte before parsing/rejecting it.
          await fs.writeFile(root+'/run/memory-choice-review-reply.raw.json',raw);
          reply=parseMemoryChoiceReply(raw,request);break;
        }
      }catch(error){if(error.code!=='ENOENT')throw error;}
      await sleep(100);
    }
    if(!reply)throw Error('original browser deadline awaiting actual root memory review');
    receipt.reply=reply;
    const current=await evaluate(memoryDialogExpression);
    if(current.open!==true||current.current!==request.current||current.href!==request.href||!current.box||
      !(reply.point.x>=current.box.x&&reply.point.x<current.box.x+current.box.width&&reply.point.y>=current.box.y&&reply.point.y<current.box.y+current.box.height))
      throw Error('actual memory dialog/point changed after image review');
    await evaluate(`(()=>{const b=document.querySelector('#firefox-memory-dialog button[value="current"]');window.__firefoxGpuMemoryClick=null;
      window.__firefoxGpuMemoryListener=e=>{window.__firefoxGpuMemoryClick={isTrusted:e.isTrusted,value:b.value,x:e.clientX,y:e.clientY};};
      b.addEventListener('click',window.__firefoxGpuMemoryListener,{once:true,capture:true});return true;})()`);
    if(Date.now()>=deadlineAt-15000)throw Error('original browser deadline before reviewed memory click');
    await call('Input.dispatchMouseEvent',{type:'mouseMoved',x:reply.point.x,y:reply.point.y});
    pointerPressed=true;await call('Input.dispatchMouseEvent',{type:'mousePressed',x:reply.point.x,y:reply.point.y,button:'left',clickCount:1});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:reply.point.x,y:reply.point.y,button:'left',clickCount:1});pointerPressed=false;
    const proof=await evaluate(`(()=>{const d=document.querySelector('#firefox-memory-dialog');return {open:d.open,returnValue:d.returnValue,click:window.__firefoxGpuMemoryClick};})()`);
    receipt.proof=proof;if(!trustedMemoryChoiceProof(proof,reply))throw Error('actual trusted Keep current close proof failed');
    receipt.pass=true;return receipt;
  }catch(error){receipt.error=String(error.stack||error);throw error;}
  finally {
    if(pointerPressed&&receipt.reply)try{await call('Input.dispatchMouseEvent',{type:'mouseReleased',...receipt.reply.point,button:'left',clickCount:1});}catch(error){receipt.releaseError=String(error);}
    try{await evaluate(`(()=>{const b=document.querySelector('#firefox-memory-dialog button[value="current"]');if(b&&window.__firefoxGpuMemoryListener)b.removeEventListener('click',window.__firefoxGpuMemoryListener,true);delete window.__firefoxGpuMemoryListener;delete window.__firefoxGpuMemoryClick;})()`);}catch{}
    await fs.writeFile(root+'/run/memory-choice-transport.json',JSON.stringify(receipt,null,2)+'\n');
  }
}

export function nativeProbeRows(logs,nonce) {
  const rows=[];
  for(const line of logs.split('\n')) {
    const offset=line.indexOf(probePrefix);if(offset<0)continue;
    try {const row=JSON.parse(line.slice(offset+probePrefix.length));
      if(row.nonce===nonce&&row.kind==='firefox-native-webgl-primitive')rows.push(row);
    }catch {}
  }
  return rows;
}
export function webGlRendererRoute(probe) {
  const identity=probe?.identity;
  const schemaValid=identity!==null&&typeof identity==='object'&&!Array.isArray(identity)&&
    ['renderer','unmaskedRenderer'].every(key=>identity[key]===undefined||typeof identity[key]==='string');
  const renderer=typeof identity?.renderer==='string'?identity.renderer.trim():'';
  const unmasked=typeof identity?.unmaskedRenderer==='string'?identity.unmaskedRenderer.trim():'';
  const selected=unmasked||renderer;
  const software=/llvmpipe|softpipe|swrast|swiftshader|software\s+rasterizer/i.test(renderer+' '+unmasked);
  return {pass:schemaValid&&selected.length>0&&/\bzink\b/i.test(selected)&&!software,
    source:unmasked?'unmaskedRenderer':renderer?'renderer':null,value:selected||null,softwareRejected:software};
}
export function nativeRustJoin(probe,diagnostics,cpu) {
  const messages=(diagnostics?.gpuEvents??[]).filter(e=>e.kind==='owner-log').map(e=>e.message);
  const closed=[];
  for(const message of messages){const at=message.indexOf('GUEST_WGPU_HOST_REPORT ');if(at<0)continue;
    try{closed.push(JSON.parse(message.slice(at+'GUEST_WGPU_HOST_REPORT '.length)));}catch{}}
  const adapter=messages.some(m=>/backend=BrowserWebGpu adapter=/.test(m)&&/"wgpuBackend":"BrowserWebGpu"/.test(m));
  const nativeDraw=closed.some(r=>r.graphicsDraws>0&&r.graphicsPasses>0&&r.backend==='wgpu'&&
    r.adapter?.backend==='BrowserWebGpu'&&r.graphics?.draws>0&&
    r.graphics.state==='closed'&&r.graphics.resources===0&&r.graphics.nativeObjects===0&&
    r.graphics.allocatedBytes===0&&Number.isInteger(r.graphicsTranslatorsCreated)&&
    r.graphicsTranslatorsCreated>0&&r.graphicsTranslatorsClosed===r.graphicsTranslatorsCreated&&
    r.error===null&&Array.isArray(r.cleanupErrors)&&r.cleanupErrors.length===0);
  const pixels=probe?.contextCreated===true&&probe.pass===true&&probe.pixels?.checks>12000&&
    probe.width===64&&probe.height===64&&probe.pixels.failures===0&&probe.pixels.redPixels>500&&
    probe.pixels.bluePixels>2500&&probe.pixels.unexpectedPixels===0&&probe.glError===0&&probe.contextLost===false;
  const actualFirefox=/Firefox\/159\.0\b/.test(probe?.browser?.userAgent??'');
  const cpuEqual=probe?.browser?.hardwareConcurrency===cpu.hostNproc&&cpu.guestBootCpus===cpu.hostNproc&&
    Object.keys(cpu.checks??{}).length===3&&Object.values(cpu.checks).every(value=>value===true);
  const evidenceComplete=diagnostics?.logEvidenceDropped===false&&diagnostics?.gpuEventsCapacityReached===false;
  const rendererRoute=webGlRendererRoute(probe);
  return {pass:pixels&&actualFirefox&&cpuEqual&&adapter&&nativeDraw&&evidenceComplete&&rendererRoute.pass,pixels,actualFirefox,cpuEqual,
    rendererRoute,perContextSessionAttribution:'Unknown',nativeClosedSessionCorroboration:nativeDraw,
    adapter,nativeDraw,closedReports:closed,evidenceComplete,firefoxGpuAcceptance:false,
    webRenderAcceptance:false,webGpuAcceptance:false,concurrencyAcceptance:false,releaseAcceptance:false};
}
export async function authenticatedHelperPackage(pkg) {
  if(!pkg.gfxtestCandidate){if(pkg.gfxtestProbe)throw Error('probe requires authenticated helper');return null;}
  const helper=pkg.gfxtestCandidate;
  for(const [name,expected]of [['build','ac30e12b79575ac8ba45b6a15e66e91300806b85ae9ac161e757abf359a70aa4'],
    ['verification','6214c186b34dc376bdac60298b439e0521580f10a3140737a0fd0531e674c236'],
    ['final','f178f071b85d6029847d842ebd00e085ddb9f78b086fbb0da4e864c9fb5e0205']]){
    const pin=helper[name];if(pin?.sha256!==expected||!Number.isInteger(pin.bytes)||
      (await fs.stat(pin.path)).size!==pin.bytes||await hashFile(pin.path)!==expected)throw Error('actual helper '+name+' identity');
  }
  const verification=JSON.parse(await fs.readFile(helper.verification.path)),build=JSON.parse(await fs.readFile(helper.build.path));
  if(helper.checksPassed!==17||helper.guestAcceptance!==false||helper.gpuAcceptance!==false||
    verification.passVerification!==true||verification.guestAcceptance!==false||verification.gpuAcceptance!==false||
    Object.keys(verification.checks??{}).length!==17||Object.values(verification.checks).some(value=>value!==true)||
    build.passBuild!==true||build.candidateOnly!==true||build.guestAcceptance!==false||build.gpuAcceptance!==false||
    JSON.stringify(verification.buildReport)!==JSON.stringify(helper.build)||
    JSON.stringify(verification.final)!==JSON.stringify(helper.final)||JSON.stringify(build.artifacts?.final)!==JSON.stringify(helper.final)||
    JSON.stringify(pkg.changes?.['opt/firefox/gfxtest']?.after)!==JSON.stringify(helper.final))throw Error('authenticated helper receipt closure');
  if(pkg.gfxtestProbe&&(pkg.gfxtestProbe.enabled!==true||pkg.gfxtestProbe.deadlineMs!==4000||
    pkg.gfxtestProbe.permitPath!=='/home/admin/.gpu-native-gfxtest-permit'||
    pkg.gfxtestProbe.receiptRoot!=='/home/admin/.gpu-native-gfxtest'||pkg.gfxtestProbe.outputFileUpperBoundBytes!==65536))throw Error('helper probe scope');
  return {selectedArtifact:helper.final,build:helper.build,verification:helper.verification,checksPassed:17,
    probe:pkg.gfxtestProbe??null,standaloneAcceptance:false,firefoxParentAcceptance:false,gpuAcceptance:false};
}
export function helperReceiptExpression(nonce) {
  if(!/^[a-f0-9]{32}$/.test(nonce??''))throw Error('fresh helper nonce required');
  return `(async()=>{const h=await(await import('/linux/persistent-home.mjs')).openPersistentHome({readOnly:true});try{
    let n=h.root;for(const part of ['admin','.gpu-native-gfxtest',${JSON.stringify(nonce)}]){n=await h.lookup(n,part);if(!n)return {missing:true};}
    const names=['receipt.json','protocol.raw','stdout.raw','stderr.raw','pre-exec.pid','pre-exec.stat','pre-exec.fd3','timeout-control.stdout','timeout-control.stderr'];
    const receipt=await h.lookup(n,'receipt.json');if(!receipt||(await h.getattr(receipt)).size===0n)return {pending:true};
    const files=[];let total=0;for(const name of names){const node=await h.lookup(n,name);if(!node){files.push({name,missing:true});continue;}
      const a=await h.getattr(node),size=Number(a.size),limit=name==='receipt.json'?8192:name.startsWith('pre-exec.')?4096:65536;
      if((a.mode&0o170000)!==0o100000||!Number.isSafeInteger(size)||size<0||size>limit||(total+=size)>262144)throw Error('bounded helper capture');
      const handle=await h.open(node,0);let bytes;try{bytes=await h.read(node,handle,0n,size);}finally{await h.release(node,handle);}
      if(bytes.length!==size)throw Error('short helper receipt');let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      files.push({name,bytes:size,base64:btoa(binary)});
    }return {nonce:${JSON.stringify(nonce)},files,readOnly:true};
  }finally{await h.destroy();}})()`;
}
export function profileSeedExpression(prefs,cpus,gfxtestNonce=null) {
  if(!Number.isInteger(cpus)||cpus<1||cpus>64||typeof prefs!=='string'||prefs.length>32768)throw Error('bounded profile seed');
  if(gfxtestNonce!==null&&!/^[a-f0-9]{32}$/.test(gfxtestNonce))throw Error('fresh helper permit nonce');
  return `(async()=>{const h=await(await import('/linux/persistent-home.mjs')).openPersistentHome();try{
    if((await h.readdir(h.root)).some(r=>r.name!=='.'&&r.name!=='..'))throw Error('home not fresh');
    let n=h.root;for(const part of ['admin','.mozilla','firefox','http1-profile'])n=await h.mkdir(n,part,{mode:0o755,uid:1000,gid:1000});
    const b=new TextEncoder().encode(${JSON.stringify(prefs)}),f=await h.create(n,'user.js',2,{mode:0o644,uid:1000,gid:1000});
    try{if(await h.write(f.node,f.handle,0n,b)!==b.length)throw Error('short profile write');}finally{await h.release(f.node,f.handle);}
    const handle=await h.open(f.node,0);let observed;try{observed=await h.read(f.node,handle,0n,b.length);}finally{await h.release(f.node,handle);}
    if(observed.length!==b.length||observed.some((v,i)=>v!==b[i]))throw Error('profile bytes differ');
    ${gfxtestNonce===null?'':`const admin=await h.lookup(h.root,'admin'),permitBytes=new TextEncoder().encode(${JSON.stringify(gfxtestNonce+'\n')}),permit=await h.create(admin,'.gpu-native-gfxtest-permit',2,{mode:0o600,uid:1000,gid:1000});
    try{if(await h.write(permit.node,permit.handle,0n,permitBytes)!==permitBytes.length)throw Error('short fresh helper permit');}finally{await h.release(permit.node,permit.handle);}`}
    localStorage.setItem('linuxonweb.machine-settings.v1',JSON.stringify({resolution:'1280x720',cpus:${cpus},ram:4096,backend:'canvas2d'}));
    return {bytes:b.length,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',observed)),v=>v.toString(16).padStart(2,'0')).join(''),cpus:${cpus}};
  }finally{await h.destroy();}})()`;
}
export function guestQuitKeyProof(proof,code) {
  return proof?.running===true&&proof.canvasFocused===true&&proof.events?.some(event=>
    event.code===code&&event.isTrusted===true&&event.defaultPrevented===true&&event.canvasFocused===true)===true;
}
async function quitOwnedFirefox(evaluate,call,root,deadlineAt) {
  const receipt={pass:false,stages:[]};
  try {
    if(Date.now()>=deadlineAt)throw Error('original browser deadline before guest quit');
    const focused=await evaluate(`(async()=>{const m=await import('/linux/main.js'),c=document.querySelector('canvas');
      if(!c||!m.guestGpuDiagnostics()?.running)throw Error('owned guest canvas unavailable');
      const p=window.__nativeGpuQuitProof={events:[],running:true,canvasFocused:false};
      c.focus();p.canvasFocused=document.activeElement===c;
      window.__nativeGpuQuitListener=e=>{if(p.events.length<8)p.events.push({code:e.code,isTrusted:e.isTrusted,
        defaultPrevented:e.defaultPrevented,canvasFocused:document.activeElement===c});};
      c.addEventListener('keydown',window.__nativeGpuQuitListener);return p;})()`);
    receipt.stages.push({stage:'focus',proof:focused});
    if(focused.running!==true||focused.canvasFocused!==true)throw Error('guest quit focus proof');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,modifiers:2});
    const control=await evaluate('window.__nativeGpuQuitProof');receipt.stages.push({stage:'control-down',proof:control});
    if(!guestQuitKeyProof(control,'ControlLeft'))throw Error('actual trusted prevented Ctrl proof');
    const stillFocused=await evaluate("(async()=>document.activeElement===document.querySelector('canvas')&&(await import('/linux/main.js')).guestGpuDiagnostics()?.running===true)()");
    if(stillFocused!==true||Date.now()>=deadlineAt)throw Error('guest quit focus/deadline changed before Q');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'q',code:'KeyQ',windowsVirtualKeyCode:81,modifiers:2});
    const quit=await evaluate('window.__nativeGpuQuitProof');receipt.stages.push({stage:'quit-down',proof:quit});
    if(!guestQuitKeyProof(quit,'KeyQ'))throw Error('actual trusted prevented Q proof');
    receipt.pass=true;
  }catch(error){receipt.error=String(error.stack||error);}
  finally {
    // Release both physical host keys even if either admission proof fails.
    for(const key of [{key:'q',code:'KeyQ',windowsVirtualKeyCode:81,modifiers:2},
      {key:'Control',code:'ControlLeft',windowsVirtualKeyCode:17,modifiers:0}]){
      try{await call('Input.dispatchKeyEvent',{type:'keyUp',...key});}catch(error){receipt.releaseError=String(error);receipt.pass=false;}
    }
    try{await evaluate("(()=>{const c=document.querySelector('canvas');if(c&&window.__nativeGpuQuitListener)c.removeEventListener('keydown',window.__nativeGpuQuitListener);return true;})()");}catch{}
    await fs.writeFile(root+'/run/guest-quit-proof.json',JSON.stringify(receipt,null,2)+'\n');
  }
  return receipt;
}
async function hashFile(filename){const hash=createHash('sha256');for await(const bytes of createReadStream(filename))hash.update(bytes);return hash.digest('hex');}
async function identity(pid){const raw=await fs.readFile('/proc/'+pid+'/stat','utf8'),a=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/);
  return {pid,state:a[0],ppid:Number(a[1]),pgid:Number(a[2]),sid:Number(a[3]),startTicks:a[19],comm:raw.slice(raw.indexOf('(')+1,raw.lastIndexOf(')'))};}
async function protectedBaseline(){
  const inventory=JSON.parse(await fs.readFile('/mnt/p6/build/headed-jit-root-oct05/process-inventory-main-run46.json'));
  const extra=JSON.parse(await fs.readFile(rootPrefix+'protected-before.json'));
  const pids=[705,706,1095195,1095196,1183734,1183743,1183764,4150936,4150944];
  const rows=new Map(pids.map(pid=>[pid,inventory.safeRows.find(r=>r.pid===pid)]));
  for(const r of extra.identities)rows.set(r.pid,r);
  const actual=[];
  for(const [pid,expected]of rows){if(!expected)throw Error('protected baseline missing '+pid);const observed=await identity(pid);
    if(['startTicks','pgid','sid'].some(k=>expected[k]!==observed[k])||observed.state==='Z')throw Error('protected identity changed '+pid);actual.push(observed);}
  // Additional unrelated Chrome roots are read without logging their arguments.
  const all=[];for(const name of await fs.readdir('/proc'))if(/^\d+$/.test(name))try{all.push(await identity(Number(name)));}catch{}
  const browsers=new Set(all.filter(r=>/^(chrome|chromium)$/.test(r.comm)).map(r=>r.pid));
  for(const row of all)if(browsers.has(row.pid)&&!browsers.has(row.ppid)&&!rows.has(row.pid))actual.push(row);
  return actual;
}
async function protectedUnchanged(before){const checks=[];for(const expected of before){try{const actual=await identity(expected.pid);checks.push({pid:expected.pid,sameIdentity:actual.state!=='Z'&&['startTicks','pgid','sid'].every(k=>actual[k]===expected[k])});}catch{checks.push({pid:expected.pid,sameIdentity:false});}}return checks;}

export async function runFirefoxNativeGpu(packageArg,rootArg,pipelineEvidence=null) {
  if(process.getuid()!==1000)throw Error('actual desktop user a (uid1000) required');
  const root=path.resolve(rootArg),parent=await fs.realpath(path.dirname(root));
  if(parent!==path.dirname(root)||!parent.startsWith('/mnt/p3/codex-build/'))throw Error('fresh canonical persistent p3 task required');
  const disk=await fs.statfs(parent);if([0x01021994,0x858458f6].includes(disk.type)||disk.bavail*disk.bsize<20*1024**3)throw Error('disk and20GiB reserve');
  const memory=await fs.readFile('/proc/meminfo','utf8');
  if(Number(/^MemAvailable:\s*(\d+)/m.exec(memory)?.[1])*1024<4*1024**3)throw Error('4GiB available RAM floor before launch');
  const packageRoot=await fs.realpath(packageArg);if(packageRoot!==path.resolve(packageArg)||!packageRoot.startsWith('/mnt/p3/codex-build/'))throw Error('canonical p3 package');
  await fs.mkdir(root);for(const name of ['t','cache','xdg','config'])await fs.mkdir(root+'/'+name);
  for(const key of ['TMPDIR','TMP','TEMP'])process.env[key]=root+'/t';
  process.env.XDG_CACHE_HOME=root+'/cache';process.env.XDG_CONFIG_HOME=root+'/config';
  const before=await protectedBaseline();await fs.writeFile(root+'/protected-before.json',JSON.stringify(before,null,2)+'\n');
  const packageBytes=await fs.readFile(packageRoot+'/package.json'),pkg=JSON.parse(packageBytes);
  if(pkg.passPackage!==true||pkg.testOnly!==true||pkg.candidateOnly!==true||pkg.source.sha256!==sourceSha||pkg.ordinaryInitPreserved!==true||pkg.pageUrl!=='file:///opt/firefox/native-service-probe.html')throw Error('current159 native diagnostic package required');
  const pagePath=repo+'tools/guest-rootfs/firefox-gpu-check/native-service-probe.html',pageBytes=await fs.readFile(pagePath);
  if(pkg.page?.path!==pagePath||pkg.page?.bytes!==pageBytes.length||pkg.page?.sha256!==sha(pageBytes))throw Error('current native probe page identity');
  const archive=await fs.readFile(packageRoot+'/initramfs-firefox.cpio.gz');
  if(archive.length!==pkg.archive.bytes||sha(archive)!==pkg.archive.sha256)throw Error('candidate archive identity');
  const manifestBytes=await fs.readFile(packageRoot+'/boot-manifest.json'),manifest=JSON.parse(manifestBytes);
  if(manifest.assets.firefox.sha256!==sha(archive)||manifest.assets.firefox.bytes!==archive.length)throw Error('candidate manifest identity');
  const currentManifest=JSON.parse(await fs.readFile(rootPrefix+'current159-boot-manifest.json'));
  if(currentManifest.assets.firefox.sha256!==sourceSha||['kernel','plain'].some(name=>
    JSON.stringify(currentManifest.assets[name])!==JSON.stringify(manifest.assets[name])))throw Error('original current159 system asset identity');
  const build=JSON.parse(await fs.readFile(pkg.build.path));if(await hashFile(pkg.build.path)!==pkg.build.sha256||build.passBuild!==true)throw Error('build proof identity');
  for(const name of ['firefox','plugin-container']){const pin=build.artifacts[name].final;if(await hashFile(pin.path)!==pin.sha256)throw Error('actual built native bytes changed');}
  const helperPins=await authenticatedHelperPackage(pkg);
  const pipeline=pipelineEvidence===null?null:await admitFirefoxGpuPipeline(pipelineEvidence);
  const nonce=randomBytes(16).toString('hex'),initBytes=await fs.readFile(rootPrefix+'init.source');
  if(sha(initBytes)!=='55d55013be46cb13541320943ef03c50a43580bf69dd5d4c425963a41a5d8803')throw Error('actual current159 init source identity');
  const prefsMatch=initBytes.toString().match(/<<'LOWLAND_HTTP1_PREFS'\n([\s\S]*?)\nLOWLAND_HTTP1_PREFS/);
  if(!prefsMatch||prefsMatch[1].match(/user_pref\(/g)?.length!==6)throw Error('exact ordinary six-pref HTTP1 body');
  const homePage=pkg.pageUrl+'?nonce='+nonce;
  for(const source of rendererIdentitySources)if(await hashFile(source.path)!==source.sha256)throw Error('actual renderer identity preference source changed');
  const prefs=prefsMatch[1]+'\n'+[
    'user_pref("devtools.console.stdout.content",true);','user_pref("devtools.console.stdout.chrome",true);',
    'user_pref("browser.dom.window.dump.enabled",true);','user_pref("webgl.force-enabled",true);',
    'user_pref("gfx.egl.prefer-gles.enabled",true);','user_pref("webgl.out-of-process",false);',
    'user_pref("webgl.sanitize-unmasked-renderer",false);',
    'user_pref("browser.startup.page",1);','user_pref("browser.startup.homepage",'+JSON.stringify(homePage)+');',
  ].join('\n')+'\n';
  await fs.writeFile(root+'/profile-user.js',prefs);
  await fs.writeFile(root+'/package-pins.json',JSON.stringify({packageSha256:sha(packageBytes),manifestSha256:sha(manifestBytes),archive:pkg.archive,build:pkg.build,page:pkg.page,initSourceSha256:sha(initBytes),native:build.artifacts,nonce,homePage,
    ...(helperPins?{gfxtest:helperPins}:{}),rendererIdentityPolicy:{diagnosticOnly:true,sanitizeUnmaskedRenderer:false,rendererOverride:false,rfpChanged:false,sources:rendererIdentitySources}},null,2)+'\n');
  const {runBrowser}=await prepareOwnedGpuBrowser(root);
  const routes=new Map([['/linux/boot-manifest.json',manifestBytes],['/linux/initramfs-firefox.cpio.gz',archive],[gpuSeedPath,Buffer.from('<!doctype html><title>Isolated native GPU seed</title>')]]);
  if(pipeline){
    for(const [url,bytes]of pipeline.routes)routes.set(url,bytes);
    await fs.writeFile(root+'/pipeline-runtime-admission.json',JSON.stringify(pipeline.review,null,2)+'\n');
  }
  let diagnostic,probe,cpu,hardware,quitProof,memoryProof,helperReceipt;
  const report=await runBrowser({out:root+'/run',mode:'hardware',routes,timeoutMs:600000,
    page:'/linux/index.html?firefox=1&renderer=canvas2d&gpuruntime=rust&gpubackend=webgpu',
    beforeNavigate:async({evaluate,affinity,deadlineAt,origin})=>{
      if(Date.now()>=deadlineAt)throw Error('original browser deadline before seed');
      while(await evaluate('location.origin')!==origin){
        if(Date.now()>=deadlineAt)throw Error('original browser deadline before origin seed');
        await sleep(100);
      }
      cpu=selectHostCpus(affinity.hostNproc,await evaluate('navigator.hardwareConcurrency'));
      hardware=await evaluate('(async()=>{const a=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});return a?{vendor:a.info?.vendor??null,architecture:a.info?.architecture??null,description:a.info?.description??null,isFallbackAdapter:a.info?.isFallbackAdapter??a.isFallbackAdapter??null}:null})()');
      await fs.writeFile(root+'/browser-webgpu-adapter.json',JSON.stringify(hardware,null,2)+'\n');
      const installed=await evaluate(profileSeedExpression(prefs,cpu.hostNproc,helperPins?.probe?nonce:null));
      if(installed.sha256!==sha(prefs)||installed.bytes!==Buffer.byteLength(prefs))throw Error('isolated profile proof');
      await fs.writeFile(root+'/profile-installed.json',JSON.stringify(installed)+'\n');
    },
    run:async({evaluate,call,deadlineAt})=>{
      const cutoff=deadlineAt-15000;let bootLogs='',screenshotTaken=false,firstProbeHandled=false,memoryHandled=false;
      while(Date.now()<cutoff){
        const memory=await evaluate(memoryDialogExpression);
        if(memory?.open){if(memoryHandled)throw Error('only one root memory review gate allowed');memoryHandled=true;memoryProof=await awaitRootMemoryChoice(evaluate,call,root,memory,deadlineAt);}
        if(helperPins?.probe&&!helperReceipt){
          const captured=await evaluate(helperReceiptExpression(nonce));
          if(captured.files){
            await fs.mkdir(root+'/run/gfxtest',{recursive:false});
            await fs.writeFile(root+'/run/gfxtest/capture-metadata.json',JSON.stringify(captured.files.map(({base64,...metadata})=>metadata),null,2)+'\n');
            for(const file of captured.files){if(!['receipt.json','protocol.raw','stdout.raw','stderr.raw','pre-exec.pid','pre-exec.stat','pre-exec.fd3','timeout-control.stdout','timeout-control.stderr'].includes(file.name)||file.bytes>65536)throw Error('helper capture filename/bounds');if(file.missing===true)continue;const bytes=Buffer.from(file.base64,'base64');if(bytes.length!==file.bytes)throw Error('helper capture length');await fs.writeFile(root+'/run/gfxtest/'+file.name,bytes);}
            const raw=await fs.readFile(root+'/run/gfxtest/receipt.json'),parsed=JSON.parse(raw);
            if(parsed.nonce!==nonce||parsed.deadlineMs!==4000||parsed.kind!=='standalone-gfxtest')throw Error('actual helper receipt scope');
            helperReceipt={receipt:parsed,pins:helperPins,readOnly:true,preExecIdentity:'retained raw stat/pid/fd3; post-exec unproven',postExecIdentity:'Unknown',standaloneAcceptance:false,firefoxParentAcceptance:false,gpuAcceptance:false};
            await fs.writeFile(root+'/run/gfxtest-capture.json',JSON.stringify(helperReceipt,null,2)+'\n');
          }
        }
        try{diagnostic=await evaluate("(async()=> (await import('/linux/main.js')).guestGpuDiagnostics())()");}catch(error){await fs.writeFile(root+'/run/diagnostics-last-error.txt',String(error));}
        if(diagnostic){bootLogs=diagnostic.logs.map(row=>row.text).join('\n');
          await fs.writeFile(root+'/run/diagnostics.json',JSON.stringify(diagnostic,null,2)+'\n');
          await fs.writeFile(root+'/run/native-context-log.txt',bootLogs+'\n');
          const rows=nativeProbeRows(bootLogs,nonce);if(rows.length){
            probe=rows.at(-1);
            if(!firstProbeHandled){
              firstProbeHandled=true;
              await fs.writeFile(root+'/run/native-probe-first.json',JSON.stringify(probe,null,2)+'\n');
              try{const screen=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(root+'/run/framebuffer.png',Buffer.from(screen.data,'base64'));screenshotTaken=true;}catch(error){await fs.writeFile(root+'/run/screenshot-error.txt',String(error));}
              quitProof=await quitOwnedFirefox(evaluate,call,root,deadlineAt);
              if(!quitProof.pass)break;
            }
            const interimCpu=guestCpuEvidence(cpu,bootLogs,{browserHardwareConcurrency:cpu.hostNproc,
              selectedGuestCpus:diagnostic.configuration?.cpus},cpu.hostNproc);
            if(probe.pass!==true||nativeRustJoin(probe,diagnostic,interimCpu).pass)break;
          }}
        await sleep(500);
      }
      if(!screenshotTaken)try{const screen=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(root+'/run/framebuffer.png',Buffer.from(screen.data,'base64'));}catch(error){await fs.writeFile(root+'/run/screenshot-error.txt',String(error));}
      const cpuEvidence=guestCpuEvidence(cpu,bootLogs,{browserHardwareConcurrency:await evaluate('navigator.hardwareConcurrency'),selectedGuestCpus:diagnostic?.configuration?.cpus},readHostNproc());
      await fs.writeFile(root+'/run/kernel-cpu-log.txt',bootLogs+'\n');
      await fs.writeFile(root+'/run/cpu.json',JSON.stringify(cpuEvidence,null,2)+'\n');
      await fs.writeFile(root+'/run/native-probe.json',JSON.stringify(probe??{missing:true,nonce})+'\n');
      const joined=nativeRustJoin(probe,diagnostic,cpuEvidence);
      // Preserve failure evidence first; stop only the owned isolated guest.
      try{if(diagnostic?.running)await evaluate('document.querySelector("#stop-yes").click()');}catch{}
      return {pass:joined.pass&&quitProof?.pass===true&&screenshotTaken&&memoryProof?.pass===true,probe:probe??null,diagnostic,cpu:cpuEvidence,joined,memoryProof,
        browserWebGpuAdapter:hardware,hardwareAdapterConfirmed:hardware?.vendor==='nvidia'&&hardware.isFallbackAdapter===false,
        hardwareAccelerationAcceptance:false,...(helperPins?{gfxtest:helperReceipt??{missing:true,pins:helperPins,standaloneAcceptance:false,firefoxParentAcceptance:false,gpuAcceptance:false}}:{}),quitProof,nonce,archiveSha256:sha(archive),nativeBuildSha256:pkg.build.sha256};
    },
  });
  report.protectedServices=await protectedUnchanged(before);
  const pair=[['guest_vulkan_wgpu_host.js',121321,'f7dbe44f135cd8f596860696901413e36f9eeea3fbc61038d6602a936dcc3f9d'],['guest_vulkan_wgpu_host_bg.wasm',4161388,'4341087d9b0fea428966ce9f27a4e9328cc0ef5cdc632bbc31cd57ccf1afe5de']];
  report.commonRustBytes=pair.every(([name,bytes,pin])=>{const rows=report.requests.filter(r=>r.url==='/linux/gpu-runtime/v1/'+name);return rows.length>0&&rows.every(r=>r.bytes===bytes&&r.sha256===pin);});
  report.privateRustAbsent=!report.requests.some(r=>/candidate\/guest_vulkan_wgpu_host/.test(r.url));
  if(pipeline){
    report.pipelineRuntime=pipeline.review;
    report.pipelineRuntimeBytes=pipeline.pins.every(pin=>{
      const hits=report.requests.filter(row=>row.url===pin.url);
      return hits.length>0&&hits.every(row=>row.sha256===pin.sha256&&row.bytes===pin.bytes);
    });
    report.pipelineRuntimeSourcesUnchanged=true;
    for(const pin of pipeline.pins){const bytes=await fs.readFile(pin.source);if(bytes.length!==pin.bytes||sha(bytes)!==pin.sha256)report.pipelineRuntimeSourcesUnchanged=false;}
    report.stableRustRuntimeAbsent=!report.requests.some(row=>row.url.startsWith('/linux/gpu-runtime/v1/'));
    report.pass&&=report.pipelineRuntimeBytes&&report.pipelineRuntimeSourcesUnchanged&&report.stableRustRuntimeAbsent;
  }else report.pass&&=report.commonRustBytes&&report.privateRustAbsent;
  report.pass&&=report.protectedServices.every(r=>r.sameIdentity);
  report.scope='isolated current159 native Zink WebGL pixels corroborated by a closed common Rust Vulkan session';
  report.perContextSessionAttribution='Unknown';
  report.firefoxGpuAcceptance=false;report.webRenderAcceptance=false;report.webGpuAcceptance=false;report.concurrencyAcceptance=false;report.releaseAcceptance=false;
  await fs.writeFile(root+'/run/result.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({pass:report.pass,root,error:report.error??null,firefoxGpuAcceptance:false}));
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [pkg,root,pipelineEvidence]=process.argv.slice(2);if(!pkg||!root)throw Error('usage: node run-firefox-native-gpu.mjs REVIEWED_PACKAGE_ROOT FRESH_P3_TASK_ROOT [TWO_BACKEND_PIPELINE_EVIDENCE]');
 if(!(await runFirefoxNativeGpu(pkg,root,pipelineEvidence??null)).pass)process.exitCode=1;
}
