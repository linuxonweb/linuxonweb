// W4a: finite owner of one static test server (127.0.0.1:4201) and one Chromium
// (CDP 127.0.0.1:9411). The decoder wasm route is served from the hash-pinned W3 build. Closes both. No deployment, no persistent service.
// Chromium runs headful on the existing X display (DISPLAY=:0) with Dawn's
// Vulkan backend, so a high-performance adapter request reaches the discrete
// GPU (NVIDIA GeForce MX110 on this host; headless only gets a software or
// integrated adapter). PRIME offload variables are removed from the browser
// environment: they break WebGL on this host and are not needed for Vulkan.
//
//   node run-guest.mjs OUT BUILD_DIR   W4a wgpu executor guest test
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

const HTTP_PORT = 4201, CDP_PORT = 9411;
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../../..');
const task = '/mnt/p6/build/firefox-webgpu-w4a-20260930';
const mode = 'wgpu-executor';
const [outArg, buildArg] = process.argv.slice(2);
if (!outArg || !buildArg) throw Error('usage: OUT BUILD_DIR');
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
const buildDir = path.resolve(buildArg); await disk(buildDir);
const buildBytes = await freeze(path.join(buildDir, 'build.json'), path.join(out, 'build.json'));
const build = JSON.parse(buildBytes);
const archive = await freeze(path.join(buildDir, 'initramfs.cpio'));
if (!build.pass || hash(archive) !== build.archiveSha256 || archive.length !== build.archiveBytes) throw Error('archive differs from build report');
if (hash(await freeze(path.join(repo, 'web/linux/dist/worker.js'))) !== build.workerSha256) throw Error('runtime differs from build report');
for (const [name, identity] of Object.entries(build.runtimeSha256))
  if (hash(await freeze(path.join(repo, 'web/linux/dist', name))) !== identity) throw Error('runtime differs from build report: ' + name);
routes.set('/linux/tests/firefox-webgpu-executor/candidate/build.json', buildBytes);
routes.set('/linux/tests/firefox-webgpu-executor/candidate/initramfs.cpio', archive);
if (hash(await freeze(path.join(repo, 'web/linux/tests/firefox-webgpu-decoder/decoder.mjs'))) !== build.decoderModuleSha256) throw Error('decoder module differs from build report');
const decoderWasm = await freeze(build.decoderWasm);
if (hash(decoderWasm) !== build.decoderWasmSha256) throw Error('decoder wasm differs from build report');
routes.set('/linux/dist/firefox-webgpu-decoder.wasm', decoderWasm); // pinned W3 artifact (not in the repo)
const pageUrl = '/linux/tests/firefox-webgpu-executor/index.html';
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
const executable = '/home/a/.local/archpkg/pacman/usr/bin/chromium';
const args = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--window-size=1280,900',
  '--disable-dev-shm-usage', '--password-store=basic', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + path.join(out, 'profile'),
  '--disk-cache-dir=' + path.join(out, 'cache'), 'about:blank'];
await fs.writeFile(path.join(out, 'command.json'), JSON.stringify([executable, ...args], null, 2) + '\n');
await fs.writeFile(path.join(out, 'inputs-before.json'), JSON.stringify(inputs, null, 2) + '\n');
if (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then(() => true, () => false)) throw Error('CDP port already in use');
const log = openSync(path.join(out, 'browser.log'), 'wx');
const browserEnv = { ...process.env, DISPLAY: ':0', XDG_CACHE_HOME: path.join(out, 'xdg') };
for (const key of ['__NV_PRIME_RENDER_OFFLOAD', '__NV_PRIME_RENDER_OFFLOAD_PROVIDER', '__GLX_VENDOR_LIBRARY_NAME', '__VK_LAYER_NV_optimus', 'DRI_PRIME'])
  delete browserEnv[key];
await fs.writeFile(path.join(out, 'browser-env.json'), JSON.stringify({ DISPLAY: browserEnv.DISPLAY, XDG_CACHE_HOME: browserEnv.XDG_CACHE_HOME,
  TMPDIR: browserEnv.TMPDIR, primeVariablesRemoved: true }, null, 2) + '\n');
const child = spawn(executable, args, { detached: true, env: browserEnv, stdio: ['ignore', log, log] });
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
const snapshot = () => evaluate(`({result:document.documentElement?.dataset.result||null,guest:window.guestWgpuResults||null,
  ready:typeof document.querySelector('#boot')?.onclick==='function'})`);
