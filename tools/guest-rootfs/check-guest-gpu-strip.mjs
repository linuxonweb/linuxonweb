// Real public-Vulkan pixel fixture acceptance, scoped to the bounded candidate.
import {browserAffinityChecks, cgroupPath, expandCpuList, parseCpuMax} from './firefox-browser-affinity.mjs';
import {guestCpuChecks} from './firefox-host-cpus.mjs';
const software=/swiftshader|llvmpipe|lavapipe|softpipe|software rasterizer/i;
const fields=line=>Object.fromEntries(line.split(' ').slice(1).map(word=>{const at=word.indexOf('=');return [word.slice(0,at),word.slice(at+1)];}));
function quotaMatches(q,text,list) {
  const parts=cgroupPath(text).split('/').filter(Boolean),allowed=expandCpuList(list).length;
  const paths=Array.from({length:parts.length+1},(_,i)=>'/'+parts.slice(0,i).join('/'));
  if(!Array.isArray(q?.ancestors)||!q.ancestors.length)return false;
  const expected=q.ancestors[0].cgroup==='/'?paths:paths.slice(1);let minimum=Infinity;
  if(expected.length!==q.ancestors.length)return false;
  for(let i=0;i<expected.length;i++) {const row=q.ancestors[i],parsed=parseCpuMax(row.cpuMax);if(row.cgroup!==expected[i]||row.quotaCpus!==parsed)return false;if(parsed!==null)minimum=Math.min(minimum,parsed);}
  return q.cgroup===cgroupPath(text)&&q.allowedCpuCount===allowed&&q.minimumQuotaCpus===(Number.isFinite(minimum)?minimum:null)&&q.effectiveCpus===Math.min(allowed,Math.ceil(minimum));
}
export function checkGuestGpuStrip(report,reviewedRoutes) {
  const g=report.result?.guest??{},lines=String(g.logs??'').replaceAll('\r','').split('\n');
  const rows=prefix=>lines.filter(line=>line.startsWith(prefix+' ')).map(fields);
  const pixels=rows('GUEST_VK_STRIP_PIXELS_PASS'),rounds=rows('GUEST_VK_STRIP_ROUND_PASS'),exits=rows('GUEST_VK_STRIP_NORMAL_EXIT'),processExits=rows('GUEST_VK_STRIP_PROCESS_EXIT'),closes=rows('GUEST_VK_CLOSE');
  const hosts=(g.gpuEvents??[]).filter(e=>typeof e.message==='string'&&e.message.startsWith('GUEST_WGPU_HOST_REPORT ')).map(e=>{try{return JSON.parse(e.message.slice(23));}catch{return null;}});
  const h=hosts[0]??{},a=h.adapter??{},api=report.result?.apiAdapter,cpu=report.result?.cpu,affinity=report.affinity;
  const requested=url=>report.requests?.filter(r=>r.url===url)??[];
  const requiredRoutes=['/linux/tests/guest-vulkan-strip/candidate/package.json','/linux/tests/guest-vulkan-strip/candidate/initramfs.cpio','/linux/tests/guest-vulkan-strip/guest.html','/linux/dist/guest-gpu-vk.js','/linux/tests/guest-gpu/host.mjs',...['bridge.mjs','graphics-renderer.mjs','guest_vulkan_wgpu_host.js','guest_vulkan_wgpu_host_bg.wasm'].map(name=>'/linux/gpu-runtime/pipeline-candidate/'+name)];
  const gridCount=value=>/^\d+$/.test(value??'')&&Number.isSafeInteger(Number(value))&&Number(value)<=4096;
  const expectedRound=i=>{const indexed=i>=21?i-21:i%3;return {round:String(i),count:String(i>=21?4098:6),strip:'1',mask:String(i===0?15:[0,7,8,15][i%4]),reverse:String(i>=15&&i<21&&indexed?1:0),cull:String(i>=9&&i<21?(i%2?1:2):0),front:String(i>=12&&i<21?1:0),indexed:String(indexed),vertexOffset:String(indexed===1?-3:indexed===2?2:0)};};
  const checks={
    execution:report.pass===true&&g.done===true&&g.pass===true&&g.exitStatus===0&&g.errors?.length===0,
    configuration:g.isolated===true&&g.candidateOnly===true&&g.backend===report.result?.backend&&g.configuration?.gpuHostcall?.ownerConfig?.vk?.backend==='wgpu'&&g.configuration.gpuHostcall.ownerConfig.vk.wgpuBackend===report.result?.backend&&g.configuration.gpuHostcall.ownerConfig.vk.forceFallbackAdapter===false&&g.configuration.gpuHostcall.ownerConfig.vk.allowResources===true,
    completedRounds:pixels.length===24&&rounds.length===24&&pixels.every((r,i)=>Number(r.round)===i)&&rounds.every((r,i)=>Number(r.round)===i&&r.rejectsPreserveReadback==='1'),
    pixelCoverage:pixels.every(r=>r.alphaPreload==='64'&&r.flatFirst==='1'&&gridCount(r.inside)&&gridCount(r.outside)&&Number(r.inside)+Number(r.outside)<=4096&&Number(r.outside)>100&&(Number(r.inside)>30||Number(r.cull)>0))&&new Set(pixels.map(r=>r.mask)).size===4&&['0','7','8','15'].every(mask=>pixels.some(r=>r.mask===mask)),
    stripGeometry:pixels.slice(0,21).every(r=>r.strip==='1'&&r.count==='6')&&pixels.slice(21).every(r=>r.strip==='1'&&r.count==='4098'&&r.largeBands==='4'&&Number(r.inside)>1000),
    indexedOffsets:['1','2'].every(index=>rounds.some(r=>r.indexed===index))&&rounds.some(r=>r.vertexOffset==='-3')&&rounds.some(r=>r.vertexOffset==='2'),
    exactPerRound:pixels.length===24&&rounds.length===24&&pixels.every((row,i)=>{const expected=expectedRound(i);return ['round','count','strip','mask','reverse','cull','front'].every(key=>row[key]===expected[key])&&['round','indexed','vertexOffset'].every(key=>rounds[i][key]===expected[key]);}),
    genuineRustOperations:hosts.length===1&&h.backend==='wgpu'&&h.error===null&&h.graphicsPasses===24&&h.graphicsDraws===33&&h.graphicsReadbacks===72&&h.graphics?.passes===24&&h.graphics.draws===33&&h.graphics.readbacks===72,
    cleanup:h.graphics?.state==='closed'&&h.graphics.resources===0&&h.graphics.nativeObjects===0&&h.graphics.allocatedBytes===0&&h.graphics.recordingDraws===0&&h.cleanupErrors?.length===0&&h.graphicsTranslatorsCreated===1&&h.graphicsTranslatorsClosed===1&&lines.includes('GUEST_VK_RESOURCES live=0 allocated_bytes=0'),
    nativeExit:exits.length===1&&exits[0].status==='0'&&exits[0].explicitDestroy==='0'&&processExits.length===1&&processExits[0].status==='0'&&closes.length===1&&closes[0].status==='0'&&!rows('GUEST_VK_STRIP_EXIT').length&&lines.findIndex(l=>l.startsWith('GUEST_VK_STRIP_NORMAL_EXIT '))<lines.findIndex(l=>l.startsWith('GUEST_VK_CLOSE '))&&lines.findIndex(l=>l.startsWith('GUEST_VK_CLOSE '))<lines.findIndex(l=>l.startsWith('GUEST_VK_STRIP_PROCESS_EXIT '))&&/^\d+$/.test(exits[0].checks??'')&&Number.isSafeInteger(Number(exits[0].checks))&&Number(exits[0].checks)>200000&&Number(exits[0].checks)<1000000,
    noGuestFailures:!lines.some(line=>/GUEST_VK_STRIP_.*FAIL\b|wasm trap|panic|out of memory|segmentation fault/i.test(line)),
    negotiatedSemantics:lines.some(line=>line.startsWith('GUEST_VK_HOST_HELLO ')&&line.includes('"pipelineStateProfile":1')&&line.includes('"colorWriteMaskBits":15')&&line.includes('"triangleProvokingVertex":"'+(report.result?.backend==='webgl'?'last':'first')+'"')),
    backend:report.mode==='hardware'&&a.forceFallbackAdapter===false&&(report.result?.backend==='webgpu'?a.backend==='BrowserWebGpu'&&typeof a.deviceType==='string'&&!!a.deviceType&&a.deviceType!=='Cpu'&&!!api?.vendor&&!!api.architecture&&api.isFallbackAdapter===false&&!software.test(JSON.stringify(api)):report.result?.backend==='webgl'&&a.backend==='Gl'&&!!a.name&&typeof a.deviceType==='string'&&!!a.deviceType&&a.deviceType!=='Cpu'&&!software.test(a.name)),
    ownedLifecycle:report.endpointOwnership?.verified===true&&report.naturalGroupDrain?.pass===true&&report.groupEmpty===true&&report.remainingGroup?.length===0&&report.browserExit?.code===0&&!report.forcedTermination&&!report.guardError&&report.serverClosed===true,
    noExceptions:!report.events?.some(e=>e.method==='Runtime.exceptionThrown')&&report.httpErrors?.length===0,
    servedCandidate:Array.isArray(reviewedRoutes)&&reviewedRoutes.length===9&&new Set(reviewedRoutes.map(pin=>pin.url)).size===9&&requiredRoutes.every(url=>reviewedRoutes.some(pin=>pin.url===url))&&reviewedRoutes.every(pin=>{const hits=requested(pin.url);return /^[a-f0-9]{64}$/.test(pin.sha256??'')&&Number.isSafeInteger(pin.bytes)&&pin.bytes>0&&hits.length>0&&hits.every(hit=>hit.sha256===pin.sha256&&hit.bytes===pin.bytes);}),
    servedSources:report.inputsUnchanged===true&&Object.keys(report.inputs??{}).length>0&&Object.entries(report.inputs).every(([source,pin])=>{const at=source.lastIndexOf('/web/linux/');return at>=0&&requested(source.slice(at+4)).some(hit=>hit.sha256===pin);}),
    candidateSourcesUnchanged:report.candidateSourcesUnchanged===true,
    protectedServices:report.protectedServicesPass===true&&Array.isArray(report.protectedServices)&&report.protectedServices.length>0&&report.protectedServices.every(row=>row.before?.pid>0&&JSON.stringify(row.before)===JSON.stringify(row.after)),
    cpu:false,
  };
  try {const n=cpu.hostNproc,smp=String(g.bootLogs??'').split('\n').filter(line=>/smp: Brought up \d+ nodes?, \d+ CPUs?\b/.test(line));checks.cpu=Number.isInteger(n)&&n>0&&n<=64&&['browserHardwareConcurrency','hostCores','expectedHostCores','requestedGuestCpus','hostNprocObserved','browserHardwareConcurrencyAtBoot','selectedGuestCpus','guestBootCpus'].every(key=>cpu[key]===n)&&g.configuration?.cpus===n&&affinity.hostNproc===n&&Object.values(browserAffinityChecks(affinity,affinity)).every(v=>v===true)&&Object.values(guestCpuChecks(cpu,{browserHardwareConcurrency:cpu.browserHardwareConcurrencyAtBoot,selectedGuestCpus:cpu.selectedGuestCpus},cpu.hostNprocObserved)).every(v=>v===true)&&quotaMatches(affinity.runnerQuota,affinity.runnerCgroupObserved,affinity.runnerCpuList)&&quotaMatches(affinity.browserQuota,affinity.browserCgroup,affinity.browserCpuList)&&smp.length>0&&JSON.stringify(cpu.smpLines)===JSON.stringify(smp)&&smp.every(line=>Number(/, (\d+) CPUs?\b/.exec(line)[1])===n);}catch{}
  return {pass:Object.values(checks).every(v=>v===true),checks,adapter:a,scope:'bounded public Vulkan candidate: real strip parity/provoking/culling/index geometry, color masks, rejected-draw preservation and PID-bound normal exit through Rust wgpu',firefoxGpuAcceptance:false,concurrencyAcceptance:false,releaseAcceptance:false};
}
