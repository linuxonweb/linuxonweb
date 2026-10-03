// Finite owner of a dynamic loopback HTTP server and fresh Chromium/CDP.
// Verifies the spawned process/profile/endpoint before commands and cleanup.
//
//   node run-guest.mjs jit    OUT BUILD_DIR   guest JIT primitive test
// Historical Aurora acceptance requires its own CPU/endpoint migration.
//
// OUT must be a new directory below the disk-backed task root; TMPDIR/TMP/TEMP
// must point below it too. Every served file is frozen and hashed.
import fs from 'node:fs/promises';
import { openSync, closeSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readHostNproc, selectHostCpus, saveHostCpuPhaseEvidence, saveGuestCpuEvidence } from '../../../../tools/guest-rootfs/firefox-host-cpus.mjs';
import { ownedBrowserEndpoint, ownedPageEndpoint } from '../../../../tools/guest-rootfs/check-firefox-nightly-benchmark.mjs';

let CDP_PORT;
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../../..');
const task = '/mnt/p6/build/guest-jit-ffprep-20260928';
const [mode, outArg, buildArg] = process.argv.slice(2);
if (mode !== 'jit' || !outArg || !buildArg) throw Error('usage: jit OUT BUILD_DIR; historical Aurora CPU/endpoint migration is required before reuse');
const out = path.resolve(outArg);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function disk(location) {
  const actual = await fs.realpath(location), stats = await fs.statfs(actual);
  if (!actual.startsWith(task + '/') || [0x01021994, 0x858458f6].includes(stats.type) || stats.bavail * stats.bsize < 1024 ** 3)
    throw Error('disk-backed task path/capacity required: ' + location);
}
for (const key of ['TMPDIR', 'TMP', 'TEMP']) await disk(process.env[key]);
if (!out.startsWith(task + '/')) throw Error('output outside task');
await fs.mkdir(out); await disk(out);
const inputs = {}, routes = new Map(), requested = [], errors = [], consoleMessages = [];
async function freeze(source, destination) {
  const bytes = await fs.readFile(source); inputs[source] = hash(bytes);
  if (destination) { await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, bytes); }
  return bytes;
}
await freeze(fileURLToPath(import.meta.url), path.join(out, 'run-guest.mjs'));
for (const name of ['firefox-host-cpus.mjs', 'check-firefox-nightly-benchmark.mjs'])
  await freeze(path.join(repo, 'tools/guest-rootfs', name), path.join(out, name));
let pageUrl;
if (mode === 'jit') {
  const buildDir = path.resolve(buildArg); await disk(buildDir);
  const buildBytes = await freeze(path.join(buildDir, 'build.json'), path.join(out, 'build.json'));
  const build = JSON.parse(buildBytes);
  if (hash(await freeze(path.join(here, 'jit-fpcast-test.c'))) !== build.sourceSha256) throw Error('compiled test source differs from current fixture');
  const archive = await freeze(path.join(buildDir, 'initramfs.cpio'));
  if (!build.pass || hash(archive) !== build.archiveSha256 || archive.length !== build.archiveBytes) throw Error('archive differs from build report');
  for (const [file, key] of [['web/linux/dist/worker.js', 'workerSha256'], ['web/linux/dist/guest-jit.js', 'guestJitSha256']])
    if (hash(await freeze(path.join(repo, file))) !== build[key]) throw Error('runtime differs from build report: ' + file);
  routes.set('/linux/tests/guest-jit-fpcast/candidate/build.json', buildBytes);
  routes.set('/linux/tests/guest-jit-fpcast/candidate/initramfs.cpio', archive);
  pageUrl = '/linux/tests/guest-jit-fpcast/index.html';
}

