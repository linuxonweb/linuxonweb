// Finite owner of one static test server and one Chromium process. No deployment.
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../../..');
const task = '/mnt/p6/build/guest-vulkan-webgl-20260926', graphics = '/mnt/p6/build/guest-vulkan-graphics-20260926';
const compute = '/mnt/p6/build/guest-vulkan-compute-20260926';
const out = path.resolve(process.argv[2]);
const packageDir = path.resolve(process.argv[3] || graphics + '/webgl-integration-package-run2');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function disk(location, roots = [task]) {
  const actual = await fs.realpath(location), stats = await fs.statfs(actual);
  if (!roots.some(root => actual.startsWith(root + '/')) || [0x01021994, 0x858458f6].includes(stats.type) || stats.bavail * stats.bsize < 1024 ** 3) throw Error('disk-backed task path/capacity required');
}
for (const key of ['TMPDIR', 'TMP', 'TEMP']) await disk(process.env[key]);
if (!out.startsWith(task + '/')) throw Error('output outside task');
await fs.mkdir(out); await disk(out); await disk(packageDir, [graphics, compute]);
const inputs = {}, routes = new Map(), requested = [], errors = [];
async function freeze(source, destination) {
  const bytes = await fs.readFile(source); inputs[source] = hash(bytes);
  if (destination) { await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, bytes); }
  return bytes;
}
await freeze(fileURLToPath(import.meta.url), path.join(out, 'run-guest.mjs'));
const packageBytes = await freeze(path.join(packageDir, 'package.json'), path.join(out, 'package.json'));
const metadata = JSON.parse(packageBytes), build = metadata.guestBinary;
const isCompute = metadata.mode === 'compute';
if (!metadata.passPackage || !metadata.testOnly || (!isCompute && build.hostProfile !== 'webgl') || !build.pass) throw Error('verified graphics or compute guest package required');
const archive = await freeze(path.join(packageDir, 'initramfs.cpio'), path.join(out, 'initramfs.cpio'));
if (hash(archive) !== metadata.archiveSha256 || archive.length !== metadata.bytes) throw Error('guest archive differs');
for (const item of Object.values(build.sources)) if (hash(await freeze(item.source)) !== item.sha256) throw Error('compiled source changed: ' + item.source);
for (const [relative, expected] of Object.entries(build.hostSources)) {
  const source = path.join(repo, 'web/linux/tests', relative), bytes = await freeze(source, path.join(out, 'host-snapshot', relative));
  if (hash(bytes) !== expected) throw Error('compiled host binding changed: ' + relative);
  routes.set('/linux/tests/' + relative, bytes);
}
const candidate = isCompute ? '/linux/tests/guest-vulkan-compute/candidate-compute/' : '/linux/tests/guest-vulkan-webgl/candidate/';
routes.set(candidate + 'package.json', packageBytes); routes.set(candidate + 'initramfs.cpio', archive);
for (const [name, source, expected] of isCompute ? [
  ['compute', compute + '/translator-build-run4/translator.wasm', 'e4a7cadc55a68b712eb9b56758fd7624860cecc9f4da6ada8ac7928c61455fea']
] : [
  ['glsl', task + '/translator-build-run2/translator.wasm', '4fcdabf05d9e9cc0003e299739d809a7360256b405a3bb588e5a5771b410aa49'],
  ['wgsl', graphics + '/translator-build-run3/translator.wasm', 'a530270fb7ae3099fbcf60964cff494987fdf608720ce34b936e52a545b3335b']]) {
  const bytes = await freeze(source, path.join(out, name + '.wasm'));
  if (hash(bytes) !== expected) throw Error('translator differs: ' + name);
  routes.set(isCompute ? '/linux/tests/guest-vulkan-compute/translator/candidate/translator.wasm' : candidate + name + '.wasm', bytes);
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
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const origin = 'http://127.0.0.1:' + server.address().port;
const executable = '/home/a/.local/archpkg/pacman/usr/bin/chromium';
const args = ['--headless', '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + path.join(out, 'browser-profile'),
  '--disk-cache-dir=' + path.join(out, 'browser-cache'), 'about:blank'];
await fs.writeFile(path.join(out, 'command.json'), JSON.stringify([executable, ...args], null, 2) + '\n');
await fs.writeFile(path.join(out, 'inputs-before.json'), JSON.stringify(inputs, null, 2) + '\n');
const log = openSync(path.join(out, 'browser.log'), 'wx');
const child = spawn(executable, args, { detached: true, env: { ...process.env, XDG_CACHE_HOME: path.join(out, 'xdg-cache') }, stdio: ['ignore', log, log] }); closeSync(log);
let exitInfo, spawnError, ws, opened = false, closing = false, sequence = 0;
const exited = new Promise(resolve => {
  child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(exitInfo); });
  child.once('error', error => { spawnError = error; resolve({ error: String(error) }); });
});
const pending = new Map(), events = [], report = { pass: false, runs: [], origin, serverPid: process.pid, browserPid: child.pid };
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
const snapshot = () => evaluate(`({result:document.documentElement.dataset.result||null,guest:window.guestVulkanResults||null,
  ready:typeof document.querySelector('#boot')?.onclick==='function'})`);
