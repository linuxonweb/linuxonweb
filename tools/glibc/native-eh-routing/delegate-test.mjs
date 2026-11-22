import fs from 'node:fs';
const task=process.argv[2];const fatal={abort:0,terminate:0};
const foreign=new Error('delegate foreign identity');
const e=new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(`${task}/objects/delegate.wasm`)),{env:{foreign_raise(){throw foreign;},unexpected_abort(){fatal.abort++;throw Error('unexpected abort edge');},unexpected_terminate(){fatal.terminate++;throw Error('unexpected terminate edge');}}}).exports;
const rows=[];
for(const nested of [false,true])for(let i=0;i<16;i++)for(const selected of [0,1,2])for(const tag of [0,1,3]){
 e.delegate_reset();const before=e.observe_stack();let result,error;try{result=(nested?e.nested_delegate_entry:e.delegate_entry)(selected,tag);}catch(x){error=x;}
 const after=e.observe_stack(),trace=Array.from({length:e.delegate_query(0)},(_,n)=>e.delegate_query(n+1));
 const expected=selected===1&&tag!==3?[51]:[];if(nested&&(selected===2||tag!==3))expected.push(71);
 const identity=selected===2?!error:tag===1?error===foreign:error instanceof WebAssembly.Exception&&error.is(tag===3?e.__c_longjmp:e.__cpp_exception)&&error.getArg(tag===3?e.__c_longjmp:e.__cpp_exception,0)===731;
 rows.push({i,nested,selected,tag,before,after,trace,expected,result,identity,pass:identity&&before===after&&JSON.stringify(trace)===JSON.stringify(expected)&&(selected===2?result===42:result===undefined)});
}
for(let i=0;i<16;i++)for(const tag of [0,1,3]){
 e.delegate_reset();const before=e.observe_stack();let result,error;try{result=e.catchall_entry(tag);}catch(x){error=x;}
 const after=e.observe_stack(),trace=Array.from({length:e.delegate_query(0)},(_,n)=>e.delegate_query(n+1));
 const pass=before===after&&(tag===3?result===undefined&&error instanceof WebAssembly.Exception&&error.is(e.__c_longjmp)&&error.getArg(e.__c_longjmp,0)===731&&trace.length===0:result===99&&!error&&JSON.stringify(trace)==='[61]');
 rows.push({i,catchall:true,tag,before,after,result,trace,pass});
}
const report={pass:rows.every(r=>r.pass)&&fatal.abort===0&&fatal.terminate===0,fatal,cases:rows.length,rows,scope:'Native delegated-call/delegate-to-caller and deliberate catch-all controls; no ABI personality substitute'};
fs.writeFileSync(`${task}/logs/delegate-results.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:report.pass,cases:rows.length,failures:rows.filter(r=>!r.pass).length}));if(!report.pass)process.exit(1);
