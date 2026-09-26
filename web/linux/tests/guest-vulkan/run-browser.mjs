// Node 22+. Uses the sole serving owner's existing server/browser, never starts one.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const tasks = ['/mnt/p6/build/guest-vulkan-20260926','/mnt/p6/build/guest-vulkan-clear-20260926','/mnt/p6/build/guest-vulkan-failure-20260926'];
const mode = process.argv[2];
if (!['live','unavailable','clear','loss-transport','loss-device','exhaustion'].includes(mode) || !process.env.VK_QA_OUT)
  throw Error('usage: VK_QA_OUT=/mnt/p6/build/guest-vulkan-20260926/fresh-output node run-browser.mjs live|unavailable|clear');
const out = path.resolve(await fs.realpath(path.dirname(process.env.VK_QA_OUT)), path.basename(process.env.VK_QA_OUT));
const task = tasks.find(root => out.startsWith(root + '/'));
if (!task) throw Error('output must be under task disk');
const mounts = (await fs.readFile('/proc/self/mountinfo','utf8')).trim().split('\n').map(line => {
  const [fields, fsinfo] = line.split(' - ');
  return {mount:fields.split(' ')[4].replaceAll('\\040',' '), type:fsinfo.split(' ')[0]};
});
async function diskCheck(location) {
  const entry = mounts.filter(m => m.mount === '/' || location === m.mount || location.startsWith(m.mount + '/'))
    .sort((a,b) => b.mount.length - a.mount.length)[0];
  if (!entry || ['tmpfs','ramfs'].includes(entry.type)) throw Error('disk-backed filesystem required: ' + location);
  const stats = await fs.statfs(location);
  if (stats.bavail * stats.bsize < 1024**3) throw Error('less than 1 GiB free');
  return {...entry, availableBytes:stats.bavail * stats.bsize};
}
const scratch = {};
for (const name of ['TMPDIR','TMP','TEMP']) {
  if (!process.env[name]) throw Error(name + ' must be explicitly exported');
  scratch[name] = await fs.realpath(process.env[name]);
  if (!scratch[name].startsWith(task + '/')) throw Error(name + ' must remain on task disk');
  await diskCheck(scratch[name]);
}
const storage = {output:out, filesystem:await diskCheck(path.dirname(out)), scratch};
await fs.mkdir(out);
const cdp = process.env.CDP_URL || 'http://127.0.0.1:9394';
const base = process.env.VK_QA_BASE || 'http://127.0.0.1:4180/linux/tests/guest-vulkan/';
const created = await fetch(`${cdp}/json/new?about:blank`, {method:'PUT'});
if (!created.ok) throw Error('cannot create fixture tab');
const target = await created.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map(), events = []; let nextId = 0;
try {
  await new Promise((resolve,reject) => {
    const timer=setTimeout(() => reject(Error('CDP websocket open timeout')),15000);
    ws.onopen=() => {clearTimeout(timer);resolve();};
    ws.onerror=error => {clearTimeout(timer);reject(error);};
  });
} catch (error) {
  ws.close();
  await fetch(`${cdp}/json/close/${target.id}`).catch(() => {});
  await fs.writeFile(path.join(out,'result.json'),JSON.stringify({pass:false,mode,error:String(error),storage},null,2)+'\n');
  throw error;
}
ws.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const p = pending.get(message.id); if (!p) return;
    pending.delete(message.id); clearTimeout(p.timer);
    if (message.error) p.reject(Error(JSON.stringify(message.error))); else p.resolve(message.result);
  } else if (['Runtime.exceptionThrown','Runtime.consoleAPICalled','Network.loadingFailed'].includes(message.method) && events.length < 256)
    events.push({at:Date.now(), method:message.method, params:message.params});
};
function call(method, params={}) {
  return new Promise((resolve,reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {pending.delete(id); reject(Error('CDP timeout: ' + method));},15000);
    pending.set(id,{resolve,reject,timer}); ws.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(expression) {
  const r = await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
const snapshot = () => evaluate(`({result:document.documentElement?.dataset.result || null,
  guest:window.guestVulkanResults || null,
  ready:!!window.guestVulkanResults && typeof document.querySelector('#boot')?.onclick === 'function',
  gpuAPI:!!navigator.gpu, visibility:document.visibilityState})`);
let report = {mode, pass:false, startedAt:Date.now(), storage, events,
  scope:!['live','unavailable'].includes(mode) ? 'Experimental partial guest Vulkan clear-copy profile; no dispatch, conformance, loader discovery, GL, decoder or physical acceleration proof' : 'Experimental guest Vulkan lifecycle only; no rendering, conformance, loader discovery, GL, decoder or physical acceleration proof',
  runnerSha256:createHash('sha256').update(await fs.readFile(fileURLToPath(import.meta.url))).digest('hex')};
const save = () => fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
try {
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  const url = new URL('index.html',base);
  url.searchParams.set('candidate',mode === 'live' ? 'candidate' : `candidate-${mode}`);
  await call('Page.navigate',{url:url.href}); await call('Page.bringToFront');
  const deadline = Date.now()+125000; let clicked=false;
  for (;;) {
    const state = await snapshot(); report = {...report,...state,elapsedMs:Date.now()-report.startedAt};
    if (!clicked && state.ready) {
      clicked = await evaluate("(document.querySelector('#boot').click(), document.querySelector('#boot').disabled)");
      if (!clicked) throw Error('fixture handler did not acknowledge click');
    }
    await save();
    if (state.result) break;
    if (Date.now() >= deadline) throw Error('external guest watchdog expired');
    await new Promise(resolve => setTimeout(resolve,100));
  }
  report.pass = report.result === 'pass' && report.guest?.pass === true && report.guest.mode === mode &&
    report.guest.errors.length === 0 && report.guest.hostLifetimePass === true &&
    !events.some(e => e.method === 'Runtime.exceptionThrown');
} catch (error) { report.error=String(error); report.pass=false; }
finally {
  try { report={...report,...await snapshot(),elapsedMs:Date.now()-report.startedAt}; }
  catch (error) { report.finalSnapshotError=String(error); report.pass=false; }
  try {
    const shot=await call('Page.captureScreenshot',{format:'png'});
    await fs.writeFile(path.join(out,'page.png'),Buffer.from(shot.data,'base64'));
  } catch (error) { report.screenshotError=String(error); report.pass=false; }
  await evaluate("document.querySelector('#stop')?.click()").catch(error => {report.cleanupError=String(error);report.pass=false;});
  await save();
  for (const p of pending.values()) clearTimeout(p.timer);
  ws.close();
  const closed=await fetch(`${cdp}/json/close/${target.id}`);
  if (!closed.ok) {report.tabCloseError=closed.status;report.pass=false;await save();}
}
console.log(JSON.stringify({pass:report.pass,mode,error:report.error,out}));
if (!report.pass) process.exitCode=1;
