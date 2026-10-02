// Runs the host emitter test modules (emit.cpp output) against a shared
// memory laid out like a PBL frame/stack and checks every exit's state.
// Usage: node run.mjs DIR
import fs from 'node:fs';
const dir = process.argv[2];
const memory = new WebAssembly.Memory({ initial: 4, maximum: 65536, shared: true });
const table = new WebAssembly.Table({ initial: 0, element: 'anyfunc' });
const dv = new DataView(memory.buffer);
const FRAME = 0x10000, SP = 0x20000, INTR = 0x30000, OUT = 0x30010;
const INT = 0xFFFFFF81, BOOL = 0xFFFFFF82, DOUBLE_HI = 0x40000000;
let failures = 0, checks = 0;
const check = (name, got, want) => { checks++; if (got !== want) { failures++; console.log('FAIL', name, 'got', got, 'want', want); } };
const setLocal = (k, v, tag = INT) => { dv.setUint32(FRAME - 8 * (k + 1), v >>> 0, true); dv.setUint32(FRAME - 8 * (k + 1) + 4, tag, true); };
const local = k => [dv.getInt32(FRAME - 8 * (k + 1), true), dv.getUint32(FRAME - 8 * (k + 1) + 4, true)];
function run(name, setup) {
  const meta = JSON.parse(fs.readFileSync(`${dir}/${name}.json`));
  const mod = new WebAssembly.Module(fs.readFileSync(`${dir}/${name}.wasm`));
  const f0 = new WebAssembly.Instance(mod, { env: { memory, table } }).exports.f0;
  new Uint8Array(memory.buffer, 0, 0x40000).fill(0xEE);
  dv.setUint32(INTR, 0, true);
  setup();
  const args = [FRAME, SP, INTR, OUT].map(BigInt).concat(Array(19).fill(0n));
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

const rej = JSON.parse(fs.readFileSync(`${dir}/reject-getarg.json`));
check('reject getarg', rej.ok === false && rej.reason === 'GetArg', true);
console.log(JSON.stringify({ pass: failures === 0, checks, failures }));
process.exitCode = failures ? 1 : 0;
