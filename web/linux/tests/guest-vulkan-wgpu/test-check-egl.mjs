// Bounded checker regressions over retained real reports; never launches a browser.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {checkEgl} from './check-egl.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const [out,...sources]=process.argv.slice(2);
if(!out||sources.length!==3)throw Error('usage: OUT HARDWARE_RESULT SOFTWARE_RESULT GL_RESULT');
const tests=[],evidence=[],candidate='/linux/tests/guest-vulkan-wgpu/candidate/';
const rebindHost=(r,mutate)=>{const e=r.result.guest.gpuEvents.find(e=>e.message?.startsWith('GUEST_WGPU_HOST_REPORT '));const h=JSON.parse(e.message.slice(23));mutate(h);e.message='GUEST_WGPU_HOST_REPORT '+JSON.stringify(h);};
const changeRequest=(r,url,mutate)=>r.requests.filter(item=>item.url===url).forEach(mutate);
const negatives=[
 ['missingRequests',r=>{delete r.requests;},'requestedAssets'],
 ['emptyRequests',r=>{r.requests=[];},'requestedAssets'],
 ['requestObject',r=>{r.requests={};},'requestedAssets'],
 ['malformedRequestHash',r=>{r.requests[0].sha256='bad';},'requestedAssets'],
 ['fractionalRequestBytes',r=>{r.requests[0].bytes=1.5;},'requestedAssets'],
 ['conflictingDuplicateHash',r=>{r.requests.push({...r.requests[0],sha256:'0'.repeat(64)});},'requestedAssets'],
 ['conflictingDuplicateBytes',r=>{r.requests.push({...r.requests[0],bytes:r.requests[0].bytes+1});},'requestedAssets'],
 ['missingRustWasmRequest',r=>{r.requests=r.requests.filter(item=>item.url!==candidate+'guest_vulkan_wgpu_host_bg.wasm');},'requestedAssets'],
 ['missingArchiveRequest',r=>{r.requests=r.requests.filter(item=>item.url!==candidate+'initramfs.cpio');},'requestedAssets'],
 ['reboundRustWasmRequest',r=>{changeRequest(r,candidate+'guest_vulkan_wgpu_host_bg.wasm',item=>{item.sha256='0'.repeat(64);});},'packageBindings'],
 ['reboundArchiveRequest',r=>{changeRequest(r,candidate+'initramfs.cpio',item=>{item.sha256='0'.repeat(64);});},'packageBindings'],
 ['missingServedRuntimeRequest',r=>{r.requests=r.requests.filter(item=>item.url!=='/linux/dist/index.js');},'sourcePins'],
 ['reboundServedRuntimeRequest',r=>{changeRequest(r,'/linux/dist/index.js',item=>{item.sha256='0'.repeat(64);});},'sourcePins'],
 ['traversalRequest',r=>{r.requests.push({...r.requests[0],url:'/linux/../other.js'});},'requestedAssets'],
 ['unknownCandidateAsset',r=>{r.requests.push({...r.requests[0],url:candidate+'unknown.js'});},'sourcePins'],
 ['missingRunnerSources',r=>{delete r.runnerSources;},'runnerBindings'],
 ['emptyRunnerSources',r=>{r.runnerSources={};},'runnerBindings'],
 ['runnerArray',r=>{r.runnerSources=[];},'runnerBindings'],
 ['missingBrowserRunnerPin',r=>{delete r.runnerSources[Object.keys(r.runnerSources).find(k=>k.endsWith('/browser-session.mjs'))];},'runnerBindings'],
 ['reboundBrowserRunnerPin',r=>{r.runnerSources[Object.keys(r.runnerSources).find(k=>k.endsWith('/browser-session.mjs'))]='0'.repeat(64);},'runnerBindings'],
 ['unexpectedRunnerPin',r=>{r.runnerSources['/other/runner.mjs']='0'.repeat(64);},'runnerBindings'],
 ['reboundRunnerRoot',r=>{r.runnerSources=Object.fromEntries(Object.entries(r.runnerSources).map(([k,v])=>['/other'+k,v]));},'runnerBindings'],
 ['reboundPageInput',r=>{r.inputs[Object.keys(r.inputs).find(k=>k.endsWith('/egl.html'))]='0'.repeat(64);},'runnerBindings'],
 ['missingInputs',r=>{delete r.inputs;},'sourcePins'],
 ['inputArray',r=>{r.inputs=[];},'sourcePins'],
 ['missingRuntimeInput',r=>{delete r.inputs[Object.keys(r.inputs).find(k=>k.endsWith('/dist/index.js'))];},'sourcePins'],
 ['missingEmbeddedPackage',r=>{delete r.result.guest.package;},'packageBindings'],
 ['reboundTopPackageHash',r=>{r.packageSha256='0'.repeat(64);},'packageBindings'],
 ['reboundNestedPackageHash',r=>{r.result.packageSha256='0'.repeat(64);},'packageBindings'],
 ['reboundNestedArchiveHash',r=>{r.result.archiveSha256='0'.repeat(64);},'packageBindings'],
 ['changedEmbeddedPackage',r=>{r.result.guest.package.guestBinary.sha256='0'.repeat(64);},'packageBindings'],
 ['changedRustMetadata',r=>{r.result.guest.package.wgpuArtifacts.guest_vulkan_wgpu_host_js={};},'packageBindings'],
 ['emptyCpuChecks',r=>{r.result.cpu.checks={};},'exactCpus'],
 ['missingCpuChecks',r=>{delete r.result.cpu.checks;},'exactCpus'],
 ['emptyAffinityChecks',r=>{r.affinity.checks={};},'exactCpus'],
 ['missingAffinityChecks',r=>{delete r.affinity.checks;},'exactCpus'],
 ['missingCpuCheckKey',r=>{delete r.result.cpu.checks.hostCpuSelection;},'exactCpus'],
 ['missingAffinityCheckKey',r=>{delete r.affinity.checks.actualBrowserAffinity;},'exactCpus'],
 ['extraCpuCheckKey',r=>{r.result.cpu.checks.extra=true;},'exactCpus'],
 ['falseAffinityCheck',r=>{r.affinity.checks.actualBrowserAffinity=false;},'exactCpus'],
 ['duplicateAssignedCpus',r=>{r.affinity.assignedCpus[1]=r.affinity.assignedCpus[0];},'exactCpus'],
 ['fractionalAssignedCpu',r=>{r.affinity.assignedCpus[0]=.5;},'exactCpus'],
 ['negativeAssignedCpu',r=>{r.affinity.assignedCpus[0]=-1;},'exactCpus'],
 ['missingAssignedCpus',r=>{delete r.affinity.assignedCpus;},'exactCpus'],
 ['mismatchedBrowserCpuList',r=>{r.affinity.browserCpuList='9-14';},'exactCpus'],
 ['malformedBrowserCpuList',r=>{r.affinity.browserCpuList='0-infinity';},'exactCpus'],
 ['missingSmpEvidence',r=>{r.result.cpu.smpLines=[];},'exactCpus'],
 ['reboundSmpEvidence',r=>{r.result.cpu.smpLines=['smp: Brought up 1 node, 7 CPUs'];},'exactCpus'],
 ['wrongGuestConfigurationCpus',r=>{r.result.guest.configuration.cpus++;},'exactCpus'],
 ['unknownMode',r=>{r.mode='unknown';},'backendChoice'],
 ['unknownBackend',r=>{r.result.backend='unknown';},'backendChoice'],
 ['webglSoftwareMode',r=>{r.mode='software';r.result.backend='webgl';},'backendChoice'],
 ['hardwareCpuDevice',r=>{r.mode='hardware';rebindHost(r,h=>{h.adapter.deviceType='Cpu';});},'adapter'],
];
for(const key of ['browserHardwareConcurrency','hostCores','expectedHostCores','requestedGuestCpus','hostNprocObserved','browserHardwareConcurrencyAtBoot','selectedGuestCpus','guestBootCpus'])negatives.push(['wrongCpu_'+key,r=>{r.result.cpu[key]++;},'exactCpus']);
for(const key of ['hostNproc','launchHostNproc','browserHardwareConcurrency'])negatives.push(['wrongAffinity_'+key,r=>{r.affinity[key]++;},'exactCpus']);
for(const source of sources){
 const bytes=await fs.readFile(source),original=JSON.parse(bytes),label=path.basename(path.dirname(source));evidence.push({path:path.resolve(source),bytes:bytes.length,sha256:sha(bytes)});
 const record=(name,r,expected,diagnostic,pins)=>{const actual=checkEgl(r,...(pins===undefined?[]:[pins])),failedChecks=Object.entries(actual.checks).filter(([,v])=>v!==true).map(([k])=>k),pass=actual.pass===expected&&(!diagnostic||failedChecks.includes(diagnostic))&&actual.firefoxGpuAcceptance===false&&actual.releaseAcceptance===false&&actual.performanceAcceptance===false;tests.push({arm:label,name,expected,actual:actual.pass,diagnostic,failedChecks,pass});};
 record('retainedActualReport',original,true);
 for(const [name,mutate,diagnostic]of negatives){const r=structuredClone(original);mutate(r);record(name,r,false,diagnostic);}
 const reordered=structuredClone(original);reordered.requests.reverse();reordered.inputs=Object.fromEntries(Object.entries(reordered.inputs).reverse());reordered.runnerSources=Object.fromEntries(Object.entries(reordered.runnerSources).reverse());reordered.affinity.assignedCpus.reverse();reordered.affinity.browserCpuList=[...original.affinity.assignedCpus].reverse().join(',');record('harmlessOrdering',reordered,true);
 const duplicates=structuredClone(original);duplicates.requests.push({...duplicates.requests[0]});record('identicalDuplicateRequest',duplicates,true);
 record('unavailableReviewedRunnerPins',original,false,'runnerBindings',null);
 record('incompleteReviewedRunnerPins',original,false,'runnerBindings',{});
 const directory=path.dirname(fileURLToPath(import.meta.url)),pins=Object.fromEntries(await Promise.all(['run-egl.mjs','browser-session.mjs','egl.html'].map(async name=>{const file=path.join(directory,name);return[file,sha(await fs.readFile(file))];})));record('explicitIndependentLocalRunnerPins',original,true,null,pins);
 if(sha(await fs.readFile(source))!==sha(bytes))throw Error('retained report changed during regression');
}
const report={schema:1,pass:tests.every(t=>t.pass),checks:tests.length,evidence,checkerSHA256:sha(await fs.readFile(new URL('./check-egl.mjs',import.meta.url))),regressionSHA256:sha(await fs.readFile(fileURLToPath(import.meta.url))),tests,scope:'bounded synthetic admission regressions over three immutable real EGL reports; no browser launch or new rendering acceptance'};
await fs.writeFile(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:report.pass,checks:report.checks,failed:tests.filter(t=>!t.pass),out}));if(!report.pass)process.exitCode=1;
