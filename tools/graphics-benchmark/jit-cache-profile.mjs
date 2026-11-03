// Synthetic retention stress, not a Firefox speed or native JIT acceptance test.
import fs from 'node:fs';import{pathToFileURL}from'node:url';
const[modulePath,output]=process.argv.slice(2);if(!modulePath||!output)throw Error('module path and output required');
const{JitThread,createJitControl}=await import(pathToFileURL(modulePath).href);
import {image} from './jit-images.mjs';
const memory=new WebAssembly.Memory({initial:1,maximum:4,shared:true}),table=new WebAssembly.Table({element:'anyfunc',initial:1,maximum:10000});
const thread=new JitThread(createJitControl(),memory,table);const snapshot=()=>{global.gc?.();return process.memoryUsage();};const before=snapshot(),start=performance.now();
for(let i=0;i<4096;i++)thread.compile(image(i,256));
const small=snapshot();for(let i=0;i<128;i++)thread.compile(image(10000+i,131000));
const after=snapshot();const entries=[...thread.cache.values()].flat();
const result={label:'synthetic compile-cache retention stress',seconds:(performance.now()-start)/1000,smallModules:4096,largeModules:128,retainedEntries:entries.length,retainedSourceBytes:entries.reduce((n,e)=>n+e.bytes.length,0),before,small,after,stats:thread.stats};
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
