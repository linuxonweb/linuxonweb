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
    emit({event:'driver-done',ok:true,incrementalGC:'pending verified driver',interruption:'pending verified slow-script driver',nativeTLSStack:'pending native probes'});
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