function parseGuest(guest) {
  const lines = guest.lines.map(line => line.text);
  const summary = lines.map(line => /^GUEST_WGPU SUMMARY passes=(\d+) failures=(\d+)/.exec(line)).find(Boolean);
  const fields = line => Object.fromEntries([...line.matchAll(/(\w+)=(-?\d+)/g)].map(m => [m[1], Number(m[2])]));
  const strings = line => Object.fromEntries([...line.matchAll(/(\w+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
  const tagged = tag => lines.filter(line => line.startsWith('GUEST_WGPU ' + tag + ' '));
  const memory = guest.bootConfigurationEvidence.flatMap(e => [...e.text.matchAll(/Memory:\s*\d+K\/(\d+)K/g)].map(m => Number(m[1])));
  const smp = guest.bootConfigurationEvidence.flatMap(e => [...e.text.matchAll(/smp: Brought up\s+\d+\s+nodes?,\s+(\d+)\s+CPUs/g)].map(m => Number(m[1])));
  const adapterLine = tagged('ADAPTER')[0] ?? '';
  return {
    exitStatus: guest.exitStatus,
    passes: summary ? Number(summary[1]) : null, failures: summary ? Number(summary[2]) : null,
    failLines: lines.filter(line => line.startsWith('GUEST_WGPU FAIL')),
    errLines: tagged('ERR'), eventLines: tagged('EVENT'), mapLines: tagged('MAP'), mapError: tagged('MAP_ERROR'),
    deviceLost: tagged('DEVICE_LOST'), stats: tagged('STATS'),
    requestAdapter: tagged('REQUEST_ADAPTER').map(fields)[0] ?? null,
    requestDevice: tagged('REQUEST_DEVICE').map(fields)[0] ?? null,
    latency: tagged('LATENCY').map(fields)[0] ?? null,
    expectVendor: (tagged('EXPECT_VENDOR')[0] ?? '').split(' ')[2] || null,
    adapter: adapterLine ? { ...strings(adapterLine), ...fields(adapterLine.replace(/"[^"]*"/g, '""')),
      pciVendorHex: /pci_vendor=(0x[0-9a-f]+)/.exec(adapterLine)?.[1] ?? null, line: adapterLine } : null,
    adapterFeatures: tagged('ADAPTER_FEATURES')[0] ?? null,
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
    } else if (item.method === 'Runtime.consoleAPICalled') {
      const text = (item.params.args || []).slice(0, 6).map(arg => ['string', 'number', 'boolean'].includes(arg.type)
        ? String(arg.value).slice(0, 2048) : String(arg.description || arg.type || '').slice(0, 512)).join(' ').slice(0, 4096);
      if (/gpu|hostcall|webgpu|wgpu|decoder|user-module|trap/i.test(text) && consoleMessages.length < 64) consoleMessages.push({ type: item.params.type, text });
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
      if (!clicked && state.ready) { await evaluate("document.querySelector('#boot').click()"); clicked = true; }
      if (state.result) break;
      if (Date.now() - start > 310000) throw Error('guest deadline');
      await sleep(250);
    }
    report.elapsedMs = Date.now() - start;
    report.guest = { ...state.guest, logs: undefined };
    await fs.writeFile(path.join(out, 'guest-console.txt'), state.guest.logs);
    report.hostcall = parseGuest(state.guest);
    report.adapterInfo = report.hostcall.adapter;
    report.expectVendor = build.expectVendor ?? null;
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(out, 'page.png'), Buffer.from(screenshot.data, 'base64'));
    await evaluate("document.querySelector('#stop').click()");
    report.events = events;
    const pass = state.result === 'pass' && report.hostcall.exitStatus === 0 && report.hostcall.failures === 0 && report.hostcall.passes > 0 &&
      report.hostcall.configuration.verified && state.guest.errors.length === 0 &&
      (!build.expectVendor || (report.hostcall.expectVendor === build.expectVendor && report.hostcall.adapter?.vendor === build.expectVendor && report.hostcall.adapter?.fallback === 0)) && !events.some(e => e.method === 'Runtime.exceptionThrown');
    if (!pass) throw Error('W4a wgpu executor acceptance failed');
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
console.log(JSON.stringify({ mode, pass: report.pass, hostcall: report.hostcall && { passes: report.hostcall.passes, failures: report.hostcall.failures, failLines: report.hostcall.failLines, latency: report.hostcall.latency }, error: report.error?.split('\n')[0], out }));
if (!report.pass) process.exitCode = 1;
