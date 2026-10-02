// Runs the host emitter test modules (emit.cpp output) against a shared
// memory laid out like a PBL frame/stack and checks every exit's state.
// Usage: node run.mjs DIR
import fs from 'node:fs';
const dir = process.argv[2];
const memory = new WebAssembly.Memory({ initial: 4, maximum: 65536, shared: true });
const table = new WebAssembly.Table({ initial: 0, element: 'anyfunc' });
const dv = new DataView(memory.buffer);
const FRAME = 0x10000, SP = 0x20000, INTR = 0x30000, OUT = 0x30010, ARGV = 0x30100;
const INT = 0xFFFFFF81, BOOL = 0xFFFFFF82, UNDEF = 0xFFFFFF83, DOUBLE_HI = 0x40000000;
let failures = 0, checks = 0;
const check = (name, got, want) => { checks++; if (got !== want) { failures++; console.log('FAIL', name, 'got', got, 'want', want); } };
const setLocal = (k, v, tag = INT) => { dv.setUint32(FRAME - 8 * (k + 1), v >>> 0, true); dv.setUint32(FRAME - 8 * (k + 1) + 4, tag, true); };
const local = k => [dv.getInt32(FRAME - 8 * (k + 1), true), dv.getUint32(FRAME - 8 * (k + 1) + 4, true)];
const setArg = (k, v, tag = INT) => { dv.setUint32(ARGV + 8 * k, v >>> 0, true); dv.setUint32(ARGV + 8 * k + 4, tag, true); };
const arg = k => [dv.getInt32(ARGV + 8 * k, true), dv.getUint32(ARGV + 8 * k + 4, true)];
function run(name, setup) {
  const meta = JSON.parse(fs.readFileSync(`${dir}/${name}.json`));
  const mod = new WebAssembly.Module(fs.readFileSync(`${dir}/${name}.wasm`));
  const f0 = new WebAssembly.Instance(mod, { env: { memory, table } }).exports.f0;
  new Uint8Array(memory.buffer, 0, 0x40000).fill(0xEE);
  dv.setUint32(INTR, 0, true);
  setup();
  const args = [FRAME, SP, INTR, OUT, ARGV].map(BigInt).concat(Array(18).fill(0n));
  const kind = Number(f0(...args));
  return { meta, kind, sp: dv.getUint32(OUT, true), pcDelta: dv.getInt32(OUT + 4, true), ic: dv.getUint32(OUT + 8, true) };
}
const slot = i => [dv.getInt32(SP - 8 * (i + 1), true), dv.getUint32(SP - 8 * (i + 1) + 4, true)];

let r = run('intloop', () => { setLocal(0, 0); setLocal(1, 0); });
check('intloop kind', r.kind, 1); check('intloop sp', r.sp, SP); check('intloop pc', r.pcDelta, r.meta.len); check('intloop ic', r.ic, 2);
check('intloop sum', local(0)[0], 49995000); check('intloop i', local(1)[0], 10000); check('intloop tag', local(0)[1], INT);

r = run('intloop', () => { setLocal(0, 0); setLocal(1, 0, DOUBLE_HI); });
check('noentry kind', r.kind, 0); check('noentry local untouched', local(1)[1], DOUBLE_HI);

r = run('intloop', () => { setLocal(0, 0); setLocal(1, 0); dv.setUint32(INTR, 4, true); });
check('interrupt kind', r.kind, 3); check('interrupt pc', r.pcDelta, 0); check('interrupt ic', r.ic, 0); check('interrupt sp', r.sp, SP);
check('interrupt sum', local(0)[0], 0); check('interrupt i', local(1)[0], 1);

r = run('addovf', () => { setLocal(0, 2147483000); setLocal(1, 0); });
{ let s = 2147483000, i = 0; while (s + i <= 2147483647) { s += i; i++; }
  check('addovf kind', r.kind, 2); check('addovf ic', r.ic, 2); check('addovf sp', r.sp, SP - 16);
  check('addovf sum', local(0)[0], s); check('addovf i', local(1)[0], i);
  check('addovf slot0', slot(0)[0], s); check('addovf slot1', slot(1)[0], i); check('addovf slot tags', slot(0)[1] === INT && slot(1)[1] === INT, true);
  const addPc = 6 + 4 + 3 + 1 + 5 + 5 + 4 + 4; check('addovf pc', r.pcDelta, addPc); }

