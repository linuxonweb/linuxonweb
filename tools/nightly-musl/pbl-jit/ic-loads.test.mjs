import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const source = readFileSync(new URL('./PblIc.inc', import.meta.url), 'utf8');
const translator = source.slice(source.indexOf('struct Translator {'));
const operations = ['LoadDenseElementResult', 'LoadDenseElementExistsResult', 'LoadStringLengthResult', 'IsTypedArrayResult', 'CompareStringResult', 'StoreDenseElement'];
const comparisons = ['Eq', 'StrictEq', 'Ne', 'StrictNe', 'Lt', 'Le', 'Gt', 'Ge'];
let directory, executable;

function section(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, `Production section ${start}`);
  return source.slice(first, last);
}

function method(name) {
  const start = translator.search(new RegExp(`^  void ${name}\\(`, 'm'));
  assert.ok(start >= 0, `Production emitter method ${name}`);
  let cursor = translator.indexOf('{', start), depth = 1;
  while (depth) {
    cursor++;
    if (translator[cursor] === '{') depth++;
    if (translator[cursor] === '}') depth--;
    assert.ok(cursor < translator.length, 'Balanced emitter method');
  }
  return translator.slice(start, cursor + 1);
}

before(() => {
  assert.ok(process.env.TMPDIR?.startsWith('/mnt/'), 'Use disk-backed TMPDIR');
  directory = mkdtempSync(path.join(process.env.TMPDIR, 'ic-loads-'));
  executable = path.join(directory, 'emit');
  const names = [...source.matchAll(/case CacheOp::(\w+):/g)].map(match => match[1]);
  const dense = section('    case CacheOp::LoadDenseElementResult:', '    case CacheOp::LoadInt32ArrayLengthResult:');
  const typed = section('    case CacheOp::IsTypedArrayResult:', '    case CacheOp::StoreFixedSlot:');
  const strings = source.includes('    case CacheOp::CompareStringResult:')
    ? section('    case CacheOp::CompareStringResult:', '    case CacheOp::CompareInt32Result:') : '';
  const helpers = ['op', 'lget', 'lset', 'ltee', 'i32c', 'i64c', 'load32', 'load64', 'store64', 'failIf', 'fail', 'ifThen', 'elseThen', 'endIf', 'readReg32', 'readValue', 'hi', 'tagIs', 'boxPayload', 'boxBool', 'classOf'];
  const program = `#include <cstdint>
#include <cstddef>
#include <cstdlib>
#include <cstdio>
#include <cstring>
enum JSValueTag : uint32_t { JSVAL_TAG_INT32 = 0xffffff81u, JSVAL_TAG_BOOLEAN = 0xffffff82u, JSVAL_TAG_MAGIC = 0xffffff85u };
namespace JS { namespace detail { constexpr uint32_t ValueLowerInclGCThingTag = 0xffffff87u; } }
enum class CacheOp { ${[...new Set([...names, ...operations])].join(', ')} };
enum class JSOp { ${comparisons.join(', ')} };
struct NativeObject { static constexpr uint32_t offsetOfElements() { return 8; } };
struct ObjectElements {
  static constexpr int32_t offsetOfInitializedLength() { return -8; }
  static constexpr int32_t offsetOfFlags() { return -16; }
  static constexpr uint32_t NON_PACKED = 1;
};
struct JSString {
  static constexpr uint32_t offsetOfLength() { return 4; }
  static constexpr uint32_t offsetOfFlags() { return 0; }
};
struct StringFlags { static constexpr uint32_t ATOM_BIT = 8; };
constexpr uint32_t kShapeOffset = 0;
struct Shape { static constexpr uint32_t offsetOfBaseShape() { return 4; } };
struct BaseShape { static constexpr uint32_t offsetOfClasp() { return 8; } };
struct JSClass { uint32_t name; uint32_t flags; };
constexpr uint32_t JSCLASS_IS_PROXY = 0x1000;
struct TypedArrayClassRange { uint32_t first; uint32_t last; };
namespace std {
const JSClass* begin(const TypedArrayClassRange& range) { return reinterpret_cast<const JSClass*>(uintptr_t(range.first)); }
const JSClass* end(const TypedArrayClassRange& range) { return reinterpret_cast<const JSClass*>(uintptr_t(range.last)); }
}
struct TypedArrayObject {
  static inline TypedArrayClassRange fixedLengthClasses{4096, 4224};
  static inline TypedArrayClassRange resizableClasses{4352, 4480};
};
${section('struct Buf {', '\n// Locals:')}
${section('constexpr uint32_t kParams =', '\n// JSObject::')}
${section('constexpr int64_t ShiftedTag(', '\nstruct Translator {')}
${section('#define RET_INT32_FROM_I32()', '\nbool Translator::translateOp(')}
struct Emitter {
  Buf b;
  uint32_t depth = 0;
  ${helpers.map(method).join('\n')}
  bool emit(CacheOp cop, const uint8_t* a) {
    switch (cop) {
${dense}
${typed}
${strings}
      default: return false;
    }
  }
};
int main(int count, char** arguments) {
  if (count != 4) return 2;
  CacheOp operation;
  ${operations.map((name, index) => `${index ? 'else ' : ''}if (!std::strcmp(arguments[1], "${name}")) operation = CacheOp::${name};`).join('\n  ')}
  else return 2;
  Emitter emitter;
  const uint8_t option = uint8_t(std::atoi(arguments[2]));
  const uint8_t operands[] = {
    uint8_t(operation == CacheOp::CompareStringResult ? option : 0),
    uint8_t(operation == CacheOp::CompareStringResult ? 0 : operation == CacheOp::IsTypedArrayResult ? option : 1),
    uint8_t(operation == CacheOp::CompareStringResult ? 1 : operation == CacheOp::StoreDenseElement ? 2 : option),
    option
  };
  emitter.lget(0); emitter.lset(L_V);
  emitter.lget(1); emitter.lset(L_V + 1);
  emitter.lget(2); emitter.lset(L_V + 2);
  emitter.lget(3); emitter.lset(L_T + 2);
  emitter.i64c(0xface); emitter.lset(L_RET);
  emitter.op(OP_BLOCK); emitter.op(OP_VOID);
  if (!emitter.emit(operation, operands)) return 3;
  emitter.lget(L_RET); emitter.op(OP_RETURN); emitter.op(OP_END);
  emitter.i64c(0x1234); emitter.op(OP_END);
  Buf module, contents;
  const uint8_t header[] = {0, 97, 115, 109, 1, 0, 0, 0};
  module.putn(header, sizeof(header));
  contents.uleb(1); contents.put(0x60); contents.uleb(kParams);
  for (uint32_t index = 0; index < kParams; index++) contents.put(0x7e);
  contents.uleb(1); contents.put(0x7e); module.section(1, contents);
  contents.uleb(1); contents.name("env"); contents.name("memory");
  contents.put(2); contents.put(0); contents.uleb(1); module.section(2, contents);
  contents.uleb(1); contents.uleb(0); module.section(3, contents);
  contents.uleb(1); contents.name("run"); contents.put(0); contents.uleb(0); module.section(7, contents);
  Buf body;
  body.uleb(3); body.uleb(kI64Locals); body.put(0x7e);
  body.uleb(kI32Locals); body.put(0x7f); body.uleb(kF64Locals); body.put(0x7c);
  body.putn(emitter.b.p, emitter.b.n);
  contents.uleb(1); contents.uleb(uint32_t(body.n)); contents.putn(body.p, body.n); module.section(10, contents);
  FILE* output = std::fopen(arguments[3], "wb");
  if (!output) return 4;
  const bool written = std::fwrite(module.p, 1, module.n, output) == module.n;
  return std::fclose(output) == 0 && written ? 0 : 5;
}
`;
  const input = path.join(directory, 'emit.cpp');
  writeFileSync(input, program);
  execFileSync('c++', ['-std=c++17', '-O2', '-g0', input, '-o', executable], { timeout: 15000 });
});

