// Executes Wasm emitted by the actual PblJit.cpp, with no interpreter fallback
// inside the compiled function. The small reference below is independent JS
// bytecode execution, including state at a bailout and resumed execution.
// Usage: node run-nested.mjs DIR (emit.cpp output).
import fs from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const FRAME = 0x10000, SP = 0x20000, INTR = 0x30000, OUT = 0x30010, ARGV = 0x30100;
const INT = 0xffffff81, BOOL = 0xffffff82;
const args = [FRAME, SP, INTR, OUT, ARGV].map(BigInt).concat(Array(18).fill(0n));
function invoke(bytes, memory) {
  const module = new WebAssembly.Module(bytes);
  const table = new WebAssembly.Table({ initial: 0, element: 'anyfunc' });
  const f = new WebAssembly.Instance(module, { env: { memory, table } }).exports.f0;
  return { module, f };
}
if (!isMainThread) {
  const { f } = invoke(workerData.bytes, workerData.memory);
  parentPort.postMessage({ ready: true });
  parentPort.postMessage({ kind: Number(f(...args)) });
} else {
  const dir = process.argv[2];
  let checks = 0, failures = 0, cases = 0;
  function check(name, got, want) {
    checks++;
    if (!Object.is(got, want)) {
      failures++;
      console.error('FAIL', name, 'got', got, 'want', want);
    }
  }
  const modules = new Map();
  for (const name of ['rect', 'widen', 'cube', 'control', 'bound-join', 'posttest', 'overflow', 'number-bail', 'interrupt']) {
    const prefix = `${dir}/nested-${name}`;
    const meta = JSON.parse(fs.readFileSync(`${prefix}.json`));
    check(`${name} compiled`, meta.ok, true);
    if (!meta.ok) { console.error(name, meta.reason); continue; }
    const bytes = fs.readFileSync(`${prefix}.wasm`);
    check(`${name} Wasm valid`, WebAssembly.validate(bytes), true);
    check(`${name} entire outer region`, meta.loops[0].end, meta.len);
    check(`${name} root header`, meta.loops[0].head, 0);
    check(`${name} inner headers`, meta.loops.length, name === 'cube' ? 3 : 2);
    check(`${name} nesting`, Math.max(...meta.loops.map(l => l.depth)), name === 'cube' ? 3 : 2);
    const bytecode = JSON.parse(fs.readFileSync(`${prefix}.bytecode.json`));
    modules.set(name, { meta, bytes, bytecode, pcMap: new Map(bytecode.map(o => [o.pc, o])) });
  }
  if (modules.size !== 9) process.exit(1);

  function init(memory, locals, doubleLocals = new Set()) {
    const dv = new DataView(memory.buffer);
    new Uint8Array(memory.buffer).fill(0xee);
    dv.setUint32(INTR, 0, true);
    locals.forEach((n, i) => {
      const address = FRAME - 8 * (i + 1);
      if (!doubleLocals.has(i) && Number.isInteger(n) && n >= -2147483648 && n <= 2147483647 && !Object.is(n, -0)) {
        dv.setInt32(address, n, true); dv.setUint32(address + 4, INT, true);
      } else dv.setFloat64(address, n, true);
    });
  }
  function value(dv, address) {
    const tag = dv.getUint32(address + 4, true);
    if (tag <= 0xffffff80) return dv.getFloat64(address, true);
    if (tag === INT) return dv.getInt32(address, true);
    if (tag === BOOL) return Boolean(dv.getInt32(address, true));
    throw Error(`unexpected boxed tag ${tag.toString(16)} at ${address.toString(16)}`);
  }
  function snapshot(memory, kind, count) {
    const dv = new DataView(memory.buffer), sp = dv.getUint32(OUT, true);
    const depth = kind ? (SP - sp) / 8 : 0;
    if (depth < 0 || depth > 16 || !Number.isInteger(depth)) throw Error(`bad SP ${sp}`);
    return { kind, pc: dv.getInt32(OUT + 4, true), ic: dv.getUint32(OUT + 8, true), sp,
      locals: Array.from({ length: count }, (_, i) => value(dv, FRAME - 8 * (i + 1))),
      stack: Array.from({ length: depth }, (_, i) => value(dv, SP - 8 * (i + 1))) };
  }
  function run(name, locals, { interrupt = false, doubleLocals = new Set() } = {}) {
    const fixture = modules.get(name), memory = new WebAssembly.Memory({ initial: 4, maximum: 65536, shared: true });
    init(memory, locals, doubleLocals);
    if (interrupt) Atomics.store(new Int32Array(memory.buffer), INTR / 4, 1);
    const { f } = invoke(fixture.bytes, memory);
    cases++;
    return snapshot(memory, Number(f(...args)), locals.length);
  }
  // Interpret only documented numeric bytecode. No JIT type/dataflow routines
  // or emitted Wasm participate in this reference calculation.
  function reference(name, initial, stop = null, resumed = null) {
    const fixture = modules.get(name), { meta, pcMap } = fixture;
    const state = resumed ? { locals: [...resumed.locals], stack: [...resumed.stack], pc: resumed.pc, ic: resumed.ic }
                          : { locals: [...initial], stack: [], pc: 0, ic: 0 };
    const stack = state.stack;
    for (let steps = 0; steps < 1000000; steps++) {
      if (state.pc >= meta.len || state.pc < 0) return state;
      const instruction = pcMap.get(state.pc);
      if (!instruction) throw Error(`no reference instruction ${name}:${state.pc}`);
      if (stop && stop(state, instruction)) return state;
      const { op, a, len } = instruction;
      let next = state.pc + len;
      const binary = fn => { const b = stack.pop(), a = stack.pop(); stack.push(fn(a, b)); state.ic++; };
      const unary = fn => { stack.push(fn(stack.pop())); state.ic++; };
      switch (op) {
        case 'LoopHead': case 'JumpTarget': state.ic = a; break;
        case 'Nop': case 'NopIsAssignOp': case 'DebugLeaveLexicalEnv': break;
        case 'Int32': case 'Double': stack.push(a); break;
        case 'True': stack.push(true); break;
        case 'False': stack.push(false); break;
        case 'GetLocal': stack.push(state.locals[a]); break;
        case 'SetLocal': case 'InitLexical': state.locals[a] = stack.at(-1); break;
        case 'Pop': stack.pop(); break;
        case 'Dup': stack.push(stack.at(-1)); break;
        case 'Dup2': stack.push(stack.at(-2), stack.at(-1)); break;
        case 'Swap': { const b = stack.pop(), a = stack.pop(); stack.push(b, a); break; }
        case 'Add': binary((a,b) => a+b); break;
        case 'Sub': binary((a,b) => a-b); break;
        case 'Mul': binary((a,b) => a*b); break;
        case 'Div': binary((a,b) => a/b); break;
        case 'Mod': binary((a,b) => a%b); break;
        case 'BitAnd': binary((a,b) => a&b); break;
        case 'BitOr': binary((a,b) => a|b); break;
        case 'BitXor': binary((a,b) => a^b); break;
        case 'Lsh': binary((a,b) => a<<b); break;
        case 'Rsh': binary((a,b) => a>>b); break;
        case 'Ursh': binary((a,b) => a>>>b); break;
        case 'Lt': binary((a,b) => a<b); break;
        case 'Le': binary((a,b) => a<=b); break;
        case 'Gt': binary((a,b) => a>b); break;
        case 'Ge': binary((a,b) => a>=b); break;
        case 'Eq': case 'StrictEq': binary((a,b) => a===b); break;
        case 'Ne': case 'StrictNe': binary((a,b) => a!==b); break;
        case 'Inc': unary(a => a+1); break;
        case 'Dec': unary(a => a-1); break;
        case 'Neg': unary(a => -a); break;
        case 'Not': unary(a => !a); break;
        case 'BitNot': unary(a => ~a); break;
        case 'Pos': case 'ToNumeric': unary(a => +a); break;
        case 'Goto': next = state.pc + a; break;
        case 'JumpIfFalse': state.ic++; if (!stack.pop()) next = state.pc+a; break;
        case 'JumpIfTrue': state.ic++; if (stack.pop()) next = state.pc+a; break;
        case 'And': state.ic++; if (!stack.at(-1)) next = state.pc+a; break;
        case 'Or': state.ic++; if (stack.at(-1)) next = state.pc+a; break;
        default: throw Error(`unhandled reference op ${op}`);
      }
      state.pc = next;
    }
    throw Error(`reference instruction budget exceeded: ${name}`);
  }
  function sameState(name, actual, expected) {
    check(`${name} pc`, actual.pc, expected.pc);
    check(`${name} ic`, actual.ic, expected.ic);
    check(`${name} sp`, actual.sp, SP - 8 * expected.stack.length);
    check(`${name} stack depth`, actual.stack.length, expected.stack.length);
    actual.locals.forEach((v, i) => check(`${name} local${i}`, v, expected.locals[i]));
    actual.stack.forEach((v, i) => check(`${name} operand${i}`, v, expected.stack[i]));
  }
  function normal(name, initial, options) {
    const expected = reference(name, initial), actual = run(name, initial, options);
    check(`${name} Normal`, actual.kind, 1);
    sameState(name, actual, expected);
    return actual;
  }

  // Rectangular zero/one/many trip counts, including a zero inner count with a
  // nonzero outer count. Distinct counters require both levels in one f0 call.
  for (const outer of [0, 1, 2, 7]) for (const inner of [0, 1, 2, 9]) {
    for (const name of ['rect', 'widen', 'posttest', 'bound-join']) {
      const r = normal(name, [0, 0, 987, outer, inner, 0, 0]);
      if (name === 'rect') {
        check('rect compiled inner work', r.locals[5], outer*inner);
        check('rect compiled outer work', r.locals[6], outer);
        check('rect closed-form sum', r.locals[0], outer === 0 || inner === 0 ? 0 : 7*inner*outer*(outer-1)/2 + outer*inner*(inner-1)/2);
      }
    }
  }
  for (const count of [0, 1, 2, 5]) {
    const r = normal('cube', [0, 0, 123, 456, count, 0, 0, 0]);
    check('cube compiled inner work', r.locals[5], count**3);
    check('cube compiled middle work', r.locals[7], count**2);
    check('cube compiled outer work', r.locals[6], count);
    check('cube closed-form sum', r.locals[0], count === 0 ? 0 : 111*count**3*(count-1)/2);
  }
  for (const [skip, brk, cont, stop] of [[-1,-1,-1,10000],[2,-1,-1,10000],[-1,3,-1,10000],[-1,-1,3,10000],[-1,-1,-1,8],[2,5,4,10000],[1,4,-1,9]]) {
    for (const outer of [0,1,5]) normal('control', [0,0,91,outer,7,0,0,skip,brk,cont,stop]);
  }
  let seed = 0x5eeda11;
  const random = n => { seed ^= seed<<13; seed ^= seed>>>17; seed ^= seed<<5; return (seed>>>0)%n; };
  for (let i=0; i<40; i++) {
    normal('control', [0,0,123,random(6),random(9),0,0,random(10),random(10),random(10),random(50)]);
    normal('bound-join', [random(3),0,456,random(12),random(15),0,0]);
  }
  check('fractional inner header converged', modules.get('widen').meta.attempts > 1, true);
  check('bound/stack join converged', modules.get('bound-join').meta.attempts > 1, true);
  const rect = modules.get('rect').meta;
  const jIndex = rect.vars.findIndex(v => v.local === 2);
  check('j dead at outer header', !!(rect.loops[0].liveMask & (1<<jIndex)), false);
  check('j live at inner header', !!(rect.loops[1].liveMask & (1<<jIndex)), true);

  for (const initialSum of [2147483645, 2147483630]) {
    const initial = [initialSum,0,999,3,6,0,0];
    const expected = reference('overflow', initial, (s, op) => op.pc === modules.get('overflow').meta.mark[0] && s.stack.at(-2)+s.stack.at(-1)>2147483647);
    const r = run('overflow', initial);
    check('overflow Bail', r.kind, 2); sameState('overflow before Add', r, expected);
    const resumed = reference('overflow', initial, null, r), full = reference('overflow', initial);
    resumed.locals.forEach((v,i) => check(`overflow resumed local${i}`, v, full.locals[i]));
    check('overflow resumed pc', resumed.pc, full.pc); check('overflow resumed ic', resumed.ic, full.ic);
  }
  for (const x of [NaN, Infinity, -Infinity, 2**40, -(2**40)]) {
    const initial = [0,0,123,3,4,0,0,x];
    const expected = reference('number-bail', initial, (s, op) => op.pc === modules.get('number-bail').meta.mark[0]);
    const r = run('number-bail', initial, { doubleLocals: new Set([7]) });
    check('numeric conversion Bail', r.kind, 2); sameState('numeric before BitOr', r, expected);
    const resumed = reference('number-bail', initial, null, r), full = reference('number-bail', initial);
    resumed.locals.forEach((v,i) => check(`numeric resumed local${i}`, v, full.locals[i]));
  }
  for (const x of [-19.75, 0, 7.5, 2147483647]) {
    // Keep the sum in range for the boundary value.
    normal('number-bail', [0,0,123,1,1,0,0,x], { doubleLocals: new Set([7]) });
  }
  {
    const fixture = modules.get('rect'), memory = new WebAssembly.Memory({ initial: 4, maximum: 65536, shared: true });
    init(memory, [0,0,123,3,4,0,0]);
    new DataView(memory.buffer).setUint32(FRAME-8*4+4, BOOL, true);
    const before = Buffer.from(memory.buffer).subarray(FRAME-64, FRAME).toString('hex');
    const { f } = invoke(fixture.bytes, memory); cases++;
    check('entry wrong bound type NoEntry', Number(f(...args)), 0);
    check('entry wrong bound type leaves frame', Buffer.from(memory.buffer).subarray(FRAME-64, FRAME).toString('hex'), before);
    check('entry wrong type leaves out', new DataView(memory.buffer).getUint32(OUT, true), 0xeeeeeeee);
  }
  for (const inner of [0, 7]) {
    const initial = [0,0,123,3,inner,0,0];
    const fixture = modules.get('rect');
    const edge = reference('rect', initial, (s, op) => op.op === 'Goto' && op.a < 0);
    const header = fixture.pcMap.get(edge.pc + fixture.pcMap.get(edge.pc).a);
    edge.pc = header.pc; edge.ic = header.a;
    const r = run('rect', initial, { interrupt: true });
    check('pending interrupt', r.kind, 3); sameState('interrupt exact header', r, edge);
    const resumed = reference('rect', initial, null, r), full = reference('rect', initial);
    resumed.locals.forEach((v,i) => check(`interrupt resumed local${i}`, v, full.locals[i]));
  }
  // Cross-thread signal arrives while native Wasm is running an enormous inner
  // loop. Returning at its header proves it checks that backedge, not just root.
  {
    const fixture = modules.get('interrupt'), initial = [0,0,123,3,2000000000,0,0];
    const memory = new WebAssembly.Memory({ initial: 4, maximum: 65536, shared: true });
    init(memory, initial);
    const start = performance.now();
    const kind = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { memory, bytes: fixture.bytes } });
      let signal, ready = false;
      const deadline = setTimeout(() => { worker.terminate(); reject(Error('inner interruption deadline')); }, 5000);
      worker.on('message', msg => {
        if (msg.ready) { ready = true; signal = setTimeout(() => Atomics.store(new Int32Array(memory.buffer), INTR/4, 1), 30); }
        else if (Object.hasOwn(msg, 'kind')) { clearTimeout(deadline); clearTimeout(signal); resolve(msg.kind); }
      });
      worker.on('error', error => { clearTimeout(deadline); clearTimeout(signal); reject(error); });
      worker.on('exit', code => { if (code && ready) { clearTimeout(deadline); reject(Error(`worker exit ${code}`)); } });
    });
    cases++;
    const r = snapshot(memory, kind, initial.length), inner = fixture.meta.loops[1];
    check('running inner interrupt kind', kind, 3); check('running inner interrupt header', r.pc, inner.head);
    check('running inner interrupt IC', r.ic, inner.ic); check('running inner interrupt SP', r.sp, SP);
    check('inner ran before interruption', r.locals[2] > 0 && r.locals[2] < initial[4], true);
    for (const i of [0,1,3,4,5,6]) check(`inner interrupt untouched local${i}`, r.locals[i], initial[i]);
    check('inner interrupt bounded latency', performance.now()-start < 5000, true);
  }

  const rejects = { 'side-entry':'loop side entry', boundary:'jump target', 'no-backedge':'loop without backedge', crossing:'crossing loops', backward:'backward jump', depth:'loop nesting', stack:'loop entry depth', bool:'nested variable type', object:'array var written', call:'nested opcode', array:'underflow' };
  for (const [name, reason] of Object.entries(rejects)) {
    const m = JSON.parse(fs.readFileSync(`${dir}/nested-reject-${name}.json`));
    check(`${name} rejected`, m.ok, false); check(`${name} rejection reason`, m.reason, reason);
    check(`${name} no Wasm installed`, fs.existsSync(`${dir}/nested-reject-${name}.wasm`), false);
  }
  const report = { pass: failures === 0, checks, failures, cases, compiledNestedModules: modules.size,
    hostEvidenceOnly: true, nativeFirefoxAcceptance: 'not run' };
  console.log(JSON.stringify(report));
  process.exitCode = failures ? 1 : 0;
}
