// Finite actual-guest Firefox DevTools gate: one owned HTTP server (4193) and
// one owned headless Chromium (CDP 9403). Real guest keyboard input opens the
// DevTools toolbox, evaluates console input and optionally the Browser Console.
// Usage: node test-firefox-devtools.mjs OUTPUT IMAGE_DIR STEPS [diag]
//   IMAGE_DIR contains boot-manifest.json and initramfs-firefox.cpio.gz.
//   STEPS is a comma list of f12, console, eval, inspector, browserconsole, warm.
//   console opens the web console (Ctrl+Shift+K), whose input takes focus; warm
//   reloads the page and requires fixture readiness with zero system-image fetches.
// All profiles, scratch, logs and screenshots stay on the disk-backed task path.
import fs from 'node:fs/promises';
import { readHostNproc, selectHostCpus, guestCpuChecks, guestCpuStateExpression, saveGuestCpuEvidence } from './firefox-host-cpus.mjs';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const task = '/mnt/p6/build/firefox-devtools-20260928';
const out = path.resolve(process.argv[2]), image = path.resolve(process.argv[3] || '');
const steps = (process.argv[4] || 'f12').split(',').filter(Boolean), diag = process.argv[5] === 'diag';
for (const s of steps) if (!['f12', 'console', 'eval', 'inspector', 'browserconsole', 'warm'].includes(s)) throw Error('unknown step ' + s);
const HTTP_PORT = 4193, CDP_PORT = 9403;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hostNproc = readHostNproc();
for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
  const actual = await fs.realpath(process.env[key]), stat = await fs.statfs(actual);
  if (!actual.startsWith(task + '/') || [0x01021994, 0x858458f6].includes(stat.type) || stat.bavail * stat.bsize < 2 * 1024 ** 3) throw Error('disk-backed task scratch required');
}
if (!out.startsWith(task + '/')) throw Error('output outside task');
await fs.mkdir(out);
const manifest = JSON.parse(await fs.readFile(image + '/boot-manifest.json', 'utf8'));
const inputs = {};
for (const source of [fileURLToPath(import.meta.url), fileURLToPath(new URL('./firefox-host-cpus.mjs', import.meta.url)), path.join(repo, 'web/desktop/dev-server.mjs'), ...['main.js', 'persistent-home.mjs', 'boot-assets.mjs', 'vmlinux.wasm', 'initramfs.cpio'].map(s => path.join(repo, 'web/linux', s)), image + '/boot-manifest.json', image + '/initramfs-firefox.cpio.gz']) inputs[source] = sha(await fs.readFile(source));
if (inputs[image + '/initramfs-firefox.cpio.gz'] !== manifest.assets.firefox.sha256) throw Error('image/manifest mismatch');
await fs.writeFile(out + '/inputs-before.json', JSON.stringify(inputs, null, 2) + '\n');
await fs.copyFile(fileURLToPath(import.meta.url), out + '/runner.mjs');
await fs.copyFile(fileURLToPath(new URL('./firefox-host-cpus.mjs', import.meta.url)), out + '/firefox-host-cpus.mjs');
const guestURL = 'file:///home/admin/devtools-probe.html';
// The fixture logs a marker, reports readiness through a guest download, and
// downloads a second file when console evaluation changes document.title.
const fixture = `<!doctype html><meta charset="utf-8"><title>devtools probe</title><style>body{font:22px sans-serif;background:#f4f9ff;margin:30px}</style><h1 id="head">DevTools probe page</h1><p>Press F12 to open the web console.</p><ul id="list"><li class="item">alpha</li><li class="item">beta</li></ul><script>
function save(prefix,r){const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(r)],{type:'application/json'}));link.download=prefix+r.createdAt+'.json';link.click();}
console.log("devtools-ok");
requestAnimationFrame(()=>save('devtools-ready-',{tag:'devtools-ready-v1',createdAt:Date.now(),url:location.href,userAgent:navigator.userAgent}));
let seen=false;setInterval(()=>{if(!seen&&document.title==='dt-3'){seen=true;save('devtools-eval-',{tag:'devtools-eval-v1',title:document.title,createdAt:Date.now(),userAgent:navigator.userAgent});}},250);
</script>`;
let serverSource = await fs.readFile(path.join(repo, 'web/desktop/dev-server.mjs'), 'utf8');
serverSource = serverSource.slice(0, serverSource.indexOf('server.listen(port,'));
serverSource = serverSource.replace("const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));", 'const root = ' + JSON.stringify(repo) + ';');
serverSource = serverSource.replace('const server = createServer', 'export const requests=[],sockets=new Set();\nconst server = createServer');
serverSource = serverSource.replace("const requestPath = request.url?.split('?')[0];", 'const requestPath = request.url?.split(\'?\')[0];requests.push({at:Date.now(),path:requestPath});');
serverSource = serverSource.replace("const target = safePath(request.url || '/');", `let target = safePath(request.url || '/');if(['/linux/boot-manifest.json','/linux/initramfs-firefox.cpio.gz'].includes(requestPath))target=${JSON.stringify(image)}+'/'+requestPath.split('/').at(-1);`);
serverSource = serverSource.replace('const remote = net.connect({ host, port: targetPort });', 'const remote = net.connect({ host, port: targetPort });sockets.add(remote);remote.on("close",()=>sockets.delete(remote));');
serverSource += '\nserver.on("connection",socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));});export {server};\n';
await fs.writeFile(out + '/server.mjs', serverSource);
const service = await import(pathToFileURL(out + '/server.mjs').href), server = service.server;
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(HTTP_PORT, '127.0.0.1', resolve); });
const origin = 'http://127.0.0.1:' + HTTP_PORT;
const pref = (k, v) => 'user_pref(' + JSON.stringify(k) + ',' + v + ');\n';
let prefs = [['network.http.http2.enabled', 'false'], ['network.http.http3.enable', 'false'], ['toolkit.legacyUserProfileCustomizations.stylesheets', 'true'], ['media.rdd-process.enabled', 'false'], ['media.utility-process.enabled', 'false'], ['media.allow-audio-non-utility', 'true'], ['browser.startup.page', '1'], ['browser.shell.checkDefaultBrowser', 'false'], ['browser.download.alwaysOpenPanel', 'false'], ['browser.download.panel.shown', 'true'], ['browser.startup.homepage', JSON.stringify(guestURL)], ['browser.download.folderList', '2'], ['browser.download.dir', '"/home/admin/Downloads"'], ['browser.helperApps.neverAsk.saveToDisk', '"application/json"'], ['datareporting.policy.firstRunURL', '""']].map(([k, v]) => pref(k, v)).join('');
// Diagnostic-only: route chrome JS errors, dump() and console calls to stderr,
// which the guest console log collects. Not used for acceptance runs.
if (diag) prefs += [['browser.dom.window.dump.enabled', 'true'], ['devtools.console.stdout.chrome', 'true'], ['devtools.console.stdout.content', 'true'], ['devtools.debugger.log', 'true'], ['devtools.dump.emit', 'true']].map(([k, v]) => pref(k, v)).join('');
const executable = '/home/a/.local/archpkg/pacman/usr/bin/chromium';
const args = ['--headless', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + out + '/profile', '--disk-cache-dir=' + out + '/cache', 'about:blank'];
const fd = openSync(out + '/browser.log', 'wx');
const child = spawn(executable, args, { detached: true, env: { ...process.env, XDG_CACHE_HOME: out + '/xdg-cache' }, stdio: ['ignore', fd, fd] }); closeSync(fd);
let exitInfo, spawnError; const exited = new Promise(resolve => { child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(); }); child.once('error', e => { spawnError = String(e); resolve(); }); });
const report = { pass: false, origin, cdpPort: CDP_PORT, image, version: manifest.version, steps, diag, serverPid: process.pid, browserPid: child.pid, events: [], limitations: ['Fixed observation waits are not speed benchmarks. Screenshots must be inspected; automated checks cover guest-side effects only.'] };
let ws, next = 0; const pending = new Map(), errors = [];
function call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP deadline ' + method)); }, 60000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expression) { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(fn, ms, label) { const end = Date.now() + ms; for (;;) { if (await fn()) return; if (Date.now() > end) throw Error(label + ' deadline'); await sleep(500); } }
async function shot(name) { const r = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(out + '/' + name + '.png', Buffer.from(r.data, 'base64')); }
async function logs(name) { const text = await ev(`(async()=>(await import('./main.js')).guestLogs.history.page(undefined,10000).map(l=>l.text).join(String.fromCharCode(10)))()`); await fs.writeFile(out + '/' + name + '.log', text + '\n'); return text; }
async function waitForGuestLaunch(label, previousEpoch, start) {
  let startupLogs;
  await until(async () => {
    try {
      if (await ev('performance.timeOrigin') === previousEpoch) return false;
      const text = await ev(`(async()=>(await import('./main.js')).guestLogs.history.page(undefined,10000).map(l=>l.text).join(String.fromCharCode(10)))()`);
      if (text.includes('starting /bin/firefox as admin')) { startupLogs = text; return true; }
    } catch (e) { if (!/context|Cannot|Failed to fetch/.test(String(e))) throw e; }
    return false;
  }, 120000, label + ' Firefox launch');
  const cpu = await saveGuestCpuEvidence(report.cpu, startupLogs, await ev(guestCpuStateExpression), out, label);
  if (!startupLogs.includes(`display=1280x720, cpus=${cpu.requestedGuestCpus}, ram=4 GB (maximum)`)) throw Error(label + ' configuration mismatch');
  const launch = { label, elapsedMs: Date.now() - start, cpu };
  (report.cpuBoots ||= []).push(launch);
  return launch;
}
async function key(code, key, down, modifiers = 0) { await call('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', code, key, modifiers }); }
async function press(code, keyName, mods = []) {
  const table = { ctrl: ['ControlLeft', 'Control', 2], shift: ['ShiftLeft', 'Shift', 8], alt: ['AltLeft', 'Alt', 1] };
  let m = 0; for (const x of mods) { m |= table[x][2]; await key(table[x][0], table[x][1], true, m); }
  await key(code, keyName, true, m); await sleep(120); await key(code, keyName, false, m);
  for (const x of [...mods].reverse()) { m &= ~table[x][2]; await key(table[x][0], table[x][1], false, m); }
}
async function textInput(text) {
  const map = { ':': ['Semicolon', 1], '/': ['Slash', 0], '.': ['Period', 0], '-': ['Minus', 0], '_': ['Minus', 1], '=': ['Equal', 0], '+': ['Equal', 1], '"': ['Quote', 1], '(': ['Digit9', 1], ')': ['Digit0', 1], ' ': ['Space', 0] };
  for (const c of text) {
    let code, shift = 0;
    if (/[a-z]/.test(c)) code = 'Key' + c.toUpperCase(); else if (/[0-9]/.test(c)) code = 'Digit' + c; else if (map[c]) [code, shift] = map[c];
    if (!code) throw Error('unsupported fixture key ' + c);
    await press(code, c, shift ? ['shift'] : []); await sleep(80);
  }
}
async function download(prefix, start) {
  return ev(`(async()=>{const h=(await import('./main.js')).guestHome();let n=await h.lookup(h.root,'admin');n=n&&await h.lookup(n,'Downloads');if(!n)return null;for(const e of await h.readdir(n,{})){if(!e.name.startsWith(${JSON.stringify(prefix)})||!e.name.endsWith('.json'))continue;try{const a=await h.getattr(e.node);if(Number(a.size)>4096)continue;const r=JSON.parse(new TextDecoder().decode(await h.read(e.node,{},0n,Number(a.size))));if(r.createdAt>=${start}&&/Firefox/.test(r.userAgent))return r;}catch{}}return null;})()`);
}
async function observe(label, seconds, every = 15) {
  const t0 = Date.now();
  for (let i = 1; (Date.now() - t0) / 1000 < seconds; i++) { await sleep(every * 1000); await shot(label + '-' + String(Math.round((Date.now() - t0) / 1000)).padStart(3, '0') + 's'); }
  await logs(label);
}
function note(event) { event.at = Date.now(); report.events.push(event); console.log(JSON.stringify(event)); }
try {
  await until(async () => { if (exitInfo || spawnError) throw Error('browser startup failed'); try { return (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version')).ok; } catch { return false; } }, 20000, 'browser');
  const target = (await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json()).find(t => t.type === 'page'); ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params); };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }); await call('Page.enable'); await call('Runtime.enable'); await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: origin + '/linux/boot-manifest.json' }); await until(() => ev("document.readyState==='complete'&&location.pathname.endsWith('boot-manifest.json')"), 10000, 'seed page');
  report.cpu = selectHostCpus(hostNproc, await ev('navigator.hardwareConcurrency'));
  await ev(`(async()=>{localStorage.setItem('linuxonweb.machine-settings.v1',JSON.stringify({resolution:'1280x720',cpus:${report.cpu.requestedGuestCpus},ram:4096,backend:'canvas2d'}));const h=await(await import('/linux/persistent-home.mjs')).openPersistentHome();async function dir(p){let n=h.root;for(const s of p.split('/').filter(Boolean))n=await h.lookup(n,s)||await h.mkdir(n,s,{mode:0o755,uid:1000,gid:1000});return n;}async function put(p,text){const parts=p.split('/'),name=parts.pop(),parent=await dir(parts.join('/'));const f=await h.create(parent,name,2,{mode:0o644,uid:1000,gid:1000});await h.write(f.node,f.handle,0n,new TextEncoder().encode(text));await h.release(f.node,f.handle);}await put('admin/devtools-marker.txt','devtools-home-v1\\n');await dir('admin/Downloads');await put('admin/devtools-probe.html',${JSON.stringify(fixture)});await put('admin/.mozilla/firefox/http1-profile/user.js',${JSON.stringify(prefs)});await h.destroy();return true;})()`);
  const previousEpoch = await ev('performance.timeOrigin'), start = Date.now();
  await call('Page.navigate', { url: origin + '/linux/index.html?firefox=1&renderer=canvas2d' });
  const coldLaunch = await waitForGuestLaunch('cold', previousEpoch, start);
  let ready; await until(async () => { try { ready = await download('devtools-ready-', start); } catch (e) { if (!/context|Cannot|Failed to fetch/.test(String(e))) throw e; } return Boolean(ready); }, 240000, 'guest fixture readiness');
  const state = await ev(`(async()=>({system:await(await import('./boot-assets.mjs')).systemUsage(),browserHardwareConcurrency:navigator.hardwareConcurrency,selectedGuestCpus:Number(document.querySelector('#cpu-cores')?.value),isolated:crossOriginIsolated}))()`);
  const coldChecks = guestCpuChecks(coldLaunch.cpu, state);
  if (state.system.version !== manifest.version || !state.isolated || !Object.values(coldChecks).every(Boolean)) throw Error('version/isolation/CPU mismatch');
  report.cold = { launch: coldLaunch, state, checks: coldChecks };
  note({ step: 'ready', ms: Date.now() - start, version: state.system.version });
  await sleep(3000); await shot('00-ready'); await logs('00-ready');
  await ev("document.querySelector('#fb').focus()");
  for (const step of steps) {
    const t = Date.now();
    if (step === 'f12') { await press('F12', 'F12'); note({ step: 'f12-sent' }); await observe('10-f12', 180, 20); }
    if (step === 'console') { await press('KeyK', 'k', ['ctrl', 'shift']); note({ step: 'ctrl-shift-k-sent' }); await observe('15-console', 100, 20); }
    if (step === 'warm') {
      const warmEpoch = await ev('performance.timeOrigin'), w = Date.now(); await call('Page.navigate', { url: origin + '/linux/index.html?firefox=1&renderer=canvas2d' });
      const warmLaunch = await waitForGuestLaunch('warm', warmEpoch, w);
      let r; await until(async () => { try { r = await download('devtools-ready-', w); } catch (e) { if (!/context|Cannot|Failed to fetch/.test(String(e))) throw e; } return Boolean(r); }, 240000, 'warm fixture readiness');
      const images = Object.values(manifest.assets).map(a => '/linux/' + a.url.replace(/^\.\//, ''));
      const fetched = service.requests.filter(q => q.at >= w && images.includes(q.path)).map(q => q.path);
      const warmState = await ev(`(async()=>({system:await(await import('./boot-assets.mjs')).systemUsage(),browserHardwareConcurrency:navigator.hardwareConcurrency,selectedGuestCpus:Number(document.querySelector('#cpu-cores')?.value),isolated:crossOriginIsolated}))()`);
      const warmChecks = { ...guestCpuChecks(warmLaunch.cpu, warmState), version: warmState.system.version === manifest.version, isolated: warmState.isolated === true };
      report.warm = { readyMs: Date.now() - w, imageRequests: fetched, ready: r, launch: warmLaunch, state: warmState, checks: warmChecks };
      if (!Object.values(warmChecks).every(Boolean)) throw Error('warm version/isolation/CPU mismatch');
      note({ step: 'warm-ready', ms: Date.now() - w, imageRequests: fetched.length }); await sleep(3000); await shot('50-warm'); await logs('50-warm');
      if (fetched.length) throw Error('warm boot fetched system images');
    }
    if (step === 'eval') {
      await textInput('1+2'); await press('Enter', 'Enter'); note({ step: 'typed 1+2' }); await observe('20-eval', 40, 20);
      await textInput('document.title="dt-"+(1+2)'); await press('Enter', 'Enter'); note({ step: 'typed title eval' });
      let r; try { await until(async () => Boolean(r = await download('devtools-eval-', t)), 90000, 'console evaluation effect'); } catch (e) { r = null; }
      note({ step: 'eval-result', guestEffect: r }); report.evalEffect = r; await shot('21-eval-title');
    }
    if (step === 'inspector') { await press('KeyC', 'c', ['ctrl', 'shift']); note({ step: 'ctrl-shift-c-sent' }); await observe('30-inspector', 60, 20); await press('Escape', 'Escape'); await sleep(5000); await shot('31-inspector-escape'); }
    if (step === 'browserconsole') { await press('KeyJ', 'j', ['ctrl', 'shift']); note({ step: 'ctrl-shift-j-sent' }); await observe('40-browserconsole', 150, 25); }
  }
  const marker = await ev(`(async()=>{const h=(await import('./main.js')).guestHome();let n=h.root;for(const s of ['admin','devtools-marker.txt'])n=await h.lookup(n,s);const a=await h.getattr(n);return new TextDecoder().decode(await h.read(n,{},0n,Number(a.size)));})()`);
  report.markerPreserved = marker === 'devtools-home-v1\n';
  const finalCpuState = await ev(guestCpuStateExpression);
  report.finalCpu = { ...finalCpuState, checks: guestCpuChecks(report.cpuBoots.at(-1).cpu, finalCpuState) };
  if (!Object.values(report.finalCpu.checks).every(Boolean)) throw Error('final browser/UI CPU count changed');
  for (const [p, h] of Object.entries(inputs)) if (sha(await fs.readFile(p)) !== h) throw Error('input changed ' + p);
  report.pass = report.markerPreserved && errors.length === 0;
} catch (error) { report.error = String(error.stack || error); try { await logs('failure'); await shot('failure'); } catch {} }
finally {
  if (ws?.readyState === 1) { try { await call('Page.navigate', { url: 'about:blank' }); await call('Browser.close'); } catch {} }
  for (const p of pending.values()) clearTimeout(p.timer); ws?.close(); await Promise.race([exited, sleep(5000)]);
  if (!exitInfo && !spawnError) { process.kill(-child.pid, 'SIGTERM'); await Promise.race([exited, sleep(5000)]); report.pass = false; report.forcedTermination = true; }
  for (const socket of service.sockets) socket.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  report.browserExit = exitInfo; report.serverClosed = !server.listening; report.errors = errors; report.requestCount = service.requests.length; report.inputs = inputs;
  if (exitInfo?.code !== 0 || !report.serverClosed) report.pass = false;
  await fs.writeFile(out + '/result.json', JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ pass: report.pass, error: report.error, out }));
if (!report.pass) process.exitCode = 1;
