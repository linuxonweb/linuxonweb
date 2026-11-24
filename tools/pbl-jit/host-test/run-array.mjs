// Execute real emitted Wasm, compare its state to an independent bytecode
// interpreter, then resume that interpreter after every bailout/interrupt.
// Array semantics use ordinary JavaScript arrays, including holes and throws.
// Symbolic bytecode is not evidence of final159 native bytecode eligibility.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const dir = process.argv[2];
const FRAME=0x10000, SP=0x20000, INTR=0x30000, OUT=0x30010, ARGV=0x30100;
const INT=0xffffff81, BOOL=0xffffff82, UNDEF=0xffffff83, NULL=0xffffff84;
const MAGIC=0xffffff85, OBJECT=0xffffff8c, CLASP=0x5000;
const TDZ=Symbol('TDZ'), BAD_MAGIC=Symbol('other magic'), OLD_OBJECT={oldObject:true};
const HOLE=Symbol('hole');
let checks=0, failures=0, cases=0;
function check(name, got, expected) {
  checks++;
  if (!Object.is(got,expected)) { failures++; console.log('FAIL',name,'got',got,'expected',expected); }
}
function eq(name,a,b) {
  if (a?.ref !== undefined || b?.ref !== undefined) check(name,a?.ref,b?.ref);
  else check(name,a,b);
}
const fixtures=new Map();
for (const name of ['matrix','matrix-noinit','matrix-unsafe-init','copy','update','tdz-bail']) {
  const prefix=`${dir}/array-${name}`;
  const meta=JSON.parse(fs.readFileSync(`${prefix}.json`));
  const code=JSON.parse(fs.readFileSync(`${prefix}.bytecode.json`));
  const bytes=fs.readFileSync(`${prefix}.wasm`);
  check(name+' emitted',meta.ok,true); check(name+' valid Wasm',WebAssembly.validate(bytes),true);
  check(name+' symbolic evidence marker',code.symbolic,true);
  fixtures.set(name,{meta,...code,bytes,pcMap:new Map(code.ops.map(o=>[o.pc,o]))});
}
function arrayDesc(values=new Array(16), opts={}) {
  return {values,length:values.length,initLen:values.length,capacity:Math.max(16,values.length),flags:0,...opts};
}
function originalArrays(seed=0) {
  const a=Array.from({length:16},(_,i)=>((i*7+seed*3)%19-9)/8);
  const b=Array.from({length:16},(_,i)=>((i*11+seed*5)%23-11)/8);
  return {A:arrayDesc(a),B:arrayDesc(b),O:arrayDesc(new Array(16),{initLen:0})};
}
function config(arrays=originalArrays(),opts={}) {
  return {arrays,locals:['O',0,123,456,789,0,0],args:['A','B'],...opts};
}
function copyConfig(opts={}) {
  return config(originalArrays(),{locals:['O',0,123,4,4,0,0],args:['A'],...opts});
}
const arrayRef=(name)=>({ref:name});
function logicalArrays(cfg,override) {
  const arrays={};
  for (const [name,d] of Object.entries(cfg.arrays)) {
    const saved=override?.[name];
    const a=new Array(saved?.length??d.length);
    if(saved) {
      for(const [key,value]of Object.entries(saved.entries))a[key]=value;
    } else {
      const limit=Math.min(d.initLen,d.length);
      for(let i=0;i<limit;i++)if(Object.hasOwn(d.values,i)&&d.values[i]!==HOLE)a[i]=d.values[i];
    }
    arrays[name]=a;
  }
  for (const [name,d] of Object.entries(cfg.arrays)) {
    const a=arrays[name];
    if(d.flags&0x40)Object.freeze(a);
    else if(d.flags&0x10)Object.preventExtensions(a);
    if(d.flags&2)Object.defineProperty(a,'length',{writable:false});
  }
  return arrays;
}
function state(cfg, prior) {
  const arrays=logicalArrays(cfg,prior?.arrays);
  const resolve=v=>typeof v==='string'&&Object.hasOwn(arrays,v)?arrays[v]:v?.ref!==undefined?arrays[v.ref]:v;
  return {arrays,locals:(prior?.locals??cfg.locals).map(resolve),args:(prior?.args??cfg.args).map(resolve),
    stack:(prior?.stack??[]).map(resolve),pc:prior?.pc??0,ic:prior?.ic??0,steps:0};
}
// Store sparse own keys and length explicitly. Resuming a valid huge indexed
// assignment may extend length above 2^31; neither snapshot nor comparison may
// iterate that length. Non-index own keys (for example -1) are preserved too.
function sparseSnapshot(a) {
  return {length:a.length,entries:Object.fromEntries(Object.keys(a).map(k=>[k,a[k]]))};
}
function refSnapshot(s) {
  const names=new Map(Object.entries(s.arrays).map(([n,a])=>[a,n]));
  const value=v=>names.has(v)?arrayRef(names.get(v)):v;
  return {locals:s.locals.map(value),args:s.args.map(value),stack:s.stack.map(value),
    arrays:Object.fromEntries(Object.entries(s.arrays).map(([n,a])=>[n,sparseSnapshot(a)])),
    pc:s.pc,ic:s.ic,sp:SP-8*s.stack.length};
}
function reference(f,cfg,{prior,stop,interrupt=false}={}) {
  const s=state(cfg,prior), pop=()=>s.stack.pop();
  while(s.pc!==f.meta.len) {
    if(++s.steps>100000)throw Error('reference step bound');
    const o=f.pcMap.get(s.pc);if(!o)throw Error('unknown reference PC '+s.pc);
    if(stop?.(s,o))return refSnapshot(s);
    let next=s.pc+o.len,a,b;
    const unary=fn=>s.stack.push(fn(pop()));
    const binary=fn=>{b=pop();a=pop();s.stack.push(fn(a,b));};
    const backedge=target=>{
      if(interrupt&&target<=s.pc){s.pc=target;s.ic=f.pcMap.get(target).a;return true;}
      next=target;return false;
    };
    switch(o.op) {
      case 'LoopHead':case 'JumpTarget':s.ic=o.a;break;
      case 'Int32':case 'Double':s.stack.push(o.a);break;
      case 'Uninitialized':s.stack.push(TDZ);break;
      case 'GetLocal':s.stack.push(s.locals[o.a]);break;
      case 'GetArg':s.stack.push(s.args[o.a]);break;
      case 'SetLocal':case 'InitLexical':s.locals[o.a]=s.stack.at(-1);break;
      case 'CheckLexical':if(s.stack.at(-1)===TDZ)throw new ReferenceError('TDZ');break;
      case 'Pop':pop();break;
      case 'Nop':case 'NopIsAssignOp':case 'DebugLeaveLexicalEnv':break;
      case 'ToNumeric':unary(v=>+v);s.ic++;break;
      case 'ToPropertyKey':s.ic++;break;
      case 'Inc':unary(v=>v+1);s.ic++;break;
      case 'Add':binary((x,y)=>x+y);s.ic++;break;
      case 'Mul':binary((x,y)=>x*y);s.ic++;break;
      case 'BitOr':binary((x,y)=>x|y);s.ic++;break;
      case 'Lt':binary((x,y)=>x<y);s.ic++;break;
      case 'GetElem':b=pop();a=pop();s.stack.push(a[b]);s.ic++;break;
      case 'StrictSetElem':case 'SetElem': {
        const v=pop(),i=pop(),a=pop();a[i]=v;s.stack.push(v);s.ic++;break;
      }
      case 'Goto':if(backedge(s.pc+o.a))return refSnapshot(s);break;
      case 'JumpIfFalse':s.ic++;if(!pop()&&backedge(s.pc+o.a))return refSnapshot(s);break;
      default:throw Error('unsupported independent opcode '+o.op);
    }
    s.pc=next;
  }
  return refSnapshot(s);
}
function install(f,cfg) {
  const memory=new WebAssembly.Memory({initial:4,maximum:65536,shared:true});
  const bytes=new Uint8Array(memory.buffer);bytes.fill(0xa5);
  const dv=new DataView(memory.buffer), ptrs=new Map(), names=new Map(), descs={};
  let n=0;
  for(const [name,d0]of Object.entries(cfg.arrays)) {
    const d={...d0};
    if(d.initLen>0&&Array.from({length:d.initLen},(_,i)=>!Object.hasOwn(d.values,i)).some(Boolean))d.flags|=0x80;
    const ptr=0x31000+n*0x100,elems=0x34010+n*0x1000;
    ptrs.set(name,ptr);names.set(ptr,name);descs[name]={...d,ptr,elems};n++;
  }
  function write(addr,v) {
    if(typeof v==='string'&&ptrs.has(v))v=arrayRef(v);
    let payload=0,tag;
    if(v?.ref!==undefined){tag=OBJECT;payload=ptrs.get(v.ref);}
    else if(v===OLD_OBJECT){tag=OBJECT;payload=0x9f00;}
    else if(v===HOLE){tag=MAGIC;payload=0;}
    else if(v===TDZ){tag=MAGIC;payload=10;}
    else if(v===BAD_MAGIC){tag=MAGIC;payload=7;}
    else if(v===undefined)tag=UNDEF;
    else if(v===null)tag=NULL;
    else if(typeof v==='boolean'){tag=BOOL;payload=Number(v);}
    else if(Number.isInteger(v)&&v>=-2147483648&&v<=2147483647&&!Object.is(v,-0)){tag=INT;payload=v;}
    else if(typeof v==='number'){dv.setFloat64(addr,v,true);return;}
    else throw Error('unhandled boxed value');
    dv.setUint32(addr,payload>>>0,true);dv.setUint32(addr+4,tag,true);
  }
  function read(addr) {
    const tag=dv.getUint32(addr+4,true),p=dv.getUint32(addr,true);
    if(tag<=0xffffff80)return dv.getFloat64(addr,true);
    if(tag===INT)return p|0;
    if(tag===OBJECT)return names.has(p)?arrayRef(names.get(p)):OLD_OBJECT;
    if(tag===MAGIC)return p===0?HOLE:p===10?TDZ:BAD_MAGIC;
    if(tag===BOOL)return Boolean(p);
    if(tag===UNDEF)return undefined;
    if(tag===NULL)return null;
    throw Error('unexpected boxed tag '+tag.toString(16));
  }
  for(let i=0;i<2;i++) {
    const p=0x8500+i*0x100,e=0x8800+i*0x100;
    dv.setUint32(p,(cfg.protoShape?.[i]??(0x7800+i*0x100)),true);
    dv.setUint32(p+8,e,true);dv.setUint32(e-12,cfg.protoInit?.[i]??0,true);
  }
  for(const d of Object.values(descs)) {
    const shape=d.shape??0x7600,base=d.clasp?0x7c00+(d.ptr-0x31000):0x7700;
    dv.setUint32(d.ptr,shape,true);dv.setUint32(shape,base,true);dv.setUint32(base,d.clasp??CLASP,true);
    dv.setUint32(d.ptr+8,d.elems,true);
    for(const [off,v]of[[-16,d.flags],[-12,d.initLen],[-8,d.capacity],[-4,d.length]])dv.setUint32(d.elems+off,v,true);
    for(let i=0;i<d.initLen;i++)write(d.elems+8*i,Object.hasOwn(d.values,i)?d.values[i]:HOLE);
  }
  cfg.locals.forEach((v,i)=>write(FRAME-8*(i+1),v));cfg.args.forEach((v,i)=>write(ARGV+8*i,v));
  dv.setUint32(INTR,cfg.interrupt?1:0,true);
  const initial=bytes.slice();
  const table=new WebAssembly.Table({initial:0,element:'anyfunc'});
  const f0=new WebAssembly.Instance(new WebAssembly.Module(f.bytes),{env:{memory,table}}).exports.f0;
  const kind=Number(f0(...[FRAME,SP,INTR,OUT,ARGV].map(BigInt),...Array(18).fill(0n)));
  const snap={kind};
  if(kind) {
    snap.pc=dv.getInt32(OUT+4,true);snap.ic=dv.getUint32(OUT+8,true);snap.sp=dv.getUint32(OUT,true);
    if(snap.sp>SP||snap.sp<SP-16*8||snap.sp%8)throw Error('invalid exit SP');
    snap.locals=cfg.locals.map((_,i)=>read(FRAME-8*(i+1)));snap.args=cfg.args.map((_,i)=>read(ARGV+8*i));
    snap.stack=Array.from({length:(SP-snap.sp)/8},(_,i)=>read(SP-8*(i+1)));
    snap.arrays={};snap.init={};
    for(const [name,d]of Object.entries(descs)) {
      const len=dv.getUint32(d.elems-12,true);snap.init[name]=len;
      const a=new Array(d.length);for(let i=0;i<Math.min(len,d.length);i++){const v=read(d.elems+8*i);if(v!==HOLE)a[i]=v;}
      snap.arrays[name]=sparseSnapshot(a);
    }
  }
  return {snap,initial,bytes,dv,descs};
}
function compareArrays(name,a,b) {
  if(Array.isArray(a))a=sparseSnapshot(a);
  if(Array.isArray(b))b=sparseSnapshot(b);
  check(name+' length',a.length,b.length);
  const keys=[...new Set([...Object.keys(a.entries),...Object.keys(b.entries)])].sort();
  for(const key of keys) {
    check(name+' own '+key,Object.hasOwn(a.entries,key),Object.hasOwn(b.entries,key));
    if(Object.hasOwn(a.entries,key)&&Object.hasOwn(b.entries,key))eq(name+' value '+key,a.entries[key],b.entries[key]);
  }
}
function compareState(name,got,want) {
  for(const k of ['pc','ic','sp'])check(name+' '+k,got[k],want[k]);
  for(const k of ['locals','args','stack']) {
    check(name+' '+k+' length',got[k].length,want[k].length);
    for(let i=0;i<want[k].length;i++)eq(name+' '+k+i,got[k][i],want[k][i]);
  }
  for(const key of Object.keys(want.arrays))compareArrays(name+' '+key,got.arrays[key],want.arrays[key]);
}
function run(name,fixture,cfg,{kind=1,stop,resume=true,throwResume=false,expectedInit,compareOriginal=false}={}) {
  if(process.env.PBL_ARRAY_CASE&&!name.includes(process.env.PBL_ARRAY_CASE))return;
  if(process.env.PBL_ARRAY_TRACE)console.error('ARRAY_CASE',name,fixture);
  cases++;const f=fixtures.get(fixture),r=install(f,cfg);check(name+' kind',r.snap.kind,kind);
  if(r.snap.kind!==kind)return r;
  if(kind===0) {
    check(name+' all memory unchanged',Buffer.compare(r.initial,r.bytes),0);return r;
  }
  const expected=reference(f,cfg,{stop,interrupt:kind===3});compareState(name,r.snap,expected);
  if(expectedInit!==undefined)check(name+' output initialized length',r.snap.init.O,expectedInit);
  for(const arg of new Set(cfg.args.filter(v=>typeof v==='string'))) {
    const d=r.descs[arg];
    check(name+' input bytes '+arg,Buffer.compare(r.initial.subarray(d.elems-16,d.elems+8*d.capacity),r.bytes.subarray(d.elems-16,d.elems+8*d.capacity)),0);
  }
  for(const [i,v]of cfg.locals.entries())if(typeof v==='string')
    check(name+' frame reference '+i,Buffer.compare(r.initial.subarray(FRAME-8*(i+1),FRAME-8*i),r.bytes.subarray(FRAME-8*(i+1),FRAME-8*i)),0);
  check(name+' argument slots unchanged',Buffer.compare(r.initial.subarray(ARGV,ARGV+cfg.args.length*8),r.bytes.subarray(ARGV,ARGV+cfg.args.length*8)),0);
  if(kind!==1&&resume) {
    let a,b,ae,be;
    try{a=reference(f,cfg,{prior:r.snap});}catch(e){ae=e.constructor.name;}
    try{b=reference(f,cfg);}catch(e){be=e.constructor.name;}
    check(name+' resumed exception',ae,be);
    check(name+' expected exception',Boolean(ae),throwResume);
    if(a&&b)compareState(name+' resumed',a,b);
  }
  if(compareOriginal&&kind===1) {
    const arrays=logicalArrays(cfg);compareArrays(name+' unchanged original multiply',r.snap.arrays.O,originalMultiply(arrays.A,arrays.B));
  }
  return r;
}
const source=fs.readFileSync(new URL('../../guest-rootfs/firefox-gpu-check/gpu-check.html',import.meta.url),'utf8');
const functionSource=source.match(/function multiply\(a, b\) \{[\s\S]*?\n  return out;\n\}/)?.[0];
if(!functionSource)throw Error('unchanged original multiply missing');
check('original allocates holes',functionSource.includes('const out = new Array(16);'),true);
const originalMultiply=Function('return ('+functionSource+')')();
for(let seed=0;seed<32;seed++)run('matrix '+seed,'matrix',config(originalArrays(seed)),{expectedInit:16,compareOriginal:true});
{
  const arrays=originalArrays();arrays.A.values=Array.from({length:16},(_,i)=>i%5-2);arrays.B.values=Array.from({length:16},(_,i)=>i%3);
  run('integer inputs widen safely','matrix',config(arrays),{expectedInit:16,compareOriginal:true});
  arrays.O=arrayDesc(new Array(16),{initLen:16,flags:0x80});
  run('existing holes','matrix',config(arrays),{expectedInit:16,compareOriginal:true});
  arrays.O=arrayDesc(Array(16).fill(71));
  run('numeric overwrite with proof','matrix',config(arrays),{expectedInit:16,compareOriginal:true});
  run('numeric overwrite without init proof','matrix-noinit',config(arrays),{expectedInit:16,compareOriginal:true});
}
for(const v of [NaN,Infinity,-Infinity,-0,Number.MIN_VALUE,1e200]) {
  const arrays=originalArrays(3);arrays.A.values[5]=v;
  run('IEEE '+String(v),'matrix',config(arrays),{expectedInit:16,compareOriginal:true});
}
{
  const arrays=originalArrays();arrays.B=arrays.A;
  const cfg=config({A:arrays.A,O:arrays.O},{args:['A','A']});
  run('read-only input alias allowed','matrix',cfg,{expectedInit:16});
}
for(const output of ['A','B']) {
  const cfg=config();cfg.locals[0]=output;run('output alias '+output,'matrix',cfg,{kind:0});
}
for(const [name,override]of[['shape',{shape:0x7620}],['proxy class',{clasp:0x5004}]]) {
  const cfg=config();Object.assign(cfg.arrays.O,override);run('receiver '+name,'matrix',cfg,{kind:0});
}
for(const i of [0,1]) {
  run('prototype dense addition '+i,'matrix',config(originalArrays(),{protoInit:{[i]:1}}),{kind:0});
  run('prototype sparse/accessor shape '+i,'matrix',config(originalArrays(),{protoShape:{[i]:0x7e00+i*4}}),{kind:0});
}
const at=(f,mark,predicate=()=>true)=>(s,o)=>o.pc===f.marks[mark]&&predicate(s);
const matrix=fixtures.get('matrix'),copy=fixtures.get('copy'),update=fixtures.get('update');
for(const [name,flag,throws]of[['non-writable length',2,false],['non-extensible',0x10,true],['sealed',0x30,true],['frozen',0x70,true],['iteration',0x100,false],['shifted',1<<21,false],['shared',8,false],['unknown',0x400,false]]) {
  const cfg=config();cfg.arrays.O.flags=flag;
  run(name,'matrix',cfg,{kind:2,stop:at(matrix,'write'),expectedInit:0,throwResume:throws});
}
for(const key of ['capacity','length']) {
  const cfg=config();cfg.arrays.O[key]=7;
  run('partial '+key,'matrix',cfg,{kind:2,stop:at(matrix,'write',s=>s.stack.at(-2)===7),expectedInit:7});
}
for(const [name,value]of[['old GC value',OLD_OBJECT],['old non-hole magic',BAD_MAGIC],['old TDZ magic',TDZ],['old boolean',false],['old undefined',undefined]]) {
  const cfg=config();cfg.arrays.O=arrayDesc(Array(16).fill(0));cfg.arrays.O.values[5]=value;
  run(name,'matrix',cfg,{kind:2,stop:at(matrix,'write',s=>s.stack.at(-2)===5),expectedInit:16,resume:typeof value!=='symbol'});
}
for(const [name,value]of[['input hole',HOLE],['input boolean',true],['input object',OLD_OBJECT],['input undefined',undefined]]) {
  const cfg=config();if(value===HOLE)delete cfg.arrays.B.values[5];else cfg.arrays.B.values[5]=value;
  run(name+' after prior appends','matrix',cfg,{kind:2,stop:at(matrix,'readB',s=>s.stack.at(-1)===5),expectedInit:4});
}
{
  const cfg=config();cfg.arrays.B.initLen=5;
  run('input initialized bound after appends','matrix',cfg,{kind:2,stop:at(matrix,'readB',s=>s.stack.at(-1)===5),expectedInit:4});
  const none=config();run('no proof keeps hole bailout','matrix-noinit',none,{kind:2,stop:at(fixtures.get('matrix-noinit'),'write'),expectedInit:0});
  run('rejected prototype proof keeps hole bailout','matrix-unsafe-init',config(),{kind:2,stop:at(fixtures.get('matrix-unsafe-init'),'write'),expectedInit:0});
}
for(const offset of [-1,1,16,2147483647]) {
  const cfg=copyConfig();cfg.locals[5]=offset;
  run('output key '+offset,'copy',cfg,{kind:2,stop:at(copy,'write'),expectedInit:0});
}
{
  const cfg=copyConfig();cfg.locals[1]=-1;
  run('negative input index','copy',cfg,{kind:2,stop:at(copy,'read'),expectedInit:0});
  const cfg2=copyConfig();cfg2.locals[4]=5;
  run('input index exceeds length','copy',cfg2,{kind:2,stop:at(copy,'read',s=>s.stack.at(-1)===16),expectedInit:16});
}
{
  const cfg=copyConfig();run('copy initializes','copy',cfg,{expectedInit:16});
  cfg.interrupt=true;run('interrupt after first append','copy',cfg,{kind:3,expectedInit:1});
  const noInner=copyConfig({interrupt:true});noInner.locals[4]=0;
  run('outer interrupt empty inner','copy',noInner,{kind:3,expectedInit:0});
  const matrixCfg=config(originalArrays(),{interrupt:true});
  run('matrix inner interrupt before store','matrix',matrixCfg,{kind:3,expectedInit:0});
  const updated=copyConfig({args:[]});updated.arrays.O=arrayDesc(Array.from({length:16},(_,i)=>i));
  run('numeric elements widen in place','update',updated,{expectedInit:16});
  delete updated.arrays.O.values[7];
  run('update read hole after earlier writes','update',updated,{kind:2,stop:at(update,'read',s=>s.stack.at(-1)===7),expectedInit:16});
}
{
  const cfg={arrays:{},locals:[0,0,123,456,1e100,2,2],args:[]};
  const f=fixtures.get('tdz-bail');
  run('bail after exact lexical clear','tdz-bail',cfg,{kind:2,stop:at(f,'convert')});
  cfg.locals[4]=1;cfg.interrupt=true;
  run('interrupt preserves dead lexical sentinel','tdz-bail',cfg,{kind:3});
}
for(const [name,reason]of Object.entries({'aliased-args':'arguments','arg-index':'argument index','formal-store':'nested argument write','ref-write':'array var written','tdz-read':'tdz','formal-rebind':'nested opcode'})) {
  const prefix=`${dir}/array-reject-${name}`;const m=JSON.parse(fs.readFileSync(prefix+'.json'));
  check(name+' rejected',m.ok,false);check(name+' reason',m.reason,reason);check(name+' no module',fs.existsSync(prefix+'.wasm'),false);
}
check('matrix bounded region',matrix.meta.len<=512,true);check('matrix three headers',matrix.meta.loops.length,3);
check('matrix reads two formals',matrix.meta.maxArg,2);check('matrix numeric widening',matrix.meta.attempts>1,true);
const proof=JSON.parse(fs.readFileSync(`${dir}/array-proof-checks.json`));
check('shared initialization proof checks pass',proof.pass,true);
check('shared initialization proof failures',proof.failures,0);
check('shared initialization production predicates',proof.sharedProductionPredicates,true);
check('shared initialization hostile graphs',proof.checks,38);
const completeSuite=!process.env.PBL_ARRAY_CASE&&cases===87;
const report={pass:failures===0&&completeSuite,checks,failures,cases,completeSuite,
  caseFilter:process.env.PBL_ARRAY_CASE||null,expectedCases:87,compiledArrayModules:fixtures.size,rejectedFixtures:6,
  initializationProofChecks:proof.checks,
  originalMultiplySha256:createHash('sha256').update(functionSource).digest('hex'),symbolicBytecode:true,
  hostEvidenceOnly:true,nativeFirefoxAcceptance:'not run',nativeEligibility:'unconfirmed',performanceClaim:false};
console.log(JSON.stringify(report));process.exitCode=report.pass?0:1;
