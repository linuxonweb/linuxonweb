import fs from 'node:fs';import path from 'node:path';
const task=process.argv[2],level=process.argv[3];let instance,throwPoll=false,events=[],cleanups=[],buffers=[],remaining=0,throwKind=0;let passed=0,failed=0,stackLeaks=[];
const exception=new Error('owned ordinary cleanup control');
function check(c,label){if(c)passed++;else{failed++;console.error('FAIL',label);}}
const imports={control:{unexpected_fatal(){throw new Error("unexpected diagnostic fatal path");},poll(sp,reason){events.push({sp,reason,current:instance.exports.read_sp()});if(throwPoll&&reason&&--remaining===0){throwPoll=false;if(throwKind===1)instance.exports.raise_tag0();if(throwKind===2)instance.exports.actual_trap();if(throwKind===3)instance.exports.raise_tag1();throw exception;}},cleanup(id){cleanups.push(id);},buffer(p,n){buffers.push({p,n,sp:instance.exports.read_sp()});}}};
instance=(await WebAssembly.instantiate(fs.readFileSync(path.join(task,'objects/composed-controls-attempt2',level+'.wasm')),imports)).instance;
const e=instance.exports,base=e.read_sp();
function reset(){events=[];cleanups=[];buffers=[];throwPoll=false;throwKind=0;}
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
  check(e.read_sp()===base,name+' escaping SP restoration');
 }
 for(const kind of [1]) {
  reset();throwPoll=true;throwKind=kind;remaining=1;let caught;try{e.c_while();}catch(error){caught=error;}
  if(kind===1){check(caught instanceof WebAssembly.Exception&&caught.is(e.__cpp_exception),'native tag0 retained');check(JSON.stringify(cleanups)==='[11]','native tag0 C cleanup once');}
  else{check(caught instanceof WebAssembly.RuntimeError,'actual trap remains trap');check(cleanups.length===0,'actual trap bypasses source cleanup');}
  check(e.read_sp()===base,'native tag0 escaping SP restoration');
 }
 for(const name of ['c_while','cpp_while']){
  reset();throwPoll=true;throwKind=3;remaining=1;let caught;try{e[name]();}catch(error){caught=error;}
  check(caught instanceof WebAssembly.Exception&&caught.is(e.__c_longjmp),name+' native tag1 retained');
  check(caught instanceof WebAssembly.Exception&&caught.is(e.__c_longjmp)&&caught.getArg(e.__c_longjmp,0)===731,name+' native tag1 payload retained');
  check(cleanups.length===0,name+' tag1 skips source cleanup');check(e.read_sp()===base,name+' tag1 escaping SP restored');
 }
 reset();e.cpp_normal();check(JSON.stringify(cleanups)==='[23]','normal C++ destructor exactly once');check(e.read_sp()===base,'normal C++ SP restored');
}
reset();
// An actual Wasm trap bypasses all EH by design. Test it in a fresh instance,
// retain its measured SP leak, and discard that failed activation; never reset SP.
const trapRows=[];
for(let repeat=0;repeat<16;repeat++){
 let probe;const cleanup=[];
 const imports={control:{unexpected_fatal(){throw Error('unexpected');},cleanup(id){cleanup.push(id);},buffer(){},poll(sp,reason){if(reason)probe.exports.actual_trap();}}};
 probe=(await WebAssembly.instantiate(fs.readFileSync(path.join(task,'objects/composed-controls-attempt2',level+'.wasm')),imports)).instance;
 const before=probe.exports.read_sp();let caught;try{probe.exports.c_while();}catch(x){caught=x;}
 const after=probe.exports.read_sp();check(caught instanceof WebAssembly.RuntimeError,'actual trap remains trap');check(cleanup.length===0,'actual trap bypasses source cleanup');trapRows.push({repeat,before,after,leakBytes:before-after});
}
const result={level,passed,failed,callerSPControls:'zero/static/dynamic/nested/indirect/recursion',sourceCleanupControls:'C while/do/for, C++ while/range/lambda',escapingStackLeaks:stackLeaks,actualTrapScope:'fresh discarded instances; EH intentionally bypassed',trapRows,noDiagnosticSPReset:true,escapingStackRestorationImplemented:true,generalDescriptors:false,forcedUnwind:false,nativeTag1Cases:32,tag1Fix:'actual C/C++ loop tag1 escape preserves payload, skips source cleanup and restores SP'};
fs.writeFileSync(path.join(task,'logs',level+'-runtime.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({level,passed,failed,escapingStackLeakCases:stackLeaks.length}));process.exitCode=failed?1:0;
