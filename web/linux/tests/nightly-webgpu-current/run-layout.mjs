import fs from 'node:fs/promises';
const task='/mnt/p6/project/build/nightly-webgpu-current-abi-20261003',expected=JSON.parse(await fs.readFile(task+'/layout-result.json'));
const rows=[];for(const name of ['layout','layout-fpcast']){
 const {instance}=await WebAssembly.instantiate(await fs.readFile(task+'/'+name+'.wasm'));const e=instance.exports;
 const layout=Array.from(new Uint32Array(e.memory.buffer,e.get_layout(),e.get_layout_count()));
 const map=Array.from(new Uint8Array(e.memory.buffer,e.get_map_golden(),48));
 if(JSON.stringify(layout)!==JSON.stringify(expected.layout)||JSON.stringify(map)!==JSON.stringify(expected.map))throw Error('native layout/golden mismatch');
 const callbacks=[0,9,1031].map(input=>({input,actual:e.invoke_map_callback(input),expected:input+11}));if(callbacks.some(c=>c.actual!==c.expected))throw Error('real callback mismatch');rows.push({name,callbacks});
}
if(JSON.stringify(rows)!==JSON.stringify(expected.rows))throw Error('recorded callback mismatch');const result={pass:true,checks:10,rows};await fs.writeFile(task+'/layout-reverified.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
