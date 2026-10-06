import { currentEnvironment } from './benchmark-diagnostics.sys.mjs';
export const FIXTURE_SHA256='b07d647a19177c276ea5c94df60d7557405d0a69a767d21d471d3071fa5e31d8';
export const SETTLE_MS=15000;
export const SAMPLE=[{index:0,name:'int-loop',line:19,expected:49995000},{index:5,name:'prop-mono',line:24,expected:4003},{index:6,name:'native-call',line:25,expected:3999}];
export function targetURL(label) {
 if(!/^[ab]-[1-6]$/.test(label)) throw Error('owned original label required');
 return `file:///home/admin/nightly-jit-safety/original-bench-${label}/pblbench-${label}.html`;
}
// Native target-window indirect eval resolves the existing global lexical cases.
// It compiles only these expressions, never a function or replacement body.
export async function acquire(win,event,{Cu,Services,boundary,sourceBodies}) {
 const doc=win.document,uri=doc.documentURI,target=Cu.waiveXrays(win),child=win.windowGlobalChild;
 const label=/original-bench-([ab]-[1-6])\//.exec(uri)?.[1];
 if(targetURL(label)!==uri) throw Error('unowned original target');
 const live=()=>child?.isCurrentGlobal===true && child.isClosed===false && win.document===doc && win.windowGlobalChild===child && Cu.waiveXrays(child.contentWindow)===target;
 const guard=()=>{const ms=target.performance.now(); if(!live()||!Number.isFinite(ms)||ms<0||ms>=SETTLE_MS) throw Error('target changed or original timer deadline missed');return ms;};
 if(event.type!=='DOMContentLoaded'||event.isTrusted!==true||event.target!==doc||doc.readyState!=='interactive') throw Error('actual trusted original DOM event required');
 if(typeof Cu.getGlobalForObject!=='function'||typeof target.eval!=='function'||!/^function eval\(\)\s*\{\s*\[native code\]\s*\}$/.test(target.Function.prototype.toString.call(target.eval))||Cu.waiveXrays(Cu.getGlobalForObject(target.eval))!==target) throw Error('original target native eval/global required');
 const evaluate=expression=>{guard();return target.eval(expression);};
 if(Object.prototype.hasOwnProperty.call(target,'cases')) throw Error('original cases must remain global lexical');
 const cases=evaluate('cases');
 if(cases.length!==8||Cu.waiveXrays(Cu.getGlobalForObject(cases))!==target) throw Error('original lexical cases/global missing');
 const testing=Cu.getJSTestingFunctions();
 if(typeof testing?.getJitCompilerOptions!=='function') throw Error('actual compiler option getter unavailable');
 const options=testing.getJitCompilerOptions(), own=k=>Object.prototype.hasOwnProperty.call(options,k);
 const option=Reflect.get(options,'pbl.enable'),threshold=Reflect.get(options,'pbl.warmup.threshold');
 if(!own('pbl.enable')||!own('pbl.warmup.threshold')||typeof option!=='number'||![0,1].includes(option)||typeof threshold!=='number'||threshold!==10) throw Error('actual numeric options unavailable');
 const pref=Services.prefs.getBoolPref('javascript.options.portable_baseline');
 if(typeof pref!=='boolean'||Number(pref)!==option) throw Error('actual restart preference/option mismatch');
 const app=Services.appinfo,windowId=String(child.innerWindowId);
 if(!/^[1-9][0-9]*$/.test(windowId)||!Number.isSafeInteger(app.processID)||app.processID<=0||![0,2].includes(app.processType)) throw Error('actual target process identity missing');
 const packet={kind:'actual-original-body-acquisition-v1',status:'recorded',label,documentURI:uri,windowId,processID:app.processID,processType:app.processType,buildID:app.appBuildID,platformBuildID:app.platformBuildID,version:app.version,
  optionContext:'original-benchmark-target-content',portableBaselineOption:option,pblWarmupThreshold:threshold,restartPref:pref,pblEnableOwnProperty:true,pblWarmupOwnProperty:true,jitTestingFunctionsAvailable:true,jitCompilerOptionsGetterAvailable:true,getterSameJSContextAsTarget:true,
  liveCurrentGlobal:true,wrappedContentWindowMatches:true,globalLexicalCases:true,lexicalEvalAPI:'target-native-indirect-eval',evalCreatesReplacementFunction:false,debuggerAttached:false,
  acquisitionEvent:event.type,acquisitionEventTrusted:true,acquisitionDocumentReadyState:doc.readyState,targetTimeOrigin:target.performance.timeOrigin,targetPerformanceBeforeMs:guard(),unchangedSettleMs:SETTLE_MS,contentHardwareConcurrency:target.navigator.hardwareConcurrency,diagnosticEnvironment:currentEnvironment(Services),cases:[],runtimeAcceptance:false};
 for(const spec of SAMPLE) {
  const fn=evaluate(`cases[${spec.index}][1]`),body=target.Function.prototype.toString.call(fn);
  if(fn!==cases[spec.index][1]||Cu.waiveXrays(Cu.getGlobalForObject(fn))!==target||cases[spec.index][0]!==spec.name||cases[spec.index][2]!==spec.expected||body!==sourceBodies[String(spec.index)]) throw Error('actual original closure/source mismatch');
  const before=await boundary('before',spec.index);guard();
  const results=[];
  for(let n=0;n<20;n++) {if(evaluate(`cases[${spec.index}][1]`)!==fn) throw Error('original closure replaced'); const value=evaluate(`cases[${spec.index}][1]()`);if(value!==spec.expected) throw Error('original closure semantic failure');results.push(value);}
  const after=await boundary('after',spec.index);guard();
  packet.cases.push({...spec,sourceText:body,sourceURI:uri,sourceLineExpected:spec.line,referenceStable:true,functionGlobalMatches:true,invocationExpression:`cases[${spec.index}][1]()`,invocations:20,results,before,after});
 }
 packet.targetPerformanceAfterMs=guard();
 // Original inline emit has already emitted exactly its start row at DOM ready.
 // No replacement emit/timer callback, timer cancellation, or clock change.
 packet.originalResultText=doc.getElementById('result')?.textContent;
 if(typeof packet.originalResultText!=='string'||packet.originalResultText.split('\n').filter(l=>l.startsWith('PBLBENCH ')).length!==1) throw Error('unexpected original timed output');
 return packet;
}
