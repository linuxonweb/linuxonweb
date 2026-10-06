// Produce the exact init member proposal; no archive rewrite or native mutation.
import fs from 'node:fs/promises';
import path from 'node:path';
import { taskRoot,sha,pinFile,patchInit,require } from './contracts.mjs';
const [rootArg,source,hash,out]=process.argv.slice(2);const TASK=await taskRoot({'--task-root':rootArg});
require(process.argv.length===6&&path.resolve(out).startsWith(TASK+'/')&&await fs.realpath(path.dirname(out))===path.dirname(out),'usage: TASK_ROOT SOURCE_INIT SHA TASK/FRESH_INIT_OUTPUT');
await pinFile({path:source,sha256:hash});const before=await fs.readFile(source,'utf8'),after=patchInit(before);
await fs.writeFile(out,after,{flag:'wx'});
console.log(JSON.stringify({kind:'broad-capture-init-member-proposal-v1',pass:false,preparationComplete:true,source:{path:source,sha256:hash},candidate:{path:out,sha256:sha(after)},archiveAdoptionPending:true,nativeBinaryMutation:false}));
