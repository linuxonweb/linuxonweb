/** Owned disk paths shared by preparation and reviewed launch. No acceptance. */
import fs from 'node:fs/promises';
import path from 'node:path';
export const BUILD_PARENTS=Object.freeze(['/mnt/p6/project/build','/mnt/p6/build','/mnt/p3/codex-build']);
const memoryFilesystems=new Set([0x01021994,0x858458f6]);
function need(ok,message){if(!ok)throw Error(message);}
export async function ownedDirectory(value,device) {
  need(typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===value,'canonical absolute owned directory required');
  need(await fs.realpath(value)===value,'canonical absolute owned directory required');
  const before=await fs.lstat(value);
  need(before.isDirectory()&&before.uid===process.getuid()&&(before.mode&0o022)===0,'directory must be owned by actual UID and not group/world writable');
  need(device===undefined||before.dev===device,'owned path must stay on task filesystem');
  need(!memoryFilesystems.has((await fs.statfs(value)).type),'disk-backed directory required');
  const after=await fs.lstat(value);
  need(await fs.realpath(value)===value&&['dev','ino','uid','mode'].every(k=>before[k]===after[k]),'owned directory identity changed during validation');
  return value;
}
export async function ownedTaskRoot(value) {
  need(typeof value==='string'&&BUILD_PARENTS.includes(path.dirname(value))&&!!path.basename(value),'task root must be a direct child of an approved disk build parent');
  const parent=await ownedDirectory(path.dirname(value));
  return ownedDirectory(value,(await fs.stat(parent)).dev);
}
export async function scopedPath(root,value,{fresh=false,directory=false}={}) {
  root=await ownedTaskRoot(root);
  need(typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===value&&value.startsWith(root+'/'),'canonical contained task path required');
  const device=(await fs.stat(root)).dev;
  for(let parent=path.dirname(value);parent!==root;parent=path.dirname(parent))await ownedDirectory(parent,device);
  const existing=await fs.lstat(value).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  need(!fresh||existing===null,'fresh task output must not already exist, including symlinks');
  if(directory)await ownedDirectory(value,device);
  else if(existing)need(!existing.isSymbolicLink()&&existing.uid===process.getuid()&&existing.dev===device&&await fs.realpath(value)===value,'existing task path identity/ownership mismatch');
  return value;
}
export async function rootForOutput(value) {
  need(typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===value,'canonical output required');
  for(const parent of BUILD_PARENTS)if(value.startsWith(parent+'/')){
    const parts=value.slice(parent.length+1).split('/');
    if(parts.length>=2)return ownedTaskRoot(parent+'/'+parts[0]);
  }
  throw Error('output must be inside an owned disk task root');
}
