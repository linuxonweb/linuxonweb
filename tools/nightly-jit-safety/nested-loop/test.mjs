#!/usr/bin/env node
// All evidence in this file is synthetic. These tests cannot approve a native build.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CASES,SCENARIOS,inputs,source,sourceHeads,expected,disposition} from './cases.mjs';
import {analyze,parseObservations,readRun,compareRuns,readBoundedFile} from './analyze.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const sha = b=>createHash('sha256').update(b).digest('hex');
const clone = x=>JSON.parse(JSON.stringify(x));
let checks = 0, matrix = 0, pairedMatrix = 0, negatives = 0, actorChecks = 0;
function check(name,fn) { try { fn(); checks++; } catch(error) { error.message = name+': '+error.message; throw error; } }
function rejects(name,fn,pattern) { check(name,()=>assert.throws(fn,pattern)); negatives++; }
async function rejectsAsync(name,fn,pattern) { try { await assert.rejects(fn,pattern); checks++; negatives++; } catch(error) { error.message=name+': '+error.message; throw error; } }
const binding = {kind:'caller-reviewed-full-nightly-jit-build-binding-v1',pass:true,target:'wasm32-linux-musl',version:'159.0a1',environmentSlotCount:23,broadCoverage:true,restartOnlyPref:'javascript.options.portable_baseline',localBuildID:'20261108000000'};
for (const key of ['finalBinarySHA256','archiveSHA256','runtimeManifestSHA256','kernelSHA256','buildReviewSHA256','observerPblSha256','observerInterpreterSha256','optionObserverWorkerSha256','optionObserverStartupSha256']) binding[key]='1'.repeat(64);
const bindingBytes=Buffer.from(JSON.stringify(binding));
function obs(event,overrides={}) {
  const row={event,file:'file:///home/admin/nightly-jit-safety/synthetic-enabled/case.js',line:1,off:30,tid:321,pthread:1234,tls:'0xabc',epoch:1,fn:['install','run','bail','interrupt','noentry','gc-evict'].includes(event)?42:0,kind:({run:1,bail:2,interrupt:3,noentry:0})[event]??-1,sp:0,pcDelta:0,ic:0,...overrides};
  return 'PBLJIT_OBS '+Object.entries(row).map(([k,v])=>`${k}=${v}`).join(' ')+'\n';
}
function fixture({arm='enabled',caseId='depth2',scenario='many',events}={}) {
  const label='synthetic-'+arm,base=`file:///home/admin/nightly-jit-safety/${label}/`,args=inputs(caseId,scenario,47,17),src=source(caseId);
  const session={kind:'nested-loop-guest-preparation-v1',label,caseId,scenario,arm,portableBaseline:arm==='enabled',baseline:null,loopBounds:{outer:args[0],inner:args[1],deep:args[2],limit:args[5]},sourceURI:base+'case.js',documentURI:base+'probe.html',sourceLine:1,sourceSHA256:sha(src),sourceHeads:sourceHeads(caseId),expectedDisposition:disposition(caseId),buildIdentityBound:true,buildFilesVerified:false,buildBinding:clone(binding),buildBindingSHA256:sha(bindingBytes),guestDeadlineSeconds:150,queryDeadlineMs:12000,observerLogCapBytes:2097152,invocations:1,nativeLoopMap:null,runtimeAcceptance:false,fullJITAcceptance:false};
  const result={kind:'actual-firefox-nested-loop-result-v1',status:'recorded',...Object.fromEntries(['label','caseId','scenario','sourceURI','sourceLine','documentURI'].map(k=>[k,session[k]])),sourceText:src.trimEnd(),processID:321,processType:2,windowId:'7',parentObservedProcessID:100,parentObservedOSPid:321,parentObservedInProcess:false,version:'159.0a1',applicationBuildID:binding.localBuildID,platformBuildID:binding.localBuildID,startupPref:session.portableBaseline,actualJitOptions:{'pbl.enable':Number(session.portableBaseline),'pbl.warmup.threshold':10},observerEnabled:'1',logBudget:'0',acquisitionEvent:'DOMContentLoaded',acquisitionEventTrusted:true,liveCurrentGlobal:true,functionGlobalMatches:true,referenceStable:true,debuggerAttachedByProbe:false,runtimeOperandSource:'native-process-id/date/performance',baselineResultSHA256:null,args,...expected(caseId,args),invocations:1,targetPerformanceBeforeMs:10,targetPerformanceAfterMs:20,runtimeAcceptance:false,fullJITAcceptance:false};
  const before=Buffer.from('native diagnostic preamble\n');
  const after=Buffer.concat([before,Buffer.from(events??(arm==='enabled'?obs('install')+obs('run'):''))]);
  for(const [phase,bytes] of [['before',before],['after',after]]) result[phase]={phase,bytes:bytes.length,file:`observer.${phase}.stderr`,observerEnabled:'1',logBudget:'0'};
  return {session,result,before,after};
}
const reduce=f=>analyze(f.session,f.result,f.before,f.after);
function replaceLog(f,text) { f.after=Buffer.concat([f.before,Buffer.from(text)]); f.result.after.bytes=f.after.length; }
function runSource(caseId,args) { const fn=vm.runInNewContext(source(caseId)+'\npblNestedProbe',{}, {timeout:1000}); try { return {threw:false,value:Array.from(fn(...args))}; } catch(value) { return {threw:true,value}; } }
for(const caseId of CASES) for(const scenario of SCENARIOS) for(const seed of [1,47,97]) for(const step of [1,17,31]) {
  const args=inputs(caseId,scenario,seed,step),wanted=expected(caseId,args),first=runSource(caseId,args),second=runSource(caseId,args);
  check(`independent closed-form ${caseId}/${scenario}/${seed}/${step}`,()=>assert.deepEqual(first,wanted)); matrix++;
  check(`same operands across isolated host evaluations ${caseId}/${scenario}/${seed}/${step}`,()=>assert.deepEqual(second,first)); pairedMatrix++;
}
for(const caseId of CASES) check('source positions '+caseId,()=>{
  const heads=sourceHeads(caseId),lines=source(caseId).split('\n');
  assert.equal(heads.length,caseId==='depth3'?3:2);
  assert.equal(new Set(heads.map(h=>h.sourceLine)).size,heads.length);
  for(const [i,h] of heads.entries()) { assert.equal(h.depth,i+1); assert.ok(h.endSourceLine>h.sourceLine); assert.ok(lines[h.sourceLine-1].includes('probe-head:'+h.name)); assert.ok(source(caseId).includes(h.workCounter+' = '+h.workCounter+' + 1')); assert.equal(h.bytecodeOffset,null); assert.equal(h.icIndex,null); }
});
check('late inner break differs from outer continue',()=>{
  const a=inputs('innerBreak','many',47,17);
  assert.equal(a[5],1040);
  assert.equal(expected('innerBreak',a).value[0]-expected('outerContinue',a).value[0],17*5);
  assert.equal(expected('innerBreak',a).value[2],1056*2-1);
});
check('unsupported return allocation label',()=>assert.equal(disposition('earlyReturn'),'unsupported-nested-return-allocation-fallback'));
check('late type change exceeds int32 but stays exact',()=>{const a=inputs('typeChange','many',97,31); assert.equal(a[5],1040); assert.ok(expected('typeChange',a).value[0]>2147483647); assert.ok(expected('typeChange',a).value.every(Number.isSafeInteger));});
for(const args of [['unknown','many',1,1],['depth2','unknown',1,1],['depth2','many',0,1],['depth2','many',1,32]]) rejects('bounded fixture input',()=>inputs(...args),/unknown|bounded/);
check('normal exit remains unmapped and unaccepted',()=>{ const d=reduce(fixture()); assert.equal(d.normalExitEvents,1); assert.equal(d.bailExitEvents,0); assert.equal(d.outerLoopIdentified,false); assert.equal(d.outerNormalExitProven,false); assert.equal(d.usefulOuterAndInnerCompiledWorkProven,false); assert.equal(d.runtimeAcceptance,false); assert.equal(d.nativeExecutionVerified,false); assert.equal(d.fullJITAcceptance,false); });
for(const [event,field] of [['bail','bailExitEvents'],['interrupt','interruptExitEvents'],['noentry','noEntryEvents']]) check(event+' distinct from Normal',()=>{const d=reduce(fixture({events:obs('install')+obs(event)})); assert.equal(d[field],1);assert.equal(d.normalExitEvents,0);assert.equal(d.entryInferredFromExit,event!=='noentry');});
check('separate source offsets remain unnamed',()=>{const d=reduce(fixture({events:obs('install')+obs('run')+obs('install',{off:70,fn:43})+obs('bail',{off:70,fn:43})}));assert.deepEqual(d.offsets.map(o=>[o.bytecodeOffset,o.loopName]),[[30,null],[70,null]]);});
check('disabled packet no events',()=>assert.equal(reduce(fixture({arm:'disabled'})).normalExitEvents,0));
check('in-process target identity',()=>{const f=fixture(); Object.assign(f.result,{processType:0,parentObservedInProcess:true,parentObservedOSPid:-1,parentObservedProcessID:321}); assert.equal(reduce(f).semanticResultMatches,true);});
check('unrelated native event ignored for target',()=>assert.equal(reduce(fixture({events:obs('reject',{file:'file:///home/admin/nightly-jit-safety/another/case.js'})})).observationState,'no-source-observation'));
for(const [caseId,event] of [['finallyFallback','policy-finally'],['throwFallback','policy-throw']]) check('fallback semantics '+caseId,()=>{const d=reduce(fixture({caseId,events:obs(event)})); assert.deepEqual(d.policyFallbackEvents,[event]);assert.equal(d.normalExitEvents,0);});
const malformed=[
 ['unknown event',obs('invented'),/unknown/],['invalid kind event',obs('invalid-kind'),/unknown/],
 ['Normal mislabeled Bail',obs('run',{kind:2}),/name\/kind/],['Bail mislabeled Normal',obs('bail',{kind:1}),/name\/kind/],
 ['NoEntry has output',obs('noentry',{sp:1}),/NoEntry/],['install has output',obs('install',{pcDelta:1}),/non-exit/],
 ['reject has function',obs('reject',{fn:42}),/function/],['install missing function',obs('install',{fn:0}),/function/],
 ['zero thread',obs('run',{tid:0}),/identity/],['zero TLS',obs('run',{tls:'0x0000'}),/identity/],
 ['unsafe numeric field',obs('run',{epoch:'9007199254740992'}),/unsafe/],['uint32 overflow',obs('run',{off:4294967296}),/range/],
 ['signed output overflow',obs('run',{pcDelta:2147483648}),/range/],['malformed prefix','prefix '+obs('run'),/malformed/],
 ['missing space','PBLJIT_OBS\n',/malformed/],['missing newline',obs('run').trimEnd(),/complete/],
 ['observer exhausted','PBLJIT_OBS_EXHAUSTED\n',/exhausted/],['option exhausted','PBLJIT_OPTION_EXHAUSTED\n',/exhausted/],
 ['tier exhausted','PBLTIER_OBS_EXHAUSTED\n',/exhausted/]
];
for(const [name,text,pattern] of malformed) rejects(name,()=>parseObservations(Buffer.from(text)),pattern);
rejects('invalid raw UTF-8',()=>parseObservations(Buffer.from([0xff,10])),/UTF-8/);
rejects('raw cap exactly reached',()=>parseObservations(Buffer.alloc(2097152,10)),/cap/);
rejects('4096 emission boundary',()=>parseObservations(Buffer.from(obs('reject').repeat(4096))),/boundary/);
check('4095 observations remain below boundary',()=>assert.equal(parseObservations(Buffer.from(obs('reject').repeat(4095))).length,4095));
for(const [name,events,pattern] of [
 ['exit without install',obs('run'),/matching/],['thread mismatch',obs('install')+obs('run',{tid:322}),/main thread/],
 ['TLS mismatch',obs('install')+obs('run',{tls:'0xabd'}),/main thread/],['pthread mismatch',obs('install')+obs('run',{pthread:99}),/main thread/],
 ['epoch mismatch',obs('install')+obs('run',{epoch:2}),/matching/],['function mismatch',obs('install')+obs('run',{fn:43}),/matching/],
 ['offset mismatch',obs('install')+obs('run',{off:31}),/matching/],['evicted entry reused',obs('install')+obs('gc-evict',{epoch:2})+obs('run'),/matching/],
 ['script start line mismatch',obs('install',{line:3}),/start line/]
]) rejects(name,()=>reduce(fixture({events})),pattern);
check('reinstall after eviction',()=>assert.equal(reduce(fixture({events:obs('install')+obs('gc-evict',{epoch:2})+obs('install',{epoch:2,fn:43})+obs('run',{epoch:2,fn:43})})).normalExitEvents,1));
const packetMutations=[
 ['checksum',f=>f.result.value[0]++,/checksum/],['counter',f=>f.result.value[2]++,/checksum/],
 ['seed outside bounds',f=>f.result.args[3]=98,/bounded/],['loop bound',f=>f.session.loopBounds.outer++,/bounds/],
 ['fake source',f=>f.result.sourceText+=' ',/source\/build/],['source head',f=>f.session.sourceHeads[0].sourceLine++,/heads/],
 ['invented mapping',f=>f.session.nativeLoopMap=[],/identity\/acceptance/],['claimed acceptance',f=>f.result.runtimeAcceptance=true,/invocation/],
 ['unreviewed build',f=>f.session.buildBinding.pass=false,/binding unavailable/],['wrong build ID',f=>f.result.applicationBuildID='20261108000001',/source\/build/],
 ['wrong options',f=>f.result.actualJitOptions['pbl.enable']=0,/options/],['wrong warmup',f=>f.result.actualJitOptions['pbl.warmup.threshold']=1000,/options/],
 ['untrusted event',f=>f.result.acquisitionEventTrusted=false,/trusted/],['replaced window',f=>f.result.liveCurrentGlobal=false,/trusted/],
 ['process type',f=>f.result.processType=1,/identity/],['parent process mismatch',f=>f.result.parentObservedOSPid=777,/parent-observed/],
 ['repeat invocation',f=>f.result.invocations=2,/invocation/],['expired query',f=>f.result.targetPerformanceAfterMs=12010,/deadline/],
 ['missing baseline field',f=>delete f.session.baseline,/baseline/],['faked provenance',f=>f.result.runtimeOperandSource='host-generated',/provenance/],
 ['wrong boundary bytes',f=>f.result.after.bytes++,/boundary/],['wrong fallback label',f=>f.session.expectedDisposition='admitted',/disposition/]
];
for(const [name,mutate,pattern] of packetMutations) rejects(name,()=>{const f=fixture(); mutate(f); reduce(f);},pattern);
rejects('raw prefix changed',()=>{const f=fixture(); f.after[0]^=1;reduce(f);},/changed/);
rejects('source already invoked',()=>{const f=fixture();f.before=Buffer.from(obs('install'));f.after=Buffer.from(obs('install')+obs('run'));f.result.before.bytes=f.before.length;f.result.after.bytes=f.after.length;reduce(f);},/already exercised/);
rejects('disabled native activity',()=>{const f=fixture({arm:'disabled',events:obs('install',{file:'file:///home/admin/nightly-jit-safety/synthetic-disabled/case.js'})});reduce(f);},/disabled arm/);
const parentText=await fs.readFile(path.join(here,'NestedLoopParent.sys.mjs'),'utf8');
const childText=await fs.readFile(path.join(here,'NestedLoopChild.sys.mjs'),'utf8');
async function moduleFor(text,globals,plan) {
  const context=vm.createContext(globals), mod=new vm.SourceTextModule(text,{context});
  const planModule=new vm.SyntheticModule(['plan','expectedSource'],function(){this.setExport('plan',plan);this.setExport('expectedSource',source(plan.caseId).trimEnd());},{context});
  await mod.link(specifier=>{assert.equal(specifier,'./plan.sys.mjs');return planModule;});await mod.evaluate();return mod.namespace;
}
async function parentHarness(f=fixture()) {
  const writes=[],notices=[],reads=[];let bytes=f.before;
  const globals={JSWindowActorParent:class{},Components:{utils:{importGlobalProperties(){}}},Services:{appinfo:{processID:100},obs:{notifyObservers(...a){notices.push(a);}}},Cc:{'@mozilla.org/process/environment;1':{getService(){return{get:k=>({'PBLJIT_OBSERVE':'1','PBLJIT_LOG':'0'})[k]};}}},Ci:{nsIEnvironment:{}},IOUtils:{async read(file,options){reads.push({file,options});return bytes;},async write(file,b){writes.push({file,bytes:b});},async writeJSON(file,packet){writes.push({file,packet:clone(packet)});}}};
  const ns=await moduleFor(parentText,globals,f.session),actor=new ns.PblNestedLoopProbeParent();
  const g={documentURI:{spec:f.session.documentURI},isCurrentGlobal:true,isClosed:false,innerWindowId:7,isInProcess:false,osPid:321};actor.manager=g;
  const tab={linkedBrowser:{browsingContext:{currentWindowGlobal:g}}},main={gBrowser:{tabs:[tab]}};
  const boundary=phase=>actor.receiveMessage({name:'NestedLoop:Boundary',data:{phase}});
  return{ns,actor,g,tab,main,writes,notices,reads,globals,boundary,setBytes:b=>{bytes=b;},own:()=>ns.ownTarget(main,tab),f};
}
{
  const h=await parentHarness();await rejectsAsync('parent rejects same URI unowned actor',()=>h.boundary('before'),/unowned/);h.own();
  await rejectsAsync('parent rejects after before first capture',()=>h.boundary('after'),/order/);
  const before=await h.boundary('before');h.setBytes(h.f.after);const after=await h.boundary('after');
  assert.equal(before.bytes,h.f.before.length);assert.equal(after.bytes,h.f.after.length);assert.equal(h.reads[0].options.maxBytes,2097153);
  await h.actor.receiveMessage({name:'NestedLoop:Recorded',data:{packet:clone(h.f.result)}});
  assert.equal(h.writes.at(-1).packet.parentObservedOSPid,321);assert.equal(h.notices.length,1);actorChecks++;
  await rejectsAsync('parent rejects duplicate record',()=>h.actor.receiveMessage({name:'NestedLoop:Recorded',data:{packet:clone(h.f.result)}}),/packet/);
  await rejectsAsync('parent rejects repeated after',()=>h.boundary('after'),/order/);h.ns.dropTarget(h.tab);
}
{
  const h=await parentHarness();h.own();let resume;h.globals.IOUtils.read=()=>new Promise(resolve=>{resume=resolve;});
  const pending=h.boundary('before');await rejectsAsync('parent reserves in-flight capture',()=>h.boundary('before'),/order/);resume(h.f.before);await pending;actorChecks++;
}
for(const [name,change,pattern] of [
 ['replaced owned window',h=>{h.tab.linkedBrowser.browsingContext.currentWindowGlobal={...h.g};},/unowned/],
 ['closed global',h=>{h.g.isClosed=true;},/unowned/],
 ['incomplete capture',h=>h.setBytes(Buffer.from('partial')),/incomplete/],
 ['capture cap',h=>h.setBytes(Buffer.alloc(2097152,10)),/capped/]
]) {const h=await parentHarness();h.own();change(h);await rejectsAsync(name,()=>h.boundary('before'),pattern);actorChecks++;}
{
 const h=await parentHarness();h.own();await h.boundary('before');h.setBytes(Buffer.from('changed\n'));await rejectsAsync('parent rejects rotated capture',()=>h.boundary('after'),/rotated/);actorChecks++;
}
for(const caseId of CASES) {
  const f=fixture({caseId}),plan=f.session,win={document:{readyState:'interactive',documentURI:plan.documentURI},navigator:{hardwareConcurrency:3},Function};let ticks=10,clones=0;
  win.performance={now:()=>ticks++};win.pblNestedProbe=vm.runInNewContext(source(caseId)+'\npblNestedProbe');
  win.windowGlobalChild={isCurrentGlobal:true,isClosed:false,contentWindow:win,innerWindowId:7};
  const Cu={waiveXrays:x=>x,getGlobalForObject:()=>win,cloneInto:x=>{clones++;return x;},getJSTestingFunctions:()=>({getJitCompilerOptions:()=>({'pbl.enable':1,'pbl.warmup.threshold':10})})};
  const ns=await moduleFor(childText,{JSWindowActorChild:class{},Components:{utils:Cu},Services:{appinfo:{version:'159.0a1',appBuildID:binding.localBuildID,platformBuildID:binding.localBuildID,processID:321,processType:2},prefs:{getBoolPref:()=>true}}},plan);
  const actor=new ns.PblNestedLoopProbeChild();actor.contentWindow=win;let recorded;actor.sendQuery=async(name,data)=>{if(name==='NestedLoop:Recorded'){recorded=data.packet;return {recorded:true};}return{phase:data.phase,bytes:0,file:`observer.${data.phase}.stderr`,observerEnabled:'1',logBudget:'0'};};
  await actor.handleEvent({type:'DOMContentLoaded',isTrusted:true,target:win.document});
  assert.equal(recorded.status,'recorded',recorded.error);assert.equal(clones,1);assert.deepEqual(clone({threw:recorded.threw,value:recorded.value}),expected(caseId,recorded.args));actorChecks++;
  await rejectsAsync('child rejects duplicate invocation '+caseId,()=>actor.handleEvent({type:'DOMContentLoaded',isTrusted:true,target:win.document}),/duplicate/);
}
const tempRoot=process.env.TMPDIR;
assert.ok(tempRoot && path.isAbsolute(tempRoot),'explicit disk TMPDIR required');
const temp=await fs.mkdtemp(path.join(tempRoot,'nested-probe-'));
const prepare=(args)=>spawnSync(process.execPath,[path.join(here,'prepare.mjs'),...args],{encoding:'utf8',timeout:5000,maxBuffer:65536});
const prepArgs=(out,label,arm='disabled')=>['--out',out,'--label',label,'--case','depth2','--scenario','many','--arm',arm];
async function exportFixture(directory,f) {
  await fs.mkdir(directory);await fs.writeFile(path.join(directory,'session.json'),JSON.stringify(f.session));await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(f.result));await fs.writeFile(path.join(directory,'observer.before.stderr'),f.before);await fs.writeFile(path.join(directory,'observer.after.stderr'),f.after);await fs.writeFile(path.join(directory,'build-binding.json'),bindingBytes);
}
try {
  const bindingFile=path.join(temp,'synthetic-binding.json');await fs.writeFile(bindingFile,bindingBytes);
  const oversized=path.join(temp,'oversized.json');await fs.writeFile(oversized,Buffer.alloc(65537,32));
  await rejectsAsync('bounded metadata read',()=>readBoundedFile(oversized),/read cap/);
  const rawCap=path.join(temp,'raw-at-cap.stderr');await fs.writeFile(rawCap,Buffer.alloc(2097152,10));
  await rejectsAsync('bounded raw read',()=>readBoundedFile(rawCap,2097151),/read cap/);
  await rejectsAsync('non-file read rejected',()=>readBoundedFile(temp),/regular/);
  const bindingLink=path.join(temp,'binding-link.json');await fs.symlink(bindingFile,bindingLink);
  await rejectsAsync('symlink export rejected',()=>readBoundedFile(bindingLink),/ELOOP/);
  check('oversized preparation binding rejected',()=>assert.notEqual(prepare([...prepArgs(path.join(temp,'oversized-prep'),'oversized-prep'),'--build-binding',oversized]).status,0));negatives++;

  const unbound=path.join(temp,'unbound'),prep=prepare(prepArgs(unbound,'unbound'));
  check('preparation without binding cannot claim execution',()=>{assert.equal(prep.status,0,prep.stderr);assert.equal(JSON.parse(prep.stdout).runtimeAcceptance,false);});
  const unboundPlan=JSON.parse(await fs.readFile(path.join(unbound,'session.json')));check('unbound preparation identity',()=>assert.equal(unboundPlan.buildIdentityBound,false));
  check('fresh output rejects overwrite',()=>assert.notEqual(prepare(prepArgs(unbound,'unbound')).status,0));negatives++;
  check('unsafe label rejected',()=>assert.notEqual(prepare(prepArgs(path.join(temp,'bad'),'../unsafe')).status,0));negatives++;
  check('duplicate flag rejected',()=>assert.notEqual(prepare([...prepArgs(path.join(temp,'dup'),'dup'),'--arm','enabled']).status,0));negatives++;
  await fs.symlink(temp,path.join(temp,'link'));check('symlink parent rejected',()=>assert.notEqual(prepare(prepArgs(path.join(temp,'link','bad-parent'),'bad-parent')).status,0));negatives++;
  const disabledDir=path.join(temp,'disabled');await exportFixture(disabledDir,fixture({arm:'disabled'}));const d=await readRun(disabledDir);
  const enabledDir=path.join(temp,'enabled'),enabledPrep=prepare([...prepArgs(enabledDir,'synthetic-enabled','enabled'),'--build-binding',bindingFile,'--baseline',disabledDir]);
  check('paired enabled preparation',()=>assert.equal(enabledPrep.status,0,enabledPrep.stderr));
  const e=fixture();e.session=JSON.parse(await fs.readFile(path.join(enabledDir,'session.json')));e.result.runtimeOperandSource='recorded-disabled-guest-operands';e.result.baselineResultSHA256=e.session.baseline.resultSHA256;
  await fs.writeFile(path.join(enabledDir,'result.json'),JSON.stringify(e.result));await fs.writeFile(path.join(enabledDir,'observer.before.stderr'),e.before);await fs.writeFile(path.join(enabledDir,'observer.after.stderr'),e.after);
  const enabled=await readRun(enabledDir),paired=compareRuns(d,enabled);
  check('paired exact operands and hashes verified without acceptance',()=>{assert.equal(paired.pairedOperandsEqual,true);assert.equal(paired.disabledBaselineVerified,true);assert.equal(paired.runtimeAcceptance,false);});
  rejects('paired baseline digest mismatch',()=>{const bad={...enabled,session:clone(enabled.session)};bad.session.baseline.resultSHA256='2'.repeat(64);compareRuns(d,bad);},/digest/);
  rejects('paired source identity mismatch',()=>{const bad={...enabled,session:clone(enabled.session)};bad.session.sourceSHA256='2'.repeat(64);compareRuns(d,bad);},/identity/);
  rejects('paired operands mismatch',()=>{const bad={...enabled,result:clone(enabled.result)};bad.result.args[3]++;compareRuns(d,bad);},/baseline/);
  await fs.writeFile(path.join(enabledDir,'build-binding.json'),bindingBytes+' ');await rejectsAsync('exported binding bytes changed',()=>readRun(enabledDir),/binding bytes/);
  const manifest=JSON.parse(await fs.readFile(path.join(enabledDir,'contract.json')));
  for(const [file,hash] of Object.entries(manifest.files)) if(file!=='build-binding.json') {const bytes=await fs.readFile(path.join(enabledDir,file));check('prepared file hash '+file,()=>assert.equal(sha(bytes),hash));}
} finally {await fs.rm(temp,{recursive:true,force:true});}
console.log(JSON.stringify({kind:'nested-loop-host-validation-v1',checks,semanticMatrix:matrix,sameOperandsHostComparisons:pairedMatrix,negativeChecks:negatives,actorProtocolChecks:actorChecks,nativeGuestInvocations:0,runtimeAcceptance:false,fullJITAcceptance:false}));
