import fs from 'node:fs';import path from 'node:path';
const task=process.argv[2],level=process.argv[3];let instance,throwPoll=false,events=[],cleanups=[],buffers=[],remaining=0,throwKind=0;let passed=0,failed=0,stackLeaks=[];
const exception=new Error('owned ordinary cleanup control');
function check(c,label){if(c)passed++;else{failed++;console.error('FAIL',label);}}
const imports={control:{unexpected_fatal(){throw new Error("unexpected diagnostic fatal path");},poll(sp,reason){events.push({sp,reason,current:instance.exports.read_sp()});if(throwPoll&&reason&&--remaining===0){throwPoll=false;if(throwKind===1)instance.exports.raise_tag0();if(throwKind===2)instance.exports.actual_trap();throw exception;}},cleanup(id){cleanups.push(id);},buffer(p,n){buffers.push({p,n,sp:instance.exports.read_sp()});}}};
instance=(await WebAssembly.instantiate(fs.readFileSync(path.join(task,'objects/controls',level+'.wasm')),imports)).instance;
const e=instance.exports,base=e.read_sp();
function reset(){e.restore_sp(base);events=[];cleanups=[];buffers=[];throwPoll=false;throwKind=0;}
for(let repeat=0;repeat<16;repeat++){
 for(const [name,arg,want] of [['zero_frame',4,11],['static_frame',5,12],['dynamic_frame',80,31],['nested_indirect',6,36],['recursive',4,10]]){
  reset();check(e[name](arg)===want,name+' return');check(events[0].sp===base,name+' root caller SP');
  check(e.read_sp()===base,name+' normal SP restoration');
  if(name==='zero_frame'&&level!=='O0')check(events[0].current===base,'zero stack capture');
  if(name==='static_frame')check(events[0].current<events[0].sp,'static allocation occurs after captured entry');
  if(name==='nested_indirect'){check(events.length===3,'indirect covers all three callees');check(events[1].sp===events[0].current,'indirect nested caller SP');check(events[2].sp===events[1].current,'nested zero-frame caller SP');}
  if(name==='dynamic_frame'){check(events.some(x=>x.reason&&x.current<x.sp),'dynamic loop capture survives alloca');check(events.filter(x=>x.reason).every(x=>x.sp===base),'dynamic frame caller SP stable');}
  if(name==='recursive'){check(events.length===5,'recursive entry poll coverage');check(events.slice(1).every((x,i)=>x.sp===events[i].current),'recursive actual caller SP');}
 }
 for(const [name,want,budget] of [['c_while',[11],1],['c_do',[12],1],['c_for',[13],1],['cpp_while',[21],1],['cpp_range_lambda',[31,22],2]]){
  reset();throwPoll=true;remaining=budget;let caught;try{e[name]();}catch(error){caught=error;}
  check(caught===exception,name+' exact ordinary error identity');check(JSON.stringify(cleanups)===JSON.stringify(want),name+' live source cleanup exactly once');
  if(e.read_sp()!==base)stackLeaks.push({name,bytes:base-e.read_sp()});
  e.restore_sp(base);
 }
 for(const kind of [1,2]) {
  reset();throwPoll=true;throwKind=kind;remaining=1;let caught;try{e.c_while();}catch(error){caught=error;}
  if(kind===1){check(caught instanceof WebAssembly.Exception&&caught.is(e.__cpp_exception),'native tag0 retained');check(JSON.stringify(cleanups)==='[11]','native tag0 C cleanup once');}
  else{check(caught instanceof WebAssembly.RuntimeError,'actual trap remains trap');check(cleanups.length===0,'actual trap bypasses source cleanup');}
  e.restore_sp(base);
 }
 reset();e.cpp_normal();check(JSON.stringify(cleanups)==='[23]','normal C++ destructor exactly once');check(e.read_sp()===base,'normal C++ SP restored');
}
reset();
const result={level,passed,failed,callerSPControls:'zero/static/dynamic/nested/indirect/recursion',sourceCleanupControls:'C while/do/for, C++ while/range/lambda',escapingStackLeaks:stackLeaks,escapingStackRestorationImplemented:false,generalDescriptors:false,forcedUnwind:false,tag1Fix:false};
fs.writeFileSync(path.join(task,'logs',level+'-runtime.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({level,passed,failed,escapingStackLeakCases:stackLeaks.length}));process.exitCode=failed?1:0;
