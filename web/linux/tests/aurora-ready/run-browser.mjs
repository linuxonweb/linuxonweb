// Node 22+, attached to task-owned Chromium. Owns/closes only its newly created tab.
import fs from 'node:fs/promises';
import path from 'node:path';

const task = '/mnt/p6/build/aurora-ready-20260926/';
const out = path.resolve(process.env.AURORA_QA_OUT || '.');
const scratch = path.resolve(process.env.TMPDIR || '.');
if (!out.startsWith(task) || !scratch.startsWith(task)) throw Error('AURORA_QA_OUT and TMPDIR must be below ' + task);
await fs.mkdir(out); // Fresh evidence, never overwrite a previous run.
const cdp = process.env.CDP_URL || 'http://127.0.0.1:9396';
const app = process.env.AURORA_QA_URL || 'http://127.0.0.1:4182/linux/tests/aurora-ready/index.html';
const request = (url, options={}) => fetch(url, {...options, signal:AbortSignal.timeout(5000)});
let target, ws, id = 0;
const pending = new Map();
const report = {pass:false, startedAt:new Date().toISOString(), events:[], consoleMessages:[], consoleMessagesDropped:0, checks:[], stages:{}};
const save = () => fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
const started = Date.now();
let finished = false;
// Independent Node watchdog also works when the guest's signal timer or page is stuck.
const watchdog = setTimeout(async () => {
  if (finished) return;
  report.pass=false; report.error='independent host watchdog: 150 seconds';
  await save().catch(()=>{});
  ws?.close();
  if (target) await request(`${cdp}/json/close/${target.id}`).catch(()=>{});
  process.exit(1);
},150000);
function call(method, params={}) {
  return new Promise((resolve,reject)=>{
    const seq=++id;
    const timer=setTimeout(()=>{pending.delete(seq);reject(Error('CDP timeout: '+method));},10000);
    pending.set(seq,{resolve,reject,timer});
    ws.send(JSON.stringify({id:seq,method,params}));
  });
}
async function evaluate(expression) {
  const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
function check(label, pass, detail) {
  report.checks.push({label,pass,detail});
  if (!pass) throw Error('acceptance failed: '+label);
}
function validate(guest) {
  const lines=guest.lines;
  check('isolated, visible page with no guest errors',guest.isolated && guest.configuration.visibility==='visible' && guest.errors.length===0);
  check('accepted Firefox requested memory and CPU configuration',guest.configuration.memoryBytes===0xffff0000 && guest.configuration.cpus===2,guest.configuration);
  const evidence=[...(guest.bootConfigurationEvidence||[]).map(line=>line.text),...lines.map(line=>line.text),...report.consoleMessages.map(message=>message.text)];
  const memory=evidence.flatMap(text=>[...text.matchAll(/Memory:\s*\d+K\/(\d+)K/g)].map(match=>({line:match[0],totalKiB:Number(match[1])})));
  const smp=evidence.flatMap(text=>[...text.matchAll(/smp: Brought up\s+\d+\s+nodes?,\s+(\d+)\s+CPUs/g)].map(match=>({line:match[0],cpus:Number(match[1])})));
  const markersObserved=memory.length>0 && smp.length>0;
  report.configurationEvidence={memory,smp,markersObserved,verified:markersObserved && memory.every(entry=>entry.totalKiB===4194240) && smp.every(entry=>entry.cpus===2)};
  check('authoritative guest memory and SMP markers observed',markersObserved,report.configurationEvidence);
  check('printed guest memory matches accepted Firefox configuration',memory.every(entry=>entry.totalKiB===4194240),memory);
  check('printed guest SMP matches two CPUs',smp.every(entry=>entry.cpus===2),smp);
  for (const [stage,min,max] of [['self',0.7,5],['missing',9,20],['before',0.8,9.5],['ready',0,5]]) {
    const begin=lines.findIndex(l=>new RegExp(`^AURORA_QA BEGIN ${stage} uptime=`).test(l.text));
    const end=lines.findIndex(l=>new RegExp(`^AURORA_QA END ${stage} status=0 uptime=`).test(l.text));
    check(`${stage}: begin then exit zero`,begin>=0 && end>begin);
    const uptime=line=>Number(line.text.match(/uptime=([\d.]+)/)?.[1]);
    const elapsedGuest=uptime(lines[end])-uptime(lines[begin]);
    const elapsedHost=(lines[end].hostMs-lines[begin].hostMs)/1000;
    const output=lines.slice(begin+1,end).map(l=>l.text).join('\n');
    report.stages[stage]={elapsedGuestSeconds:elapsedGuest,elapsedHostSeconds:elapsedHost,output};
    check(`${stage}: guest elapsed window`,elapsedGuest>=min && elapsedGuest<=max,elapsedGuest);
    check(`${stage}: independent host elapsed window`,elapsedHost>=min && elapsedHost<=max,elapsedHost);
    if (stage==='self' || stage==='missing') {
      check(`${stage}: actual timeout marker`,output.includes('[wm-ready] deadline elapsed; using timed fallback') && !output.includes('Aurora handshake ready'));
    } else {
      check(`${stage}: positive Aurora handshake`,/\[wm-ready\] Aurora handshake ready after \d+ ms/.test(output) && !output.includes('deadline elapsed'));
    }
    if (stage==='before') {
      const started=output.indexOf('AURORA_QA HELPER_STARTED pid=');
      const pending=output.indexOf('AURORA_QA HELPER_PENDING pid=');
      const launch=output.indexOf('AURORA_QA AURORA_LAUNCH');
      const ready=output.indexOf('[wm-ready] Aurora handshake ready');
      check('helper invoked and still alive before Aurora launch',started>=0 && pending>started && launch>pending && ready>launch);
    }
  }
  check('all diagnostics completed',guest.done && !guest.logs.includes('AURORA_QA FAIL'));
}
try {
  target=await (await request(`${cdp}/json/new?about:blank`,{method:'PUT'})).json();
  report.tab=target.id;
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('CDP connect timeout')),5000);
    ws.onopen=()=>{clearTimeout(timer);resolve();};
    ws.onerror=()=>{clearTimeout(timer);reject(Error('CDP connection failed'));};
  });
  ws.onmessage=event=>{
    const message=JSON.parse(event.data);
    if (message.id) {
      const p=pending.get(message.id); if (!p) return;
      pending.delete(message.id); clearTimeout(p.timer);
      message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);
    } else if (message.method==='Runtime.consoleAPICalled') {
      // Isolated fixture only: bounded text, no object/property expansion or payload dumps.
      const text=(message.params.args||[]).slice(0,8).map(arg=>
        ['string','number','boolean','bigint'].includes(arg.type)
          ? String(arg.value??arg.unserializableValue??'').slice(0,4096)
          : String(arg.description||arg.type||'').slice(0,512)).join(' ').slice(0,8192);
      report.consoleMessages.push({type:message.params.type,elapsedMs:Date.now()-started,text});
      if (report.consoleMessages.length>128) {report.consoleMessages.shift();report.consoleMessagesDropped++;}
    } else if (['Runtime.exceptionThrown','Network.loadingFailed'].includes(message.method) && report.events.length<100) {
      report.events.push({method:message.method,params:message.params});
    }
  };
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Page.navigate',{url:app}); await call('Page.bringToFront');
  let clicked=false;
  for (;;) {
    const state=await evaluate(`({guest:window.auroraReadyResults||null,result:document.documentElement.dataset.result||null,ready:typeof document.querySelector('#boot')?.onclick==='function'})`);
    report.guest=state.guest; report.elapsedMs=Date.now()-started;
    if (state.ready && !clicked) {
      clicked=await evaluate("(document.querySelector('#boot').click(),document.querySelector('#boot').disabled)");
      if (!clicked) throw Error('boot handler did not acknowledge click');
    }
    await save();
    if (report.events.some(e=>e.method==='Runtime.exceptionThrown')) throw Error('page exception');
    if (state.result==='fail' || state.guest?.errors.length) throw Error('guest or page failure');
    if (state.guest?.done) {validate(state.guest);report.pass=true;break;}
    // Stage checks use the host clock, independent of guest timers.
    const lines=state.guest?.lines||[];
    for (const [stage,limit] of [['self',8000],['missing',25000],['before',15000],['ready',8000]]) {
      const begin=lines.find(l=>l.text.startsWith(`AURORA_QA BEGIN ${stage} uptime=`));
      const end=lines.find(l=>l.text.startsWith(`AURORA_QA END ${stage} `));
      if (begin && !end) {
        const now=await evaluate('performance.now()');
        if (now-begin.hostMs>limit) throw Error('independent host stage watchdog: '+stage);
      }
    }
    if (Date.now()-started>120000) throw Error('host poll deadline: 120 seconds');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
} catch(error) {
  report.pass=false; report.error=String(error.stack||error);
} finally {
  if (ws?.readyState===WebSocket.OPEN) {
    try {
      const screenshot=await call('Page.captureScreenshot',{format:'png'});
      await fs.writeFile(path.join(out,'page.png'),Buffer.from(screenshot.data,'base64'));
    } catch(error) {report.screenshotError=String(error);}
    // Drain any final page-side boot-console observations before closing the guest.
    try {report.guest=await evaluate('window.auroraReadyResults||null');} catch {}
    await evaluate("document.querySelector('#stop')?.click()").catch(()=>{});
    for (const p of pending.values()) clearTimeout(p.timer);
    ws.close();
  }
  if (target) {
    try {await request(`${cdp}/json/close/${target.id}`);report.tabClosed=true;}
    catch(error) {report.cleanupError=String(error);report.pass=false;}
  }
  report.elapsedMs=Date.now()-started;
  await save(); finished=true; clearTimeout(watchdog);
}
console.log(JSON.stringify({pass:report.pass,checks:report.checks.length,stages:report.stages,error:report.error,out}));
if (!report.pass) process.exitCode=1;
