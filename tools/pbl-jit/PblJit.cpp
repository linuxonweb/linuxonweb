/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
// Guest JIT packet 4: runtime PBL-to-wasm loop specializer (adapter source).
//
// Compiled with the same command as PortableBaselineInterpret.cpp and linked
// beside a copy of it whose CASE(LoopHead) calls pbljit::OnLoopHead (see
// tools/build-firefox-pbl-jit.py). Upstream SpiderMonkey files are unchanged.
//
// A hot innermost loop (LoopHead .. the Goto/JumpIfTrue back to it) whose ops
// are all in the int32 subset below is translated into one wasm function
// (23 x i64) -> i64 and installed with the private jit_install syscall
// (docs/guest-jit-runtime-primitive-20260928.md). The generated code keeps
// the used frame locals and the PBL operand stack in wasm locals, guards that
// every used local is Int32 at entry, and leaves the loop at:
//   - a jump out of the region (normal exit, e.g. the loop condition),
//   - an int32 overflow / non-int result, *before* the op (PBL redoes it with
//     exact semantics),
//   - a pending interrupt at the backedge (PBL handles it at the LoopHead).
// Each exit writes back the modified locals and the boxed operand stack, and
// reports the new sp, the pc (relative to the LoopHead) and the IC entry
// index, so the interpreter resumes exactly where PBL itself would be.
// IC indices are static: PBL calls NEXT_IC exactly once per executed JOF_IC
// op on the fast paths used here, and JumpTarget/LoopHead reset it from their
// operand.

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>

#include <atomic>

#ifdef PBLJIT_HOST_TEST
#  include "host-test/mock.h"  // host emitter test (tools/pbl-jit/host-test)
#else
#  include "jit/BaselineFrame.h"
#  include "vm/BytecodeUtil.h"
#  include "vm/JSContext.h"
#  include "vm/JSScript.h"
#  include "vm/Opcodes.h"
#endif

