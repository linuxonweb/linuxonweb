import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { cpuCapacity, guestCpus, routePath, availableMemory } from './gpt6-codex-contract.mjs';
import { collectTrace, finishTrace } from './gpt6-codex-trace.mjs';
import { instrumentStartupSource, startupMemoryPlan } from './gpt6-codex-timing.mjs';
import { candidateFiles, jitRuntimePlan } from './gpt6-codex-overlays.mjs';
import { jitPlan, jitPackets, jitCaptureBounds, jitObservation, jitCompilerLines } from './gpt6-codex-jit.mjs';
import { hostJitIdentityPlan, instrumentJitIdentitySource, jitIdentityObservation } from './gpt6-codex-jit-identity.mjs';
import { FIXTURE_SHA256, caseChecks } from '../guest-rootfs/check-firefox-nightly-benchmark.mjs';
import { fullSafetyPlan, instrumentFullSafetyInit } from './gpt6-codex-safety.mjs';
import { loadFullSafetyBundle, createFullSafetyCollector } from './gpt6-codex-safety-owner.mjs';
import { pinFile } from '../nightly-jit-safety/guest-runner/contracts.mjs';

const [configFile] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const safetyPlan = fullSafetyPlan(config);
const jitRuntime = jitRuntimePlan(config);
const identityPlan = hostJitIdentityPlan(config, crypto.randomBytes(16).toString('hex'));
const memoryPlan = startupMemoryPlan(config);
if (config.trace && config.timing) throw Error('Use either tracing or direct timing, not both');
const jit = config.jitArm ? jitPlan(config.jitArm) : null;
if (jit?.arm === 'off' && !config.candidate) throw Error('Off control requires candidate boot flags');
if (config.jitFull && !jit) throw Error('Full JIT capture requires an explicit JIT arm');
const bounds = safetyPlan ? { observationSeconds: 150, ownerSeconds: 180 }
  : jit ? jitCaptureBounds(config.jitFull ?? false) : { observationSeconds: 120, ownerSeconds: 160 };
const { output, scratch, cpus, seconds } = config;
if (process.getuid() === 0 || !Number.isInteger(seconds) || seconds < 30 || seconds > bounds.observationSeconds || (jit && seconds !== bounds.observationSeconds) || !Number.isInteger(cpus) || cpus < 1) throw Error('Invalid bounded owner configuration');
if (config.display !== ':13' || !path.isAbsolute(config.xauthority || '')) throw Error('Use the authorized persistent display :13 and its private authority');
const started = performance.now();
const report = { startedAt: new Date().toISOString(), config, requests: [], console: [], errors: [], samples: [], screenshots: [], acceptance: 'Unreviewed; screenshots require actual visual review' };
const read = filename => fs.readFileSync(filename, 'utf8').trim();
const save = (filename, data) => fs.writeFileSync(path.join(output, filename), JSON.stringify(data, null, 2));
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const elapsed = () => Math.round(performance.now() - started);
const identity = pid => {
  try {
    const raw = read(`/proc/${pid}/stat`), fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
    const cgroup = read(`/proc/${pid}/cgroup`).split('\n').find(line => line.startsWith('0::'))?.slice(3);
    const status = read(`/proc/${pid}/status`);
    return { pid, parent: Number(fields[1]), group: Number(fields[2]), session: Number(fields[3]), startTicks: fields[19], cgroup, rssBytes: Number(/VmRSS:\s*(\d+) kB/.exec(status)?.[1] || 0) * 1024, affinity: /Cpus_allowed_list:\s*(\S+)/.exec(status)?.[1], cpuTicks: Number(fields[11]) + Number(fields[12]) };
  } catch { return null; }
};
const group = '/sys/fs/cgroup' + read('/proc/self/cgroup').split('\n').find(line => line.startsWith('0::')).slice(3);
const expectedGroup = group.slice('/sys/fs/cgroup'.length);
const tracked = new Map([[process.pid, identity(process.pid)]]);
const ownedProcesses = () => {
  const live = fs.readdirSync('/proc').filter(name => /^\d+$/.test(name)).map(name => identity(Number(name))).filter(Boolean);
  const selected = new Map(live.filter(entry => tracked.get(entry.pid)?.startTicks === entry.startTicks).map(entry => [entry.pid, entry]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of live) if (!selected.has(entry.pid) && selected.has(entry.parent)) { selected.set(entry.pid, entry); changed = true; }
  }
  for (const entry of selected.values()) tracked.set(entry.pid, entry);
  return [...selected.values()];
};
const stopOwnedChildren = (signal = 'SIGTERM') => {
  for (const entry of ownedProcesses().reverse()) {
    if (entry.pid !== process.pid && identity(entry.pid)?.startTicks === entry.startTicks) {
      try { process.kill(entry.pid, signal); } catch (error) { if (error.code !== 'ESRCH') report.errors.push(String(error)); }
    }
  }
};
const ancestry = [];
for (let directory = group; directory.startsWith('/sys/fs/cgroup'); directory = path.dirname(directory)) {
  if (fs.existsSync(`${directory}/cpu.max`)) ancestry.push({ directory, cpu: read(`${directory}/cpu.max`), memory: read(`${directory}/memory.max`) });
  if (directory === '/sys/fs/cgroup') break;
}
const affinity = /Cpus_allowed_list:\s*(\S+)/.exec(read('/proc/self/status'))?.[1];
report.resources = { group, ancestry, affinity, cpu: cpuCapacity(affinity, ancestry.map(entry => entry.cpu)), owner: identity(process.pid) };
if (report.resources.cpu.capacity !== cpus || report.resources.cpu.affinity !== cpus) throw Error('Owner quota/affinity must exactly equal the explicit test CPU lane');
if (fs.statfsSync(scratch).type !== 0xef53) throw Error('Use a bounded disk-backed ext4 scratch volume');
const volume = fs.statfsSync(scratch);
if (volume.blocks * volume.bsize > 2 * 1024 ** 3) throw Error('Scratch volume exceeds 2 GiB disk bound');

