/* Guest Browser Console preparation only. Direct same-process window and a
 * complete, unrotated raw Firefox observer stderr file are required.
 * run(window,path), incremental(window,path), sliceGC(window,path), interrupt(window,path).
 * Interruption recovery alone never proves native callback/termination.
 */
globalThis.NightlySafetyDriver = {
  async context(targetWindow, observerLogPath, scope) {
    const Cu=Components.utils,target=Cu.waiveXrays(targetWindow);
    if(!Services?.appinfo||!target?.nightlySafetyMainDone||!target.njs_sum)throw Error('actual privileged completed same-process fixture required');
    const label=target.nightlySafetyLabel;
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(label))throw Error('fixture label');
    const prefix='/home/admin/nightly-jit-safety/'+label+'/';
    if(typeof observerLogPath!=='string'||!observerLogPath.startsWith(prefix)||observerLogPath.split('/').some(v=>v==='..'||v==='.')||observerLogPath.includes('//'))throw Error('owned absolute guest stderr path required');
    const child=targetWindow.windowGlobalChild;
    if(!child?.isCurrentGlobal||child.isClosed||Cu.waiveXrays(child.contentWindow)!==target)throw Error('direct live local WindowGlobalChild/contentWindow required');
    const windowId=String(child.innerWindowId);
    if(!/^[1-9][0-9]*$/.test(windowId))throw Error('actual inner-window identity required');
    const runId=Services.uuid.generateUUID().toString();
    if(typeof IOUtils==='undefined')Cu.importGlobalProperties(['IOUtils']);
    const emit=o=>console.log('NJS_PRIV '+JSON.stringify({label,runId,windowId,...o}));
    const read=async()=>{const bytes=await IOUtils.read(observerLogPath,{maxBytes:2097153});if(bytes.length>2097152)throw Error('observer log exceeds 2MiB');return bytes;};
    const source=name=>'file://'+prefix+label+'-main-'+name+'.js';
    const requireBaseline=bytes=>{
      const rows=new TextDecoder('utf-8',{fatal:true}).decode(bytes).split('\n').filter(l=>l.startsWith('PBLJIT_OBS ')).map((line,index)=>({index,...Object.fromEntries([...line.matchAll(/(\w+)=([^\s]+)/g)].map(m=>[m[1],m[2]]))})).filter(o=>o.file===source('sum')&&o.line==='1');
      const context=o=>/^[1-9][0-9]*$/.test(o.tid||'')&&/^[1-9][0-9]*$/.test(o.pthread||'')&&/^0x[0-9a-f]+$/i.test(o.tls||'')&&BigInt(o.tls)>0n&&BigInt(o.tls)<4294967296n&&/^(0|[1-9][0-9]*)$/.test(o.epoch||'')&&BigInt(o.epoch)<=18446744073709551615n&&/^[1-9][0-9]*$/.test(o.fn||'')&&BigInt(o.fn)<4294967296n;
      if(!rows.some(i=>i.event==='install'&&i.kind==='-1'&&context(i)&&rows.some(r=>r.index>i.index&&r.event==='run'&&r.kind==='1'&&context(r)&&['file','line','off','tid','pthread','tls','epoch','fn'].every(k=>i[k]===r[k])&&/^[1-9][0-9]*$/.test(r.sp||'')&&BigInt(r.sp)<4294967296n&&/^-?[0-9]+$/.test(r.pcDelta||'')&&BigInt(r.pcDelta)>=-2147483648n&&BigInt(r.pcDelta)<=2147483647n&&/^(0|[1-9][0-9]*)$/.test(r.ic||'')&&BigInt(r.ic)<4294967296n)))throw Error('missing actual source-specific pre-operation install/run');
    };
    const finish=async(before,event,fields)=>{const after=await read();if(after.length<before.length||before.some((b,i)=>after[i]!==b))throw Error('raw observer log rotated or changed');emit({event,...fields,observerLogPath,beforeBytes:before.length,afterBytes:after.length});};
    const testing=Cu.getJSTestingFunctions();
    for(const name of ['gcstate','startgc','finishgc','gcslice'])if(typeof testing[name]!=='function')throw Error('testing API unavailable: '+name);
    if(testing.gcstate()!=='NotActive')throw Error('requires initially inactive GC');
    emit({event:'identity',scope,observerLogPath,applicationBuildID:Services.appinfo.appBuildID,platformBuildID:Services.appinfo.platformBuildID,version:Services.appinfo.version,initialState:testing.gcstate()});
    return {Cu,target,emit,read,source,finish,testing,requireBaseline,windowId,done:()=>emit({event:'driver-done',scope,ok:true})};
  },
  async run(targetWindow, observerLogPath) {
    const c=await this.context(targetWindow,observerLogPath,'gc-debug-coverage');
    const {Cu,target,emit,read,source,finish,testing}=c;
    const {addDebuggerToGlobal}=ChromeUtils.importESModule('resource://gre/modules/jsdebugger.sys.mjs');addDebuggerToGlobal(globalThis);
    const before=await read();c.requireBaseline(before);emit({event:'gc-start',source:source('sum'),api:'Components.utils.forceGC',beforeBytes:before.length});
    Cu.forceGC();
    const results=Array.from({length:16},()=>target.njs_sum());
    if(results.some(r=>r!==8386560))throw Error('post-GC semantics');
    emit({event:'gc-cleanup',state:testing.gcstate()});if(testing.gcstate()!=='NotActive')throw Error('whole GC remained active');
    await finish(before,'gc-done',{source:source('sum'),results});
    for(const name of ['sum','debugFresh']) {
      const before=await read(),dbg=new Debugger();let result,breaks=0,steps=0,locals=[],breakpointCount;
      try {
        const global=dbg.addDebuggee(target),script=global.getOwnPropertyDescriptor('njs_'+name).value.script;
        if(script?.url!==source(name))throw Error('debugger source');
        const bp=script.getPossibleBreakpoints()[0];if(!bp)throw Error('actual breakpoint missing');
        script.setBreakpoint(bp.offset,{hit(frame){breaks++;frame.onStep=function(){steps++;if(locals.length<32){const i=this.environment?.getVariable('i'),s=this.environment?.getVariable('s');if(typeof i==='number'&&typeof s==='number')locals.push({i,s});}if(steps>=64)this.onStep=undefined;};}});
        emit({event:'debug-start',name,source:script.url,offset:bp.offset,beforeBytes:before.length});
        result=global.executeInGlobal('njs_'+name+'()');
        if(result?.return!==8386560||breaks<1||steps<1||!locals.length)throw Error('debugger semantic/break/step/local failure');
        script.clearAllBreakpoints();breakpointCount=script.getBreakpoints().length;
      } finally {dbg.removeAllDebuggees();emit({event:'debug-cleanup',name,breakpointCount,debuggeeCount:dbg.getDebuggees().length});}
      await finish(before,'debug-done',{name,source:source(name),result:result.return,breaks,steps,locals});
    }
    const coverageBefore=await read(),dbg=new Debugger();let result,offsets;
    try {
      dbg.collectCoverageInfo=true;const global=dbg.addDebuggee(target),script=global.getOwnPropertyDescriptor('njs_coverage').value.script;
      if(script?.url!==source('coverage'))throw Error('coverage source');
      emit({event:'coverage-start',source:script.url,collectCoverageInfo:dbg.collectCoverageInfo,beforeBytes:coverageBefore.length});
      result=global.executeInGlobal('njs_coverage()');offsets=script.getOffsetsCoverage();
      if(result?.return!==8386560||!offsets?.some(o=>o.count>0))throw Error('coverage semantic/count failure');
    } finally {dbg.collectCoverageInfo=false;dbg.removeAllDebuggees();emit({event:'coverage-cleanup',debuggeeCount:dbg.getDebuggees().length,collectCoverageInfo:dbg.collectCoverageInfo});}
    await finish(coverageBefore,'coverage-done',{source:source('coverage'),result:result.return,offsets});c.done();
  },
  async incremental(targetWindow, observerLogPath) {
    const c=await this.context(targetWindow,observerLogPath,'incremental');const {target,emit,read,source,finish,testing}=c;
    const before=await read();c.requireBaseline(before);const active=new Set(['Prepare','MarkRoots','Mark','Sweep','Finalize','Compact','Decommit','Finish']);let beforeState,afterState,result,started=false;
    emit({event:'incremental-start',source:source('sum'),api:'Cu.getJSTestingFunctions().startgc',workBudget:1,beforeBytes:before.length,initialState:testing.gcstate()});
    try {
      started=true;testing.startgc(1);beforeState=testing.gcstate();if(!active.has(beforeState))throw Error('no active incremental state before loop: '+beforeState);
      result=target.njs_sum();afterState=testing.gcstate();if(result!==8386560||!active.has(afterState))throw Error('incremental state/semantics after loop: '+afterState);
      emit({event:'incremental-loop-done',beforeState,afterState,result});
    } finally {if(started){testing.finishgc();emit({event:'incremental-cleanup',state:testing.gcstate(),ownedGCcleanup:true});}}
    if(testing.gcstate()!=='NotActive')throw Error('incremental cleanup failed');
    await finish(before,'incremental-done',{source:source('sum'),beforeState,afterState,result});c.done();
  },
  async sliceGC(targetWindow, observerLogPath) {
    const c=await this.context(targetWindow,observerLogPath,'slice-gc');const {target,emit,read,source,finish,testing}=c,before=await read();c.requireBaseline(before);let started=false;
    emit({event:'slice-start',source:source('sum'),api:'Cu.getJSTestingFunctions().startgc/gcslice/finishgc',workBudget:1,beforeBytes:before.length,initialState:testing.gcstate()});
    try {started=true;testing.startgc(1);testing.gcslice(1,{dontStart:true});emit({event:'slice-state',state:testing.gcstate(),sliceWorkBudget:1});}
    finally {if(started){testing.finishgc();emit({event:'slice-cleanup',state:testing.gcstate(),ownedGCcleanup:true});}}
    if(testing.gcstate()!=='NotActive')throw Error('slice GC cleanup failed');
    const results=Array.from({length:16},()=>target.njs_sum());if(results.some(r=>r!==8386560))throw Error('slice semantics');
    await finish(before,'slice-done',{source:source('sum'),results});c.done();
  },
  async interrupt(targetWindow, observerLogPath) {
    const c=await this.context(targetWindow,observerLogPath,'interrupt');const {target,emit,read,source,finish}=c,before=await read();c.requireBaseline(before);
    const names=['dom.max_script_run_time','dom.always_stop_slow_scripts','dom.global_stop_script'];
    const old=names.map(name=>({name,user:Services.prefs.prefHasUserValue(name),value:name===names[0]?Services.prefs.getIntPref(name):Services.prefs.getBoolPref(name)}));let elapsedMs;
    try {
      Services.prefs.setIntPref(names[0],1);Services.prefs.setBoolPref(names[1],true);Services.prefs.setBoolPref(names[2],false);
      emit({event:'interrupt-start',source:source('infinite'),beforeBytes:before.length,timeoutSeconds:1,globalStopScript:false});
      target.nightlyInterruptRecovered=undefined;const script=target.document.createElement('script');
      script.textContent='setTimeout(function(){ njs_infinite(); },0); setTimeout(function(){globalThis.nightlyInterruptRecovered=njs_sum();},0);';
      target.document.documentElement.appendChild(script);script.remove();const start=Date.now();
      while(target.nightlyInterruptRecovered!==8386560){if(Date.now()-start>15000)throw Error('bounded same-window recovery timeout');await new Promise(r=>setTimeout(r,100));}elapsedMs=Date.now()-start;
    } finally {
      for(const pref of old){if(!pref.user)Services.prefs.clearUserPref(pref.name);else if(pref.name===names[0])Services.prefs.setIntPref(pref.name,pref.value);else Services.prefs.setBoolPref(pref.name,pref.value);}
      const restored=old.every(pref=>Services.prefs.prefHasUserValue(pref.name)===pref.user&&(pref.name===names[0]?Services.prefs.getIntPref(pref.name):Services.prefs.getBoolPref(pref.name))===pref.value);
      emit({event:'interrupt-cleanup',prefsRestored:restored});if(!restored)throw Error('interrupt pref cleanup');
    }
    await finish(before,'interrupt-done',{source:source('infinite'),result:target.nightlyInterruptRecovered,elapsedMs,recoveryWindowId:String(targetWindow.windowGlobalChild?.innerWindowId)});c.done();
  }
};
