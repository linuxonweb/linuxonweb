import fs from 'node:fs';
const t=process.argv[2];const m=new WebAssembly.Module(fs.readFileSync(`${t}/objects/cxxabi-layout.wasm`));
if(WebAssembly.Module.imports(m).length)throw Error('imports');
const e=new WebAssembly.Instance(m).exports;
const actual=Array.from({length:8},(_,i)=>e.cxxabi_layout(i));
const expected=[24,8,72,8,48,72,48,8];
if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(JSON.stringify(actual));
fs.writeFileSync(`${t}/logs/cxxabi-layout-results.json`,JSON.stringify({pass:true,actual,fields:['GNU unwind bytes','GNU unwind align','cxa_exception bytes','cxa_exception align','unwindHeader offset','dependent bytes','dependent unwindHeader offset','EH globals bytes']},null,2)+'\n');
console.log(JSON.stringify({pass:true,actual}));
