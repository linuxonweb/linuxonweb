import fs from 'node:fs';
const task=process.argv[2],m=new WebAssembly.Module(fs.readFileSync(`${task}/objects/routes.wasm`));
if(WebAssembly.Module.imports(m).length)throw Error('route imports');
const e=new WebAssembly.Instance(m).exports;
const tls=Math.ceil(e.__heap_base.value/e.__tls_align.value)*e.__tls_align.value;e.__tls_base.value=tls;e.__wasm_init_tls(tls);
const rows=[];
for(let i=0;i<16;i++)for(const mode of [0,1]){
 const before=e.route_stack();let result;
 try{result=e.route_invoke(mode);}catch(error){
  rows.push({i,mode,before,after:e.route_stack(),pass:false,escapedException:String(error)});
  fs.writeFileSync(`${task}/logs/routes-results.json`,JSON.stringify({pass:false,cases:rows.length,rows},null,2)+'\n');throw error;
 }
 const after=e.route_stack();
 const sequence=Array.from({length:e.route_invoke(2)},(_,j)=>e.route_invoke(3+j));
 const modules=Array.from({length:e.route_invoke(2)},(_,j)=>e.route_invoke(16+j));
 const pass=result===(mode?37:731)&&before===after&&JSON.stringify(sequence)===JSON.stringify(mode?[9]:[1,2])&&JSON.stringify(modules)===JSON.stringify(mode?[0]:[1,2]);
 rows.push({i,mode,before,after,result,sequence,modules,pass});
 fs.writeFileSync(`${task}/logs/routes-progress.json`,JSON.stringify(rows,null,2)+'\n');
}
const report={pass:rows.every(r=>r.pass),cases:rows.length,rows,scope:'Finite caller descriptors through native C cleanup tag0 and actual GNU-architecture24-byte backend SjLj tag1; real explicit native assembly entry restores its saved SP; no per-frame forced-unwind/CFA, public GNU jump or C++/NPTL acceptance'};
fs.writeFileSync(`${task}/logs/routes-results.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:report.pass,cases:rows.length}));if(!report.pass)process.exit(1);
