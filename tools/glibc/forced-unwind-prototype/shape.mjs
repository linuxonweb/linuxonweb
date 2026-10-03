import fs from 'node:fs';
const task=process.argv[2];
const mod=new WebAssembly.Module(fs.readFileSync(`${task}/objects/shape.wasm`));
if(WebAssembly.Module.imports(mod).length)throw Error('unexpected imports');
const e=new WebAssembly.Instance(mod).exports;
let checks=0;const rows=[];
function check(yes,label){checks++;if(!yes)throw Error(label);}
for(let iteration=0;iteration<16;iteration++)for(const mode of [1,2]){
 const before=e.prototype_stack_pointer();e.prototype_root(before);
 let result,caught;
 try{result=e.fixture_run(mode);}catch(ex){caught=ex;}
 const sequence=Array.from({length:e.prototype_used()},(_,i)=>e.prototype_sequence(i));
 check(mode?result===37:!!caught,'control '+mode+' result='+result+' exception='+caught);
 if(!mode){check(caught instanceof WebAssembly.Exception&&caught.is(e.__cpp_exception),'native-tag0');check(caught.getArg(e.__cpp_exception,0)>0,'payload-pointer');}
 check(JSON.stringify(sequence)===JSON.stringify(mode===2?[4,3,9]:[2,1,9]),'cleanup-order '+sequence);
 check(e.prototype_stops()===3,'three-stops');
 check(e.prototype_failures()===0,'frame-CFA-or-retained-target-check '+e.prototype_failures());
 check(e.prototype_live()===0,'no-live-record');
 check(e.prototype_stack_pointer()===before,'linear-stack-restoration mode='+mode+' before='+before+' after='+e.prototype_stack_pointer());
 rows.push({iteration,mode,result:result??null,nativeException:!!caught,sequence,stops:e.prototype_stops(),before,after:e.prototype_stack_pointer()});
}
const report={pass:true,checks,rows,scope:'Native host Wasm ABI/scoped-EH representability only; no GNU pthread lifecycle or forced-unwind runtime acceptance',forwarding:'same payload through new native tag0 throw; host exception wrapper identity is not retained'};
fs.writeFileSync(`${task}/logs/shape-results.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:true,checks,cases:rows.length}));
