import fs from 'node:fs';
const task=process.argv[2],opt=process.argv[3];
const m=new WebAssembly.Module(fs.readFileSync(`${task}/objects/frames-${opt}.wasm`));
const fatal={abort:0,terminate:0};
const foreign=new Error('owned genuine foreign exception identity');
const e=new WebAssembly.Instance(m,{env:{foreign_raise(){throw foreign;},unexpected_abort(){fatal.abort++;throw Error('unexpected abort edge');},unexpected_terminate(){fatal.terminate++;throw Error('unexpected terminate edge');}}}).exports;
const rows=[];
for(let i=0;i<8;i++)for(let kind=0;kind<8;kind++)for(const tag of [0,1,3]){
 const before=e.observe_stack();let error,returned;
 try{returned=e.frame_entry(kind,tag,kind===6?4:73+i);}catch(x){error=x;}
 const after=e.observe_stack(),used=e.frame_query(0);
 const trace=Array.from({length:used},(_,n)=>e.frame_query(n+3));
 const expected=tag===3?[]:kind===7?[4,3]:kind>=5?[1,2]:[];
 const identity=tag===1?error===foreign:error instanceof WebAssembly.Exception&&error.is(tag===3?e.__c_longjmp:e.__cpp_exception)&&error.getArg(tag===3?e.__c_longjmp:e.__cpp_exception,0)===731;
 const pass=returned===undefined&&identity&&before===after&&JSON.stringify(trace)===JSON.stringify(expected);
 rows.push({i,kind,tag,before,after,trace,expected,identity,frameEntries:e.frame_query(1),lowest:e.frame_query(2),pass});
}
for(let i=0;i<8;i++)for(let kind=0;kind<8;kind++){
 const before=e.observe_stack();let result,error;
 try{result=e.retained_entry(kind,kind===6?4:73+i);}catch(x){error=String(x);}
 const after=e.observe_stack(),used=e.frame_query(0),trace=Array.from({length:used},(_,n)=>e.frame_query(n+3));
 rows.push({i,kind,retained:true,before,after,result,error,trace,pass:!error&&result===37&&before===after&&JSON.stringify(trace)==='[9]'});
}
for(let i=0;i<4;i++)for(let kind=0;kind<8;kind++)for(const outerJump of [0,1]){
 const before=e.observe_stack();let result,error;
 try{result=e.inner_entry(kind,kind===6?4:91+i,outerJump);}catch(x){error=String(x);}
 const after=e.observe_stack(),used=e.frame_query(0),trace=Array.from({length:used},(_,n)=>e.frame_query(n+3));
 const expected=outerJump?[11]:[9,11];
 rows.push({i,kind,inner:true,outerJump,before,after,result,error,trace,expected,pass:!error&&result===37&&before===after&&JSON.stringify(trace)===JSON.stringify(expected)});
}
for(let i=0;i<16;i++){
 const before=e.observe_stack(),result=e.normal_entry(i*37),after=e.observe_stack();
 rows.push({i,normal:true,before,after,result,trace:e.frame_query(3),pass:result===42&&before===after&&e.frame_query(0)===1&&e.frame_query(3)===8});
}
const report={opt,pass:rows.every(r=>r.pass)&&fatal.abort===0&&fatal.terminate===0,fatal,cases:rows.length,rows,nativeOrJSStackReset:false,scope:'Finite native frame/foreign/C-cleanup/SjLj controls; no public GNU jump, forced unwind/CFA/cancellation acceptance'};
fs.writeFileSync(`${task}/logs/frames-${opt}-results.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({opt,pass:report.pass,cases:rows.length,failures:rows.filter(r=>!r.pass).length}));
if(!report.pass)process.exit(1);
