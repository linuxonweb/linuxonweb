// Host-engine check of the guest JIT install path against the actual spliced
// Firefox module (JIT packet 2). Runs in Node/V8, not inside a running guest:
// it instantiates the real Firefox module bytes (start function only runs
// __wasm_init_memory), then uses the unmodified web/linux/dist/guest-jit.js
// install path to place a generated module whose f0 has the uniform
// (23 x i64) -> i64 fpcast signature and forwards to an existing Firefox table
// entry via call_indirect. Results are compared with an independent
// interpreter of each pure i32 leaf body and with a direct JS call of the
// entry. Control: the unspliced module refuses the install with -ENOMEM.
//
// usage: node firefox-table-check.mjs SPLICED.wasm ORIGINAL.wasm LEAVES.json OUT.json
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createJitControl, JitThread, jitSyscall, JIT_SYSCALL_INSTALL, JIT_SYSCALL_FREE }
  from '../../dist/guest-jit.js';

const [splicedPath, originalPath, leavesPath, outPath] = process.argv.slice(2);
if (!outPath) throw Error('usage: SPLICED ORIGINAL LEAVES OUT');
for (const k of ['TMPDIR', 'TMP', 'TEMP'])
  if (!process.env[k] || !fs.realpathSync(process.env[k]).startsWith('/mnt/p6/build/')) throw Error(k + ' must be disk-backed');
const sha = b => createHash('sha256').update(b).digest('hex');
const checks = []; let failures = 0;
function check(name, ok, detail) { checks.push({ name, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); if (!ok) { failures++; console.log('FAIL', name, detail ?? ''); } }

// ---- tiny module builder ----
const uleb = v => { const o = []; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; o.push(b); } while (v); return o; };
const str = s => [...uleb(s.length), ...Buffer.from(s)];
const section = (id, body) => [id, ...uleb(body.length), ...body];
const vec = items => [...uleb(items.length), ...items.flat()];
const I64 = 0x7e;
const TYPE23 = [0x60, ...uleb(23), ...Array(23).fill(I64), 1, I64];
// f0(p0..p22) = call_indirect type0 table[wrap(p0)] (p1..p22, 0)
function trampolineModule() {
  const body = [0];
  for (let i = 1; i < 23; i++) body.push(0x20, i);
  body.push(0x42, 0, 0x20, 0, 0xa7, 0x11, 0, 0, 0x0b);
  return Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...section(1, vec([TYPE23])),
    ...section(2, vec([
      [...str('env'), ...str('memory'), 2, 3, ...uleb(1), ...uleb(65536)],
      [...str('env'), ...str('table'), 1, 0x70, 0, ...uleb(0)]])),
    ...section(3, vec([[0]])),
    ...section(7, vec([[...str('f0'), 0, 0]])),
    ...section(10, vec([[...uleb(body.length), ...body]]))]);
}

