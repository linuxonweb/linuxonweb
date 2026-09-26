// Uses only the sole serving owner's already-running browser/server; owns one tab.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const task = '/mnt/p6/build/guest-vulkan-graphics-20260926';
const manifestSha256 = process.env.GRAPHICS_MANIFEST_SHA;
if (!process.env.GRAPHICS_QA_OUT || !/^[a-f0-9]{64}$/.test(manifestSha256 ?? ''))
  throw Error('GRAPHICS_QA_OUT and GRAPHICS_MANIFEST_SHA required');
const out = path.resolve(await fs.realpath(path.dirname(process.env.GRAPHICS_QA_OUT)), path.basename(process.env.GRAPHICS_QA_OUT));
if (!out.startsWith(task + '/')) throw Error('output must be on the task disk');
const mounts = (await fs.readFile('/proc/self/mountinfo', 'utf8')).trim().split('\n').map(line => {
  const [fields, details] = line.split(' - ');
  return { mount: fields.split(' ')[4].replaceAll('\\040', ' '), type: details.split(' ')[0] };
});
async function diskCheck(location) {
  const match = mounts.filter(m => m.mount === '/' || location === m.mount || location.startsWith(m.mount + '/'))
    .sort((a, b) => b.mount.length - a.mount.length)[0];
  if (!match || ['tmpfs', 'ramfs'].includes(match.type)) throw Error('disk-backed path required');
  const stats = await fs.statfs(location);
  if (stats.bavail * stats.bsize < 1024 ** 3) throw Error('less than 1 GiB free');
  return { ...match, availableBytes: stats.bavail * stats.bsize };
}
const scratch = {};
for (const name of ['TMPDIR', 'TMP', 'TEMP']) {
  if (!process.env[name]) throw Error(name + ' required');
  scratch[name] = await fs.realpath(process.env[name]);
  if (!scratch[name].startsWith(task + '/')) throw Error('scratch must be on task disk');
  await diskCheck(scratch[name]);
}
const storage = { output: out, filesystem: await diskCheck(path.dirname(out)), scratch };
await fs.mkdir(out);
const hash = data => createHash('sha256').update(data).digest('hex');
const cdp = process.env.CDP_URL || 'http://127.0.0.1:9396';
const base = process.env.GRAPHICS_QA_BASE || 'http://127.0.0.1:4182/linux/tests/guest-vulkan-graphics/candidate/';
let target, ws, opened = false, sequence = 0;
const events = [], pending = new Map();
let report = { pass: false, storage, manifestSha256, events, startedAt: Date.now(),
  runnerSha256: hash(await fs.readFile(fileURLToPath(import.meta.url))),
  scope: 'Host browser Worker and WebGPU graphics gate; no guest execution or physical acceleration claim' };
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP deadline: ' + method)); }, 15000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const snapshot = () => evaluate(`({result:document.documentElement?.dataset.result || null,
  qa:window.graphicsQa || null, ready:!!window.graphicsQa && typeof document.querySelector('#run')?.onclick === 'function'})`);
try {
  const response = await fetch(new URL('qa-inputs.json', base));
  if (!response.ok) throw Error('manifest unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 262144 || hash(bytes) !== manifestSha256) throw Error('runner manifest SHA mismatch');
  const manifest = JSON.parse(new TextDecoder().decode(bytes));
  if (manifest.sources['run-browser.mjs'].sha256 !== report.runnerSha256) throw Error('runner source differs from frozen manifest');
  // Check the bootstrap scripts before navigation; in-page verification checks
  // all frozen runtime/source/SPIR-V bytes before creating translator/GPU objects.
  for (const name of ['qa.html', 'qa.mjs']) {
    const source = await fetch(new URL(name, base));
    if (!source.ok || hash(new Uint8Array(await source.arrayBuffer())) !== manifest.sources[name].sha256)
      throw Error('bootstrap source SHA mismatch: ' + name);
  }
  const created = await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' });
  if (!created.ok) throw Error('cannot create owned QA tab');
  target = await created.json(); ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const item = pending.get(message.id); if (!item) return;
      pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(Error(JSON.stringify(message.error))); else item.resolve(message.result);
    } else if (['Runtime.exceptionThrown', 'Network.loadingFailed'].includes(message.method) && events.length < 128) events.push(message);
  };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('CDP open deadline')), 15000);
    ws.onopen = () => { clearTimeout(timer); opened = true; resolve(); };
    ws.onerror = error => { clearTimeout(timer); reject(error); };
  });
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  const url = new URL('qa.html', base); url.searchParams.set('manifest', manifestSha256);
  report.url = url.href;
  await call('Page.navigate', { url: url.href }); await call('Page.bringToFront');
  let clicked = false;
  const deadline = Date.now() + 120000;
  for (;;) {
    const state = await snapshot();
    report = { ...report, ...state, elapsedMs: Date.now() - report.startedAt };
    if (!clicked && state.ready) clicked = await evaluate("(document.querySelector('#run').click(), document.querySelector('#run').disabled)");
    if (state.result) break;
    if (Date.now() > deadline) throw Error('external graphics QA deadline');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  report.pass = report.result === 'pass' && report.qa?.pass === true && report.qa.rounds.length === 8 &&
    report.qa.errors.length === 0 && ['Workers', 'Devices', 'Buffers', 'Textures'].every(kind => report.qa.ownership['live' + kind] === 0) &&
    !events.some(event => event.method === 'Runtime.exceptionThrown');
} catch (error) { report.error = String(error?.stack ?? error); report.pass = false; }
finally {
  if (opened) {
    try { await evaluate('window.graphicsQaCleanup?.(); true'); report = { ...report, ...await snapshot() }; }
    catch (error) { report.snapshotError = String(error); report.pass = false; }
    try {
      const screenshot = await call('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(path.join(out, 'page.png'), Buffer.from(screenshot.data, 'base64'));
    } catch (error) { report.screenshotError = String(error); report.pass = false; }
  }
  for (const item of pending.values()) clearTimeout(item.timer);
  ws?.close();
  if (target) {
    try {
      const closed = await fetch(`${cdp}/json/close/${target.id}`);
      if (!closed.ok) throw Error('owned tab close failed');
      report.tabClosed = true;
    } catch (error) { report.cleanupError = String(error); report.pass = false; }
  }
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ pass: report.pass, out, error: report.error, checks: report.qa?.checks,
  rounds: report.qa?.rounds?.length, ownership: report.qa?.ownership }));
if (!report.pass) process.exitCode = 1;
