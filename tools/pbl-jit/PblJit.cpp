/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
// Guest JIT packets 4 and 6: runtime PBL-to-wasm loop specializer (adapter
// source).
//
// Compiled with the same command as PortableBaselineInterpret.cpp and linked
// beside a copy of it whose CASE(LoopHead) calls pbljit::OnLoopHead (see
// tools/build-firefox-pbl-jit.py). Upstream SpiderMonkey files are unchanged.
//
// A hot innermost loop (LoopHead .. the last Goto/JumpIfTrue back to it, with
// no nested loop) whose ops are all in the subset below is translated into one
// wasm function (23 x i64) -> i64 and installed with the private jit_install
// syscall (docs/guest-jit-runtime-primitive-20260928.md). Values have static
// types (Int32, Boolean, undefined, null, the TDZ magic); frame locals and
// unaliased formal arguments ("vars") and the PBL operand stack live in wasm
// locals. Forward jumps inside the body (if/else, &&, ||, ??, continue) become
// nested wasm blocks; their joins must agree on all types. Vars read before
// being written in an iteration are type-guarded at entry and must keep that
// type around the loop; the others are reloaded from the frame each
// iteration. The code leaves the loop at:
//   - a jump out of the region (normal exit, e.g. the loop condition),
//   - an int32 overflow / non-int result, *before* the op (PBL redoes it with
//     exact semantics),
//   - a pending interrupt at the backedge (PBL handles it at the LoopHead).
// Each exit writes back the modified vars and the boxed operand stack, and
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

constexpr uint32_t kCacheBits = 10;
constexpr uint32_t kCompileHits = 1000;
constexpr uint32_t kMaxBails = 64;
constexpr uint32_t kMaxRegion = 512;
constexpr uint32_t kMaxVars = 32;  // locals + arguments
constexpr uint32_t kMaxTargets = 32;
constexpr uint32_t kMaxDepth = 16;
constexpr uint32_t kMaxInstalls = 4000;

enum Kind : int64_t { NoEntry = 0, Normal = 1, Bail = 2, Interrupt = 3 };

struct Entry {
  const jsbytecode* pc;
  uint8_t* bytes;
  uint32_t hits;
  uint32_t fn;
  uint16_t len;
  uint16_t nargs;  // arguments the code reads or writes (argv slots)
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
  W_UNREACHABLE = 0x00, W_BLOCK = 0x02, W_LOOP = 0x03, W_IF = 0x04, W_END = 0x0b,
  W_BR = 0x0c, W_BRIF = 0x0d, W_RETURN = 0x0f, W_LGET = 0x20, W_LSET = 0x21, W_LTEE = 0x22,
  W_I64LOAD = 0x29, W_I32STORE = 0x36, W_I64STORE = 0x37, W_I32CONST = 0x41,
  W_I64CONST = 0x42, W_I32EQZ = 0x45, W_I32EQ = 0x46, W_I32NE = 0x47,
  W_I32LTS = 0x48, W_I32GTS = 0x4a, W_I32LES = 0x4c, W_I32GES = 0x4e,
  W_I64NE = 0x52, W_I32ADD = 0x6a, W_I32SUB = 0x6b, W_I32REMS = 0x6f, W_I32AND = 0x71,
  W_I32OR = 0x72, W_I32XOR = 0x73, W_I32SHL = 0x74, W_I32SHRS = 0x75,
  W_I32SHRU = 0x76, W_I64ADD = 0x7c, W_I64SUB = 0x7d, W_I64MUL = 0x7e,
  W_I64OR = 0x84, W_I64SHRU = 0x88, W_I32WRAP = 0xa7, W_I64EXTS = 0xac,
  W_I64EXTU = 0xad, W_ATOMIC = 0xfe, W_I32ATOMICLOAD = 0x10, W_VOID = 0x40,
};

