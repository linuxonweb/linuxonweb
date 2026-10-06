// Default: the same full Nightly159 PBL/JIT binary, runtime disabled A / enabled B,
// ABBAAB cold boots with exact compiled/live identity and strict no-regression.
// Every boot has an exclusively created profile and an owned dynamic CDP port;
// the QA HTTP server also uses an allocated loopback port. Guest navigation is
// real keyboard input; identical DNS/TCP refusal isolates both arms.
// Usage and reviewed provenance: docs/firefox-nightly-benchmark-gate-20261002.md.
// Explicit PBLBENCH_MODE=historical retains the old packet3b defaults
// (fa0217b54d99 versus test-pbl-6febc628d9f6f796), historical fixture overrides
// and diagnostic noise labels. Historical mode cannot pass Nightly acceptance.
import fs from 'node:fs/promises';
import { openSync, closeSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { readHostNproc, selectHostCpus, guestCpuChecks, guestCpuStateExpression, guestCpuPrebootStateExpression, saveGuestCpuEvidence, saveHostCpuPhaseEvidence } from './firefox-host-cpus.mjs';
import { TASK, FIXTURE_SHA256, armContract, pairContract, fatalLines, payloads, guestIdentityChecks, runtimeTierChecks, benchmarkContentTierChecks, primaryDiagnosticsChecks, caseChecks, benchmarkAcceptance, ownedBrowserEndpoint, ownedPageEndpoint } from './check-firefox-nightly-benchmark.mjs';
import { prepareBrowserAffinity, browserLaunchCommand, saveBrowserAffinityEvidence } from './firefox-browser-affinity.mjs';
import { pinOwnedGroup, drainOwnedGroup } from './benchmark-process-group.mjs';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const checkerSource = path.join(moduleDir, 'check-firefox-nightly-benchmark.mjs');
const helperSources = ['firefox-host-cpus.mjs', 'firefox-browser-affinity.mjs', 'benchmark-process-group.mjs'];
const bridgeNames = ['benchmark-content-options.sys.mjs', 'NightlyBenchmarkOptionsChild.sys.mjs', 'NightlyBenchmarkOptionsParent.sys.mjs', 'benchmark-options-entry.sys.mjs', 'benchmark-diagnostics.sys.mjs'];
const repo = process.env.PBLBENCH_REPO ? await fs.realpath(process.env.PBLBENCH_REPO) : null;
if (!repo) throw Error('explicit canonical PBLBENCH_REPO required; staged producer cannot derive repo');
const mode = process.env.PBLBENCH_MODE || 'nightly';
if (!['nightly', 'historical'].includes(mode)) throw Error('PBLBENCH_MODE must be nightly or historical');
const nightly = mode === 'nightly';
// The acquisition is wired, but launch requires caller-pinned exact executing
// producer/checker/helpers/bridge manifest. Runtime API/actor success is pending.
const benchmarkContentOptionBridgeImplemented = true;
if (nightly) {
  if (!process.env.PBLBENCH_IMPLEMENTATION_MANIFEST || !/^[a-f0-9]{64}$/.test(process.env.PBLBENCH_IMPLEMENTATION_MANIFEST_SHA256 || '')) throw Error('reviewed implementation manifest required before any launch');
  const bytes = await fs.readFile(process.env.PBLBENCH_IMPLEMENTATION_MANIFEST);
  if (createHash('sha256').update(bytes).digest('hex') !== process.env.PBLBENCH_IMPLEMENTATION_MANIFEST_SHA256) throw Error('implementation manifest changed');
  const manifest = JSON.parse(bytes);
  if (manifest.kind !== 'benchmark-content-bridge-implementation-v1' || manifest.repo !== repo) throw Error('implementation repo binding differs');
  for (const name of ['test-firefox-pbl-bench.mjs', 'check-firefox-nightly-benchmark.mjs', ...helperSources, ...bridgeNames]) {
    const file = path.join(moduleDir, name), pin = manifest.files.find(row => row.path === file);
    if (!pin || createHash('sha256').update(await fs.readFile(file)).digest('hex') !== pin.sha256) throw Error('actual executing implementation bytes differ: ' + name);
  }
}
const task = process.env.PBLBENCH_TASK || (nightly ? TASK : '/mnt/p6/build/guest-jit-pbl-bench-20261001');
if (nightly && task !== TASK) throw Error('Nightly gate requires dedicated task');
if (process.argv.length !== 3) throw Error('usage: OUT');
const out = path.resolve(process.argv[2]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
  const actual = await fs.realpath(process.env[key]), stat = await fs.statfs(actual);
  if (!actual.startsWith(task + '/') || [0x01021994, 0x858458f6].includes(stat.type) || stat.bavail * stat.bsize < (nightly ? 20 : 4) * 1024 ** 3) throw Error('disk-backed task scratch/reserve required');
}
if (!out.startsWith(task + '/')) throw Error('output outside task');
const realParent = await fs.realpath(path.dirname(out));
if (realParent !== task && !realParent.startsWith(task + '/')) throw Error('output parent escapes task');
let lastStorageCheck = 0;
async function storageCheck(force = false) {
  if (!nightly || (!force && Date.now() - lastStorageCheck < 30000)) return;
  lastStorageCheck = Date.now();
  const usage = Number(execFileSync('du', ['-sb', task], { encoding: 'utf8' }).split(/\s/)[0]), disk = await fs.statfs(task);
  if (usage >= 2 * 1024 ** 3 || disk.bavail * disk.bsize < 20 * 1024 ** 3) throw Error('Nightly2GiB allowance/20GiB reserve exhausted');
}
await storageCheck(true);
if (nightly && (!process.env.PBLBENCH_ARMS || !/^[a-f0-9]{64}$/.test(process.env.PBLBENCH_ARMS_SHA256 || ''))) throw Error('Nightly requires explicit reviewed PBLBENCH_ARMS and PBLBENCH_ARMS_SHA256');
await fs.mkdir(out);
const armsBytes = process.env.PBLBENCH_ARMS ? await fs.readFile(process.env.PBLBENCH_ARMS) : null;
if (nightly && sha(armsBytes) !== process.env.PBLBENCH_ARMS_SHA256) throw Error('reviewed arms digest changed');
const arms = armsBytes ? JSON.parse(armsBytes) : {
  A: { name: 'baseline', dir: '/mnt/p6/build/firefox-ready-20260926/baseline-images', version: 'fa0217b54d99', archiveSha256: '6c7fad946e53f977bc6d55a80323f7ec6a9fa84858d1a245fe0916e2f6d17e65' },
  B: { name: 'pbl', dir: path.join(repo, 'web/linux/tests/runtime-candidates/pbl-v3'), version: 'test-pbl-6febc628d9f6f796', archiveSha256: '6febc628d9f6f7968bdb228d1590adcff83daabd8c6c4b63c8bb6a71c9afb486' },
};
// PBLBENCH_ORDER (e.g. A) is for smoke runs only; it can never pass.
const order = (process.env.PBLBENCH_ORDER || 'ABBAAB').split('');
const fixturePath = process.env.PBLBENCH_FIXTURE ? path.resolve(process.env.PBLBENCH_FIXTURE) : path.join(repo, 'web/linux/tests/guest-jit-pbl-bench.html');
const jitLogBudget = process.env.PBLBENCH_LOG_BUDGET === undefined ? (nightly ? 0 : null) : Number(process.env.PBLBENCH_LOG_BUDGET);
if (nightly && jitLogBudget !== 0) throw Error('primary timed Nightly benchmark requires log budget0');
const guestReadyMode = process.env.PBLBENCH_GUEST_READY === '1';
if (nightly && (!guestReadyMode || order.join('') !== 'ABBAAB')) throw Error('Nightly requires ABBAAB and PBLBENCH_GUEST_READY=1');
if (jitLogBudget !== null && (!Number.isInteger(jitLogBudget) || jitLogBudget < (nightly ? 0 : 25) || jitLogBudget > 10000)) throw Error('invalid PBLBENCH_LOG_BUDGET');
const inputs = {};
const readInput = async source => { const bytes = await fs.readFile(source); inputs[source] = sha(bytes); return bytes; };
const readPinned = async (source, expected) => { if (!/^[a-f0-9]{64}$/.test(expected || '')) throw Error('missing reviewed digest: ' + source); const bytes = await readInput(source); if (sha(bytes) !== expected) throw Error('reviewed digest changed: ' + source); return bytes; };
for (const source of [fileURLToPath(import.meta.url), checkerSource, ...[...helperSources, ...bridgeNames].map(name => path.join(moduleDir, name)), fixturePath, path.join(repo, 'web/desktop/dev-server.mjs'), ...['main.js', 'worker.js', 'persistent-home.mjs', 'boot-assets.mjs', 'vmlinux.wasm', 'initramfs.cpio'].map(s => path.join(repo, 'web/linux', s)), ...Object.values(arms).flatMap(a => [a.dir + '/boot-manifest.json', a.dir + '/initramfs-firefox.cpio.gz'])]) await readInput(source);
if (process.env.PBLBENCH_ARMS) inputs[process.env.PBLBENCH_ARMS] = sha(armsBytes);
if (nightly) {
  if (inputs[fixturePath] !== FIXTURE_SHA256 || Object.keys(arms).sort().join('') !== 'AB') throw Error('Nightly requires exact original eight-case fixture and A/B arms');
  for (const [id, arm] of Object.entries(arms)) {
    const n = arm.nightly;
    if (!n) throw Error('missing explicit Nightly provenance ' + id);
    const full = JSON.parse(await readPinned(n.fullPackageDir + '/package-report.json', n.fullReportSHA256));
    const overlay = JSON.parse(await readPinned(arm.dir + '/package.json', n.overlayReportSHA256));
    const fullManifest = JSON.parse(await readPinned(n.fullPackageDir + '/boot-manifest.json', overlay.sourceManifestSha256));
    await readPinned(n.fullPackageDir + '/initramfs-firefox.cpio.gz', full.archiveSha256);
    const build = JSON.parse(await readPinned(n.buildEvidencePath, full.buildEvidenceSHA256));
    for (const c of Object.values(build.commands || {})) await readPinned(c.log, c.logSHA256);
    const review = JSON.parse(await readPinned(n.buildReview.path, n.buildReview.sha256));
    const acceptance = id === 'A' ? JSON.parse(await readPinned(n.baselineAcceptance.path, n.baselineAcceptance.sha256)) : null;
    for (const e of [...(review.evidence || []), ...(acceptance?.evidence || []), ...(n.tierEvidence?.artifacts || [])]) await readPinned(e.path, e.sha256);
    const candidateManifest = JSON.parse(await fs.readFile(arm.dir + '/boot-manifest.json'));
    arm.nightlyIdentity = armContract(id, arm, full, overlay, fullManifest, candidateManifest, build, review, acceptance);
    if ((await fs.stat(arm.dir + '/initramfs-firefox.cpio.gz')).size !== overlay.bytes) throw Error('archive size differs ' + id);
  }
  pairContract(arms.A.nightlyIdentity, arms.B.nightlyIdentity);
  const activeBuilds = [];
  for (const line of execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).split('\n')) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (!m || !/(?:^|[\s/])(?:clang(?:\+\+)?(?:-\d+)?|rustc|cargo|ninja|make|mach)(?:[\s.]|$)|build-full/.test(m[2])) continue;
    let cwd; try { cwd = await fs.realpath('/proc/' + m[1] + '/cwd'); } catch { continue; }
    if (Object.values(arms).some(a => Object.values(a.nightlyIdentity.reviewRoots).some(root => cwd === root || cwd.startsWith(root + '/') || m[2].includes(root)))) activeBuilds.push({ pid: Number(m[1]), cwd, argv: m[2] });
  }
  await fs.writeFile(out + '/owned-build-preflight.json', JSON.stringify({ activeBuilds, pass: activeBuilds.length === 0 }, null, 2) + '\n');
  if (activeBuilds.length) throw Error('owned full builds active; preserve baseline and benchmark isolation');
}
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
await fs.copyFile(fileURLToPath(import.meta.url), out + '/runner.mjs');
for (const name of ['check-firefox-nightly-benchmark.mjs', ...helperSources, ...bridgeNames]) {
  const source = path.join(moduleDir, name), destination = path.join(out, name);
  await fs.copyFile(source, destination);
  if (sha(await fs.readFile(destination)) !== inputs[source]) throw Error('copied executing module differs: ' + name);
}
await fs.copyFile(fixturePath, out + '/fixture.html');
let mainAdapter = null;
if (jitLogBudget !== null) {
  const mainSource = await fs.readFile(path.join(repo, 'web/linux/main.js'), 'utf8');
  const anchor = 'cmdline: `${rootCommand} ${modeFlags}`,';
  if (mainSource.split(anchor).length !== 2) throw Error('main.js cmdline adapter anchor changed');
  const adapted = mainSource.replace(anchor, 'cmdline: `${rootCommand} ${modeFlags} PBLJIT_LOG=' + jitLogBudget + (nightly ? ' PBLJIT_OBSERVE=0' : '') + '`,');
  const adapterPath = out + '/main-log-budget.js';
  await fs.writeFile(adapterPath, adapted);
  mainAdapter = { path: adapterPath, sha256: sha(adapted), jitLogBudget };
  inputs[adapterPath] = mainAdapter.sha256;
}
await fs.writeFile(out + '/inputs-before.json', JSON.stringify(inputs, null, 2) + '\n');
let serverSource = await fs.readFile(path.join(repo, 'web/desktop/dev-server.mjs'), 'utf8');
serverSource = serverSource.slice(0, serverSource.indexOf("server.listen(port,"));
serverSource = serverSource.replace("const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));", 'const root = ' + JSON.stringify(repo) + ';');
serverSource = serverSource.replace('const server = createServer', `export const requests=[],sockets=new Set();export const armState={manifest:null,archive:null};let refusedDns=0,refusedTcp=0;export const refused=()=>({dns:refusedDns,tcp:refusedTcp});\nconst server = createServer`);
serverSource = serverSource.replace("const requestPath = request.url?.split('?')[0];", `const requestPath = request.url?.split('?')[0];requests.push({at:Date.now(),path:requestPath});`);
serverSource = serverSource.replace("const target = safePath(request.url || '/');", `let target = safePath(request.url || '/');if(requestPath==='/linux/boot-manifest.json')target=armState.manifest;if(requestPath==='/linux/initramfs-firefox.cpio.gz')target=armState.archive;${mainAdapter ? "if(requestPath==='/linux/main.js')target=" + JSON.stringify(mainAdapter.path) + ';' : ''}`);
// Refuse the guest network in both arms.
serverSource = serverSource.replace("const addresses = await dns.resolve4(name);", "refusedDns++;throw Error('bench: network refused');");
serverSource = serverSource.replace("if (requestPath === '/tcp') { handleTcpWebSocket(request, socket, head); return; }", "if (requestPath === '/tcp') { refusedTcp++; socket.destroy(); return; }");
serverSource += '\nserver.on("connection",socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));});export {server};\n';
for (const anchor of ['let target = safePath', 'requests.push', "throw Error('bench: network refused')", 'refusedTcp++; socket.destroy()']) if (!serverSource.includes(anchor)) throw Error('dev-server adapter anchor changed: ' + anchor);
await fs.writeFile(out + '/server.mjs', serverSource);
const service = await import(pathToFileURL(out + '/server.mjs').href), server = service.server;
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = 'http://127.0.0.1:' + server.address().port;
const prefs = ['network.http.http2.enabled:false', 'network.http.http3.enable:false', 'toolkit.legacyUserProfileCustomizations.stylesheets:true', 'media.rdd-process.enabled:false', 'media.utility-process.enabled:false', 'media.allow-audio-non-utility:true', 'browser.shell.checkDefaultBrowser:false', 'devtools.console.stdout.content:true', 'browser.aboutwelcome.enabled:false', 'dom.max_script_run_time:0', ...(nightly ? ['devtools.chrome.enabled:true', 'devtools.console.stdout.chrome:true'] : [])].map(s => { const i = s.lastIndexOf(':'); return 'user_pref(' + JSON.stringify(s.slice(0, i)) + ',' + s.slice(i + 1) + ');'; }).join('\n') + '\nuser_pref("datareporting.policy.firstRunURL", "");\n';
const fixture = await fs.readFile(fixturePath, 'utf8');
const bridgeSources = Object.fromEntries(await Promise.all(bridgeNames.map(async name => [name, await fs.readFile(path.join(moduleDir,name),'utf8')])));
const expectedCases = 3 * (fixture.match(/^ \['[^']+',/gm) || []).length;
const executable = '/home/a/.local/archpkg/pacman/usr/bin/chromium';
const report = { schema: 2, mode, scope: nightly ? 'nightly-original-eight-case-no-regression' : 'historical-diagnostic', nightlyBenchmarkAcceptance: false, jitAcceptance: false, gpuAcceptance: false, releaseAcceptance: false, pass: false, origin, httpPort: server.address().port, order, mainAdapter, arms: Object.fromEntries(Object.entries(arms).map(([k, a]) => [k, { name: a.name, version: a.version, archiveSha256: a.archiveSha256, ...(nightly ? { nightlyIdentity: a.nightlyIdentity } : {}) }])), boots: [], serverPid: process.pid };

// One boot = one owned headless Chromium with a fresh profile.
report.guestReadinessMode = guestReadyMode;
report.checkerExecutionBinding = { source:checkerSource, sha256:inputs[checkerSource], copiedPath:out + '/check-firefox-nightly-benchmark.mjs' };
async function boot(index, armId) {
  const arm = arms[armId], label = armId.toLowerCase() + '-' + (index + 1), dir = out + '/boot' + (index + 1) + '-' + armId;
  await fs.mkdir(dir);
  service.armState.manifest = arm.served; service.armState.archive = arm.dir + '/initramfs-firefox.cpio.gz';
  const fileName = 'pblbench-' + label + '.html', url = 'file:///home/admin/pblbench/' + fileName;
  const readyName = 'pblready-' + label + '.html', readyURL = 'file:///home/admin/pblbench/' + readyName;
  const readyFixture = '<!doctype html><title>Firefox benchmark readiness</title><h1>Firefox ready</h1><script>requestAnimationFrame(()=>requestAnimationFrame(()=>console.log("PBLREADY "+JSON.stringify({event:"ready",label:' + JSON.stringify(label) + ',url:location.href,ua:navigator.userAgent,createdAt:Date.now()}))));</script>';
  const bootPrefs = prefs + (nightly ? 'user_pref("javascript.options.portable_baseline",' + JSON.stringify(arm.portableBaseline) + ');\nuser_pref("webgl.disabled",true);\nuser_pref("dom.webgpu.enabled",false);\n' : '') + (guestReadyMode ? 'user_pref("browser.startup.page",1);\nuser_pref("browser.startup.homepage",' + JSON.stringify(readyURL) + ');\n' : '');
  const profile = dir + '/profile', activePortPath = profile + '/DevToolsActivePort';
  await fs.mkdir(profile); // Exclusive fresh directory: never reuse a user's profile.
  const args = ['--headless', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--disk-cache-dir=' + dir + '/cache', 'about:blank'];
  const affinityPlan = await prepareBrowserAffinity(dir);
  const launchCommand = browserLaunchCommand(executable, args, affinityPlan);
  await fs.writeFile(dir + '/command.json', JSON.stringify(launchCommand,null,2)+'\n');
  const fd = openSync(dir + '/browser.log', 'wx');
  const spawnedAt = Date.now();
  const child = spawn(launchCommand[0], launchCommand.slice(1), { detached: true, env: { ...process.env, XDG_CACHE_HOME: dir + '/xdg-cache' }, stdio: ['ignore', fd, fd] }); closeSync(fd);
  let exitInfo, spawnError; const exited = new Promise(resolve => { child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(); }); child.once('error', e => { spawnError = String(e); resolve(); }); });
  const rec = { index: index + 1, arm: armId, label, browserPid: child.pid, pass: false, navAttempts: 0, cases: [] };
  const childState = () => {
    let alive = false;
    let ownedProfileArgument = false;
    if (Number.isInteger(child.pid) && !exitInfo && !spawnError && child.exitCode === null && child.signalCode === null) { try { process.kill(child.pid, 0); const argv = readFileSync('/proc/' + child.pid + '/cmdline', 'utf8').split('\0'); ownedProfileArgument = argv.includes('--user-data-dir=' + profile) && argv.includes('--remote-debugging-port=0'); alive = ownedProfileArgument; } catch {} }
    return { pid: child.pid, alive, ownedProfileArgument, exitCode: child.exitCode, signalCode: child.signalCode, spawnError };
  };
  let ownedGroup;
  let ws, next = 0; const pending = new Map(), errors = [];
  const call = (method, params = {}, deadline = 60000) => new Promise((resolve, reject) => { if (!rec.endpointOwnership?.verified || !childState().alive) { reject(Error('CDP command requires verified live owned browser')); return; } const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP deadline ' + method)); }, deadline); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression, deadline) => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, deadline); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const until = async (fn, ms, what) => { const end = Date.now() + ms; for (;;) { await storageCheck(); if (await fn()) return; if (Date.now() > end) throw Error(what + ' deadline'); await sleep(500); } };
  const shot = async name => { const r = await call('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(dir + '/' + name + '.png', Buffer.from(r.data, 'base64')); };
  const observedFatalLines = new Set();
  const guestLogs = async () => { const logs = await ev(`(async()=>(await import('./main.js')).guestLogs.history.page(undefined,5000).map(l=>l.text).join(String.fromCharCode(10)))()`); for (const line of fatalLines(logs)) observedFatalLines.add(line); return logs; };
  const key = async (k, code, v, modifiers = 0, type) => { const a = { key: k, code, windowsVirtualKeyCode: v, nativeVirtualKeyCode: v, modifiers }; if (type !== 'up') await call('Input.dispatchKeyEvent', { type: 'keyDown', ...a }); if (type !== 'down') await call('Input.dispatchKeyEvent', { type: 'keyUp', ...a }); };
  const clickGuest = async (x, y) => { const r = await ev("(()=>{const c=document.querySelector('canvas'),r=c.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,width:c.width,height:c.height}})()"); const p = { x: r.x + x * r.w / r.width, y: r.y + y * r.h / r.height }; await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p, buttons: 0 }); await call('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', buttons: 1, clickCount: 1 }); await call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', buttons: 0, clickCount: 1 }); };
  const typeText = async text => { for (const ch of text) { const code = /[a-z]/i.test(ch) ? 'Key' + ch.toUpperCase() : /[0-9]/.test(ch) ? 'Digit' + ch : ({ '.': 'Period', '/': 'Slash', '-': 'Minus', ':': 'Semicolon' })[ch]; if (!code) throw Error('unsupported URL character ' + ch); const v = ({ '.': 190, '/': 191, '-': 189, ':': 186 })[ch] || ch.toUpperCase().charCodeAt(0), shifted = ch === ':'; if (shifted) await key('Shift', 'ShiftLeft', 16, 1, 'down'); await call('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, windowsVirtualKeyCode: v, nativeVirtualKeyCode: v, text: ch, modifiers: shifted ? 1 : 0 }); await key(ch, code, v, shifted ? 1 : 0, 'up'); if (shifted) await key('Shift', 'ShiftLeft', 16, 0, 'up'); await sleep(180); } };
  const benchLines = logs => logs.split('\n').filter(l => l.includes('console.log: "PBLBENCH ')).flatMap(l => { try { return [JSON.parse(JSON.parse(l.slice(l.indexOf('"'))).slice(9))]; } catch { return []; } });
  const readyLines = logs => logs.split('\n').filter(l => l.includes('console.log: "PBLREADY ')).flatMap(l => { try { return [JSON.parse(JSON.parse(l.slice(l.indexOf('"'))).slice(9))]; } catch { return []; } });
  const browserConsoleChord = async () => {
    await key('Control', 'ControlLeft', 17, 2, 'down'); await key('Shift', 'ShiftLeft', 16, 10, 'down'); await key('J', 'KeyJ', 74, 10); await key('Shift', 'ShiftLeft', 16, 2, 'up'); await key('Control', 'ControlLeft', 17, 0, 'up');
  };
  const typeConsole = async text => {
    const symbols = { ' ': ['Space', 32, false], '.': ['Period', 190, false], ':': ['Semicolon', 186, true], ',': ['Comma', 188, false], '-': ['Minus', 189, false], '+': ['Equal', 187, true], '"': ['Quote', 222, true], '(': ['Digit9', 57, true], ')': ['Digit0', 48, true], '{': ['BracketLeft', 219, true], '}': ['BracketRight', 221, true], '/':['Slash',191,false], ';':['Semicolon',186,false], '=':['Equal',187,false], '!':['Digit1',49,true], '[':['BracketLeft',219,false], ']':['BracketRight',221,false], '&':['Digit7',55,true], '|':['Backslash',220,true], '?':['Slash',191,true], '<':['Comma',188,true], '>':['Period',190,true], '_':['Minus',189,true], '*':['Digit8',56,true] };
    for (const c of text) {
      const spec = /[a-z]/i.test(c) ? ['Key' + c.toUpperCase(), c.toUpperCase().charCodeAt(0), /[A-Z]/.test(c)] : /[0-9]/.test(c) ? ['Digit' + c, c.charCodeAt(0), false] : symbols[c];
      if (!spec) throw Error('unsupported identity probe key ' + c);
      const [code, v, shifted] = spec;
      if (shifted) await key('Shift', 'ShiftLeft', 16, 8, 'down');
      await call('Input.dispatchKeyEvent', { type: 'keyDown', key: c, code, windowsVirtualKeyCode: v, nativeVirtualKeyCode: v, text: c, modifiers: shifted ? 8 : 0 }); await key(c, code, v, shifted ? 8 : 0, 'up');
      if (shifted) await key('Shift', 'ShiftLeft', 16, 0, 'up'); await sleep(80);
    }
  };
  try {
    ownedGroup = await pinOwnedGroup(child.pid);
    await fs.writeFile(dir + '/browser-group-owner.json', JSON.stringify(ownedGroup,null,2)+'\n');
    let activePortText, portStat, version;
    await until(async () => {
      if (!childState().alive) throw Error('owned browser startup failed');
      try { portStat = await fs.lstat(activePortPath); activePortText = await fs.readFile(activePortPath, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      rec.endpointOwnershipAttempt = { activePortText, activePortPath, profile, spawnedAt, activePortMtimeMs: portStat.mtimeMs, activePortRegularFile: portStat.isFile(), child: childState(), httpOrigin: origin };
      await fs.writeFile(dir + '/endpoint-ownership-attempt.json', JSON.stringify(rec.endpointOwnershipAttempt, null, 2) + '\n');
      // Validate the fresh file before fetching even read-only endpoint metadata.
      const [port, browserPath] = activePortText.trim().split('\n');
      const provisional = ownedBrowserEndpoint(activePortText, { webSocketDebuggerUrl: 'ws://127.0.0.1:' + port + browserPath }, { ...childState(), spawnedAt, activePortMtimeMs: portStat.mtimeMs, freshProfile: true, activePortRegularFile: portStat.isFile() });
      let response; try { response = await fetch('http://127.0.0.1:' + provisional.port + '/json/version', { signal: AbortSignal.timeout(2000) }); } catch { if (!childState().alive) throw Error('owned browser exited before endpoint verification'); return false; }
      if (!response.ok) return false;
      version = await response.json();
      rec.endpointOwnershipAttempt.reportedVersion = version;
      await fs.writeFile(dir + '/endpoint-ownership-attempt.json', JSON.stringify(rec.endpointOwnershipAttempt, null, 2) + '\n');
      rec.endpointOwnership = { ...ownedBrowserEndpoint(activePortText, version, { ...childState(), spawnedAt, activePortMtimeMs: portStat.mtimeMs, freshProfile: true, activePortRegularFile: portStat.isFile() }), activePortText, activePortPath, profile, httpOrigin: origin };
      return true;
    }, 20000, 'owned browser endpoint');
    const cdpOrigin = 'http://127.0.0.1:' + rec.endpointOwnership.port;
    const target = (await (await fetch(cdpOrigin + '/json/list', { signal: AbortSignal.timeout(2000) })).json()).find(t => t.type === 'page');
    const pageWebSocketURL = ownedPageEndpoint(target, rec.endpointOwnership);
    const freshText = await fs.readFile(activePortPath, 'utf8'), freshStat = await fs.lstat(activePortPath);
    const freshVersion = await (await fetch(cdpOrigin + '/json/version', { signal: AbortSignal.timeout(2000) })).json();
    ownedBrowserEndpoint(freshText, freshVersion, { ...childState(), spawnedAt, activePortMtimeMs: freshStat.mtimeMs, freshProfile: true, activePortRegularFile: freshStat.isFile() });
    if (freshText !== activePortText || freshVersion.webSocketDebuggerUrl !== version.webSocketDebuggerUrl) throw Error('owned endpoint changed before websocket connection');
    rec.endpointOwnership.pageTarget = target;
    await fs.writeFile(dir + '/endpoint-ownership.json', JSON.stringify(rec.endpointOwnership, null, 2) + '\n');
    if (!childState().alive) throw Error('owned browser exited before websocket connection');
    ws = new WebSocket(pageWebSocketURL);
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params); };
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; }); await call('Page.enable'); await call('Runtime.enable'); await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await call('Page.navigate', { url: origin + '/linux/boot-manifest.json' }); await until(() => ev("document.readyState==='complete'&&location.pathname.endsWith('boot-manifest.json')"), 10000, 'seed page');
    const browserHardwareConcurrency = await ev('navigator.hardwareConcurrency');
    rec.browserAffinity = await saveBrowserAffinityEvidence(affinityPlan, child.pid, browserHardwareConcurrency, dir);
    rec.cpu = selectHostCpus(rec.browserAffinity.hostNproc, browserHardwareConcurrency);
    if (nightly && (rec.cpu.hostNproc > 64 || rec.cpu.browserHardwareConcurrency !== rec.cpu.hostNproc)) throw Error('exact host CPU agreement requires unclamped equal counts <=64');
    report.comparisonBrowserCpus ??= rec.browserAffinity.assignedCpus;
    rec.comparisonBrowserAffinityStable = JSON.stringify(rec.browserAffinity.assignedCpus) === JSON.stringify(report.comparisonBrowserCpus);
    await fs.writeFile(dir + '/comparison-affinity.json', JSON.stringify({ initialAssignedCpus:report.comparisonBrowserCpus, assignedCpus:rec.browserAffinity.assignedCpus, pass:rec.comparisonBrowserAffinityStable },null,2)+'\n');
    if (!rec.comparisonBrowserAffinityStable) throw Error('actual browser CPU assignment changed between benchmark arms');
    report.comparisonHostNproc ??= rec.cpu.hostNproc;
    rec.comparisonHostCpuStable = rec.cpu.hostNproc === report.comparisonHostNproc;
    await fs.writeFile(dir + '/comparison-cpu.json', JSON.stringify({ initialHostNproc: report.comparisonHostNproc, cpu: rec.cpu, pass: rec.comparisonHostCpuStable }, null, 2) + '\n');
    if (!rec.comparisonHostCpuStable) throw Error('host CPU allocation changed between benchmark arms');
    await ev(`(async()=>{localStorage.removeItem('linuxonweb.system.active.v1');localStorage.setItem('linuxonweb.machine-settings.v1',JSON.stringify({resolution:'1280x720',cpus:${rec.cpu.requestedGuestCpus},ram:4096,backend:'canvas2d'}));const h=await(await import('/linux/persistent-home.mjs')).openPersistentHome();async function dir(p){let n=h.root;for(const s of p.split('/').filter(Boolean))n=await h.lookup(n,s)||await h.mkdir(n,s,{mode:0o755,uid:1000,gid:1000});return n;}async function put(p,text){const parts=p.split('/'),name=parts.pop(),parent=await dir(parts.join('/'));const f=await h.create(parent,name,2,{mode:0o644,uid:1000,gid:1000});await h.write(f.node,f.handle,0n,new TextEncoder().encode(text));await h.release(f.node,f.handle);}await put('admin/.mozilla/firefox/http1-profile/user.js',${JSON.stringify(bootPrefs)});await put('admin/pblbench/${fileName}',${JSON.stringify(fixture)});${nightly ? Object.entries(bridgeSources).map(([name,source]) => `await put('admin/pblbench/${name}',${JSON.stringify(source)});`).join('') : ''}${guestReadyMode ? `await put('admin/pblbench/${readyName}',${JSON.stringify(readyFixture)});` : ''}await h.destroy();return true;})()`);
    const manifest = await ev(`fetch('/linux/boot-manifest.json',{cache:'no-store'}).then(r=>r.json())`);
    if (manifest.version !== arm.version) throw Error('served manifest mismatch');
    if (mainAdapter) {
      rec.mainAdapterSHA256 = sha(Buffer.from(await (await fetch(origin + '/linux/main.js')).arrayBuffer()));
      if (rec.mainAdapterSHA256 !== mainAdapter.sha256) throw Error('served main.js diagnostic adapter differs');
    }
    const start = Date.now();
    rec.prebootCpu = await saveHostCpuPhaseEvidence(rec.cpu, await ev(guestCpuPrebootStateExpression), dir, 'cold-preboot');
    await call('Page.navigate', { url: origin + '/linux/index.html?firefox=1&renderer=canvas2d&gpu=0' });
    await until(async () => { try { if ((await guestLogs()).includes('starting /bin/firefox as admin')) { rec.launchMs = Date.now() - start; return true; } } catch (e) { if (!/context|Cannot|Failed to fetch/.test(String(e))) throw e; } return false; }, 180000, 'Firefox launch');
    // Preserve SMP evidence before benchmark logs can evict startup history.
    const startupLogs = await guestLogs();
    await fs.writeFile(dir + '/startup-guest-logs.txt', startupLogs);
    rec.cpu = await saveGuestCpuEvidence(rec.cpu, startupLogs, await ev(guestCpuStateExpression), dir, 'cold');
    if (guestReadyMode) {
      await until(async () => {
        const ready = readyLines(await guestLogs()).find(r => r.event === 'ready' && r.label === label && r.url === readyURL && /Firefox\//.test(r.ua) && r.createdAt >= start);
        if (!ready) return false;
        rec.guestReady = ready; rec.guestReadyMs = Date.now() - start; return true;
      }, 120000, 'guest Firefox page readiness');
      rec.readyFixtureSHA256 = sha(readyFixture);
      await shot('guest-ready');
    } else await sleep(20000);
    if (nightly) {
      // Read live privileged appinfo, not navigator.buildID (often privacy-reduced).
      // This keyboard driver is preparatory until exercised against full Nightly;
      // inability to open/evaluate the console fails this gate without fallback.
      await ev("document.querySelector('#fb').focus()");
      await browserConsoleChord(); await sleep(5000);
      const probe = '(()=>{if(typeof Cu.getJSTestingFunctions!=="function")throw Error("JSTestingFunctions unavailable");const testing=Cu.getJSTestingFunctions();if(!testing||typeof testing.getJitCompilerOptions!=="function")throw Error("getJitCompilerOptions unavailable");const options=testing.getJitCompilerOptions();if(!options||typeof options!=="object")throw Error("compiler options unavailable");const hasEnable=Object.prototype.hasOwnProperty.call(options,"pbl.enable"),hasWarmup=Object.prototype.hasOwnProperty.call(options,"pbl.warmup.threshold"),enable=Reflect.get(options,"pbl.enable"),warmup=Reflect.get(options,"pbl.warmup.threshold");if(!hasEnable||!hasWarmup||typeof enable!=="number"||(enable!==0&&enable!==1)||typeof warmup!=="number"||warmup!==10)throw Error("actual PBL options unavailable or invalid");console.log("PBLIDENTITY "+JSON.stringify({label:' + JSON.stringify(label) + ',version:Services.appinfo.version,platformVersion:Services.appinfo.platformVersion,appBuildID:Services.appinfo.appBuildID,platformBuildID:Services.appinfo.platformBuildID,OS:Services.appinfo.OS,XPCOMABI:Services.appinfo.XPCOMABI,optionContext:"browser-console",processID:Services.appinfo.processID,processType:Services.appinfo.processType,restartPref:Services.prefs.getBoolPref("javascript.options.portable_baseline"),jitTestingFunctionsAvailable:true,jitCompilerOptionsGetterAvailable:true,pblEnableOwnProperty:hasEnable,pblWarmupOwnProperty:hasWarmup,portableBaselineOption:enable,pblWarmupThreshold:warmup}));})()';
      await fs.writeFile(dir + '/guest-identity-probe.txt', probe + '\n');
      await typeConsole(probe); await key('Enter', 'Enter', 13);
      let identityLogs;
      await until(async () => { identityLogs = await guestLogs(); rec.guestIdentity = payloads(identityLogs, 'PBLIDENTITY ').find(p => p.label === label); return Boolean(rec.guestIdentity); }, 60000, 'exact guest Nightly identity');
      await fs.writeFile(dir + '/identity-guest-logs.txt', identityLogs);
      rec.guestIdentityChecks = guestIdentityChecks(rec.guestIdentity, arm.nightlyIdentity.compiled, label);
      if (!Object.values(rec.guestIdentityChecks).every(Boolean)) throw Error('live guest Nightly version/build differs from compiled package');
      rec.parentRuntimeTierChecks = runtimeTierChecks(rec.guestIdentity, arm.portableBaseline);
      const installProbe = 'ChromeUtils.importESModule("file:///home/admin/pblbench/benchmark-options-entry.sys.mjs").install(' + JSON.stringify(label) + ');';
      await fs.writeFile(dir + '/content-bridge-install-probe.txt', installProbe + '\n');
      await typeConsole(installProbe); await key('Enter', 'Enter', 13);
      let bridgeReadyLogs;
      await until(async () => { bridgeReadyLogs = await guestLogs(); return payloads(bridgeReadyLogs, 'PBLCONTENTBRIDGEREADY ').some(p => p.label === label && p.documentURI === url && p.registeredBeforeNavigation === true); }, 60000, 'actual bridge registration before navigation');
      await fs.writeFile(dir + '/content-bridge-ready-guest-logs.txt', bridgeReadyLogs);
      rec.contentBridgeRegisteredBeforeNavigation = true;
      if (!Object.values(rec.parentRuntimeTierChecks).every(Boolean)) throw Error('actual restart preference/numeric tier getter proof differs from selected arm');
      await browserConsoleChord(); await sleep(2000);
      rec.identityFinalCpu = await saveHostCpuPhaseEvidence(rec.cpu, await ev(guestCpuStateExpression), dir, 'identity-final');
    }
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
    if (nightly) {
      let contentLogs;
      await until(async () => {
        contentLogs = await guestLogs();
        if (payloads(contentLogs, 'PBLCONTENTFAIL ').length) throw Error('actual target content acquisition failed');
        const packets = payloads(contentLogs, 'PBLCONTENTIDENTITY ').filter(p => p.label === label);
        if (packets.length > 1) throw Error('duplicate actual target option acquisitions');
        rec.contentTierIdentity = packets[0]; return packets.length === 1;
      }, 30000, 'actual benchmark target content numeric compiler options');
      const rawPath = dir + '/content-bridge-guest-logs.txt';
      await fs.writeFile(rawPath, contentLogs);
      rec.contentTierAcquisitionArtifact = { path:rawPath, sha256:sha(contentLogs) };
      inputs[rawPath] = rec.contentTierAcquisitionArtifact.sha256;
      const logStart = contentLogs.indexOf('console.log: '+JSON.stringify('PBLBENCH '+JSON.stringify(benchLines(contentLogs).find(p => p.event === 'start' && p.label === label))));
      const logContent = contentLogs.indexOf('console.log: '+JSON.stringify('PBLCONTENTIDENTITY '+JSON.stringify(rec.contentTierIdentity)));
      const timedAlready = benchLines(contentLogs).some(p => p.label === label && ['case','done','error'].includes(p.event));
      rec.contentPhaseTranscript = { fixtureStartBeforeAcquisition:logStart >= 0 && logContent > logStart, noTimedOutputBeforeAcquisitionReceipt:!timedAlready };
      if (!Object.values(rec.contentPhaseTranscript).every(Boolean)) throw Error('actual acquisition phase transcript unavailable or late');
      rec.contentTierChecks = benchmarkContentTierChecks(rec.contentTierIdentity, arm.portableBaseline, label);
      if (!Object.values(rec.contentTierChecks).every(Boolean)) throw Error('actual target content tier/phase/identity differs');
      rec.primaryDiagnosticsChecks = primaryDiagnosticsChecks(rec.contentTierIdentity);
      rec.primaryDiagnosticsOff = Object.values(rec.primaryDiagnosticsChecks).every(Boolean);
      if (!rec.primaryDiagnosticsOff) throw Error('actual primary process diagnostics-off proof unavailable');
      rec.contentTierStatus = 'recorded';
    }
    await shot('fixture');
    await until(async () => benchLines(await guestLogs()).some(l => l.event === 'done' && l.label === label), 900000, 'PBLBENCH done');
    rec.doneMs = Date.now() - start;
    const logs = await guestLogs(); await fs.writeFile(dir + '/guest-logs.txt', logs);
    const lines = benchLines(logs).filter(l => l.label === label);
    const startLine = lines.find(l => l.event === 'start'), done = lines.find(l => l.event === 'done');
    rec.eventChecks = { oneStart: lines.filter(l => l.event === 'start').length === 1, oneDone: lines.filter(l => l.event === 'done').length === 1 };
    rec.hardwareConcurrency = startLine.hc; rec.userAgent = startLine.ua; rec.benchElapsedMs = done.elapsedMs; rec.benchOk = done.ok;
    rec.cases = lines.filter(l => l.event === 'case').map(({ round, name, checksum, reps, batchMs, medianBatchMs }) => ({ round, name, checksum, reps, batchMs, medianBatchMs }));
    rec.errorLines = lines.filter(l => l.event === 'error');
    const state = await ev(`(async()=>({system:(await(await import('./boot-assets.mjs')).systemUsage()).version,browserHardwareConcurrency:navigator.hardwareConcurrency,selectedGuestCpus:Number(document.querySelector('#cpu-cores').value),isolated:crossOriginIsolated,visibility:document.visibilityState}))()`);
    rec.state = state;
    rec.finalCpu = await saveHostCpuPhaseEvidence(rec.cpu, state, dir, 'cold-final');
    rec.finalBrowserAffinity = await saveBrowserAffinityEvidence(affinityPlan, child.pid, state.browserHardwareConcurrency, dir, 'browser-final');
    rec.checks = { ...guestCpuChecks(rec.cpu, state, rec.finalCpu.hostNprocObserved), ...rec.finalBrowserAffinity.checks, comparisonBrowserAffinityStable:rec.comparisonBrowserAffinityStable, comparisonHostCpuStable: rec.comparisonHostCpuStable, version: state.system === arm.version, isolated: state.isolated === true, config: startupLogs.includes(`cpus=${rec.cpu.requestedGuestCpus}, ram=4 GB`), benchOk: done.ok === true, cases: rec.cases.length === expectedCases, outerErrors: errors.length === 0, noFatalLogs: observedFatalLines.size === 0, noFixtureErrors: rec.errorLines.length === 0, ...(nightly ? { ...caseChecks(rec.cases), ...rec.contentTierChecks, ...rec.contentPhaseTranscript, ...rec.guestIdentityChecks, ...rec.eventChecks, guestNavigatorCpu: rec.hardwareConcurrency === rec.cpu.hostNproc, guestFirefoxUA: /Firefox\/159(?:\.0)?(?:\s|$)/.test(rec.userAgent || '') } : {}) };
    rec.pbljitLines = logs.split('\n').filter(l => l.includes('PBLJIT')).slice(-60);
    rec.fatalLines = [...observedFatalLines];
    rec.pass = Object.values(rec.checks).every(Boolean);
  } catch (error) { rec.error = String(error.stack || error); try { await fs.writeFile(dir + '/failure-guest-logs.txt', await guestLogs()); await shot('failure'); } catch {} }
  finally {
    // Include late guest errors before closing the page, without evicting SMP.
    try { await guestLogs(); } catch {}
    rec.fatalLines = [...observedFatalLines];
    if (rec.fatalLines.length) rec.pass = false;
    if (rec.endpointOwnership?.verified && childState().alive && ws?.readyState === 1) { try { await call('Page.navigate', { url: 'about:blank' }); await call('Browser.close'); } catch {} }
    for (const p of pending.values()) clearTimeout(p.timer); ws?.close();
    try {
      // Pin an early-failing spawn too before any signal; no leader-only success.
      ownedGroup ??= await pinOwnedGroup(child.pid);
      rec.groupCleanup = await drainOwnedGroup(ownedGroup);
      rec.forcedTermination = rec.groupCleanup.forced;
      await fs.writeFile(dir + '/browser-group-cleanup.json', JSON.stringify(rec.groupCleanup,null,2)+'\n');
      if (!rec.groupCleanup.pass) rec.pass = false;
    } catch (error) { rec.cleanupError = String(error); rec.pass = false; }
    await Promise.race([exited, sleep(1000)]);
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
  if (harness && !nightly) Object.assign(report, classify());
  const changed = []; for (const [p, h] of Object.entries(inputs)) if (sha(await fs.readFile(p)) !== h) changed.push(p);
  report.inputsUnchanged = changed.length === 0; report.changedInputs = changed;
  report.finalHostNproc = readHostNproc();
  report.hostAllocationStable = report.finalHostNproc === report.comparisonHostNproc;
  report.checksumsIdentical = harness && (nightly ? report.boots.every(b => caseChecks(b.cases).exactRowsAndChecksums) : Object.values(report.verdicts).every(x => x.checksumsIdentical));
  report.pass = harness && report.inputsUnchanged && report.checksumsIdentical && report.hostAllocationStable;
} catch (error) { report.error = String(error.stack || error); }
finally {
  for (const socket of service.sockets) socket.destroy(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  report.serverClosed = !server.listening; report.requests = service.requests.length; report.refused = service.refused(); report.inputs = inputs;
  if (!report.serverClosed) report.pass = false;
  try { await storageCheck(true); } catch (error) { report.error = String(error); report.pass = false; }
  if (nightly) {
    report.acceptance = benchmarkAcceptance(report);
    report.verdicts = report.acceptance.verdicts;
    report.pass = report.pass && report.acceptance.pass;
    report.nightlyBenchmarkAcceptance = report.pass;
  }
  await fs.writeFile(out + '/result.json', JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ pass: report.pass, verdicts: report.verdicts && Object.fromEntries(Object.entries(report.verdicts).map(([k, x]) => [k, [x.ratio, x.verdict]])), hypotheses: report.hypotheses, error: report.error, out })); if (!report.pass) process.exitCode = 1;