r = run('dowhile', () => { setLocal(2, 5); });
{ let x = 5, kind = 1; do { const m = x * 3; if (m > 2147483647 || m < -2147483648 || (m === 0 && x < 0)) { kind = 2; break; } x = ((m - 1) ^ (x >>> 1)) | 0; } while (x < 100000);
  check('dowhile kind', r.kind, kind); check('dowhile x', local(2)[0], x); check('dowhile pc', r.pcDelta, r.meta.len); check('dowhile ic', r.ic, 13); check('dowhile sp', r.sp, SP); }

r = run('dowhile', () => { setLocal(2, -1500000000); });
check('mul-ovf kind', r.kind, 2); check('mul-ovf ic', r.ic, 7); check('mul-ovf pc', r.pcDelta, 6 + 4 + 2); check('mul-ovf sp', r.sp, SP - 16);
check('mul-ovf slot0', slot(0)[0], -1500000000); check('mul-ovf slot1', slot(1)[0], 3); check('mul-ovf x', local(2)[0], -1500000000);

r = run('dowhile', () => { setLocal(2, 0); });  // 0*3 = 0, no -0 (x not negative); x becomes -1 -> -1*3 ok...
{ let x = 0, kind = 1; do { const m = x * 3; if (m > 2147483647 || m < -2147483648 || (m === 0 && x < 0)) { kind = 2; break; } x = ((m - 1) ^ (x >>> 1)) | 0; } while (x < 100000);
  check('dowhile0 kind', r.kind, kind); check('dowhile0 x', local(2)[0], x); }

r = run('stackexit', () => { setLocal(0, 3); });
check('stackexit kind', r.kind, 1); check('stackexit sp', r.sp, SP - 8); check('stackexit slot', slot(0)[0], -1); check('stackexit tag', slot(0)[1], INT);
check('stackexit x', local(0)[0], -1); check('stackexit ic', r.ic, 6); check('stackexit pc', r.pcDelta, r.meta.len);
check('below-sp untouched', dv.getUint32(SP, true), 0xEEEEEEEE);

// JIT 6: forward jumps, joins, logical ops, lexicals, arguments, more int ops.
r = run('ifelse', () => { setLocal(0, 0); setLocal(1, 0); });
{ let a = 0; for (let i = 0; i < 10000; i++) a = i % 3 === 0 ? (a + i) | 0 : (a - 1) | 0;
  check('ifelse kind', r.kind, 1); check('ifelse a', local(0)[0], a); check('ifelse i', local(1)[0], 10000);
  check('ifelse pc', r.pcDelta, r.meta.len); check('ifelse ic', r.ic, 2); check('ifelse sp', r.sp, SP);
  check('ifelse targets', r.meta.targets, 2); }
r = run('ifelse', () => { setLocal(0, 7); setLocal(1, -3); });
check('mod-neg kind', r.kind, 2); check('mod-neg pc', r.pcDelta, 6 + 4 + 3 + 1 + 5 + 5 + 4 + 2); check('mod-neg ic', r.ic, 2);
check('mod-neg sp', r.sp, SP - 16); check('mod-neg slot0', slot(0)[0], -3); check('mod-neg slot1', slot(1)[0], 3);
check('mod-neg a', local(0)[0], 7);
r = run('ifelse', () => { setLocal(0, 0); setLocal(1, 1); dv.setUint32(INTR, 1, true); });
check('ifelse interrupt kind', r.kind, 3); check('ifelse interrupt a', local(0)[0], -1); check('ifelse interrupt i', local(1)[0], 2);

r = run('andor', () => { setLocal(0, 0); setLocal(1, 0); });
{ let n = 0; for (let i = 0; i < 10000; i++) if (((i & 1) === 1 && i % 5 !== 0) || i === 7) n++;
  check('andor kind', r.kind, 1); check('andor n', local(0)[0], n); check('andor i', local(1)[0], 10000); check('andor ic', r.ic, 2);
  check('andor targets', r.meta.targets, 3); }