// Value types of stack slots and frame variables. The numbering is
// JSValueType's, so a type's NUNBOX32 tag is 0xFFFFFF80 | type. Head marks a
// head-dead variable that still holds the value its frame slot had at the
// loop head (no wasm copy exists yet in this iteration).
enum class Ty : uint8_t { Head = 0, Int, Bool, Undef, Null, Magic, Unknown };
constexpr uint32_t TagOf(Ty t) { return 0xFFFFFF80u | uint32_t(t); }
#ifndef PBLJIT_HOST_TEST
static_assert(TagOf(Ty::Int) == uint32_t(JSVAL_TAG_INT32));
static_assert(TagOf(Ty::Bool) == uint32_t(JSVAL_TAG_BOOLEAN));
static_assert(TagOf(Ty::Undef) == uint32_t(JSVAL_TAG_UNDEFINED));
static_assert(TagOf(Ty::Null) == uint32_t(JSVAL_TAG_NULL));
static_assert(TagOf(Ty::Magic) == uint32_t(JSVAL_TAG_MAGIC));
#endif
Ty TyOfTag(uint32_t tag) {
  uint32_t t = tag ^ 0xFFFFFF80u;
  return (t >= 1 && t <= 4) ? Ty(t) : Ty::Unknown;
}

// Wasm local layout: params 0..22 (i64); i32 locals frame, sp, interrupt
// bits, out, argv; the frame variables; the operand stack; one i32 and one
// i64 temporary.
constexpr uint32_t P_FRAME = 23, P_SP = 24, P_INTR = 25, P_OUT = 26,
                   P_ARGV = 27, L_BASE = 28, kParams = 5;
constexpr uint32_t kArgKey = 0x80000000u;

// Abstract state at one program point.
struct State {
  bool live = false;
  uint32_t depth = 0;
  Ty stack[kMaxDepth];
  Ty var[kMaxVars];
};

struct Compiler {
  JSScript* script;
  jsbytecode* head;
  jsbytecode* end;  // one past the region's last op
  // Compile-time view of the frame. It only chooses the guarded type of each
  // head-live variable; the entry guards check it on every call.
  const uint8_t* frame = nullptr;
  const uint64_t* argv = nullptr;
  uint32_t nformals = 0;
  bool argsAliased = false;

  // Frame variables (locals, and arguments with kArgKey set).
  uint32_t nvars = 0;
  uint32_t varKey[kMaxVars];
  bool varWritten[kMaxVars];
  bool varLive[kMaxVars];  // read before written on some path from the head
  Ty headTy[kMaxVars];
  uint32_t maxArg = 0;  // 1 + highest argument index used
  // Forward jump targets inside the region, ascending. Each one is the end
  // of a wasm block opened at the top of the loop body (innermost first).
  uint32_t ntargets = 0;
  jsbytecode* targetPc[kMaxTargets];
  State targetSt[kMaxTargets];
  uint32_t firstOpen = 0;  // first target not yet reached
  State st;
  uint32_t maxDepth = 0, nops = 0, icIndex = 0, headIc = 0;
  Buf code;
  const char* reason = nullptr;
  jsbytecode* reasonPc = nullptr;

  uint32_t varLocal(uint32_t v) const { return L_BASE + v; }
  uint32_t slotLocal(uint32_t i) const { return L_BASE + nvars + i; }
  uint32_t tmp32() const { return L_BASE + nvars + kMaxDepth; }
  uint32_t tmp64() const { return L_BASE + nvars + kMaxDepth + 1; }

  bool reject(const char* why, jsbytecode* at) {
    if (!reason) {
      reason = why;
      reasonPc = at;
    }
    return false;
  }

