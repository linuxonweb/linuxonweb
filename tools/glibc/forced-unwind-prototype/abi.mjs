import fs from 'node:fs';
const task=process.argv[2],rows={};
for(const family of ['gnu','llvm'])for(const lang of ['c','cpp']){
 const bytes=fs.readFileSync(`${task}/objects/abi-${family}-${lang}.wasm`);
 const mod=new WebAssembly.Module(bytes);
 if(WebAssembly.Module.imports(mod).length)throw Error('unexpected ABI imports');
 const inst=new WebAssembly.Instance(mod);
 rows[`${family}-${lang}`]=Array.from({length:9},(_,n)=>inst.exports.abi(n));
}
if(JSON.stringify(rows['gnu-c'])!==JSON.stringify(rows['gnu-cpp'])||JSON.stringify(rows['llvm-c'])!==JSON.stringify(rows['llvm-cpp']))throw Error('C/C++ mismatch');
if(JSON.stringify(rows['gnu-c'])===JSON.stringify(rows['llvm-c']))throw Error('expected source layout distinction absent');
fs.writeFileSync(`${task}/logs/abi-measurements.json`,JSON.stringify({fields:['size','alignment','class-size','pointer-size','class-offset','cleanup-offset','private1-offset','private2-offset','stop-function-pointer-size'],rows,pass:true},null,2)+'\n');
console.log(JSON.stringify(rows));
