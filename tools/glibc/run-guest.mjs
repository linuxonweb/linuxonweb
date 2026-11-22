// Finite owner of one static test server (127.0.0.1:4191) and one Chromium. Closes both. No deployment, no persistent service.
//
//   node run-guest.mjs jit    OUT BUILD_DIR   guest JIT primitive test
//
// OUT must be a new directory below the disk-backed task root; TMPDIR/TMP/TEMP
// must point below it too. Every served file is frozen and hashed.
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HTTP_PORT = Number(process.env.GLIBC_HTTP_PORT || 4202), CDP_PORT = Number(process.env.GLIBC_CDP_PORT || 9412);
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(process.env.GLIBC_REPO || path.join(here,'../..'));
if (!process.env.GLIBC_TASK) throw Error('GLIBC_TASK required');
const task = path.resolve(process.env.GLIBC_TASK);
const [mode, outArg, buildArg] = process.argv.slice(2);
if (mode !== 'jit' || !outArg || !buildArg) throw Error('usage: jit OUT BUILD_DIR');
const out = path.resolve(outArg);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function disk(location) {
  const actual = await fs.realpath(location), stats = await fs.statfs(actual);
  if (!actual.startsWith(task + '/') || [0x01021994, 0x858458f6].includes(stats.type) || stats.bavail * stats.bsize < 8 * 1024 ** 3)
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
let pageUrl;
if (mode === 'jit') {
  const buildDir = path.resolve(buildArg); await disk(buildDir);
  const buildBytes = await freeze(path.join(buildDir, 'build.json'), path.join(out, 'build.json'));
  const build = JSON.parse(buildBytes);
  const archive = await freeze(path.join(buildDir, 'initramfs.cpio'));
  if (!build.pass || hash(archive) !== build.archiveSha256 || archive.length !== build.archiveBytes) throw Error('archive differs from build report');
  for (const [file, key] of [['web/linux/dist/worker.js', 'workerSha256'], ['web/linux/dist/guest-jit.js', 'guestJitSha256']])
    if (hash(await freeze(path.join(repo, file))) !== build[key]) throw Error('runtime differs from build report: ' + file);
  routes.set('/linux/tests/guest-jit/candidate/build.json', buildBytes);
  routes.set('/linux/tests/guest-jit/candidate/initramfs.cpio', archive);
  pageUrl = '/linux/tests/guest-jit/index.html?firefox_tls_adapter=1';
  routes.set('/linux/tests/guest-jit/index.html', await freeze(path.join(task, 'source/index.html')));
  routes.set('/linux/dist/worker.js', await freeze(path.join(task, 'source/worker.js')));
}
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
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(HTTP_PORT, '127.0.0.1', resolve); });
const origin = 'http://127.0.0.1:' + HTTP_PORT;
const executable = process.env.GLIBC_CHROMIUM || '/usr/bin/chromium';
const args = ['--headless', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + path.join(out, 'profile'),
  '--disk-cache-dir=' + path.join(out, 'cache'), 'about:blank'];