// The tool runner may enter its quota cgroup after startup. Observe that
// allocation before assigning actual cores to this owned test browser.
await sleep(2000);
const launchHostNproc = readHostNproc();
const runnerCpuList = /^Cpus_allowed_list:\s*(.+)$/m.exec(await fs.readFile('/proc/self/status','utf8'))?.[1];
function expandCpuList(text) {
  const allowedCpus = [];
  for (const part of (text ?? '').split(',')) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!match) throw Error('invalid runner CPU affinity');
    const first = Number(match[1]), last = Number(match[2] ?? match[1]);
    if (last < first || last > 4095) throw Error('unsupported runner CPU affinity');
    for (let i=first;i<=last;i++) allowedCpus.push(i);
  }
  return allowedCpus;
}
const allowedCpus = expandCpuList(runnerCpuList);
if (launchHostNproc > 64 || allowedCpus.length < launchHostNproc) throw Error('exact host CPU affinity unavailable');
const assignedCpus = allowedCpus.slice(0,launchHostNproc);

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css' };
const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const url = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!url.startsWith('/linux/') || url.includes('\0')) throw Error('unsupported route');
    let bytes = routes.get(url);
    if (!bytes) {
      const source = path.resolve(repo, 'web', '.' + url);
      if (!source.startsWith(path.join(repo, 'web/linux') + '/')) throw Error('route escape');
      bytes = await freeze(source, path.join(out, 'runtime-snapshot', url.slice('/linux/'.length)));
      routes.set(url, bytes);
    }
    requested.push({ url, bytes: bytes.length, sha256: hash(bytes) });
    response.writeHead(200, { 'Content-Type': mime[path.extname(url)] || 'application/octet-stream', 'Content-Length': bytes.length,
      'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch (error) { errors.push({ url: request.url, error: String(error.message) }); response.writeHead(404); response.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = 'http://127.0.0.1:' + server.address().port;
const profile = path.join(out, 'profile'), activePortPath = path.join(profile, 'DevToolsActivePort');
await fs.mkdir(profile);
const executable = '/home/a/.local/archpkg/pacman/usr/bin/chromium';
const args = ['--headless', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--disk-cache-dir=' + path.join(out, 'cache'), 'about:blank'];
const launchCommand = ['/usr/bin/taskset', '-c', assignedCpus.join(','), executable, ...args];
await fs.writeFile(path.join(out, 'command.json'), JSON.stringify(launchCommand, null, 2) + '\n');
await fs.writeFile(path.join(out, 'inputs-before.json'), JSON.stringify(inputs, null, 2) + '\n');
const spawnedAt = Date.now();
const log = openSync(path.join(out, 'browser.log'), 'wx');
const child = spawn(launchCommand[0], launchCommand.slice(1), { detached: true, env: { ...process.env, XDG_CACHE_HOME: path.join(out, 'xdg') }, stdio: ['ignore', log, log] });
closeSync(log);
let exitInfo, spawnError, ws, opened = false, closing = false, sequence = 0;
const exited = new Promise(resolve => {
  child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(exitInfo); });
  child.once('error', error => { spawnError = error; resolve({ error: String(error) }); });
});
const pending = new Map(), events = [];
const report = { mode, scope:'guest-runtime-primitive', pass: false, nightlyJitAcceptance:false, releaseAcceptance:false, origin, httpPort:server.address().port, runnerPid: process.pid, browserPid: child.pid, startedAt: new Date().toISOString() };
const childState = () => {
  let alive = false, ownedProfileArgument = false;
  if (Number.isInteger(child.pid) && !exitInfo && !spawnError && child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(child.pid, 0);
      const argv = readFileSync('/proc/' + child.pid + '/cmdline', 'utf8').split('\0');
      ownedProfileArgument = argv.includes('--user-data-dir=' + profile) && argv.includes('--remote-debugging-port=0');
      alive = ownedProfileArgument;
    } catch {}
  }
  return {pid:child.pid, alive, ownedProfileArgument, exitCode:child.exitCode, signalCode:child.signalCode, spawnError:spawnError ? String(spawnError) : null};
};
async function groupMembers() {
  const members = [];
  for (const entry of await fs.readdir('/proc')) {
    if (!/^[0-9]+$/.test(entry)) continue;
    try {
      const raw = await fs.readFile('/proc/'+entry+'/stat','utf8');
      const fields = raw.slice(raw.lastIndexOf(')')+2).split(' ');
      if (Number(fields[2]) === child.pid) members.push({pid:Number(entry),ppid:Number(fields[1]),pgid:Number(fields[2]),session:Number(fields[3]),state:fields[0]});
    } catch {}
  }
  return members;
}
const cpuState = () => evaluate('({browserHardwareConcurrency:navigator.hardwareConcurrency,selectedGuestCpus:window.guestJitResults?.configuration?.cpus??window.guestJitHostCpus?.requestedGuestCpus})');
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!report.endpointOwnership?.verified || !childState().alive) { reject(Error('CDP requires verified live owned browser')); return; }
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const value = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value;
}
const snapshot = () => evaluate(`({result:document.documentElement?.dataset.result||null,guest:window.guestJitResults||null,
  ready:typeof document.querySelector('#boot')?.onclick==='function'})`);
