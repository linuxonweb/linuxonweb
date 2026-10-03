// Finite actual-Firefox WebGPU W1 gate (derived from test-firefox-session-startup.mjs).
// A file:// fixture (a secure context) inside the real Linux-wasm guest checks
// navigator.gpu, calls navigator.gpu.requestAdapter() under try/catch with a
// deadline, and writes the outcome to ~/Downloads as JSON (also shown in the
// page title and body for screenshots). Afterwards guest keyboard input and a
// JS checksum prove Firefox is still alive.
//
// Usage: node test-firefox-webgpu-w1.mjs OUT CANDIDATE BASELINE [control|control-prefs]
//   default: boot CANDIDATE cold, then warm reload; expect navigator.gpu and a
//            null adapter (Empty wgpu HAL) on every requestAdapter call.
//   control: boot BASELINE once; expect navigator.gpu to be absent.
//   control-prefs: boot BASELINE once with the two WebGPU prefs in user.js;
//            expect navigator.gpu present but every requestAdapter rejected
//            by the compiled-in RELEASE_OR_BETA gate (prefs alone do not work).
// All profiles, scratch and logs stay on the verified disk-backed task path.
// Ports: HTTP 4198, CDP 9408.
import fs from 'node:fs/promises';
import { saveHostCpuPhaseEvidence, guestCpuPrebootStateExpression, readHostNproc, selectHostCpus, guestCpuChecks, guestCpuStateExpression, saveGuestCpuEvidence } from './firefox-host-cpus.mjs';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const task = '/mnt/p6/build/firefox-webgpu-w1-20260929';
const HTTP_PORT = 4198, CDP_PORT = 9408;
const out = path.resolve(process.argv[2]);
const candidate = path.resolve(process.argv[3]), baseline = path.resolve(process.argv[4]);
const mode = process.argv[5] || 'candidate', control = mode !== 'candidate';
if (!['candidate', 'control', 'control-prefs'].includes(mode)) throw Error('unknown test mode');
if (process.argv.length > 6 || !process.argv[4]) throw Error('usage: OUT CANDIDATE BASELINE [control|control-prefs]');
const probeFixture = `<!doctype html><meta charset="utf-8"><title>WebGPU W1 pending</title><style>body{font:22px sans-serif;background:#f4f9ff;margin:30px}input{font:inherit;padding:10px}pre{font:18px monospace;white-space:pre-wrap}</style><h1 id="verdict">WebGPU W1 probe running</h1><input autofocus><pre id="state">Ready</pre><pre id="probe"></pre><script>
function save(prefix,r){const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(r)],{type:'application/json'}));link.download=prefix+r.createdAt+'.json';link.click();}
const field=document.querySelector('input');field.addEventListener('input',()=>{document.querySelector('#state').textContent=field.value;if(field.value==='wasmperf'){let sum=0;for(let i=0;i<4000;i++)sum=(sum+i)|0;save('sites-qa-result-',{schema:1,tag:'webgpu-w1-input',input:field.value,checksum:sum,userAgent:navigator.userAgent,createdAt:Date.now(),url:location.href});}});
async function probe(options){const t=performance.now();let timer;try{const adapter=await Promise.race([navigator.gpu.requestAdapter(options),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('requestAdapter deadline 60s')),60000);})]);clearTimeout(timer);const r={options,ms:Math.round(performance.now()-t),settled:'resolved',isNull:adapter===null,type:adapter===null?'null':typeof adapter};if(adapter){try{r.isFallbackAdapter=adapter.isFallbackAdapter;r.features=[...adapter.features];}catch(e){r.adapterError=String(e);}}return r;}catch(e){clearTimeout(timer);return {options,ms:Math.round(performance.now()-t),settled:'rejected',name:e&&e.name,error:String(e)};}}
async function run(){
  const r={schema:1,tag:'webgpu-w1-probe-v1',createdAt:Date.now(),url:location.href,userAgent:navigator.userAgent,isSecureContext:window.isSecureContext,hasGpuProperty:'gpu' in navigator,gpuType:typeof navigator.gpu,gpuClass:navigator.gpu?Object.prototype.toString.call(navigator.gpu):null,globals:{GPU:typeof GPU,GPUAdapter:typeof GPUAdapter,GPUDevice:typeof GPUDevice,GPUBufferUsage:typeof GPUBufferUsage},probes:[]};
  if(navigator.gpu){
    try{r.preferredCanvasFormat=navigator.gpu.getPreferredCanvasFormat();}catch(e){r.preferredCanvasFormatError=String(e);}
    try{r.wgslLanguageFeatures=[...navigator.gpu.wgslLanguageFeatures];}catch(e){r.wgslLanguageFeaturesError=String(e);}
    for(const options of [undefined,{powerPreference:'high-performance'},{powerPreference:'low-power'},{forceFallbackAdapter:true}]){r.probes.push(await probe(options));document.querySelector('#probe').textContent=JSON.stringify(r.probes,null,1);}
  }
  r.finishedAt=Date.now();
  r.verdict=!r.hasGpuProperty?'navigator.gpu absent':r.probes.every(p=>p.settled==='resolved'&&p.isNull)?'requestAdapter resolved null x'+r.probes.length:'unexpected: '+r.probes.map(p=>p.settled+(p.isNull?':null':'')).join(',');
  console.log('WEBGPU-W1 '+JSON.stringify(r));
  document.title='WebGPU W1: '+r.verdict;document.querySelector('#verdict').textContent='WebGPU W1: '+r.verdict;
  document.querySelector('#probe').textContent=JSON.stringify({isSecureContext:r.isSecureContext,hasGpuProperty:r.hasGpuProperty,gpuClass:r.gpuClass,preferredCanvasFormat:r.preferredCanvasFormat,wgslLanguageFeatures:r.wgslLanguageFeatures,probes:r.probes},null,1);
  save('webgpu-w1-result-',r);
  field.focus();save('sites-qa-ready-',{tag:'sites-qa-ready-v1',createdAt:Date.now(),url:location.href,userAgent:navigator.userAgent});
}
requestAnimationFrame(()=>requestAnimationFrame(()=>run().catch(e=>{document.title='WebGPU W1 fixture error';save('webgpu-w1-result-',{schema:1,tag:'webgpu-w1-probe-v1',createdAt:Date.now(),fixtureError:String(e&&e.stack||e)});})));</script>`;
const node = process.execPath, sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
  const actual = await fs.realpath(process.env[key]), stat = await fs.statfs(actual);
  if (!actual.startsWith(task + '/') || [0x01021994, 0x858458f6].includes(stat.type) || stat.bavail * stat.bsize < 2 * 1024 ** 3) throw Error('disk-backed task scratch required');
}
if (!out.startsWith(task + '/')) throw Error('output outside task'); await fs.mkdir(out);
const pkg = JSON.parse(await fs.readFile(candidate + '/package.json'));
if (!pkg.passPackage || !pkg.candidateOnly) throw Error('verified isolated package required');
const sourceVersion = JSON.parse(await fs.readFile(baseline + '/boot-manifest.json', 'utf8')).version;
const inputs = {};
for (const source of [fileURLToPath(import.meta.url), fileURLToPath(new URL('./firefox-host-cpus.mjs', import.meta.url)), path.join(repo, 'web/desktop/dev-server.mjs'), ...['main.js', 'persistent-home.mjs', 'boot-assets.mjs', 'storage-panel.mjs', 'boot-manifest.json', 'initramfs-firefox.cpio.gz', 'vmlinux.wasm'].map(s => path.join(repo, 'web/linux', s)), candidate + '/boot-manifest.json', candidate + '/initramfs-firefox.cpio.gz', baseline + '/boot-manifest.json', baseline + '/initramfs-firefox.cpio.gz']) inputs[source] = sha(await fs.readFile(source));
if (inputs[candidate + '/initramfs-firefox.cpio.gz'] !== pkg.archiveSha256 || inputs[baseline + '/initramfs-firefox.cpio.gz'] !== pkg.sourceSha256) throw Error('archive identity differs');
await fs.writeFile(out + '/inputs-before.json', JSON.stringify(inputs, null, 2) + '\n');
await fs.copyFile(fileURLToPath(import.meta.url), out + '/runner.mjs');
await fs.copyFile(fileURLToPath(new URL('./firefox-host-cpus.mjs', import.meta.url)), out + '/firefox-host-cpus.mjs');
let serverSource = await fs.readFile(path.join(repo, 'web/desktop/dev-server.mjs'), 'utf8');
serverSource = serverSource.slice(0, serverSource.indexOf("server.listen(port,"));
serverSource = serverSource.replace("const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));", 'const root = ' + JSON.stringify(repo) + ';');
serverSource = serverSource.replace('const server = createServer', `export const requests=[],sockets=new Set();let variant='baseline';export const setVariant=value=>{if(!['baseline','candidate'].includes(value))throw Error('variant');variant=value;};\nconst server = createServer`);
serverSource = serverSource.replace("const requestPath = request.url?.split('?')[0];", `const requestPath = request.url?.split('?')[0];requests.push({at:Date.now(),path:requestPath,variant});`);
serverSource = serverSource.replace("const target = safePath(request.url || '/');", `let target = safePath(request.url || '/');if(['/linux/boot-manifest.json','/linux/initramfs-firefox.cpio.gz'].includes(requestPath))target=(variant==='candidate'?${JSON.stringify(candidate)}:${JSON.stringify(baseline)})+'/'+requestPath.split('/').at(-1);`);
serverSource = serverSource.replace('const remote = net.connect({ host, port: targetPort });', 'const remote = net.connect({ host, port: targetPort });sockets.add(remote);remote.on("close",()=>sockets.delete(remote));');
serverSource += '\nserver.on("connection",socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));});export {server};\n';
if (!serverSource.includes('let target = safePath') || !serverSource.includes('requests.push')) throw Error('dev-server adapter anchors changed');
await fs.writeFile(out + '/server.mjs', serverSource);
const service = await import(pathToFileURL(out + '/server.mjs').href), server = service.server;
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(HTTP_PORT, '127.0.0.1', resolve); });
service.setVariant(control ? 'baseline' : 'candidate');
const origin = 'http://127.0.0.1:' + server.address().port, guestURL = 'file:///home/admin/sites-probe.html';
let prefs = ['network.http.http2.enabled:false', 'network.http.http3.enable:false', 'toolkit.legacyUserProfileCustomizations.stylesheets:true', 'media.rdd-process.enabled:false', 'media.utility-process.enabled:false', 'media.allow-audio-non-utility:true', 'browser.startup.page:1', 'browser.shell.checkDefaultBrowser:false', 'browser.download.alwaysOpenPanel:false', 'browser.download.panel.shown:true', 'devtools.console.stdout.content:true'].map(s => { const i = s.lastIndexOf(':'); return 'user_pref(' + JSON.stringify(s.slice(0, i)) + ',' + s.slice(i + 1) + ');'; }).join('\n') + '\nuser_pref("browser.startup.homepage",' + JSON.stringify(guestURL) + ');\n';
prefs += 'user_pref("browser.download.folderList",2);\nuser_pref("browser.download.dir","/home/admin/Downloads");\nuser_pref("browser.helperApps.neverAsk.saveToDisk","application/json");\n';
prefs += 'user_pref("datareporting.policy.firstRunURL", "");\n';
// The WebGPU prefs are deliberately NOT set here: they must come from the image.
// Only control-prefs adds them, to show prefs alone cannot pass the compiled gate.
if (mode === 'control-prefs') prefs += 'user_pref("dom.webgpu.enabled", true);\nuser_pref("gfx.webgpu.ignore-blocklist", true);\n';
const executable = '/home/a/.local/archpkg/pacman/usr/bin/chromium';
const args = ['--headless', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + out + '/profile', '--disk-cache-dir=' + out + '/cache', 'about:blank'];
const fd = openSync(out + '/browser.log', 'wx');
const child = spawn(executable, args, { detached: true, env: { ...process.env, XDG_CACHE_HOME: out + '/xdg-cache' }, stdio: ['ignore', fd, fd] }); closeSync(fd);
let exitInfo, spawnError; const exited = new Promise(resolve => { child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(); }); child.once('error', e => { spawnError = String(e); resolve(); }); });
const report = { pass: false, mode, origin, guestURL, serverPid: process.pid, browserPid: child.pid, candidateVersion: pkg.version, baselineVersion: sourceVersion, phases: [], limitations: ['The in-guest wgpu HAL is Empty, so a null adapter is the expected W1 outcome; no GPU work is performed. Launch log is not first paint.'] };
let ws, next = 0; const pending = new Map(), errors = [];
function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP deadline ' + method)); }, 30000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expression) { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(fn, ms, label) { const end = Date.now() + ms; for (;;) { if (await fn()) return; if (Date.now() > end) throw Error(label + ' deadline'); await sleep(200); } }
async function shot(name) { const r = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(out + '/' + name + '.png', Buffer.from(r.data, 'base64')); }
async function key(code, key, down, modifiers = 0) { await call('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key, modifiers }); }
async function textInput(text) { for (const c of text) { if (!/[a-z]/.test(c)) throw Error('unsupported fixture key'); const code = 'Key' + c.toUpperCase(); await key(code, c, true); await sleep(100); await key(code, c, false); } }
const findDownload = (pattern, start, check) => ev(`(async()=>{const h=(await import('./main.js')).guestHome();let n=await h.lookup(h.root,'admin');n=n&&await h.lookup(n,'Downloads');if(!n)return null;for(const e of await h.readdir(n,{})){if(!${pattern}.test(e.name))continue;try{const a=await h.getattr(e.node);if(Number(a.size)>65536)continue;const r=JSON.parse(new TextDecoder().decode(await h.read(e.node,{},0n,Number(a.size))));if(r.createdAt>=${start}&&(${check})(r))return {name:e.name,...r};}catch{}}return null;})()`);
const guestLogs = () => ev(`(async()=>(await import('./main.js')).guestLogs.history.page(undefined,3000).map(l=>l.text).join(String.fromCharCode(10)))()`);
async function phase(label, action) {
  await saveHostCpuPhaseEvidence(report.cpu, await ev(guestCpuPrebootStateExpression), out, label + '-preboot');
  const oldEpoch = await ev('performance.timeOrigin'), start = Date.now(); await action(); let launch, startupLogs;
  await until(async () => { try { if (await ev('performance.timeOrigin') === oldEpoch) return false; const logs = await guestLogs(); if (logs.includes('starting /bin/firefox as admin')) { startupLogs = logs; launch = { elapsedMs: Date.now() - start }; return true; } } catch (e) { if (!/context|Cannot|Failed to fetch/.test(String(e))) throw e; } return false; }, 120000, 'Firefox launch');
  const cpu = await saveGuestCpuEvidence(report.cpu, startupLogs, await ev(guestCpuStateExpression), out, label);
  let probe, lastShot = start;
  await until(async () => { probe = await findDownload('/^webgpu-w1-result-\\d+\\.json$/', start, `r=>r.tag==='webgpu-w1-probe-v1'`); if (!probe && Date.now() - lastShot > 30000) { lastShot = Date.now(); await shot(label + '-waiting-' + String(Math.round((lastShot - start) / 1000)).padStart(3, '0') + 's'); } return Boolean(probe); }, 300000, 'guest WebGPU probe result');
  await fs.writeFile(out + '/' + label + '-probe.json', JSON.stringify({ observedMs: Date.now() - start, probe }, null, 2) + '\n');
  console.log(JSON.stringify({ phase: label, verdict: probe.verdict, probeMs: Date.now() - start }));
  await sleep(1500); await shot(label + '-probe');
  await ev("document.querySelector('#fb').focus()");
  await key('Escape', 'Escape', true); await key('Escape', 'Escape', false); await sleep(500);
  await key('ControlLeft', 'Control', true, 2); await key('KeyA', 'a', true, 2); await key('KeyA', 'a', false, 2); await key('ControlLeft', 'Control', false);
  await textInput('wasmperf'); let result;
  await until(async () => { result = await findDownload('/^sites-qa-result-\\d+\\.json$/', start, `r=>r.input==='wasmperf'&&r.checksum===7998000&&/Firefox\\//.test(r.userAgent)`); return Boolean(result); }, 90000, 'guest input result after WebGPU probe');
  const logs = await guestLogs();
  const state = await ev(`(async()=>({system:await(await import('./boot-assets.mjs')).systemUsage(),browserHardwareConcurrency:navigator.hardwareConcurrency,selectedGuestCpus:Number(document.querySelector('#cpu-cores')?.value),visibility:document.visibilityState,isolated:crossOriginIsolated,images:performance.getEntriesByType('resource').filter(e=>/vmlinux\\.wasm|initramfs.*(?:gz|cpio)/.test(e.name)).map(e=>({name:e.name,transferSize:e.transferSize}))}))()`);
  const logLines = logs.split('\n');
  const evidence = { webgpuLines: logLines.filter(l => /webgpu|wgpu|WEBGPU/i.test(l)).slice(-80), crashLines: logLines.filter(l => /MOZ_CRASH|Assertion failure|panicked|Hit MOZ_|abort\(|RuntimeError|unreachable|Segmentation|exited with/i.test(l)).slice(-40), fatalLines: logLines.filter(l => /MOZ_CRASH|Assertion failure|panicked|Hit MOZ_|Segmentation fault|RuntimeError: unreachable/.test(l)).slice(-40), firefoxExited: /firefox (?:exited|terminated)/i.test(logs) };
  await fs.writeFile(out + '/' + label + '-guest-logs.txt', logs);
  await shot(label + '-functional');
  const expectVersion = control ? sourceVersion : pkg.version;
  const finalCpu = await saveHostCpuPhaseEvidence(cpu, state, out, label + '-final');
  const checks = {
    version: state.system.version === expectVersion, isolated: state.isolated === true, visible: state.visibility === 'visible',
    ...guestCpuChecks(cpu, state, finalCpu.hostNprocObserved),
    config: startupLogs.includes(`display=1280x720, cpus=${cpu.requestedGuestCpus}, ram=4 GB (maximum)`), secureContext: probe.isSecureContext === true,
    inputAfterProbe: Boolean(result), noFatalLines: evidence.fatalLines.length === 0,
  };
  if (mode === 'control') Object.assign(checks, { gpuAbsent: probe.hasGpuProperty === false && probe.gpuType === 'undefined' });
  else if (mode === 'control-prefs') Object.assign(checks, {
    gpuPresent: probe.hasGpuProperty === true && probe.gpuClass === '[object GPU]',
    fourProbes: probe.probes.length === 4,
    allRejectedByReleaseGate: probe.probes.length === 4 && probe.probes.every(p => p.settled === 'rejected' && p.name === 'NotSupportedError' && /not yet available in Release or Beta/.test(p.error)),
  });
  else Object.assign(checks, {
    gpuPresent: probe.hasGpuProperty === true && probe.gpuClass === '[object GPU]',
    fourProbes: probe.probes.length === 4,
    allResolvedNull: probe.probes.length === 4 && probe.probes.every(p => p.settled === 'resolved' && p.isNull === true),
  });
  if (label === 'warm') checks.warmZeroImages = state.images.length === 0;
  const pass = Object.values(checks).every(Boolean);
  report.phases.push({ label, pass, checks, cpu, finalCpu, launch, probe, result, evidence, state });
  await fs.writeFile(out + '/progress.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ phase: label, pass, checks }));
  if (!pass) throw Error(label + ' checks failed: ' + Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(','));
}
try {
  await until(async () => { if (exitInfo || spawnError) throw Error('browser startup failed'); try { return (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version')).ok; } catch { return false; } }, 20000, 'browser');
  const target = (await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json()).find(t => t.type === 'page'); ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params); };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }); await call('Page.enable'); await call('Runtime.enable'); await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: origin + '/linux/boot-manifest.json' }); await until(() => ev("document.readyState==='complete'&&location.pathname.endsWith('boot-manifest.json')"), 10000, 'seed page');
  report.cpu = selectHostCpus(readHostNproc(), await ev('navigator.hardwareConcurrency'));
  await ev(`(async()=>{localStorage.setItem('linuxonweb.machine-settings.v1',JSON.stringify({resolution:'1280x720',cpus:${report.cpu.requestedGuestCpus},ram:4096,backend:'canvas2d'}));const h=await(await import('/linux/persistent-home.mjs')).openPersistentHome();async function dir(p){let n=h.root;for(const s of p.split('/').filter(Boolean))n=await h.lookup(n,s)||await h.mkdir(n,s,{mode:0o755,uid:1000,gid:1000});return n;}async function put(p,text){const parts=p.split('/'),name=parts.pop(),parent=await dir(parts.join('/'));const f=await h.create(parent,name,2,{mode:0o644,uid:1000,gid:1000});await h.write(f.node,f.handle,0n,new TextEncoder().encode(text));await h.release(f.node,f.handle);}await dir('admin/Downloads');await put('admin/sites-probe.html',${JSON.stringify(probeFixture)});await put('admin/.mozilla/firefox/http1-profile/user.js',${JSON.stringify(prefs)});await h.destroy();return true;})()`);
  const url = origin + '/linux/index.html?firefox=1&renderer=canvas2d';
  const manifest = await ev(`fetch('/linux/boot-manifest.json',{cache:'no-store'}).then(r=>r.json())`);
  if (manifest.version !== (control ? sourceVersion : pkg.version)) throw Error('served manifest mismatch');
  await phase('cold', () => call('Page.navigate', { url }));
  if (!control) await phase('warm', () => call('Page.reload', { ignoreCache: true }));
  for (const [p, h] of Object.entries(inputs)) if (sha(await fs.readFile(p)) !== h) throw Error('input changed ' + p);
  report.finalCpu = await saveHostCpuPhaseEvidence(report.phases.at(-1).cpu, await ev(guestCpuStateExpression), out, 'end');
  if (errors.length) throw Error('outer browser exceptions');
  report.pass = true;
} catch (error) { report.error = String(error.stack || error); try { await fs.writeFile(out + '/failure-guest-logs.txt', await guestLogs()); await shot('failure'); } catch {} }
finally {
  if (ws?.readyState === 1) { try { await call('Page.navigate', { url: 'about:blank' }); await call('Browser.close'); } catch {} }
  for (const p of pending.values()) clearTimeout(p.timer); ws?.close(); await Promise.race([exited, sleep(5000)]);
  if (!exitInfo && !spawnError) { process.kill(-child.pid, 'SIGTERM'); await Promise.race([exited, sleep(5000)]); report.pass = false; report.forcedTermination = true; }
  for (const socket of service.sockets) socket.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  report.browserExit = exitInfo; report.serverClosed = !server.listening; report.errors = errors; report.requests = service.requests.length; report.inputs = inputs;
  if (exitInfo?.code !== 0 || !report.serverClosed) report.pass = false;
  await fs.writeFile(out + '/result.json', JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ pass: report.pass, mode: report.mode, phases: report.phases.map(p => [p.label, p.pass]), error: report.error, out })); if (!report.pass) process.exitCode = 1;
