import fs from 'node:fs';
const task=process.argv[2],opt=process.argv[3];
const fatal={abort:0,terminate:0};
const e=new WebAssembly.Instance(new WebAssembly.Module(fs.readFileSync(`${task}/objects/frames-${opt}.wasm`)),{env:{foreign_raise(){throw Error('unexpected');},unexpected_abort(){fatal.abort++;throw Error('unexpected abort edge');},unexpected_terminate(){fatal.terminate++;throw Error('unexpected terminate edge');}}}).exports;
const rows=[];
for(let n=-20;n<21;n++){
 for(const [name,arg,want] of [['leaf_i32',n,n+11],['leaf_i64',BigInt(n),BigInt(n)+0x123456789n],['leaf_f32',n,n+0.5],['leaf_f64',n,n+0.25],['branch_i32',n,n<0?n-7:n+13],['branch_i64',n,BigInt(n<0?n-21:n+37)],['branch_f32',n,n<0?n-0.5:n+0.75],['branch_f64',n,n<0?n-0.25:n+0.125]]){
  const before=e.observe_stack(),actual=e[name](arg),after=e.observe_stack();rows.push({name,n,before,after,actual:String(actual),want:String(want),pass:actual===want&&before===after});
 }
 for(const [name,args] of [['leaf_void',[]],['branch_void',[n]]]){const before=e.observe_stack(),actual=e[name](...args),after=e.observe_stack();rows.push({name,n,before,after,pass:actual===undefined&&before===after});}
}
const report={opt,pass:rows.every(x=>x.pass)&&fatal.abort===0&&fatal.terminate===0,fatal,cases:rows.length,rows};fs.writeFileSync(`${task}/logs/returns-${opt}-results.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({opt,pass:report.pass,cases:rows.length}));if(!report.pass)process.exit(1);
