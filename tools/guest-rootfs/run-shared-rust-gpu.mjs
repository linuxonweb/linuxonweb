// Exercise the common GPU runtime with the retained, independently checked
// native Mesa client. This gate does not launch Firefox or accept its GPU APIs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { readHostNproc, selectHostCpus, saveGuestCpuEvidence } from './firefox-host-cpus.mjs';
import { checkSharedRustGpu } from './check-shared-rust-gpu.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const [mode, backend, rootArg] = process.argv.slice(2);
if (!['hardware', 'software'].includes(mode) || !['webgpu', 'webgl'].includes(backend) || !rootArg)
  throw Error('usage: node run-shared-rust-gpu.mjs hardware|software webgpu|webgl FRESH_TASK_ROOT');
const root = path.resolve(rootArg);
const diskParent = await fs.realpath(path.dirname(root));
if (!diskParent.startsWith('/mnt/p3/codex-build/') && diskParent !== '/mnt/p3/codex-build' &&
    !diskParent.startsWith('/mnt/p6/build/') && diskParent !== '/mnt/p6/build') throw Error('dedicated build root required');
const stat = await fs.statfs(diskParent);
if ([0x01021994, 0x858458f6].includes(stat.type) || stat.bavail * stat.bsize < 20 * 1024 ** 3)
  throw Error('disk-backed storage and 20GiB reserve required');
if (process.getuid() === 0) throw Error('launch the browser owner as the desktop user');
await fs.mkdir(root);
await fs.mkdir(root + '/t');
for (const key of ['TMPDIR', 'TMP', 'TEMP']) process.env[key] = root + '/t';
process.env.XDG_CACHE_HOME = root + '/cache';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Preserve the historical owner and rebind only its storage and import paths.
// The exact original and transformed bytes remain in this attempt's evidence.
const ownerPath = repo + 'web/linux/tests/guest-vulkan-wgpu/browser-session.mjs';
const original = await fs.readFile(ownerPath, 'utf8');
let owner = original;
const replacements = [
  ["export const TASK='/mnt/p6/project/build/guest-vulkan-wgpu-20261003';", `export const TASK=${JSON.stringify(root)};`],
  ["const repo=path.resolve(import.meta.dirname,'../../../..');", `const repo=${JSON.stringify(repo.replace(/\/$/, ''))};`],
  ["'../../../../tools/guest-rootfs/firefox-browser-affinity.mjs'", JSON.stringify(pathToFileURL(repo + 'tools/guest-rootfs/firefox-browser-affinity.mjs').href)],
  ["'../../../../tools/guest-rootfs/check-firefox-nightly-benchmark.mjs'", JSON.stringify(pathToFileURL(repo + 'tools/guest-rootfs/check-firefox-nightly-benchmark.mjs').href)],
  ["import {openSync, closeSync, readFileSync} from 'node:fs';", "import {openSync, closeSync, readFileSync, readdirSync, lstatSync} from 'node:fs';"],
  ["export async function runBrowser({out,mode='hardware',routes=new Map(),page='/probe.html',timeoutMs=180000,run}) {", `
function taskByteCount(out){
  const ephemeral=[out+'/cache/',out+'/profile/',out+'/xdg/',TASK+'/t/.org.chromium.Chromium.'];
  let bytes=0;const pending=[TASK];
  while(pending.length){const name=pending.pop();
    try{const s=lstatSync(name);bytes+=s.size;if(s.isDirectory())for(const child of readdirSync(name))pending.push(name+'/'+child);}
    catch(e){if(e.code==='ENOENT'&&ephemeral.some(prefix=>name.startsWith(prefix)))continue;throw e;}
  }
  return bytes;
}
export async function runBrowser({out,mode='hardware',routes=new Map(),page='/probe.html',timeoutMs=180000,run}) {`],
  ["Number(execFileSync('du',['-sb',TASK],{encoding:'utf8'}).split(/\\s/)[0])", "taskByteCount(out)"],
  // This host assigns headless Chromium a different CPU quota. Both arms use
  // headed execution and still independently verify their actual quotas.
  ["['--headless','--use-angle=swiftshader','--enable-unsafe-swiftshader']", "['--use-angle=swiftshader','--enable-unsafe-swiftshader']"],
  ["if(child.pid)await fs.writeFile('/proc/'+child.pid+'/oom_score_adj','1000');", "// Post-spawn setup belongs inside the cleanup-protected block below."],
  ["let exitInfo,spawnError,browser,pageSocket,guardRunning=false,guardError,peakRssKiB=0;", "let ownedStart='0'; let exitInfo,spawnError,browser,pageSocket,guardRunning=false,guardError,peakRssKiB=0;"],
  ["let text,stat,version;const deadline=Date.now()+20000;", `
  if(!child.pid)throw Error('owned browser spawn failed');
  const ownedStat=readFileSync('/proc/'+child.pid+'/stat','utf8');
  const ownedFields=ownedStat.slice(ownedStat.lastIndexOf(')')+2).trim().split(/\\s+/);
  ownedStart=ownedFields[19];
  if(Number(ownedFields[2])!==child.pid||Number(ownedFields[3])!==child.pid)throw Error('owned browser session identity');
  await fs.writeFile('/proc/'+child.pid+'/oom_score_adj','1000');
  await fs.writeFile(out+'/owned-process.json',JSON.stringify({pid:child.pid,pgid:child.pid,sid:child.pid,startTicks:ownedStart})+'\\n');
  let text,stat,version;const deadline=Date.now()+20000;`],
  ["const terminate=signal=>{try{process.kill(-child.pid,signal);}catch(e){if(e.code!=='ESRCH')throw e;}};", `
  const terminate=signal=>{
    const owned=[];
    for(const name of readdirSync('/proc')){
      if(!/^\\d+$/.test(name))continue;
      let fields;
      try{const raw=readFileSync('/proc/'+name+'/stat','utf8');fields=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\\s+/);}catch(e){if(['ENOENT','ESRCH'].includes(e.code))continue;throw e;}
      if(Number(fields[2])!==child.pid)continue;
      if(Number(fields[3])!==child.pid||BigInt(fields[19])<BigInt(ownedStart)||(Number(name)===child.pid&&fields[19]!==ownedStart))throw Error('browser group identity changed before cleanup');
      owned.push(Number(name));
    }
    if(owned.length)try{process.kill(-child.pid,signal);}catch(e){if(e.code!=='ESRCH')throw e;}
  };`],
];
for (const [before, after] of replacements) {
  if (owner.split(before).length !== 2) throw Error('historical owner rebind anchor changed');
  owner = owner.replace(before, after);
}
await fs.writeFile(root + '/owner-original.mjs', original);
await fs.writeFile(root + '/owner.mjs', owner);
await fs.writeFile(root + '/owner-rebind.json', JSON.stringify({ originalPath: ownerPath,
  originalSha256: sha(original), reboundSha256: sha(owner), replacements, frozenFilesChanged: false }, null, 2) + '\n');