function compiled(operation, packed = false) {
  const output = path.join(directory, `${operation}-${packed}.wasm`);
  try {
    execFileSync(executable, [operation, String(Number(packed)), output], { timeout: 5000 });
  } catch (error) {
    assert.fail(`Production emitter does not compile ${operation}: exit ${error.status}`);
  }
  const bytes = readFileSync(output);
  assert.equal(WebAssembly.validate(bytes), true, 'Production-emitted Wasm must validate');
  const memory = new WebAssembly.Memory({ initial: 1 });
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { memory } });
  const view = new DataView(memory.buffer);
  return {
    view,
    run: (object, index = 0, value = 0n, tag = 0n) => BigInt.asUintN(64, instance.exports.run(BigInt(object), BigInt(index), value, tag, ...Array(19).fill(0n))),
  };
}

const integer = value => 0xffffff8100000000n | BigInt(value >>> 0);
const booleanTrue = 0xffffff8200000001n;
const magic = 0xffffff8500000000n;
const failedGuard = 0x1234n;

test('compiled string length returns tagged integers and guards oversized lengths', () => {
  const { view, run } = compiled('LoadStringLengthResult');
  for (const length of [0, 1, 7, 65535, 0x7fffffff]) {
    view.setUint32(132, length, true);
    assert.equal(run(128), integer(length));
  }
  for (const length of [0x80000000, 0xffffffff]) {
    view.setUint32(132, length, true);
    assert.equal(run(128), failedGuard);
  }
});

