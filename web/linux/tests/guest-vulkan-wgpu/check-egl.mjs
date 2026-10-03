// Acceptance for the bounded Zink correctness primitive, never a performance claim.
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex'),hash=/^[a-f0-9]{64}$/;
const fields=l=>Object.fromEntries(l.split(' ').slice(1).map(w=>{const p=w.indexOf('=');return [w.slice(0,p),w.slice(p+1)];}));
const software=/swiftshader|llvmpipe|lavapipe|softpipe|software rasterizer/i;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const runnerNames=['run-egl.mjs','browser-session.mjs','egl.html'];
function localRunnerSources(){
 try{return Object.fromEntries(runnerNames.map(name=>{const source=path.join(path.dirname(fileURLToPath(import.meta.url)),name);return[source,sha(readFileSync(source))];}));}catch{return null;}
}
const exactChecks=(value,names)=>object(value)&&Object.keys(value).length===names.length&&names.every(name=>value[name]===true);
function cpuList(value){
 if(typeof value!=='string'||!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(value))return null;
 const result=[];
 for(const part of value.split(',')){const [first,last=first]=part.split('-').map(Number);if(!Number.isSafeInteger(first)||!Number.isSafeInteger(last)||last<first||last-first>4096||result.length+last-first+1>4096)return null;for(let n=first;n<=last;n++)result.push(n);}
 return new Set(result).size===result.length?result.sort((a,b)=>a-b):null;
}
function requestManifest(value){
 if(!Array.isArray(value)||!value.length)return null;
 const entries=new Map();
 for(const r of value){if(!object(r)||typeof r.url!=='string'||!r.url.startsWith('/linux/')||path.posix.normalize(r.url)!==r.url||r.url.includes('?')||r.url.includes('#')||!hash.test(r.sha256??'')||!Number.isSafeInteger(r.bytes)||r.bytes<=0)return null;const previous=entries.get(r.url);if(previous&&(previous.sha256!==r.sha256||previous.bytes!==r.bytes))return null;entries.set(r.url,r);}
 return entries;
}
// A supplied map must be independently reviewed snapshot pins, never report.runnerSources.
export function checkEgl(report,reviewedRunnerSources=localRunnerSources()){
 const g=report.result?.guest??{},lines=String(g.logs??'').replaceAll('\r','').split('\n'),rows=p=>lines.filter(l=>l.startsWith(p+' ')).map(fields);
 const configs=rows('GUEST_WGPU_EGL_CONFIG'),results=rows('GUEST_WGPU_EGL_RESULT'),frames=rows('GUEST_WGPU_EGL_FRAME'),exits=rows('GUEST_WGPU_EXIT'),c=configs[0]??{},r=results[0]??{};
 const hosts=(g.gpuEvents??[]).filter(e=>typeof e.message==='string'&&e.message.startsWith('GUEST_WGPU_HOST_REPORT ')).map(e=>{try{return JSON.parse(e.message.slice(23));}catch{return null;}}),h=hosts[0]??{},a=h.adapter??{},api=report.result?.apiAdapter,cpu=report.result?.cpu,affinity=report.affinity,n=cpu?.hostNproc;
 const assigned=affinity?.assignedCpus,browserCpus=cpuList(affinity?.browserCpuList),requests=requestManifest(report.requests),metadata=g.package;
 const runnerKeys=object(reviewedRunnerSources)?Object.keys(reviewedRunnerSources):[],runnerRoot=runnerKeys.length?path.dirname(runnerKeys[0]):null;
 const reviewedRunners=runnerKeys.length===3&&runnerNames.every(name=>hash.test(reviewedRunnerSources[path.join(runnerRoot,name)]??''));
 const runnerBindings=reviewedRunners&&object(report.runnerSources)&&Object.keys(report.runnerSources).length===3&&runnerKeys.every(source=>report.runnerSources[source]===reviewedRunnerSources[source]);
 const page=runnerRoot?path.join(runnerRoot,'egl.html'):null,webRoot=runnerRoot?.endsWith('/web/linux/tests/guest-vulkan-wgpu')?runnerRoot.slice(0,-'/linux/tests/guest-vulkan-wgpu'.length):null;
 const candidate='/linux/tests/guest-vulkan-wgpu/candidate/',candidateNames=['package.json','initramfs.cpio','guest_vulkan_wgpu_host.js','guest_vulkan_wgpu_host_bg.wasm'];
 const inputs=report.inputs,sourceBindings=requests&&webRoot&&object(inputs)&&Object.keys(inputs).length>0&&Object.entries(inputs).every(([source,pin])=>source.startsWith(webRoot+'/linux/')&&hash.test(pin)&&requests.get(source.slice(webRoot.length))?.sha256===pin)&&[...requests].every(([url,r])=>url.startsWith(candidate)?candidateNames.includes(url.slice(candidate.length)):inputs[path.resolve(webRoot,'.'+url)]===r.sha256);
 const asset=(name,pin,bytes)=>requests?.get(candidate+name)?.sha256===pin&&hash.test(pin??'')&&(bytes===undefined||requests.get(candidate+name)?.bytes===bytes);
 const rust=metadata?.wgpuArtifacts;
 // package-egl.py emits this exact indent-two JSON plus newline; package key order
 // is part of its raw-byte identity, unlike request/source-map ordering.
 const packageBindings=object(metadata)&&metadata.passPackage===true&&metadata.testOnly===true&&metadata.mode==='guest-wgpu-egl-primitive'&&metadata.firefoxLaunch===false&&sha(JSON.stringify(metadata,null,2)+'\n')===report.packageSha256&&report.result?.packageSha256===report.packageSha256&&report.result?.archiveSha256===report.archiveSha256&&metadata.archiveSha256===report.archiveSha256&&asset('package.json',report.packageSha256)&&asset('initramfs.cpio',report.archiveSha256,metadata.bytes)&&object(rust)&&Object.keys(rust).length===2&&candidateNames.slice(2).every(name=>object(rust[name])&&asset(name,rust[name].sha256,rust[name].bytes));
 const checks={
  execution:report.pass===true&&g.pass===true&&g.exitStatus===0&&g.errors?.length===0,
  exactWorkload:configs.length===1&&c.width==='64'&&c.height==='64'&&c.frames==='6'&&c.workload==='zink-indexed-uniform-texture-depth-v1',
  actualMesa:lines.some(l=>l.startsWith('GUEST_WGPU_EGL_IDENTITY ')&&l.includes('OpenGL ES 2.0 Mesa 26.2.3')&&l.includes('renderer=zink Vulkan 1.1(EXPERIMENTAL')&&l.includes('NOT conformant')),
  honestProfile:lines.some(l=>l.startsWith('GUEST_VK_HOST_HELLO ')&&l.includes('"sampledColorTargets":1')&&l.includes('"uniformProfile":1')&&l.includes('"textureProfile":1')&&l.includes('"depthProfile":1')),
  noGuestFailures:!lines.some(l=>/^GUEST_WGPU_.*FAIL\b/.test(l)||/GUEST_VK_TRACE .*REJECT|wasm trap|panic|out of memory|segmentation fault/i.test(l)),
  completedFrames:frames.length===6&&frames.every((f,i)=>Number(f.index)===i&&f.completed==='1'&&/^\d+$/.test(f.checksum)),
  depthControl:frames.length===6&&frames.slice(0,3).every(f=>f.checksum===frames[0].checksum)&&frames.slice(3).every(f=>f.checksum===frames[3].checksum)&&frames[0].checksum!==frames[3].checksum,
  fullPixelReference:results.length===1&&r.completed==='6'&&r.pixel_checks==='98304'&&r.pixel_failures==='0'&&Number(r.elapsed_ms)>0&&r.checksum===frames.at(-1)?.checksum,
  successExit:exits.length===1&&exits[0].status==='0'&&lines.includes('GUEST_WGPU_INIT_EXIT status=0'),
  actualRustOperations:hosts.length===1&&h.backend==='wgpu'&&!h.error&&h.graphicsPasses===6&&h.graphicsDraws===12&&h.graphicsReadbacks===6&&h.graphicsUniformUploads===7&&h.graphicsTextureUploads===1&&h.graphicsTranslations===2&&h.graphics?.passes===6&&h.graphics.draws===12&&h.graphics.readbacks===6,
  translatorCleanup:h.graphicsTranslatorsCreated===1&&h.graphicsTranslatorsClosed===1,
  nativeCleanup:h.graphics?.state==='closed'&&h.graphics.resources===0&&h.graphics.nativeObjects===0&&h.graphics.allocatedBytes===0&&h.cleanupErrors?.length===0&&lines.includes('GUEST_VK_RESOURCES live=0 allocated_bytes=0'),
  backendChoice:['hardware/webgpu','software/webgpu','hardware/webgl'].includes(report.mode+'/'+report.result?.backend),
  adapter:report.result?.backend==='webgpu'?a.backend==='BrowserWebGpu'&&!!api?.vendor&&!!api.architecture&&(report.mode==='hardware'?typeof a.deviceType==='string'&&a.deviceType.length>0&&a.deviceType!=='Cpu'&&!software.test(JSON.stringify(api))&&api.isFallbackAdapter!==true:report.mode==='software'&&a.deviceType==='Cpu'&&software.test(JSON.stringify(api))):report.result?.backend==='webgl'&&a.backend==='Gl'&&!!a.name&&a.deviceType!=='Cpu'&&!software.test(a.name),
  exactCpus:Number.isInteger(n)&&n>0&&n<=64&&['browserHardwareConcurrency','hostCores','expectedHostCores','requestedGuestCpus','hostNprocObserved','browserHardwareConcurrencyAtBoot','selectedGuestCpus','guestBootCpus'].every(key=>cpu[key]===n)&&['hostNproc','launchHostNproc','browserHardwareConcurrency'].every(key=>affinity?.[key]===n)&&g.configuration?.cpus===n&&exactChecks(cpu.checks,['hostAllocationStable','hostCpuSelection','guestCpuCountMatchesHost'])&&exactChecks(affinity?.checks,['hostAllocationStable','browserCountMatchesHost','actualBrowserAffinity'])&&Array.isArray(assigned)&&assigned.length===n&&assigned.every(v=>Number.isSafeInteger(v)&&v>=0)&&new Set(assigned).size===n&&browserCpus?.length===n&&JSON.stringify([...assigned].sort((a,b)=>a-b))===JSON.stringify(browserCpus)&&Array.isArray(cpu.smpLines)&&cpu.smpLines.length>0&&cpu.smpLines.every(line=>g.bootLogs?.includes(line))&&Number(/, (\d+) CPUs?\b/.exec(cpu.smpLines.at(-1))?.[1])===n,
  ownership:report.endpointOwnership?.verified===true&&report.groupEmpty===true&&report.remainingGroup?.length===0&&report.browserExit?.code===0&&report.serverClosed===true&&!report.guardError&&!report.forcedTermination,
  sourcePins:report.inputsUnchanged===true&&!report.runnerChanged&&sourceBindings===true,
  runnerBindings:runnerBindings===true&&page!==null&&inputs?.[page]===reviewedRunnerSources?.[page]&&requests?.get('/linux/tests/guest-vulkan-wgpu/egl.html')?.sha256===reviewedRunnerSources?.[page],
  requestedAssets:requests!==null&&candidateNames.every(name=>requests.has(candidate+name)),
  packageBindings:packageBindings===true,
  noExceptions:!report.events?.some(e=>e.method==='Runtime.exceptionThrown'),
 };
 return {pass:Object.values(checks).every(v=>v===true),checks,config:c,result:r,host:h,adapter:a,apiAdapter:api,frameChecksums:frames.map(f=>f.checksum),firefoxGpuAcceptance:false,releaseAcceptance:false,performanceAcceptance:false,scope:'actual Mesa26.2.3 GLES2/Zink indexed uniform/texture/depth primitive through Rust wgpu; all RGBA components checked with tolerance2 each frame, with depth-disabled overwrite control'};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [source,out]=process.argv.slice(2);if(!out)throw Error('usage: RESULT OUT');const bytes=await fs.readFile(source),r=checkEgl(JSON.parse(bytes));r.evidence={path:source,sha256:sha(bytes)};r.checkerSha256=sha(await fs.readFile(fileURLToPath(import.meta.url)));await fs.writeFile(out,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({pass:r.pass,checks:r.checks,out}));if(!r.pass)process.exitCode=1;
}