  static bool isArgOp(JSOp op) { return op == JSOp::GetArg || op == JSOp::SetArg; }
  static uint32_t keyOf(jsbytecode* pc) {
    return isArgOp(JSOp(*pc)) ? (kArgKey | GET_ARGNO(pc)) : GET_LOCALNO(pc);
  }
  int findVar(uint32_t key) const {
    for (uint32_t i = 0; i < nvars; i++)
      if (varKey[i] == key) return int(i);
    return -1;
  }
  int findTarget(const jsbytecode* t) const {
    for (uint32_t i = 0; i < ntargets; i++)
      if (targetPc[i] == t) return int(i);
    return -1;
  }
  static bool isJump(JSOp op) {
    return op == JSOp::Goto || op == JSOp::JumpIfFalse ||
           op == JSOp::JumpIfTrue || op == JSOp::And || op == JSOp::Or ||
           op == JSOp::Coalesce;
  }

  void lget(uint32_t l) { code.put(W_LGET), code.uleb(l); }
  void lset(uint32_t l) { code.put(W_LSET), code.uleb(l); }
  void i32c(int32_t v) { code.put(W_I32CONST), code.sleb(v); }
  void i64c(int64_t v) { code.put(W_I64CONST), code.sleb(v); }

  void varAddr(uint32_t v) {
    uint32_t key = varKey[v];
    if (key & kArgKey) {
      lget(P_ARGV), i32c(int32_t(8 * (key & ~kArgKey))), code.put(W_I32ADD);
    } else {
      lget(P_FRAME), i32c(int32_t(8 * (key + 1))), code.put(W_I32SUB);
    }
  }
  void slotAddr(uint32_t i) {
    lget(P_SP), i32c(int32_t(8 * (i + 1))), code.put(W_I32SUB);
  }
  // [addr] -> []: store the boxed value of `valueLocal` with type `t`.
  void boxStore(uint32_t valueLocal, Ty t) {
    i64c(int64_t(uint64_t(TagOf(t)) << 32));
    lget(valueLocal);
    code.put(W_I64EXTU);
    code.put(W_I64OR);
    code.put(W_I64STORE), code.uleb(3), code.uleb(0);
  }

