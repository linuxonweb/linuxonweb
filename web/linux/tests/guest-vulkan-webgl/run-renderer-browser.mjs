// Owns one finite Chromium process; file pages only, no HTTP test server.
import fs from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { translateGraphics } from '../guest-vulkan-graphics/translator/abi.mjs';
import { translateWebGLGraphics } from './translator/abi.mjs';

const task = '/mnt/p6/build/guest-vulkan-webgl-20260926';
const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(process.argv[2]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function disk(location) {
  const actual = await fs.realpath(location), stat = await fs.statfs(actual);
  if (!actual.startsWith(task + '/') || [0x01021994, 0x858458f6].includes(stat.type) || stat.bavail * stat.bsize < 1024 ** 3) throw Error('task disk path/capacity required');
}
for (const key of ['TMPDIR', 'TMP', 'TEMP']) await disk(process.env[key]);
if (!output.startsWith(task + '/')) throw Error('output outside task');
await fs.mkdir(output); await disk(output);
const inputs = {}, translations = {}, wgslTranslations = {};
async function frozen(source, destination) {
  const bytes = await fs.readFile(source); inputs[source] = sha(bytes);
  if (destination) { await fs.mkdir(path.dirname(destination), { recursive: true }); await fs.writeFile(destination, bytes); }
  return bytes;
}
for (const name of ['run-renderer-browser.mjs', 'renderer-browser.mjs']) await frozen(path.join(here, name), path.join(output, name));
await frozen(path.join(here, 'renderer.mjs'), path.join(output, 'modules/guest-vulkan-webgl/renderer.mjs'));
await frozen(path.join(here, '../guest-vulkan-graphics/renderer.mjs'), path.join(output, 'modules/guest-vulkan-graphics/renderer.mjs'));
const base = JSON.parse(await frozen(task + '/translator-check-run2/result.json'));
const coordinates = JSON.parse(await frozen(task + '/coordinate-check-run1/result.json'));
if (!base.pass || !coordinates.pass || base.artifactSha256 !== coordinates.artifactSha256) throw Error('translator reports differ');
for (const [name, item] of Object.entries(base.outputs)) {
  await disk(item.glslPath); const bytes = await frozen(item.glslPath);
  if (sha(bytes) !== item.glslSha256) throw Error('shader changed');
  translations[name] = { ...item.metadata, glsl: bytes.toString() };
}
for (const [name, item] of Object.entries(coordinates.results)) if (!item.rejected) {
  await disk(item.path); const bytes = await frozen(item.path);
  if (sha(bytes) !== item.glslSha256) throw Error('coordinate shader changed');
  translations[name] = { ...item.metadata, glsl: bytes.toString() };
}
const graphicsTask = '/mnt/p6/build/guest-vulkan-graphics-20260926';
await frozen(path.join(here, '../guest-vulkan-graphics/translator/abi.mjs'));
const wgslArtifact = await frozen(graphicsTask + '/translator-build-run3/translator.wasm');
if (sha(wgslArtifact) !== 'a530270fb7ae3099fbcf60964cff494987fdf608720ce34b936e52a545b3335b') throw Error('WGSL candidate changed');
const { instance } = await WebAssembly.instantiate(wgslArtifact, {});
for (const name of Object.keys(translations)) {
  const item = base.outputs[name] ?? coordinates.results[name];
  const source = base.outputs[name] ? graphicsTask + '/translator-fixtures-run1/' + name + '.spv' : task + '/coordinate-fixtures-run1/' + name + '.spv';
  const bytes = await frozen(source);
  if (sha(bytes) !== item.spvSha256) throw Error('SPIR-V identity changed');
  wgslTranslations[name] = translateGraphics(instance, bytes);
}
await frozen(path.join(here, 'translator/abi.mjs'));
await frozen(path.join(here, 'prepare-renderer-fixtures.py'));
const glArtifact = await frozen(task + '/translator-build-run2/translator.wasm');
if (sha(glArtifact) !== base.artifactSha256) throw Error('GLSL candidate changed');
const { instance: glInstance } = await WebAssembly.instantiate(glArtifact, {});
const extra = JSON.parse(await frozen(task + '/renderer-fixtures-run1/fixtures.json'));
if (!extra.pass) throw Error('independent renderer fixtures failed');
for (const [name, item] of Object.entries(extra.fixtures)) {
  const bytes = await frozen(task + '/renderer-fixtures-run1/' + item.file);
  const source = await frozen(task + '/renderer-fixtures-run1/' + name);
  if (sha(bytes) !== item.sha256 || sha(source) !== item.sourceSha256) throw Error('renderer SPIR-V source identity changed');
  translations[name] = translateWebGLGraphics(glInstance, bytes);
  wgslTranslations[name] = translateGraphics(instance, bytes);
}
await fs.writeFile(path.join(output, 'glsl-translations.json'), JSON.stringify(translations, null, 2) + '\n');
await fs.writeFile(path.join(output, 'wgsl-translations.json'), JSON.stringify(wgslTranslations, null, 2) + '\n');
const html = '<!doctype html><meta charset="utf-8"><title>WebGL renderer gate</title><pre id="result">running</pre>' +
  '<script>globalThis.TRANSLATIONS=' + JSON.stringify(translations).replaceAll('<', '\\u003c') +
  ';globalThis.WGSL_TRANSLATIONS=' + JSON.stringify(wgslTranslations).replaceAll('<', '\\u003c') + ';</script>' +
  '<script type="module" src="./renderer-browser.mjs"></script>';
await fs.writeFile(path.join(output, 'index.html'), html);
await fs.writeFile(path.join(output, 'inputs-before.json'), JSON.stringify(inputs, null, 2) + '\n');
const executable = '/home/a/.local/archpkg/pacman/usr/bin/chromium';
const args = ['--headless', '--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage',
  '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files', '--remote-debugging-port=0',
  '--user-data-dir=' + path.join(output, 'browser-profile'), '--disk-cache-dir=' + path.join(output, 'browser-cache'), 'about:blank'];
await fs.writeFile(path.join(output, 'command.json'), JSON.stringify([executable, ...args], null, 2) + '\n');
const log = openSync(path.join(output, 'browser.log'), 'wx');
const child = spawn(executable, args, { detached: true, env: { ...process.env, XDG_CACHE_HOME: path.join(output, 'xdg-cache') }, stdio: ['ignore', log, log] });
closeSync(log);
let exitInfo, spawnError, ws, connected = false, sequence = 0, report = { pass: false }, closing = false;
const exited = new Promise(resolve => {
  child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(exitInfo); });
  child.once('error', error => { spawnError = error; resolve({ error: String(error) }); });
});
const pending = new Map(), events = [];
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout: ' + method)); }, 45000);
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const reply = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (reply.exceptionDetails) throw Error(JSON.stringify(reply.exceptionDetails));
  return reply.result.value;
}
try {
  let port, browserPath;
  const deadline = Date.now() + 15000;
  for (;;) {
    if (spawnError || exitInfo) throw spawnError || Error('browser exited during startup');
    try { [port, browserPath] = (await fs.readFile(path.join(output, 'browser-profile/DevToolsActivePort'), 'utf8')).trim().split('\n'); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (Date.now() > deadline) throw Error('browser startup deadline');
    await sleep(100);
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(item => item.type === 'page'); if (!target) throw Error('owned page unavailable');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = message => {
    const reply = JSON.parse(message.data);
    if (reply.id) {
      const entry = pending.get(reply.id); if (!entry) return;
      pending.delete(reply.id); clearTimeout(entry.timer);
      if (reply.error) entry.reject(Error(JSON.stringify(reply.error))); else entry.resolve(reply.result);
    } else if (reply.method === 'Runtime.exceptionThrown') events.push(reply);
  };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('CDP open deadline')), 5000);
    ws.onopen = () => { clearTimeout(timer); connected = true; resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(Error('CDP socket error')); };
  });
  await call('Page.enable'); await call('Runtime.enable');
  const url = pathToFileURL(path.join(output, 'index.html')).href;
  await call('Page.navigate', { url });
  const readyDeadline = Date.now() + 10000;
  while (!await evaluate('!!window.rendererGate')) {
    if (events.length || Date.now() > readyDeadline) throw Error('renderer page failed to initialize');
    await sleep(50);
  }
  report = await evaluate('window.rendererGate');
  if (events.length) { report.pass = false; report.runtimeExceptions = events; }
  for (const [source, expected] of Object.entries(inputs)) if (sha(await fs.readFile(source)) !== expected) throw Error('source changed during gate: ' + source);
  report.inputs = inputs; report.artifactSha256 = base.artifactSha256; report.wgslArtifactSha256 = sha(wgslArtifact);
  report.scope = 'WebGL renderer plus same-SPIR-V WebGPU coordinate regression on SwiftShader; no guest fallback or physical GPU claim';
  // Browser.close is supported on the page connection and closes only this owned process.
  closing = true;
  await call('Browser.close');
} catch (error) { report.pass = false; report.runnerError = String(error.stack || error); }
finally {
  if (connected && !closing) { try { await call('Browser.close'); } catch { /* bounded process cleanup below */ } }
  for (const item of pending.values()) clearTimeout(item.timer);
  ws?.close();
  await Promise.race([exited, sleep(5000)]);
  if (!exitInfo && !spawnError) { process.kill(-child.pid, 'SIGTERM'); await Promise.race([exited, sleep(5000)]); report.forcedTermination = true; report.pass = false; }
  report.browserExit = exitInfo ?? { error: String(spawnError || 'did not exit') };
  if (exitInfo?.code !== 0) report.pass = false;
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ pass: report.pass, checks: report.checks, cases: report.cases?.length,
  negatives: report.negatives?.length, error: report.runnerError || report.failures?.[0], output }));
if (!report.pass) process.exitCode = 1;
