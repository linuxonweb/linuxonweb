// Finite owner of an isolated server and Chromium. No accepted asset mutation.
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const task = '/mnt/p6/build/firefox-homepage-20260926', out = path.resolve(process.argv[2]);
const candidate = path.resolve(process.argv[3] || task + '/candidate-run1');
const freshDefault = process.argv[4] === 'fresh-default';
if(process.argv[4] && !freshDefault)throw Error('unknown test mode');
const node = process.execPath, sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
  const actual = await fs.realpath(process.env[key]), stat = await fs.statfs(actual);
  if (!actual.startsWith(task + '/') || [0x01021994, 0x858458f6].includes(stat.type) || stat.bavail * stat.bsize < 2 * 1024 ** 3) throw Error('disk-backed task scratch required');
}
if (!out.startsWith(task + '/')) throw Error('output outside task'); await fs.mkdir(out);
const pkg = JSON.parse(await fs.readFile(candidate + '/package.json'));
if (!pkg.passPackage || !pkg.candidateOnly) throw Error('verified isolated package required');
const packedInit=await fs.readFile(candidate+'/init.after.sh','utf8');
const defaultPrefs=packedInit.match(/<<'LOWLAND_HTTP1_PREFS'\n([\s\S]*?)\nLOWLAND_HTTP1_PREFS/)[1]+'\n';
const inputs = {};
for (const source of [fileURLToPath(import.meta.url), path.join(repo, 'web/desktop/dev-server.mjs'), ...['main.js', 'persistent-home.mjs', 'boot-assets.mjs', 'storage-panel.mjs', 'boot-manifest.json', 'initramfs-firefox.cpio.gz', 'vmlinux.wasm'].map(s => path.join(repo, 'web/linux', s)), candidate + '/boot-manifest.json', candidate + '/initramfs-firefox.cpio.gz']) inputs[source] = sha(await fs.readFile(source));
if (inputs[candidate + '/initramfs-firefox.cpio.gz'] !== pkg.archiveSha256 || inputs[path.join(repo, 'web/linux/initramfs-firefox.cpio.gz')] !== pkg.sourceSha256) throw Error('archive identity differs');
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
serverSource = serverSource.replace("const target = safePath(request.url || '/');", `let target = safePath(request.url || '/');if(variant==='candidate'&&['/linux/boot-manifest.json','/linux/initramfs-firefox.cpio.gz'].includes(requestPath))target=${JSON.stringify(candidate)}+'/'+requestPath.split('/').at(-1);`);
serverSource = serverSource.replace('const remote = net.connect({ host, port: targetPort });', 'const remote = net.connect({ host, port: targetPort });sockets.add(remote);remote.on("close",()=>sockets.delete(remote));');
serverSource += '\nserver.on("connection",socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));});export {server};\n';
await fs.writeFile(out + '/server.mjs', serverSource);
const service = await import(pathToFileURL(out + '/server.mjs').href), server = service.server;
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = 'http://127.0.0.1:' + server.address().port, guestURL = 'http://192.0.2.1:' + server.address().port + '/__probe-page';
const prefs = ['network.http.http2.enabled:false', 'network.http.http3.enable:false', 'toolkit.legacyUserProfileCustomizations.stylesheets:true', 'media.rdd-process.enabled:false', 'media.utility-process.enabled:false', 'media.allow-audio-non-utility:true', 'browser.startup.page:1', 'browser.shell.checkDefaultBrowser:false'].map(s => { const i=s.lastIndexOf(':');return 'user_pref('+JSON.stringify(s.slice(0,i))+','+s.slice(i+1)+');'; }).join('\n')+'\nuser_pref("browser.startup.homepage",'+JSON.stringify(guestURL)+');\n';
const executable = '/home/a/.local/archpkg/pacman/usr/bin/chromium';
const args = ['--headless', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir='+out+'/profile', '--disk-cache-dir='+out+'/cache', 'about:blank'];
const fd = openSync(out + '/browser.log', 'wx');
const child = spawn(executable, args, { detached:true,env:{...process.env,XDG_CACHE_HOME:out+'/xdg-cache'},stdio:['ignore',fd,fd] });closeSync(fd);
let exitInfo, spawnError; const exited = new Promise(resolve => { child.once('exit',(code,signal)=>{exitInfo={code,signal};resolve();});child.once('error',e=>{spawnError=String(e);resolve();}); });
const report = { pass:false, origin, guestURL, serverPid:process.pid,browserPid:child.pid, phases:[], limitations:['Launch log time is not first paint. Baseline navigation is manually triggered and cannot be compared with automatic candidate homepage as an unbiased speed benchmark.'] };
let ws, next=0;const pending=new Map(), errors=[];
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP deadline '+method));},30000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
async function ev(expression){const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function until(fn,ms,label){const end=Date.now()+ms;for(;;){if(await fn())return;if(Date.now()>end)throw Error(label+' deadline');await sleep(200);}}
async function shot(name){const r=await call('Page.captureScreenshot',{format:'png'});await fs.writeFile(out+'/'+name+'.png',Buffer.from(r.data,'base64'));}
async function key(code,key,down,modifiers=0){await call('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code,key,modifiers});}
async function textInput(text){for(const c of text){let code,shift=false;if(/[a-z]/.test(c))code='Key'+c.toUpperCase();else if(/[0-9]/.test(c))code='Digit'+c;else code={':':'Semicolon','/':'Slash','.':'Period','-':'Minus','_':'Minus','?':'Slash','=':'Equal'}[c];shift=c===':'||c==='_'||c==='?';if(!code)throw Error('unsupported fixture key');if(shift)await key('ShiftLeft','Shift',true,8);await key(code,c,true,shift?8:0);await sleep(30);await key(code,c,false,shift?8:0);if(shift)await key('ShiftLeft','Shift',false);}}
async function homeEvidence(){return ev(`(async()=>{const h=(await import('./main.js')).guestHome();async function lookup(p){let n=h.root;for(const part of p.split('/').filter(Boolean))n=await h.lookup(n,part);return n;}const result={};for(const p of ['admin/homepage-marker.txt','admin/.mozilla/firefox/http1-profile/user.js','admin/.mozilla/firefox/http1-profile/prefs.js']){const n=await lookup(p),a=await h.getattr(n);result[p]={bytes:Number(a.size),text:new TextDecoder().decode(await h.read(n,{},0n,Number(a.size)))};}return result;})()`);}
async function phase(label,action,automatic){
  const previousEpoch=await ev('performance.timeOrigin');
  const start=Date.now(), beaconStart=service.beacons.length, requestStart=service.requests.length;await action();
  let launch;
  await until(async()=>{try{if(await ev('performance.timeOrigin')===previousEpoch)return false;const s=await ev(`(async()=>{const m=await import('./main.js');return {status:document.querySelector('#status')?.textContent,logs:m.guestLogs.history.page(undefined,300).map(l=>l.text).join(String.fromCharCode(10))};})()`);if(s.status==='boot failed'||s.status?.startsWith('stopped:'))throw Error(JSON.stringify(s));if(s.logs.includes('starting /bin/firefox as admin')){launch={elapsedMs:Date.now()-start,logs:s.logs};return true;}}catch(e){if(!/context|Cannot read|Failed to fetch|Cannot find/i.test(String(e)))throw e;}return false;},90000,'Firefox launch');
  if(!automatic){await sleep(30000);await shot(label+'-before-navigation');await ev("document.querySelector('#fb').focus()");await key('ControlLeft','Control',true,2);await key('KeyL','l',true,2);await key('KeyL','l',false,2);await key('ControlLeft','Control',false);await sleep(300);await textInput(guestURL);await key('Enter','Enter',true);await key('Enter','Enter',false);}
  await until(()=>service.beacons.slice(beaconStart).some(b=>b.kind==='ready'&&b.value==='saved-homepage'&&/Firefox\//.test(b.ua)),90000,'actual guest homepage');
  const ready=service.beacons.slice(beaconStart).find(b=>b.kind==='ready');await sleep(500);await ev("document.querySelector('#fb').focus()");await textInput('wasmperf');
  await until(()=>service.beacons.slice(beaconStart).some(b=>b.kind==='input'&&b.value==='wasmperf'),20000,'guest keyboard input');
  const home=await homeEvidence();if(home['admin/homepage-marker.txt'].text!=='homepage-preserved-v1\n'||home['admin/.mozilla/firefox/http1-profile/user.js'].text!==(freshDefault?defaultPrefs:prefs))throw Error('home/profile changed');
  const state=await ev(`(async()=>({system:await(await import('./boot-assets.mjs')).systemUsage(),visibility:document.visibilityState,isolated:crossOriginIsolated,status:document.querySelector('#status').textContent,logs:(await import('./main.js')).guestLogs.history.page(undefined,300).map(l=>l.text).join(String.fromCharCode(10))}))()`);
  if(!state.isolated||state.visibility!=='visible'||state.system.version!==(label==='baseline'?'ff1ea9fc6f62':pkg.version)||!state.logs.includes('display=1280x720, cpus=2, ram=4 GB (maximum)'))throw Error('configuration/version mismatch');
  const images=service.requests.slice(requestStart).filter(r=>/\/(vmlinux\.wasm|initramfs[^/]*\.(?:gz|cpio))$/.test(r.path));
  if(label==='warm'&&images.length)throw Error('warm boot downloaded images');
  await shot(label+'-functional');report.phases.push({label,pass:true,launch,readyElapsedMs:ready.at-start,beacons:service.beacons.slice(beaconStart),images,home,state});await fs.writeFile(out+'/progress.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({phase:label,pass:true,launchMs:launch.elapsedMs,readyMs:ready.at-start,imageRequests:images.length}));
}
try {
  let port;await until(async()=>{if(exitInfo||spawnError)throw Error('browser startup failed');try{[port]=(await fs.readFile(out+'/profile/DevToolsActivePort','utf8')).trim().split('\n');return true;}catch(e){if(e.code!=='ENOENT')throw e;return false;}},15000,'browser');
  const target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');ws=new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params);};
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});await call('Page.enable');await call('Runtime.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:origin+'/linux/boot-manifest.json'});await until(()=>ev("document.readyState==='complete'&&location.pathname.endsWith('boot-manifest.json')"),10000,'seed page');
  await ev(`(async()=>{localStorage.setItem('linuxonweb.machine-settings.v1',JSON.stringify({resolution:'1280x720',cpus:2,ram:4096,backend:'canvas2d'}));const h=await(await import('/linux/persistent-home.mjs')).openPersistentHome();async function dir(p){let n=h.root;for(const s of p.split('/').filter(Boolean))n=await h.lookup(n,s)||await h.mkdir(n,s,{mode:0o755,uid:1000,gid:1000});return n;}async function put(p,text){const parts=p.split('/'),name=parts.pop(),parent=await dir(parts.join('/'));const f=await h.create(parent,name,2,{mode:0o644,uid:1000,gid:1000});await h.write(f.node,f.handle,0n,new TextEncoder().encode(text));await h.release(f.node,f.handle);}await put('admin/homepage-marker.txt',${JSON.stringify('homepage-preserved-v1\n')});if(!${freshDefault})await put('admin/.mozilla/firefox/http1-profile/user.js',${JSON.stringify(prefs)});await h.destroy();return true;})()`);
  const url=origin+'/linux/index.html?firefox=1&renderer=canvas2d';
  if(freshDefault){service.setVariant('candidate');await phase('fresh-default',()=>call('Page.navigate',{url}),false);}
  else{
    await phase('baseline',()=>call('Page.navigate',{url}),false);
    service.setVariant('candidate');await phase('update',()=>ev("document.querySelector('[data-storage=update]').click()"),true);
    await phase('warm',()=>call('Page.reload',{ignoreCache:true}),true);
  }
  for(const [p,h]of Object.entries(inputs))if(sha(await fs.readFile(p))!==h)throw Error('input changed '+p);
  if(errors.length)throw Error('outer browser exceptions');report.pass=true;
} catch(error){report.error=String(error.stack||error);try{report.failureState=await ev(`({url:location.href,status:document.querySelector('#status')?.textContent,message:document.querySelector('#storage-message')?.textContent})`);await shot('failure');}catch{} }
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
