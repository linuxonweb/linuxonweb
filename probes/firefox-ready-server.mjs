// Task-only adapter: preserve the real dev server and change two image routes.
// node probes/firefox-ready-server.mjs TASK_DIRECTORY CANDIDATE_DIRECTORY
import { readFile, writeFile, mkdir, realpath, statfs } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const [taskArg,candidateArg]=process.argv.slice(2);
if(!taskArg||!candidateArg)throw Error('Task and candidate directories required');
const root=await realpath(fileURLToPath(new URL('..',import.meta.url)));
const task=await realpath(resolve(taskArg)),candidate=await realpath(resolve(candidateArg));
const scratch=await realpath(process.env.TMPDIR||'/tmp');
for(const path of [task,candidate,scratch]){
  const fs=await statfs(path);
  if(['/tmp','/dev/shm'].some(prefix=>path===prefix||path.startsWith(prefix+'/'))||[0x01021994,0x858458f6].includes(Number(fs.type)))throw Error('Disk-backed task/candidate/TMPDIR required: '+path);
}
const directory=join(task,'server');await mkdir(directory,{recursive:true});
const selector=join(directory,'variant');
const variant=(await readFile(selector,'utf8')).trim();
if(!['baseline','candidate'].includes(variant))throw Error('Write baseline or candidate to '+selector+' before starting');
let source=await readFile(join(root,'web/desktop/dev-server.mjs'),'utf8');
const originalSHA256=createHash('sha256').update(source).digest('hex');
function replaceOnce(before,after){if(source.split(before).length!==2)throw Error('Dev-server anchor changed: '+before);source=source.replace(before,after);}
replaceOnce("import { stat } from 'node:fs/promises';","import { stat, readFile } from 'node:fs/promises';");
replaceOnce("const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));",`const root = ${JSON.stringify(root)};`);
replaceOnce("  const target = safePath(request.url || '/');",`  let target = safePath(request.url || '/');
  if (requestPath === '/linux/boot-manifest.json' || requestPath === '/linux/initramfs-firefox.cpio.gz') {
    try {
      const variant = (await readFile(${JSON.stringify(selector)}, 'utf8')).trim();
      if (!['baseline', 'candidate'].includes(variant)) throw new Error('Invalid variant');
      if (variant === 'candidate') target = join(${JSON.stringify(candidate)}, requestPath.split('/').at(-1));
      response.setHeader('X-Firefox-Ready-Variant', variant);
    } catch { response.writeHead(503); response.end('Invalid task variant'); return; }
  }`);
const generated=join(directory,'dev-server.generated.mjs');
await writeFile(generated,source);
await writeFile(join(directory,'adapter.json'),JSON.stringify({schema:1,root,candidate,selector,originalSHA256,generatedSHA256:createHash('sha256').update(source).digest('hex'),routes:['/linux/boot-manifest.json','/linux/initramfs-firefox.cpio.gz'],generatedAt:new Date().toISOString()},null,2)+'\n');
await import(pathToFileURL(generated).href);