namespace js {
namespace pbljit {

struct Exit {
  uint64_t* sp;
  int32_t pcDelta;
  uint32_t icIndex;
};

namespace {

constexpr long SYS_jit_install = 0x6a490001;
constexpr long SYS_jit_free = 0x6a490002;

constexpr uint32_t kTagInt32 = 0xFFFFFF81u;
constexpr uint32_t kTagBoolean = 0xFFFFFF82u;

constexpr uint32_t kCacheBits = 10;
constexpr uint32_t kCompileHits = 1000;
constexpr uint32_t kMaxBails = 64;
constexpr uint32_t kMaxRegion = 512;
constexpr uint32_t kMaxLocals = 32;
constexpr uint32_t kMaxDepth = 16;
constexpr uint32_t kMaxInstalls = 4000;

enum Kind : int64_t { NoEntry = 0, Normal = 1, Bail = 2, Interrupt = 3 };

struct Entry {
  const jsbytecode* pc;
  uint8_t* bytes;
  uint32_t hits;
  uint32_t fn;
  uint16_t len;
  uint8_t state;  // 0 counting, 1 compiled, 2 rejected
  uint8_t bails;
};

thread_local Entry* tCache;
std::atomic<uint32_t> gInstalls{0};
std::atomic<uint32_t> gCompiles{0};
std::atomic<uint32_t> gRejects{0};
std::atomic<uint32_t> gRuns{0};
std::atomic<uint32_t> gBails{0};
std::atomic<int> gLogBudget{-1};
std::atomic<int> gEnabled{-1};

bool Enabled() {
  int e = gEnabled.load(std::memory_order_relaxed);
  if (e < 0) {
    const char* v = getenv("PBLJIT");
    e = (v && v[0] == '0') ? 0 : 1;
    const char* l = getenv("PBLJIT_LOG");
    gLogBudget.store(l ? atoi(l) : 24, std::memory_order_relaxed);
    gEnabled.store(e, std::memory_order_relaxed);
    if (e) {
      fprintf(stderr, "PBLJIT enabled (threshold=%u)\n", kCompileHits);
    }
  }
  return e != 0;
}

bool TakeLog() { return gLogBudget.fetch_sub(1, std::memory_order_relaxed) > 0; }

// ---- wasm byte emitter ----------------------------------------------------

struct Buf {
  uint8_t* p = nullptr;
  size_t n = 0, cap = 0;
  bool oom = false;
  ~Buf() { free(p); }
  void put(uint8_t v) {
    if (n == cap) {
      size_t ncap = cap ? cap * 2 : 512;
      uint8_t* np = static_cast<uint8_t*>(realloc(p, ncap));
      if (!np) {
        oom = true;
        return;
      }
      p = np;
      cap = ncap;
    }
    p[n++] = v;
  }
  void putn(const void* d, size_t len) {
    for (size_t i = 0; i < len; i++) put(static_cast<const uint8_t*>(d)[i]);
  }
  void uleb(uint32_t v) {
    do {
      uint8_t b = v & 0x7f;
      v >>= 7;
      put(b | (v ? 0x80 : 0));
    } while (v);
  }
  void sleb(int64_t v) {
    for (;;) {
      uint8_t b = v & 0x7f;
      v >>= 7;
      bool done = (v == 0 && !(b & 0x40)) || (v == -1 && (b & 0x40));
      put(b | (done ? 0 : 0x80));
      if (done) return;
    }
  }
  void name(const char* s) {
    uleb(uint32_t(strlen(s)));
    putn(s, strlen(s));
  }
  void section(uint8_t id, Buf& c) {
    put(id);
    uleb(uint32_t(c.n));
    putn(c.p, c.n);
    c.n = 0;
  }
};

// Opcodes.
enum : uint8_t {
  W_UNREACHABLE = 0x00, W_LOOP = 0x03, W_IF = 0x04, W_END = 0x0b,
  W_BR = 0x0c, W_RETURN = 0x0f, W_LGET = 0x20, W_LSET = 0x21, W_LTEE = 0x22,
  W_I64LOAD = 0x29, W_I32STORE = 0x36, W_I64STORE = 0x37, W_I32CONST = 0x41,
  W_I64CONST = 0x42, W_I32EQZ = 0x45, W_I32EQ = 0x46, W_I32NE = 0x47,
  W_I32LTS = 0x48, W_I32GTS = 0x4a, W_I32LES = 0x4c, W_I32GES = 0x4e,
  W_I64NE = 0x52, W_I32ADD = 0x6a, W_I32SUB = 0x6b, W_I32AND = 0x71,
  W_I32OR = 0x72, W_I32XOR = 0x73, W_I32SHL = 0x74, W_I32SHRS = 0x75,
  W_I32SHRU = 0x76, W_I64ADD = 0x7c, W_I64SUB = 0x7d, W_I64MUL = 0x7e,
  W_I64OR = 0x84, W_I64SHRU = 0x88, W_I32WRAP = 0xa7, W_I64EXTS = 0xac,
  W_I64EXTU = 0xad, W_ATOMIC = 0xfe, W_I32ATOMICLOAD = 0x10, W_VOID = 0x40,
};

enum class Ty : uint8_t { Int, Bool };

// Wasm local layout: params 0..22 (i64); then i32 locals; then i64 temps.
constexpr uint32_t P_FRAME = 23, P_SP = 24, P_INTR = 25, P_OUT = 26,
                   L_BASE = 27;

struct Compiler {
  JSScript* script;
  jsbytecode* head;
  jsbytecode* end;  // one past the region's last op
  uint32_t nlocals = 0;
  uint32_t localNo[kMaxLocals];
  bool localWritten[kMaxLocals];
  uint32_t maxDepth = 0;
  uint32_t nops = 0;
  // Abstract stack.
  uint32_t depth = 0;
  Ty ty[kMaxDepth];
  uint32_t icIndex = 0;
  Buf code;
  const char* reason = nullptr;
  jsbytecode* reasonPc = nullptr;

