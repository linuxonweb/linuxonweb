import fs from 'node:fs';
const task=process.argv[2],mode=process.argv[3];
const m=new WebAssembly.Module(fs.readFileSync(`${task}/objects/routes-${mode}.wasm`));
if(WebAssembly.Module.imports(m).length)throw Error('unexpected route imports');
const e=new WebAssembly.Instance(m).exports;
const tls=Math.ceil(e.__heap_base.value/e.__tls_align.value)*e.__tls_align.value;
e.__tls_base.value=tls;e.__wasm_init_tls(tls);
const rows=[];
for(let i=0;i<16;i++)for(const jump of [0,1]){
 const before=e.route_stack();let result,escaped;
 try{result=e.route_invoke(jump);}catch(error){escaped=String(error);}
 const after=e.route_stack();
 const used=e.route_invoke(2);
 const sequence=Array.from({length:used},(_,j)=>e.route_invoke(3+j));
 const modules=Array.from({length:used},(_,j)=>e.route_invoke(16+j));
 const pass=!escaped&&result===(jump?37:731)&&before===after&&JSON.stringify(sequence)===JSON.stringify(jump?[9]:[1,2])&&JSON.stringify(modules)===JSON.stringify(jump?[0]:[1,2]);
 rows.push({i,jump,before,after,result,escaped,sequence,modules,pass});
}
const report={mode,pass:rows.every(r=>r.pass),cases:rows.length,rows,nativeOrJSStackReset:false,scope:'Actual predecessor compiler IR and24-byte GNU architecture SjLj buffer; backend routing controls only, not public GNU longjmp/cancellation/forced unwind'};
fs.writeFileSync(`${task}/logs/routes-${mode}-results.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({mode,pass:report.pass,cases:rows.length}));
if(!report.pass)process.exit(1);
