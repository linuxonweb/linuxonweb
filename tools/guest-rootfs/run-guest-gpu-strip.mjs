// Finite isolated headed runtime owner for the new public-Vulkan pixel fixture.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {prepareOwnedGpuBrowser} from './owned-gpu-browser.mjs';
import {readHostNproc,selectHostCpus,saveGuestCpuEvidence} from './firefox-host-cpus.mjs';
import {checkGuestGpuStrip} from './check-guest-gpu-strip.mjs';
const [backend,packageArg,rootArg]=process.argv.slice(2);
if(!['webgpu','webgl'].includes(backend)||!packageArg||!rootArg)throw Error('usage: node run-guest-gpu-strip.mjs webgpu|webgl REVIEWED_PACKAGE FRESH_TASK_ROOT');
if(process.getuid()!==1000)throw Error('desktop user a required');
const root=path.resolve(rootArg),packageRoot=await fs.realpath(packageArg);
if(!root.startsWith('/mnt/p3/codex-build/')||!packageRoot.startsWith('/mnt/p3/codex-build/'))throw Error('persistent p3 task roots required');
const parent=await fs.realpath(path.dirname(root));if(parent!==path.dirname(root))throw Error('canonical task parent required');
const stat=await fs.statfs(parent);if([0x01021994,0x858458f6].includes(stat.type)||stat.bavail*stat.bsize<20*1024**3)throw Error('disk-backed storage and reserve required');
await fs.mkdir(root);await fs.mkdir(root+'/t');for(const key of ['TMPDIR','TMP','TEMP'])process.env[key]=root+'/t';process.env.XDG_CACHE_HOME=root+'/cache';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),routes=new Map(),reviewedRoutes=[];
async function add(url,source,expected) {
  if(!expected||!Number.isSafeInteger(expected.bytes)||expected.bytes<=0||!/^[a-f0-9]{64}$/.test(expected.sha256??''))throw Error('authenticated candidate pin required '+url);
  const bytes=await fs.readFile(source),pin={url,source,bytes:bytes.length,sha256:sha(bytes)};
  if(expected.bytes!==pin.bytes||expected.sha256!==pin.sha256)throw Error('candidate route identity '+url);
  routes.set(url,bytes);reviewedRoutes.push(pin);return bytes;
}
const base='/linux/tests/guest-vulkan-strip/',metadataBytes=await fs.readFile(packageRoot+'/package.json'),pkg=JSON.parse(metadataBytes);
if(pkg.passPackage!==true||pkg.testOnly!==true||pkg.candidateRuntime?.pipelineStateProfile!==1||
  JSON.stringify(pkg.expected)!==JSON.stringify({rounds:24,graphicsPasses:24,graphicsDraws:33,graphicsReadbacks:72,largeStripSourceCount:4098,largeStripExpandedCount:12288,largeStripPieces:4,normalExitCleanup:true}))throw Error('reviewed candidate workload required');
