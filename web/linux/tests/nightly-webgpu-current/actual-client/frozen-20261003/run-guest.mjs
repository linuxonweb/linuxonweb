import fs from 'node:fs/promises';
import {runBrowser,TASK,sha} from './browser-session.mjs';
import {selectHostCpus,saveGuestCpuEvidence,readHostNproc} from '/mnt/p6/project/linux/linuxonweb/tools/guest-rootfs/firefox-host-cpus.mjs';
const [mode,out] = process.argv.slice(2);
const backend = process.env.CURRENT_GPU_BACKEND ?? 'auto';
if (!['hardware','software'].includes(mode) || !['auto','webgl'].includes(backend)) throw Error('reviewed mode/backend required');
const packageDir=TASK+'/package', packageBytes=await fs.readFile(packageDir+'/package.json');
const metadata=JSON.parse(packageBytes), archive=await fs.readFile(packageDir+'/initramfs.cpio');
if (!metadata.passPackage || !metadata.actualFirefoxClientSerializer || metadata.archiveSha256!==sha(archive) || metadata.bytes!==archive.length) throw Error('package identity');
for (const row of [...metadata.inputs,...metadata.currentPins.files]) {
  const bytes=await fs.readFile(row.path); if (sha(bytes)!==row.sha256 || bytes.length!==row.bytes) throw Error('input changed: '+row.path);
}
const base='/linux/tests/nightly-webgpu-current/native-transport/';
const routes=new Map([[base+'candidate/package.json',packageBytes],[base+'candidate/initramfs.cpio',archive]]);
for (const [name,row] of Object.entries(metadata.artifacts)) {
  const bytes=await fs.readFile(packageDir+'/'+name); if (sha(bytes)!==row.sha256 || bytes.length!==row.bytes) throw Error('Rust executor identity');
  routes.set(base+'candidate/'+name,bytes);
}
for (const name of ['guest.html','owner.mjs']) routes.set(base+name,await fs.readFile(TASK+'/'+name));
const report=await runBrowser({mode,out,routes,page:base+'guest.html?backend='+backend,timeoutMs:180000,run:async({evaluate,affinity})=>{
  const deadline=Date.now()+140000, sleep=ms=>new Promise(r=>setTimeout(r,ms));
  for (;;) { if (await evaluate('typeof document.querySelector("#boot")?.onclick==="function"')) break; if (Date.now()>deadline) throw Error('readiness deadline'); await sleep(100); }
  const cpu=selectHostCpus(affinity.hostNproc,await evaluate('navigator.hardwareConcurrency'));
  const apiIdentity=backend==='webgl'?null:await evaluate('(async()=>{const a=await navigator.gpu?.requestAdapter();return a?{vendor:a.info.vendor,architecture:a.info.architecture,description:a.info.description,isFallbackAdapter:a.isFallbackAdapter}:null})()');
  await evaluate('document.querySelector("#boot").click()'); let guest;
  for (;;) { guest=await evaluate('window.currentGpuResults'); if (guest.done) break; if (Date.now()>deadline) throw Error('native Rust client deadline'); await sleep(100); }
  await sleep(300); guest=await evaluate('window.currentGpuResults');
  const evidence=await saveGuestCpuEvidence(cpu,guest.bootLogs,{browserHardwareConcurrency:await evaluate('navigator.hardwareConcurrency'),selectedGuestCpus:guest.configuration?.cpus},out,'native',readHostNproc());
  await fs.writeFile(out+'/guest-log.txt',guest.logs); await fs.writeFile(out+'/guest.json',JSON.stringify(guest,null,2)+'\n');
  const events=guest.gpuEvents.filter(e=>e.kind==='owner-log').map(e=>JSON.parse(e.message));
  const cleanup=events.filter(e=>e.kind==='cleanup'), completed=events.filter(e=>e.kind==='completed');
  const marker='CURRENT_GPU_CLIENT_COMPLETE backend='+backend+' words=16 failures=0 adapter_callbacks=1 device_callbacks=1 map_callbacks=1 work_callbacks=1 actual_messages=12';
  const pass=guest.pass&&guest.exitStatus===0&&guest.errors.length===0&&guest.logs.split(marker).length===2&&guest.logs.includes('CURRENT_GPU_EXIT status=0')&&cleanup.length===1&&cleanup[0].count===0&&cleanup[0].liveSessions===0&&completed.length===5&&completed.filter(e=>e.mappedBytes.length===1&&e.mappedBytes[0]===64).length===1;
  await evaluate('document.querySelector("#stop").click()');
  return {pass,guest,cpu:evidence,owner:events,backend,apiIdentity,actualFirefoxClientSerializer:true,firefoxGpuAcceptance:false,scope:'actual Rust client serialization and FFI callbacks in standalone Linux/Wasm guest; no Firefox DOM/IPC or rendering acceptance'};
}});
report.packageSha256=sha(packageBytes); report.archiveSha256=sha(archive);
await fs.writeFile(out+'/result.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({pass:report.pass,out,error:report.error})); if (!report.pass) process.exitCode=1;
