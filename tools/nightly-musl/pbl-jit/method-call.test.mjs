import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const source = readFileSync(new URL('./PblMethod.inc', import.meta.url), 'utf8');
const icSource = readFileSync(new URL('./PblIc.inc', import.meta.url), 'utf8');
let directory, executable;

function section(text, start, end) {
  const first = text.indexOf(start);
  const last = text.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Production section ${start}`);
  return text.slice(first, last);
}

function definition(text, signature) {
  const start = text.indexOf(signature);
  assert.ok(start >= 0, `Production definition ${signature}`);
  let cursor = text.indexOf('{', start), depth = 1;
  while (depth) {
    cursor++;
    if (text[cursor] === '{') depth++;
    if (text[cursor] === '}') depth--;
    assert.ok(cursor < text.length, 'Balanced production definition');
  }
  return text.slice(start, cursor + 1);
}

before(() => {
  assert.ok(process.env.TMPDIR?.startsWith('/mnt/'), 'Use disk-backed TMPDIR');
  directory = mkdtempSync(path.join(process.env.TMPDIR, 'method-call-'));
  executable = path.join(directory, 'emit');
  const operations = [...new Set(['Call', 'CallIgnoresRv', ...[...source.matchAll(/JSOp::(\w+)/g)].map(match => match[1])])];
  const helpers = ['void op(', 'void lget(', 'void lset(', 'void ltee(',
    'void i32c(', 'void i64c(', 'void load32(', 'void load64(', 'void store32(',
    'void store64(', 'void ifThen(', 'void end(', 'void ld(', 'void stLocal(',
    'void spAdd(', 'void pushLocal(', 'void popLocal(', 'void exitAt(', 'void exitHere(',
    'void tagIs(', 'void invokeIC(', 'void debugCheckNext(', 'void br(', 'void jumpTo('];
  const nativeCall = source.includes('bool MT::nativeCall()')
    ? definition(source, 'bool MT::nativeCall()')
    : 'bool MT::nativeCall() { return false; }';
  const program = `#include <cstdint>
#include <cstddef>
#include <cstdlib>
#include <cstdio>
#include <cstring>
using jsbytecode = uint8_t;
enum class JSOp : uint8_t { ${operations.join(', ')} };
enum JSValueTag : uint32_t { JSVAL_TAG_OBJECT = 0xffffff8cu };
struct JSFunction { static constexpr uint32_t offsetOfFlagsAndArgCount() { return 16; } };
struct FunctionFlags { enum : uint32_t { BASESCRIPT = 32, SELFHOSTLAZY = 64 }; };
struct JSScript { static constexpr uint32_t offsetOfMutableFlags() { return 0; } };
enum class MutableScriptFlagsEnum : uint32_t { HasScriptCounts = 1024 };
struct Shape { static constexpr uint32_t offsetOfBaseShape() { return 4; } };
struct BaseShape { static constexpr uint32_t offsetOfClasp() { return 8; } };
namespace js { const void* FunctionClassPtr = reinterpret_cast<void*>(4096);
const void* FunctionExtendedClassPtr = reinterpret_cast<void*>(4112); }
constexpr uint32_t kShapeOffset = 0;
struct BaselineFrame {
  static constexpr uint32_t Size() { return 32; }
  static constexpr int32_t reverseOffsetOfInterpreterPC() { return -32; }
  static constexpr int32_t reverseOffsetOfInterpreterICEntry() { return -28; }
  static constexpr int32_t reverseOffsetOfFlags() { return -24; }
  static constexpr int32_t reverseOffsetOfInterpreterScript() { return -20; }
  static constexpr uint32_t DEBUGGEE = 2;
};
struct ICEntry { uint32_t stub; static constexpr uint32_t offsetOfFirstStub() { return 0; } };
struct ICStub { static constexpr uint32_t offsetOfStubCode() { return 0; } };
constexpr uint32_t kCtxSp = 0, kCtxArg2 = 8, kCtxExtraArgs = 16;
constexpr uint64_t IC_ERROR_SENTINEL() { return 0xfffffffffffffffeULL; }
uint32_t GET_ARGC(const jsbytecode* code) { return uint32_t(code[1]) | (uint32_t(code[2]) << 8); }
${section(icSource, 'struct Buf {', '\n// Locals:')}
${section(source, 'enum : uint8_t {', '// Parameters')}
${section(source, 'constexpr uint32_t P_FRAME =', '\nconstexpr uint32_t kMaxScriptOps')}
${definition(source, 'int32_t FrameOff(')}
struct OpInfo { uint32_t pcOff; uint32_t icIdx; JSOp op; bool exit; };
bool gIcInline = true;
bool gDirect = false;  // PBLBC_DIRECT off: default code
int64_t CallScripted(int64_t, int64_t, int64_t, int64_t, int64_t) { return 0; }
${definition(source, 'bool IsIcCallOp(')}
struct MT {
  Buf b;
  uint32_t lvl = 0, cur = 0, n = 2, nIc = 0;
  const jsbytecode* code;
  OpInfo ops[2]{{8, 2, JSOp::Call, false}, {12, 3, JSOp::Nop, false}};
  const char* reason = nullptr;
  bool reject(const char* message) { reason = message; return false; }
  ${helpers.map(signature => definition(source, signature)).join('\n')}
  bool nativeCall();
  bool generic(uint32_t nargs);
};
${nativeCall}
${definition(source, 'bool MT::generic(')}
int main(int count, char** arguments) {
  if (count != 4) return 2;
  const uint32_t argc = uint32_t(std::strtoul(arguments[1], nullptr, 10));
  const uint32_t mode = uint32_t(std::atoi(arguments[2]));
  const bool ignores = (mode & 1) != 0;
  const bool terminal = (mode & 2) != 0;
  const bool generic = (mode & 4) != 0;
  jsbytecode code[16]{};
  code[9] = uint8_t(argc); code[10] = uint8_t(argc >> 8);
  MT emitter;
  emitter.code = code;
  emitter.n = terminal ? 1 : 2;
  emitter.ops[0].op = ignores ? JSOp::CallIgnoresRv : JSOp::Call;
  if (!IsIcCallOp(emitter.ops[0].op)) return 3;
  for (const auto& pair : {std::pair<uint32_t, uint32_t>{P_FRAME, L_FR},
       {P_SP, L_SP}, {P_ICE, L_ICE}, {P_CTX, L_CTX}, {P_IO, L_IO}, {P_EPC, L_EPC}}) {
    emitter.lget(pair.first); emitter.op(OP_I32WRAP); emitter.lset(pair.second);
  }
  const size_t before = emitter.b.n;
  const bool emitted = generic ? emitter.generic(argc) : emitter.nativeCall();
  if (terminal) return !emitted && emitter.reason && emitter.b.n == before ? 0 : 4;
  if (!emitted || emitter.reason || emitter.lvl) return 3;
  emitter.lget(L_IO); emitter.lget(L_SP); emitter.store32(0);
  emitter.i64c(777); emitter.op(OP_END);
  Buf module, contents, body;
  module.putn("\\0asm\\1\\0\\0\\0", 8);
  contents.uleb(1); contents.put(0x60); contents.uleb(kNParams);
  for (uint32_t index = 0; index < kNParams; ++index) contents.put(0x7e);
  contents.uleb(1); contents.put(0x7e); module.section(1, contents);
  contents.uleb(3);
  contents.name("env"); contents.name("ic"); contents.put(0); contents.uleb(0);
  contents.name("env"); contents.name("table"); contents.put(1); contents.put(0x70); contents.put(0); contents.uleb(1);
  contents.name("env"); contents.name("memory"); contents.put(2); contents.put(0); contents.uleb(1);
  module.section(2, contents);
  contents.uleb(1); contents.uleb(0); module.section(3, contents);
  contents.uleb(1); contents.name("run"); contents.put(0); contents.uleb(1); module.section(7, contents);
  contents.uleb(1); contents.put(0); contents.put(OP_I32CONST); contents.sleb(0); contents.put(OP_END);
  contents.uleb(1); contents.uleb(0); module.section(9, contents);
  body.uleb(3); body.uleb(kNI64); body.put(0x7e); body.uleb(kNI32); body.put(0x7f); body.uleb(kNF64); body.put(0x7c);
  body.putn(emitter.b.p, emitter.b.n);
  contents.uleb(1); contents.uleb(uint32_t(body.n)); contents.putn(body.p, body.n); module.section(10, contents);
  FILE* output = std::fopen(arguments[3], "wb");
  if (!output) return 4;
  const bool written = std::fwrite(module.p, 1, module.n, output) == module.n;
  return std::fclose(output) == 0 && written ? 0 : 5;
}
`;
  const input = path.join(directory, 'emit.cpp');
  writeFileSync(input, '#include <utility>\n#include <initializer_list>\n' + program);
  execFileSync('c++', ['-std=c++17', '-O2', '-g0', input, '-o', executable], { timeout: 15000 });
});

const boxed = (tag, payload) => (BigInt(tag) << 32n) | BigInt(payload >>> 0);
const integer = value => boxed(0xffffff81, value);
const object = value => boxed(0xffffff8c, value);
const errorSentinel = 0xfffffffffffffffen;
const addresses = { frame: 128, object: 256, shape: 384, baseShape: 448, context: 512,
  output: 768, entries: 1024, stub: 1152, stack: 2048, code: 8192 };

function compiled(argc = 0, ignores = false, callback = () => integer(73), generic = false) {
  const output = path.join(directory, `native-${argc}-${ignores}-${generic}.wasm`);
  try {
    execFileSync(executable, [String(argc), String(Number(ignores) | (generic ? 4 : 0)), output], { timeout: 5000 });
  } catch (error) {
    assert.fail(`Production emitter does not compile native calls: exit ${error.status}`);
  }
  const bytes = readFileSync(output);
  assert.equal(WebAssembly.validate(bytes), true);
  const memory = new WebAssembly.Memory({ initial: 1 });
  const view = new DataView(memory.buffer);
  const calls = [];
  const table = new WebAssembly.Table({ initial: 1, element: 'anyfunc' });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: {
    table, memory, ic: (...args) => {
      calls.push(args);
      return BigInt.asIntN(64, callback(view, args));
    },
  } });
  view.setUint32(addresses.object, addresses.shape, true);
  view.setUint32(addresses.shape + 4, addresses.baseShape, true);
  view.setUint32(addresses.baseShape + 8, 4096, true);
  view.setUint32(addresses.object + 16, 0, true);
  view.setUint32(addresses.frame + 12, 1792, true);
  view.setUint32(addresses.entries + 8, addresses.stub, true);
  view.setUint32(addresses.stub, 0, true);
  for (let index = 0; index < argc; ++index) view.setBigUint64(addresses.stack + index * 8, integer(index + 11), true);
  view.setBigUint64(addresses.stack + argc * 8, 0xffffff8300000000n, true);
  view.setBigUint64(addresses.stack + (argc + 1) * 8, object(addresses.object), true);
  return { view, calls, run() {
    const args = Array(23).fill(0n);
    for (const [index, value] of [[0, addresses.frame], [1, addresses.stack], [3, addresses.entries],
      [4, addresses.context], [5, addresses.output], [10, addresses.code]]) args[index] = BigInt(value);
    return BigInt.asUintN(64, instance.exports.run(...args));
  } };
}

test('native call emitter retains original IC frame, arguments and result conventions', () => {
  for (const ignores of [false, true]) {
    for (const argc of [0, 1, 4, 255]) {
      const { view, calls, run } = compiled(argc, ignores, (memory, args) => {
        assert.equal(args[0], BigInt(argc));
        assert.equal(args[1], 0n);
        assert.equal(args[2], BigInt(addresses.stub));
        assert.equal(args[3], BigInt(addresses.context));
        assert.ok(args.slice(4).every(value => value === 0n));
        assert.equal(memory.getUint32(addresses.context, true), addresses.stack);
        assert.equal(memory.getUint32(addresses.context + 16, true), 2);
        assert.equal(memory.getBigUint64(addresses.context + 8, true), 0n);
        assert.equal(memory.getUint32(addresses.frame, true), addresses.code + 8);
        assert.equal(memory.getUint32(addresses.frame + 4, true), addresses.entries + 8);
        for (let index = 0; index < argc; ++index) assert.equal(memory.getBigUint64(addresses.stack + index * 8, true), integer(index + 11));
        return object(6144);
      });
      view.setBigUint64(addresses.context + 8, 99n, true);
      assert.equal(run(), 777n);
      assert.equal(calls.length, 1);
      const resultSlot = addresses.stack + (argc + 1) * 8;
      assert.equal(view.getUint32(addresses.output, true), resultSlot);
      assert.equal(view.getBigUint64(resultSlot, true), object(6144));
    }
  }
});

test('ordinary and extended native function classes can call with formal argument bits', () => {
  for (const clasp of [4096, 4112]) {
    const { view, calls, run } = compiled(1);
    view.setUint32(addresses.baseShape + 8, clasp, true);
    view.setUint32(addresses.object + 16, 0x7fff0000, true);
    assert.equal(run(), 777n);
    assert.equal(calls.length, 1);
  }
});

test('scripted, lazy, non-function and primitive callees exit before changing frame or operands', () => {
  for (const [callee, clasp, flags] of [[integer(3), 0, 0], [object(addresses.object), 4200, 0],
    [object(addresses.object), 4096, 32], [object(addresses.object), 4112, 64],
    [object(addresses.object), 4096, 96]]) {
    const { view, calls, run } = compiled(2);
    view.setBigUint64(addresses.stack + 24, callee, true);
    view.setUint32(addresses.baseShape + 8, clasp, true);
    view.setUint32(addresses.object + 16, flags, true);
    const before = Buffer.from(new Uint8Array(view.buffer));
    assert.equal(run(), 8n);
    assert.equal(calls.length, 0);
    assert.equal(view.getUint32(addresses.output, true), addresses.stack);
    before.writeUInt32LE(addresses.stack, addresses.output);
    assert.deepEqual(Buffer.from(view.buffer), before);
  }
});

test('native IC errors preserve call operands and report the original call PC', () => {
  for (const ignores of [false, true]) {
    const { view, calls, run } = compiled(4, ignores, () => errorSentinel);
    const operands = Buffer.from(new Uint8Array(view.buffer, addresses.stack, 48));
    assert.equal(run(), (1n << 32n) | 8n);
    assert.equal(calls.length, 1);
    assert.equal(view.getUint32(addresses.output, true), addresses.stack);
    assert.deepEqual(Buffer.from(view.buffer, addresses.stack, 48), operands);
  }
});

test('debugger activation during a native IC resumes after the completed call', () => {
  const { view, calls, run } = compiled(1, false, memory => {
    memory.setUint32(addresses.frame + 8, 2, true);
    return integer(91);
  });
  assert.equal(run(), 12n);
  assert.equal(calls.length, 1);
  assert.equal(view.getUint32(addresses.output, true), addresses.stack + 16);
  assert.equal(view.getBigUint64(addresses.stack + 16, true), integer(91));
});

test('native calls are admitted through IC policy without admitting constructors or direct eval', () => {
  const eligibility = definition(source, 'bool IsIcCallOp(');
  assert.match(eligibility, /case JSOp::Call:/);
  assert.match(eligibility, /case JSOp::CallIgnoresRv:/);
  assert.doesNotMatch(eligibility, /case JSOp::(?:New|NewContent|SuperCall|Eval|StrictEval|SpreadCall):/);
  assert.match(source, /IsInlineOp\(jop\) \|\| \(gIcInline && IsIcCallOp\(jop\)\)/);
  const translation = definition(source, 'bool MT::translateOp()');
  assert.match(translation, /case JSOp::Call:\s*case JSOp::CallIgnoresRv:\s*return nativeCall\(\);/);
});

test('coverage activation reloads the traced script pointer and resumes after the native call', () => {
  for (const scriptAddress of [1792, 1824]) {
    const { view, calls, run } = compiled(1, false, memory => {
      memory.setUint32(addresses.frame + 12, scriptAddress, true);
      memory.setUint32(scriptAddress, 1024, true);
      return integer(53);
    });
    assert.equal(run(), 12n);
    assert.equal(calls.length, 1);
    assert.equal(view.getUint32(addresses.output, true), addresses.stack + 16);
    assert.equal(view.getBigUint64(addresses.stack + 16, true), integer(53));
  }
});

test('a terminal native call is rejected before emitting instructions requiring a successor', () => {
  const output = path.join(directory, 'terminal.wasm');
  assert.doesNotThrow(() => execFileSync(executable, ['0', '2', output], { timeout: 5000 }));
});

test('coverage activation during unary and binary ICs exits after the completed operation', () => {
  for (const argc of [1, 2]) {
    for (const scriptAddress of [1792, 1824]) {
      const { view, calls, run } = compiled(argc, false, memory => {
        memory.setUint32(addresses.frame + 12, scriptAddress, true);
        memory.setUint32(scriptAddress, 1024, true);
        return integer(67);
      }, true);
      assert.equal(run(), 12n, 'resume at successor, not in compiled code');
      assert.equal(calls.length, 1);
      const resultSlot = addresses.stack + (argc - 1) * 8;
      assert.equal(view.getUint32(addresses.output, true), resultSlot);
      assert.equal(view.getBigUint64(resultSlot, true), integer(67));
    }
  }
});

test('ordinary and debuggee unary and binary ICs preserve their result and continuation', () => {
  for (const argc of [1, 2]) {
    for (const debuggee of [false, true]) {
      const { view, calls, run } = compiled(argc, false, memory => {
        memory.setUint32(addresses.frame + 8, debuggee ? 2 : 0, true);
        memory.setUint32(1792, 512, true);
        return integer(71);
      }, true);
      assert.equal(run(), debuggee ? 12n : 777n);
      assert.equal(calls.length, 1);
      const resultSlot = addresses.stack + (argc - 1) * 8;
      assert.equal(view.getUint32(addresses.output, true), resultSlot);
      assert.equal(view.getBigUint64(resultSlot, true), integer(71));
    }
  }
});
