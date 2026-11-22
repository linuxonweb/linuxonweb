import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {rootForOutput,scopedPath} from '../../owned-paths.mjs';
import { cases as integerCases, source } from './cases.mjs';
import { broadCases } from './cases-broad.mjs';
const [out,label,coverage='integer']=process.argv.slice(2);
if(!['integer','broad'].includes(coverage))throw Error('coverage must be integer or broad');
const cases=coverage==='broad'?broadCases:integerCases;
if(!out||!label||!/^[a-zA-Z0-9_-]{1,64}$/.test(label))throw Error('usage: generate.mjs DISK_TASK_FRESH_DIR RUN_LABEL [integer|broad]');
await scopedPath(await rootForOutput(out),out,{fresh:true});
await fs.mkdir(out,{recursive:false,mode:0o700});
const files={};
async function write(name,text){await fs.writeFile(path.join(out,name),text);files[name]=crypto.createHash('sha256').update(text).digest('hex');}
const expectedUrl=`file:///home/admin/nightly-jit-safety/${label}/`;
const declarations=[];
for(const context of ['main','worker'])for(const c of cases){const name=`${label}-${context}-${c.id}.js`;await write(name,source(c));declarations.push({...c,context,name,url:expectedUrl+name,line:1});}
for(const id of ['debugFresh','coverage','infinite'])await write(`${label}-main-${id}.js`,source({id,body:id==='infinite'?'var i=0;while(true)i=(i+1)|0;':'var i=0,s=0;for(i=0;i<4096;i++)s=s+i;return s;'}));
const harness=`const cases=${JSON.stringify(cases)}, label=${JSON.stringify(label)};
function emit(o){console.log('NJS '+JSON.stringify({label,context:globalThis.document?'main':'worker',...o}));if(!globalThis.document)postMessage(o);}
function encoded(v){return Object.is(v,-0)?'-0':Number.isNaN(v)?'NaN':v;}
async function runCases(){for(const c of cases){emit({event:'case-start',id:c.id,claim:c.claim});for(var r=0;r<16;r++){var got,threw=false;try{got=globalThis['njs_'+c.id](...(c.args||[]));}catch(e){got=e;threw=true;}if(threw!==!!c.throws||!Object.is(encoded(got),c.expected))throw Error(c.id+' wrong result '+String(got));}emit({event:'case-done',id:c.id,claim:c.claim,result:c.expected,repetitions:16});await new Promise(resolve=>setTimeout(resolve,0));}emit({event:'done',ok:true});}
`;
// Only the main harness receives the actor's captured read-only GC callback.
// The original Worker harness and all named function files remain unchanged.
const mainHarness=harness.replace("emit({event:'case-start',id:c.id,claim:c.claim});for(var r=0;",
  "emit({event:'case-start',id:c.id,claim:c.claim});let gcState;do{gcState=readiness();if(gcState!=='NotActive')await new Promise(resolve=>setTimeout(resolve,200));}while(gcState!=='NotActive');for(var r=0;")
  .replace('async function runCases()', 'async function runCases(readiness)')
  .replace('result:c.expected,repetitions:16', 'result:c.expected,repetitions:16,gcReadyState:gcState');
await write(`${label}-worker.js`,cases.map(c=>`importScripts(${JSON.stringify(`${expectedUrl}${label}-worker-${c.id}.js`)});`).join('\n')+'\n'+harness+"runCases().catch(e=>emit({event:'error',error:String(e)}));\n");
await write(`${label}.html`,`<!doctype html><meta charset="utf-8"><title>Nightly ${coverage} JIT safety</title><pre id="out">Pending real guest evidence</pre>\n`+[...cases.map(c=>c.id),'debugFresh','coverage','infinite'].map(id=>`<script src="${label}-main-${id}.js"></script>`).join('\n')+`\n<script>${mainHarness}
globalThis.nightlySafetyLabel=label;
let started=false;
globalThis.nightlySafetyStart=readiness=>{if(started||typeof readiness!=='function')throw Error('one actual readiness callback required');started=true;globalThis.nightlySafetyStarted=true;return runCases(readiness).then(()=>{globalThis.nightlySafetyMainDone=true;const workerURL=URL.createObjectURL(new Blob([${JSON.stringify('importScripts('+JSON.stringify(`${expectedUrl}${label}-worker.js`)+');')}],{type:'text/javascript'}));const w=new Worker(workerURL);globalThis.nightlySafetyWorker=w;w.onmessage=e=>{URL.revokeObjectURL(workerURL);document.querySelector('#out').textContent+=JSON.stringify(e.data)+'\\n';if(e.data.event==='done'&&e.data.ok===true)globalThis.nightlySafetyWorkerDone=true;if(e.data.event==='error')globalThis.nightlySafetyError=e.data.error;};w.onerror=e=>{URL.revokeObjectURL(workerURL);globalThis.nightlySafetyError=e.message;emit({event:'error',error:e.message});};}).catch(e=>{globalThis.nightlySafetyError=String(e);emit({event:'error',error:String(e)});});};</script>\n`);
await write('contract.json',JSON.stringify({schema:1,coverage,label,expectedUrl,cases:declarations,files,limitations:['Generated contract is expected behavior, never actual execution evidence.','Main and Worker are actual browser contexts only after guest execution.','Full safety requires verified privileged driver and observer, CPU/identity/build gates, native TLS/stack probes and incremental GC.']},null,2)+'\n');
console.log(JSON.stringify({kind:'preparation',out,label,files:Object.keys(files).length}));