  uint32_t slotLocal(uint32_t i) const { return L_BASE + nlocals + i; }
  uint32_t tmp32() const { return L_BASE + nlocals + kMaxDepth; }
  uint32_t tmp64() const { return L_BASE + nlocals + kMaxDepth + 1; }
  uint32_t jsLocal(uint32_t no) const {
    for (uint32_t i = 0; i < nlocals; i++)
      if (localNo[i] == no) return L_BASE + i;
    MOZ_CRASH("pbljit: unmapped local");
  }

  bool reject(const char* why, jsbytecode* at) {
    if (!reason) {
      reason = why;
      reasonPc = at;
    }
    return false;
  }

  void lget(uint32_t l) { code.put(W_LGET), code.uleb(l); }
  void lset(uint32_t l) { code.put(W_LSET), code.uleb(l); }
  void i32c(int32_t v) { code.put(W_I32CONST), code.sleb(v); }
  void i64c(int64_t v) { code.put(W_I64CONST), code.sleb(v); }

  // addr = base - 8*(k+1); store boxed(value local, tag).
  void storeBoxed(uint32_t base, uint32_t k, uint32_t valueLocal,
                  uint32_t tag) {
    lget(base);
    i32c(int32_t(8 * (k + 1)));
    code.put(W_I32SUB);
    i64c(int64_t(uint64_t(tag) << 32));
    lget(valueLocal);
    code.put(W_I64EXTU);
    code.put(W_I64OR);
    code.put(W_I64STORE), code.uleb(3), code.uleb(0);
  }

  void emitExit(Kind kind, jsbytecode* target, uint32_t ic) {
    for (uint32_t i = 0; i < depth; i++) {
      storeBoxed(P_SP, i, slotLocal(i),
                 ty[i] == Ty::Int ? kTagInt32 : kTagBoolean);
    }
    for (uint32_t i = 0; i < nlocals; i++) {
      if (localWritten[i]) storeBoxed(P_FRAME, localNo[i], L_BASE + i, kTagInt32);
    }
    lget(P_OUT);
    lget(P_SP);
    i32c(int32_t(8 * depth));
    code.put(W_I32SUB);
    code.put(W_I32STORE), code.uleb(2), code.uleb(0);
    lget(P_OUT);
    i32c(int32_t(target - head));
    code.put(W_I32STORE), code.uleb(2), code.uleb(4);
    lget(P_OUT);
    i32c(int32_t(ic));
    code.put(W_I32STORE), code.uleb(2), code.uleb(8);
    i64c(kind);
    code.put(W_RETURN);
  }

  // Inside `loop` at block nesting `nest` (0 = directly in the loop).
  void emitBackedge(uint32_t nest) {
    lget(P_INTR);
    code.put(W_ATOMIC), code.put(W_I32ATOMICLOAD), code.uleb(2), code.uleb(0);
    code.put(W_IF), code.put(W_VOID);
    emitExit(Interrupt, head, headIc);
    code.put(W_END);
    code.put(W_BR), code.uleb(nest);
  }

  uint32_t headIc = 0;

  bool push(Ty t) {
    if (depth >= kMaxDepth) return reject("stack depth", nullptr);
    ty[depth++] = t;
    if (depth > maxDepth) maxDepth = depth;
    return true;
  }

  bool addLocal(uint32_t no) {
    for (uint32_t i = 0; i < nlocals; i++)
      if (localNo[i] == no) return true;
    if (nlocals >= kMaxLocals) return false;
    localWritten[nlocals] = false;
    localNo[nlocals++] = no;
    return true;
  }