try {
  let port; const startup = Date.now() + 15000;
  for (;;) {
    if (spawnError || exitInfo) throw spawnError || Error('browser exited during startup');
    try { [port] = (await fs.readFile(path.join(out, 'browser-profile/DevToolsActivePort'), 'utf8')).trim().split('\n'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (Date.now() > startup) throw Error('browser startup deadline'); await sleep(100);
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(), target = targets.find(item => item.type === 'page');
  if (!target) throw Error('owned browser target missing'); ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = message => {
    const item = JSON.parse(message.data);
    if (item.id) { const action = pending.get(item.id); if (!action) return; pending.delete(item.id); clearTimeout(action.timer);
      if (item.error) action.reject(Error(JSON.stringify(item.error))); else action.resolve(item.result);
    } else if (['Runtime.exceptionThrown', 'Network.loadingFailed'].includes(item.method) && events.length < 128) events.push(item);
  };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('CDP socket deadline')), 5000);
    ws.onopen = () => { clearTimeout(timer); opened = true; resolve(); }; ws.onerror = () => { clearTimeout(timer); reject(Error('CDP socket error')); };
  });
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  for (const backend of isCompute ? ['compute'] : ['webgl2', 'webgpu']) {
    const start = Date.now(), eventStart = events.length;
    await call('Page.navigate', { url: origin + (isCompute ? '/linux/tests/guest-vulkan-compute/index.html?candidate=candidate-compute' : '/linux/tests/guest-vulkan-webgl/guest.html?backend=' + backend) });
    await call('Page.bringToFront'); let clicked = false, state;
    for (;;) {
      state = await snapshot();
      if (!clicked && !state.ready && Date.now() - start > 10000) throw Error('guest page failed to initialize: ' + backend);
      if (!clicked && state.ready) { await evaluate("document.querySelector('#boot').click()"); clicked = true; }
      if (state.result) break;
      if (Date.now() - start > 145000) throw Error('guest deadline: ' + backend);
      await sleep(100);
    }
    const current = { backend, ...state, elapsedMs: Date.now() - start, events: events.slice(eventStart) };
    current.pass = state.result === 'pass' && state.guest?.pass && state.guest.hostLifetimePass && !current.events.some(item => item.method === 'Runtime.exceptionThrown');
    if (isCompute) current.pass &&= state.guest.host?.backend === 'webgpu' && state.guest.host?.contextsCreated === 0;
    report.runs.push(current);
    await fs.writeFile(path.join(out, backend + '.json'), JSON.stringify(current, null, 2) + '\n');
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(out, backend + '.png'), Buffer.from(screenshot.data, 'base64'));
    await evaluate("document.querySelector('#stop').click()");
    console.log(JSON.stringify({ backend, pass: current.pass, elapsedMs: current.elapsedMs, host: current.guest?.host?.backend }));
    if (!current.pass) throw Error('guest acceptance failed: ' + backend);
  }
  for (const [source, identity] of Object.entries(inputs)) if (hash(await fs.readFile(source)) !== identity) throw Error('input changed during run: ' + source);
  report.pass = true; closing = true; await call('Browser.close');
} catch (error) { report.error = String(error.stack || error); report.pass = false; }
finally {
  if (opened && !closing) {
    try { report.finalSnapshot = await snapshot(); await evaluate("document.querySelector('#stop')?.click()"); } catch { /* browser may have exited */ }
    try { await call('Browser.close'); } catch { /* owned-process cleanup below */ }
  }
  for (const item of pending.values()) clearTimeout(item.timer); ws?.close();
  await Promise.race([exited, sleep(5000)]);
  if (!exitInfo && !spawnError) { process.kill(-child.pid, 'SIGTERM'); await Promise.race([exited, sleep(5000)]); report.forcedTermination = true; report.pass = false; }
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  report.browserExit = exitInfo ?? { error: String(spawnError || 'did not exit') }; report.serverClosed = !server.listening;
  if (exitInfo?.code !== 0 || !report.serverClosed) report.pass = false;
  report.inputs = inputs; report.requested = requested; report.httpErrors = errors;
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ pass: report.pass, runs: report.runs.map(run => ({ backend: run.backend, pass: run.pass })), error: report.error, out }));
if (!report.pass) process.exitCode = 1;