await add(base+'candidate/package.json',packageRoot+'/package.json',{bytes:metadataBytes.length,sha256:sha(metadataBytes)});
await add(base+'candidate/initramfs.cpio',packageRoot+'/initramfs.cpio',{bytes:pkg.bytes,sha256:pkg.archiveSha256});
await add(base+'guest.html',packageRoot+'/guest.html',pkg.candidatePage);
await add('/linux/tests/guest-gpu/host.mjs',packageRoot+'/host.mjs',pkg.candidateHost);
await add('/linux/dist/guest-gpu-vk.js',packageRoot+'/guest-gpu-vk.js',pkg.candidateWorker);
for(const name of ['bridge.mjs','graphics-renderer.mjs','guest_vulkan_wgpu_host.js','guest_vulkan_wgpu_host_bg.wasm'])await add('/linux/gpu-runtime/pipeline-candidate/'+name,packageRoot+'/runtime/'+name,pkg.candidateRuntime.files[name]);
await fs.writeFile(root+'/reviewed-route-pins.json',JSON.stringify(reviewedRoutes,null,2)+'\n');
const protectedPids=[705,706,1095195,1095196,1183734,1183743,1183764,4150936,4150944,1000,2631,1791291];
async function identity(pid){try{const raw=await fs.readFile('/proc/'+pid+'/stat','utf8'),s=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/);return {pid,pgid:Number(s[2]),sid:Number(s[3]),startTicks:s[19]};}catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')return null;throw e;}}
const protectedBefore=(await Promise.all(protectedPids.map(identity))).filter(Boolean);
await fs.writeFile(root+'/protected-before.json',JSON.stringify(protectedBefore,null,2)+'\n');
const {runBrowser}=await prepareOwnedGpuBrowser(root),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report=await runBrowser({mode:'hardware',out:root+'/run',routes,page:base+'guest.html?backend='+backend,timeoutMs:540000,
  run:async({evaluate,affinity,deadlineAt})=>{
    const readyDeadline=Math.min(Date.now()+15000,deadlineAt);
    while(!await evaluate('typeof document.querySelector("#boot")?.onclick==="function"')){if(Date.now()>readyDeadline)throw Error('fixture readiness deadline');await sleep(100);}
    const cpu=selectHostCpus(affinity.hostNproc,await evaluate('navigator.hardwareConcurrency'));
    const apiAdapter=backend==='webgl'?null:await evaluate('(async()=>{const a=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});return a?{vendor:a.info.vendor,architecture:a.info.architecture,description:a.info.description,isFallbackAdapter:a.info?.isFallbackAdapter??a.isFallbackAdapter??null}:null})()');
    await evaluate('document.querySelector("#boot").click()');let guest;
    while(Date.now()<deadlineAt-15000){guest=await evaluate('window.guestStripResults');if(guest?.done)break;await sleep(250);}
    if(!guest?.done)throw Error('fixture terminal deadline');
    const closeDeadline=Math.min(Date.now()+5000,deadlineAt-10000);
    do {guest=await evaluate('window.guestStripResults');if(guest.gpuEvents?.some(e=>e.message?.startsWith('GUEST_WGPU_HOST_REPORT ')))break;await sleep(100);}while(Date.now()<closeDeadline);
    await fs.writeFile(root+'/run/guest.json',JSON.stringify(guest,null,2)+'\n');await fs.writeFile(root+'/run/guest-log.txt',guest.logs);
    const cpuEvidence=await saveGuestCpuEvidence(cpu,guest.bootLogs,{browserHardwareConcurrency:await evaluate('navigator.hardwareConcurrency'),selectedGuestCpus:guest.configuration?.cpus},root+'/run','pipeline',readHostNproc());
    await evaluate('document.querySelector("#stop").click()');
    return {pass:guest.pass===true&&guest.exitStatus===0&&guest.errors.length===0,guest,cpu:cpuEvidence,backend,apiAdapter,archiveSha256:pkg.archiveSha256};
  }});
report.protectedServices=await Promise.all(protectedBefore.map(async before=>({before,after:await identity(before.pid)})));
report.protectedServicesPass=report.protectedServices.every(row=>JSON.stringify(row.before)===JSON.stringify(row.after));report.pass&&=report.protectedServicesPass;
report.candidateSourcesUnchanged=true;for(const pin of reviewedRoutes){const bytes=await fs.readFile(pin.source);if(bytes.length!==pin.bytes||sha(bytes)!==pin.sha256)report.candidateSourcesUnchanged=false;}report.pass&&=report.candidateSourcesUnchanged;
report.candidatePackageSha256=sha(metadataBytes);report.scope='new strip and process-exit candidate; Firefox visible presentation remains pending';
const validation=checkGuestGpuStrip(report,reviewedRoutes);report.pass&&=validation.pass;
await fs.writeFile(root+'/run/validation.json',JSON.stringify(validation,null,2)+'\n');await fs.writeFile(root+'/run/result.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({pass:report.pass,backend,root,error:report.error??null,failedChecks:Object.entries(validation.checks).filter(([,v])=>!v).map(([k])=>k)}));if(!report.pass)process.exitCode=1;