  // Pass 1: find the region and its locals.
  bool scan() {
    jsbytecode* codeEnd = script->codeEnd();
    jsbytecode* pc = head + JSOpLength_LoopHead;
    while (pc < codeEnd) {
      if (pc - head > int32_t(kMaxRegion)) return reject("region size", pc);
      JSOp op = JSOp(*pc);
      jsbytecode* next = pc + GetBytecodeLength(pc);
      switch (op) {
        case JSOp::GetLocal:
          if (!addLocal(GET_LOCALNO(pc))) return reject("locals", pc);
          break;
        case JSOp::SetLocal:
        case JSOp::InitLexical:
          // Every exit writes back every local stored anywhere in the loop.
          if (!addLocal(GET_LOCALNO(pc))) return reject("locals", pc);
          localWritten[jsLocal(GET_LOCALNO(pc)) - L_BASE] = true;
          break;
        case JSOp::LoopHead:
          return reject("nested loop", pc);
        case JSOp::Goto:
        case JSOp::JumpIfTrue:
          if (pc + GET_JUMP_OFFSET(pc) == head) {
            end = next;
            return true;
          }
          break;
        default:
          break;
      }
      pc = next;
    }
    return reject("no backedge", pc);
  }

  // Jump target classification inside [head, end).
  enum class Target { Head, Inside, Outside };
  Target classify(jsbytecode* t) const {
    if (t == head) return Target::Head;
    if (t > head && t < end) return Target::Inside;
    return Target::Outside;
  }

  bool binaryInt(jsbytecode* pc, JSOp op) {
    if (depth < 2) return reject("underflow", pc);
    if (ty[depth - 1] != Ty::Int || ty[depth - 2] != Ty::Int)
      return reject("operand type", pc);
    uint32_t lhs = slotLocal(depth - 2), rhs = slotLocal(depth - 1);
    switch (op) {
      case JSOp::Add:
      case JSOp::Sub:
      case JSOp::Mul: {
        lget(lhs), code.put(W_I64EXTS);
        lget(rhs), code.put(W_I64EXTS);
        code.put(op == JSOp::Add ? W_I64ADD
                                 : op == JSOp::Sub ? W_I64SUB : W_I64MUL);
        code.put(W_LTEE), code.uleb(tmp64());
        lget(tmp64()), code.put(W_I32WRAP), code.put(W_I64EXTS);
        code.put(W_I64NE);
        if (op == JSOp::Mul) {
          // -0: product == 0 and exactly one operand negative.
          lget(tmp64()), code.put(W_I32WRAP), code.put(W_I32EQZ);
          lget(lhs), lget(rhs), code.put(W_I32XOR);
          i32c(0), code.put(W_I32LTS);
          code.put(W_I32AND);
          code.put(W_I32OR);
        }
        code.put(W_IF), code.put(W_VOID);
        emitExit(Bail, pc, icIndex);
        code.put(W_END);
        lget(tmp64()), code.put(W_I32WRAP);
        break;
      }
      case JSOp::Ursh:
        lget(lhs), lget(rhs), code.put(W_I32SHRU);
        code.put(W_LTEE), code.uleb(tmp32());
        i32c(0), code.put(W_I32LTS);
        code.put(W_IF), code.put(W_VOID);
        emitExit(Bail, pc, icIndex);
        code.put(W_END);
        lget(tmp32());
        break;
      default: {
        uint8_t w;
        switch (op) {
          case JSOp::BitOr: w = W_I32OR; break;
          case JSOp::BitAnd: w = W_I32AND; break;
          case JSOp::BitXor: w = W_I32XOR; break;
          case JSOp::Lsh: w = W_I32SHL; break;
          case JSOp::Rsh: w = W_I32SHRS; break;
          default: MOZ_CRASH("pbljit binaryInt");
        }
        lget(lhs), lget(rhs), code.put(w);  // wasm shifts mask by 31
        break;
      }
    }
    lset(lhs);
    depth--;
    return true;
  }

