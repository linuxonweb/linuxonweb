// Functional control: no worker attachment, hooks, startup pauses or tracing.
import { mkdir,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [origin,label,directory,endpoint='http://127.0.0.1:9394']=process.argv.slice(2);
if(!origin||!/^[a-z0-9_-]+$/i.test(label||'')||!directory)throw new Error('usage: node probes/runtime-origin-lean.mjs ORIGIN LABEL OUTPUT_DIRECTORY [CDP_URL]');
await mkdir(directory,{recursive:true});
const start=Date.now(),deadline=start+120000;
const report={schema:1,origin,label,startedAt:new Date().toISOString(),observer:'Page Network/Runtime and target discovery only; no worker attach, hooks, pause, tracing or profiler',workers:[],network:[],errors:[],consoleErrors:[]};
const browser=await(await fetch(endpoint+'/json/version')).json();report.browser=browser.Browser;
const socket=new WebSocket(browser.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
let next=0,targetId,page;const pending=new Map(),network=new Map();
function call(method,params={},sessionId,timeout=12000){return new Promise((resolve,reject)=>{
  const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(new Error(method+' timeout'));},timeout);
  pending.set(id,{resolve:result=>{clearTimeout(timer);resolve(result);},reject:error=>{clearTimeout(timer);reject(new Error(method+': '+JSON.stringify(error)));}});
  socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
});}
socket.onmessage=event=>{
  const message=JSON.parse(event.data);
  if(message.id){const p=pending.get(message.id);pending.delete(message.id);if(p)message.error?p.reject(message.error):p.resolve(message.result);return;}
  const {method,params={},sessionId}=message;
  if(method==='Target.targetCreated'||method==='Target.targetInfoChanged'){
    const info=params.targetInfo;if(info?.type==='worker'&&info.url.startsWith(origin+'/')&&!report.workers.some(row=>row.targetId===info.targetId))report.workers.push({...info,observedAt:Date.now()});
  }
  if(sessionId!==page)return;
  if(method==='Network.requestWillBeSent')network.set(params.requestId,{id:params.requestId,url:params.request.url,type:params.type,start:params.timestamp,wallTime:params.wallTime});
  else if(method==='Network.responseReceived'){
    const row=network.get(params.requestId);if(row)Object.assign(row,{status:params.response.status,fromDiskCache:params.response.fromDiskCache,fromServiceWorker:params.response.fromServiceWorker,cacheControl:params.response.headers['cache-control']??params.response.headers['Cache-Control']});
  }else if(method==='Network.loadingFinished'||method==='Network.loadingFailed'){
    const row=network.get(params.requestId);if(row){report.network.push({...row,durationMs:(params.timestamp-row.start)*1000,error:params.errorText,encodedDataLength:params.encodedDataLength});network.delete(params.requestId);}
  }else if(method==='Runtime.exceptionThrown')report.errors.push(params.exceptionDetails);
  else if(method==='Runtime.consoleAPICalled'&&params.type==='error')report.consoleErrors.push(params.args.map(arg=>String(arg.value??arg.description??'')).join(' ').slice(0,4096));
};
const save=()=>writeFile(join(directory,label+'-report.json'),JSON.stringify({...report,elapsedMs:Date.now()-start,inFlightNetwork:[...network.values()]},null,2)+'\n');
async function evaluate(expression,timeout=20000){
  report.pendingEvaluationAt=Date.now();await save();
  const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},page,timeout);
  delete report.pendingEvaluationAt;if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  await call('Target.setDiscoverTargets',{discover:true});
  ({targetId}=await call('Target.createTarget',{url:'about:blank'}));
  ({sessionId:page}=await call('Target.attachToTarget',{targetId,flatten:true}));
  await call('Page.enable',{},page);await call('Runtime.enable',{},page);await call('Network.enable',{},page);
  await call('Page.navigate',{url:new URL('/linux/index.html',origin).href},page);await call('Page.bringToFront',{},page);
  for(;;){if(Date.now()>deadline-25000)throw new Error('page readiness deadline');if(await evaluate("Boolean(document.querySelector('#start-console')&&typeof Terminal==='function')"))break;await sleep(250);}
  await evaluate(`(async()=>{
    const m=await import('./main.js');window.__leanModule=m;
    document.querySelector('#ram').value='1024';document.querySelector('#cpu-cores').value='2';document.querySelector('#resolution').value='1280x720';document.querySelector('#graphics-backend').value='canvas2d';document.querySelector('#ram').dispatchEvent(new Event('change'));
    if(!document.querySelector('#settings-apply').disabled){document.querySelector('#settings-apply').click();document.querySelector('#restart-continue').click();}
    window.__leanBoot={start:performance.now(),wallStart:performance.timeOrigin+performance.now(),visibility:document.visibilityState,stages:{}};
    const history=m.guestLogs.history,write=history.write.bind(history);
    history.write=(...args)=>{write(...args);const text=history.page(undefined,20).map(row=>row.text).join(String.fromCharCode(10));
      for(const[key,needle]of Object.entries({kernel:'Linux version',unpack:'Unpacking initramfs',freeInitrd:'Freeing initrd',init:'Run /init',mount:'home: persistent storage mounted',network:'network: eth0',shell:'~ #'}))if(!(__leanBoot.stages[key]>=0)&&text.includes(needle))__leanBoot.stages[key]=performance.now()-__leanBoot.start;
    };document.querySelector('#start-console').click();return true;
  })()`);
  for(;;){
    report.boot=await evaluate("({...__leanBoot,elapsedMs:performance.now()-__leanBoot.start,visibilityNow:document.visibilityState,status:document.querySelector('#status').textContent,crossOriginIsolated,secureContext:isSecureContext,configurationEvidence:__leanModule.guestLogs.history.page(undefined,10000).map(row=>row.text).filter(text=>/boot mode=|Memory:|SMP|smp:|CPU[0-9]|processors activated|Kernel command line/.test(text)),tail:__leanModule.guestLogs.history.page(undefined,20).map(row=>row.text)})");
    await save();if(report.boot.stages.shell>=0){report.pass=true;break;}
    if(Date.now()>deadline-25000)throw new Error('boot deadline');await sleep(500);
  }
}catch(error){report.pass=false;report.error=String(error);process.exitCode=1;}
finally{
  await save();
  if(targetId)await call('Target.closeTarget',{targetId},undefined,3000).catch(error=>report.errors.push(String(error)));
  await call('Target.setDiscoverTargets',{discover:false},undefined,3000).catch(()=>{});
  await save();console.log(JSON.stringify({label,pass:report.pass,boot:report.boot?.stages,workers:report.workers.length,network:report.network.length,errors:report.errors.length,error:report.error}));socket.close();
}