let rej = JSON.parse(fs.readFileSync(`${dir}/reject-jointype.json`));
check('reject join type', rej.ok === false && rej.reason === 'join type', true);

r = run('continue', () => { setLocal(0, 0); setLocal(1, 0); });
{ let s = 0, i = 0; while (i < 10000) { i++; if (i % 4 === 0) continue; s = (s + i) | 0; }
  check('continue kind', r.kind, 1); check('continue s', local(0)[0], s); check('continue i', local(1)[0], 10000); check('continue ic', r.ic, 2); }

r = run('letbody', () => { setLocal(0, 0); setLocal(1, 0); setLocal(2, 0, DOUBLE_HI); });
{ let s = 0; for (let i = 0; i < 10000; i++) s = (s ^ (i * 2)) | 0;
  check('letbody kind', r.kind, 1); check('letbody s', local(0)[0], s); check('letbody t', local(2)[0], 19998);
  check('letbody t tag', local(2)[1], INT); check('letbody t not live', r.meta.vars.find(v => v.local === 2).live, false); }
r = run('letbody', () => { setLocal(0, 0); setLocal(1, 5); setLocal(2, 0, DOUBLE_HI); dv.setUint32(INTR, 1, true); });
check('letbody interrupt kind', r.kind, 3); check('letbody interrupt t', local(2)[0], 10); check('letbody interrupt tag', local(2)[1], INT);
rej = JSON.parse(fs.readFileSync(`${dir}/reject-tdz.json`));
check('reject tdz', rej.ok === false && rej.reason === 'tdz', true);

r = run('args', () => { setLocal(0, 0); setArg(0, 5); setArg(1, 100); });
check('args kind', r.kind, 1); check('args a', arg(0)[0], 5055); check('args a tag', arg(0)[1], INT); check('args i', local(0)[0], 100);
check('args b', arg(1)[0], 100); check('args maxArg', r.meta.maxArg, 2); check('args ic', r.ic, 2);
r = run('args', () => { setLocal(0, -1); setArg(0, 5); setArg(1, 3); });
check('neg0 kind', r.kind, 2); check('neg0 pc', r.pcDelta, 6 + 4 + 3 + 1 + 5 + 5 + 3 + 4 + 1); check('neg0 ic', r.ic, 3);
check('neg0 sp', r.sp, SP - 16); check('neg0 slot0', slot(0)[0], 5); check('neg0 slot1', slot(1)[0], 0); check('neg0 a', arg(0)[0], 5);
r = run('args', () => { setLocal(0, 0); setArg(0, 5); setArg(1, 0, DOUBLE_HI); });
check('args noentry', r.kind, 0); check('args noentry b', arg(1)[1], DOUBLE_HI);
for (const [name, why] of [['reject-argsaliased', 'arguments'], ['reject-argindex', 'argument index'], ['reject-noargv', 'arguments']]) {
  rej = JSON.parse(fs.readFileSync(`${dir}/${name}.json`)); check(name, rej.ok === false && rej.reason === why, true); }

for (const b of [1, 0]) {
  r = run('coalesce', () => { setLocal(0, 0); setLocal(1, 0); setLocal(2, 0, UNDEF); setLocal(3, b, BOOL); setLocal(4, 9); });
  check(`coalesce${b} kind`, r.kind, 1); check(`coalesce${b} s`, local(0)[0], 10000 * (11 + b)); check(`coalesce${b} u`, local(2)[1], UNDEF);
  check(`coalesce${b} b`, local(3)[0], b); check(`coalesce${b} ic`, r.ic, 2);
}
r = run('coalesce', () => { setLocal(0, 0); setLocal(1, 0); setLocal(2, 0); setLocal(3, 1, BOOL); setLocal(4, 9); });
check('coalesce guard', r.kind, 0);
for (const [name, why] of [['reject-headtype', 'head type'], ['reject-nested', 'nested loop']]) {
  rej = JSON.parse(fs.readFileSync(`${dir}/${name}.json`)); check(name, rej.ok === false && rej.reason === why, true); }
console.log(JSON.stringify({ pass: failures === 0, checks, failures }));
process.exitCode = failures ? 1 : 0;
