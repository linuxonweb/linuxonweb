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
const setLocalF = (k, x) => dv.setFloat64(FRAME - 8 * (k + 1), x, true);
const localF = k => dv.getFloat64(FRAME - 8 * (k + 1), true);
const slotF = i => dv.getFloat64(SP - 8 * (i + 1), true);
const OBJECT = 0xFFFFFF8C;
const isDouble = tag => tag <= 0xFFFFFF80;

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
// JIT 7a: doubles.
r = run('divsum', () => { setLocal(0, 0); setLocal(1, 0); });
{ let s = 0; for (let i = 0; i < 10000; i++) s = s + i / 3;
  check('divsum kind', r.kind, 1); check('divsum s', localF(0), s); check('divsum tag', isDouble(local(0)[1]), true);
  check('divsum i', local(1)[0], 10000); check('divsum i tag', local(1)[1], INT); check('divsum attempts', r.meta.attempts, 2);
  check('divsum s headTy', r.meta.vars.find(v => v.local === 0).headTy, 7); check('divsum ic', r.ic, 2); }
r = run('divsum', () => { setLocalF(0, 0.25); setLocal(1, 9990); });
{ let s = 0.25; for (let i = 9990; i < 10000; i++) s = s + i / 3; check('divsum dbl-entry kind', r.kind, 1); check('divsum dbl-entry s', localF(0), s); }
r = run('divsum', () => { setLocal(0, 0, OBJECT); setLocal(1, 0); });
check('divsum object noentry', r.kind, 0); check('divsum object untouched', local(0)[1], OBJECT);

for (const [lim, n, tag] of [[9999.5, 10000], [NaN, 0], [-1e300, 0], [50, 50, INT]]) {
  r = run('mixcmp', () => { setLocal(0, 0); setLocal(1, 0); if (tag) setLocal(2, lim, tag); else setLocalF(2, lim); });
  check(`mixcmp ${lim} kind`, r.kind, 1); check(`mixcmp ${lim} n`, local(0)[0], n); check(`mixcmp ${lim} n tag`, local(0)[1], INT);
  check(`mixcmp ${lim} i`, local(1)[0], n);
}

r = run('bitdbl', () => { setLocal(0, 0); setLocal(1, 0); });
{ let s = 0; for (let i = 0; i < 10000; i++) s = (s + ((i * 1.5) | 0)) | 0;
  check('bitdbl kind', r.kind, 1); check('bitdbl s', local(0)[0], s); check('bitdbl s tag', local(0)[1], INT); check('bitdbl attempts', r.meta.attempts, 1); }

r = run('bitovf', () => { setLocal(0, 1); setLocal(1, 0); });
{ let x = 1, i = 0, m = 0; for (; i < 10000; i++) { m = x * 3.5; if (!(m > -2147483649 && m < 2147483648)) break; x = m | 0; }
  check('bitovf kind', r.kind, 2); check('bitovf pc', r.pcDelta, 24 + 4 + 9 + 1 + 1); check('bitovf sp', r.sp, SP - 16);
  check('bitovf slot0', slotF(0), m); check('bitovf slot1', slot(1)[0], 0); check('bitovf slot1 tag', slot(1)[1], INT);
  check('bitovf x', local(0)[0], x); check('bitovf i', local(1)[0], i); }

r = run('incneg', () => { setLocal(0, 0); setLocal(1, 0); setLocalF(2, 0.5); setLocalF(3, 2.5); });
check('incneg kind', r.kind, 1); check('incneg d', localF(2), 10000.5); check('incneg e', localF(3), 2.5);
check('incneg f', local(4)[0], ~10000.5); check('incneg f tag', local(4)[1], INT);
r = run('incneg', () => { setLocal(0, 0); setLocal(1, 0); setLocalF(2, 3e9); setLocalF(3, 2.5); });
check('bitnot-range kind', r.kind, 2); check('bitnot-range pc', r.pcDelta, 24 + 10 + 10 + 4); check('bitnot-range sp', r.sp, SP - 8);
check('bitnot-range slot0', slotF(0), 3e9 + 1); check('bitnot-range d', localF(2), 3e9 + 1); check('bitnot-range e', localF(3), -2.5);
r = run('incneg', () => { setLocal(0, 0); setLocal(1, 0); setLocal(2, 7); setLocalF(3, 2.5); });
check('incneg int-entry kind', r.kind, 1); check('incneg int-entry d', localF(2), 10007); check('incneg int-entry tag', isDouble(local(2)[1]), true);

