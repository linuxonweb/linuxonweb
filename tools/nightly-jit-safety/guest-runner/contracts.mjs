import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
export const PREPARATION_TASK='/mnt/p6/project/build/nightly-broad-guest-runner-20261004';
export const RUNTIME_CAP=4*1024**3;
export async function taskRoot(args) {
  const root=args['--task-root'];
  require(typeof root==='string'&&(/^\/mnt\/p6\/(?:project\/)?build\/[^/]+$/.test(root))&&await fs.realpath(root)===root&&(await fs.stat(root)).isDirectory(),'explicit canonical disk task root required');
  return root;
}
export function allocationContract(launch, manifest, observedUsage) {
  require(['kernel','plain','firefox'].every(key=>Number.isSafeInteger(manifest.assets?.[key]?.bytes)&&manifest.assets[key].bytes>0),'actual positive current package sizes required');
  const a=launch.runtimeAllocation, images=['kernel','plain','firefox'].reduce((sum,key)=>sum+manifest.assets[key].bytes,0);
  require(a&&a.diskCapBytes===RUNTIME_CAP&&a.sourceCopyBytes===0&&a.cacheImagesBytes===images&&Number.isSafeInteger(images)&&images>0&&Number.isSafeInteger(a.profileHomeLogsBudgetBytes)&&a.profileHomeLogsBudgetBytes>0&&Number.isSafeInteger(observedUsage)&&observedUsage>=0&&images+a.profileHomeLogsBudgetBytes+observedUsage<RUNTIME_CAP,'actual package cache/profile/home/log allocation exceeds reviewed4GiB runtime cap or is missing');
  return {...a,observedUsage,plannedTotalBytes:images+a.profileHomeLogsBudgetBytes+observedUsage};
}
export const REPO='/mnt/p6/project/linux/linuxonweb';
export const LIMIT=2*1024**2;
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const require=(ok,message)=>{if(!ok)throw Error(message);};
export const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export async function pinFile(record) {
  require(record&&typeof record.path==='string'&&record.path.startsWith('/')&&digest(record.sha256),'missing actual file binding');
  require(await fs.realpath(record.path)===record.path,'canonical actual input required: '+record.path);
  const before=await fs.stat(record.path);require(before.isFile(),'actual regular input required');
  const hash=createHash('sha256');for await(const block of createReadStream(record.path))hash.update(block);
  const after=await fs.stat(record.path);
  require(before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ino===after.ino&&hash.digest('hex')===record.sha256,'actual input changed: '+record.path);
  return {path:record.path,sha256:record.sha256,bytes:after.size,mtimeMs:after.mtimeMs,ino:after.ino};
}
export async function pinnedJSON(record) {await pinFile(record);const bytes=await fs.readFile(record.path);require(sha(bytes)===record.sha256,'JSON drift');return JSON.parse(bytes);}
export function patchInit(source) {
  const expression=/exec \/bin\/firefox --no-remote --new-instance[^"\n]*"/g;
  const matches=[...source.matchAll(expression)];require(matches.length===1,'one real packaged su/Firefox launch anchor required');
  const old=matches[0][0],replacement='exec /bin/sh /home/admin/nightly-jit-safety/capture-launch.sh"';
  const anchor='launch_firefox() {\n',install='  cp /home/admin/nightly-jit-safety/njs-autoconfig.js /opt/firefox/defaults/pref/njs-autoconfig.js || return 97\n  cp /home/admin/nightly-jit-safety/njs-autoconfig.cfg /opt/firefox/njs-autoconfig.cfg || return 97\n';
  require(source.split(anchor).length===2,'one root Firefox launch function required');
  const output=source.replace(old,replacement).replace(anchor,anchor+install);require(output.replace(anchor+install,anchor).replace(replacement,old)===source,'init replacement not reversible');return output;
}
export function bindingContract(binding) {
  require(binding?.kind==='caller-reviewed-full-nightly-jit-build-binding-v1'&&binding.pass===true,'actual final full-JIT binding unavailable');
  require(binding.target==='wasm32-linux-musl'&&binding.version==='159.0a1'&&binding.environmentSlotCount===23&&binding.broadCoverage===true&&binding.restartOnlyPref==='javascript.options.portable_baseline'&&/^\d{14}$/.test(binding.localBuildID),'fresh native broad159 identity missing');
  for(const key of ['finalBinarySHA256','archiveSHA256','runtimeManifestSHA256','kernelSHA256','buildReviewSHA256','observerPblSha256','observerInterpreterSha256','optionObserverWorkerSha256','optionObserverStartupSha256'])require(digest(binding[key]),'missing final build pin: '+key);
}
export function parentChecks(parent,session,raw) {
  const b=session.buildBinding, options=parent?.actualJitOptions, expected=Number(session.portableBaseline);
  require(parent?.kind==='actual-nightly-broad-parent-options-v1'&&parent.label===session.label&&parent.version==='159.0a1'&&parent.applicationBuildID===b.localBuildID&&parent.platformBuildID===b.localBuildID&&Number.isSafeInteger(parent.processID)&&parent.processID>0&&parent.processType===0,'actual parent identity differs');
  require(parent.startupPref===session.portableBaseline&&Object.hasOwn(options||{},'pbl.enable')&&options['pbl.enable']===expected&&options['pbl.warmup.threshold']===10&&parent.observerEnabled==='1'&&parent.logBudget==='0','actual parent options/environment differ');
  const matches=raw.toString('utf8').split('\n').filter(line=>line.startsWith('PBLJIT_OPTION event=startup ')).map(line=>Object.fromEntries(line.slice(14).split(/\s+/).map(field=>field.split('='))));
  require(matches.some(row=>row.pid===String(parent.processID)&&row.option===String(expected)&&row.pref===String(expected)&&row.available==='1'&&row.safemode==='0'&&row.threshold==='10'),'actual parent native startup option missing');return true;
}
export function completeCapture(previous,next) {
  require(Buffer.isBuffer(previous)&&Buffer.isBuffer(next)&&next.length<LIMIT,'direct raw log bound reached');
  require(next.length>=previous.length&&next.subarray(0,previous.length).equals(previous),'direct raw capture rotated/truncated/changed');
  return next;
}
export function completedSession(result,arm,label) {
  require(result?.kind==='actual-firefox-jit-gate-session'&&result.label===label&&result.portableBaseline===(arm==='enabled'),'actual session arm differs');
  require(result.status==='recorded','actual driver pending/failed; query timeout never proves cancellation');
  const scopes=arm==='enabled'?['gc-debug-coverage','incremental','slice-gc','interrupt']:[];
  require(JSON.stringify(result.operations?.map(row=>row.scope))===JSON.stringify(scopes)&&result.operations.every(row=>row.status==='recorded'),'mandatory real scopes missing/failed');return true;
}
export function exactFirefoxExit(launch,exit,stat,terminal,limits,parent) {
  const end=stat.lastIndexOf(')'),tail=stat.slice(end+2).trim().split(/\s+/),pid=Number(stat.slice(0,stat.indexOf(' ')));
  require(end>0&&tail.length>=20&&pid===launch.pid&&Number(tail[2])===pid&&Number(tail[3])===pid&&/^\d+$/.test(tail[19]),'actual exact Firefox PGID/session not established');
  require(launch.kind==='actual-owned-firefox-launch-v1'&&parent.processID===pid&&launch.observerEnabled==='1'&&launch.logBudget==='0','actual parent/owned process differs');
  require(exit?.kind==='actual-owned-firefox-exit-v1'&&exit.pid===pid&&exit.status===0&&exit.reaped===true&&exit.naturalGroupEmpty===true&&exit.forced===false&&terminal==='','actual guest terminal/reap/physical group emptiness missing');
  require(/^Max file size\s+unlimited\s+unlimited\s+bytes[ \t]*$/m.test(limits)&&/^Max core file size\s+0\s+0\s+bytes[ \t]*$/m.test(limits),'actual inherited guest normal file/core limits differ');return true;
}
