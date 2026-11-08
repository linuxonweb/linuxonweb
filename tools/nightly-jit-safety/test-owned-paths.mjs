// Filesystem and hash-fault checks only. No browser, guest or native acceptance.
import fs from 'node:fs/promises';
import path from 'node:path';
import {ownedDirectory,ownedTaskRoot,scopedPath,rootForOutput,BUILD_PARENTS} from './owned-paths.mjs';
import {sha,loadFrameObserver} from './guest-runner/contracts.mjs';
const root=await ownedTaskRoot(process.argv[2]),dir=root+'/js-path-tests';
await scopedPath(root,dir,{fresh:true});await fs.mkdir(dir,{mode:0o700});
const checks=[];
async function good(name,fn){await fn();checks.push(name);}
async function bad(name,fn){let threw=false;try{await fn();}catch{threw=true;}if(!threw)throw Error('unexpected acceptance: '+name);checks.push(name);}
await good('explicit owned root',()=>ownedTaskRoot(root));
await good('fresh contained output',()=>scopedPath(root,dir+'/fresh',{fresh:true}));
await good('root inference',async()=>{if(await rootForOutput(dir+'/fresh')!==root)throw Error('wrong root');});
await bad('build parent is not a task',()=>ownedTaskRoot(path.dirname(root)));
await bad('nested task root refused',()=>ownedTaskRoot(dir));
await bad('root itself is not output',()=>scopedPath(root,root,{fresh:true}));
await bad('relative root refused',()=>ownedTaskRoot(path.relative(process.cwd(),root)));
await bad('unknown root parent refused',()=>ownedTaskRoot('/usr/example'));
await bad('foreign actual UID directory refused',()=>ownedDirectory('/usr'));
await bad('sibling prefix refused',()=>scopedPath(root,root+'-other/fresh',{fresh:true}));
await bad('dotdot spelling refused',()=>scopedPath(root,dir+'/../fresh',{fresh:true}));
await bad('missing output parent refused',()=>scopedPath(root,dir+'/absent/fresh',{fresh:true}));
await bad('existing directory refused',()=>scopedPath(root,dir,{fresh:true}));
await fs.writeFile(dir+'/file','retained');
await bad('existing file refused',()=>scopedPath(root,dir+'/file',{fresh:true}));
await fs.symlink('/usr',dir+'/escape');
await bad('symlink ancestor refused',()=>scopedPath(root,dir+'/escape/fresh',{fresh:true}));
await fs.symlink(dir+'/absent',dir+'/dangling');
await bad('dangling output symlink refused',()=>scopedPath(root,dir+'/dangling',{fresh:true}));
await fs.symlink(dir,dir+'/alias');
await bad('same-root symlink alias refused',()=>scopedPath(root,dir+'/alias/fresh',{fresh:true}));
await fs.mkdir(dir+'/writable',{mode:0o700});await fs.chmod(dir+'/writable',0o777);
await bad('group/world writable ancestor refused',()=>scopedPath(root,dir+'/writable/fresh',{fresh:true}));
await fs.chmod(dir+'/writable',0o700);
await bad('filesystem device mismatch refused',async()=>ownedDirectory(dir,(root.length+(await fs.stat(dir)).dev)));
const savedStatfs=fs.statfs;
try{fs.statfs=async()=>({type:0x01021994});await bad('tmpfs refused',()=>ownedDirectory(dir));fs.statfs=async()=>({type:0x858458f6});await bad('ramfs refused',()=>ownedDirectory(dir));}finally{fs.statfs=savedStatfs;}
const observer=dir+'/observer.mjs',body='export function createStallFrameDiagnostics(){return {hostTest:true};}';
await fs.writeFile(observer,body);
await good('exact pinned observer loads',async()=>{const fn=await loadFrameObserver({path:observer,sha256:sha(body)});if(!fn().hostTest)throw Error('wrong export');});
await bad('unreviewed observer hash drift refused',()=>loadFrameObserver({path:observer,sha256:'0'.repeat(64)}));
await fs.writeFile(dir+'/bad-export.mjs','export const unrelated=true;');
await bad('observer required export checked',()=>loadFrameObserver({path:dir+'/bad-export.mjs',sha256:sha('export const unrelated=true;')}));
await fs.symlink(observer,dir+'/observer-alias.mjs');
await bad('observer canonical path required',()=>loadFrameObserver({path:dir+'/observer-alias.mjs',sha256:sha(body)}));
if(BUILD_PARENTS.join('|')!=='/mnt/p6/project/build|/mnt/p6/build|/mnt/p3/codex-build')throw Error('parent compatibility changed');
checks.push('legacy parents retained');
const report={kind:'owned-route-js-host-checks-v1',pass:true,count:checks.length,checks,browserStarted:false,guestAcceptance:false};
await fs.writeFile(dir+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