for (const [d, n, tag] of [[0.5, 10000], [0, 0], [-0, 0], [NaN, 0], [-1e-300, 10000], [3, 10000, INT], [0, 0, INT]]) {
  r = run('truthy', () => { setLocal(0, 0); setLocal(1, 0); if (tag) setLocal(2, d, tag); else setLocalF(2, d); });
  check(`truthy ${d}${tag ? 'i' : ''} kind`, r.kind, 1); check(`truthy ${d}${tag ? 'i' : ''} n`, local(0)[0], n);
}

r = run('nanbox', () => { setLocal(0, 0); setLocal(1, 0); setLocalF(2, Infinity); });
check('nanbox kind', r.kind, 1); check('nanbox hi', local(3)[1], 0x7FF80000); check('nanbox lo', local(3)[0], 0);
check('nanbox d', localF(2), Infinity);
r = run('nanbox', () => { setLocal(0, 0); setLocal(1, 0); setLocalF(2, 1.25); });
check('nanbox zero', localF(3), 0); check('nanbox zero hi', local(3)[1], 0);

r = run('slotjoin', () => { setLocal(0, 0); setLocal(1, 0); });
{ let s = 0; for (let i = 0; i < 10000; i++) s = s + ((i & 1) ? 1 : 0.5);
  check('slotjoin kind', r.kind, 1); check('slotjoin s', localF(0), s); check('slotjoin attempts', r.meta.attempts, 3); }
r = run('slotjoin', () => { setLocal(0, 0); setLocal(1, 0); dv.setUint32(INTR, 1, true); });
check('slotjoin interrupt kind', r.kind, 3); check('slotjoin interrupt s', localF(0), 0.5); check('slotjoin interrupt i', local(1)[0], 1);
// JIT 7b: dense arrays. Object at ARR -> shape -> base -> clasp; elements
// at ELEMS with the ObjectElements header (flags, initLen, capacity, length) below.
const ARR = 0x31000, ELEMS = 0x32010, CLASP = 0x5000, MAGIC = 0xFFFFFF85, FROZEN = 0x40;
const hole = { hole: true };
function setArray(elems, { initLen = elems.length, length = elems.length, flags = 0, clasp = CLASP } = {}) {
  dv.setUint32(ARR, ARR + 0x100, true); dv.setUint32(ARR + 0x100, ARR + 0x200, true); dv.setUint32(ARR + 0x200, clasp, true);
  dv.setUint32(ARR + 8, ELEMS, true);
  dv.setUint32(ELEMS - 16, flags, true); dv.setUint32(ELEMS - 12, initLen, true);
  dv.setUint32(ELEMS - 8, elems.length, true); dv.setUint32(ELEMS - 4, length >>> 0, true);
  elems.forEach((e, i) => {
    const at = ELEMS + 8 * i;
    if (e === hole) { dv.setUint32(at, 0, true); dv.setUint32(at + 4, MAGIC, true); }
    else if (Array.isArray(e)) { dv.setUint32(at, e[0], true); dv.setUint32(at + 4, e[1], true); }
    else if (Number.isInteger(e) && !Object.is(e, -0) && e === (e | 0)) { dv.setInt32(at, e, true); dv.setUint32(at + 4, INT, true); }
    else dv.setFloat64(at, e, true);
  });
  setLocal(3, ARR, OBJECT);
}
const elem = i => [dv.getInt32(ELEMS + 8 * i, true), dv.getUint32(ELEMS + 8 * i + 4, true)];
const elemF = i => dv.getFloat64(ELEMS + 8 * i, true);
const ints = n => Array.from({ length: n }, (_, i) => (i * 7) % 13 - 4);
const isum = (a, n = a.length) => a.slice(0, n).reduce((s, x) => (s + x) | 0, 0);