  // Write back the current state and return to the interpreter at `target`.
  void emitExit(Kind kind, jsbytecode* target, uint32_t ic) {
    for (uint32_t i = 0; i < st.depth; i++) {
      slotAddr(i);
      boxStore(slotLocal(i), st.stack[i]);
    }
    for (uint32_t v = 0; v < nvars; v++) {
      Ty t = st.var[v];
      if (t == Ty::Head) continue;                    // frame already current
      if (varLive[v] && !varWritten[v]) continue;     // never changed
      varAddr(v);
      boxStore(varLocal(v), t);
    }
    lget(P_OUT);
    lget(P_SP);
    i32c(int32_t(8 * st.depth));
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

  // Head-live variables stay in wasm locals with their head type across the
  // backedge; head-dead ones are stored to the frame so the next iteration
  // starts with them in the Head state again.
  bool checkBackedge(jsbytecode* pc) {
    if (st.depth != 0) return reject("backedge depth", pc);
    for (uint32_t v = 0; v < nvars; v++)
      if (varLive[v] && st.var[v] != headTy[v]) return reject("backedge type", pc);
    return true;
  }
  // `nest` = enclosing structured blocks between here and the `loop`.
  void emitBackedge(uint32_t nest) {
    lget(P_INTR);
    code.put(W_ATOMIC), code.put(W_I32ATOMICLOAD), code.uleb(2), code.uleb(0);
    code.put(W_IF), code.put(W_VOID);
    emitExit(Interrupt, head, headIc);
    code.put(W_END);
    for (uint32_t v = 0; v < nvars; v++) {
      if (!varLive[v] && st.var[v] != Ty::Head) {
        varAddr(v);
        boxStore(varLocal(v), st.var[v]);
      }
    }
    code.put(W_BR), code.uleb(nest);
  }

  bool push(Ty t, jsbytecode* pc) {
    if (st.depth >= kMaxDepth) return reject("stack depth", pc);
    st.stack[st.depth++] = t;
    if (st.depth > maxDepth) maxDepth = st.depth;
    return true;
  }

  // Record the state flowing along an edge to inside target j.
  bool edge(uint32_t j, jsbytecode* pc) {
    State& t = targetSt[j];
    if (!t.live) {
      t = st;
      return true;
    }
    if (t.depth != st.depth) return reject("join depth", pc);
    if (memcmp(t.stack, st.stack, st.depth) || memcmp(t.var, st.var, nvars))
      return reject("join type", pc);
    return true;
  }

  // Pass 1: find the region (up to the last backedge before any nested
  // loop), its frame variables and its forward jump targets.
  bool scan() {
    jsbytecode* body = head + JSOpLength_LoopHead;
    jsbytecode* limit = script->codeEnd();
    if (limit - head > int32_t(kMaxRegion)) limit = head + kMaxRegion;
    end = nullptr;
    const char* stop = "region size";
    for (jsbytecode* pc = body; pc < limit;) {
      JSOp op = JSOp(*pc);
      if (op == JSOp::LoopHead) {
        stop = "nested loop";
        break;
      }
      jsbytecode* next = pc + GetBytecodeLength(pc);
      if ((op == JSOp::Goto || op == JSOp::JumpIfTrue) &&
          pc + GET_JUMP_OFFSET(pc) == head)
        end = next;
      if (next > limit) break;
      pc = next;
    }
    if (!end) return reject(stop, body);
    for (jsbytecode* pc = body; pc < end; pc += GetBytecodeLength(pc)) {
      JSOp op = JSOp(*pc);
      switch (op) {
        case JSOp::GetArg:
        case JSOp::SetArg:
          if (!argv || argsAliased) return reject("arguments", pc);
          if (GET_ARGNO(pc) >= nformals) return reject("argument index", pc);
          if (GET_ARGNO(pc) + 1 > maxArg) maxArg = GET_ARGNO(pc) + 1;
          [[fallthrough]];
        case JSOp::GetLocal:
        case JSOp::SetLocal:
        case JSOp::InitLexical: {
          uint32_t key = keyOf(pc);
          int v = findVar(key);
          if (v < 0) {
            if (nvars >= kMaxVars) return reject("locals", pc);
            v = int(nvars++);
            varKey[v] = key;
            varWritten[v] = varLive[v] = false;
          }
          if (op != JSOp::GetLocal && op != JSOp::GetArg) varWritten[v] = true;
          break;
        }
        default:
          if (isJump(op)) {
            jsbytecode* t = pc + GET_JUMP_OFFSET(pc);
            if (t == head || t < head || t >= end) break;  // backedge / exit
            if (t <= pc) return reject("backward jump", pc);
            if (findTarget(t) >= 0) break;
            if (ntargets >= kMaxTargets) return reject("targets", pc);
            uint32_t i = ntargets++;
            while (i > 0 && targetPc[i - 1] > t) {
              targetPc[i] = targetPc[i - 1];
              i--;
            }
            targetPc[i] = t;
          }
          break;
      }
    }
    return true;
  }

  // Pass 2: which variables are read before being written on some path from
  // the head (the region is a DAG apart from the backedge).
  bool liveness() {
    uint32_t defw = 0;
    bool live = true;
    uint32_t tdef[kMaxTargets];
    bool tlive[kMaxTargets] = {};
    uint32_t nextT = 0;
    auto jumpTo = [&](jsbytecode* t) {
      int j = findTarget(t);
      if (j < 0) return;
      tdef[j] = tlive[j] ? (tdef[j] & defw) : defw;
      tlive[j] = true;
    };
    for (jsbytecode* pc = head + JSOpLength_LoopHead; pc < end;
         pc += GetBytecodeLength(pc)) {
      if (nextT < ntargets && targetPc[nextT] == pc) {
        if (tlive[nextT]) defw = live ? (defw & tdef[nextT]) : tdef[nextT];
        live = live || tlive[nextT];
        nextT++;
      }
      if (!live) continue;
      JSOp op = JSOp(*pc);
      switch (op) {
        case JSOp::GetLocal:
        case JSOp::GetArg: {
          int v = findVar(keyOf(pc));
          if (!(defw & (1u << v))) varLive[v] = true;
          break;
        }
        case JSOp::SetLocal:
        case JSOp::InitLexical:
        case JSOp::SetArg:
          defw |= 1u << findVar(keyOf(pc));
          break;
        default:
          if (isJump(op)) {
            jumpTo(pc + GET_JUMP_OFFSET(pc));
            if (op == JSOp::Goto) live = false;
          }
          break;
      }
    }
    // Speculate each head-live variable keeps the type it has right now.
    for (uint32_t v = 0; v < nvars; v++) {
      headTy[v] = Ty::Head;
      if (!varLive[v]) continue;
      uint32_t key = varKey[v];
      uint64_t bits;
      if (key & kArgKey) {
        bits = argv[key & ~kArgKey];
      } else {
        memcpy(&bits, frame - 8 * (size_t(key) + 1), 8);
      }
      headTy[v] = TyOfTag(uint32_t(bits >> 32));
      if (headTy[v] == Ty::Unknown) return reject("head type", head);
    }
    return true;
  }

  bool binaryInt(jsbytecode* pc, JSOp op) {
    if (st.depth < 2) return reject("underflow", pc);
    if (st.stack[st.depth - 1] != Ty::Int || st.stack[st.depth - 2] != Ty::Int)
      return reject("operand type", pc);
    uint32_t lhs = slotLocal(st.depth - 2), rhs = slotLocal(st.depth - 1);
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
      case JSOp::Mod:
        // Int32 result with the sign of a non-negative lhs; PBL handles the
        // rest (negative zero, division by zero, negative operands).
        lget(lhs), i32c(0), code.put(W_I32LTS);
        lget(rhs), i32c(0), code.put(W_I32LES);
        code.put(W_I32OR);
        code.put(W_IF), code.put(W_VOID);
        emitExit(Bail, pc, icIndex);
        code.put(W_END);
        lget(lhs), lget(rhs), code.put(W_I32REMS);
        break;
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
    st.depth--;
    return true;
  }

  bool compare(jsbytecode* pc, JSOp op) {
    if (st.depth < 2) return reject("underflow", pc);
    Ty a = st.stack[st.depth - 2], b = st.stack[st.depth - 1];
    bool equality = op == JSOp::Eq || op == JSOp::Ne ||
                    op == JSOp::StrictEq || op == JSOp::StrictNe;
    if (!(a == Ty::Int && b == Ty::Int) &&
        !(equality && a == Ty::Bool && b == Ty::Bool))
      return reject("operand type", pc);
    uint32_t lhs = slotLocal(st.depth - 2), rhs = slotLocal(st.depth - 1);
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
    st.depth--;
    st.stack[st.depth - 1] = Ty::Bool;
    return true;
  }

  // Push ToBoolean(slot) as an i32.
  bool truthy(uint32_t slot, Ty t, jsbytecode* pc) {
    switch (t) {
      case Ty::Int:
      case Ty::Bool: lget(slotLocal(slot)); return true;
      case Ty::Undef:
      case Ty::Null: i32c(0); return true;
      default: return reject("operand type", pc);
    }
  }

  // A jump to `target`; with `cond` the i32 condition is on the wasm stack.
  bool branch(jsbytecode* pc, jsbytecode* target, jsbytecode* next, bool cond) {
    uint32_t open = ntargets - firstOpen;
    if (target == head) {
      if (!checkBackedge(pc)) return false;
      if (cond) {
        code.put(W_IF), code.put(W_VOID);
        emitBackedge(open + 1);
        code.put(W_END);
        if (next == end) {
          // Fallthrough of the final conditional backedge leaves the loop.
          emitExit(Normal, next, icIndex);
          st.live = false;
        }
      } else {
        emitBackedge(open);
        st.live = false;
      }
      return true;
    }
    int j = findTarget(target);
    if (j >= 0) {
      if (uint32_t(j) < firstOpen) return reject("backward jump", pc);
      if (!edge(uint32_t(j), pc)) return false;
      code.put(cond ? W_BRIF : W_BR), code.uleb(uint32_t(j) - firstOpen);
      if (!cond) st.live = false;
      return true;
    }
    if (cond) code.put(W_IF), code.put(W_VOID);
    emitExit(Normal, target, icIndex);
    if (cond) {
      code.put(W_END);
    } else {
      st.live = false;
    }
    return true;
  }

  bool unaryInt(jsbytecode* pc) {
    if (st.depth < 1) return reject("underflow", pc);
    if (st.stack[st.depth - 1] != Ty::Int) return reject("operand type", pc);
    return true;
  }

  // Pass 3: translate. Emits the entry guards, then the `loop` with one
  // `block` per forward target.
  bool translate() {
    for (uint32_t i = 0; i < kParams; i++) {
      lget(i), code.put(W_I32WRAP), lset(P_FRAME + i);
    }
    st = State();
    st.live = true;
    for (uint32_t v = 0; v < nvars; v++) {
      st.var[v] = headTy[v];
      if (!varLive[v]) continue;
      varAddr(v);
      code.put(W_I64LOAD), code.uleb(3), code.uleb(0);
      code.put(W_LTEE), code.uleb(tmp64());
      i64c(32), code.put(W_I64SHRU), code.put(W_I32WRAP);
      i32c(int32_t(TagOf(headTy[v]))), code.put(W_I32NE);
      code.put(W_IF), code.put(W_VOID);
      i64c(NoEntry), code.put(W_RETURN);
      code.put(W_END);
      lget(tmp64()), code.put(W_I32WRAP), lset(varLocal(v));
    }
    code.put(W_LOOP), code.put(W_VOID);
    for (uint32_t j = 0; j < ntargets; j++) code.put(W_BLOCK), code.put(W_VOID);

    headIc = uint32_t(GET_INT32(head));
    icIndex = headIc;
    jsbytecode* pc = head + JSOpLength_LoopHead;
    while (pc < end) {
      if (firstOpen < ntargets && targetPc[firstOpen] <= pc) {
        if (targetPc[firstOpen] != pc) return reject("jump target", pc);
        code.put(W_END);
        if (st.live && !edge(firstOpen, pc)) return false;
        st = targetSt[firstOpen++];
      }
      JSOp op = JSOp(*pc);
      jsbytecode* next = pc + GetBytecodeLength(pc);
      if (!st.live) {  // unreachable from the head
        pc = next;
        continue;
      }
      nops++;
      uint32_t top = st.depth - 1;
      switch (op) {
        case JSOp::Nop:
          break;
        case JSOp::DebugLeaveLexicalEnv:  // no-op: OnLoopHead excludes debuggee frames
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
          if (!push(Ty::Int, pc)) return false;
          i32c(v), lset(slotLocal(st.depth - 1));
          break;
        }
        case JSOp::True:
        case JSOp::False:
          if (!push(Ty::Bool, pc)) return false;
          i32c(op == JSOp::True ? 1 : 0), lset(slotLocal(st.depth - 1));
          break;
        case JSOp::Undefined:
        case JSOp::Null:
          if (!push(op == JSOp::Null ? Ty::Null : Ty::Undef, pc)) return false;
          i32c(0), lset(slotLocal(st.depth - 1));
          break;
        case JSOp::Uninitialized:
          if (!push(Ty::Magic, pc)) return false;
          i32c(JS_UNINITIALIZED_LEXICAL), lset(slotLocal(st.depth - 1));
          break;
        case JSOp::GetLocal:
        case JSOp::GetArg: {
          uint32_t v = uint32_t(findVar(keyOf(pc)));
          if (st.var[v] == Ty::Head) return reject("head read", pc);
          if (!push(st.var[v], pc)) return false;
          lget(varLocal(v)), lset(slotLocal(st.depth - 1));
          break;
        }
        case JSOp::SetLocal:
        case JSOp::InitLexical:
        case JSOp::SetArg: {
          if (st.depth < 1) return reject("underflow", pc);
          uint32_t v = uint32_t(findVar(keyOf(pc)));
          st.var[v] = st.stack[top];
          lget(slotLocal(top)), lset(varLocal(v));
          break;
        }
        case JSOp::CheckLexical:
          if (st.depth < 1) return reject("underflow", pc);
          // Types are static: a TDZ value here would always throw.
          if (st.stack[top] == Ty::Magic) return reject("tdz", pc);
          break;
        case JSOp::Pop:
          if (st.depth < 1) return reject("underflow", pc);
          st.depth--;
          break;
        case JSOp::Dup:
          if (st.depth < 1) return reject("underflow", pc);
          if (!push(st.stack[top], pc)) return false;
          lget(slotLocal(top)), lset(slotLocal(top + 1));
          break;
        case JSOp::Swap: {
          if (st.depth < 2) return reject("underflow", pc);
          uint32_t a = slotLocal(top - 1), b = slotLocal(top);
          lget(a), lset(tmp32()), lget(b), lset(a), lget(tmp32()), lset(b);
          Ty t = st.stack[top - 1];
          st.stack[top - 1] = st.stack[top];
          st.stack[top] = t;
          break;
        }
        case JSOp::Add:
        case JSOp::Sub:
        case JSOp::Mul:
        case JSOp::Mod:
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
          if (!unaryInt(pc)) return false;
          uint32_t s = slotLocal(top);
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
        case JSOp::Neg: {
          // 0 and INT32_MIN negate to doubles (-0, 2^31).
          if (!unaryInt(pc)) return false;
          uint32_t s = slotLocal(top);
          lget(s), code.put(W_I32EQZ);
          lget(s), i32c(INT32_MIN), code.put(W_I32EQ);
          code.put(W_I32OR);
          code.put(W_IF), code.put(W_VOID);
          emitExit(Bail, pc, icIndex);
          code.put(W_END);
          i32c(0), lget(s), code.put(W_I32SUB), lset(s);
          icIndex++;
          break;
        }
        case JSOp::BitNot: {
          if (!unaryInt(pc)) return false;
          uint32_t s = slotLocal(top);
          lget(s), i32c(-1), code.put(W_I32XOR), lset(s);
          icIndex++;
          break;
        }
        case JSOp::Pos:
        case JSOp::ToNumeric:
          if (!unaryInt(pc)) return false;
          icIndex++;
          break;
        case JSOp::Not: {
          if (st.depth < 1) return reject("underflow", pc);
          if (!truthy(top, st.stack[top], pc)) return false;
          code.put(W_I32EQZ), lset(slotLocal(top));
          st.stack[top] = Ty::Bool;
          icIndex++;
          break;
        }
        case JSOp::JumpIfFalse:
        case JSOp::JumpIfTrue: {
          if (st.depth < 1) return reject("underflow", pc);
          Ty t = st.stack[top];
          st.depth--;
          icIndex++;
          if (!truthy(top, t, pc)) return false;
          if (op == JSOp::JumpIfFalse) code.put(W_I32EQZ);
          if (!branch(pc, pc + GET_JUMP_OFFSET(pc), next, true)) return false;
          break;
        }
        case JSOp::And:
        case JSOp::Or: {
          // ToBoolean(top); the value stays on the stack on both edges.
          if (st.depth < 1) return reject("underflow", pc);
          jsbytecode* target = pc + GET_JUMP_OFFSET(pc);
          if (target == head) return reject("backedge depth", pc);
          icIndex++;
          if (!truthy(top, st.stack[top], pc)) return false;
          if (op == JSOp::And) code.put(W_I32EQZ);
          if (!branch(pc, target, next, true)) return false;
          break;
        }
        case JSOp::Coalesce: {
          // Jumps unless the value is null or undefined; static here.
          if (st.depth < 1) return reject("underflow", pc);
          Ty t = st.stack[top];
          if (t == Ty::Int || t == Ty::Bool) {
            if (!branch(pc, pc + GET_JUMP_OFFSET(pc), next, false)) return false;
          } else if (t != Ty::Undef && t != Ty::Null) {
            return reject("operand type", pc);
          }
          break;
        }
        case JSOp::Goto:
          if (!branch(pc, pc + GET_JUMP_OFFSET(pc), next, false)) return false;
          break;
        default:
          return reject(CodeName(op), pc);
      }
      if (code.oom) return reject("oom", pc);
      pc = next;
    }
    if (firstOpen != ntargets) return reject("jump target", end);
    if (st.live) return reject("region end", end);
    code.put(W_END);  // loop
    code.put(W_UNREACHABLE);
    return true;
  }