test('compiled dense existence checks initialized bounds and all magic holes', () => {
  const { view, run } = compiled('LoadDenseElementExistsResult');
  view.setUint32(136, 512, true);
  view.setUint32(504, 2, true);
  for (const value of [0n, integer(0), 0xffffff8200000000n, 0xffffff8300000000n, 0xfffffff000000123n]) {
    view.setBigUint64(512, value, true);
    assert.equal(run(128, 0), booleanTrue);
  }
  for (const payload of [0n, 1n, 17n, 0xffffffffn]) {
    view.setBigUint64(512, magic | payload, true);
    assert.equal(run(128, 0), failedGuard);
  }
  view.setBigUint64(520, integer(31), true);
  assert.equal(run(128, 1), booleanTrue);
  for (const index of [-1, -2147483648, 2, 2147483647]) assert.equal(run(128, index), failedGuard);
  view.setUint32(504, 0, true);
  assert.equal(run(128, 0), failedGuard);
});

test('existing dense loads retain values, packed guard and hole fallback', () => {
  for (const packed of [false, true]) {
    const { view, run } = compiled('LoadDenseElementResult', packed);
    view.setUint32(136, 512, true);
    view.setUint32(504, 1, true);
    view.setBigUint64(512, integer(73), true);
    assert.equal(run(128, 0), integer(73));
    assert.equal(run(128, -1), failedGuard);
    assert.equal(run(128, 1), failedGuard);
    view.setUint32(496, 1, true);
    assert.equal(run(128, 0), packed ? failedGuard : integer(73));
    view.setBigUint64(512, magic, true);
    assert.equal(run(128, 0), failedGuard);
  }
});

function objectClass(view, clasp, flags = 0) {
  view.setUint32(128, 256, true);
  view.setUint32(260, 384, true);
  view.setUint32(392, clasp, true);
  view.setUint32(clasp + 4, flags, true);
}

test('compiled dense stores preserve primitive bits, adjacent slots and result state', () => {
  const values = [0n, 0x8000000000000000n, 0x3ff8000000000000n, 0x7ff8000000000000n,
    integer(-2147483648), integer(2147483647), booleanTrue,
    0xffffff8300000000n, 0xffffff8400000000n];
  for (const packed of [false, true]) {
    const { view, run } = compiled('StoreDenseElement', packed);
    view.setUint32(136, 512, true);
    view.setUint32(504, 3, true);
    view.setUint32(496, 0, true);
    view.setBigUint64(512, integer(17), true);
    view.setBigUint64(528, integer(29), true);
    for (const value of values) {
      assert.equal(run(128, 1, value), 0xfacen);
      assert.equal(view.getBigUint64(520, true), value);
      assert.equal(view.getBigUint64(512, true), integer(17));
      assert.equal(view.getBigUint64(528, true), integer(29));
    }
    assert.equal(run(128, 1, 37n, 0xffffff8100000000n), 0xfacen);
    assert.equal(view.getBigUint64(520, true), integer(37));
  }
});

test('dense store guards reject bounds, packed mismatches and holes without changing memory', () => {
  for (const packed of [false, true]) {
    const { view, run } = compiled('StoreDenseElement', packed);
    view.setUint32(136, 512, true);
    view.setUint32(504, 2, true);
    view.setBigUint64(512, integer(19), true);
    for (const index of [-2147483648, -1, 2, 2147483647]) {
      const before = Buffer.from(new Uint8Array(view.buffer));
      assert.equal(run(128, index, integer(23)), failedGuard);
      assert.deepEqual(Buffer.from(view.buffer), before);
    }
    view.setUint32(496, 1, true);
    const before = Buffer.from(new Uint8Array(view.buffer));
    assert.equal(run(128, 0, integer(23)), packed ? failedGuard : 0xfacen);
    if (packed) assert.deepEqual(Buffer.from(view.buffer), before);
    else assert.equal(view.getBigUint64(512, true), integer(23));
    for (const payload of [0n, 1n, 17n, 0xffffffffn]) {
      view.setBigUint64(512, magic | payload, true);
      const hole = Buffer.from(new Uint8Array(view.buffer));
      assert.equal(run(128, 0, integer(31)), failedGuard);
      assert.deepEqual(Buffer.from(view.buffer), hole);
    }
    view.setUint32(504, 0, true);
    assert.equal(run(128, 0, integer(31)), failedGuard);
  }
});

