#!/usr/bin/env node
// Reproducible content-addressed browser modules; original source URL semantics preserved.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build,version} from '../../web/cloudflare/node_modules/esbuild/lib/main.js';
const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const output=path.join(root,'web/linux/dist/immutable');
await fs.mkdir(output,{recursive:true});
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const plugin={name:'pin-original-module-urls',setup(b){
 b.onResolve({filter:/^\/linux\//},args=>({path:path.join(root,'web',args.path)}));
 b.onLoad({filter:/\.(?:mjs|js)$/},async args=>{
  if(!args.path.startsWith(path.join(root,'web/linux')+path.sep))return;
  const source=await fs.readFile(args.path,'utf8');
  const original='/'+path.relative(path.join(root,'web'),args.path).split(path.sep).join('/');
  const inherited=source.replace(/globalThis\.location\??\.href/g,match=>`(globalThis.__linuxonwebExecutionURL ?? ${match})`);
  return {contents:inherited.replaceAll('import.meta.url',`new URL(${JSON.stringify(original)}, (globalThis.__linuxonwebExecutionURL ?? globalThis.location.href)).href`),loader:'js',resolveDir:path.dirname(args.path)};
 });
}};
async function bundle(entry,label,workerURL){
 const result=await build({absWorkingDir:root,entryPoints:[entry],bundle:true,platform:'browser',format:'esm',target:'es2022',write:false,metafile:true,minify:false,sourcemap:false,legalComments:'inline',plugins:[plugin],define:workerURL?{__LINUXONWEB_WORKER_URL__:JSON.stringify(workerURL)}:{}});
 if(result.outputFiles.length!==1)throw Error('Expected one self-contained module');
 for(const out of Object.values(result.metafile.outputs))if(out.imports.length)throw Error('External module dependency would defeat immutable bundling');
 const bytes=result.outputFiles[0].contents;
 if(/\bimport\s*\(/.test(new TextDecoder().decode(bytes)))throw Error('Nonliteral dynamic import is not allowed in a self-contained bundle');
 const digest=sha(bytes),name=label+'-'+digest+'.mjs';
 await fs.writeFile(path.join(output,name),bytes,{flag:'wx'}).catch(async e=>{if(e.code!=='EEXIST'||sha(await fs.readFile(path.join(output,name)))!==digest)throw e;});
 const sources=[];for(const relative of Object.keys(result.metafile.inputs)){const bytes=await fs.readFile(path.join(root,relative));sources.push({path:relative,bytes:bytes.length,sha256:sha(bytes)});}
 sources.sort((a,b)=>a.path.localeCompare(b.path));
 return {url:'/linux/dist/immutable/'+name,bytes:bytes.length,sha256:digest,sources};
}
const worker=await bundle('web/linux/dist/worker.js','worker');
const consoleEntry=await bundle('web/linux/packages/v1/package-shell.mjs','console',worker.url);
const receipt={schema:1,created:new Date().toISOString(),builder:'GPT-6 Astra Pro / built-in graphics_jit / rubywebterm',esbuild:version,originalModuleUrlsPreserved:true,externalImports:0,worker,console:consoleEntry};
await fs.writeFile(path.join(root,'web/linux/packages/v1/runtime-bundles.json'),JSON.stringify(receipt,null,2)+'\n');
const html=path.join(root,'web/linux/packages/v1/package-shell.html');let text=await fs.readFile(html,'utf8');
const re=/<script type="module" src="(?:\.\/package-shell\.mjs|\/linux\/dist\/immutable\/console-[a-f0-9]{64}\.mjs)"\s*><\/script>/;
if(!re.test(text))throw Error('Expected one console module script tag');
text=text.replace(re,`<script type="module" src="${consoleEntry.url}"></script>`);await fs.writeFile(html,text);
console.log(JSON.stringify({worker:{url:worker.url,bytes:worker.bytes,sha256:worker.sha256,sourceCount:worker.sources.length},console:{url:consoleEntry.url,bytes:consoleEntry.bytes,sha256:consoleEntry.sha256,sourceCount:consoleEntry.sources.length},esbuild:version}));
