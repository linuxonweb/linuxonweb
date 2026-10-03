// Acceptance for the bounded Zink correctness primitive, never a performance claim.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex'),hash=/^[a-f0-9]{64}$/;
const fields=l=>Object.fromEntries(l.split(' ').slice(1).map(w=>{const p=w.indexOf('=');return [w.slice(0,p),w.slice(p+1)];}));
const software=/swiftshader|llvmpipe|lavapipe|softpipe|software rasterizer/i;
export function checkEgl(report){
 const g=report.result?.guest??{},lines=String(g.logs??'').replaceAll('\r','').split('\n'),rows=p=>lines.filter(l=>l.startsWith(p+' ')).map(fields);
 const configs=rows('GUEST_WGPU_EGL_CONFIG'),results=rows('GUEST_WGPU_EGL_RESULT'),frames=rows('GUEST_WGPU_EGL_FRAME'),exits=rows('GUEST_WGPU_EXIT'),c=configs[0]??{},r=results[0]??{};
 const hosts=(g.gpuEvents??[]).filter(e=>e.message?.startsWith('GUEST_WGPU_HOST_REPORT ')).map(e=>{try{return JSON.parse(e.message.slice(23));}catch{return null;}}),h=hosts[0]??{},a=h.adapter??{},api=report.result?.apiAdapter,cpu=report.result?.cpu;
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
  adapter:report.result?.backend==='webgpu'?a.backend==='BrowserWebGpu'&&!!api?.vendor&&!!api.architecture&&(report.mode==='hardware'?a.deviceType!=='Cpu'&&!software.test(JSON.stringify(api))&&api.isFallbackAdapter!==true:report.mode==='software'&&a.deviceType==='Cpu'&&software.test(JSON.stringify(api))):report.result?.backend==='webgl'&&a.backend==='Gl'&&!!a.name&&!software.test(a.name),
  exactCpus:Number.isInteger(cpu?.hostNproc)&&cpu.hostNproc>0&&report.affinity?.hostNproc===cpu.hostNproc&&cpu.browserHardwareConcurrency===cpu.hostNproc&&cpu.selectedGuestCpus===cpu.hostNproc&&cpu.guestBootCpus===cpu.hostNproc&&Object.values(cpu.checks??{}).every(v=>v===true)&&Object.values(report.affinity?.checks??{}).every(v=>v===true),
  ownership:report.endpointOwnership?.verified===true&&report.groupEmpty===true&&report.remainingGroup?.length===0&&report.browserExit?.code===0&&report.serverClosed===true&&!report.guardError&&!report.forcedTermination,
  sourcePins:report.inputsUnchanged===true&&!report.runnerChanged&&hash.test(report.packageSha256??'')&&hash.test(report.archiveSha256??'')&&Object.keys(report.inputs??{}).length>0&&Object.values(report.inputs??{}).every(s=>hash.test(s)),
  noExceptions:!report.events?.some(e=>e.method==='Runtime.exceptionThrown'),
 };
 return {pass:Object.values(checks).every(v=>v===true),checks,config:c,result:r,host:h,adapter:a,apiAdapter:api,frameChecksums:frames.map(f=>f.checksum),firefoxGpuAcceptance:false,releaseAcceptance:false,performanceAcceptance:false,scope:'actual Mesa26.2.3 GLES2/Zink indexed uniform/texture/depth primitive through Rust wgpu; all RGBA components checked with tolerance2 each frame, with depth-disabled overwrite control'};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const [source,out]=process.argv.slice(2);if(!out)throw Error('usage: RESULT OUT');const bytes=await fs.readFile(source),r=checkEgl(JSON.parse(bytes));r.evidence={path:source,sha256:sha(bytes)};r.checkerSha256=sha(await fs.readFile(fileURLToPath(import.meta.url)));await fs.writeFile(out,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({pass:r.pass,checks:r.checks,out}));if(!r.pass)process.exitCode=1;
}