function parseJit(guest) {
  const lines = guest.lines.map(line => line.text);
  const result = lines.map(line => /^GUEST_JIT_RESULT pass=(\d+) fail=(\d+)/.exec(line)).find(Boolean);
  const bench = lines.map(line => /^GUEST_JIT_BENCH iterations=(\d+) native_ns=([\d.]+) jit_ns=([\d.]+) ratio=([\d.]+)/.exec(line)).find(Boolean);
  const rounds = lines.map(line => /^GUEST_JIT bench round=(\d+) direct_ns=([\d.]+) trampoline_ns=([\d.]+)/.exec(line)).filter(Boolean)
    .map(match => ({ round: Number(match[1]), nativeNs: Number(match[2]), jitNs: Number(match[3]) }));
  const memory = guest.bootConfigurationEvidence.flatMap(e => [...e.text.matchAll(/Memory:\s*\d+K\/(\d+)K/g)].map(m => Number(m[1])));
  const smp = guest.bootConfigurationEvidence.flatMap(e => [...e.text.matchAll(/smp: Brought up\s+\d+\s+nodes?,\s+(\d+)\s+CPUs?\b/g)].map(m => Number(m[1])));
  return {
    exitStatus: guest.exitStatus, passes: result ? Number(result[1]) : null, failures: result ? Number(result[2]) : null,
    failLines: lines.filter(line => line.startsWith('GUEST_JIT FAIL')),
    bench: bench ? { iterations: Number(bench[1]), nativeNs: Number(bench[2]), jitNs: Number(bench[3]), ratio: Number(bench[4]), rounds } : null,
    stats: lines.find(line => line.startsWith('GUEST_JIT stats')) ?? null,
    childStatus: lines.find(line => line.startsWith('GUEST_JIT child')) ?? null,
    configuration: { memoryKiB: memory, cpus: smp, verified: memory.length > 0 && smp.length > 0 && memory.every(v => v === 1048576) && smp.every(v => v === report.cpu.requestedGuestCpus) },
  };
}
try {
  const groupDeadline = Date.now()+1000;
  do {
    report.ownedInitialGroup = await groupMembers();
    if (report.ownedInitialGroup.some(m=>m.pid===child.pid && m.session===child.pid)) break;
    await sleep(50);
  } while (Date.now()<groupDeadline && !exitInfo && !spawnError);
  if (!report.ownedInitialGroup.some(m=>m.pid===child.pid && m.session===child.pid)) throw Error('owned detached Chromium group unavailable');
  const startup = Date.now() + 15000;
  for (;;) {
    if (spawnError || exitInfo) throw spawnError || Error('browser exited during startup');
    if (!childState().alive) throw Error('owned Chromium process/profile unavailable');
    let text, stat;
    try { stat = await fs.lstat(activePortPath); text = await fs.readFile(activePortPath, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (text !== undefined) {
      const evidence = {...childState(), spawnedAt, freshProfile:true, activePortRegularFile:stat.isFile(), activePortMtimeMs:stat.mtimeMs};
      report.endpointOwnershipAttempt = {activePortPath, activePortText:text, profile, ...evidence};
      await fs.writeFile(path.join(out, 'endpoint-ownership-attempt.json'), JSON.stringify(report.endpointOwnershipAttempt,null,2)+'\n');
      const [port, browserPath] = text.trim().split('\n');
      const provisional = ownedBrowserEndpoint(text, {webSocketDebuggerUrl:'ws://127.0.0.1:'+port+browserPath}, evidence);
      let response;
      try { response = await fetch('http://127.0.0.1:'+provisional.port+'/json/version', {signal:AbortSignal.timeout(2000)}); } catch {}
      if (response?.ok) {
        report.endpointOwnership = {...ownedBrowserEndpoint(text, await response.json(), {...evidence,...childState()}), activePortText:text};
        CDP_PORT = report.endpointOwnership.port; report.cdpPort = CDP_PORT; break;
      }
    }
    if (Date.now() > startup) throw Error('browser startup deadline'); await sleep(100);
  }
  const target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, {signal:AbortSignal.timeout(2000)})).json()).find(item => item.type === 'page');
  if (!target) throw Error('owned browser target missing');
  report.endpointOwnership.pageTarget = target;
  await fs.writeFile(path.join(out,'endpoint-ownership.json'),JSON.stringify(report.endpointOwnership,null,2)+'\n');
  ws = new WebSocket(ownedPageEndpoint(target, report.endpointOwnership));
  ws.onmessage = message => {
    const item = JSON.parse(message.data);
    if (item.id) { const action = pending.get(item.id); if (!action) return; pending.delete(item.id); clearTimeout(action.timer);
      if (item.error) action.reject(Error(JSON.stringify(item.error))); else action.resolve(item.result);
    } else if (item.method === 'Runtime.consoleAPICalled') {
      const text = (item.params.args || []).slice(0, 6).map(arg => ['string', 'number', 'boolean'].includes(arg.type)
        ? String(arg.value).slice(0, 2048) : String(arg.description || arg.type || '').slice(0, 512)).join(' ').slice(0, 4096);
      if (/guest-jit|user-module|trap/i.test(text) && consoleMessages.length < 64) consoleMessages.push({ type: item.params.type, text });
    } else if (['Runtime.exceptionThrown', 'Network.loadingFailed'].includes(item.method) && events.length < 128) events.push(item);
  };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('CDP socket deadline')), 5000);
    ws.onopen = () => { clearTimeout(timer); opened = true; resolve(); }; ws.onerror = () => { clearTimeout(timer); reject(Error('CDP socket error')); };
  });
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  {
    const start = Date.now();
    await call('Page.navigate', { url: origin + pageUrl }); await call('Page.bringToFront');
    let clicked = false, state;
    for (;;) {
      // Navigation may briefly leave no document element; retry transient evaluation errors.
      try { state = await snapshot(); } catch (error) { if (Date.now() - start > 10000) throw error; await sleep(250); continue; }
      if (!clicked && !state.ready && Date.now() - start > 10000) throw Error('guest page failed to initialize');
      if (!clicked && state.ready) {
        report.cpuSelectionAttempt = {
          hostNproc: readHostNproc(),
          browserHardwareConcurrency: await evaluate('navigator.hardwareConcurrency'),
          runnerCgroup: await fs.readFile('/proc/self/cgroup', 'utf8'),
          browserCgroup: await fs.readFile('/proc/'+child.pid+'/cgroup', 'utf8'),
          launchHostNproc, assignedCpus,
          browserCpuList: /^Cpus_allowed_list:\s*(.+)$/m.exec(await fs.readFile('/proc/'+child.pid+'/status','utf8'))?.[1],
        };
        await fs.writeFile(path.join(out, 'cpu-selection-attempt.json'), JSON.stringify(report.cpuSelectionAttempt,null,2)+'\n');
        if (report.cpuSelectionAttempt.hostNproc !== launchHostNproc) throw Error('host CPU allocation changed since browser launch');
        if (JSON.stringify(expandCpuList(report.cpuSelectionAttempt.browserCpuList)) !== JSON.stringify(assignedCpus)) throw Error('owned browser affinity differs from assigned actual cores');
        report.cpu = selectHostCpus(report.cpuSelectionAttempt.hostNproc, report.cpuSelectionAttempt.browserHardwareConcurrency);
        await evaluate('window.guestJitHostCpus='+JSON.stringify(report.cpu));
        report.prebootCpu = await saveHostCpuPhaseEvidence(report.cpu, await cpuState(), out, 'primitive-preboot');
        await evaluate("document.querySelector('#boot').click()"); clicked = true;
      }
      if (clicked && !report.startupCpu && state.guest?.bootConfigurationEvidence?.some(e => /smp: Brought up/.test(e.text)))
        report.startupCpu = await saveGuestCpuEvidence(report.cpu, state.guest.bootConfigurationEvidence.map(e=>e.text).join('\n'), await cpuState(), out, 'primitive-startup');
      if (state.result) {
        if (!report.startupCpu) throw Error('guest ended without independently saved startup SMP evidence');
        report.finalPhaseCpu = await saveHostCpuPhaseEvidence(report.cpu, await cpuState(), out, 'primitive-final');
        break;
      }
      if (Date.now() - start > 160000) throw Error('guest deadline');
      await sleep(250);
    }
    report.elapsedMs = Date.now() - start;
    report.guest = { ...state.guest, logs: undefined };
    await fs.writeFile(path.join(out, 'guest-console.txt'), state.guest.logs);
    report.jit = parseJit(state.guest);
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(out, 'page.png'), Buffer.from(screenshot.data, 'base64'));
    await evaluate("document.querySelector('#stop').click()");
    report.events = events;
    const pass = state.result === 'pass' && report.jit.exitStatus === 0 && report.jit.failures === 0 && report.jit.passes === 24 && report.jit.failLines.length === 0 &&
      report.jit.configuration.verified && state.guest.errors.length === 0 && !events.some(e => e.method === 'Runtime.exceptionThrown');
    if (!pass) throw Error('guest JIT acceptance failed');
  }
  for (const [source, identity] of Object.entries(inputs)) if (hash(await fs.readFile(source)) !== identity) throw Error('input changed during run: ' + source);
  report.finalHostNproc = readHostNproc();
  if (report.finalHostNproc !== report.cpu.hostNproc) throw Error('host CPU allocation changed at run end');
  report.pass = true; closing = true; await call('Browser.close');
} catch (error) { report.error = String(error.stack || error); report.pass = false; }
finally {
  if (opened && !closing) {
    try { await evaluate("document.querySelector('#stop')?.click()"); } catch { /* browser may have exited */ }
    try { await call('Browser.close'); } catch { /* owned-process cleanup below */ }
  }
  for (const item of pending.values()) clearTimeout(item.timer); ws?.close();
  await Promise.race([exited, sleep(8000)]);
  report.cleanupMembersBefore = await groupMembers();
  const groupOwned = report.ownedInitialGroup?.some(m=>m.pid===child.pid && m.session===child.pid) ||
    (childState().alive && report.cleanupMembersBefore.some(m=>m.pid===child.pid && m.session===child.pid));
  if (report.cleanupMembersBefore.length && groupOwned) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') report.cleanupError = String(error); }
    await sleep(1000);
    if ((await groupMembers()).some(m=>m.state!=='Z')) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') report.cleanupError = String(error); }
      await sleep(1000);
    }
    await Promise.race([exited, sleep(1000)]); report.forcedTermination = true; report.pass = false;
  }
  report.cleanupMembersAfter = await groupMembers();
  report.ownedGroupEmpty = report.cleanupMembersAfter.length === 0;
  if (!report.ownedGroupEmpty || report.cleanupError) report.pass = false;
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  report.browserExit = exitInfo ?? { error: String(spawnError || 'did not exit') }; report.serverClosed = !server.listening;
  if (exitInfo?.code !== 0 || !report.serverClosed) report.pass = false;
  report.consoleMessages = consoleMessages; report.inputs = inputs; report.requestedCount = requested.length; report.httpErrors = errors;
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(out, 'requested.json'), JSON.stringify(requested, null, 2) + '\n');
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ mode, pass: report.pass, jit: report.jit && { passes: report.jit.passes, failures: report.jit.failures, bench: report.jit.bench && { nativeNs: report.jit.bench.nativeNs, jitNs: report.jit.bench.jitNs } }, error: report.error?.split('\n')[0], out }));
if (!report.pass) process.exitCode = 1;