let a = ints(100);
r = run('arrsum', () => { setLocal(0, 0); setLocal(1, 0); setArray(a); });
check('arrsum kind', r.kind, 1); check('arrsum s', local(0)[0], isum(a)); check('arrsum i', local(1)[0], 100);
check('arrsum ic', r.ic, 3); check('arrsum sp', r.sp, SP); check('arrsum a kept', local(3)[0], ARR); check('arrsum a tag', local(3)[1], OBJECT);
check('arrsum headTy', r.meta.vars.find(v => v.local === 3).headTy, 16 + r.meta.vars.findIndex(v => v.local === 3));
for (const [what, setup, at] of [
  ['hole', () => setArray([...a.slice(0, 5), hole, ...a.slice(6)]), 5],
  ['initlen', () => setArray(a, { initLen: 50 }), 50],
  ['double', () => setArray([...a.slice(0, 7), 2.5, ...a.slice(8)]), 7],
  ['bool', () => setArray([...a.slice(0, 9), [1, BOOL], ...a.slice(10)]), 9]]) {
  r = run('arrsum', () => { setLocal(0, 0); setLocal(1, 0); setup(); });
  check(`arrsum ${what} kind`, r.kind, 2); check(`arrsum ${what} pc`, r.pcDelta, r.meta.mark[1]); check(`arrsum ${what} ic`, r.ic, 3);
  check(`arrsum ${what} sp`, r.sp, SP - 24); check(`arrsum ${what} s`, local(0)[0], isum(a, at)); check(`arrsum ${what} i`, local(1)[0], at);
  check(`arrsum ${what} slot0`, slot(0)[0], isum(a, at)); check(`arrsum ${what} slot1`, slot(1)[0], ARR);
  check(`arrsum ${what} slot1 tag`, slot(1)[1], OBJECT); check(`arrsum ${what} slot2`, slot(2)[0], at); check(`arrsum ${what} slot2 tag`, slot(2)[1], INT);
}
r = run('arrsum', () => { setLocal(0, 0); setLocal(1, 0); setArray(a, { initLen: 0, length: 0x80000000 }); });
check('arrsum biglen kind', r.kind, 2); check('arrsum biglen pc', r.pcDelta, r.meta.mark[0]); check('arrsum biglen ic', r.ic, 0);
check('arrsum biglen sp', r.sp, SP - 16); check('arrsum biglen slot0', slot(0)[0], 0); check('arrsum biglen slot1', slot(1)[0], ARR);
r = run('arrsum', () => { setLocal(0, 0); setLocal(1, 0); setArray(a, { clasp: 0x5008 }); });
check('arrsum clasp noentry', r.kind, 0); check('arrsum clasp untouched', local(0)[0], 0);
r = run('arrsum', () => { setLocal(0, 0); setLocal(1, 0); setArray(a); setLocal(3, 4); });
check('arrsum int noentry', r.kind, 0);
r = run('arrsum', () => { setLocal(0, 0); setLocal(1, 0); setArray(a, { initLen: 60 }); setLocal(1, 60); });
check('arrsum short exit kind', r.kind, 2); check('arrsum short exit i', local(1)[0], 60);
r = run('arrsum', () => { setLocal(0, 0); setLocal(1, 0); setArray(a); dv.setUint32(INTR, 1, true); });
check('arrsum interrupt kind', r.kind, 3); check('arrsum interrupt s', local(0)[0], a[0]); check('arrsum interrupt a', local(3)[1], OBJECT);

r = run('arrfill', () => { setLocal(1, 0); setArray([...a.slice(0, 10), 0.5, ...a.slice(11)]); });
check('arrfill kind', r.kind, 1); check('arrfill i', local(1)[0], 100);
check('arrfill elems', Array.from({ length: 100 }, (_, i) => elem(i)[0] === i && elem(i)[1] === INT).every(Boolean), true);
check('arrfill past end', dv.getUint32(ELEMS + 800, true), 0xEEEEEEEE);
for (const [what, setup, at] of [
  ['frozen', () => setArray(a, { flags: FROZEN }), 0],
  ['oldbool', () => setArray([...a.slice(0, 3), [0, BOOL], ...a.slice(4)]), 3],
  ['oldhole', () => setArray([...a.slice(0, 4), hole, ...a.slice(5)]), 4],
  ['initlen', () => setArray(a, { initLen: 20 }), 20]]) {
  r = run('arrfill', () => { setLocal(1, 0); setup(); });
  check(`arrfill ${what} kind`, r.kind, 2); check(`arrfill ${what} pc`, r.pcDelta, r.meta.mark[1]); check(`arrfill ${what} ic`, r.ic, 3);
  check(`arrfill ${what} sp`, r.sp, SP - 24); check(`arrfill ${what} slot1`, slot(1)[0], at); check(`arrfill ${what} slot2`, slot(2)[0], at);
  check(`arrfill ${what} prefix written`, Array.from({ length: at }, (_, i) => elem(i)[0] === i).every(Boolean), true);
  check(`arrfill ${what} elem untouched`, elem(at)[1], what === 'oldbool' ? BOOL : what === 'oldhole' ? MAGIC : INT);
}

