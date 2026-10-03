// Serialize only with the retained exact current Rust codec. No GPU calls here.
import fs from 'node:fs/promises';
import init,{buffer_fixture,protocol_version,stale_scope_fixture} from '/mnt/p6/project/build/nightly-webgpu-current-abi-20261003/candidate/nightly_webgpu_current.js';
const out='/mnt/p6/project/build/nightly-current-native-gpu-transport-20261003';
await init({module_or_path:await fs.readFile('/mnt/p6/project/build/nightly-webgpu-current-abi-20261003/candidate/nightly_webgpu_current_bg.wasm')});
for(const [name,compute,gl] of [['copy',false,false],['compute',true,false],['copy-gl',false,true]]){
 const bytes=buffer_fixture(compute,gl),map=bytes.slice(-77,-29),unmap=bytes.slice(-29);
 if(map.length!==48||new DataView(map.buffer,map.byteOffset).getUint32(0,true)!==9||new DataView(unmap.buffer,unmap.byteOffset).getUint32(0,true)!==10)throw Error('current suffix mismatch');
 await fs.writeFile(out+'/'+name+'.bin',bytes.slice(0,-77));
 await fs.writeFile(out+'/'+name+'-full.bin',bytes);
}
await fs.writeFile(out+'/stale.bin',stale_scope_fixture());await fs.writeFile(out+'/protocol.txt',protocol_version());