// ---- independent interpreter of pure i32 leaf bodies ----
function sleb32(bytes, st) { let r = 0, s = 0, b; do { b = bytes[st.o++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); if (s < 32 && (b & 0x40)) r |= -1 << s; return r | 0; }
function interp(hex, args) {
  const b = Buffer.from(hex, 'hex'), st = { o: 0 }, s = [];
  const bin = f => { const y = s.pop(), x = s.pop(); s.push(f(x, y) | 0); };
  const u = x => x >>> 0;
  for (;;) {
    const op = b[st.o++];
    switch (op) {
      case 0x0b: if (s.length !== 1) throw Error('stack'); return s[0] >>> 0;
      case 0x20: { let r = 0, sh = 0, c; do { c = b[st.o++]; r |= (c & 0x7f) << sh; sh += 7; } while (c & 0x80); s.push(args[r] | 0); break; }
      case 0x41: s.push(sleb32(b, st)); break;
      case 0x6a: bin((x, y) => x + y); break;
      case 0x6b: bin((x, y) => x - y); break;
      case 0x6c: bin((x, y) => Math.imul(x, y)); break;
      case 0x71: bin((x, y) => x & y); break;
      case 0x72: bin((x, y) => x | y); break;
      case 0x73: bin((x, y) => x ^ y); break;
      case 0x74: bin((x, y) => x << (y & 31)); break;
      case 0x75: bin((x, y) => x >> (y & 31)); break;
      case 0x76: bin((x, y) => x >>> (y & 31)); break;
      case 0x45: s.push(s.pop() === 0 ? 1 : 0); break;
      case 0x46: bin((x, y) => +(x === y)); break;
      case 0x47: bin((x, y) => +(x !== y)); break;
      case 0x48: bin((x, y) => +(x < y)); break;
      case 0x49: bin((x, y) => +(u(x) < u(y))); break;
      case 0x4a: bin((x, y) => +(x > y)); break;
      case 0x4b: bin((x, y) => +(u(x) > u(y))); break;
      case 0x4c: bin((x, y) => +(x <= y)); break;
      case 0x4d: bin((x, y) => +(u(x) <= u(y))); break;
      case 0x4e: bin((x, y) => +(x >= y)); break;
      case 0x4f: bin((x, y) => +(u(x) >= u(y))); break;
      case 0x1b: { const c = s.pop(), y = s.pop(), x = s.pop(); s.push(c ? x : y); break; }
      default: throw Error('op ' + op.toString(16));
    }
  }
}

// ---- instantiate the actual Firefox module ----
async function instantiate(bytes) {
  const memory = new WebAssembly.Memory({ initial: 1280, maximum: 65536, shared: true });
  const stub = () => 0;
  const module = await WebAssembly.compile(bytes);
  const imports = { env: { memory }, linux: {} };
  for (const i of WebAssembly.Module.imports(module)) if (i.module === 'linux') imports.linux[i.name] = stub;
  const instance = await WebAssembly.instantiate(module, imports);
  return { module, memory, table: instance.exports.__indirect_function_table };
}

const result = { schema: 1, engine: 'node ' + process.version, scope: 'host V8 on actual Firefox module bytes; not inside a running guest Firefox', checks };
const spliced = fs.readFileSync(splicedPath), original = fs.readFileSync(originalPath);
result.splicedSha256 = sha(spliced); result.originalSha256 = sha(original);
const leaves = JSON.parse(fs.readFileSync(leavesPath, 'utf8'));
result.leafCount = leaves.length;
const image = trampolineModule();
result.trampolineBytes = image.length; result.trampolineSha256 = sha(image);

let t0 = Date.now();
const ff = await instantiate(spliced);
result.splicedInstantiateMs = Date.now() - t0;
const staticLength = ff.table.length;
check('spliced table initial length', staticLength === 177851, staticLength);
const view = new DataView(ff.memory.buffer);
const MOD = 60 << 20, OUT = MOD - 64; // scratch inside the 80 MiB initial memory, above static data
new Uint8Array(ff.memory.buffer, MOD, image.length).set(image);
const control = createJitControl();
const thread = new JitThread(control, ff.memory, ff.table);
const rc = Number(jitSyscall(thread, ff.memory, BigInt(JIT_SYSCALL_INSTALL), BigInt(MOD), BigInt(image.length), 0n, BigInt(OUT)));
const index = view.getUint32(OUT, true);
check('install returns 0 on spliced table', rc === 0, rc);
check('installed index is first index past static table', index === staticLength, index);
check('table grew by one', ff.table.length === staticLength + 1, ff.table.length);
const f0 = ff.table.get(index);
// A JS caller of the installed function (the real callers are guest C function
// pointers through the same table; the guest test covers that path).
const junk = 0xdead_beef_0000_0000n; // high bits the fpcast thunks must discard
let compared = 0, mismatches = [];
const seeds = [0, 1, 2, 7, -1, 127462, 127462 + 25, 127462 + 26, 0x7fffffff, -2147483648, 96, 1000003];
for (const leaf of leaves) {
  for (let r = 0; r < 4; r++) {
    const args = Array.from({ length: 22 }, (_, i) => seeds[(i * 5 + r * 3 + leaf.tableIndex) % seeds.length] + r * i);
    const expected = interp(leaf.body, args);
    const big = args.map((a, i) => (BigInt.asUintN(32, BigInt(a)) | (i % 2 ? junk : 0n)));
    const viaJit = f0(BigInt(leaf.tableIndex) | junk, ...big);
    const direct = ff.table.get(leaf.tableIndex)(...big, 0n);
    compared++;
    if (viaJit !== BigInt(expected) || direct !== viaJit) mismatches.push({ leaf: leaf.tableIndex, args, expected, viaJit: String(viaJit), direct: String(direct) });
  }
}
check('installed fpcast trampoline matches independent interpretation for every pure leaf entry', mismatches.length === 0, { compared, mismatches: mismatches.slice(0, 5) });
result.comparedCalls = compared;
// Signature check still applies: calling a null slot or out of bounds traps.
let trapped = null;
try { f0(1n, ...Array(22).fill(0n)); } catch (e) { trapped = String(e); }
check('call_indirect into null static slot traps', trapped && /null|uninitialized|function/.test(trapped), trapped);
trapped = null;
try { f0(BigInt(staticLength + 100), ...Array(22).fill(0n)); } catch (e) { trapped = String(e); }
check('call_indirect beyond table traps', trapped !== null, trapped);
// Microbenchmark: installed trampoline vs direct thunk from JS (host only).
const bench = leaves.find(l => l.tableIndex === 18551) || leaves[0];
const zeros = Array(22).fill(3n), N = 2_000_000;
function time(fn) { let best = Infinity; for (let k = 0; k < 3; k++) { const s = process.hrtime.bigint(); for (let i = 0; i < N; i++) fn(); best = Math.min(best, Number(process.hrtime.bigint() - s) / N); } return best; }
const direct = ff.table.get(bench.tableIndex), tIdx = BigInt(bench.tableIndex);
result.bench = { entry: bench.tableIndex, calls: N, directNsPerCall: time(() => direct(...zeros, 0n)), viaTrampolineNsPerCall: time(() => f0(tIdx, ...zeros)), note: 'JS-to-wasm call overhead dominates; not a guest measurement' };
const frc = Number(jitSyscall(thread, ff.memory, BigInt(JIT_SYSCALL_FREE), BigInt(index), 1n, 0n, 0n));
check('free returns 0', frc === 0, frc);
check('freed slot is null', ff.table.get(index) === null);

// ---- control: the unspliced module ----
t0 = Date.now();
const orig = await instantiate(original);
result.originalInstantiateMs = Date.now() - t0;
new Uint8Array(orig.memory.buffer, MOD, image.length).set(image);
const othread = new JitThread(createJitControl(), orig.memory, orig.table);
const orc = Number(jitSyscall(othread, orig.memory, BigInt(JIT_SYSCALL_INSTALL), BigInt(MOD), BigInt(image.length), 0n, BigInt(OUT)));
check('unspliced fixed-size table refuses install with -ENOMEM', orc === -12, orc);
check('unspliced table length unchanged', orig.table.length === 177851, orig.table.length);

result.pass = failures === 0; result.failures = failures;
fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ pass: result.pass, checks: checks.length, failures, compared, bench: result.bench }));
process.exitCode = result.pass ? 0 : 1;
