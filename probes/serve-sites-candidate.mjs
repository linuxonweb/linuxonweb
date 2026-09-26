// Local test service only; uses the existing locked workerd dependency.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const { Miniflare, convertV4MiniflareOptions } = createRequire(new URL('../web/cloudflare/package.json',import.meta.url))('miniflare');
const port=Number(process.argv[2]||4181);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid local port');
const graph=JSON.parse(await readFile(new URL('../web/sites/dist/worker-graph-build.json',import.meta.url)));
const runtime=new Miniflare(convertV4MiniflareOptions({
  name:'sites-candidate-local',host:'127.0.0.1',port,compatibilityDate:'2026-09-26',
  modules:[{type:'ESModule',path:fileURLToPath(new URL('../web/sites/dist/server/index.js',import.meta.url))}],
  assets:{directory:fileURLToPath(new URL('../web/sites/dist/client',import.meta.url)),binding:'ASSETS',run_worker_first:true,
    routerConfig:{has_user_worker:true},assetConfig:{html_handling:'none',not_found_handling:'none'}},
}));
const url=await runtime.ready;
console.log(JSON.stringify({url:String(url),graphSHA256:graph.graphSHA256,localOnly:true}));
let closing=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{
  if(closing)return;closing=true;await runtime.dispose();process.exit(0);
});
