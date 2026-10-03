// Finite actual-Firefox cold/warm or update gate. The fixture uses autofocus so
// Firefox notification banners cannot invalidate hard-coded click coordinates.
// All profiles, scratch and logs stay on the verified disk-backed task path.
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const publicFixture="<!doctype html><meta charset=\"utf-8\"><title>Public Sites Firefox verification</title><style>body{font:24px sans-serif;background:#f4f9ff;margin:40px}input{font:inherit;padding:12px}</style><h1>Firefox on Sites</h1><p>Type wasmperf to check guest JavaScript and input.</p><input autofocus><pre id=\"state\">Ready</pre><script>\nconst field=document.querySelector('input');field.addEventListener('input',()=>{document.querySelector('#state').textContent=field.value;if(field.value==='wasmperf'){let sum=0;for(let i=0;i<4000;i++)sum=(sum+i)|0;const r={schema:1,tag:'sites-v7-guest',input:field.value,checksum:sum,userAgent:navigator.userAgent,createdAt:Date.now(),url:location.href};const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(r)],{type:'application/json'}));link.download='sites-qa-result-'+r.createdAt+'.json';link.click();}});requestAnimationFrame(()=>{field.focus();const r={tag:'sites-qa-ready-v1',createdAt:Date.now(),url:location.href,userAgent:navigator.userAgent};const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(r)],{type:'application/json'}));link.download='sites-qa-ready-'+r.createdAt+'.json';link.click();});</script>";
const task = process.env.SESSIONSTARTUP_TASK || '/mnt/p6/build/firefox-homepage-20260926', out = path.resolve(process.argv[2]);
const candidate = path.resolve(process.argv[3] || task + '/session-startup-candidate-run1');
const baseline = path.resolve(process.argv[5] || task + '/candidate-run1');
if(process.argv.length>6)throw Error('unexpected test argument');
const update = process.argv[4] === 'update';
if(process.argv[4] && !update)throw Error('unknown test mode');
const node = process.execPath, sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hostNproc = Number(execFileSync('nproc', [], { encoding: 'utf8' }).trim());
if (!Number.isInteger(hostNproc) || hostNproc < 1) throw Error('invalid host nproc');
for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
  const actual = await fs.realpath(process.env[key]), stat = await fs.statfs(actual);
  if (!actual.startsWith(task + '/') || [0x01021994, 0x858458f6].includes(stat.type) || stat.bavail * stat.bsize < 2 * 1024 ** 3) throw Error('disk-backed task scratch required');
}
if (!out.startsWith(task + '/')) throw Error('output outside task'); await fs.mkdir(out);
const pkg = JSON.parse(await fs.readFile(candidate + '/package.json'));
if (!pkg.passPackage || !pkg.candidateOnly) throw Error('verified isolated package required');
const sourceVersion=JSON.parse(await fs.readFile(baseline+'/boot-manifest.json','utf8')).version;
const inputs = {};
for (const source of [fileURLToPath(import.meta.url), path.join(repo, 'web/desktop/dev-server.mjs'), ...['main.js', 'persistent-home.mjs', 'boot-assets.mjs', 'storage-panel.mjs', 'boot-manifest.json', 'initramfs-firefox.cpio.gz', 'vmlinux.wasm'].map(s => path.join(repo, 'web/linux', s)), candidate + '/boot-manifest.json', candidate + '/initramfs-firefox.cpio.gz', baseline + '/boot-manifest.json', baseline + '/initramfs-firefox.cpio.gz']) inputs[source] = sha(await fs.readFile(source));
if (inputs[candidate + '/initramfs-firefox.cpio.gz'] !== pkg.archiveSha256 || inputs[baseline + '/initramfs-firefox.cpio.gz'] !== pkg.sourceSha256) throw Error('archive identity differs');
await fs.writeFile(out + '/inputs-before.json', JSON.stringify(inputs, null, 2) + '\n');
await fs.copyFile(fileURLToPath(import.meta.url), out + '/runner.mjs');
const fixture = `<!doctype html><meta charset="utf-8"><title>Saved Firefox homepage probe</title><style>body{font:24px sans-serif;background:#f4f9ff;margin:40px}input{font:inherit;padding:12px}</style><h1>Saved homepage loaded</h1><p>Type in this field to verify guest keyboard input.</p><input id="input" autofocus><pre id="state">Guest JavaScript running</pre><script>
function report(kind,value){new Image().src='/__probe?kind='+kind+'&value='+encodeURIComponent(value)+'&ua='+encodeURIComponent(navigator.userAgent)+'&t='+Date.now();}
document.querySelector('input').addEventListener('input',e=>{document.querySelector('#state').textContent=e.target.value;report('input',e.target.value);});
requestAnimationFrame(()=>requestAnimationFrame(()=>{document.querySelector('input').focus();report('ready','saved-homepage');}));</script>`;
let serverSource = await fs.readFile(path.join(repo, 'web/desktop/dev-server.mjs'), 'utf8');
serverSource = serverSource.slice(0, serverSource.indexOf("server.listen(port,"));
serverSource = serverSource.replace("const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));", 'const root = ' + JSON.stringify(repo) + ';');
serverSource = serverSource.replace('const server = createServer', `export const requests=[],beacons=[],sockets=new Set();let variant='baseline';export const setVariant=value=>{if(!['baseline','candidate'].includes(value))throw Error('variant');variant=value;};\nconst server = createServer`);
serverSource = serverSource.replace("const requestPath = request.url?.split('?')[0];", `const requestPath = request.url?.split('?')[0];requests.push({at:Date.now(),path:requestPath,variant});
  if(requestPath==='/__probe'){const url=new URL(request.url,'http://localhost');beacons.push({at:Date.now(),...Object.fromEntries(url.searchParams)});response.writeHead(204,headers('image/png'));response.end();return;}
  if(requestPath==='/__probe-page'){response.writeHead(200,headers('text/html'));response.end(${JSON.stringify(fixture)});return;}`);
