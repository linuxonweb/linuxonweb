import fs from 'node:fs';
const task=process.argv[2],mode=process.argv[3];
const memory=new WebAssembly.Memory({initial:32,maximum:256,shared:true});
const fatal={abort:0,terminate:0,handler:0};
const fail=(kind)=>(...args)=>{fatal[kind]++;throw Error(`unexpected fatal ${kind} ${args}`);};
const module=new WebAssembly.Module(fs.readFileSync(`${task}/objects/personality-gate-1/${mode}.wasm`));
const imports=WebAssembly.Module.imports(module);const allowed=new Set(['env.memory','env.unexpected_abort','env.unexpected_terminate','env.unexpected_terminate_with_handler']);
for(const i of imports)if(!allowed.has(`${i.module}.${i.name}`))throw Error(`unexpected import ${JSON.stringify(i)}`);
const e=new WebAssembly.Instance(module,{env:{memory,unexpected_abort:fail('abort'),unexpected_terminate:fail('terminate'),unexpected_terminate_with_handler:fail('handler')}}).exports;
const tls=Math.ceil(e.__heap_base.value/e.__tls_align.value)*e.__tls_align.value;
e.__tls_base.value=tls;e.__wasm_init_tls(tls);
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
 if(e.foreign_query(3)!==1||e.foreign_query(4)!==0)throw Error('foreign ownership cleanup failed');
}
const report={mode,pass:rows.every(r=>r.pass)&&Object.values(fatal).every(n=>n===0)&&e.exception_size()===24&&e.exception_align()===8,fatal,imports,rows,nativeOrJSStackReset:false,scope:'Diagnostic foreign personality selector gate; no forced unwind, GNU terminate, default C++ closure or NPTL acceptance'};
fs.writeFileSync(`${task}/logs/personality-${mode}-results.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({mode,pass:report.pass,cases:rows.length,fatal}));if(!report.pass)process.exit(1);