test('dense stores defer every old or new GC value before any write', () => {
  const gcTags = [0xffffff87n, 0xffffff88n, 0xffffff89n, 0xffffff8cn, 0xffffff8en];
  for (const packed of [false, true]) {
    const { view, run } = compiled('StoreDenseElement', packed);
    view.setUint32(136, 512, true);
    view.setUint32(504, 1, true);
    for (const tag of gcTags) {
      const gcValue = (tag << 32n) | 1024n;
      for (const [oldValue, newValue] of [[gcValue, integer(1)], [integer(1), gcValue], [gcValue, gcValue]]) {
        view.setBigUint64(512, oldValue, true);
        const before = Buffer.from(new Uint8Array(view.buffer));
        assert.equal(run(128, 0, newValue), failedGuard);
        assert.deepEqual(Buffer.from(view.buffer), before);
      }
      view.setBigUint64(512, integer(1), true);
      const before = Buffer.from(new Uint8Array(view.buffer));
      assert.equal(run(128, 0, 1024n, tag << 32n), failedGuard);
      assert.deepEqual(Buffer.from(view.buffer), before);
    }
  }
});

test('compiled typed-array checks cover native classes even when wrapping is allowed', () => {
  for (const possiblyWrapped of [false, true]) {
    const { view, run } = compiled('IsTypedArrayResult', possiblyWrapped);
    for (const clasp of [4096, 4160, 4224, 4288, 4352, 4416]) {
      objectClass(view, clasp);
      assert.equal(run(128), booleanTrue);
    }
    for (const clasp of [4000, 4480, 4608]) {
      objectClass(view, clasp, 4);
      assert.equal(run(128), 0xffffff8200000000n);
    }
  }
});

test('possibly wrapped proxies defer instead of bypassing wrapper checks or errors', () => {
  for (const possiblyWrapped of [false, true]) {
    const { view, run } = compiled('IsTypedArrayResult', possiblyWrapped);
    for (const flags of [0x1000, 0x1004, 0xffffffff]) {
      objectClass(view, 4608, flags);
      assert.equal(run(128), possiblyWrapped ? failedGuard : 0xffffff8200000000n);
    }
  }
});

function strings(view, leftLength, rightLength, leftFlags = 0, rightFlags = 0) {
  view.setUint32(128, leftFlags, true);
  view.setUint32(132, leftLength, true);
  view.setUint32(256, rightFlags, true);
  view.setUint32(260, rightLength, true);
}

const boolean = value => 0xffffff8200000000n | BigInt(value);

test('string identity implements all eight comparisons without dereferencing character data', () => {
  for (const [opcode, name] of comparisons.entries()) {
    const { view, run } = compiled('CompareStringResult', opcode);
    for (const flags of [0, 8, 0xffffffff]) {
      strings(view, 29, 29, flags, flags);
      assert.equal(run(128, 128), boolean(['Eq', 'StrictEq', 'Le', 'Ge'].includes(name)), name);
    }
    assert.equal(run(65535, 65535), boolean(['Eq', 'StrictEq', 'Le', 'Ge'].includes(name)), 'Identity needs no header read');
  }
});

test('distinct atoms and different lengths resolve only equality comparisons inline', () => {
  for (const [opcode, name] of comparisons.entries()) {
    const { view, run } = compiled('CompareStringResult', opcode);
    const expected = opcode < 4 ? boolean(name === 'Ne' || name === 'StrictNe') : failedGuard;
    for (const [leftLength, rightLength, leftFlags, rightFlags] of [
      [3, 3, 8, 8], [3, 3, 24, 40], [3, 4, 0, 0],
      [0, 4, 8, 0], [4, 0, 0, 8], [0x7fffffff, 1, 0, 0],
    ]) {
      strings(view, leftLength, rightLength, leftFlags, rightFlags);
      assert.equal(run(128, 256), expected, name);
      assert.equal(run(256, 128), expected, `${name} reverse operands`);
    }
  }
});

test('unresolved nonatom or mixed string contents defer to the existing fallback', () => {
  for (const opcode of comparisons.keys()) {
    const { view, run } = compiled('CompareStringResult', opcode);
    for (const length of [0, 1, 17, 0x7fffffff]) {
      for (const [leftFlags, rightFlags] of [[0, 0], [8, 0], [0, 8], [16, 16]]) {
        strings(view, length, length, leftFlags, rightFlags);
        assert.equal(run(128, 256), failedGuard);
      }
    }
  }
});
