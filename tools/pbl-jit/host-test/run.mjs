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
for (const [name, why] of [['reject-headtype', 'head type'], ['reject-nested', 'loop without backedge']]) {
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
check('arrinc i', local(1)[0], 100); check('arrinc pc', r.pcDelta, r.meta.len);
check('arrinc ic', r.ic, 3); check('arrinc sp', r.sp, SP);
check('arrinc elems', Array.from({ length: 100 }, (_, i) => elem(i)[0] === a[i] + i && elem(i)[1] === INT).every(Boolean), true);
r = run('arrinc', () => { setLocal(1, 0); setArray([...a.slice(0, 50), 0x7ffffff0, ...a.slice(51)]); });
check('arrinc ovf kind', r.kind, 2); check('arrinc ovf i', local(1)[0], 50); check('arrinc ovf elem', elem(50)[0], 0x7ffffff0);
check('arrinc ovf sp', r.sp, SP - 32);
check('arrinc ovf pc', r.pcDelta, r.meta.mark[1] + 5); check('arrinc ovf ic', r.ic, 5);
check('arrinc ovf slot0', slot(0)[0], ARR); check('arrinc ovf slot0 tag', slot(0)[1], OBJECT);
check('arrinc ovf slot1', slot(1)[0], 50); check('arrinc ovf slot1 tag', slot(1)[1], INT);
check('arrinc ovf slot2', slot(2)[0], 0x7ffffff0); check('arrinc ovf slot3', slot(3)[0], 50);
for (const [what, setup, at] of [
  ['hole', () => setArray([...a.slice(0, 5), hole, ...a.slice(6)]), 5],
  ['bounds', () => setArray(a, { initLen: 50 }), 50],
  ['negative', () => { setArray(a); setLocal(1, -1); }, -1]]) {
  r = run('arrinc', () => { setLocal(1, 0); setup(); });
  check(`arrinc ${what} kind`, r.kind, 2); check(`arrinc ${what} pc`, r.pcDelta, r.meta.mark[1]);
  check(`arrinc ${what} ic`, r.ic, 4); check(`arrinc ${what} i`, local(1)[0], at);
  check(`arrinc ${what} sp`, r.sp, SP - 32);
  check(`arrinc ${what} slot0`, slot(0)[0], ARR); check(`arrinc ${what} slot0 tag`, slot(0)[1], OBJECT);
  check(`arrinc ${what} slot1`, slot(1)[0], at); check(`arrinc ${what} slot1 tag`, slot(1)[1], INT);
  check(`arrinc ${what} slot2`, slot(2)[0], ARR); check(`arrinc ${what} slot2 tag`, slot(2)[1], OBJECT);
  check(`arrinc ${what} slot3`, slot(3)[0], at); check(`arrinc ${what} slot3 tag`, slot(3)[1], INT);
  check(`arrinc ${what} prefix`, Array.from({ length: Math.max(at, 0) }, (_, i) => elem(i)[0] === a[i] + i).every(Boolean), true);
}
r = run('arrinc', () => { setLocal(1, 1); setArray(a, { flags: FROZEN }); });
check('arrinc frozen kind', r.kind, 2); check('arrinc frozen pc', r.pcDelta, r.meta.mark[1] + 7);
check('arrinc frozen ic', r.ic, 6); check('arrinc frozen sp', r.sp, SP - 24);
check('arrinc frozen value', slot(2)[0], a[1] + 1); check('arrinc frozen elem untouched', elem(1)[0], a[1]);
r = run('arrinc', () => { setLocalF(1, 0.5); setArray(a); });
check('arrinc double key noentry', r.kind, 0); check('arrinc double key untouched', localF(1), 0.5);
for (const value of ['True', 'Undefined', 'Null', 'Double', 'underflow']) {
  rej = JSON.parse(fs.readFileSync(`${dir}/reject-propertykey-${value}.json`));
  check(`reject-propertykey-${value}`, rej.ok === false && rej.reason === (value === 'underflow' ? 'underflow' : 'operand type'), true);
}

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
// JIT8: fixed/dynamic numeric slots and builtin identities.
const OBJ = 0x9000, DYNAMIC = 0x9100, GLOBAL = 0xa000, LEXICAL = 0xa100, MATH = 0xa200, FN = 0xa300;
function boxed(addr, x, tag = INT) {
  dv.setUint32(addr, x >>> 0, true); dv.setUint32(addr + 4, tag, true);
}
function setupObject(value = 2, dynamic = 4) {
  setLocal(0, 0); setLocal(1, 0); setLocal(2, OBJ, OBJECT);
  dv.setUint32(OBJ, 0x7000, true); dv.setUint32(OBJ + 4, DYNAMIC, true);
  boxed(OBJ + 16, value); boxed(DYNAMIC, dynamic);
}
for (const [name, value, addr] of [['propfixed', 2, OBJ + 16], ['propdynamic', 4, DYNAMIC]]) {
  r = run(name, setupObject);
  check(`${name} kind`, r.kind, 1); check(`${name} sum`, localF(0), value * 10000);
  check(`${name} i`, local(1)[0], 10000); check(`${name} ic`, r.ic, 2); check(`${name} pc`, r.pcDelta, r.meta.len);
  r = run(name, () => { setupObject(); dv.setFloat64(addr, 0.25, true); });
  check(`${name} dblkind`, r.kind, 1); check(`${name} dblsum`, localF(0), 2500);
  for (const tag of [OBJECT, BOOL, UNDEF, 0xFFFFFF85]) {
    r = run(name, () => { setupObject(); boxed(addr, 0x1234, tag); });
    check(`${name} nonnum ${tag} kind`, r.kind, 2); check(`${name} nonnum pc`, r.pcDelta, r.meta.mark[0]);
    check(`${name} nonnum ic`, r.ic, 2); check(`${name} nonnum sp`, r.sp, SP - 16);
    check(`${name} nonnum objecttag`, slot(1)[1], OBJECT); check(`${name} nonnum pointer`, slot(1)[0], OBJ);
    check(`${name} nonnum i`, local(1)[0], 0); check(`${name} nonnum valueuntouched`, dv.getUint32(addr + 4, true), tag);
  }
  r = run(name, () => { setupObject(); dv.setUint32(OBJ, 0x7080, true); });
  check(`${name} shapemismatch`, r.kind, 0); check(`${name} shapeunmodified`, local(0)[0], 0);
  r = run(name, () => { setupObject(); setLocal(2, OBJ, BOOL); });
  check(`${name} objtag`, r.kind, 0);
}
for (const [name, addr, start] of [['propinc', OBJ + 16, 2], ['propincdynamic', DYNAMIC, 4]]) {
  r = run(name, setupObject);
  check(`${name} kind`, r.kind, 1); check(`${name} result`, dv.getFloat64(addr, true), start + 49995000);
  check(`${name} i`, local(1)[0], 10000);
  r = run(name, () => { setupObject(); dv.setUint32(INTR, 1, true); });
  check(`${name} interruptkind`, r.kind, 3); check(`${name} interruptpc`, r.pcDelta, 0);
  check(`${name} interrupti`, local(1)[0], 1); check(`${name} interruptvalue`, dv.getFloat64(addr, true), start);
}
r = run('propstore', setupObject);
check('propstore kind', r.kind, 1); check('propstore value', dv.getInt32(OBJ + 16, true), 9999);
check('propstore value tag', dv.getUint32(OBJ + 20, true), INT);
for (const tag of [OBJECT, BOOL, UNDEF, 0xFFFFFF85]) {
  r = run('propstore', () => { setupObject(); boxed(OBJ + 16, 0x5555, tag); });
  check(`propstore barrier ${tag}`, r.kind, 2); check('propstore barrier pc', r.pcDelta, r.meta.mark[0]);
  check('propstore barrier sp', r.sp, SP - 16); check('propstore barrier ic', r.ic, 2);
  check('propstore barrier object', slot(0)[0], OBJ); check('propstore barrier objecttag', slot(0)[1], OBJECT);
  check('propstore barrier val', slot(1)[0], 0); check('propstore barrier valtag', slot(1)[1], INT);
  check('propstore barrier untouched', dv.getUint32(OBJ + 20, true), tag);
}
for (const [what, why] of [['readonly', 'writable own property'], ['unsafe', 'writable own property'],
  ['missing', 'writable own property'], ['accessor', 'writable own property'], ['written', 'object var written']]) {
  rej = JSON.parse(fs.readFileSync(`${dir}/reject-prop-${what}.json`));
  check(`reject-prop-${what}`, rej.ok === false && rej.reason === why, true);
}
function setupGlobals() {
  dv.setUint32(GLOBAL, 0x7200, true); dv.setUint32(LEXICAL, 0x7300, true); dv.setUint32(MATH, 0x7400, true);
  boxed(GLOBAL + 16, MATH, OBJECT); boxed(GLOBAL + 24, 7);
  for (let i = 0; i < 8; i++) {
    boxed(MATH + 16 + 8 * i, FN + i * 0x40, OBJECT);
    dv.setUint32(FN + i * 0x40, 0x7500 + i * 0x20, true);
  }
}
r = run('globalnumber', () => { setLocal(0, 0); setLocal(1, 0); setupGlobals(); });
check('globalnumber kind', r.kind, 1); check('globalnumber sum', local(0)[0], 70000);
for (const mutate of [() => boxed(GLOBAL + 24, 8), () => dv.setUint32(GLOBAL, 0x7204, true), () => dv.setUint32(LEXICAL, 0x7304, true)]) {
  r = run('globalnumber', () => { setLocal(0, 11); setLocal(1, 3); setupGlobals(); mutate(); });
  check('globalnumber guard', r.kind, 0); check('globalnumber untouched', local(0)[0], 11); check('globalnumber iuntouched', local(1)[0], 3);
}
const nativeMath = [Math.max, Math.min, Math.abs, Math.floor, Math.ceil, Math.round, Math.sqrt, Math.trunc];
const mathValues = [0, -0, 0.25, -0.25, 0.5, -0.5, 1.5, -1.5, 0.49999999999999994, -0.5000000000000001,
  2 ** 52 - 0.5, -(2 ** 52 - 0.5), 2 ** 52, -(2 ** 52), 2 ** 53, -(2 ** 53), Number.MIN_VALUE,
  -Number.MIN_VALUE, Infinity, -Infinity, NaN, 2147483648, -2147483649];
for (let i = 0; i < 8; i++) {
  for (const x of mathValues) {
    const ys = i < 2 ? [0, -0, Infinity, -Infinity, NaN, 7] : [0];
    for (const y of ys) {
      r = run(`math${i}`, () => { setupGlobals(); setLocal(0, 11); setLocal(1, 9999); setLocalF(2, x); setLocalF(3, y); });
      check(`math${i} ${x}/${y} kind`, r.kind, 1);
      const want = i < 2 ? nativeMath[i](x, y) : nativeMath[i](x);
      check(`math${i} ${x}/${y} result`, Object.is(localF(0), want), true);
      check(`math${i} ${x}/${y} i`, local(1)[0], 10000);
    }
  }
  for (const mutate of [() => boxed(GLOBAL + 16, MATH + 1, OBJECT), () => boxed(MATH + 16 + 8 * i, FN + 1, OBJECT),
    () => dv.setUint32(MATH, 0x7401, true), () => dv.setUint32(LEXICAL, 0x7301, true),
    () => dv.setUint32(FN + i * 0x40, 0x7511, true)]) {
    r = run(`math${i}`, () => { setupGlobals(); setLocal(0, 123); setLocal(1, 9999); setLocalF(2, 0.5); setLocalF(3, 5); mutate(); });
    check(`math${i} identityguard`, r.kind, 0); check(`math${i} untouched`, local(0)[0], 123); check(`math${i} iuntouched`, local(1)[0], 9999);
  }
  r = run(`math${i}`, () => { setupGlobals(); setLocal(0, 0); setLocal(1, 9999); setLocal(2, 3); setLocal(3, 5); });
  check(`math${i} intargkind`, r.kind, 1); check(`math${i} intargresult`, localF(0), i < 2 ? nativeMath[i](3, 5) : nativeMath[i](3));
}
for (let i = 0; i < 3; i++) {
  r = run(`mathzero${i}`, () => { setupGlobals(); setLocal(0, 0); setLocal(1, 9999); });
  check(`mathzero${i} kind`, r.kind, 1); check(`mathzero${i} result`, Object.is(localF(0), nativeMath[i]()), true);
}

r = run('constantalias', () => { setupObject(); setupGlobals(); boxed(GLOBAL + 32, OBJ, OBJECT); });
check('constant holder alias rejects', r.kind, 0);
check('constant holder alias before writes', dv.getInt32(OBJ + 16, true), 2);
check('constant holder alias iuntouched', local(1)[0], 0);
r = run('constantalias', () => {
  setupObject(); setupGlobals(); boxed(GLOBAL + 32, OBJ, OBJECT);
  const clone = 0x9500; dv.setUint32(clone, 0x7000, true); boxed(clone + 16, 2);
  setLocal(2, clone, OBJECT);
});
check('different object same shape allowed', r.kind, 1);
check('different object store completed', dv.getInt32(0x9510, true), 1);
check('constant holder unmodified', dv.getInt32(OBJ + 16, true), 2);
r = run('nurseryhead', () => {
  setupObject(); const nursery = 0x9400; dv.setUint32(nursery, 0x7000, true); boxed(nursery + 16, 3);
  setLocal(2, nursery, OBJECT);
});
check('nursery head kind', r.kind, 1); check('nursery head sum', localF(0), 30000);
rej = JSON.parse(fs.readFileSync(`${dir}/reject-nurseryconstant.json`));
check('nursery embedded constant rejects', rej.ok === false && rej.reason === 'constant object', true);
// Fixed-length typed arrays: object TA -> shape -> base -> clasp, length
// payload at TA+16, data pointer payload at TA+24.
{
  const TA = 0x34000, TDATA = 0x35000, I32C = 0x5100, F64C = 0x5200;
  const setTyped = (clasp, vals, { length = vals.length } = {}) => {
    dv.setUint32(TA, TA + 0x100, true); dv.setUint32(TA + 0x100, TA + 0x200, true); dv.setUint32(TA + 0x200, clasp, true);
    dv.setUint32(TA + 16, length, true); dv.setUint32(TA + 20, 0, true);
    dv.setUint32(TA + 24, TDATA, true); dv.setUint32(TA + 28, 0, true);
    vals.forEach((x, i) => clasp === I32C ? dv.setInt32(TDATA + 4 * i, x, true) : dv.setFloat64(TDATA + 8 * i, x, true));
    dv.setFloat64(TDATA + 8 * vals.length, 777.25, true);  // past the end (also covers Int32 words)
    setLocal(3, TA, OBJECT);
  };
  const i32 = i => dv.getInt32(TDATA + 4 * i, true), f64 = i => dv.getFloat64(TDATA + 8 * i, true);
  const ti = ints(100), tf = ints(100).map(x => x + 0.25);
  r = run('tasum-i32', () => { setLocal(0, 0); setLocal(1, 0); setTyped(I32C, ti); });
  check('tasum-i32 kind', r.kind, 1); check('tasum-i32 s', local(0)[0], isum(ti)); check('tasum-i32 i', local(1)[0], 100);
  check('tasum-i32 sp', r.sp, SP); check('tasum-i32 a kept', local(3)[0], TA);
  // Loops bound by `i < 100`; a shorter length slot bails at the GetElem bounds check.
  r = run('tasum-i32', () => { setLocal(0, 0); setLocal(1, 0); setTyped(I32C, ti, { length: 40 }); });
  check('tasum-i32 short kind', r.kind, 2); check('tasum-i32 short s', local(0)[0], isum(ti, 40)); check('tasum-i32 short i', local(1)[0], 40);
  check('tasum-i32 short pc', r.pcDelta, r.meta.mark[1]); check('tasum-i32 short slot0', slot(0)[0], isum(ti, 40));
  check('tasum-i32 short slot1', slot(1)[0], TA); check('tasum-i32 short slot1 tag', slot(1)[1], OBJECT); check('tasum-i32 short slot2', slot(2)[0], 40);
  r = run('tasum-i32', () => { setLocal(0, 0); setLocal(1, 0); setTyped(I32C, ti, { length: 0 }); });
  check('tasum-i32 detached kind', r.kind, 2); check('tasum-i32 detached i', local(1)[0], 0); check('tasum-i32 detached s', local(0)[0], 0);
  check('tasum-i32 detached pc', r.pcDelta, r.meta.mark[1]); check('tasum-i32 detached slot1', slot(1)[0], TA); check('tasum-i32 detached slot2', slot(2)[0], 0);
  r = run('tasum-i32', () => { setLocal(0, 0); setLocal(1, 0); setTyped(F64C, tf); });
  check('tasum-i32 wrong clasp noentry', r.kind, 0); check('tasum-i32 wrong clasp untouched', local(0)[0], 0);
  r = run('tasum-i32', () => { setLocal(0, 0); setLocal(1, 0); setArray(a); });
  check('tasum-i32 Array noentry', r.kind, 0);
  r = run('tasum-i32', () => { setLocal(0, 0); setLocal(1, 0); setTyped(I32C, ti); dv.setUint32(INTR, 1, true); });
  check('tasum-i32 interrupt kind', r.kind, 3); check('tasum-i32 interrupt s', local(0)[0], ti[0]);
  // f64 elements make the sum a Double: s = (s + a[i]) | 0 truncates each step.
  r = run('tasum-f64', () => { setLocal(0, 0); setLocal(1, 0); setTyped(F64C, tf); });
  { let s = 0; for (const x of tf) s = (s + x) | 0;
    check('tasum-f64 kind', r.kind, 1); check('tasum-f64 s', local(0)[0], s); check('tasum-f64 i', local(1)[0], 100); }
  r = run('tasum-f64', () => { setLocal(0, 0); setLocal(1, 0); setTyped(F64C, [...tf.slice(0, 9), 3e10, ...tf.slice(10)]); });
  { let s = 0; for (const x of tf.slice(0, 9)) s = (s + x) | 0;
    check('tasum-f64 toint32 bail kind', r.kind, 2); check('tasum-f64 toint32 bail i', local(1)[0], 9); check('tasum-f64 toint32 bail s', local(0)[0], s); }
  r = run('tainc-f64', () => { setLocal(1, 0); setTyped(F64C, tf); });
  check('tainc-f64 kind', r.kind, 1); check('tainc-f64 i', local(1)[0], 100);
  check('tainc-f64 elems', Array.from({ length: 100 }, (_, i) => f64(i) === tf[i] + i).every(Boolean), true);
  check('tainc-f64 past end', f64(100), 777.25);
  r = run('tainc-f64', () => { setLocal(1, 0); setTyped(F64C, [NaN, ...tf.slice(1)]); });
  check('tainc-f64 nan kind', r.kind, 1); check('tainc-f64 nan elem', Number.isNaN(f64(0)), true);
  r = run('tainc-f64', () => { setLocal(1, 0); setTyped(F64C, tf, { length: 30 }); });
  check('tainc-f64 short kind', r.kind, 2); check('tainc-f64 short i', local(1)[0], 30); check('tainc-f64 short untouched', f64(30), tf[30]);
  check('tainc-f64 short pc', r.pcDelta, r.meta.mark[1]); check('tainc-f64 short done', f64(29), tf[29] + 29);
  r = run('tainc-i32', () => { setLocal(1, 0); setTyped(I32C, ti); });
  check('tainc-i32 kind', r.kind, 1);
  check('tainc-i32 elems', Array.from({ length: 100 }, (_, i) => i32(i) === ti[i] + i).every(Boolean), true);
  r = run('tainc-i32', () => { setLocal(1, 0); setTyped(I32C, [...ti.slice(0, 50), 0x7ffffff0, ...ti.slice(51)]); });
  check('tainc-i32 ovf kind', r.kind, 2); check('tainc-i32 ovf i', local(1)[0], 50); check('tainc-i32 ovf elem', i32(50), 0x7ffffff0);
  check('tainc-i32 ovf pc', r.pcDelta, r.meta.mark[1] + 5); check('tainc-i32 ovf slot0', slot(0)[0], TA); check('tainc-i32 ovf slot0 tag', slot(0)[1], OBJECT);
  r = run('tainc-i32', () => { setTyped(I32C, ti); setLocal(1, -1); });
  check('tainc-i32 negative kind', r.kind, 2); check('tainc-i32 negative pc', r.pcDelta, r.meta.mark[1]); check('tainc-i32 negative i', local(1)[0], -1);
  rej = JSON.parse(fs.readFileSync(`${dir}/reject-typedstore.json`));
  check('typed double store into Int32Array rejects', rej.ok === false && rej.reason === 'typed element type', true);
  for (const name of ['reject-typedlength-i32', 'reject-typedlength-f64']) {
    rej = JSON.parse(fs.readFileSync(`${dir}/${name}.json`));
    check(`${name} (redefinable typed .length) rejects`, rej.ok === false && rej.reason === 'typed length', true);
  }
}
// Int32 Mul -0 elision only where -0 is unobservable.
{
  let e = 0; for (let i = 0; i < 10000; i++) e = e + i * -3;
  r = run('mulneg-add', () => { setLocal(0, 0); setLocal(1, 0); setLocal(2, -3); });
  check('mulneg-add kind', r.kind, 1); check('mulneg-add s', local(0)[0], e); check('mulneg-add i', local(1)[0], 10000);
  r = run('mulneg-or', () => { setLocal(0, 0); setLocal(1, 0); setLocal(2, -3); });
  check('mulneg-or kind', r.kind, 1); check('mulneg-or s', local(0)[0], -3 * 9999);
  r = run('mulneg-set', () => { setLocal(0, 0); setLocal(1, 0); setLocal(2, -3); });
  check('mulneg-set -0 bails', r.kind, 2); check('mulneg-set pc', r.pcDelta, r.meta.mark[1]); check('mulneg-set i', local(1)[0], 0);
  r = run('mulneg-set', () => { setLocal(0, 0); setLocal(1, 0); setLocal(2, 3); });
  check('mulneg-set positive kind', r.kind, 1); check('mulneg-set positive s', local(0)[0], 3 * 9999);
  r = run('mulneg-dbl', () => { setLocalF(0, -0); setLocal(1, 0); setLocal(2, -3); });
  check('mulneg-dbl -0 bails', r.kind, 2); check('mulneg-dbl pc', r.pcDelta, r.meta.mark[1]); check('mulneg-dbl s', Object.is(localF(0), -0), true);
}
// Truncated Int32 Add/Sub wrap instead of bailing.
{
  const m = 0x30000001;
  let ea = 0, es = 0; for (let i = 0; i < 10000; i++) { ea = (ea + m) | 0; es = (es - m) | 0; }
  r = run('wrap-add', () => { setLocal(0, 0); setLocal(1, 0); setLocal(2, m); });
  check('wrap-add kind', r.kind, 1); check('wrap-add s', local(0)[0], ea); check('wrap-add i', local(1)[0], 10000);
  r = run('wrap-sub', () => { setLocal(0, 0); setLocal(1, 0); setLocal(2, m); });
  check('wrap-sub kind', r.kind, 1); check('wrap-sub s', local(0)[0], es);
  r = run('wrap-sub', () => { setLocal(0, -0x80000000); setLocal(1, 0); setLocal(2, -0x80000000); });
  { let e = -0x80000000; for (let i = 0; i < 10000; i++) e = (e - -0x80000000) | 0;
    check('wrap-sub min kind', r.kind, 1); check('wrap-sub min s', local(0)[0], e); }
  r = run('wrap-none', () => { setLocal(0, 0); setLocal(1, 0); setLocal(2, m); });
  check('wrap-none overflow bails', r.kind, 2); check('wrap-none pc', r.pcDelta, r.meta.mark[1]); check('wrap-none i', local(1)[0], 2);
  check('wrap-none s', local(0)[0], 2 * m);
}
// Arrays of Arrays: rows at ROWS + 0x100 * r (shape chain at +0/+0x40/+0x48,
// elements at +0x80 with the ObjectElements header below).
{
  const ROWS = 0x36000;
  const setRow = (r, vals, { clasp = CLASP, initLen = vals.length } = {}) => {
    const o = ROWS + 0x100 * r;
    dv.setUint32(o, o + 0x40, true); dv.setUint32(o + 0x40, o + 0x48, true); dv.setUint32(o + 0x48, clasp, true);
    dv.setUint32(o + 8, o + 0x80, true);
    dv.setUint32(o + 0x70, 0, true); dv.setUint32(o + 0x74, initLen, true);
    dv.setUint32(o + 0x78, vals.length, true); dv.setUint32(o + 0x7c, vals.length, true);
    vals.forEach((x, i) => {
      if (Array.isArray(x)) { dv.setUint32(o + 0x80 + 8 * i, x[0], true); dv.setUint32(o + 0x84 + 8 * i, x[1], true); }
      else if (Number.isInteger(x)) { dv.setInt32(o + 0x80 + 8 * i, x, true); dv.setUint32(o + 0x84 + 8 * i, INT, true); }
      else dv.setFloat64(o + 0x80 + 8 * i, x, true);
    });
    return [o, OBJECT];
  };
  const rowElem = (r, i) => [dv.getInt32(ROWS + 0x100 * r + 0x80 + 8 * i, true), dv.getUint32(ROWS + 0x100 * r + 0x84 + 8 * i, true)];
  const N = 60, rv = r => [r * 5 - 7, r * 3 - 50];
  const rows = (edit = () => {}) => { const out = []; for (let r = 0; r < N; r++) out.push(edit(r) || setRow(r, rv(r))); setArray(out); };
  const rsum = n => { let s = 0; for (let r = 0; r < n; r++) s = (s + rv(r)[1]) | 0; return s; };
  r = run('rowsum', () => { setLocal(0, 0); setLocal(1, 0); rows(); });
  check('rowsum kind', r.kind, 1); check('rowsum s', local(0)[0], rsum(N)); check('rowsum i', local(1)[0], N);
  check('rowsum sp', r.sp, SP); check('rowsum a kept', local(3)[0], ARR);
  for (const [what, edit, pc] of [
    ['notarray', r => r === 7 && setRow(r, rv(r), { clasp: 0x5008 }), 0],
    ['int element', r => r === 7 && [5, INT], 0],
    ['hole row', r => r === 7 && [0, MAGIC], 0],
    ['double cell', r => r === 7 && setRow(r, [1, 2.5]), 2],
    ['short row', r => r === 7 && setRow(r, rv(r), { initLen: 1 }), 2]]) {
    r = run('rowsum', () => { setLocal(0, 0); setLocal(1, 0); rows(edit); });
    check(`rowsum ${what} kind`, r.kind, 2); check(`rowsum ${what} pc`, r.pcDelta, r.meta.mark[1] + pc);
    check(`rowsum ${what} i`, local(1)[0], 7); check(`rowsum ${what} s`, local(0)[0], rsum(7));
    if (pc === 0) {  // bailed at the outer GetElem: [s, arr, i] on the stack
      check(`rowsum ${what} sp`, r.sp, SP - 24); check(`rowsum ${what} slot1`, slot(1)[0], ARR); check(`rowsum ${what} slot1 tag`, slot(1)[1], OBJECT);
      check(`rowsum ${what} slot2`, slot(2)[0], 7);
    } else {  // bailed at the row GetElem: [s, row, 1]
      check(`rowsum ${what} sp`, r.sp, SP - 24); check(`rowsum ${what} slot1`, slot(1)[0], ROWS + 0x700); check(`rowsum ${what} slot1 tag`, slot(1)[1], OBJECT);
      check(`rowsum ${what} slot2`, slot(2)[0], 1);
    }
  }
  r = run('rowfill', () => { setLocal(1, 0); rows(); });
  check('rowfill kind', r.kind, 1); check('rowfill i', local(1)[0], N);
  check('rowfill cells', Array.from({ length: N }, (_, k) => rowElem(k, 0)[0] === k && rowElem(k, 0)[1] === INT && rowElem(k, 1)[0] === rv(k)[1]).every(Boolean), true);
  r = run('rowfill', () => { setLocal(1, 0); rows(r => r === 9 && setRow(r, [[1, BOOL], 4])); });
  check('rowfill oldbool kind', r.kind, 2); check('rowfill oldbool pc', r.pcDelta, r.meta.mark[1] + 6); check('rowfill oldbool i', local(1)[0], 9);
  check('rowfill oldbool untouched', rowElem(9, 0)[1], BOOL); check('rowfill oldbool prefix', rowElem(8, 0)[0], 8);
}
const cacheTests = JSON.parse(fs.readFileSync(`${dir}/cache-tests.json`));
check("cache identity/GC suite", cacheTests.pass, true);
checks += cacheTests.checks; failures += cacheTests.failures;
console.log(JSON.stringify({ pass: failures === 0, checks, failures }));
process.exitCode = failures ? 1 : 0;