let browser, server, sessionId, sequence = 0, buffer = '', monitor, navigationTime;
let safetyBundle, safetyCapture, safetyDeadline, closing = false, nextSafetyPoll = 0;
let tracing = false, ownedPageId;
const traceComplete = Promise.withResolvers();
const sampleResources = () => {
  const memory = availableMemory(read('/proc/meminfo'));
  const processes = ownedProcesses();
  report.resources.memoryPolicy = 'Sampled host MemAvailable >=1 GiB; no hard aggregate cgroup cap';
  report.resources.memoryPeak = null;
  report.resources.minimumAvailableBytes = Math.min(report.resources.minimumAvailableBytes ?? Infinity, memory.bytes);
  const rss = processes.reduce((total, entry) => total + entry.rssBytes, 0);
  report.resources.sampledRssSumPeakBytes = Math.max(report.resources.sampledRssSumPeakBytes || 0, rss);
  report.resources.rssAccounting = 'Sampled sum of owned process RSS; shared pages may be counted more than once';
  report.resources.migrated = processes.some(entry => entry.cgroup !== expectedGroup && !entry.cgroup?.startsWith(expectedGroup + '/'));
  if (memory.low) throw Error(`Available RAM below 1 GiB: ${memory.bytes} bytes`);
  for (const entry of processes) {
    const limits = [];
    for (let directory = '/sys/fs/cgroup' + entry.cgroup; directory.startsWith('/sys/fs/cgroup'); directory = path.dirname(directory)) {
      if (fs.existsSync(`${directory}/cpu.max`)) limits.push(read(`${directory}/cpu.max`));
      if (directory === '/sys/fs/cgroup') break;
    }
    const cpu = cpuCapacity(entry.affinity, limits);
    if (cpu.affinity !== cpus || cpu.capacity !== cpus) throw Error(`CPU lane changed for PID ${entry.pid}: ${JSON.stringify(cpu)}`);
  }
  const sample = { timestampMs: Date.now(), elapsedMs: elapsed(), availableBytes: memory.bytes, rssSumBytes: rss, processes };
  if (memoryPlan) fs.appendFileSync(path.join(output, 'memory-resources.jsonl'), JSON.stringify(sample) + '\n');
  save('progress.json', { ...sample, screenshots: report.screenshots, lastSample: report.samples.at(-1) });
};
const deadline = setTimeout(() => {
  report.resourceFailure = `Owner reached its ${bounds.ownerSeconds}-second finite test deadline`;
  stopOwnedChildren();
}, bounds.ownerSeconds * 1000);
const pending = new Map();
const send = (method, params = {}, session = sessionId, timeout = 15000) => new Promise((resolve, reject) => {
  if (safetyCapture && !closing) timeout = Math.min(timeout, safetyCapture.remaining(performance.now()));
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timed out`)); }, timeout);
  pending.set(id, { resolve, reject, timer });
  browser.stdio[3].write(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }) + '\0');
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
const safetySeed = async install => {
  const encoded = Object.fromEntries(Object.entries(safetyBundle.seed).map(([name, bytes]) => [name, bytes.toString('base64')]));
  return evaluate(`(async () => {
    const { seedFullSafety } = await import('/linux/gpt6-codex-safety-home.mjs');
    const { openPersistentHome } = await import('/linux/persistent-home.mjs');
    const files = Object.fromEntries(Object.entries(${JSON.stringify(encoded)}).map(([name, value]) => [name, Uint8Array.from(atob(value), character => character.charCodeAt(0))]));
    const home = await openPersistentHome({readOnly:${!install}});
    try {
      ${install ? 'await seedFullSafety(home, files);' : ''}
      for (const [name, expected] of Object.entries(files)) {
        let node = home.root;
        for (const part of name.split('/')) { node = await home.lookup(node, part); if (!node) throw Error('Missing safety seed: ' + name); }
        const attributes = await home.getattr(node);
        if (Number(attributes.size) !== expected.length || (attributes.mode & 0o170000) !== 0o100000) throw Error('Safety seed metadata changed: ' + name);
        const handle = await home.open(node, 0);
        try {
          const actual = await home.read(node, handle, 0n, expected.length);
          if (actual.length !== expected.length || actual.some((byte, index) => byte !== expected[index])) throw Error('Safety seed bytes changed: ' + name);
        } finally { await home.release(node, handle); }
      }
      return {files:Object.keys(files).length,verified:true,readOnly:${!install}};
    } finally { await home.destroy(); }
  })()`);
};
const pollSafety = async () => {
  const base = `admin/nightly-jit-safety/${safetyPlan.label}/`;
  const rows = await evaluate(`(async () => {
    const { readFullSafetyArtifact } = await import('/linux/gpt6-codex-safety-home.mjs');
    const home = await (await import('/linux/persistent-home.mjs')).openPersistentHome({readOnly:true});
    const scoped = Object.assign(Object.create(home), {destroy:async () => {}});
    try {
      const rows = [];
      for (const name of ${JSON.stringify(safetyCapture.names)}) {
        const bytes = await readFullSafetyArtifact(async () => scoped, ${JSON.stringify(base)} + name);
        if (bytes === null) continue;
        let text = '';
        for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        rows.push({name,bytes:bytes.length,base64:btoa(text)});
      }
      return rows;
    } finally { await home.destroy(); }
  })()`);
  for (const row of rows) {
    const bytes = Buffer.from(row.base64, 'base64');
    if (bytes.length !== row.bytes || !safetyCapture.names.includes(row.name)) throw Error('Safety artifact transport differs');
    const filename = path.join(output, 'safety', row.name);
    fs.writeFileSync(filename, bytes);
    report.safety.artifacts[row.name] = { path: filename, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    safetyCapture.record(row.name, bytes, performance.now());
  }
  save('safety-progress.json', report.safety);
  const result = rows.find(row => row.name === 'session-result.json' && row.bytes);
  if (result && JSON.parse(Buffer.from(result.base64, 'base64')).status !== 'recorded') throw Error('Full safety session did not record all scopes');
  if (!safetyCapture.ready()) return false;
  Object.assign(report.safety, safetyCapture.complete(performance.now()));
  report.safety.finalSeed = await safetySeed(false);
  safetyCapture.remaining(performance.now());
  save('safety-progress.json', report.safety);
  return true;
};
let stderrBytes = 0;
try {
  await sleep(2100);
  sampleResources();
  const receipt = JSON.parse(read(config.receipt));
  const routes = structuredClone(receipt.routes);
  const inputs = new Map(Object.values(routes).map(entry => [entry.snapshot, entry]));
  for (const entry of inputs.values()) {
    const digest = crypto.createHash('sha256');
    for await (const bytes of fs.createReadStream(entry.snapshot)) digest.update(bytes);
    if (digest.digest('hex') !== entry.sha256 || fs.statSync(entry.snapshot).size !== entry.bytes) throw Error(`Frozen input mismatch: ${entry.snapshot}`);
  }
  report.frozenFilesVerified = inputs.size;
  sampleResources();
  if (safetyPlan) {
    safetyBundle = await loadFullSafetyBundle(config.safetyBundle, safetyPlan, config.repo, routes);
    fs.mkdirSync(path.join(output, 'safety'));
    fs.mkdirSync(path.join(output, 'safety-seed'));
    const seededFiles = {};
    for (const [name, bytes] of Object.entries(safetyBundle.seed)) {
      const filename = path.join(output, 'safety-seed', name);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, bytes, { flag: 'wx', mode: 0o444 });
      seededFiles[name] = { path: filename, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
    }
    fs.writeFileSync(path.join(output, 'safety-binding.json'), safetyBundle.bindingBytes, { flag: 'wx', mode: 0o444 });
    save('safety-session.json', safetyBundle.session);
    report.safety = { ...safetyPlan, session: safetyBundle.session, seededFiles, pins: safetyBundle.pins, artifacts: {}, captureComplete: false, pass: false };
    const source = path.join(config.repo, 'tools/startup-benchmark/gpt6-codex-safety-home.mjs');
    const bytes = fs.readFileSync(source), snapshot = path.join(output, 'gpt6-codex-safety-home.mjs');
    fs.writeFileSync(snapshot, bytes, { flag: 'wx', mode: 0o444 });
    routes['/linux/gpt6-codex-safety-home.mjs'] = { source, snapshot, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  }
  if (identityPlan) {
    report.jitIdentity = { ...identityPlan, ...jitIdentityObservation('', identityPlan.nonce, identityPlan.expectedEnvironment) };
    save('jit-identity.json', report.jitIdentity);
  }
  report.overlay = [];
  let jitFixture;
  if (jit) {
    const source = path.join(config.repo, 'tools/startup-benchmark/gpt6-codex-jit.mjs');
    const snapshot = path.join(output, 'gpt6-codex-jit.mjs');
    const bytes = fs.readFileSync(source);
    fs.writeFileSync(snapshot, bytes, { flag: 'wx', mode: 0o444 });
    const entry = { source, snapshot, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), diagnosticOnly: true };
    routes['/linux/gpt6-codex-jit.mjs'] = entry;
    report.overlay.push(entry);
    const fixturePath = path.join(config.repo, 'web/linux/tests/guest-jit-pbl-bench.html');
    jitFixture = fs.readFileSync(fixturePath, 'utf8');
    const sha256 = crypto.createHash('sha256').update(jitFixture).digest('hex');
    if (sha256 !== FIXTURE_SHA256) throw Error('Original JIT workload changed');
    fs.writeFileSync(path.join(output, jit.filename), jitFixture, { flag: 'wx', mode: 0o444 });
    report.jit = { ...jit, runtime: jitRuntime, bounds, fixturePath, fixtureSha256: sha256, diagnosticOnly: true, originalBenchmarkAcceptance: false };
    save('jit-plan.json', report.jit);
  }
  {
    for (const name of candidateFiles(config)) {
      const source = path.join(config.repo, 'web/linux', name), snapshot = path.join(output, path.basename(name));
      if (name === 'desktop-extras.mjs' && identityPlan) {
        fs.writeFileSync(snapshot, instrumentJitIdentitySource(fs.readFileSync(source, 'utf8'), identityPlan.nonce), { flag: 'wx' });
      } else if (name === 'desktop-extras.mjs' && safetyBundle) {
        fs.writeFileSync(snapshot, instrumentFullSafetyInit(fs.readFileSync(source, 'utf8'), safetyBundle.init), { flag: 'wx' });
      } else {
        fs.copyFileSync(source, snapshot, fs.constants.COPYFILE_EXCL);
      }
      fs.chmodSync(snapshot, 0o444);
      const bytes = fs.readFileSync(snapshot);
      const entry = { source, snapshot, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
      routes[`/linux/${name}`] = entry;
      report.overlay.push(entry);
    }
  }
  if (config.timing) {
    report.timings = { diagnosticOnly: true, maxEvents: 20000, events: [] };
    for (const kind of ['worker', 'platform', 'gpt6-codex-timing']) {
      const name = kind === 'gpt6-codex-timing' ? `${kind}.mjs` : `${kind}.js`;
      const route = `/linux/dist/${name}`;
      const source = kind === 'gpt6-codex-timing' ? path.join(config.repo, 'tools/startup-benchmark', name) : routes[route].snapshot;
      const original = fs.readFileSync(source, 'utf8');
      const bytes = Buffer.from(kind === 'gpt6-codex-timing' ? original : instrumentStartupSource(kind, original));
      const snapshot = path.join(output, `timed-${name}`);
      fs.writeFileSync(snapshot, bytes, { flag: 'wx', mode: 0o444 });
      const entry = { source, snapshot, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), sourceSha256: crypto.createHash('sha256').update(original).digest('hex'), diagnosticOnly: true };
      routes[route] = entry;
      report.overlay.push(entry);
    }
  }
  save('source.json', { build: receipt.build, receipt: config.receipt, overlays: report.overlay, frozenFilesVerified: inputs.size });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
  server = http.createServer((request, response) => {
    let route;
    try { route = routePath(request.url); } catch { response.writeHead(400); response.end(); return; }
    const headers = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-store' };
    if (route === '/owner-setup') { response.writeHead(200, { ...headers, 'Content-Type': 'text/html' }); response.end('<!doctype html><title>Isolated launch probe</title>'); return; }
    const entry = routes[route];
    const event = { route, startedMs: elapsed(), bytes: entry?.bytes, status: entry ? 200 : 404 };
    if (report.requests.length < 3000) report.requests.push(event);
    if (!entry) { response.writeHead(404, headers); response.end(); return; }
    response.writeHead(200, { ...headers, 'Content-Type': types[path.extname(route)] || 'application/octet-stream', 'Content-Length': entry.bytes });
    const stream = fs.createReadStream(entry.snapshot);
    stream.on('error', error => { report.errors.push(String(error)); response.destroy(); });
    response.on('finish', () => { event.finishedMs = elapsed(); });
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  report.server = { port: server.address().port, owner: identity(process.pid) };
  const origin = `http://127.0.0.1:${report.server.port}`;
  for (const name of ['home', 'profile', 'cache', 'tmp', 'runtime', 'config', 'crashes']) fs.mkdirSync(path.join(scratch, name), { mode: 0o700 });
  const args = ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=vulkan', '--use-gl=angle', '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer,VulkanFromANGLE,DefaultANGLEVulkan,WebGPU', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--disable-breakpad', '--disable-crash-reporter', '--disable-background-networking', '--password-store=basic', '--remote-debugging-pipe', `--user-data-dir=${scratch}/profile`, `--disk-cache-dir=${scratch}/cache`, `--crash-dumps-dir=${scratch}/crashes`, '--disk-cache-size=268435456', '--window-size=1400,900', 'about:blank'];
  report.command = { binary: '/usr/bin/prime-run', args: ['/home/a/.local/archpkg/pacman/usr/lib/chromium/chromium', ...args] };
  const browserSpawnedAt = performance.now();
  browser = spawn(report.command.binary, report.command.args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: `${scratch}/home`, DISPLAY: config.display, XAUTHORITY: config.xauthority, TMPDIR: `${scratch}/tmp`, TMP: `${scratch}/tmp`, TEMP: `${scratch}/tmp`, XDG_CACHE_HOME: `${scratch}/cache`, XDG_CONFIG_HOME: `${scratch}/config`, XDG_RUNTIME_DIR: `${scratch}/runtime` } });
  if (safetyPlan) {
    safetyCapture = createFullSafetyCollector(safetyPlan, safetyBundle.session, browserSpawnedAt);
    report.safety.browserSpawnedAt = browserSpawnedAt;
    safetyDeadline = setTimeout(() => {
      report.resourceFailure = 'Original 150-second full-safety deadline expired';
      stopOwnedChildren();
    }, 150000);
  }
  report.browser = identity(browser.pid);
  browser.on('error', error => { report.errors.push(String(error)); });
  browser.on('exit', (code, signal) => { report.browserExit = { code, signal }; });
  browser.stderr.on('data', bytes => { if (stderrBytes < 1048576) { const keep = bytes.subarray(0, 1048576 - stderrBytes); fs.appendFileSync(path.join(output, 'browser.log'), keep); stderrBytes += keep.length; } });
  browser.stdio[4].on('data', bytes => {
    buffer += bytes.toString();
    let boundary;
    while ((boundary = buffer.indexOf('\0')) !== -1) {
      const message = JSON.parse(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 1);
      const waiter = pending.get(message.id);
      if (waiter) { clearTimeout(waiter.timer); pending.delete(message.id); message.error ? waiter.reject(Error(JSON.stringify(message.error))) : waiter.resolve(message.result); }
      else if (message.method === 'Tracing.tracingComplete') traceComplete.resolve(message.params);
      else if (message.method === 'Tracing.bufferUsage') report.traceBufferUsage = message.params;
      else if (message.method === 'Runtime.exceptionThrown' && report.errors.length < 200) report.errors.push(message.params);
      else if (message.method === 'Runtime.consoleAPICalled' && report.console.length < 500) report.console.push({ elapsedMs: elapsed(), args: message.params.args.map(argument => argument.value ?? argument.description) });
    }
  });
  monitor = setInterval(() => {
    try {
      sampleResources();
    } catch (error) {
      report.resourceFailure = String(error);
      report.resources.memoryPeak = null;
      clearInterval(monitor);
      stopOwnedChildren();
    }
  }, 500);
  report.browserVersion = await send('Browser.getVersion', {}, null);
  report.gpu = await send('SystemInfo.getInfo', {}, null);
  const target = await send('Target.createTarget', { url: 'about:blank' }, null);
  ownedPageId = target.targetId;
  ({ sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `${origin}/owner-setup` });
  for (let retry = 0; retry < 40 && await evaluate('location.pathname') !== '/owner-setup'; retry++) await sleep(50);
  report.browserCpus = await evaluate('navigator.hardwareConcurrency');
  if (report.resourceFailure) throw Error(report.resourceFailure);
  sampleResources();
  if (report.browserCpus !== cpus) throw Error(`Browser CPU count ${report.browserCpus} differs from allocated ${cpus}`);
  await evaluate(`localStorage.setItem('linuxonweb.machine-settings.v1', JSON.stringify({resolution:${JSON.stringify(memoryPlan?.resolution ?? '1280x720')},cpus:${cpus},cpuVersion:1,ram:${memoryPlan?.ramMiB ?? 4096},backend:${JSON.stringify(safetyPlan ? 'canvas2d' : 'auto')},presentationVersion:2}))`);
  if (safetyPlan) report.safety.initialSeed = await safetySeed(true);
  if (jit) {
    await evaluate(`(async () => { const { seedJitBenchmark } = await import('/linux/gpt6-codex-jit.mjs'); const home = await (await import('/linux/persistent-home.mjs')).openPersistentHome(); try { await seedJitBenchmark(home, ${JSON.stringify(jitFixture)}, ${JSON.stringify(jit)}); } finally { await home.destroy(); } })()`);
  }
  if (config.trace) {
    const available = await send('Tracing.getCategories', {}, null);
    const categories = ['v8', 'v8.wasm', 'disabled-by-default-v8.cpu_profiler'];
    report.trace = { requestedCategories: categories, availableCategories: available.categories, diagnosticOnly: true };
    await send('Tracing.start', { transferMode: 'ReturnAsStream', streamFormat: 'json', streamCompression: 'none', bufferUsageReportingInterval: 1000, traceConfig: { recordMode: 'recordUntilFull', traceBufferSizeInKb: 65536, enableSampling: true, includedCategories: categories } }, null);
    tracing = true;
  }
  navigationTime = elapsed();
  report.navigationMs = navigationTime;
  await send('Page.navigate', { url: `${origin}/linux/index.html?firefox=1&proxy=${encodeURIComponent('ws://127.0.0.1:3000')}${jit?.query || ''}${memoryPlan?.query || ''}${safetyPlan ? '&renderer=canvas2d&gpu=0' : ''}` });
  let nextScreenshot = 10000;
  const observedPackets = [];
  while (elapsed() - navigationTime < seconds * 1000) {
    if (report.resourceFailure) throw Error(report.resourceFailure);
    if (safetyCapture) safetyCapture.remaining(performance.now());
    try {
      if (config.timing) {
        const observation = await evaluate(`({ pageOrigin: performance.timeOrigin, events: (globalThis.__gpt6StartupTimings || []).slice(${report.timings.events.length}, ${report.timings.maxEvents}) })`);
        report.timings.pageOrigin = observation.pageOrigin;
        report.timings.events.push(...observation.events);
        save('startup-timings.json', report.timings);
      }
      const sample = await evaluate(`(async () => { const module = await import('/linux/main.js'); const history = module.guestLogs.history; const rows = []; for (let cursor = Math.max(window.__ownerLog ?? 0, history.firstId); cursor < history.nextId;) { const page = history.page(Math.min(history.nextId, cursor + 100), 100).filter(row => row.id >= cursor); if (!page.length) break; rows.push(...page); cursor = page.at(-1).id + 1; } window.__ownerLog = history.nextId; return {pageMs:performance.now(),status:document.querySelector('#status')?.textContent,browserCpus:navigator.hardwareConcurrency,selectedCpus:Number(document.querySelector('#cpu-cores')?.value),selectedRamMiB:Number(document.querySelector('#ram')?.value),rows:rows.map(row => row.text),dialogs:[...document.querySelectorAll('dialog[open]')].map(dialog => ({id:dialog.id,text:dialog.textContent.slice(0,1000)}))}; })()`);
      sample.observedMs = elapsed() - navigationTime;
      report.samples.push(sample);
      fs.appendFileSync(path.join(output, 'guest.log'), sample.rows.join('\n') + '\n');
      if (safetyCapture && performance.now() >= nextSafetyPoll) {
        if (await pollSafety()) break;
        nextSafetyPoll = performance.now() + 1000;
      }
      if (jit) {
        try { observedPackets.push(...jitPackets(sample.rows.join('\n'))); }
        catch (error) { report.jit.packetError = String(error); break; }
        report.jit.observation = jitObservation(observedPackets, elapsed() - navigationTime, seconds * 1000, jit.filename.slice(0, -5), cpus);
        save('jit-progress.json', { ...report.jit.observation, packets: observedPackets, observedMs: elapsed() - navigationTime });
        if (report.jit.observation.state !== 'running') break;
      }
      if (sample.dialogs.length) {
        report.dialogBlocked = sample.dialogs;
        const image = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(output, 'dialog.png'), Buffer.from(image.data, 'base64'));
        report.screenshots.push({ filename: 'dialog.png', afterMs: elapsed() - navigationTime });
        break;
      }
    } catch (error) {
      if (safetyCapture) throw error;
      if (report.errors.length < 200) report.errors.push({ observedMs: elapsed() - navigationTime, error: String(error) });
    }
    if (elapsed() - navigationTime >= nextScreenshot) {
      const beforeMs = elapsed() - navigationTime;
      const image = await send('Page.captureScreenshot', { format: 'png' });
      const filename = `screen-${Math.round(beforeMs)}.png`;
      fs.writeFileSync(path.join(output, filename), Buffer.from(image.data, 'base64'));
      report.screenshots.push({ filename, beforeMs, afterMs: elapsed() - navigationTime });
      nextScreenshot += 10000;
    }
    await sleep(300);
  }
  const logs = fs.existsSync(path.join(output, 'guest.log')) ? read(path.join(output, 'guest.log')) : '';
  report.guestCpus = guestCpus(logs);
  report.cpuEquality = report.guestCpus === cpus && report.samples.every(sample => sample.browserCpus === cpus && sample.selectedCpus === cpus);
  report.memoryEquality = report.samples.length > 0 && !report.samples.some(sample => sample.selectedRamMiB !== (memoryPlan?.ramMiB ?? 4096));
  if (!report.memoryEquality) throw Error('Observed RAM selection differs from host probe configuration');
  report.bootTimings = logs.split('\n').filter(line => /boot timing:|firefox.*exec|exec.*firefox|smp: Brought up/i.test(line));
  if (safetyCapture) {
    if (!report.cpuEquality || !report.safety.captureComplete) throw Error('Full safety CPU/capture gate incomplete');
    const smpLines = logs.split('\n').filter(line => /smp: Brought up \d+ nodes?, \d+ CPUs?\b/.test(line));
    save('safety-cpu.json', { hostNproc: cpus, hostNprocObserved: report.resources.cpu.capacity,
      browserHardwareConcurrencyAtBoot: report.browserCpus, selectedGuestCpus: cpus,
      requestedGuestCpus: safetyBundle.session.requestedGuestCpus, guestBootCpus: report.guestCpus, smpLines });
    fs.writeFileSync(path.join(output, 'safety-startup.txt'), logs);
  }
  if (jit) {
    const packets = jitPackets(logs);
    report.jit.packets = packets;
    report.jit.caseChecks = caseChecks(packets.filter(packet => packet.event === 'case'));
    report.jit.observation = report.jit.packetError ? { state: 'error', jitAcceptance: false, originalBenchmarkAcceptance: false } : jitObservation(packets, elapsed() - navigationTime, seconds * 1000, jit.filename.slice(0, -5), cpus);
    report.jit.observedCompilerLines = jitCompilerLines(logs);
    save('jit-results.json', report.jit);
  }
  if (identityPlan) {
    report.jitIdentity = { ...identityPlan, ...jitIdentityObservation(logs, identityPlan.nonce, identityPlan.expectedEnvironment) };
    save('jit-identity.json', report.jitIdentity);
    if (report.jitIdentity.state !== 'verified') throw Error('Native JIT switch identity was not verified');
  }
} catch (error) {
  report.error = String(error.stack || error); process.exitCode = 1;
}
finally {
  closing = true;
  clearTimeout(safetyDeadline);
  if (tracing && browser && browser.exitCode === null && browser.signalCode === null) {
    let timer;
    try {
      await finishTrace((method, params) => send(method, params, null), ownedPageId);
      report.trace.closedOwnedPage = ownedPageId;
      const result = await Promise.race([traceComplete.promise, new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('Trace flush timed out')), 15000); })]);
      clearTimeout(timer);
      Object.assign(report.trace, result);
      if (!result.stream) throw Error('Trace completed without a stream');
      const filename = path.join(output, 'startup-trace.json');
      const descriptor = fs.openSync(filename, 'wx', 0o600);
      try {
        report.trace.collected = await collectTrace((method, params) => send(method, params, null), result.stream, bytes => fs.appendFileSync(descriptor, bytes));
        report.trace.filename = filename;
      } finally { fs.closeSync(descriptor); }
    } catch (error) { report.traceError = String(error); process.exitCode = 1; }
    finally { clearTimeout(timer); }
  }
  clearInterval(monitor);
  clearTimeout(deadline);
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    try { await send('Browser.close', {}, null, 4000); } catch (error) { report.closeError = String(error); }
    for (let attempt = 0; attempt < 50 && browser.exitCode === null && browser.signalCode === null; attempt++) await sleep(100);
    if (browser.exitCode === null && browser.signalCode === null && identity(browser.pid)?.startTicks === report.browser?.startTicks) browser.kill('SIGTERM');
  }
  for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(Error('Owner closing')); }
  pending.clear();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  stopOwnedChildren();
  for (let attempt = 0; attempt < 30 && ownedProcesses().some(entry => entry.pid !== process.pid); attempt++) await sleep(100);
  stopOwnedChildren('SIGKILL');
  await sleep(100);
  report.resources.remainingOwnedChildren = ownedProcesses().filter(entry => entry.pid !== process.pid);
  report.resources.finalProcesses = read(`${group}/cgroup.procs`).split('\n').map(Number).map(identity).filter(Boolean);
  report.resources.memoryPeak = null;
  report.resources.memoryEvents = read(`${group}/memory.events`);
  report.resources.cpuStat = read(`${group}/cpu.stat`);
  report.elapsedMs = elapsed();
  if (safetyBundle) {
    try { for (const pin of safetyBundle.pins) await pinFile(pin); report.safety.inputsUnchanged = true; }
    catch (error) { report.safety.inputsUnchanged = false; report.safety.inputError = String(error); process.exitCode = 1; }
    report.safety.runtimeAccepted = false;
  }
  save('report.json', report);
  console.log(JSON.stringify({ error: report.error, screenshots: report.screenshots.length, cpuEquality: report.cpuEquality, elapsedMs: report.elapsedMs }));
}
