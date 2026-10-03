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


for (const name of fs.readdirSync(dir).filter(n => n.startsWith('reject-') && n.endsWith('.json'))) {
  const meta = JSON.parse(fs.readFileSync(`${dir}/${name}`));
  const expected = name.startsWith('reject-head-') ? 'phase-one head type'
    : name === 'reject-op-LoopHead.json' ? 'nested loop'
    : name === 'reject-underflow.json' ? 'underflow' : 'phase-one opcode';
  check(`${name} rejects`, meta.ok, false);
  check(`${name} reason`, meta.reason, expected);
  check(`${name} attempts`, meta.attempts, 1);
  check(`${name} no wasm`, fs.existsSync(`${dir}/${name.replace('.json', '.wasm')}`), false);
}
for (const x of [0, -2147483648]) {
  r = run('negloop', () => setLocal(0, x));
  check(`neg ${x} fallback`, r.kind, 2);
  check(`neg ${x} unchanged`, local(0)[0], x);
  check(`neg ${x} operand`, slot(0)[0], x);
  check(`neg ${x} pc`, r.pcDelta, 10);
  check(`neg ${x} ic`, r.ic, 0);
}
r = run('negloop', () => setLocal(0, -7));
check('neg ordinary kind', r.kind, 1); check('neg ordinary value', local(0)[0], 7);
const cacheTests = JSON.parse(fs.readFileSync(`${dir}/cache-tests.json`));
check('real OnLoopHead mock identity/GC suite', cacheTests.pass, true);
checks += cacheTests.checks; failures += cacheTests.failures;
console.log(JSON.stringify({pass:failures===0, checks, failures, scope:'host emitter only; no Nightly binary/guest acceptance'}));
process.exitCode=failures?1:0;
