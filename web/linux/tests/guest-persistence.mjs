// Run only against a task-owned Chromium profile with remote debugging enabled.
// node web/linux/tests/guest-persistence.mjs (CDP_URL, APP_URL, TEST_OUTPUT optional)
import {writeFile, mkdir} from 'node:fs/promises';
const cdp = process.env.CDP_URL || 'http://127.0.0.1:9394';
const app = process.env.APP_URL || 'http://127.0.0.1:4180/linux/index.html';
const output = process.env.TEST_OUTPUT || '/tmp/linuxonweb-storage-test';
await mkdir(output, {recursive:true});
const marker='persistent-home-qa-'+Date.now(), report={marker,stages:[],errors:[]};
const save=()=>writeFile(output + '/guest-persistence.json',JSON.stringify(report,null,2));
const page=await (await fetch(cdp + '/json/new?about:blank',{method:'PUT'})).json();report.tab=page.id;
const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let id=0,loaded;const pending=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(m.error):p?.resolve(m.result);}else if(m.method==='Page.loadEventFired')loaded?.();else if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params.exceptionDetails);};
const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;}
async function navigate(reload=false){const load=new Promise(r=>loaded=r);await call(reload?'Page.reload':'Page.navigate',reload?{}:{url:app});await load;await evaluate(`(async()=>{window.__qaModule=await import('./main.js');window.__qaAssets=await import('./boot-assets.mjs');const Original=globalThis.Terminal;globalThis.Terminal=class extends Original{constructor(...args){super(...args);window.__qaTerminal=this;}};return document.querySelector('#status').textContent;})()`);}
async function state(){return evaluate(`({status:document.querySelector('#status').textContent,logs:window.__qaModule.guestLogs.history.page(undefined,120).map(x=>x.text).join(String.fromCharCode(10)).replaceAll(String.fromCharCode(13),''),storage:document.querySelector('#storage-message')?.textContent,cacheWarning:document.querySelector('#storage-cache-warning')?.textContent,cache:window.__qaAssets?.assetCacheDiagnostics?.(),resources:performance.getEntriesByType('resource').filter(e=>/initramfs|vmlinux/.test(e.name)).map(e=>({name:e.name,duration:e.duration,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize})),timeSinceNavigation:performance.now()})`);}
async function waitFor(label,needle,ms=90000){const start=Date.now();for(;;){const s=await state();report.last=s;if(report.errors.length||s.status.startsWith('stopped:')||s.status==='boot failed'||s.logs.includes('home: FAILED'))throw Error(label+' guest error: '+JSON.stringify(s));if(s.logs.includes(needle)){report.stages.push({label,elapsedMs:Date.now()-start,...s});await save();console.log(label+' PASS '+(Date.now()-start)+'ms');return s;}if(Date.now()-start>ms)throw Error(label+' timed out: '+JSON.stringify(s));await new Promise(r=>setTimeout(r,500));}}
try{
await call('Page.enable');await call('Runtime.enable');await navigate();
await call('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{let Terminal;Object.defineProperty(globalThis,'Terminal',{configurable:true,get(){return Terminal;},set(Original){Terminal=class extends Original{constructor(...args){super(...args);globalThis.__qaTerminal=this;}};}});})()`});
if (process.env.RESET_TEST_SYSTEM === '1') { await evaluate(`localStorage.removeItem('linuxonweb.system.active.v1'); localStorage.removeItem('linuxonweb.system.previous.v1')`); await navigate(true); }
await evaluate(`document.querySelector('#start-console').click()`);await waitFor('first mount','home: persistent storage mounted');
await waitFor('first shell','~ #');
const write=`echo '${marker}' > /home/admin/${marker}.txt; sync; echo __WRITE_BEGIN__; cat /home/admin/${marker}.txt; grep ' /home ' /proc/mounts; echo __WRITE_DONE__\r`;
await evaluate(`window.__qaTerminal.paste(${JSON.stringify(write)})`);const wrote=await waitFor('guest write','\n__WRITE_DONE__',20000);if(!wrote.logs.includes('\n'+marker+'\n')||!wrote.logs.includes('virtiofs'))throw Error('missing exact saved bytes or mount evidence');
await navigate(true);await evaluate(`document.querySelector('#start-console').click()`);await waitFor('second mount','home: persistent storage mounted');await waitFor('second shell','~ #');
const read=`echo __READ_BEGIN__; cat /home/admin/${marker}.txt; grep ' /home ' /proc/mounts; echo __READ_DONE__\r`;
await evaluate(`window.__qaTerminal.paste(${JSON.stringify(read)})`);const readback=await waitFor('guest reload read','\n__READ_DONE__',20000);if(!readback.logs.includes('\n'+marker+'\n'))throw Error('exact marker missing after reload');
if(process.env.ASSERT_WARM_CACHE === '1' && readback.resources.length) throw Error('Warm boot downloaded a system image: '+JSON.stringify(readback.resources));
if(process.env.TEST_UPDATE === '1') {
  const reload = new Promise(resolve => loaded=resolve);
  await evaluate(`document.querySelector('[data-storage="update"]').click()`);
  let timeout;
  try { await Promise.race([reload,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Update & restart did not refresh within 120s')),120000);})]); }
  finally { clearTimeout(timeout); }
  await evaluate(`(async()=>{window.__qaModule=await import('./main.js');window.__qaAssets=await import('./boot-assets.mjs');return true;})()`);
  await waitFor('updated mount','home: persistent storage mounted');await waitFor('updated shell','~ #');
  const updatedRead=`echo __UPDATE_BEGIN__; cat /home/admin/${marker}.txt; echo __UPDATE_DONE__\r`;
  await evaluate(`window.__qaTerminal.paste(${JSON.stringify(updatedRead)})`);
  const afterUpdate=await waitFor('guest update read','\n__UPDATE_DONE__',20000);
  if(!afterUpdate.logs.includes('\n'+marker+'\n'))throw Error('saved bytes missing after system update');
}
report.pass=true;
await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await evaluate(`document.querySelector('.storage-panel').scrollIntoView({block:'center'})`);const desktop=await call('Page.captureScreenshot',{format:'png'});await writeFile(output + '/desktop.png',Buffer.from(desktop.data,'base64'));
await call('Emulation.setDeviceMetricsOverride',{width:430,height:932,deviceScaleFactor:1,mobile:true});await evaluate(`document.querySelector('.storage-panel').scrollIntoView({block:'center'})`);const mobile=await call('Page.captureScreenshot',{format:'png'});await writeFile(output + '/mobile.png',Buffer.from(mobile.data,'base64'));
await call('Emulation.clearDeviceMetricsOverride');await save();console.log(JSON.stringify({pass:true,marker,tab:page.id,stages:report.stages.map(s=>({label:s.label,elapsedMs:s.elapsedMs})),logs:readback.logs.slice(-3000)}));
}catch(error){report.pass=false;report.failure=String(error.stack||error);await save();console.error(JSON.stringify(report));process.exitCode=1;}finally{ws.close();if(process.env.KEEP_TEST_TAB !== '1') await fetch(cdp + '/json/close/' + page.id);}