await fs.writeFile(path.join(out, 'command.json'), JSON.stringify([executable, ...args], null, 2) + '\n');
await fs.writeFile(path.join(out, 'inputs-before.json'), JSON.stringify(inputs, null, 2) + '\n');
if (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then(() => true, () => false)) throw Error('CDP port already in use');
const log = openSync(path.join(out, 'browser.log'), 'wx');
const child = spawn(executable, args, { detached: true, env: { ...process.env, XDG_CACHE_HOME: path.join(out, 'xdg') }, stdio: ['ignore', log, log] });
closeSync(log);
let exitInfo, spawnError, ws, opened = false, closing = false, sequence = 0;
const exited = new Promise(resolve => {
  child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(exitInfo); });
  child.once('error', error => { spawnError = error; resolve({ error: String(error) }); });
});
const pending = new Map(), events = [];
const report = { mode, pass: false, origin, cdpPort: CDP_PORT, runnerPid: process.pid, browserPid: child.pid, startedAt: new Date().toISOString() };
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
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
  const rounds = lines.map(line => /^GUEST_JIT bench round=(\d+) native_ns=([\d.]+) jit_ns=([\d.]+)/.exec(line)).filter(Boolean)
    .map(match => ({ round: Number(match[1]), nativeNs: Number(match[2]), jitNs: Number(match[3]) }));
  const memory = guest.bootConfigurationEvidence.flatMap(e => [...e.text.matchAll(/Memory:\s*\d+K\/(\d+)K/g)].map(m => Number(m[1])));
  const smp = guest.bootConfigurationEvidence.flatMap(e => [...e.text.matchAll(/smp: Brought up\s+\d+\s+nodes?,\s+(\d+)\s+CPUs/g)].map(m => Number(m[1])));
  return {
    exitStatus: guest.exitStatus, passes: result ? Number(result[1]) : null, failures: result ? Number(result[2]) : null,
    failLines: lines.filter(line => line.startsWith('GUEST_JIT FAIL')),
    bench: bench ? { iterations: Number(bench[1]), nativeNs: Number(bench[2]), jitNs: Number(bench[3]), ratio: Number(bench[4]), rounds } : null,
    stats: lines.find(line => line.startsWith('GUEST_JIT stats')) ?? null,
    childStatus: lines.find(line => line.startsWith('GUEST_JIT child')) ?? null,
    configuration: { memoryKiB: memory, cpus: smp, verified: memory.length > 0 && smp.length > 0 && memory.every(v => v === 1048576) && smp.every(v => v === 2) },
  };
}
try {
  const startup = Date.now() + 15000;
  for (;;) {
    if (spawnError || exitInfo) throw spawnError || Error('browser exited during startup');
    // A fixed port does not write DevToolsActivePort; the port was verified free before launch.
    try { if ((await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).ok) break; } catch { /* not yet */ }
    if (Date.now() > startup) throw Error('browser startup deadline'); await sleep(100);
  }
  const target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find(item => item.type === 'page');
  if (!target) throw Error('owned browser target missing');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = message => {
    const item = JSON.parse(message.data);
    if (item.id) { const action = pending.get(item.id); if (!action) return; pending.delete(item.id); clearTimeout(action.timer);
      if (item.error) action.reject(Error(JSON.stringify(item.error))); else action.resolve(item.result);
    } else if (item.method === 'Target.attachedToTarget') {
      ws.send(JSON.stringify({id:++sequence,sessionId:item.params.sessionId,method:'Runtime.enable'}));
    } else if (item.method === 'Runtime.consoleAPICalled') {
      const text = (item.params.args || []).slice(0, 6).map(arg => ['string', 'number', 'boolean'].includes(arg.type)
        ? String(arg.value).slice(0, 2048) : String(arg.description || arg.type || '').slice(0, 512)).join(' ').slice(0, 4096);
      if (/guest-jit|user-module|trap/i.test(text) && consoleMessages.length < 256) consoleMessages.push({ type: item.params.type, text });
    } else if (['Runtime.exceptionThrown', 'Network.loadingFailed'].includes(item.method) && events.length < 128) events.push(item);
  };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('CDP socket deadline')), 5000);
    ws.onopen = () => { clearTimeout(timer); opened = true; resolve(); }; ws.onerror = () => { clearTimeout(timer); reject(Error('CDP socket error')); };
  });
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Target.setAutoAttach', {autoAttach:true,waitForDebuggerOnStart:false,flatten:true});
  {
    const start = Date.now();
    await call('Page.navigate', { url: origin + pageUrl }); await call('Page.bringToFront');
    let clicked = false, state;
    for (;;) {
      // Navigation may briefly leave no document element; retry transient evaluation errors.
      try { state = await snapshot(); } catch (error) { if (Date.now() - start > 10000) throw error; await sleep(250); continue; }
      if (!clicked && !state.ready && Date.now() - start > 10000) throw Error('guest page failed to initialize');
      if (!clicked && state.ready) { await evaluate("document.querySelector('#boot').click()"); clicked = true; }
      if (state.result) break;
      if (Date.now() - start > 160000) throw Error('guest deadline');
      await sleep(250);
    }
    report.elapsedMs = Date.now() - start;
    report.guest = { ...state.guest, logs: undefined };
    await fs.writeFile(path.join(out, 'guest-console.txt'), state.guest.logs);
    report.jit = parseJit(state.guest);
    report.abort = {modes:['default','ignored','returning','blocked','fatal'].map(mode=>({mode,pass:state.guest.logs.split(/\r?\n/).filter(line=>line===`GNU_ABORT_EXIT mode=${mode} status=134`).length===1})),returningOnce:state.guest.logs.split(/\r?\n/).filter(line=>line==='GNU_ABORT_HANDLER_RETURN count=1').length===1,diagnostic:state.guest.logs.includes('GNU_FATAL_TEST deterministic message')};
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(out, 'page.png'), Buffer.from(screenshot.data, 'base64'));
    await evaluate("document.querySelector('#stop').click()");
    report.events = events;
    const lockStats=consoleMessages.filter(item=>item.text.includes('GNU_ALLOCATOR_FUTEX')).map(item=>JSON.parse(item.text.slice(item.text.indexOf('{'))));
    const rawTp=consoleMessages.filter(item=>item.text.includes('RAW_TP marker=true adapter=false cached=false'));
    report.allocatorLocks={workers:lockStats.length,waits:lockStats.reduce((n,x)=>n+x.waits,0),woken:lockStats.reduce((n,x)=>n+x.woken,0),wakes:lockStats.reduce((n,x)=>n+x.wakes,0),errors:lockStats.reduce((n,x)=>n+x.errors,0)};
    report.rawTpWorkers=rawTp.length;
    const pass = report.allocatorLocks.workers>=3 && report.allocatorLocks.waits>0 && report.allocatorLocks.woken>0 && report.allocatorLocks.wakes>0 && report.allocatorLocks.errors===0 && rawTp.length>=3 && report.abort.modes.every(item=>item.pass) && report.abort.returningOnce && report.abort.diagnostic && state.result === 'pass' && report.jit.exitStatus === 0 && report.jit.failures === 0 && report.jit.passes > 0 &&
      report.jit.configuration.verified && state.guest.errors.length === 0 && !events.some(e => e.method === 'Runtime.exceptionThrown');
    if (!pass) throw Error('guest JIT acceptance failed');
  }
  for (const [source, identity] of Object.entries(inputs)) if (hash(await fs.readFile(source)) !== identity) throw Error('input changed during run: ' + source);
  report.pass = true; closing = true; await call('Browser.close');
} catch (error) { report.error = String(error.stack || error); report.pass = false; }
finally {
  if (opened && !closing) {
    try { await evaluate("document.querySelector('#stop')?.click()"); } catch { /* browser may have exited */ }
    try { await call('Browser.close'); } catch { /* owned-process cleanup below */ }
  }
  for (const item of pending.values()) clearTimeout(item.timer); ws?.close();
  await Promise.race([exited, sleep(8000)]);
  if (!exitInfo && !spawnError) { process.kill(-child.pid, 'SIGTERM'); await Promise.race([exited, sleep(5000)]); report.forcedTermination = true; report.pass = false; }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  report.browserExit = exitInfo ?? { error: String(spawnError || 'did not exit') }; report.serverClosed = !server.listening;
  if (exitInfo?.code !== 0 || !report.serverClosed) report.pass = false;
  report.consoleMessages = consoleMessages; report.inputs = inputs; report.requestedCount = requested.length; report.httpErrors = errors;
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(out, 'requested.json'), JSON.stringify(requested, null, 2) + '\n');
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ mode, pass: report.pass, jit: report.jit && { passes: report.jit.passes, failures: report.jit.failures, bench: report.jit.bench && { nativeNs: report.jit.bench.nativeNs, jitNs: report.jit.bench.jitNs } }, aurora: report.aurora && { pass: report.aurora.pass, checks: report.aurora.checks }, error: report.error?.split('\n')[0], out }));
if (!report.pass) process.exitCode = 1;
