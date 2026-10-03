// Independent raw-log, adapter, completion and fairness acceptance.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const median=xs=>{const a=xs.slice().sort((a,b)=>a-b);return a.length%2?a[a.length>>1]:(a[a.length/2-1]+a[a.length/2])/2;};
const distribution=xs=>{const a=xs.slice().sort((a,b)=>a-b),pct=p=>a[Math.min(a.length-1,Math.ceil(p*a.length)-1)];return {count:a.length,min:a[0],median:median(a),p90:pct(.9),p95:pct(.95),max:a.at(-1),mean:a.reduce((s,n)=>s+n,0)/a.length};};
const fields=line=>Object.fromEntries(line.split(' ').slice(1).map(word=>{const i=word.indexOf('=');return[word.slice(0,i),word.slice(i+1)];}));
const software=/swiftshader|llvmpipe|lavapipe|softpipe|software rasterizer|cpu adapter/i;
const hashPattern=/^[a-f0-9]{64}$/;
const canonicalSources=inputs=>inputs&&typeof inputs==='object'&&!Array.isArray(inputs)&&Object.keys(inputs).length?JSON.stringify(Object.entries(inputs).sort(([a],[b])=>a.localeCompare(b))):null;
const validSources=inputs=>!!canonicalSources(inputs)&&Object.entries(inputs).every(([path,hash])=>path.length>0&&typeof hash==='string'&&hashPattern.test(hash));
const canonicalRequests=requests=>{
  if(!Array.isArray(requests)||!requests.length)return null;
  const paths=new Map();
  for(const r of requests){
    if(typeof r?.url!=='string'||!r.url.startsWith('/')||!hashPattern.test(r.sha256??'')||!Number.isSafeInteger(r.bytes)||r.bytes<0)return null;
    const identity=JSON.stringify([r.sha256,r.bytes]);
    if(paths.has(r.url)&&paths.get(r.url)!==identity)return null;
    paths.set(r.url,identity);
  }
  return JSON.stringify([...paths].sort(([a],[b])=>a.localeCompare(b)));
};
export function parseRun(report){
  const guest=report.result?.guest??{},lines=String(guest.logs??'').replaceAll('\r','').split('\n');
  const rows=prefix=>lines.filter(l=>l.startsWith(prefix+' ')).map(fields),config=rows('GUEST_WGPU_CONFIG'),result=rows('GUEST_WGPU_RESULT'),pixels=rows('GUEST_WGPU_PIXELS'),exit=rows('GUEST_WGPU_EXIT'),frames=rows('GUEST_WGPU_FRAME');
  const hosts=(guest.gpuEvents??[]).filter(e=>typeof e.message==='string'&&e.message.startsWith('GUEST_WGPU_HOST_REPORT ')).flatMap(e=>{try{return[JSON.parse(e.message.slice('GUEST_WGPU_HOST_REPORT '.length))];}catch{return[];}});
  const c=config[0]??{},r=result[0]??{},p=pixels[0]??{},h=hosts[0]??{},n=Number(c.frames),warmup=Number(c.warmup),times=frames.map(f=>Number(f.completed_ms)),sum=times.reduce((s,x)=>s+x,0),expectedPixels=Number(c.width)*Number(c.height)*4;
  const api=report.result?.apiAdapter,adapter=h.adapter??{},backend=adapter.backend??'';
  const cpu=report.result?.cpu,cpus=cpu?.hostNproc;
  const checks={
    execution:report.pass===true&&guest.pass===true&&guest.exitStatus===0&&guest.errors?.length===0,
    exactLogRows:config.length===1&&result.length===1&&pixels.length===1&&exit.length===1&&Number(exit[0]?.status)===0,
    actualVulkan:lines.includes('GUEST_GPU_HOSTCALL')&&c.api==='Vulkan1.0'&&c['public-loader']==='1',
    noGuestFailures:!lines.some(l=>/^GUEST_WGPU_(?:FAIL|PIXEL_FAIL)\b/.test(l)||/wasm trap|panic|out of memory|segmentation fault/i.test(l)),
    completedFrameRows:Number.isInteger(n)&&n>=30&&n<=120&&Number.isInteger(warmup)&&warmup>=5&&warmup<=30&&frames.length===n&&frames.every((f,i)=>f.phase==='measure'&&Number(f.index)===i&&Number.isFinite(times[i])&&times[i]>0&&f.checksum===r.checksum),
    completedElapsed:Number(r.completed)===n&&Number(r.elapsed_ms)>0&&Math.abs(sum-Number(r.elapsed_ms))<.001&&Math.abs(n*1000/Number(r.elapsed_ms)-Number(r.fps))<.001,
    fullPixelReference:Number(p.checks)===expectedPixels&&expectedPixels>=65536&&Number(p.failures)===0&&Number(p.tolerance)===2&&Number(r.pixel_checks)===expectedPixels&&Number(r.pixel_failures)===0&&p.checksum===r.checksum,
    hostCompletion:hosts.length===1&&!h.error&&h.graphicsPasses===n+warmup&&h.graphicsDraws===n+warmup&&h.graphicsReadbacks===n+warmup&&h.graphicsTranslations===2&&h.graphicsTranslatorsCreated===1&&h.graphicsTranslatorsClosed===1,
    rustBackend:h.backend==='wgpu'&&['BrowserWebGpu','Gl'].includes(backend),
    nativeCleanup:h.graphics?.state==='closed'&&h.graphics.resources===0&&h.graphics.nativeObjects===0&&h.graphics.allocatedBytes===0&&h.cleanupErrors?.length===0,
    exactCpus:Number.isInteger(cpus)&&cpus>0&&report.affinity?.hostNproc===cpus&&cpu.browserHardwareConcurrency===cpus&&cpu.guestBootCpus===cpus&&cpu.selectedGuestCpus===cpus&&Object.values(cpu.checks??{}).every(v=>v===true)&&Object.values(report.affinity?.checks??{}).every(v=>v===true),
    ownership:report.endpointOwnership?.verified===true&&report.groupEmpty===true&&report.remainingGroup?.length===0&&report.browserExit?.code===0&&report.serverClosed===true&&!report.forcedTermination&&!report.guardError,
    sourcePins:report.inputsUnchanged===true&&/^[a-f0-9]{64}$/.test(report.packageSha256??'')&&/^[a-f0-9]{64}$/.test(report.archiveSha256??'')&&!report.runnerChanged,
    servedSourceManifest:validSources(report.inputs)&&canonicalRequests(report.requests)!==null,
    noExceptions:!report.events?.some(e=>e.method==='Runtime.exceptionThrown'),
    backendChoice:report.result?.backend==='webgl'?backend==='Gl':report.result?.backend==='webgpu'?backend==='BrowserWebGpu':false,
    adapterIdentity:report.result?.backend==='webgpu'?!!api&&!!api.vendor&&!!api.architecture:!!adapter.name,
  };
  if(report.result?.backend==='webgpu')checks.controlIdentity=report.mode==='hardware'?!software.test(JSON.stringify(api))&&api.isFallbackAdapter!==true:report.mode==='software'&&software.test(JSON.stringify(api));
  if(report.result?.backend==='webgpu')checks.rustAdapterDeviceClass=report.mode==='hardware'?typeof adapter.deviceType==='string'&&adapter.deviceType.length>0&&adapter.deviceType!=='Cpu':report.mode==='software'&&adapter.deviceType==='Cpu';
  const scope=report.result?.backend==='webgpu'?(report.mode==='hardware'?'hardware WebGPU via Rust wgpu':'host SwiftShader WebGPU via Rust wgpu'):'separate Rust wgpu WebGL fallback';
  return {pass:Object.values(checks).every(v=>v===true),checks,config:c,result:r,host:h,apiAdapter:api,adapter,scope,frameTimeMs:times.length?distribution(times):null,completedFPS:Number(r.fps),completedRenderElapsedMs:Number(r.elapsed_ms),rawFrameRows:frames,cpuCount:cpus};
}
export function compareRuns(hardware,control){
  const h=parseRun(hardware),s=parseRun(control);
  const checks={hardwareValid:h.pass,softwareValid:s.pass,hardwareWebGpu:h.adapter.backend==='BrowserWebGpu'&&hardware.mode==='hardware',softwareWebGpu:s.adapter.backend==='BrowserWebGpu'&&control.mode==='software',sameGuestBinaryAndRustAssets:hardware.packageSha256===control.packageSha256&&hardware.archiveSha256===control.archiveSha256,sameWorkload:JSON.stringify(h.config)===JSON.stringify(s.config),sameCpuAllocation:h.cpuCount===s.cpuCount&&JSON.stringify(hardware.affinity?.assignedCpus)===JSON.stringify(control.affinity?.assignedCpus),sameCompletedFrames:Number(h.result.completed)===Number(s.result.completed),sameRunnerSources:JSON.stringify(hardware.runnerSources)===JSON.stringify(control.runnerSources)};
  checks.sameServedSources=validSources(hardware.inputs)&&validSources(control.inputs)&&canonicalSources(hardware.inputs)===canonicalSources(control.inputs);
  checks.sameRequestedBytes=canonicalRequests(hardware.requests)!==null&&canonicalRequests(hardware.requests)===canonicalRequests(control.requests);
  const speedup=s.completedRenderElapsedMs/h.completedRenderElapsedMs,medianSpeedup=s.frameTimeMs?.median/h.frameTimeMs?.median;
  checks.substantialCompletedRenderSpeedup=Number.isFinite(speedup)&&speedup>=2;
  return {schema:1,pass:Object.values(checks).every(Boolean),guestVulkanGpuBenchmarkAcceptance:Object.values(checks).every(Boolean),firefoxGpuAcceptance:false,releaseAcceptance:false,checks,speedup,medianSpeedup,hardware:h,software:s,scope:'same guest Vulkan public-loader app/Rust wgpu WebGPU; physical adapter versus host SwiftShader; no guest Mesa/Lavapipe or Firefox GPU acceptance',pixelComparison:{sameChecksum:h.result.checksum===s.result.checksum,fullReferenceToleranceBytes:2},timing:'warmup excluded; guest monotonic clock surrounds vkQueueSubmit/vkQueueWaitIdle, including completed Rust GPU render and texture readback; excludes CPU pixel-reference calculation and presentation'};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [hardwarePath,softwarePath,out]=process.argv.slice(2);if(!out)throw Error('usage: HARDWARE_RESULT SOFTWARE_RESULT OUT_JSON');
  const hb=await fs.readFile(hardwarePath),sb=await fs.readFile(softwarePath),report=compareRuns(JSON.parse(hb),JSON.parse(sb));report.evidence=[{path:hardwarePath,sha256:sha(hb)},{path:softwarePath,sha256:sha(sb)}];report.checkerSha256=sha(await fs.readFile(fileURLToPath(import.meta.url)));await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:report.pass,speedup:report.speedup,medianSpeedup:report.medianSpeedup,checks:report.checks,out}));if(!report.pass)process.exitCode=1;
}