const { runBrowser } = await import(pathToFileURL(root + '/owner.mjs').href);

const packageRoot = '/mnt/p6/project/build/guest-vulkan-wgpu-20261003/egl-package-resources-final';
const metadataBytes = await fs.readFile(packageRoot + '/package.json');
const metadata = JSON.parse(metadataBytes);
const archive = await fs.readFile(packageRoot + '/initramfs.cpio');
if (!metadata.passPackage || !metadata.testOnly || archive.length !== metadata.bytes ||
    sha(archive) !== 'a4d7447a21c53e8887b8dfcbfbd34f9340ce3bf5b267f5706d4f0b56ec97e330' ||
    metadata.archiveSha256 !== sha(archive)) throw Error('retained native EGL package changed');
const base = '/linux/tests/guest-vulkan-wgpu/candidate/';
// No private candidate Rust module is served: the production service must load
// its own versioned assets through the actual machine-owned hostcall route.
const routes = new Map([[base + 'package.json', metadataBytes], [base + 'initramfs.cpio', archive]]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = await runBrowser({ mode, out: root + '/run', routes, timeoutMs: 540000,
  page: '/linux/tests/guest-vulkan-wgpu/egl.html?backend=' + backend,
  run: async ({ evaluate, affinity }) => {
    const start = Date.now();
    while (!await evaluate('typeof document.querySelector("#boot")?.onclick === "function"')) {
      if (Date.now() - start > 15000) throw Error('GPU page readiness deadline');
      await sleep(100);
    }
    const cpu = selectHostCpus(affinity.hostNproc, await evaluate('navigator.hardwareConcurrency'));
    const apiAdapter = backend === 'webgl' ? null : await evaluate('(async()=>{const a=await navigator.gpu?.requestAdapter({powerPreference:"high-performance"});return a?{vendor:a.info.vendor,architecture:a.info.architecture,description:a.info.description,isFallbackAdapter:a.info?.isFallbackAdapter??a.isFallbackAdapter??null}:null})()');
    await evaluate('document.querySelector("#boot").click()');
    let guest;
    for (;;) {
      guest = await evaluate('window.guestWgpuResults');
      if (guest?.done) break;
      if (Date.now() - start > 495000) throw Error('native EGL deadline');
      await sleep(200);
    }
    await sleep(500);
    guest = await evaluate('window.guestWgpuResults');
    await fs.writeFile(root + '/run/guest.json', JSON.stringify(guest, null, 2) + '\n');
    await fs.writeFile(root + '/run/guest-log.txt', guest.logs);
    const cpuEvidence = await saveGuestCpuEvidence(cpu, guest.bootLogs, {
      browserHardwareConcurrency: await evaluate('navigator.hardwareConcurrency'),
      selectedGuestCpus: guest.configuration?.cpus,
    }, root + '/run', 'egl', readHostNproc());
    await evaluate('document.querySelector("#stop").click()');
    return { pass: guest.pass && guest.exitStatus === 0 && guest.errors.length === 0,
      cpu: cpuEvidence, guest, backend, apiAdapter, archiveSha256: sha(archive) };
  },
});
report.scope = 'native Mesa EGL through common Rust wgpu service; Firefox acceptance remains false';
report.commonRustRequests = report.requests.filter(r => r.url.startsWith('/linux/gpu-runtime/'));
report.privateRustRequests = report.requests.filter(r => /candidate\/guest_vulkan_wgpu_host/.test(r.url));
report.pass &&= report.commonRustRequests.some(r => r.url.endsWith('.wasm')) && report.privateRustRequests.length === 0;
const validation = checkSharedRustGpu(report);
report.pass &&= validation.pass;
await fs.writeFile(root + '/run/validation.json', JSON.stringify(validation, null, 2) + '\n');
await fs.writeFile(root + '/run/result.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ pass: report.pass, mode, backend, error: report.error ?? null, root }));
if (!report.pass) process.exitCode = 1;
