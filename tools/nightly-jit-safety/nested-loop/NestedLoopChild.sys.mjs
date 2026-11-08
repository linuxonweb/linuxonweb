import {plan, expectedSource} from './plan.sys.mjs';
export class PblNestedLoopProbeChild extends JSWindowActorChild {
  async handleEvent(event) {
    if (this.started) throw Error('duplicate nested probe acquisition');
    this.started = true;
    let packet = {kind:'actual-firefox-nested-loop-result-v1',label:plan.label,status:'failed',runtimeAcceptance:false,fullJITAcceptance:false};
    try {
      const win = this.contentWindow, doc = win.document, Cu = Components.utils, target = Cu.waiveXrays(win), global = win.windowGlobalChild;
      if (event.type !== 'DOMContentLoaded' || !event.isTrusted || event.target !== doc || doc.readyState !== 'interactive' || doc.documentURI !== plan.documentURI) throw Error('trusted exact-URI DOM event required');
      if (!plan.buildIdentityBound || plan.buildBinding?.pass !== true) throw Error('reviewed full build binding required before invocation');
      const live = () => global.isCurrentGlobal && !global.isClosed && win.document === doc && win.windowGlobalChild === global && Cu.waiveXrays(global.contentWindow) === target;
      const app = Services.appinfo, options = Cu.getJSTestingFunctions().getJitCompilerOptions();
      if (app.version !== '159.0a1' || app.appBuildID !== plan.buildBinding.localBuildID || app.platformBuildID !== plan.buildBinding.localBuildID) throw Error('actual native build identity differs');
      const pref = Services.prefs.getBoolPref('javascript.options.portable_baseline');
      if (pref !== plan.portableBaseline || options['pbl.enable'] !== Number(pref) || options['pbl.warmup.threshold'] !== 10) throw Error('actual startup tier options differ');
      const fn = target.pblNestedProbe;
      if (typeof fn !== 'function' || Cu.waiveXrays(Cu.getGlobalForObject(fn)) !== target || target.Function.prototype.toString.call(fn) !== expectedSource) throw Error('actual source/function global differs');
      const start = target.performance.now();
      const guard = () => { if (!live() || target.pblNestedProbe !== fn || target.performance.now() - start >= plan.queryDeadlineMs) throw Error('owned target changed or bounded query expired'); };
      const seed = 1 + ((app.processID ^ (Date.now() & 32767)) >>> 0) % 97;
      const step = 1 + Math.floor(start) % 31;
      const {outer,inner,deep,limit} = plan.loopBounds;
      const args = plan.baseline ? Array.from(plan.baseline.args) : [outer,inner,deep,seed,step,limit];
      if (args.length !== 6 || args[0] !== outer || args[1] !== inner || args[2] !== deep || args[5] !== limit || !Number.isInteger(args[3]) || args[3] < 1 || args[3] > 97 || !Number.isInteger(args[4]) || args[4] < 1 || args[4] > 31) throw Error('bounded paired operands differ');
      const before = await this.sendQuery('NestedLoop:Boundary',{phase:'before'}); guard();
      let value, threw = false;
      try { value = fn(...Cu.cloneInto(args,win)); } catch (error) { threw = true; value = error; }
      const after = await this.sendQuery('NestedLoop:Boundary',{phase:'after'}); guard();
      if (threw ? typeof value !== 'number' : !Array.isArray(value) || value.length !== 4 || !value.every(Number.isSafeInteger)) throw Error('unexpected return/throw representation');
      packet = {...packet,status:'recorded',caseId:plan.caseId,scenario:plan.scenario,sourceURI:plan.sourceURI,sourceLine:1,sourceText:expectedSource,
        documentURI:doc.documentURI,windowId:String(global.innerWindowId),processID:app.processID,processType:app.processType,
        applicationBuildID:app.appBuildID,platformBuildID:app.platformBuildID,version:app.version,
        startupPref:pref,actualJitOptions:options,contentHardwareConcurrency:target.navigator.hardwareConcurrency,
        observerEnabled:before.observerEnabled,logBudget:before.logBudget,acquisitionEvent:event.type,acquisitionEventTrusted:true,
        liveCurrentGlobal:true,functionGlobalMatches:true,referenceStable:true,debuggerAttachedByProbe:false,
        runtimeOperandSource:plan.baseline ? 'recorded-disabled-guest-operands' : 'native-process-id/date/performance',
        baselineResultSHA256:plan.baseline?.resultSHA256 ?? null,args,threw,value:threw ? value : Array.from(value),invocations:1,
        targetPerformanceBeforeMs:start,targetPerformanceAfterMs:target.performance.now(),before,after};
    } catch (error) { packet.error = String(error); }
    await this.sendQuery('NestedLoop:Recorded',{packet});
  }
}
