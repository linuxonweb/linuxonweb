// Finite guest Firefox benchmark, private archive overlay, dynamic host CPU policy.
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const task = '/mnt/p6/project/build/firefox-gpu-first-20261003';
const hostNproc = Number(execFileSync('nproc', [], { encoding: 'utf8' }).trim());
const HTTP_PORT = 0, CDP_PORT = 9503;
if (process.argv.length !== 4) throw Error('usage: OUT CANDIDATE');
const out = path.resolve(process.argv[2]), candidate = path.resolve(process.argv[3]);
const pageURL = 'file:///opt/firefox/gpu-check/gpu-check.html';
const node = process.execPath, sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
  const actual = await fs.realpath(process.env[key]), stat = await fs.statfs(actual);
  if (!actual.startsWith(task + '/') || [0x01021994, 0x858458f6].includes(stat.type) || stat.bavail * stat.bsize < 20 * 1024 ** 3) throw Error('disk-backed task scratch required');
}
if (!out.startsWith(task + '/')) throw Error('output outside task'); await fs.mkdir(out);
const pkg = JSON.parse(await fs.readFile(candidate + '/package.json'));
if (!pkg.passPackage || !pkg.candidateOnly || pkg.pageUrl !== pageURL) throw Error('verified isolated package required');
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
if (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version').then(() => true, () => false)) throw Error('owned CDP port already in use');
const fd = openSync(out + '/browser.log', 'wx');
const child = spawn(executable, args, { detached: true, env: { ...process.env, DISPLAY: ':0', XDG_CACHE_HOME: out + '/xdg-cache' }, stdio: ['ignore', fd, fd] }); closeSync(fd);
let exitInfo, spawnError; const exited = new Promise(resolve => { child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(); }); child.once('error', e => { spawnError = String(e); resolve(); }); });
const report = { pass: false, diagnosticOnly: true, guestNightlyAcceptancePending: true, origin, pageURL, serverPid: process.pid, browserPid: child.pid, candidateVersion: pkg.version, phases: [], limitations: ['Private GPU diagnostic; unsupported APIs produce no FPS. No Nightly/GPU release acceptance.'] };
let ws, next = 0; const pending = new Map(), errors = [];
function call(method, params = {}, deadline = 60000) { return new Promise((resolve, reject) => { const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP deadline ' + method)); }, deadline); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expression, deadline) { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, deadline); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
async function until(fn, ms, label) { const end = Date.now() + ms; for (;;) { if (await fn()) return; if (Date.now() > end) throw Error(label + ' deadline'); await sleep(500); } }
async function shot(name) { const r = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(out + '/' + name + '.png', Buffer.from(r.data, 'base64')); }
const guestLogs = () => ev(`(async()=>(await import('./main.js')).guestLogs.history.page(undefined,5000).map(l=>l.text).join(String.fromCharCode(10)))()`);
async function phase(label, action) {
  const oldEpoch = await ev('performance.timeOrigin'), start = Date.now(); await action(); let launch;
  await until(async () => { try { if (await ev('performance.timeOrigin') === oldEpoch) return false; const logs = await guestLogs(); if (logs.includes('starting /bin/firefox as admin')) { launch = { elapsedMs: Date.now() - start }; return true; } } catch (e) { if (!/context|Cannot|Failed to fetch/.test(String(e))) throw e; } return false; }, 120000, 'Firefox launch');
  let result;
  await until(async () => {
    const logs = await guestLogs();
    const line = logs.split('\n').reverse().find(l => /console\.log: "GPU_BENCH_RESULT /.test(l));
    if (line) result = JSON.parse(JSON.parse(line.slice(line.indexOf('"'))).slice('GPU_BENCH_RESULT '.length));
    await fs.writeFile(out + '/current-guest-logs.txt', logs);
    return Boolean(result);
  }, 420000, 'completed Firefox GPU benchmark');
  const observedMs = Date.now() - start;
  await shot(label + '-page');
  const logs = await guestLogs(), logLines = logs.split('\n');
  await fs.writeFile(out + '/' + label + '-guest-logs.txt', logs);
  const state = await ev(`(async()=>({system:await(await import('./boot-assets.mjs')).systemUsage(),visibility:document.visibilityState,isolated:crossOriginIsolated,images:performance.getEntriesByType('resource').filter(e=>/vmlinux\\.wasm|initramfs.*(?:gz|cpio)/.test(e.name)).map(e=>({name:e.name,transferSize:e.transferSize}))}))()`);
  const fatalLines = logLines.filter(l => /MOZ_CRASH|Assertion failure|panicked|Hit MOZ_|Segmentation fault|RuntimeError: unreachable/.test(l)).slice(-40);
  const checks = {
    version: state.system.version === pkg.version, isolated: state.isolated === true,
    config: logs.includes(`display=1280x720, cpus=${hostNproc}, ram=4 GB (maximum)`),
    cpuMatchesHost: new RegExp(`smp: Brought up 1 node, ${hostNproc} CPUs`).test(logs),
    pageOpenedByDefault: result.done === true,
    reportedFirefox: /Firefox\//.test(result.identity.userAgent),
    noFatalLines: fatalLines.length === 0,
  };
  if (label === 'warm') checks.warmZeroImages = state.images.length === 0;
  const pass = Object.values(checks).every(Boolean);
  report.phases.push({ label, pass, checks, launch, observedMs, result, fatalLines, state });
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
  report.cpu = {hostNproc,browserBefore:await ev('navigator.hardwareConcurrency')};
  await call('Emulation.setHardwareConcurrencyOverride', {hardwareConcurrency:hostNproc});
  report.cpu.browserAfter = await ev('navigator.hardwareConcurrency');
  await ev(`(async()=>{localStorage.setItem('linuxonweb.machine-settings.v1',JSON.stringify({resolution:'1280x720',cpus:${hostNproc},ram:4096,backend:'canvas2d'}));const h=await(await import('/linux/persistent-home.mjs')).openPersistentHome();async function dir(p){let n=h.root;for(const s of p.split('/').filter(Boolean))n=await h.lookup(n,s)||await h.mkdir(n,s,{mode:0o755,uid:1000,gid:1000});return n;}async function put(p,text){const parts=p.split('/'),name=parts.pop(),parent=await dir(parts.join('/'));const f=await h.create(parent,name,2,{mode:0o644,uid:1000,gid:1000});await h.write(f.node,f.handle,0n,new TextEncoder().encode(text));await h.release(f.node,f.handle);}await put('admin/.mozilla/firefox/http1-profile/user.js',${JSON.stringify(prefs)});await h.destroy();return true;})()`);
  const manifest = await ev(`fetch('/linux/boot-manifest.json',{cache:'no-store'}).then(r=>r.json())`);
  if (manifest.version !== pkg.version) throw Error('served manifest mismatch');
  await phase('cold', () => call('Page.navigate', { url: origin + '/linux/index.html?firefox=1&renderer=canvas2d' }));
  // Warm and Nightly update acceptance remain pending.
  for (const [p, h] of Object.entries(inputs)) if (sha(await fs.readFile(p)) !== h) throw Error('input changed ' + p);
  if (errors.length) throw Error('outer browser exceptions');
  report.pass = true;
  report.gpuAcceptance = report.phases.every(p=>p.result.webgl?.status==='ok'||p.result.webgpu?.status==='ok');
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