  bool compare(jsbytecode* pc, JSOp op) {
    if (depth < 2) return reject("underflow", pc);
    if (ty[depth - 1] != Ty::Int || ty[depth - 2] != Ty::Int)
      return reject("operand type", pc);
    uint32_t lhs = slotLocal(depth - 2), rhs = slotLocal(depth - 1);
    uint8_t w;
    switch (op) {
      case JSOp::Lt: w = W_I32LTS; break;
      case JSOp::Le: w = W_I32LES; break;
      case JSOp::Gt: w = W_I32GTS; break;
      case JSOp::Ge: w = W_I32GES; break;
      case JSOp::Eq:
      case JSOp::StrictEq: w = W_I32EQ; break;
      case JSOp::Ne:
      case JSOp::StrictNe: w = W_I32NE; break;
      default: MOZ_CRASH("pbljit compare");
    }
    lget(lhs), lget(rhs), code.put(w);
    lset(lhs);
    depth--;
    ty[depth - 1] = Ty::Bool;
    return true;
  }

  // Pass 2: translate. Code is inside `loop` (nest 0).
  bool translate() {
    headIc = uint32_t(GET_INT32(head));
    icIndex = headIc;
    jsbytecode* pc = head + JSOpLength_LoopHead;
    while (pc < end) {
      JSOp op = JSOp(*pc);
      jsbytecode* next = pc + GetBytecodeLength(pc);
      nops++;
      switch (op) {
        case JSOp::Nop:
          break;
        case JSOp::JumpTarget:
          icIndex = uint32_t(GET_INT32(pc));
          break;
        case JSOp::Zero:
        case JSOp::One:
        case JSOp::Int8:
        case JSOp::Uint16:
        case JSOp::Uint24:
        case JSOp::Int32: {
          int32_t v = op == JSOp::Zero    ? 0
                      : op == JSOp::One   ? 1
                      : op == JSOp::Int8  ? GET_INT8(pc)
                      : op == JSOp::Uint16 ? int32_t(GET_UINT16(pc))
                      : op == JSOp::Uint24 ? int32_t(GET_UINT24(pc))
                                           : GET_INT32(pc);
          if (!push(Ty::Int)) return false;
          i32c(v), lset(slotLocal(depth - 1));
          break;
        }
        case JSOp::True:
        case JSOp::False:
          if (!push(Ty::Bool)) return false;
          i32c(op == JSOp::True ? 1 : 0), lset(slotLocal(depth - 1));
          break;
        case JSOp::GetLocal:
          if (!push(Ty::Int)) return false;
          lget(jsLocal(GET_LOCALNO(pc))), lset(slotLocal(depth - 1));
          break;
        case JSOp::SetLocal:
        case JSOp::InitLexical: {
          if (depth < 1) return reject("underflow", pc);
          if (ty[depth - 1] != Ty::Int) return reject("non-int local", pc);
          uint32_t l = jsLocal(GET_LOCALNO(pc));
          lget(slotLocal(depth - 1)), lset(l);
          break;
        }
        case JSOp::CheckLexical:
          // Stack values here are Int32/Boolean, never the TDZ magic.
          if (depth < 1) return reject("underflow", pc);
          break;
        case JSOp::Pop:
          if (depth < 1) return reject("underflow", pc);
          depth--;
          break;
        case JSOp::Dup:
          if (depth < 1) return reject("underflow", pc);
          if (!push(ty[depth - 1])) return false;
          lget(slotLocal(depth - 2)), lset(slotLocal(depth - 1));
          break;
        case JSOp::Swap: {
          if (depth < 2) return reject("underflow", pc);
          uint32_t a = slotLocal(depth - 2), b = slotLocal(depth - 1);
          lget(a), lset(tmp32()), lget(b), lset(a), lget(tmp32()), lset(b);
          Ty t = ty[depth - 2];
          ty[depth - 2] = ty[depth - 1];
          ty[depth - 1] = t;
          break;
        }
        case JSOp::Add:
        case JSOp::Sub:
        case JSOp::Mul:
        case JSOp::BitOr:
        case JSOp::BitAnd:
        case JSOp::BitXor:
        case JSOp::Lsh:
        case JSOp::Rsh:
        case JSOp::Ursh:
          if (!binaryInt(pc, op)) return false;
          icIndex++;
          break;
        case JSOp::Lt:
        case JSOp::Le:
        case JSOp::Gt:
        case JSOp::Ge:
        case JSOp::Eq:
        case JSOp::Ne:
        case JSOp::StrictEq:
        case JSOp::StrictNe:
          if (!compare(pc, op)) return false;
          icIndex++;
          break;
        case JSOp::Inc:
        case JSOp::Dec: {
          if (depth < 1) return reject("underflow", pc);
          if (ty[depth - 1] != Ty::Int) return reject("operand type", pc);
          uint32_t s = slotLocal(depth - 1);
          lget(s), i32c(op == JSOp::Inc ? INT32_MAX : INT32_MIN);
          code.put(W_I32EQ);
          code.put(W_IF), code.put(W_VOID);
          emitExit(Bail, pc, icIndex);
          code.put(W_END);
          lget(s), i32c(1), code.put(op == JSOp::Inc ? W_I32ADD : W_I32SUB);
          lset(s);
          icIndex++;
          break;
        }
        case JSOp::ToNumeric:
          if (depth < 1) return reject("underflow", pc);
          if (ty[depth - 1] != Ty::Int) return reject("operand type", pc);
          icIndex++;
          break;
        case JSOp::Not: {
          if (depth < 1) return reject("underflow", pc);
          uint32_t s = slotLocal(depth - 1);
          lget(s), code.put(W_I32EQZ), lset(s);
          ty[depth - 1] = Ty::Bool;
          icIndex++;
          break;
        }
        case JSOp::JumpIfFalse:
        case JSOp::JumpIfTrue: {
          if (depth < 1) return reject("underflow", pc);
          jsbytecode* target = pc + GET_JUMP_OFFSET(pc);
          Target k = classify(target);
          if (k == Target::Inside) return reject("internal jump", pc);
          uint32_t s = slotLocal(depth - 1);
          depth--;
          icIndex++;
          lget(s);
          if (op == JSOp::JumpIfFalse) code.put(W_I32EQZ);
          code.put(W_IF), code.put(W_VOID);
          if (k == Target::Head) {
            if (depth != 0) return reject("backedge depth", pc);
            emitBackedge(1);
          } else {
            emitExit(Normal, target, icIndex);
          }
          code.put(W_END);
          if (k == Target::Head && next == end) {
            // Fallthrough of a conditional backedge leaves the loop.
            emitExit(Normal, next, icIndex);
          }
          break;
        }
        case JSOp::Goto: {
          jsbytecode* target = pc + GET_JUMP_OFFSET(pc);
          Target k = classify(target);
          if (k == Target::Inside) return reject("internal jump", pc);
          if (k == Target::Head) {
            if (depth != 0) return reject("backedge depth", pc);
            emitBackedge(0);
          } else {
            emitExit(Normal, target, icIndex);
          }
          if (next != end) return reject("goto mid-region", pc);
          break;
        }
        default:
          return reject(CodeName(op), pc);
      }
      if (code.oom) return reject("oom", pc);
      pc = next;
    }
    return true;
  }

