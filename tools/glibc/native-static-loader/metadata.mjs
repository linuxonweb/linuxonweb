import fs from 'node:fs';
const task=process.argv[2],m=new WebAssembly.Module(fs.readFileSync(`${task}/objects/metadata.wasm`));
if(WebAssembly.Module.imports(m).length)throw Error('metadata gate must have no imports');
const e=new WebAssembly.Instance(m).exports;
const tls=Math.ceil(e.__heap_base.value/e.__tls_align.value)*e.__tls_align.value;
e.__tls_base.value=tls;e.__wasm_init_tls(tls);
const caller=[];
for(const [mode,expected] of [[0,0],[1,1],[2,2],[3,0],[4,2],[5,11]]){
 const actual=e.caller_entry(mode);if(actual!==expected)throw Error(`caller mismatch ${mode}`);caller.push({mode,expected,actual});
}
const failures=e.metadata_entry(),checks=e.metadata_checks();
if(failures)throw Error(`metadata failures ${failures}`);
const report={pass:true,checks,failures,caller,scope:'Finite native metadata/descriptor/function-pointer/read-only-area primitives with genuine GNU strcmp/memset; public open/lookup/error/locking bodies not executed',publicGNUDlfcnRuntime:false};
fs.writeFileSync(`${task}/logs/metadata-results.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:true,checks,failures}));
