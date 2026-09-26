// Node 22+, task-owned Chromium with remote debugging. Does not launch a browser.
// GPU_QA_OUT must name a fresh directory; only this runner's tab is closed.
import fs from 'node:fs/promises';
import path from 'node:path';

const kind = process.argv[2];
if (!['host', 'guest'].includes(kind) || !process.env.GPU_QA_OUT) {
  throw Error('usage: GPU_QA_OUT=/fresh/path node run-browser.mjs host|guest');
}
const out = path.resolve(process.env.GPU_QA_OUT);
await fs.mkdir(out);
const cdp = process.env.CDP_URL || 'http://127.0.0.1:9394';
const base = process.env.GPU_QA_BASE || 'http://127.0.0.1:4180/linux/tests/guest-gpu/';
const target = await (await fetch(`${cdp}/json/new?about:blank`, {method: 'PUT'})).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
const pending = new Map(), events = [];
let id = 0;
ws.onmessage = event => {
  const m = JSON.parse(event.data);
  if (m.id) {
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id); clearTimeout(p.timer);
    if (m.error) p.reject(Error(JSON.stringify(m.error))); else p.resolve(m.result);
  } else if (['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Network.loadingFailed'].includes(m.method) && events.length < 500) {
    events.push({at: Date.now(), method: m.method, params: m.params});
  }
};
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const seq = ++id;
    const timer = setTimeout(() => { pending.delete(seq); reject(Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(seq, {resolve, reject, timer});
    ws.send(JSON.stringify({id: seq, method, params}));
  });
}
async function evaluate(expression) {
  const r = await call('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
const snapshot = () => evaluate(`({
  result: document.documentElement.dataset.result || null,
  host: window.guestGPUHostTests || null, guest: window.guestGPUResults || null,
  gpuAPI: !!navigator.gpu,
  ready: !!window.guestGPUResults && typeof document.querySelector('#boot')?.onclick === 'function',
  bootDisabled: document.querySelector('#boot')?.disabled ?? null,
  resources: performance.getEntriesByType('resource').map(r => ({name:r.name, ms:r.duration, transfer:r.transferSize}))
})`);
let report = {kind, target: target.id, startedAt: Date.now(), pass: false, events};
const save = () => fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
try {
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Page.navigate', {url: new URL(kind === 'host' ? 'host-test.html' : 'index.html', base).href});
  await call('Page.bringToFront');
  const deadline = Date.now() + (kind === 'host' ? 60000 : 125000);
  let clicked = false;
  for (;;) {
    const state = await snapshot();
    report = {...report, ...state, elapsedMs: Date.now() - report.startedAt};
    if (kind === 'guest' && !clicked && state.ready) {
      clicked = await evaluate("(document.querySelector('#boot').click(), document.querySelector('#boot').disabled)");
      if (!clicked) throw Error('installed boot handler did not acknowledge click');
      report.clickedAt = Date.now();
    }
    await save();
    if (state.result) break;
    if (report.elapsedMs >= 60000 && !report.snapshot60s) {
      report.snapshot60s = true;
      await fs.writeFile(path.join(out, 'state-60s.json'), JSON.stringify(report, null, 2) + '\n');
    }
    if (Date.now() >= deadline) throw Error('external harness deadline');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  report.pass = report.result === 'pass';
  if (kind === 'guest') {
    const r = report.guest;
    report.pass = report.pass && r.host?.draws === 1 && r.host?.readbacks === 1 &&
      r.host?.released === 4 && !r.host?.error && r.errors.length === 0 &&
      ['GUEST_GPU_PIXELS_PASS', 'GUEST_GPU_X11_PRESENT_PASS', 'GUEST_GPU_LIFETIME_PASS'].every(s => r.logs.includes(s));
  }
} catch (error) {
  report.error = String(error); report.pass = false;
} finally {
  try { report = {...report, ...await snapshot(), elapsedMs: Date.now() - report.startedAt}; }
  catch (error) { report.finalSnapshotError = String(error); }
  try {
    const shot = await call('Page.captureScreenshot', {format: 'png'});
    await fs.writeFile(path.join(out, 'page.png'), Buffer.from(shot.data, 'base64'));
  } catch (error) { report.screenshotError = String(error); }
  await save();
  if (kind === 'guest') await evaluate("document.querySelector('#stop')?.click()").catch(() => {});
  for (const p of pending.values()) clearTimeout(p.timer);
  ws.close();
  await fetch(`${cdp}/json/close/${target.id}`);
}
console.log(JSON.stringify({pass: report.pass, result: report.result, error: report.error, out}));
if (!report.pass) process.exitCode = 1;