  // Assemble the module; returns false on reject.
  bool assemble(Buf& m) {
    Buf body;
    // Locals: (nlocals + kMaxDepth + 1) i32, 1 i64.
    body.uleb(2);
    body.uleb(4 + nlocals + kMaxDepth + 1), body.put(0x7f);
    body.uleb(1), body.put(0x7e);
    auto lget2 = [&](uint32_t l) { body.put(W_LGET), body.uleb(l); };
    auto lset2 = [&](uint32_t l) { body.put(W_LSET), body.uleb(l); };
    for (uint32_t i = 0; i < 4; i++) {
      lget2(i), body.put(W_I32WRAP), lset2(P_FRAME + i);
    }
    // Entry guards and local loads.
    for (uint32_t i = 0; i < nlocals; i++) {
      lget2(P_FRAME), body.put(W_I32CONST), body.sleb(8 * (int64_t(localNo[i]) + 1));
      body.put(W_I32SUB);
      body.put(W_I64LOAD), body.uleb(3), body.uleb(0);
      body.put(W_LTEE), body.uleb(tmp64());
      body.put(W_I64CONST), body.sleb(32), body.put(W_I64SHRU);
      body.put(W_I32WRAP);
      body.put(W_I32CONST), body.sleb(int32_t(kTagInt32));
      body.put(W_I32NE);
      body.put(W_IF), body.put(W_VOID);
      body.put(W_I64CONST), body.sleb(NoEntry), body.put(W_RETURN);
      body.put(W_END);
      lget2(tmp64()), body.put(W_I32WRAP), lset2(L_BASE + i);
    }
    body.put(W_LOOP), body.put(W_VOID);
    body.putn(code.p, code.n);
    body.put(W_END);
    body.put(W_UNREACHABLE);
    body.put(W_END);
    if (body.oom) return reject("oom", head);

    static const uint8_t header[] = {0, 'a', 's', 'm', 1, 0, 0, 0};
    m.putn(header, sizeof header);
    Buf c;
    c.uleb(1), c.put(0x60), c.uleb(23);
    for (int i = 0; i < 23; i++) c.put(0x7e);
    c.uleb(1), c.put(0x7e);
    m.section(1, c);
    c.uleb(2);
    c.name("env"), c.name("table"), c.put(0x01), c.put(0x70), c.put(0x00),
        c.uleb(0);
    c.name("env"), c.name("memory"), c.put(0x02), c.put(0x03), c.uleb(1),
        c.uleb(65536);
    m.section(2, c);
    c.uleb(1), c.uleb(0);
    m.section(3, c);
    c.uleb(1), c.name("f0"), c.put(0), c.uleb(0);
    m.section(7, c);
    c.uleb(1), c.uleb(uint32_t(body.n)), c.putn(body.p, body.n);
    m.section(10, c);
    if (m.oom || c.oom) return reject("oom", head);
    return true;
  }
};

void LogReject(JSScript* script, const Compiler& c) {
  gRejects.fetch_add(1, std::memory_order_relaxed);
  if (!TakeLog()) return;
  jsbytecode* at = c.reasonPc ? c.reasonPc : c.head;
  fprintf(stderr, "PBLJIT reject %s:%u off=%u at=%u op=%s reason=%s\n",
          script->filename() ? script->filename() : "?", script->lineno(),
          unsigned(c.head - script->code()), unsigned(at - script->code()),
          at < script->codeEnd() ? CodeName(JSOp(*at)) : "-",
          c.reason ? c.reason : "?");
}

void Evict(Entry* e) {
  if (e->fn) {
    syscall(SYS_jit_free, long(e->fn), 1L);
  }
  free(e->bytes);
  memset(e, 0, sizeof *e);
}

bool Compile(JSScript* script, jsbytecode* pc, Entry* e) {
  if (gInstalls.load(std::memory_order_relaxed) >= kMaxInstalls) return false;
  Compiler c;
  c.script = script;
  c.head = pc;
  c.end = nullptr;
  bool ok = c.scan() && c.translate();
  Buf m;
  if (ok) ok = c.assemble(m);
  if (!ok) {
    LogReject(script, c);
    return false;
  }
  uint32_t idx[1] = {0};
  long rc = syscall(SYS_jit_install, long(uintptr_t(m.p)), long(m.n), 0L,
                    long(uintptr_t(idx)));
  if (rc != 0 || !idx[0]) {
    c.reason = "install failed";
    LogReject(script, c);
    if (TakeLog()) fprintf(stderr, "PBLJIT install rc=%ld bytes=%zu\n", rc, m.n);
    return false;
  }
  size_t len = size_t(c.end - pc);
  e->bytes = static_cast<uint8_t*>(malloc(len));
  if (!e->bytes) {
    syscall(SYS_jit_free, long(idx[0]), 1L);
    return false;
  }
  memcpy(e->bytes, pc, len);
  e->len = uint16_t(len);
  e->fn = idx[0];
  gInstalls.fetch_add(1, std::memory_order_relaxed);
  uint32_t n = gCompiles.fetch_add(1, std::memory_order_relaxed) + 1;
  if (TakeLog()) {
    fprintf(stderr,
            "PBLJIT compile #%u %s:%u off=%u len=%zu ops=%u locals=%u depth=%u "
            "wasm=%zu idx=%u\n",
            n, script->filename() ? script->filename() : "?", script->lineno(),
            unsigned(pc - script->code()), len, c.nops, c.nlocals, c.maxDepth,
            m.n, idx[0]);
  }
  if ((n & (n - 1)) == 0) {
    fprintf(stderr,
            "PBLJIT stats compiles=%u rejects=%u runs=%u bails=%u\n", n,
            gRejects.load(std::memory_order_relaxed),
            gRuns.load(std::memory_order_relaxed),
            gBails.load(std::memory_order_relaxed));
  }
  return true;
}

}  // namespace

typedef int64_t (*JitFn)(void* frame, void* sp, void* intr, void* out);

bool OnLoopHead(JSScript* script, jit::BaselineFrame* frame, uint64_t* sp,
                jsbytecode* pc, JSContext* cx, Exit* exit) {
  Entry* cache = tCache;
  if (MOZ_UNLIKELY(!cache)) {
    if (!Enabled()) return false;
    cache = static_cast<Entry*>(calloc(size_t(1) << kCacheBits, sizeof(Entry)));
    if (!cache) return false;
    tCache = cache;
  }
  uint32_t h = (uint32_t(uintptr_t(pc)) * 2654435761u) >> (32 - kCacheBits);
  Entry* e = &cache[h];
  if (MOZ_UNLIKELY(e->pc != pc)) {
    Evict(e);
    e->pc = pc;
  }
  if (e->state != 1) {
    if (e->state == 2 || ++e->hits < kCompileHits) return false;
    e->state = Compile(script, pc, e) ? 1 : 2;
    if (e->state != 1) return false;
  }
  // Same pc pointer, possibly a different (re-allocated) script: compare.
  if (MOZ_UNLIKELY(pc + e->len > script->codeEnd() ||
                   memcmp(pc, e->bytes, e->len) != 0)) {
    Evict(e);
    e->pc = pc;
    return false;
  }
  struct {
    uint32_t sp;
    int32_t pcDelta;
    uint32_t icIndex;
  } out;
  int64_t kind = reinterpret_cast<JitFn>(uintptr_t(e->fn))(
      frame, sp, cx->addressOfInterruptBits(), &out);
  if (kind == NoEntry || kind == Bail) {
    gBails.fetch_add(1, std::memory_order_relaxed);
    if (++e->bails >= kMaxBails) {
      syscall(SYS_jit_free, long(e->fn), 1L);
      e->fn = 0;
      e->state = 2;
      if (TakeLog()) {
        fprintf(stderr, "PBLJIT disable %s:%u off=%u after %u bails\n",
                script->filename() ? script->filename() : "?",
                script->lineno(), unsigned(pc - script->code()), kMaxBails);
      }
    }
    if (kind == NoEntry) return false;
  }
  gRuns.fetch_add(1, std::memory_order_relaxed);
  exit->sp = reinterpret_cast<uint64_t*>(uintptr_t(out.sp));
  exit->pcDelta = out.pcDelta;
  exit->icIndex = out.icIndex;
  return true;
}

}  // namespace pbljit
}  // namespace js
