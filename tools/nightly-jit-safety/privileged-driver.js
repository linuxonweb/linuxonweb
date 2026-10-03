/* Load in the *guest* Browser Console after the page's main fixture completes.
 * This is an unverified driver preparation, never a guest result by itself.
 * Requires a directly accessible content window; remote windows are refused.
 * Usage: await NightlySafetyDriver.run(actualContentWindow)
 */
globalThis.NightlySafetyDriver = {
  async run(targetWindow) {
    const Services = globalThis.Services;
    if (!Services?.appinfo) throw Error('actual privileged Services global required');
    const { addDebuggerToGlobal } = ChromeUtils.importESModule('resource://gre/modules/jsdebugger.sys.mjs');
    addDebuggerToGlobal(globalThis);
    const Cu = Components.utils;
    const target = Cu.waiveXrays(targetWindow);
    if (!target || !target.nightlySafetyMainDone || !target.njs_sum) {
      throw Error('requires actual completed, accessible guest fixture content window; remote actor automation remains pending');
    }
    const label = target.nightlySafetyLabel;
    const emit = o => console.log('NJS_PRIV '+JSON.stringify({label,...o}));
    emit({event:'identity',applicationBuildID:Services.appinfo.appBuildID,platformBuildID:Services.appinfo.platformBuildID,version:Services.appinfo.version});
    emit({event:'gc-start',api:'Components.utils.forceGC'});
    Cu.forceGC();
    if (target.njs_sum() !== 8386560) throw Error('post-forceGC result');
    emit({event:'gc-done',result:8386560,epochProof:'requires actual observer gc-evict/install/run records'});
    for (const name of ['sum','debugFresh']) {
      const dbg = new Debugger();
      try {
        const global = dbg.addDebuggee(target);
        const fn = global.getOwnPropertyDescriptor('njs_'+name).value;
        const script = fn.script;
        if (!script?.url?.includes(label+'-main-'+name+'.js')) throw Error('unexpected target source');
        let breaks=0,steps=0,locals=[];
        const bp = script.getPossibleBreakpoints()[0];
        if (!bp) throw Error('no actual breakpoint offset');
        script.setBreakpoint(bp.offset,{hit(frame){breaks++;frame.onStep=function(){steps++;if(locals.length<32){const i=this.environment?.getVariable('i');const s=this.environment?.getVariable('s');if(typeof i==='number'&&typeof s==='number')locals.push({i,s});}if(steps>=64)this.onStep=undefined;};}});
        emit({event:'debug-start',name,url:script.url,offset:bp.offset,attached:true});
        const result=global.executeInGlobal('njs_'+name+'()');
        if (result?.return!==8386560 || breaks<1 || steps<1 || !locals.length) throw Error('actual debugger break/step/local/result failure');
        emit({event:'debug-done',name,result:result.return,breaks,steps,locals});
        script.clearAllBreakpoints();
      } finally {dbg.removeAllDebuggees();}
    }
    const dbg = new Debugger();
    try {
      dbg.collectCoverageInfo=true;
      const global=dbg.addDebuggee(target);
      const script=global.getOwnPropertyDescriptor('njs_coverage').value.script;
      emit({event:'coverage-start',url:script.url,collectCoverageInfo:dbg.collectCoverageInfo});
      const result=global.executeInGlobal('njs_coverage()');
      const offsets=script.getOffsetsCoverage();
      if(result?.return!==8386560||!offsets?.some(o=>o.count>0))throw Error('missing real nonzero coverage');
      emit({event:'coverage-done',result:result.return,offsets});
    } finally {dbg.removeAllDebuggees();}
    emit({event:'driver-done',ok:true,incrementalGC:'separate optional operation; unverified',interruption:'pending verified slow-script driver',nativeTLSStack:'pending native probes'});
  },
  // Separate optional operation before Debugger/coverage. The caller must tee
  // actual Firefox stderr into this guest file, with complete unrotated logs.
  // No supplied manifest or elapsed/allocation heuristic establishes GC state.
  async incremental(targetWindow, observerLogPath) {
    const Cu=Components.utils;
    const target=Cu.waiveXrays(targetWindow);
    if(!target?.nightlySafetyMainDone||!target.njs_sum)throw Error('direct same-process fixture content window required');
    const label=target.nightlySafetyLabel;
    const prefix='/home/admin/nightly-jit-safety/'+label+'/';
    if(typeof observerLogPath!=='string'||!observerLogPath.startsWith(prefix)||observerLogPath.includes('/../'))throw Error('owned absolute guest stderr log path required');
    Cu.importGlobalProperties(['IOUtils']);
    const io=globalThis.IOUtils;
    if(!io?.read)throw Error('actual privileged IOUtils required');
    const emit=o=>console.log('NJS_PRIV '+JSON.stringify({label,...o}));
    const source='file://'+prefix+label+'-main-sum.js';
    const decode=bytes=>new TextDecoder().decode(bytes);
    const read=async()=>{const bytes=await io.read(observerLogPath,{maxBytes:2097153});if(bytes.length>2097152)throw Error('bounded raw observer log exceeds 2MiB');return decode(bytes);};
    const observations=raw=>raw.split('\n').map((line,index)=>({line,index})).filter(o=>o.line.startsWith('PBLJIT_OBS ')).map(({line,index})=>({index,...Object.fromEntries([...line.matchAll(/(\w+)=([^\s]+)/g)].map(m=>[m[1],m[2]]))})).filter(o=>o.file===source&&o.line==='1');
    const integer=(value,min,max)=>/^-?\d+$/.test(value||'')&&BigInt(value)>=min&&BigInt(value)<=max;
    const identity=o=>integer(o.tid,1n,4294967295n)&&/^0x[0-9a-f]+$/i.test(o.tls||'')&&BigInt(o.tls)>0n&&BigInt(o.tls)<4294967296n&&integer(o.epoch,0n,18446744073709551615n);
    const output=o=>integer(o.fn,1n,4294967295n)&&integer(o.sp,1n,4294967295n)&&integer(o.pcDelta,-2147483648n,2147483647n)&&integer(o.ic,0n,4294967295n);
    let testing,started=false;
    try {
      const before=await read();
      const prior=observations(before);
      const install=prior.find(i=>i.event==='install'&&identity(i)&&integer(i.fn,1n,4294967295n)&&i.kind==='-1'&&prior.some(r=>r.index>i.index&&r.event==='run'&&r.kind==='1'&&identity(r)&&output(r)&&['tid','tls','epoch','fn'].every(k=>i[k]===r[k])));
      if(!install)throw Error('missing actual source-specific pre-GC install/run identity');
      testing=Cu.getJSTestingFunctions();
      for(const name of ['startgc','gcstate','finishgc'])if(typeof testing[name]!=='function')throw Error('current Cu testing API unavailable: '+name);
      if(testing.gcstate()!=='NotActive')throw Error('requires initially inactive GC');
      emit({event:'incremental-start',api:'Cu.getJSTestingFunctions().startgc',workBudget:1,source,observerLogPath});
      // Exact current API uses a WorkBudget; no unbounded slice or retry.
      const active=new Set(['Prepare','MarkRoots','Mark','Sweep','Finalize','Compact','Decommit','Finish']);
      let beforeState,afterState,result;
      started=true;
      try {
        testing.startgc(1);
        beforeState=testing.gcstate();
        if(!active.has(beforeState))throw Error('no actual active incremental state before fixture loop: '+beforeState);
        result=target.njs_sum();
        afterState=testing.gcstate();
        if(result!==8386560||!active.has(afterState))throw Error('incremental state/result not retained across fixture loop: '+afterState);
        emit({event:'incremental-loop-done',beforeState,afterState,result});
      } finally {
        // Finish owned GC before asynchronous file I/O can start another GC.
        testing.finishgc();started=false;
        emit({event:'incremental-cleanup',state:testing.gcstate()});
      }
      if(testing.gcstate()!=='NotActive')throw Error('finishgc did not restore inactive state');
      const after=await read();
      if(!after.startsWith(before))throw Error('raw guest observer log rotated or changed');
      const during=observations(after.slice(before.length));
      const skip=during.find(o=>o.event==='skip-incremental'&&identity(o)&&o.tid===install.tid&&o.tls===install.tls&&o.fn==='0'&&o.kind==='-1');
      if(!skip||during.some(o=>['install','run','bail','noentry'].includes(o.event)))throw Error('missing real source-specific incremental skip or forbidden specializer entry');
      emit({event:'incremental-done',ok:true,beforeState,afterState,result,source,observerLogPath,rawBeforeCharacters:before.length,rawAfterCharacters:after.length,skip});
    } catch(error) {
      emit({event:'incremental-error',error:String(error)});
      throw error;
    } finally {
      if(started&&testing){try{testing.finishgc();emit({event:'incremental-cleanup',state:testing.gcstate()});}catch(error){emit({event:'incremental-cleanup-error',error:String(error)});throw error;}}
    }
  },
  // Opt-in separate operation. Actual content timer runs without a Debugger.
  // Browser slow-script machinery terminates through its interrupt callback.
  // Requires observer install+interrupt and same-process recovery evidence.
  async interrupt(targetWindow) {
    const Services = globalThis.Services;
    if (!Services?.prefs) throw Error('actual privileged Services global required');
    const target=Components.utils.waiveXrays(targetWindow);
    if(!target?.nightlySafetyMainDone||!target.njs_infinite)throw Error('fixture content window required');
    const names=['dom.max_script_run_time','dom.always_stop_slow_scripts'];
    const old=names.map(name=>({name,user:Services.prefs.prefHasUserValue(name),value:name===names[0]?Services.prefs.getIntPref(name):Services.prefs.getBoolPref(name)}));
    const emit=o=>console.log('NJS_PRIV '+JSON.stringify({label:target.nightlySafetyLabel,...o}));
    Services.prefs.setIntPref(names[0],1);
    Services.prefs.setBoolPref(names[1],true);
    try {
      emit({event:'interrupt-start',api:'browser slow-script interrupt callback',timeoutSeconds:1});
      target.nightlyInterruptRecovered=undefined;
      // A real content event evaluates the loop. No terminate/VM kill surrogate.
      const script=target.document.createElement('script');
      script.textContent='setTimeout(function(){ njs_infinite(); },0); setTimeout(function(){globalThis.nightlyInterruptRecovered=njs_sum();},0);';
      target.document.documentElement.appendChild(script);script.remove();
      const start=Date.now();
      while(target.nightlyInterruptRecovered!==8386560){if(Date.now()-start>15000)throw Error('bounded same-page recovery timeout');await new Promise(r=>setTimeout(r,100));}
      emit({event:'interrupt-done',result:target.nightlyInterruptRecovered,elapsedMs:Date.now()-start,sameContentWindow:true});
    } finally {
      for(const pref of old){if(!pref.user)Services.prefs.clearUserPref(pref.name);else if(pref.name===names[0])Services.prefs.setIntPref(pref.name,pref.value);else Services.prefs.setBoolPref(pref.name,pref.value);}
    }
  }
};
