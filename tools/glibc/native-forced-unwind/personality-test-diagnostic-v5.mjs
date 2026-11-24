import fs from 'node:fs';
const task=process.argv[2],mode=process.argv[3];
const memory=new WebAssembly.Memory({initial:32,maximum:256,shared:true});
const fatal={abort:0,abortMessage:0};let tp=0,e;const syscalls=[];
const fail=(kind)=>(...args)=>{fatal[kind]++;throw Error(`unexpected fatal ${kind} ${args}`);};
const module=new WebAssembly.Module(fs.readFileSync(`${task}/objects/personality-gate-4/${mode}.wasm`));
const imports=WebAssembly.Module.imports(module);const allowed=new Set(['env.memory','env.unexpected_abort','env.unexpected_abort_message','linux.syscall','linux.get_thread_area','linux.copy_siginfo']);
for(const i of imports)if(!allowed.has(`${i.module}.${i.name}`))throw Error(`unexpected import ${JSON.stringify(i)}`);
function syscall(n,a,b,c,d,f,g){
 syscalls.push(n);
 // Explicit synthetic host-fixture values; no real Linux guest acceptance.
 if(n===244){tp=a;return 0;}if(n===178)return 71;if(n===172)return 70;
 if(n===278){new Uint8Array(memory.buffer,a,b).fill(0x95);return b;}
 if(n===113||n===403){const v=new DataView(memory.buffer);v.setBigInt64(b,1n,true);v.setBigInt64(b+8,123000n,true);return 0;}
 if(n===56)return -2;if(n===167)return -22;
 throw Error(`unexpected host fixture syscall ${n} ${[a,b,c,d,f,g]}`);
}
e=new WebAssembly.Instance(module,{env:{memory,unexpected_abort:fail('abort'),unexpected_abort_message:fail('abortMessage')},linux:{syscall,get_thread_area:()=>tp,copy_siginfo(){throw Error('host signal not accepted');}}}).exports;
if(e.fixture_init(65536,0)!==0||tp!==e.fixture_thread_pointer())throw Error('real GNU fixture initialization failed');
const rows=[];
for(let repeat=0;repeat<8;repeat++)for(const [name,want,trace] of [['foreign_direct',1,[1,2,3,7]],['foreign_rethrow',2,[1,2,3,4,7]],['foreign_escape',1,[1,2,3]]]){
 const before=e.observe_stack();let result,error;
 try{result=e[name]();}catch(x){error=x;}
 const after=e.observe_stack(),actualTrace=Array.from({length:e.foreign_query(0)},(_,i)=>e.foreign_query(i+6));
 const identity=error instanceof WebAssembly.Exception&&error.is(e.__cpp_exception)&&error.getArg(e.__cpp_exception,0)===e.foreign_query(5);
 const negative=mode==='baseline';
 const pass=negative?before===after&&identity&&e.foreign_query(2)===0&&e.foreign_query(3)===0&&e.foreign_query(1)===0:
  (name==='foreign_escape'?identity:!error&&result===0)&&e.foreign_query(2)===want&&e.foreign_query(1)===0&&e.foreign_query(3)===(name==='foreign_escape'?0:1)&&e.foreign_query(4)===0&&JSON.stringify(actualTrace)===JSON.stringify(trace)&&before===after;
 rows.push({repeat,name,result,error:error?String(error):undefined,before,after,actualTrace,identity,typed:e.foreign_query(1),caught:e.foreign_query(2),cleaned:e.foreign_query(3),pass});
 if(error)e.foreign_delete();
 if(e.foreign_query(3)!==1||e.foreign_query(4)!==0){const diagnostic={mode,fatal,imports,syscalls,rows,afterDelete:{cleaned:e.foreign_query(3),bad:e.foreign_query(4)},pass:false};fs.writeFileSync(`${task}/logs/personality-v5-${mode}-failure.json`,JSON.stringify(diagnostic,null,2)+'\n');throw Error('foreign ownership cleanup failed');}
}
for(let repeat=0;repeat<16;repeat++){
 const value=37+repeat,before=e.observe_stack(),result=e.native_int_rethrow(value),after=e.observe_stack();
 const trace=Array.from({length:e.native_int_query(0)},(_,i)=>e.native_int_query(i+3));
 rows.push({repeat,nativeTyped:true,value,result,before,after,trace,identity:e.native_int_query(2),pass:result===0&&before===after&&e.native_int_query(1)===0&&e.native_int_query(2)===1&&JSON.stringify(trace)==='[1,2,3]'});
}
const report={mode,pass:rows.every(r=>r.pass)&&Object.values(fatal).every(n=>n===0)&&e.exception_size()===24&&e.exception_align()===8,fatal,imports,syscalls,syntheticHostFixture:true,rawGNUtp:tp,rows,nativeOrJSStackReset:false,scope:'Diagnostic foreign personality selector gate; no forced unwind, GNU terminate, default C++ closure or NPTL acceptance'};
fs.writeFileSync(`${task}/logs/personality-v4-${mode}-results.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({mode,pass:report.pass,cases:rows.length,fatal}));if(!report.pass)process.exit(1);
