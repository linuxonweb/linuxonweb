// Finite owner of one static test server (HTTP 4194) and one Chromium (CDP 9404).
// Runs isolated guest Vulkan packages in the real 1 GiB / 2 CPU guest; no deployment.
// Usage: node run-finite.mjs OUTPUT TASK_ROOT [suite,...]
// Runtime files other than the pinned host sources are served from Git HEAD blobs,
// isolating the run from concurrent working-tree edits to web/linux/dist.
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../../..');
const out = path.resolve(process.argv[2] || ''), task = path.resolve(process.argv[3] || '');
const HTTP_PORT = 4194, CDP_PORT = 9404;
const a3 = '/mnt/p6/build/guest-vulkan-a3-20260928';
const compute = '/mnt/p6/build/guest-vulkan-compute-20260926';
const direct = ['live', 'unavailable', 'clear', 'loss-transport', 'loss-device', 'exhaustion'];
const allSuites = [...direct.map(mode => 'direct-' + mode), 'loader', 'compute', 'graphics-webgl2', 'graphics-webgpu', 'uniform-webgl2', 'uniform-webgpu'];
const suites = process.argv[4] ? process.argv[4].split(',') : allSuites;
if (suites.some(item => !allSuites.includes(item))) throw Error('unknown suite');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function disk(location, roots = [task]) {
  const actual = await fs.realpath(location), stats = await fs.statfs(actual);
  if (!roots.some(root => actual.startsWith(root + '/')) || [0x01021994, 0x858458f6].includes(stats.type) || stats.bavail * stats.bsize < 1024 ** 3) throw Error('disk-backed task path/capacity required: ' + location);
}
if (!task.startsWith('/mnt/p6/build/') || !out.startsWith(task + '/')) throw Error('output must be inside a /mnt/p6/build task');
for (const key of ['TMPDIR', 'TMP', 'TEMP']) await disk(process.env[key]);
await fs.mkdir(out); await disk(out);
const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const inputs = {}, routes = new Map(), requested = [], errors = [], headServed = {};
async function freeze(source, destination) {
  const bytes = await fs.readFile(source); inputs[source] = hash(bytes);
  if (destination) { await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, bytes); }
  return bytes;
}
function route(url, bytes) {
  const existing = routes.get(url);
  if (existing && hash(existing) !== hash(bytes)) throw Error('conflicting route bytes: ' + url);
  routes.set(url, bytes);
}
await freeze(fileURLToPath(import.meta.url), path.join(out, 'run-finite.mjs'));
const packages = {
  ...Object.fromEntries(direct.map(mode => ['direct-' + mode, { dir: `${task}/direct-package-${mode}-run4`, prefix: `/linux/tests/guest-vulkan/candidate${mode === 'live' ? '' : '-' + mode}/` }])),
  loader: { dir: `${task}/loader-package-run4`, prefix: '/linux/tests/guest-vulkan-loader/candidate-clear/' },
  compute: { dir: `${task}/compute-package-run4`, prefix: '/linux/tests/guest-vulkan-compute/candidate-compute/' },
  graphics: { dir: `${task}/graphics-package-run4`, prefix: '/linux/tests/guest-vulkan-webgl/candidate/' },
  uniform: { dir: `${task}/uniform-package-run4`, prefix: '/linux/tests/guest-vulkan-uniform/candidate/' },
};
const needed = new Set(suites.map(item => item.startsWith('graphics-') ? 'graphics' : item.startsWith('uniform-') ? 'uniform' : item));
const metadataBySuite = {};
for (const name of needed) {
  const { dir, prefix } = packages[name]; await disk(dir);
  const packageBytes = await freeze(path.join(dir, 'package.json'), path.join(out, 'packages', name, 'package.json'));
  const metadata = JSON.parse(packageBytes), build = metadata.guestBinary; metadataBySuite[name] = metadata;
  if (!metadata.passPackage || !metadata.testOnly || !build.pass) throw Error('verified test package required: ' + name);
  const archive = await fs.readFile(path.join(dir, 'initramfs.cpio')); inputs[path.join(dir, 'initramfs.cpio')] = hash(archive);
  if (hash(archive) !== metadata.archiveSha256 || archive.length !== metadata.bytes) throw Error('guest archive differs: ' + name);
  for (const item of Object.values(build.sources)) if (hash(await freeze(item.source)) !== item.sha256) throw Error('compiled source changed: ' + item.source);
  for (const [relative, expected] of Object.entries(build.hostSources)) {
    const bytes = await freeze(path.join(repo, 'web/linux/tests', relative), path.join(out, 'host-snapshot', relative));
    if (hash(bytes) !== expected) throw Error('compiled host binding changed: ' + relative);
    route('/linux/tests/' + relative, bytes);
  }
  route(prefix + 'package.json', packageBytes); route(prefix + 'initramfs.cpio', archive);
}
const translators = [];
if (needed.has('compute')) translators.push(['/linux/tests/guest-vulkan-compute/translator/candidate/translator.wasm', compute + '/translator-build-run4/translator.wasm', 'e4a7cadc55a68b712eb9b56758fd7624860cecc9f4da6ada8ac7928c61455fea']);
if (needed.has('graphics') || needed.has('uniform')) translators.push(
  ['/linux/tests/guest-vulkan-webgl/candidate/glsl.wasm', a3 + '/glsl-translator-build-run1/translator.wasm', '31d062e7582ab95333cab7eb87c11b031e481ccd30c5ba5b6498aad04a6aa0bd'],
  ['/linux/tests/guest-vulkan-webgl/candidate/wgsl.wasm', a3 + '/wgsl-translator-build-run1/translator.wasm', 'f1df22534091d4c00fab4884e970c03040c7fc1c9353d29c8421e186758d4542']);
