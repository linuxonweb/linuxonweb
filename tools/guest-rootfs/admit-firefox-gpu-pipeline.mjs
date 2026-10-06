// Admit a test-only common Rust pipeline runtime after both actual pixel gates.
// This module launches no process and makes no Firefox acceleration claim.
// The caller must review the evidence and independent terminal receipts. Their
// pinned hashes prevent substitution; JSON alone cannot prove a GPU execution.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {checkGuestGpuPipeline} from './check-guest-gpu-pipeline.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const expected={rounds:24,graphicsPasses:24,graphicsDraws:33,graphicsReadbacks:72,
  largeFanSourceCount:4097,largeFanExpandedCount:12285,largeFanPieces:4};
async function canonicalDiskPath(value) {
  const p=await fs.realpath(value);
  if(p!==path.resolve(value)||!p.startsWith('/mnt/p3/codex-build/'))throw Error('canonical persistent pipeline evidence path required');
  return p;
}
async function regularBytes(value,maximum,pin=null) {
  const p=await canonicalDiskPath(value),stat=await fs.lstat(p);
  if(!stat.isFile()||stat.size<=0||stat.size>maximum)throw Error('bounded regular evidence file required');
  if(pin&&(pin.path!==p||pin.bytes!==stat.size||!/^[a-f0-9]{64}$/.test(pin.sha256??'')))throw Error('reviewed evidence pin required');
  const bytes=await fs.readFile(p);
  if(bytes.length!==stat.size||(pin&&sha(bytes)!==pin.sha256))throw Error('reviewed evidence bytes changed');
  return bytes;
}
export async function admitFirefoxGpuPipeline(evidencePath) {
  const evidenceFile=await canonicalDiskPath(evidencePath),evidenceBytes=await regularBytes(evidenceFile,65536);
  const evidence=JSON.parse(evidenceBytes),root=await canonicalDiskPath(evidence.packageRoot);
  if(evidence.schema!==2||evidence.rootReviewed!==true||!Array.isArray(evidence.runs)||evidence.runs.length!==2)throw Error('two root-reviewed actual pipeline gates required');
  if(!evidence.packagePin)throw Error('root-reviewed package pin required');
  const metadata=await regularBytes(root+'/package.json',65536,evidence.packagePin),pkg=JSON.parse(metadata);
  if(pkg.passPackage!==true||pkg.testOnly!==true||pkg.candidateRuntime?.pipelineStateProfile!==1||
    JSON.stringify(pkg.expected)!==JSON.stringify(expected))throw Error('bounded pipeline candidate required');
  const selected=[],routes=new Map();
  async function add(url,file,pin) {
    if(!pin||!Number.isSafeInteger(pin.bytes)||pin.bytes<=0||!/^[a-f0-9]{64}$/.test(pin.sha256??''))throw Error('candidate file pin required');
    const source=root+'/'+file,bytes=await regularBytes(source,file==='initramfs.cpio'?128*1024**2:16*1024**2,{...pin,path:source});
    if(bytes.length!==pin.bytes||sha(bytes)!==pin.sha256)throw Error('candidate runtime bytes changed: '+file);
    selected.push({url,source,bytes:bytes.length,sha256:sha(bytes)});routes.set(url,bytes);
  }
  const base='/linux/tests/guest-vulkan-pipeline/';
  await add(base+'candidate/package.json','package.json',{bytes:metadata.length,sha256:sha(metadata)});
  await add(base+'candidate/initramfs.cpio','initramfs.cpio',{bytes:pkg.bytes,sha256:pkg.archiveSha256});
  await add(base+'guest.html','guest.html',pkg.candidatePage);
  await add('/linux/tests/guest-gpu/host.mjs','host.mjs',pkg.candidateHost);
  await add('/linux/dist/guest-gpu-vk.js','guest-gpu-vk.js',pkg.candidateWorker);
  for(const file of ['bridge.mjs','graphics-renderer.mjs','guest_vulkan_wgpu_host.js','guest_vulkan_wgpu_host_bg.wasm'])
    await add('/linux/gpu-runtime/pipeline-candidate/'+file,'runtime/'+file,pkg.candidateRuntime.files[file]);
  const backendSet=new Set(),gates=[];
  for(const row of evidence.runs) {
    const runRoot=await canonicalDiskPath(row.root);
    if(!row.resultPin||!row.reviewPin)throw Error('independent terminal review pins required');
    const bytes=await regularBytes(runRoot+'/result.json',16*1024**2,row.resultPin),report=JSON.parse(bytes);
    const reviewBytes=await regularBytes(row.reviewPin.path,16*1024**2,row.reviewPin),review=JSON.parse(reviewBytes);
    if(review.reviewPass!==true||review.runtimeAcceptance!==true||!Array.isArray(review.pins)||
      !review.pins.some(pin=>['path','bytes','sha256'].every(key=>pin[key]===row.resultPin[key])))throw Error('independent passing runtime review required');
    const backend=report.result?.backend;
    if(!['webgpu','webgl'].includes(backend)||backendSet.has(backend))throw Error('distinct genuine WebGPU and RustGl gates required');
    backendSet.add(backend);
    if(report.candidatePackageSha256!==sha(metadata)||report.result?.archiveSha256!==pkg.archiveSha256)
      throw Error('actual gate tested a different candidate');
    const validation=checkGuestGpuPipeline(report,selected);
    if(!validation.pass)throw Error('actual pipeline runtime gate failed: '+backend);
    gates.push({backend,path:runRoot+'/result.json',bytes:bytes.length,sha256:sha(bytes),review:row.reviewPin,checks:validation.checks});
  }
  // Only the host, worker and four shared runtime assets enter the Firefox run.
  for(const url of [base+'candidate/package.json',base+'candidate/initramfs.cpio',base+'guest.html'])routes.delete(url);
  return {routes,pins:selected.filter(pin=>routes.has(pin.url)),review:{schema:1,
    evidence:{path:evidenceFile,bytes:evidenceBytes.length,sha256:sha(evidenceBytes)},
    package:{path:root+'/package.json',bytes:metadata.length,sha256:sha(metadata)},gates,
    pipelineStateProfile:1,testOnly:true,firefoxGpuAcceptance:false,releaseAcceptance:false}};
}
