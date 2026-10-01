// Finite actual-Firefox gate for the F1a WebGL candidate (static Mesa EGL +
// Zink + guest Vulkan ICD linked into firefox; derived from
// test-firefox-gpu-check.mjs). Besides the GPU check verdict it extracts the
// Mesa/EGL/Zink/glxtest/gfx lines the guest printed and the page's
// webglcontextcreationerror text into <phase>-gl-lines.txt and result.json. The seeded profile sets no
// homepage, so the image's distribution.ini default must open
// file:///opt/firefox/gpu-check/gpu-check.html by itself. The page logs its
// verdict to the console, which the guest prints to stdout
// (devtools.console.stdout.content). After it settles, places.sqlite is copied
// out of the persistent home and the distribution bookmark is checked there.
//
// Usage: node test-firefox-webgl-f1a.mjs OUT CANDIDATE
// The outer Chromium runs headful on DISPLAY=:0 with the NVIDIA WebGPU recipe.
// All profiles, scratch and logs stay on the verified disk-backed task path.
// Ports: HTTP 4206, CDP 9416.
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const task = '/mnt/p6/build/firefox-webgl-f1a-20260930';
const HTTP_PORT = 4206, CDP_PORT = 9416;
if (process.argv.length !== 4) throw Error('usage: OUT CANDIDATE');
const out = path.resolve(process.argv[2]), candidate = path.resolve(process.argv[3]);
const pageURL = 'file:///opt/firefox/gpu-check/gpu-check.html';
const node = process.execPath, sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
  const actual = await fs.realpath(process.env[key]), stat = await fs.statfs(actual);
  if (!actual.startsWith(task + '/') || [0x01021994, 0x858458f6].includes(stat.type) || stat.bavail * stat.bsize < 2 * 1024 ** 3) throw Error('disk-backed task scratch required');
}
if (!out.startsWith(task + '/')) throw Error('output outside task'); await fs.mkdir(out);
const pkg = JSON.parse(await fs.readFile(candidate + '/package.json'));
if (!pkg.passPackage || !pkg.candidateOnly || !pkg.distributionIni?.includes(pageURL) || !pkg.added?.['opt/firefox/glxtest']) throw Error('verified isolated F1a package required');
const inputs = {};
for (const source of [fileURLToPath(import.meta.url), path.join(repo, 'web/desktop/dev-server.mjs'), ...['main.js', 'persistent-home.mjs', 'boot-assets.mjs', 'vmlinux.wasm'].map(s => path.join(repo, 'web/linux', s)), candidate + '/boot-manifest.json', candidate + '/initramfs-firefox.cpio.gz']) inputs[source] = sha(await fs.readFile(source));
if (inputs[candidate + '/initramfs-firefox.cpio.gz'] !== pkg.archiveSha256) throw Error('archive identity differs');
await fs.writeFile(out + '/inputs-before.json', JSON.stringify(inputs, null, 2) + '\n');
await fs.copyFile(fileURLToPath(import.meta.url), out + '/runner.mjs');
let serverSource = await fs.readFile(path.join(repo, 'web/desktop/dev-server.mjs'), 'utf8');
serverSource = serverSource.slice(0, serverSource.indexOf("server.listen(port,"));
serverSource = serverSource.replace("const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));", 'const root = ' + JSON.stringify(repo) + ';');
serverSource = serverSource.replace('const server = createServer', `export const requests=[],sockets=new Set();\nconst server = createServer`);
serverSource = serverSource.replace("const requestPath = request.url?.split('?')[0];", `const requestPath = request.url?.split('?')[0];requests.push({at:Date.now(),path:requestPath});`);
serverSource = serverSource.replace("const target = safePath(request.url || '/');", `let target = safePath(request.url || '/');if(['/linux/boot-manifest.json','/linux/initramfs-firefox.cpio.gz'].includes(requestPath))target=${JSON.stringify(candidate)}+'/'+requestPath.split('/').at(-1);`);
serverSource = serverSource.replace('const remote = net.connect({ host, port: targetPort });', 'const remote = net.connect({ host, port: targetPort });sockets.add(remote);remote.on("close",()=>sockets.delete(remote));');
serverSource += '\nserver.on("connection",socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));});export {server};\n';
if (!serverSource.includes('let target = safePath') || !serverSource.includes('requests.push')) throw Error('dev-server adapter anchors changed');
await fs.writeFile(out + '/server.mjs', serverSource);
const service = await import(pathToFileURL(out + '/server.mjs').href), server = service.server;
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(HTTP_PORT, '127.0.0.1', resolve); });
const origin = 'http://127.0.0.1:' + server.address().port;
// Same prefs as the init's user.js plus test plumbing, but no homepage.
const prefs = ['network.http.http2.enabled:false', 'network.http.http3.enable:false', 'toolkit.legacyUserProfileCustomizations.stylesheets:true', 'media.rdd-process.enabled:false', 'media.utility-process.enabled:false', 'media.allow-audio-non-utility:true', 'browser.shell.checkDefaultBrowser:false', 'devtools.console.stdout.content:true', 'devtools.console.stdout.chrome:true'].map(s => { const i = s.lastIndexOf(':'); return 'user_pref(' + JSON.stringify(s.slice(0, i)) + ',' + s.slice(i + 1) + ');'; }).join('\n') + '\nuser_pref("datareporting.policy.firstRunURL", "");\n';
const executable = '/home/a/.local/archpkg/pacman/usr/bin/chromium';
const args = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--window-size=1460,1180', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + out + '/profile', '--disk-cache-dir=' + out + '/cache', 'about:blank'];
const fd = openSync(out + '/browser.log', 'wx');
const child = spawn(executable, args, { detached: true, env: { ...process.env, DISPLAY: ':0', XDG_CACHE_HOME: out + '/xdg-cache' }, stdio: ['ignore', fd, fd] }); closeSync(fd);
let exitInfo, spawnError; const exited = new Promise(resolve => { child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(); }); child.once('error', e => { spawnError = String(e); resolve(); }); });
const report = { pass: false, origin, pageURL, serverPid: process.pid, browserPid: child.pid, candidateVersion: pkg.version, phases: [], limitations: ['Guest WebGPU uses the in-guest Empty wgpu HAL until W4 (host passthrough), so webgpu is expected to report no adapter.', 'F1a links Mesa EGL+Zink+guest ICD; a WebGL context is not required (Zink needs B2a+ ICD features). The exact WebGL/EGL outcome is recorded.'] };
let ws, next = 0; const pending = new Map(), errors = [];
function call(method, params = {}, deadline = 60000) { return new Promise((resolve, reject) => { const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP deadline ' + method)); }, deadline); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expression, deadline) { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, deadline); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(fn, ms, label) { const end = Date.now() + ms; for (;;) { if (await fn()) return; if (Date.now() > end) throw Error(label + ' deadline'); await sleep(500); } }
async function shot(name) { const r = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(out + '/' + name + '.png', Buffer.from(r.data, 'base64')); }
const guestLogs = () => ev(`(async()=>(await import('./main.js')).guestLogs.history.page(undefined,5000).map(l=>l.text).join(String.fromCharCode(10)))()`);
// Copy profile files out of the persistent home (base64 over CDP).
// Chunked: a single whole-file read of a live places.sqlite never returned.
const lookupHome = rel => `(async()=>{const h=(await import('./main.js')).guestHome();let n=h.root;for(const s of ${JSON.stringify(rel)}.split('/')){n=n&&await h.lookup(n,s);}return {h,n};})()`;
async function readHome(rel) {
  const size = await ev(`(async()=>{const {h,n}=await ${lookupHome(rel)};return n?Number((await h.getattr(n)).size):null;})()`);
  if (size === null) return null;
  const parts = [];
  for (let offset = 0; offset < size; offset += 262144) {
    const length = Math.min(262144, size - offset);
    const data = await ev(`(async()=>{const {h,n}=await ${lookupHome(rel)};const b=await h.read(n,{},${offset}n,${length});let s='';for(let i=0;i<b.length;i+=32768)s+=String.fromCharCode(...b.subarray(i,i+32768));return btoa(s);})()`);
    parts.push(Buffer.from(data, 'base64'));
  }
  return Buffer.concat(parts);
}
async function bookmarks(label) {
  const dir = out + '/' + label + '-places';
  await fs.mkdir(dir);
  for (const name of ['places.sqlite', 'places.sqlite-wal']) {
    const data = await readHome('admin/.mozilla/firefox/http1-profile/' + name);
    if (data !== null) await fs.writeFile(dir + '/' + name, data);
  }
  const query = "select b.title, p.url, b.parent from moz_bookmarks b join moz_places p on p.id = b.fk where p.url like 'file:///opt/firefox/gpu-check/%'";
  const rows = execFileSync('/usr/bin/python3', ['-c', 'import json,sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print(json.dumps(c.execute(sys.argv[2]).fetchall()))', dir + '/places.sqlite', query], { encoding: 'utf8' });
  return JSON.parse(rows);
}
async function phase(label, action) {
  const oldEpoch = await ev('performance.timeOrigin'), start = Date.now(); await action(); let launch;
  await until(async () => { try { if (await ev('performance.timeOrigin') === oldEpoch) return false; const logs = await guestLogs(); if (logs.includes('starting /bin/firefox as admin')) { launch = { elapsedMs: Date.now() - start }; return true; } } catch (e) { if (!/context|Cannot|Failed to fetch/.test(String(e))) throw e; } return false; }, 120000, 'Firefox launch');
  let verdict, lastShot = start;
  await until(async () => {
    const logs = await guestLogs();
    // Firefox prints console strings JSON-quoted: console.log: "GPUCHECK ...".
    const line = logs.split('\n').reverse().find(l => /console\.log: "GPUCHECK webgl=(?!pending)\S+ webgpu=(?!pending)\S+ \{/.test(l));
    verdict = line && JSON.parse(line.slice(line.indexOf('"')));
    if (!verdict && Date.now() - lastShot > 30000) { lastShot = Date.now(); await shot(label + '-waiting-' + String(Math.round((lastShot - start) / 1000)).padStart(3, '0') + 's'); }
    return Boolean(verdict);
  }, 420000, 'settled GPU check verdict');
  const observedMs = Date.now() - start;
  const match = /GPUCHECK webgl=(\S+) webgpu=(\S+) (\{.*\})/.exec(verdict);
  const result = { webgl: match[1], webgpu: match[2], info: JSON.parse(match[3]) };
  console.log(JSON.stringify({ phase: label, observedMs, webgl: result.webgl, webgpu: result.webgpu }));
  await sleep(5000); await shot(label + '-page');
  // Places init and distribution bookmarks run late in the slow guest.
  await sleep(60000); await shot(label + '-page-late');
  const rows = await bookmarks(label);
  const logs = await guestLogs(), logLines = logs.split('\n');
  await fs.writeFile(out + '/' + label + '-guest-logs.txt', logs);
  const state = await ev(`(async()=>({system:await(await import('./boot-assets.mjs')).systemUsage(),visibility:document.visibilityState,isolated:crossOriginIsolated,images:performance.getEntriesByType('resource').filter(e=>/vmlinux\\.wasm|initramfs.*(?:gz|cpio)/.test(e.name)).map(e=>({name:e.name,transferSize:e.transferSize}))}))()`);
  const glLines = logLines.filter(l => /EGL|egl|Mesa|MESA|mesa|[Zz]ink|ZINK|glxtest|GLX|[Vv]ulkan|libGL|GLContext|WebGL|webgl|gfx|GFX|FEATURE_|Crash Annotation|guest-vk|icd|tryNativeGL|useEGL|^\* |gpu_hostcall|vsock/.test(l));
  await fs.writeFile(out + '/' + label + '-gl-lines.txt', glLines.join('\n') + '\n');
  const fatalLines = logLines.filter(l => /MOZ_CRASH|Assertion failure|panicked|Hit MOZ_|Segmentation fault|RuntimeError: unreachable/.test(l)).slice(-40);
  const checks = {
    version: state.system.version === pkg.version, isolated: state.isolated === true,
    config: logs.includes('display=1280x720, cpus=2, ram=4 GB (maximum)'),
    pageOpenedByDefault: result.info.webgl.length + result.info.webgpu.length > 0,
    toolbarBookmark: rows.some(r => r[1] === pageURL && r[2] === 3),
    menuBookmark: rows.some(r => r[1] === pageURL && r[2] === 2),
    bookmarksAddedOnce: rows.length === 2,
    noFatalLines: fatalLines.length === 0,
  };
  if (label === 'warm') checks.warmZeroImages = state.images.length === 0;
  const pass = Object.values(checks).every(Boolean);
  report.phases.push({ label, pass, checks, launch, observedMs, result, glLines: glLines.slice(-200), bookmarks: rows, fatalLines, state });
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
  await ev(`(async()=>{localStorage.setItem('linuxonweb.machine-settings.v1',JSON.stringify({resolution:'1280x720',cpus:2,ram:4096,backend:'canvas2d'}));const h=await(await import('/linux/persistent-home.mjs')).openPersistentHome();async function dir(p){let n=h.root;for(const s of p.split('/').filter(Boolean))n=await h.lookup(n,s)||await h.mkdir(n,s,{mode:0o755,uid:1000,gid:1000});return n;}async function put(p,text){const parts=p.split('/'),name=parts.pop(),parent=await dir(parts.join('/'));const f=await h.create(parent,name,2,{mode:0o644,uid:1000,gid:1000});await h.write(f.node,f.handle,0n,new TextEncoder().encode(text));await h.release(f.node,f.handle);}await put('admin/.mozilla/firefox/http1-profile/user.js',${JSON.stringify(prefs)});await h.destroy();return true;})()`);
  const manifest = await ev(`fetch('/linux/boot-manifest.json',{cache:'no-store'}).then(r=>r.json())`);
  if (manifest.version !== pkg.version) throw Error('served manifest mismatch');
  await phase('cold', () => call('Page.navigate', { url: origin + '/linux/index.html?firefox=1&renderer=canvas2d' }));
  await phase('warm', () => call('Page.reload', { ignoreCache: true }));
  for (const [p, h] of Object.entries(inputs)) if (sha(await fs.readFile(p)) !== h) throw Error('input changed ' + p);
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
console.log(JSON.stringify({ pass: report.pass, phases: report.phases.map(p => [p.label, p.pass]), error: report.error, out })); if (!report.pass) process.exitCode = 1;
