#!/usr/bin/env node
// Reproducible content-addressed browser modules; original source URL semantics preserved.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build,version} from '../../web/cloudflare/node_modules/esbuild/lib/main.js';
const root=path.resolve(fileURLToPath(new URL('../..',import.meta.url)));
const options={};for(let i=2;i<process.argv.length;i+=2){const name=process.argv[i],value=process.argv[i+1];if(!['--out','--public-prefix','--console-image'].includes(name)||!value||options[name])throw Error('Expected --out DIR --public-prefix /linux/packages/v1/candidates/NAME/ --console-image DIR');options[name]=value;}
const candidate=Object.keys(options).length>0;if(candidate&&Object.keys(options).length!==3)throw Error('All candidate options are required');
const prefix=candidate?options['--public-prefix']:'/linux/dist/';if(candidate&&!/^\/linux\/packages\/v1\/candidates\/[A-Za-z0-9-]+\/$/.test(prefix))throw Error('Invalid public candidate prefix');
const destination=candidate?path.resolve(options['--out']):path.join(root,'web/linux/packages/v1');
if(candidate)await fs.mkdir(destination,{recursive:false});
const output=candidate?path.join(destination,'immutable'):path.join(root,'web/linux/dist/immutable');
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
 return {url:(candidate?prefix+'immutable/':'/linux/dist/immutable/')+name,bytes:bytes.length,sha256:digest,sources};
}
const worker=await bundle('web/linux/dist/worker.js','worker');
const consoleEntry=await bundle('web/linux/packages/v1/package-shell.mjs','console',worker.url);
const receipt={schema:1,created:new Date().toISOString(),builder:'GPT-6 Astra Pro / built-in graphics_jit / rubywebterm',esbuild:version,originalModuleUrlsPreserved:true,externalImports:0,worker,console:consoleEntry};
receipt.candidateOnly=candidate;if(candidate){const imageRoot=path.resolve(options['--console-image']);const imageManifest=JSON.parse(await fs.readFile(path.join(imageRoot,'console-manifest.json'),'utf8'));const image=await fs.readFile(path.join(imageRoot,'package-console.cpio.gz'));if(imageManifest.guestMemoryBytes!==536870912||!imageManifest.nativeHelperSha256||sha(image)!==imageManifest.image.sha256||image.length!==imageManifest.image.bytes)throw Error('Verified small native persistence console required');await fs.writeFile(path.join(destination,'package-console.cpio.gz'),image,{flag:'wx'});await fs.writeFile(path.join(destination,'console-manifest.json'),JSON.stringify(imageManifest,null,2)+'\n',{flag:'wx'});receipt.consoleImage={sha256:imageManifest.image.sha256,bytes:image.length,nativeHelperSha256:imageManifest.nativeHelperSha256};receipt.publicPrefix=prefix;}
await fs.writeFile(path.join(destination,'runtime-bundles.json'),JSON.stringify(receipt,null,2)+'\n');
const html=path.join(root,'web/linux/packages/v1/package-shell.html');let text=await fs.readFile(html,'utf8');
const re=/<script type="module" src="(?:\.\/package-shell\.mjs|\/linux\/dist\/immutable\/console-[a-f0-9]{64}\.mjs)"\s*><\/script>/;
if(!re.test(text))throw Error('Expected one console module script tag');
text=text.replace(re,`<script type="module" src="${consoleEntry.url}"></script>`);if(candidate){const oldNotice='Files under <code>/home</code> persist. Installed apps and the package database reset together when you restart.';if(!text.includes(oldNotice))throw Error('Console notice changed; review persistence copy');text=text.replace(oldNotice,'Files under <code>/home</code> persist. Use <code>apk-persist add</code>, <code>del</code> or <code>save</code> to keep signed packages across restart. Ordinary <code>apk</code> changes alone are session-only.');text=text.replace('<code>apk add python3</code>','<code>apk-persist add python3</code>').replace('<code>apk del python3</code>','<code>apk-persist del python3</code>');text=text.replace('Install &amp; check Python','Install, save &amp; check Python');}
await fs.writeFile(candidate?path.join(destination,'package-shell.html'):html,text);
console.log(JSON.stringify({worker:{url:worker.url,bytes:worker.bytes,sha256:worker.sha256,sourceCount:worker.sources.length},console:{url:consoleEntry.url,bytes:consoleEntry.bytes,sha256:consoleEntry.sha256,sourceCount:consoleEntry.sources.length},esbuild:version}));
