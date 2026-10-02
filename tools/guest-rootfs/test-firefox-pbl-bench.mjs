// JIT packet 3b: interleaved cold-boot A/B of baseline Firefox `fa0217b54d99`
// (archive 6c7fad94) vs PBL `test-pbl-6febc628d9f6f796` (archive 6febc628),
// same kernel and plain rootfs (docs/guest-jit-pbl-diagnosis-20260930.md).
// Derived from test-firefox-gpu-check.mjs. Boot order A B B A A B; each boot
// gets a fresh headless Chromium profile (so no saved system selection, fresh
// home), the arm's manifest/archive, a seeded user.js and the fixture in
// admin/pblbench (lowercase: typed uppercase garbled the URL bar). Navigation is real guest input after Firefox starts.
// The server's DNS/TCP proxy refuses everything (identical in both arms), so
// the init's forced Bing URL fails fast.
//
// Usage: node test-firefox-pbl-bench.mjs OUT     Ports: HTTP 4201, CDP 9411.
// JIT packet 4 reuse: PBLBENCH_TASK overrides the task root and PBLBENCH_ARMS
// names a JSON file {A:{name,dir,version,archiveSha256},B:{...}} replacing the
// two arms (verdict labels then read "B slower/faster than A").
// JIT 6: PBLBENCH_FIXTURE replaces the fixture; the expected case-line count
// is 3 rounds x its case rows.
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const task = process.env.PBLBENCH_TASK || '/mnt/p6/build/guest-jit-pbl-bench-20261001';
const HTTP_PORT = 4201, CDP_PORT = 9411;
if (process.argv.length !== 3) throw Error('usage: OUT');
const out = path.resolve(process.argv[2]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
  const actual = await fs.realpath(process.env[key]), stat = await fs.statfs(actual);
  if (!actual.startsWith(task + '/') || [0x01021994, 0x858458f6].includes(stat.type) || stat.bavail * stat.bsize < 4 * 1024 ** 3) throw Error('disk-backed task scratch required');
}
if (!out.startsWith(task + '/')) throw Error('output outside task'); await fs.mkdir(out);
const arms = process.env.PBLBENCH_ARMS ? JSON.parse(await fs.readFile(process.env.PBLBENCH_ARMS, 'utf8')) : {
  A: { name: 'baseline', dir: '/mnt/p6/build/firefox-ready-20260926/baseline-images', version: 'fa0217b54d99', archiveSha256: '6c7fad946e53f977bc6d55a80323f7ec6a9fa84858d1a245fe0916e2f6d17e65' },
  B: { name: 'pbl', dir: path.join(repo, 'web/linux/tests/runtime-candidates/pbl-v3'), version: 'test-pbl-6febc628d9f6f796', archiveSha256: '6febc628d9f6f7968bdb228d1590adcff83daabd8c6c4b63c8bb6a71c9afb486' },
};
// PBLBENCH_ORDER (e.g. A) is for smoke runs only; it can never pass.
const order = (process.env.PBLBENCH_ORDER || 'ABBAAB').split('');
const fixturePath = process.env.PBLBENCH_FIXTURE ? path.resolve(process.env.PBLBENCH_FIXTURE) : path.join(repo, 'web/linux/tests/guest-jit-pbl-bench.html');
const inputs = {};
for (const source of [fileURLToPath(import.meta.url), fixturePath, path.join(repo, 'web/desktop/dev-server.mjs'), ...['main.js', 'persistent-home.mjs', 'boot-assets.mjs', 'vmlinux.wasm', 'initramfs.cpio'].map(s => path.join(repo, 'web/linux', s)), ...Object.values(arms).flatMap(a => [a.dir + '/boot-manifest.json', a.dir + '/initramfs-firefox.cpio.gz'])]) inputs[source] = sha(await fs.readFile(source));
// Served manifests: the arm's own manifest with the Firefox URL pointed at
// the rewritten /linux/initramfs-firefox.cpio.gz route. Hashes stay exact.
for (const [id, arm] of Object.entries(arms)) {
  if (inputs[arm.dir + '/initramfs-firefox.cpio.gz'] !== arm.archiveSha256) throw Error('archive identity differs ' + id);
  const manifest = JSON.parse(await fs.readFile(arm.dir + '/boot-manifest.json'));
  if (manifest.version !== arm.version || manifest.assets.firefox.sha256 !== arm.archiveSha256) throw Error('manifest identity differs ' + id);
  if (manifest.assets.kernel.sha256 !== inputs[path.join(repo, 'web/linux/vmlinux.wasm')] || manifest.assets.plain.sha256 !== inputs[path.join(repo, 'web/linux/initramfs.cpio')]) throw Error('kernel/plain differ from served copies ' + id);
  manifest.assets.firefox.url = './initramfs-firefox.cpio.gz';
  arm.served = out + '/manifest-' + id + '.json';
  await fs.writeFile(arm.served, JSON.stringify(manifest, null, 2) + '\n');
}
await fs.writeFile(out + '/inputs-before.json', JSON.stringify(inputs, null, 2) + '\n');
await fs.copyFile(fileURLToPath(import.meta.url), out + '/runner.mjs');
await fs.copyFile(fixturePath, out + '/fixture.html');
let serverSource = await fs.readFile(path.join(repo, 'web/desktop/dev-server.mjs'), 'utf8');
serverSource = serverSource.slice(0, serverSource.indexOf("server.listen(port,"));
serverSource = serverSource.replace("const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));", 'const root = ' + JSON.stringify(repo) + ';');
serverSource = serverSource.replace('const server = createServer', `export const requests=[],sockets=new Set();export const armState={manifest:null,archive:null};let refusedDns=0,refusedTcp=0;export const refused=()=>({dns:refusedDns,tcp:refusedTcp});\nconst server = createServer`);
serverSource = serverSource.replace("const requestPath = request.url?.split('?')[0];", `const requestPath = request.url?.split('?')[0];requests.push({at:Date.now(),path:requestPath});`);
serverSource = serverSource.replace("const target = safePath(request.url || '/');", `let target = safePath(request.url || '/');if(requestPath==='/linux/boot-manifest.json')target=armState.manifest;if(requestPath==='/linux/initramfs-firefox.cpio.gz')target=armState.archive;`);
// Refuse the guest network in both arms.
serverSource = serverSource.replace("const addresses = await dns.resolve4(name);", "refusedDns++;throw Error('bench: network refused');");
serverSource = serverSource.replace("if (requestPath === '/tcp') { handleTcpWebSocket(request, socket, head); return; }", "if (requestPath === '/tcp') { refusedTcp++; socket.destroy(); return; }");
serverSource += '\nserver.on("connection",socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));});export {server};\n';
for (const anchor of ['let target = safePath', 'requests.push', "throw Error('bench: network refused')", 'refusedTcp++; socket.destroy()']) if (!serverSource.includes(anchor)) throw Error('dev-server adapter anchor changed: ' + anchor);
await fs.writeFile(out + '/server.mjs', serverSource);
const service = await import(pathToFileURL(out + '/server.mjs').href), server = service.server;
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(HTTP_PORT, '127.0.0.1', resolve); });
const origin = 'http://127.0.0.1:' + server.address().port;
const prefs = ['network.http.http2.enabled:false', 'network.http.http3.enable:false', 'toolkit.legacyUserProfileCustomizations.stylesheets:true', 'media.rdd-process.enabled:false', 'media.utility-process.enabled:false', 'media.allow-audio-non-utility:true', 'browser.shell.checkDefaultBrowser:false', 'devtools.console.stdout.content:true', 'browser.aboutwelcome.enabled:false', 'dom.max_script_run_time:0'].map(s => { const i = s.lastIndexOf(':'); return 'user_pref(' + JSON.stringify(s.slice(0, i)) + ',' + s.slice(i + 1) + ');'; }).join('\n') + '\nuser_pref("datareporting.policy.firstRunURL", "");\n';
const fixture = await fs.readFile(fixturePath, 'utf8');
const expectedCases = 3 * (fixture.match(/^ \['[^']+',/gm) || []).length;
const executable = '/home/a/.local/archpkg/pacman/usr/bin/chromium';
const report = { pass: false, origin, order, arms: Object.fromEntries(Object.entries(arms).map(([k, a]) => [k, { name: a.name, version: a.version, archiveSha256: a.archiveSha256 }])), boots: [], serverPid: process.pid };

// One boot = one owned headless Chromium with a fresh profile.
async function boot(index, armId) {
  const arm = arms[armId], label = armId.toLowerCase() + '-' + (index + 1), dir = out + '/boot' + (index + 1) + '-' + armId;
  await fs.mkdir(dir);
  service.armState.manifest = arm.served; service.armState.archive = arm.dir + '/initramfs-firefox.cpio.gz';
  const fileName = 'pblbench-' + label + '.html', url = 'file:///home/admin/pblbench/' + fileName;
  const args = ['--headless', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + dir + '/profile', '--disk-cache-dir=' + dir + '/cache', 'about:blank'];
  const fd = openSync(dir + '/browser.log', 'wx');
  const child = spawn(executable, args, { detached: true, env: { ...process.env, XDG_CACHE_HOME: dir + '/xdg-cache' }, stdio: ['ignore', fd, fd] }); closeSync(fd);
  let exitInfo, spawnError; const exited = new Promise(resolve => { child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(); }); child.once('error', e => { spawnError = String(e); resolve(); }); });
  const rec = { index: index + 1, arm: armId, label, browserPid: child.pid, pass: false, navAttempts: 0, cases: [] };
  let ws, next = 0; const pending = new Map(), errors = [];
  const call = (method, params = {}, deadline = 60000) => new Promise((resolve, reject) => { const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP deadline ' + method)); }, deadline); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression, deadline) => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, deadline); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const until = async (fn, ms, what) => { const end = Date.now() + ms; for (;;) { if (await fn()) return; if (Date.now() > end) throw Error(what + ' deadline'); await sleep(500); } };
  const shot = async name => { const r = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(dir + '/' + name + '.png', Buffer.from(r.data, 'base64')); };
  const guestLogs = () => ev(`(async()=>(await import('./main.js')).guestLogs.history.page(undefined,5000).map(l=>l.text).join(String.fromCharCode(10)))()`);
  const key = async (k, code, v, modifiers = 0, type) => { const a = { key: k, code, windowsVirtualKeyCode: v, nativeVirtualKeyCode: v, modifiers }; if (type !== 'up') await call('Input.dispatchKeyEvent', { type: 'keyDown', ...a }); if (type !== 'down') await call('Input.dispatchKeyEvent', { type: 'keyUp', ...a }); };
  const clickGuest = async (x, y) => { const r = await ev("(()=>{const c=document.querySelector('canvas'),r=c.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,width:c.width,height:c.height}})()"); const p = { x: r.x + x * r.w / r.width, y: r.y + y * r.h / r.height }; await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p, buttons: 0 }); await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1 }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', buttons: 0, clickCount: 1 }); };
  const typeText = async text => { for (const ch of text) { const code = /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : /[0-9]/.test(ch) ? 'Digit' + ch : ({ '.': 'Period', '/': 'Slash', '-': 'Minus', ':': 'Semicolon' })[ch]; if (!code) throw Error('unsupported URL character ' + ch); const v = ({ '.': 190, '/': 191, '-': 189, ':': 186 })[ch] || ch.toUpperCase().charCodeAt(0), shifted = ch === ':'; if (shifted) await key('Shift', 'ShiftLeft', 16, 1, 'down'); await call('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, windowsVirtualKeyCode: v, nativeVirtualKeyCode: v, text: ch, modifiers: shifted ? 1 : 0 }); await key(ch, code, v, shifted ? 1 : 0, 'up'); if (shifted) await key('Shift', 'ShiftLeft', 16, 0, 'up'); await sleep(180); } };
  const benchLines = logs => logs.split('\n').filter(l => l.includes('console.log: "PBLBENCH ')).flatMap(l => { try { return [JSON.parse(JSON.parse(l.slice(l.indexOf('"'))).slice(9))]; } catch { return []; } });
  try {
    await until(async () => { if (exitInfo || spawnError) throw Error('browser startup failed'); try { return (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/version')).ok; } catch { return false; } }, 20000, 'browser');
    const target = (await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json/list')).json()).find(t => t.type === 'page'); ws = new WebSocket(target.webSocketDebuggerUrl);
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params); };
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }); await call('Page.enable'); await call('Runtime.enable'); await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: origin + '/linux/boot-manifest.json' }); await until(() => ev("document.readyState==='complete'&&location.pathname.endsWith('boot-manifest.json')"), 10000, 'seed page');
    await ev(`(async()=>{localStorage.removeItem('linuxonweb.system.active.v1');localStorage.setItem('linuxonweb.machine-settings.v1',JSON.stringify({resolution:'1280x720',cpus:2,ram:4096,backend:'canvas2d'}));const h=await(await import('/linux/persistent-home.mjs')).openPersistentHome();async function dir(p){let n=h.root;for(const s of p.split('/').filter(Boolean))n=await h.lookup(n,s)||await h.mkdir(n,s,{mode:0o755,uid:1000,gid:1000});return n;}async function put(p,text){const parts=p.split('/'),name=parts.pop(),parent=await dir(parts.join('/'));const f=await h.create(parent,name,2,{mode:0o644,uid:1000,gid:1000});await h.write(f.node,f.handle,0n,new TextEncoder().encode(text));await h.release(f.node,f.handle);}await put('admin/.mozilla/firefox/http1-profile/user.js',${JSON.stringify(prefs)});await put('admin/pblbench/${fileName}',${JSON.stringify(fixture)});await h.destroy();return true;})()`);
    const manifest = await ev(`fetch('/linux/boot-manifest.json',{cache:'no-store'}).then(r=>r.json())`);
    if (manifest.version !== arm.version) throw Error('served manifest mismatch');
    const start = Date.now();
    await call('Page.navigate', { url: origin + '/linux/index.html?firefox=1&renderer=canvas2d&gpu=0' });
    await until(async () => { try { if ((await guestLogs()).includes('starting /bin/firefox as admin')) { rec.launchMs = Date.now() - start; return true; } } catch (e) { if (!/context|Cannot|Failed to fetch/.test(String(e))) throw e; } return false; }, 180000, 'Firefox launch');
    await sleep(20000);
    // Real input: address bar, select all, type, Enter; retry if the fixture
    // has not logged its start line (Firefox window not ready yet).
    for (;;) {
      rec.navAttempts++;
      await clickGuest(600, 130); await sleep(100);
      await key('Control', 'ControlLeft', 17, 2, 'down'); await sleep(80); await key('a', 'KeyA', 65, 2, 'down'); await sleep(80); await key('a', 'KeyA', 65, 2, 'up'); await sleep(80); await key('Control', 'ControlLeft', 17, 0, 'up'); await sleep(80);
      const focus = await ev("({hasFocus:document.hasFocus(),activeId:document.activeElement?.id})");
      if (focus.activeId !== 'fb') throw Error('host canvas lost focus: ' + JSON.stringify(focus));
      await typeText(url); await key('Enter', 'Enter', 13);
      rec.navigatedMs = Date.now() - start;
      try { await until(async () => benchLines(await guestLogs()).some(l => l.event === 'start' && l.label === label), 45000, 'fixture start'); break; } catch (e) { await shot('nav-attempt-' + rec.navAttempts); if (rec.navAttempts >= 4) throw e; }
    }
    await shot('fixture');
    await until(async () => benchLines(await guestLogs()).some(l => l.event === 'done' && l.label === label), 900000, 'PBLBENCH done');
    rec.doneMs = Date.now() - start;
    const logs = await guestLogs(); await fs.writeFile(dir + '/guest-logs.txt', logs);
    const lines = benchLines(logs).filter(l => l.label === label);
    const startLine = lines.find(l => l.event === 'start'), done = lines.find(l => l.event === 'done');
    rec.hardwareConcurrency = startLine.hc; rec.userAgent = startLine.ua; rec.benchElapsedMs = done.elapsedMs; rec.benchOk = done.ok;
    rec.cases = lines.filter(l => l.event === 'case').map(({ round, name, checksum, batchMs, medianBatchMs }) => ({ round, name, checksum, batchMs, medianBatchMs }));
    rec.errorLines = lines.filter(l => l.event === 'error');
    const state = await ev(`(async()=>({system:(await(await import('./boot-assets.mjs')).systemUsage()).version,isolated:crossOriginIsolated,visibility:document.visibilityState}))()`);
    rec.state = state;
    rec.checks = { version: state.system === arm.version, isolated: state.isolated === true, config: logs.includes('cpus=2, ram=4 GB'), benchOk: done.ok === true, cases: rec.cases.length === expectedCases, outerErrors: errors.length === 0 };
    rec.pbljitLines = logs.split('\n').filter(l => l.includes('PBLJIT')).slice(-60);
    rec.fatalLines = logs.split('\n').filter(l => /MOZ_CRASH|Assertion failure|panicked|Hit MOZ_|Segmentation fault|RuntimeError: unreachable/.test(l)).slice(-20);
    rec.pass = Object.values(rec.checks).every(Boolean);
  } catch (error) { rec.error = String(error.stack || error); try { await fs.writeFile(dir + '/failure-guest-logs.txt', await guestLogs()); await shot('failure'); } catch {} }
  finally {
    if (ws?.readyState === 1) { try { await call('Page.navigate', { url: 'about:blank' }); await call('Browser.close'); } catch {} }
    for (const p of pending.values()) clearTimeout(p.timer); ws?.close(); await Promise.race([exited, sleep(10000)]);
    if (!exitInfo && !spawnError) { process.kill(-child.pid, 'SIGTERM'); await Promise.race([exited, sleep(5000)]); rec.forcedTermination = true; rec.pass = false; }
    rec.browserExit = exitInfo; rec.outerErrors = errors;
    if (exitInfo?.code !== 0) rec.pass = false;
  }
  console.log(JSON.stringify({ boot: rec.index, arm: armId, pass: rec.pass, launchMs: rec.launchMs, navAttempts: rec.navAttempts, benchElapsedMs: rec.benchElapsedMs, error: rec.error }));
  return rec;
}

const median = xs => { const s = xs.slice().sort((a, b) => a - b), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };
function classify() {
  const names = [...new Set(report.boots.flatMap(b => b.cases.map(c => c.name)))], verdicts = {};
  for (const name of names) {
    // Per-boot median over all 33 timed batches (3 rounds x 11), per rep.
    const perBoot = id => report.boots.filter(b => b.arm === id).map(b => median(b.cases.filter(c => c.name === name).flatMap(c => c.batchMs)) / 100);
    const a = perBoot('A'), b = perBoot('B');
    const spreadA = Math.max(...a) / Math.min(...a), spreadB = Math.max(...b) / Math.min(...b), ratio = median(b) / median(a);
    const checksums = new Set(report.boots.flatMap(x => x.cases.filter(c => c.name === name).map(c => c.checksum)));
    let verdict;
    if (spreadA > 1.10 || spreadB > 1.10) verdict = 'noise-bound';
    else if (ratio >= 1.10 && Math.min(...b) > Math.max(...a)) verdict = 'PBL slower';
    else if (ratio <= 1 / 1.10 && Math.max(...b) < Math.min(...a)) verdict = 'PBL faster';
    else verdict = 'equal within noise';
    verdicts[name] = { baselineMsPerRep: a.map(x => +x.toFixed(5)), pblMsPerRep: b.map(x => +x.toFixed(5)), spreadA: +spreadA.toFixed(3), spreadB: +spreadB.toFixed(3), ratio: +ratio.toFixed(3), checksumsIdentical: checksums.size === 1, verdict };
  }
  const v = n => verdicts[n]?.verdict;
  const hyp = {
    H1_noise: ['int-loop', 'prop-mono', 'json'].every(n => v(n) === 'equal within noise'),
    H2_exceptions: (v('throw-flat') === 'PBL slower' || v('throw-deep') === 'PBL slower') && v('call-recursion') !== 'PBL slower',
    H3_dispatch: v('int-loop') === 'PBL slower',
    H4_props: v('prop-mono') === 'PBL slower' && v('int-loop') === 'equal within noise',
    fpcastControlValid: v('native-call') === 'equal within noise',
  };
  const launch = id => report.boots.filter(b => b.arm === id).map(b => b.launchMs);
  hyp.H5_launchMs = { baseline: launch('A'), pbl: launch('B') };
  return { verdicts, hypotheses: hyp };
}
try {
  for (let i = 0; i < order.length; i++) { const rec = await boot(i, order[i]); report.boots.push(rec); await fs.writeFile(out + '/progress.json', JSON.stringify(report, null, 2) + '\n'); }
  const harness = order.join('') === 'ABBAAB' && report.boots.length === 6 && report.boots.every(b => b.pass);
  if (harness) Object.assign(report, classify());
  const changed = []; for (const [p, h] of Object.entries(inputs)) if (sha(await fs.readFile(p)) !== h) changed.push(p);
  report.inputsUnchanged = changed.length === 0; report.changedInputs = changed;
  report.checksumsIdentical = harness && Object.values(report.verdicts).every(x => x.checksumsIdentical);
  report.pass = harness && report.inputsUnchanged && report.checksumsIdentical;
} catch (error) { report.error = String(error.stack || error); }
finally {
  for (const socket of service.sockets) socket.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  report.serverClosed = !server.listening; report.requests = service.requests.length; report.refused = service.refused(); report.inputs = inputs;
  if (!report.serverClosed) report.pass = false;
  await fs.writeFile(out + '/result.json', JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ pass: report.pass, verdicts: report.verdicts && Object.fromEntries(Object.entries(report.verdicts).map(([k, x]) => [k, [x.ratio, x.verdict]])), hypotheses: report.hypotheses, error: report.error, out })); if (!report.pass) process.exitCode = 1;