r = run('arrinc', () => { setLocal(1, 0); setArray(a); });
check('arrinc kind', r.kind, 1);
check('arrinc elems', Array.from({ length: 100 }, (_, i) => elem(i)[0] === a[i] + i && elem(i)[1] === INT).every(Boolean), true);
r = run('arrinc', () => { setLocal(1, 0); setArray([...a.slice(0, 50), 0x7ffffff0, ...a.slice(51)]); });
check('arrinc ovf kind', r.kind, 2); check('arrinc ovf i', local(1)[0], 50); check('arrinc ovf elem', elem(50)[0], 0x7ffffff0);
check('arrinc ovf sp', r.sp, SP - 32);

const d = Array.from({ length: 100 }, (_, i) => (i % 3 ? i * 0.25 : i));
r = run('arrdbl', () => { setLocalF(0, 0.5); setLocal(1, 0); setArray(d); });
check('arrdbl kind', r.kind, 1); check('arrdbl s', localF(0), d.reduce((s, x) => s + x, 0.5)); check('arrdbl i', local(1)[0], 100);
for (const [what, e] of [['hole', hole], ['undef', [0, UNDEF]], ['object', [ARR, OBJECT]]]) {
  r = run('arrdbl', () => { setLocalF(0, 0.5); setLocal(1, 0); setArray([...d.slice(0, 33), e, ...d.slice(34)]); });
  check(`arrdbl ${what} kind`, r.kind, 2); check(`arrdbl ${what} i`, local(1)[0], 33); check(`arrdbl ${what} pc`, r.pcDelta, r.meta.mark[1]);
  check(`arrdbl ${what} s`, localF(0), d.slice(0, 33).reduce((s, x) => s + x, 0.5)); check(`arrdbl ${what} slot0`, slotF(0), localF(0));
}
r = run('arrdbl', () => { setLocalF(0, 0.5); setLocal(1, 0); setArray([NaN, -0, Infinity]); });
check('arrdbl nan', Number.isNaN(localF(0)), true);

r = run('arrwiden', () => { setLocal(1, 0); setArray(a); });
check('arrwiden kind', r.kind, 1); check('arrwiden attempts', r.meta.attempts, 2);
check('arrwiden elems', Array.from({ length: 100 }, (_, i) => Object.is(elemF(i), a[i] / 3) || (a[i] / 3 === (a[i] / 3 | 0) && elem(i)[1] !== INT && elemF(i) === a[i] / 3)).every(Boolean), true);
r = run('arrwiden', () => { setLocal(1, 0); setArray([0, 0, 0, 0]); });
check('arrwiden zero', [0, 1, 2, 3].every(i => Object.is(elemF(i), 0)), true);
r = run('arrwiden', () => { setLocal(1, 0); setArray(a, { flags: FROZEN }); });
check('arrwiden frozen kind', r.kind, 2); check('arrwiden frozen pc', r.pcDelta, r.meta.mark[1]); check('arrwiden frozen ic', r.ic, 5);
check('arrwiden frozen sp', r.sp, SP - 24); check('arrwiden frozen slot2', slotF(2), a[0] / 3); check('arrwiden frozen elem', elem(0)[0], a[0]);

for (const [name, why] of [['reject-notarray', 'head type'], ['reject-elemtype', 'element type'],
  ['reject-arrwritten', 'array var written'], ['reject-getprop', 'GetProp']]) {
  rej = JSON.parse(fs.readFileSync(`${dir}/${name}.json`)); check(name, rej.ok === false && rej.reason === why, true); }
console.log(JSON.stringify({ pass: failures === 0, checks, failures }));
process.exitCode = failures ? 1 : 0;