  // Assemble the module; returns false on reject.
  bool assemble(Buf& m) {
    Buf body;
    body.uleb(2);
    body.uleb(kParams + nvars + kMaxDepth + 1), body.put(0x7f);
    body.uleb(1), body.put(0x7e);
    body.putn(code.p, code.n);
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

bool Compile(JSScript* script, jit::BaselineFrame* frame, jsbytecode* pc,
             Entry* e) {
  if (gInstalls.load(std::memory_order_relaxed) >= kMaxInstalls) return false;
  Compiler c;
  c.script = script;
  c.head = pc;
  c.end = nullptr;
  c.frame = reinterpret_cast<const uint8_t*>(frame);
  if (frame->isFunctionFrame()) {
    c.argv = reinterpret_cast<const uint64_t*>(frame->argv());
    c.nformals = frame->numFormalArgs();
    c.argsAliased = script->argsObjAliasesFormals();
  }
  bool ok = c.scan() && c.liveness() && c.translate();
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
  e->nargs = uint16_t(c.maxArg);
  e->fn = idx[0];
  gInstalls.fetch_add(1, std::memory_order_relaxed);
  uint32_t n = gCompiles.fetch_add(1, std::memory_order_relaxed) + 1;
  if (TakeLog()) {
    fprintf(stderr,
            "PBLJIT compile #%u %s:%u off=%u len=%zu ops=%u vars=%u depth=%u "
            "wasm=%zu idx=%u\n",
            n, script->filename() ? script->filename() : "?", script->lineno(),
            unsigned(pc - script->code()), len, c.nops, c.nvars, c.maxDepth,
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

typedef int64_t (*JitFn)(void* frame, void* sp, void* intr, void* out,
                         void* argv);

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
    e->state = Compile(script, frame, pc, e) ? 1 : 2;
    if (e->state != 1) return false;
  }
  // Same pc pointer, possibly a different (re-allocated) script: compare.
  if (MOZ_UNLIKELY(pc + e->len > script->codeEnd() ||
                   memcmp(pc, e->bytes, e->len) != 0)) {
    Evict(e);
    e->pc = pc;
    return false;
  }
  // The code was specialized for a frame whose argv has >= nargs unaliased
  // formals; another frame running the same bytecode may not (e.g. eval).
  void* argv = nullptr;
  if (e->nargs) {
    if (!frame->isFunctionFrame() || frame->numFormalArgs() < e->nargs ||
        script->argsObjAliasesFormals())
      return false;
    argv = frame->argv();
  }
  struct {
    uint32_t sp;
    int32_t pcDelta;
    uint32_t icIndex;
  } out;
  int64_t kind = reinterpret_cast<JitFn>(uintptr_t(e->fn))(
      frame, sp, cx->addressOfInterruptBits(), &out, argv);
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