for (const [url, source, expected] of translators) {
  const bytes = await freeze(source);
  if (hash(bytes) !== expected) throw Error('translator differs: ' + source); route(url, bytes);
}
function headBlob(relative) {
  const bytes = execFileSync('git', ['-C', repo, 'cat-file', 'blob', `${head}:${relative}`], { maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return bytes;
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css' };
const server = createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    const url = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!url.startsWith('/linux/') || url.includes('\0') || url.includes('/../')) throw Error('unsupported route');
    let bytes = routes.get(url);
    if (!bytes) {
      const relative = 'web' + url;
      if (path.posix.normalize(relative) !== relative) throw Error('route escape');
      bytes = headBlob(relative);
      let working = null; try { working = hash(await fs.readFile(path.join(repo, relative))); } catch { /* absent */ }
      headServed[url] = { sha256: hash(bytes), workingTreeMatchesHead: working === hash(bytes) };
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
const args = ['--headless', '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + CDP_PORT,
  '--user-data-dir=' + path.join(out, 'profile'), '--disk-cache-dir=' + path.join(out, 'cache'), 'about:blank'];
await fs.writeFile(path.join(out, 'command.json'), JSON.stringify([executable, ...args], null, 2) + '\n');
await fs.writeFile(path.join(out, 'inputs-before.json'), JSON.stringify(inputs, null, 2) + '\n');
const log = openSync(path.join(out, 'browser.log'), 'wx');
const child = spawn(executable, args, { detached: true, env: { ...process.env, XDG_CACHE_HOME: path.join(out, 'xdg-cache') }, stdio: ['ignore', log, log] }); closeSync(log);
let exitInfo, spawnError, ws, opened = false, closing = false, sequence = 0;
const exited = new Promise(resolve => {
  child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(exitInfo); });
  child.once('error', error => { spawnError = error; resolve({ error: String(error) }); });
});
const pending = new Map(), events = [];
const report = { pass: false, head, suites, runs: [], origin, cdpPort: CDP_PORT, runnerPid: process.pid, browserPid: child.pid };
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
const snapshot = () => evaluate(`({result:document.documentElement?.dataset.result||null,guest:window.guestVulkanResults||null,
  ready:typeof document.querySelector('#boot')?.onclick==='function'})`);
const pageFor = suite => suite.startsWith('direct-') ? `/linux/tests/guest-vulkan/index.html?candidate=${suite === 'direct-live' ? 'candidate' : 'candidate-' + suite.slice(7)}`
  : suite === 'loader' ? '/linux/tests/guest-vulkan-loader/index.html?candidate=candidate-clear'
  : suite === 'compute' ? '/linux/tests/guest-vulkan-compute/index.html?candidate=candidate-compute'
  : suite.startsWith('uniform-') ? '/linux/tests/guest-vulkan-uniform/guest.html?backend=' + suite.slice('uniform-'.length)
  : '/linux/tests/guest-vulkan-webgl/guest.html?backend=' + suite.slice('graphics-'.length);
const exitPattern = /^GUEST_VK(?:_LOADER|_COMPUTE|_GRAPHICS|_UNIFORM)?_EXIT status=(\d+) checks=(\d+)$/m;
try {
  let target; const startup = Date.now() + 15000;
  for (;;) {
    if (spawnError || exitInfo) throw spawnError || Error('browser exited during startup');
    try { target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find(item => item.type === 'page'); if (target) break; } catch { /* not listening yet */ }
    if (Date.now() > startup) throw Error('browser startup deadline'); await sleep(100);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = message => {
    const item = JSON.parse(message.data);
    if (item.id) { const action = pending.get(item.id); if (!action) return; pending.delete(item.id); clearTimeout(action.timer);
      if (item.error) action.reject(Error(JSON.stringify(item.error))); else action.resolve(item.result);
    } else if (['Runtime.exceptionThrown', 'Network.loadingFailed'].includes(item.method) && events.length < 256) events.push(item);
  };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('CDP socket deadline')), 5000);
    ws.onopen = () => { clearTimeout(timer); opened = true; resolve(); }; ws.onerror = () => { clearTimeout(timer); reject(Error('CDP socket error')); };
  });
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  for (const suite of suites) {
    const start = Date.now(), eventStart = events.length;
    await call('Page.navigate', { url: origin + pageFor(suite) });
    await call('Page.bringToFront'); let clicked = false, state;
    for (;;) {
      state = await snapshot();
      if (!clicked && !state.ready && Date.now() - start > 10000) throw Error('guest page failed to initialize: ' + suite);
      if (!clicked && state.ready) { await evaluate("document.querySelector('#boot').click()"); clicked = true; }
      if (state.result) break;
      if (Date.now() - start > 145000) throw Error('guest deadline: ' + suite);
      await sleep(100);
    }
    const guest = state.guest || {}, logs = String(guest.logs || '').replaceAll('\r', ''), exit = logs.match(exitPattern);
    const evidence = guest.bootConfigurationEvidence || [];
    const current = { suite, result: state.result, pass: false, elapsedMs: Date.now() - start, checks: exit ? Number(exit[2]) : null,
      exitStatus: exit ? Number(exit[1]) : null, bootConfigurationEvidence: evidence, markers: logs.split('\n').filter(line => /^GUEST_VK\w*(?:_PASS|_SYNC|_EXIT)\b/.test(line)),
      errors: guest.errors, hostLifetimePass: guest.hostLifetimePass, host: guest.host, events: events.slice(eventStart) };
    current.pass = state.result === 'pass' && guest.pass === true && guest.hostLifetimePass === true && (guest.errors || []).length === 0 &&
      current.exitStatus === 0 && evidence.some(line => /Memory:.*\/1048576K/.test(line)) && evidence.some(line => /smp: Brought up 1 node, 2 CPUs/.test(line)) &&
      !current.events.some(item => item.method === 'Runtime.exceptionThrown');
    if (suite.startsWith('direct-')) current.pass &&= guest.mode === suite.slice(7);
    if (suite === 'compute') current.pass &&= guest.host?.backend === 'webgpu' && guest.host?.contextsCreated === 0;
    if (suite.startsWith('graphics-')) current.pass &&= guest.host?.backend === suite.slice('graphics-'.length);
    if (suite.startsWith('uniform-')) current.pass &&= guest.host?.backend === suite.slice('uniform-'.length) && guest.mode === 'uniform';
    report.runs.push(current);
    await fs.writeFile(path.join(out, suite + '.json'), JSON.stringify({ ...current, guest }, null, 2) + '\n');
    const screenshot = await call('Page.captureScreenshot', { format: 'png' });
    await fs.writeFile(path.join(out, suite + '.png'), Buffer.from(screenshot.data, 'base64'));
    await evaluate("document.querySelector('#stop')?.click()");
    console.log(JSON.stringify({ suite, pass: current.pass, checks: current.checks, elapsedMs: current.elapsedMs }));
    if (!current.pass) throw Error('guest acceptance failed: ' + suite);
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
  report.inputs = inputs; report.headServed = headServed; report.requested = requested; report.httpErrors = errors;
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ pass: report.pass, runs: report.runs.map(run => ({ suite: run.suite, pass: run.pass, checks: run.checks })), error: report.error, out }));
if (!report.pass) process.exitCode = 1;
