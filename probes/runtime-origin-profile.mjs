// Test-only CDP observation. Never edits runtime assets or enables Debugger.
import { mkdir, writeFile, open } from 'node:fs/promises';
import { join } from 'node:path';

const [origin,label,directory,endpoint='http://127.0.0.1:9394'] = process.argv.slice(2);
if (!origin || !/^[a-z0-9_-]+$/i.test(label||'') || !directory) throw new Error('usage: node probes/runtime-origin-profile.mjs ORIGIN LABEL OUTPUT_DIRECTORY [CDP_URL]');
await mkdir(directory,{recursive:true});
const started=Date.now(), deadline=started+120000;
const report={label,origin,startedAt:new Date().toISOString(),events:[],network:[],workers:[],errors:[],observer:'constructor/import timing + Atomics timing; no Debugger or CPU profiler'};
const browser=await(await fetch(endpoint+'/json/version')).json();report.browser=browser.Browser;
const socket=new WebSocket(browser.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let next=0,targetId,page,traceStarted=false,traceHandle;
const pending=new Map(),sessions=new Map(),network=new Map();
function call(method,params={},sessionId,timeout=12000){
  return new Promise((resolve,reject)=>{
    const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timeout'));},timeout);
    pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(new Error(method+': '+JSON.stringify(error)));}});
    socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
}
function instrumentation(){
  if(globalThis.__runtimeOriginProbe)return;
  const start=performance.now(),stats={},emit=(kind,data={})=>{
    try{globalThis.__runtimeOriginReport(JSON.stringify({kind,at:performance.timeOrigin+performance.now(),elapsed:performance.now()-start,...data}));}catch{}
  };
  globalThis.__runtimeOriginProbe={stats,flush:()=>emit('stats',{stats})};
  emit('features',{url:location.href,origin:location.origin,name:globalThis.name||'',crossOriginIsolated,secureContext:isSecureContext,
    suspending:typeof WebAssembly.Suspending,promising:typeof WebAssembly.promising,waitAsync:typeof Atomics.waitAsync,
    visibility:globalThis.document?.visibilityState??null,hardwareConcurrency:navigator.hardwareConcurrency});
  const summarize=(name,duration)=>{const s=stats[name]??={count:0,totalMs:0,maxMs:0};s.count++;s.totalMs+=duration;s.maxMs=Math.max(s.maxMs,duration);};
  const stageNeedles={kernel:'Linux version',unpack:'Unpacking initramfs',freeInitrd:'Freeing initrd',init:'Run /init',mount:'home: persistent storage mounted',network:'network: eth0'};
  const stages=new Set();
  function imports(original){
    if(!original)return original;
    const result={...original};
    for(const namespace of ['kernel','user','linux']){
      if(!original[namespace])continue;
      result[namespace]={...original[namespace]};
      for(const [name,fn] of Object.entries(original[namespace])){
        if(typeof fn!=='function')continue;
        if(name==='boot_console_write'){
          result[namespace][name]=function(...args){
            try{
              const memory=original.env?.memory;
              if(memory&&typeof args[0]==='number'){
                const text=new TextDecoder().decode(new Uint8Array(memory.buffer,args[0]>>>0,Math.min(args[1]>>>0,8192)));
                for(const [key,needle] of Object.entries(stageNeedles))if(!stages.has(key)&&text.includes(needle)){stages.add(key);emit('guest-stage',{stage:key});}
              }
            }catch{}
            return Reflect.apply(fn,this,args);
          };continue;
        }
        if(name==='syscall'){
          let count=0;
          result[namespace][name]=function(...args){
            count++;if((count&127)!==0)return Reflect.apply(fn,this,args);
            const begin=performance.now();try{return Reflect.apply(fn,this,args);}finally{summarize('syscall-sampled-1-in-128',performance.now()-begin);if((count&4095)===0)emit('stats',{stats,syscallCalls:count});}
          };continue;
        }
        if(!['compile_begin','compile_end','instantiate','spawn_worker'].includes(name))continue;
        result[namespace][name]=function(...args){
          const begin=performance.now();emit('import-start',{name:namespace+'.'+name,firstArg:typeof args[0]==='number'?args[0]:null});
          try{return Reflect.apply(fn,this,args);}finally{emit('import-end',{name:namespace+'.'+name,durationMs:performance.now()-begin});}
        };
      }
    }
    return result;
  }
  for(const name of ['Module','Instance']){
    const Original=WebAssembly[name];
    WebAssembly[name]=new Proxy(Original,{construct(target,args){
      const begin=performance.now(),kind=name==='Module'?'compile-sync':'instance-sync';
      const data=name==='Module'?{bytes:args[0]?.byteLength??null}:{imports:Object.keys(args[1]||{})};
      emit(kind+'-start',data);
      if(name==='Instance')args=[args[0],imports(args[1])];
      try{return Reflect.construct(target,args);}finally{emit(kind+'-end',{...data,durationMs:performance.now()-begin});}
    }});
  }
  for(const name of ['compile','compileStreaming','instantiate','instantiateStreaming']){
    const original=WebAssembly[name];
    if(typeof original!=='function')continue;
    WebAssembly[name]=function(...args){
      const begin=performance.now();emit(name+'-start');
      if(name.startsWith('instantiate'))args=[args[0],imports(args[1]),...args.slice(2)];
      return Reflect.apply(original,this,args).then(value=>{emit(name+'-end',{durationMs:performance.now()-begin});return value;},error=>{emit(name+'-error',{durationMs:performance.now()-begin,error:String(error)});throw error;});
    };
  }
  const originalWait=Atomics.wait;
  Atomics.wait=function(...args){const begin=performance.now();try{return Reflect.apply(originalWait,this,args);}finally{const durationMs=performance.now()-begin;summarize('Atomics.wait',durationMs);if(durationMs>5)emit('atomic-wait',{durationMs,timeout:args[3]??null});}};
  if(typeof globalThis.Worker==='function'){
    const Original=globalThis.Worker;
    globalThis.Worker=new Proxy(Original,{construct(target,args){emit('worker-create',{url:String(args[0]),name:args[1]?.name??null});return Reflect.construct(target,args);}});
  }
  setInterval(()=>emit('stats',{stats}),1000);
}
const source='('+instrumentation.toString()+')()';
socket.onmessage=event=>{
  const message=JSON.parse(event.data);
  if(message.id){const p=pending.get(message.id);pending.delete(message.id);if(p)message.error?p.reject(message.error):p.resolve(message.result);return;}
  const {method,params={},sessionId}=message;
  if(method==='Target.attachedToTarget'&&params.targetInfo?.type==='worker'){
    const session=params.sessionId;
    const worker={session,...params.targetInfo,attachedAt:Date.now(),hookLimitation:'Resume precedes evaluation; first constructor may race instrumentation'};
    sessions.set(session,worker);report.workers.push(worker);
    void(async()=>{
      try{
        await call('Network.enable',{},session);
        await call('Runtime.enable',{},session);
        await call('Runtime.addBinding',{name:'__runtimeOriginReport'},session);
        // Evaluating while startup-paused deadlocks some worker globals.
        await call('Runtime.runIfWaitingForDebugger',{},session);worker.resumedAt=Date.now();
        const evaluated=await call('Runtime.evaluate',{expression:source},session,5000);worker.hookCompletedAt=Date.now();
        if(evaluated.exceptionDetails)report.errors.push({worker:params.targetInfo.url,injection:evaluated.exceptionDetails});
      }catch(error){worker.hookError=String(error);report.errors.push({worker:params.targetInfo.url,error:String(error)});}
      finally{if(!worker.resumedAt)await call('Runtime.runIfWaitingForDebugger',{},session,2000).catch(error=>report.errors.push(String(error)));}
    })();
  }else if(method==='Target.detachedFromTarget'){
    const worker=sessions.get(params.sessionId);if(worker)worker.detachedAt=Date.now();
  }else if(method==='Runtime.bindingCalled'&&params.name==='__runtimeOriginReport'){
    if(report.events.length<12000)try{report.events.push({session:sessionId,...JSON.parse(params.payload)});}catch{}
  }else if(method==='Network.requestWillBeSent'){
    network.set(sessionId+':'+params.requestId,{session:sessionId,id:params.requestId,url:params.request.url,type:params.type,start:params.timestamp,wallTime:params.wallTime,initiator:params.initiator?.type});
  }else if(method==='Network.responseReceived'){
    const row=network.get(sessionId+':'+params.requestId);if(row)Object.assign(row,{status:params.response.status,responseAt:params.timestamp,fromDiskCache:params.response.fromDiskCache,fromServiceWorker:params.response.fromServiceWorker,protocol:params.response.protocol});
  }else if(method==='Network.loadingFinished'||method==='Network.loadingFailed'){
    const key=sessionId+':'+params.requestId,row=network.get(key);if(row){Object.assign(row,{end:params.timestamp,durationMs:(params.timestamp-row.start)*1000,encodedDataLength:params.encodedDataLength,error:params.errorText});report.network.push(row);network.delete(key);}
  }else if(method==='Tracing.tracingComplete')traceHandle=params.stream;
  else if(method==='Runtime.exceptionThrown')report.errors.push({session:sessionId,exception:params.exceptionDetails});
};
async function evaluate(expression){const value=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},page,20000);if(value.exceptionDetails)throw new Error(JSON.stringify(value.exceptionDetails));return value.result.value;}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  await call('Tracing.start',{categories:'v8,wasm,disabled-by-default-v8.wasm,disabled-by-default-v8.compile,devtools.timeline,blink.user_timing,toplevel',transferMode:'ReturnAsStream',streamFormat:'json',options:'record-until-full'});traceStarted=true;
  ({targetId}=await call('Target.createTarget',{url:'about:blank'}));
  ({sessionId:page}=await call('Target.attachToTarget',{targetId,flatten:true}));
  await call('Page.enable',{},page);await call('Runtime.enable',{},page);await call('Network.enable',{},page);
  await call('Runtime.addBinding',{name:'__runtimeOriginReport'},page);
  await call('Page.addScriptToEvaluateOnNewDocument',{source},page);
  await call('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true},page);
  await call('Page.navigate',{url:new URL('/linux/index.html',origin).href},page);
  await call('Page.bringToFront',{},page);
  for(;;){if(Date.now()>deadline-10000)throw new Error('page readiness deadline');try{if(await evaluate("Boolean(document.querySelector('#start-console') && typeof Terminal==='function')"))break;}catch{}await sleep(250);}
  await evaluate(`(async()=>{
    const m=await import('./main.js');window.__profileModule=m;
    document.querySelector('#ram').value='1024';document.querySelector('#cpu-cores').value='2';document.querySelector('#resolution').value='1280x720';document.querySelector('#graphics-backend').value='canvas2d';
    document.querySelector('#ram').dispatchEvent(new Event('change'));
    if(!document.querySelector('#settings-apply').disabled){document.querySelector('#settings-apply').click();document.querySelector('#restart-continue').click();}
    window.__profileBoot={start:performance.now(),wallStart:performance.timeOrigin+performance.now(),visibility:document.visibilityState,settings:{ram:document.querySelector('#ram').value,cpus:document.querySelector('#cpu-cores').value},stages:{}};
    const history=m.guestLogs.history,write=history.write.bind(history);
    history.write=(...args)=>{write(...args);const text=history.page(undefined,20).map(row=>row.text).join(String.fromCharCode(10));
      for(const [key,needle]of Object.entries({kernel:'Linux version',unpack:'Unpacking initramfs',freeInitrd:'Freeing initrd',init:'Run /init',mount:'home: persistent storage mounted',network:'network: eth0',shell:'~ #'}))
        if(!(__profileBoot.stages[key]>=0)&&text.includes(needle))__profileBoot.stages[key]=performance.now()-__profileBoot.start;
    };
    document.querySelector('#start-console').click();return true;
  })()`);
  for(;;){
    report.boot=await evaluate("({...__profileBoot,elapsedMs:performance.now()-__profileBoot.start,visibilityNow:document.visibilityState,status:document.querySelector('#status').textContent,resources:performance.getEntriesByType('resource').map(e=>({name:e.name,startTime:e.startTime,duration:e.duration,transferSize:e.transferSize})),configurationEvidence:__profileModule.guestLogs.history.page(undefined,10000).map(row=>row.text).filter(text=>/boot mode=|Memory:|SMP|smp:|CPU[0-9]|processors activated|Kernel command line/.test(text)),tail:__profileModule.guestLogs.history.page(undefined,8).map(row=>row.text)})");
    if(report.boot.stages.shell>=0){report.pass=true;break;}
    if(Date.now()>deadline-10000)throw new Error('boot deadline');await sleep(500);
  }
}catch(error){report.pass=false;report.error=String(error);process.exitCode=1;}
finally{
  report.elapsedMs=Date.now()-started;report.inFlightNetwork=[...network.values()];
  await Promise.allSettled([...sessions.values()].filter(worker=>worker.hookError&&!worker.detachedAt).map(async worker=>{
    const result=await call('Runtime.evaluate',{expression:"({origin:location.origin,crossOriginIsolated,secureContext:isSecureContext,suspending:typeof WebAssembly.Suspending,promising:typeof WebAssembly.promising,waitAsync:typeof Atomics.waitAsync})",returnByValue:true},worker.session,1000);
    worker.postBootstrapFeatures=result.result?.value;
  }));
  // Terminate only our target before trace flush, releasing blocked worker tasks.
  if(targetId){await call('Target.closeTarget',{targetId},undefined,3000).catch(error=>report.errors.push(String(error)));targetId=null;}
  if(traceStarted){
    await call('Tracing.end',{},undefined,4000).catch(error=>report.errors.push(String(error)));
    for(let i=0;i<50&&!traceHandle;i++)await sleep(100);
    if(!traceHandle)report.errors.push('Trace stream not delivered after target closure and bounded flush');
    if(traceHandle){
      const file=await open(join(directory,label+'-trace.json'),'w');let total=0;
      try{for(;;){const chunk=await call('IO.read',{handle:traceHandle,size:1024*1024});const data=Buffer.from(chunk.data,chunk.base64Encoded?'base64':'utf8');await file.write(data);total+=data.length;if(chunk.eof)break;if(total>200*1024*1024){report.errors.push('trace exceeded 200MiB; truncated');break;}}}finally{await file.close();await call('IO.close',{handle:traceHandle}).catch(()=>{});}report.traceBytes=total;
    }
  }
  if(targetId)await call('Target.closeTarget',{targetId}).catch(()=>{});
  await writeFile(join(directory,label+'-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({label,pass:report.pass,boot:report.boot?.stages,workers:report.workers.length,events:report.events.length,network:report.network.length,error:report.error,errors:report.errors.length,traceBytes:report.traceBytes}));
  socket.close();
}
