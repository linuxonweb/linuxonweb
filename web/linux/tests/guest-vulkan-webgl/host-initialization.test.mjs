// Acquisition/lifecycle fault injection only. Real rendering is a separate gate.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { serveGPU, MAGIC, VERSION, OP } from '../guest-gpu/host.mjs';
const task = '/mnt/p6/build/guest-vulkan-webgl-20260926', output = path.resolve(process.argv[2]);
for (const key of ['TMPDIR', 'TMP', 'TEMP']) {
  const actual = await fs.realpath(process.env[key]), stat = await fs.statfs(actual);
  assert.ok(actual.startsWith(task + '/') && ![0x01021994, 0x858458f6].includes(stat.type));
}
assert.ok(output.startsWith(task + '/')); await fs.mkdir(output);
let checks = 0; const cases = [];
const check = (value, label) => { assert.ok(value, label); checks++; };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function connection() {
  const count = { closed: 0, reads: 0, writes: 0 };
  return { count, readExactly: async () => { count.reads++; return new Uint8Array(); },
    write: async () => { count.writes++; }, close: () => { count.closed++; } };
}
function device() {
  const counts = { destroyed: 0 };
  return { counts, lost: new Promise(() => {}), destroy() { counts.destroyed++; } };
}
function lease() {
  const counts = { closed: 0 };
  return { counts, gl: { VENDOR: 1, RENDERER: 2, getExtension: () => null, getParameter: () => 'fault-injection context' }, close() { counts.closed++; } };
}
const rejectedFactory = () => { throw Error('expected translator startup failure'); };
for (const mode of ['not-enabled', 'invalid-profile', 'missing-api', 'null-adapter', 'adapter-error', 'device-error']) {
  const transport = connection(), context = lease(); let contextCalls = 0;
  const gpu = mode === 'null-adapter' ? { requestAdapter: async () => null } :
    mode === 'adapter-error' ? { requestAdapter: async () => { throw Error('adapter failure'); } } :
    mode === 'device-error' ? { requestAdapter: async () => ({ requestDevice: async () => { throw Error('device failure'); } }) } : null;
  const report = await serveGPU(transport, { gpu, allowGraphics: mode !== 'invalid-profile', allowWebGL: mode !== 'not-enabled',
    webglContextFactory: () => { contextCalls++; return context; }, webglTranslatorFactory: rejectedFactory });
  const fallback = !['not-enabled', 'invalid-profile'].includes(mode);
  check(contextCalls === Number(fallback), mode + ' fallback eligibility');
  check(context.counts.closed === Number(fallback), mode + ' context released');
  check(transport.count.closed === 1 && !transport.count.reads, mode + ' no protocol before initialization');
  check(report.backend === (fallback ? 'webgl2' : null), mode + ' selected backend');
  check(!fallback || report.error === 'expected translator startup failure', mode + ' failure preserved');
  cases.push({ mode, report, contextCalls });
}
{
  const transport = connection(), acquired = device(); let fallbackCalls = 0;
  const report = await serveGPU(transport, { gpu: { requestAdapter: async () => ({ info: {}, requestDevice: async () => acquired }) },
    allowGraphics: true, allowWebGL: true, graphicsTranslatorFactory: rejectedFactory,
    webglContextFactory: () => { fallbackCalls++; return lease(); } });
  check(report.backend === 'webgpu' && report.error === 'expected translator startup failure', 'post-acquisition shader startup fails on selected GPU');
  check(fallbackCalls === 0 && acquired.counts.destroyed === 1, 'no fallback after device acquired');
  cases.push({ mode: 'no-late-fallback', report });
}
for (const mode of ['late-device', 'late-context', 'late-translator']) {
  let resolveLate;
  const deferred = new Promise(resolve => { resolveLate = resolve; });
  const acquired = device(), context = lease(), transport = connection(); let translatorClosed = 0, fallbackCalls = 0;
  const options = { timeoutMs: 10, allowGraphics: true, allowWebGL: true,
    gpu: mode === 'late-context' ? null : { requestAdapter: async () => ({ info: {}, requestDevice: () => mode === 'late-device' ? deferred : Promise.resolve(acquired) }) },
    graphicsTranslatorFactory: () => deferred,
    webglContextFactory: () => { fallbackCalls++; return deferred; } };
  const report = await serveGPU(transport, options);
  check(report.error === 'session deadline' && transport.count.closed === 1, mode + ' bounded session completion');
  resolveLate(mode === 'late-device' ? acquired : mode === 'late-context' ? context : { close() { translatorClosed++; } });
  await tick();
  check(mode === 'late-context' ? context.counts.closed === 1 : acquired.counts.destroyed === 1, mode + ' late resource disposal');
  check(fallbackCalls === (mode === 'late-context' ? 1 : 0), mode + ' no fallback on session timeout');
  check(mode !== 'late-translator' || translatorClosed === 1, 'late translator closes');
  cases.push({ mode, report, translatorClosed });
}
{
  // Exercise the wire contract through the real host, with no rendering calls.
  // Poisoned native methods ensure unsupported commands cannot reach a GPU.
  const denied = Array.from({ length: 15 }, (_, i) => i + 1).filter(op => ![OP.DESTROY, OP.CLOSE].includes(op));
  const opcodes = [OP.HELLO, ...denied, OP.GRAPHICS_SHADER, OP.DESTROY, OP.HELLO, OP.CLOSE];
  let offset = 0, closed = 0, contextClosed = 0, translatorClosed = 0, translations = 0;
  const frames = opcodes.map((op, i) => {
    const payload = op === OP.GRAPHICS_SHADER ? 20 : op === OP.DESTROY ? 4 : 0;
    const frame = new Uint8Array(16 + payload), view = new DataView(frame.buffer);
    view.setUint32(0, MAGIC, true); view.setUint16(4, VERSION, true); view.setUint16(6, op, true);
    view.setUint32(8, i + 1, true); view.setUint32(12, payload, true); return frame;
  });
  const stream = new Uint8Array(frames.reduce((n, frame) => n + frame.length, 0));
  for (const frame of frames) { stream.set(frame, offset); offset += frame.length; } offset = 0;
  const replies = [], canvas = new EventTarget(), poison = () => { throw Error('unexpected native rendering'); };
  const gl = { canvas, VENDOR: 1, RENDERER: 2, getExtension: () => null, getParameter: () => 'synthetic wire test',
    NO_ERROR: 0, getError: () => 0, isContextLost: () => false,
    texStorage2D: poison, fenceSync: poison, getBufferSubData: poison,
    useProgram() {}, bindVertexArray() {}, bindFramebuffer() {}, bindBuffer() {}, bindTexture() {} };
  const report = await serveGPU({
    async readExactly(n) { assert.ok(offset + n <= stream.length); const bytes = stream.slice(offset, offset + n); offset += n; return bytes; },
    async write(bytes) { replies.push(bytes.slice()); }, close() { closed++; }
  }, { gpu: null, allowGraphics: true, allowWebGL: true, allowCompute: true, allowClear: true,
    webglContextFactory: () => ({ gl, close() { contextClosed++; } }),
    webglTranslatorFactory: async () => ({ translate() { translations++; throw Object.assign(Error('invalid test SPIR-V'), { status: -22 }); }, close() { translatorClosed++; } }) });
  await fs.writeFile(path.join(output, 'wire.json'), JSON.stringify({ report, replies: replies.length, expected: opcodes.length }, null, 2) + '\n');
  check(replies.length === opcodes.length && report.commands === opcodes.length, 'every supported wire frame receives a reply');
  for (let i = 0; i < replies.length; i++) {
    const view = new DataView(replies[i].buffer), op = opcodes[i];
    check(view.getUint32(0, true) === MAGIC && view.getUint16(4, true) === VERSION && view.getUint16(6, true) === (op | 0x8000) && view.getUint32(8, true) === i + 1, 'reply identity ' + i);
    check(view.getInt32(16, true) === ([OP.HELLO, OP.CLOSE].includes(op) ? 0 : -22), 'recoverable rejection ' + op);
    if (op === OP.HELLO) {
      const hello = JSON.parse(new TextDecoder().decode(replies[i].slice(20)));
      check(hello.backend === 'webgl2' && hello.graphicsProfile === 1 && !hello.computeProfile && !hello.clearImage && hello.shader === 'SPIR-V' && hello.maxVertexStride === 252 && hello.integerViewport, 'honest fallback capabilities');
    }
  }
  check(report.error === null && report.graphics.resources === 0 && report.graphics.nativeObjects === 0, 'rejections leave a usable empty session');
  check(closed === 1 && contextClosed === 1 && translatorClosed === 1 && translations === 1, 'normal protocol cleanup exactly once');
  check(report.dispatches === 0 && report.draws === 0 && report.clears === 0, 'no private WGSL/compute/clear work');
  cases.push({ mode: 'wire-capability-denial-and-recovery', opcodes, report });
}
await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ pass: true, checks, cases,
  scope: 'Synthetic acquisition, late-resource cleanup and wire rejection; not rendering or physical GPU evidence' }, null, 2) + '\n');
console.log(JSON.stringify({ pass: true, checks, cases: cases.length, output }));
