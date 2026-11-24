// Host ABI check only. Actual cleanup/TLS/once acceptance runs inside Linux guests.
import fs from 'node:fs/promises';
const [file,out]=process.argv.slice(2),bytes=await fs.readFile(file);
const module=await WebAssembly.compile(bytes);
const imports=WebAssembly.Module.imports(module);
const namespaces={},stubbedFunctions=[];
for(const x of imports){
 const ns=namespaces[x.module]??={};
 if(x.kind==='function'){ns[x.name]=()=>0;stubbedFunctions.push(x.module+'.'+x.name);}
 else if(x.kind==='memory')ns[x.name]=new WebAssembly.Memory({initial:32,maximum:256,shared:true});
 else throw Error('unsupported host-only import '+x.kind);
}
const instance=await WebAssembly.instantiate(module,namespaces);
const tag=instance.exports.cleanup_test_tag;
if(!(tag instanceof WebAssembly.Tag))throw Error('tag export absent');
let pass=false;
try{instance.exports.cleanup_throw(731);}catch(e){pass=e instanceof WebAssembly.Exception&&e.is(tag)&&e.getArg(tag,0)===731;}
if(!pass)throw Error('tag identity/payload mismatch');
await fs.writeFile(out,JSON.stringify({pass:true,imports,stubbedFunctions,exportedTagIdentity:true,payload:731,scope:'host tag ABI only; imported functions stubbed and never called'},null,2)+'\n');