serverSource = serverSource.replace("const target = safePath(request.url || '/');", `let target = safePath(request.url || '/');if(['/linux/boot-manifest.json','/linux/initramfs-firefox.cpio.gz'].includes(requestPath))target=(variant==='candidate'?${JSON.stringify(candidate)}:${JSON.stringify(baseline)})+'/'+requestPath.split('/').at(-1);`);
serverSource = serverSource.replace('const remote = net.connect({ host, port: targetPort });', 'const remote = net.connect({ host, port: targetPort });sockets.add(remote);remote.on("close",()=>sockets.delete(remote));');
serverSource += '\nserver.on("connection",socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));});export {server};\n';
await fs.writeFile(out + '/server.mjs', serverSource);
const service = await import(pathToFileURL(out + '/server.mjs').href), server = service.server;
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
service.setVariant('candidate');
const origin = 'http://127.0.0.1:' + server.address().port, guestURL = 'file:///home/admin/sites-probe.html';
let prefs = ['network.http.http2.enabled:false', 'network.http.http3.enable:false', 'toolkit.legacyUserProfileCustomizations.stylesheets:true', 'media.rdd-process.enabled:false', 'media.utility-process.enabled:false', 'media.allow-audio-non-utility:true', 'browser.startup.page:1', 'browser.shell.checkDefaultBrowser:false', 'browser.download.alwaysOpenPanel:false', 'browser.download.panel.shown:true'].map(s => { const i=s.lastIndexOf(':');return 'user_pref('+JSON.stringify(s.slice(0,i))+','+s.slice(i+1)+');'; }).join('\n')+'\nuser_pref("browser.startup.homepage",'+JSON.stringify(guestURL)+');\n';
prefs += 'user_pref("browser.download.folderList",2);\nuser_pref("browser.download.dir","/home/admin/Downloads");\nuser_pref("browser.helperApps.neverAsk.saveToDisk","application/json");\n';
// Keep first-run telemetry's delayed privacy tab from replacing the selected
// fixture during an abrupt reload. This affects only the owned test profile;
// the image and its production notification preferences remain unchanged.
prefs += 'user_pref("datareporting.policy.firstRunURL", "");\n';
const executable = '/home/a/.local/archpkg/pacman/usr/bin/chromium';
const args = ['--headless', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir='+out+'/profile', '--disk-cache-dir='+out+'/cache', 'about:blank'];
const fd = openSync(out + '/browser.log', 'wx');
const child = spawn(executable, args, { detached:true,env:{...process.env,XDG_CACHE_HOME:out+'/xdg-cache'},stdio:['ignore',fd,fd] });closeSync(fd);
let exitInfo, spawnError; const exited = new Promise(resolve => { child.once('exit',(code,signal)=>{exitInfo={code,signal};resolve();});child.once('error',e=>{spawnError=String(e);resolve();}); });
const report = { pass:false, origin, guestURL, serverPid:process.pid,browserPid:child.pid, phases:[], limitations:['Launch log is not first paint; fixed observation waits are not speed benchmarks. Cold/warm and baseline/update modes use separate owned profiles.'] };
let ws, next=0;const pending=new Map(), errors=[];
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP deadline '+method));},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function ev(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(fn,ms,label){const end=Date.now()+ms;for(;;){if(await fn())return;if(Date.now()>end)throw Error(label+' deadline');await sleep(200);}}
// Match the UI hostCores clamp, but reject a missing/invalid browser count.
// nproc reflects the CPU allocation available to the browser on this host.
async function resolveHostCpus() {
  const browserHardwareConcurrency = await ev('navigator.hardwareConcurrency');
  if (!Number.isInteger(browserHardwareConcurrency) || browserHardwareConcurrency < 1) throw Error('invalid browser hardwareConcurrency');
  const hostCores = Math.min(64, Math.max(1, browserHardwareConcurrency));
  const expectedHostCores = Math.min(64, hostNproc);
  const cpu = { hostNproc, browserHardwareConcurrency, hostCores, expectedHostCores, requestedGuestCpus: hostCores };
  report.cpu = cpu;
  if (hostCores !== expectedHostCores) throw Error('browser/host CPU count mismatch: ' + JSON.stringify(cpu));
  return cpu;
}
function guestCpuEvidence(logs, state) {
  const counts = [...logs.matchAll(/smp: Brought up \d+ nodes?, (\d+) CPUs?\b/g)].map(m => Number(m[1]));
  const guestBootCpus = counts.at(-1) ?? null;
  return { ...report.cpu, browserHardwareConcurrencyAtBoot: state.browserHardwareConcurrency, selectedGuestCpus: state.selectedGuestCpus, guestBootCpus };
}
async function shot(name){const r=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(out+'/'+name+'.png',Buffer.from(r.data,'base64'));}
async function key(code,key,down,modifiers=0){await call('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key,modifiers});}
async function textInput(text){for(const c of text){let code,shift=false;if(/[a-z]/.test(c))code='Key'+c.toUpperCase();else if(/[0-9]/.test(c))code='Digit'+c;else code={':':'Semicolon','/':'Slash','.':'Period','-':'Minus','_':'Minus','?':'Slash','=':'Equal'}[c];shift=c===':'||c==='_'||c==='?';if(!code)throw Error('unsupported fixture key');if(shift)await key('ShiftLeft','Shift',true,8);await key(code,c,true,shift?8:0);await sleep(100);await key(code,c,false,shift?8:0);if(shift)await key('ShiftLeft','Shift',false);}}
async function homeEvidence(){return ev(`(async()=>{const h=(await import('./main.js')).guestHome();async function lookup(p){let n=h.root;for(const part of p.split('/').filter(Boolean))n=await h.lookup(n,part);return n;}const result={};for(const p of ['admin/homepage-marker.txt','admin/.mozilla/firefox/http1-profile/user.js','admin/.mozilla/firefox/http1-profile/prefs.js']){const n=await lookup(p),a=await h.getattr(n);result[p]={bytes:Number(a.size),text:new TextDecoder().decode(await h.read(n,{},0n,Number(a.size)))};}return result;})()`);}
// Do not send Escape to a still-loading initial page: that can cancel it.
// Readiness comes from JavaScript running inside the actual guest Firefox.
async function waitForGuestReady(start,label){
  let ready;
  await until(async()=>{ready=await ev(`(async()=>{const h=(await import('./main.js')).guestHome();let n=await h.lookup(h.root,'admin');n=await h.lookup(n,'Downloads');if(!n)return null;for(const e of await h.readdir(n,{})){if(!e.name.startsWith('sites-qa-ready-')||!e.name.endsWith('.json'))continue;try{const a=await h.getattr(e.node);if(Number(a.size)>4096)continue;const r=JSON.parse(new TextDecoder().decode(await h.read(e.node,{},0n,Number(a.size))));if(r.tag==='sites-qa-ready-v1'&&r.createdAt>=${start}&&r.url===${JSON.stringify(guestURL)}&&/Firefox/.test(r.userAgent))return r;}catch{}}return null;})()`);return Boolean(ready);},120000,'guest fixture readiness');
  const evidence={label,observedMs:Date.now()-start,ready};
  await fs.writeFile(out+'/'+label+'-ready.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({phase:label,guestReadyMs:evidence.observedMs}));
}
async function phase(label,action){
  const oldEpoch=await ev('performance.timeOrigin'),start=Date.now();await action();let launch;
  await until(async()=>{try{if(await ev('performance.timeOrigin')===oldEpoch)return false;const logs=await ev(`(async()=>(await import('./main.js')).guestLogs.history.page(undefined,300).map(l=>l.text).join(String.fromCharCode(10)))()`);if(logs.includes('starting /bin/firefox as admin')){launch={elapsedMs:Date.now()-start,logs};return true;}}catch(e){if(!/context|Cannot|Failed to fetch/.test(String(e)))throw e;}return false;},120000,'public Firefox launch');
  await waitForGuestReady(start,label);await shot(label+'-before-input');await ev("document.querySelector('#fb').focus()");await key('Escape','Escape',true);await key('Escape','Escape',false);await sleep(500);await key('ControlLeft','Control',true,2);await key('KeyA','a',true,2);await key('KeyA','a',false,2);await key('ControlLeft','Control',false);await textInput('wasmperf');let result;
  await until(async()=>{result=await ev(`(async()=>{const h=(await import('./main.js')).guestHome();let n=await h.lookup(h.root,'admin');n=await h.lookup(n,'Downloads');if(!n)return null;for await(const e of await h.readdir(n,{})){if(!/^sites-qa-result-\\d+\\.json$/.test(e.name))continue;try{const a=await h.getattr(e.node);const r=JSON.parse(new TextDecoder().decode(await h.read(e.node,{},0n,Number(a.size))));if(r.createdAt>=${start}&&r.input==='wasmperf'&&r.checksum===7998000&&/Firefox\\//.test(r.userAgent))return r;}catch{}}return null;})()`);return Boolean(result);},60000,'guest-generated result file');
  const home=await homeEvidence();if(home['admin/homepage-marker.txt'].text!=='homepage-preserved-v1\n'||home['admin/.mozilla/firefox/http1-profile/user.js'].text!==prefs)throw Error('public home/profile mismatch');
  const state=await ev(`(async()=>({system:await(await import('./boot-assets.mjs')).systemUsage(),browserHardwareConcurrency:navigator.hardwareConcurrency,selectedGuestCpus:Number(document.querySelector('#cpu-cores').value),visibility:document.visibilityState,isolated:crossOriginIsolated,backend:document.querySelector('#graphics-status').textContent,logs:(await import('./main.js')).guestLogs.history.page(undefined,5000).map(l=>l.text).join(String.fromCharCode(10)),images:performance.getEntriesByType('resource').filter(e=>/vmlinux\\.wasm|initramfs.*(?:gz|cpio)/.test(e.name)).map(e=>({name:e.name,transferSize:e.transferSize}))}))()`);
  const cpu=guestCpuEvidence(state.logs,state);
  if(cpu.browserHardwareConcurrencyAtBoot!==cpu.browserHardwareConcurrency||cpu.selectedGuestCpus!==cpu.hostCores||cpu.guestBootCpus!==cpu.hostCores)throw Error('guest/host CPU count mismatch: '+JSON.stringify(cpu));
  if(state.system.version!==(label==='baseline'?sourceVersion:pkg.version)||!state.isolated||state.visibility!=='visible'||!state.logs.includes(`display=1280x720, cpus=${cpu.requestedGuestCpus}, ram=4 GB (maximum)`))throw Error('public version/config mismatch');
  if(label==='warm'&&state.images.length)throw Error('public warm image request');await shot(label+'-functional');
  report.phases.push({label,pass:true,launch,observedResultMs:Date.now()-start,cpu,result,home,state});await fs.writeFile(out+'/progress.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({phase:label,pass:true,launchMs:launch.elapsedMs,imageRequests:state.images.length}));
}
try {
  let port;await until(async()=>{if(exitInfo||spawnError)throw Error('browser startup failed');try{[port]=(await fs.readFile(out+'/profile/DevToolsActivePort','utf8')).trim().split('\n');return true;}catch(e){if(e.code!=='ENOENT')throw e;return false;}},15000,'browser');
  const target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');ws=new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params);};
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});await call('Page.enable');await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:origin+'/linux/boot-manifest.json'});await until(()=>ev("document.readyState==='complete'&&location.pathname.endsWith('boot-manifest.json')"),10000,'seed page');
  await resolveHostCpus();
  await ev(`(async()=>{localStorage.setItem('linuxonweb.machine-settings.v1',JSON.stringify({resolution:'1280x720',cpus:${report.cpu.requestedGuestCpus},ram:4096,backend:'canvas2d'}));const h=await(await import('/linux/persistent-home.mjs')).openPersistentHome();async function dir(p){let n=h.root;for(const s of p.split('/').filter(Boolean))n=await h.lookup(n,s)||await h.mkdir(n,s,{mode:0o755,uid:1000,gid:1000});return n;}async function put(p,text){const parts=p.split('/'),name=parts.pop(),parent=await dir(parts.join('/'));const f=await h.create(parent,name,2,{mode:0o644,uid:1000,gid:1000});await h.write(f.node,f.handle,0n,new TextEncoder().encode(text));await h.release(f.node,f.handle);}await put('admin/homepage-marker.txt',${JSON.stringify('homepage-preserved-v1\n')});await dir('admin/Downloads');await put('admin/sites-probe.html',${JSON.stringify(publicFixture)});await put('admin/.mozilla/firefox/http1-profile/user.js',${JSON.stringify(prefs)});await h.destroy();return true;})()`);
  const url=origin+'/linux/index.html?firefox=1&renderer=canvas2d';
  report.publicAssets=await ev(`(async()=>{const response=await fetch('/linux/boot-manifest.json',{cache:'no-store'}),manifest=await response.json();const head=await fetch('/linux/initramfs-firefox.cpio.gz',{method:'HEAD',cache:'no-store'});return {manifest,status:response.status,headers:Object.fromEntries(response.headers),archiveStatus:head.status,archiveHeaders:Object.fromEntries(head.headers)};})()`);
  const a=report.publicAssets;if(a.manifest.version!==pkg.version||a.manifest.assets.firefox.sha256!==pkg.archiveSha256||a.archiveStatus!==200||Number(a.archiveHeaders['content-length'])!==pkg.bytes)throw Error('live assets mismatch');
  for(const [key,value]of [['cross-origin-opener-policy','same-origin'],['cross-origin-embedder-policy','require-corp'],['cross-origin-resource-policy','same-origin']])if(a.headers[key]!==value||a.archiveHeaders[key]!==value)throw Error('live isolation header');
  if(update){
    service.setVariant('baseline');
    await phase('baseline',()=>call('Page.navigate',{url}));
    service.setVariant('candidate');
    await phase('update',()=>ev("(()=>{document.querySelector('[data-storage=update]').click();return true;})()"));
    const before=report.phases[0].result;
    const preserved=await ev(`(async()=>{const h=(await import('./main.js')).guestHome();let n=h.root;for(const s of ['admin','Downloads','sites-qa-result-'+${before.createdAt}+'.json'])n=await h.lookup(n,s);if(!n)throw Error('prior download missing');const a=await h.getattr(n);return JSON.parse(new TextDecoder().decode(await h.read(n,{},0n,Number(a.size))));})()`);
    if(JSON.stringify(preserved)!==JSON.stringify(before))throw Error('prior download changed during update');
    report.priorDownloadPreserved=true;
  }else{
    await phase('cold',()=>call('Page.navigate',{url}));
    await phase('warm',()=>call('Page.reload',{ignoreCache:true}));
  }

  for(const [p,h]of Object.entries(inputs))if(sha(await fs.readFile(p))!==h)throw Error('input changed '+p);
  if(errors.length)throw Error('outer browser exceptions');report.pass=true;
} catch(error){report.error=String(error.stack||error);try{report.guestFailure=await ev(`(async()=>({logs:(await import('./main.js')).guestLogs.history.page(undefined,1000).map(l=>l.text).join(String.fromCharCode(10)),system:await(await import('./boot-assets.mjs')).systemUsage()}))()`);await fs.writeFile(out+'/guest-failure.json',JSON.stringify(report.guestFailure,null,2)+'\n');report.failureState=await ev(`({url:location.href,status:document.querySelector('#status')?.textContent,message:document.querySelector('#storage-message')?.textContent})`);await shot('failure');}catch{} }
finally {
  if(ws?.readyState===1){try{await call('Page.navigate',{url:'about:blank'});await call('Browser.close');}catch{}}
  for(const p of pending.values())clearTimeout(p.timer);ws?.close();await Promise.race([exited,sleep(5000)]);
  if(!exitInfo&&!spawnError){process.kill(-child.pid,'SIGTERM');await Promise.race([exited,sleep(5000)]);report.pass=false;report.forcedTermination=true;}
  for(const socket of service.sockets)socket.destroy();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  report.browserExit=exitInfo;report.serverClosed=!server.listening;report.errors=errors;report.beacons=service.beacons;report.requests=service.requests;report.inputs=inputs;
  if(exitInfo?.code!==0||!report.serverClosed)report.pass=false;
  await fs.writeFile(out+'/result.json',JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({pass:report.pass,phases:report.phases.map(p=>p.label),error:report.error,out}));if(!report.pass)process.exitCode=1;
