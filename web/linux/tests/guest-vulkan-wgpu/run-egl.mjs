import fs from 'node:fs/promises';
import path from 'node:path';
import {runBrowser,TASK,sha,diskCheck} from './browser-session.mjs';
import {saveGuestCpuEvidence,selectHostCpus,readHostNproc} from '../../../../tools/guest-rootfs/firefox-host-cpus.mjs';
const [mode,backend,out,packageArg]=process.argv.slice(2);
if(!packageArg||!['webgpu','webgl','auto'].includes(backend))throw Error('usage: hardware|software webgpu|webgl|auto OUT PACKAGE_DIR');
const packageDir=path.resolve(packageArg);await diskCheck(packageDir);
const packageBytes=await fs.readFile(packageDir+'/package.json'),metadata=JSON.parse(packageBytes),archive=await fs.readFile(packageDir+'/initramfs.cpio');
if(!metadata.passPackage||!metadata.testOnly||metadata.bytes!==archive.length||metadata.archiveSha256!==sha(archive))throw Error('candidate hash mismatch');
const sources={};for(const name of ['run-egl.mjs','browser-session.mjs','egl.html'])sources[path.join(import.meta.dirname,name)]=sha(await fs.readFile(path.join(import.meta.dirname,name)));
const base='/linux/tests/guest-vulkan-wgpu/candidate/';
const routes=new Map([[base+'package.json',packageBytes],[base+'initramfs.cpio',archive]]);
for(const[name,identity]of Object.entries(metadata.wgpuArtifacts??{})){if(!/^guest_vulkan_wgpu_host(?:_bg)?\.(?:js|wasm)$/.test(name))throw Error('unsupported Rust module artifact');const bytes=await fs.readFile(packageDir+'/'+name);if(sha(bytes)!==identity.sha256||bytes.length!==identity.bytes)throw Error('Rust module changed');routes.set(base+name,bytes);}
if(!routes.has(base+'guest_vulkan_wgpu_host.js')||!routes.has(base+'guest_vulkan_wgpu_host_bg.wasm'))throw Error('genuine Rust wgpu artifact pair required');
const report=await runBrowser({mode,out,timeoutMs:540000,routes,page:'/linux/tests/guest-vulkan-wgpu/egl.html?backend='+backend,run:async({evaluate,affinity})=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));let snapshot;
  const start=Date.now();for(;;){snapshot=await evaluate('({ready:typeof document.querySelector("#boot")?.onclick==="function",guest:window.guestWgpuResults??null})');if(snapshot.ready)break;if(Date.now()-start>15000)throw Error('guest page admission deadline');await sleep(100);}
  const cpu=selectHostCpus(affinity.hostNproc,await evaluate('navigator.hardwareConcurrency'));
  const apiAdapter=backend==='webgl'?null:await evaluate('(async()=>{const a=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});return a?{vendor:a.info.vendor,architecture:a.info.architecture,description:a.info.description,isFallbackAdapter:a.isFallbackAdapter}:null})()');
  await evaluate('document.querySelector("#boot").click()');
  for(;;){snapshot=await evaluate('({result:document.documentElement.dataset.result??null,guest:window.guestWgpuResults??null})');if(snapshot.result)break;if(Date.now()-start>495000)throw Error('guest benchmark deadline');await sleep(200);}
  await sleep(500);const guest=await evaluate('window.guestWgpuResults'),state={browserHardwareConcurrency:await evaluate('navigator.hardwareConcurrency'),selectedGuestCpus:guest.configuration?.cpus};
  const cpuEvidence=await saveGuestCpuEvidence(cpu,guest.bootLogs,state,out,'benchmark',readHostNproc());
  await fs.writeFile(out+'/guest-log.txt',guest.logs);await fs.writeFile(out+'/guest.json',JSON.stringify(guest,null,2)+'\n');
  const image=await evaluate('document.querySelector("#display").toDataURL("image/png")');await fs.writeFile(out+'/guest.png',Buffer.from(image.split(',')[1],'base64'));
  await evaluate('document.querySelector("#stop").click()');
  return {pass:guest.pass&&guest.exitStatus===0&&guest.errors.length===0,cpu:cpuEvidence,guest,apiAdapter,packageSha256:sha(packageBytes),archiveSha256:sha(archive),backend,scope:'guest Mesa Zink EGL primitive; correctness validation is separate'};
}});
report.runnerSources=sources;report.packagePath=packageDir;report.packageSha256=sha(packageBytes);report.archiveSha256=sha(archive);
for(const[source,hash]of Object.entries(sources))if(sha(await fs.readFile(source))!==hash){report.pass=false;report.runnerChanged=source;}
await fs.writeFile(out+'/result.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:report.pass,mode,backend,error:report.error,out}));if(!report.pass)process.exitCode=1;
