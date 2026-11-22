// Numeric Firefox bytecode fixtures for the real PblJit.cpp emitter. No mocked
// JIT output: run-nested.mjs validates and executes each emitted Wasm module.
// IC operands count IC-bearing instructions in bytecode order, as the frontend
// does; the independent reference interpreter also follows JumpTarget resets.
struct NumericCode {
  Code c;
  uint32_t ic = 0;
  void get(uint32_t v) { c.loc(JSOp::GetLocal, v); }
  void set(uint32_t v) { c.loc(JSOp::SetLocal, v); c.op(JSOp::Pop); }
  void num(int32_t n) { c.op(JSOp::Int32); c.u(uint32_t(n), 4); }
  void calc(JSOp op) { c.op(op); ic++; }
  void assign(uint32_t v, int32_t n) { num(n); set(v); }
  void inc(uint32_t v) { get(v); calc(JSOp::Inc); set(v); }
  void add(uint32_t dst, uint32_t src) { get(dst); get(src); calc(JSOp::Add); set(dst); }
  size_t head() { return c.head(ic); }
  size_t jump(JSOp op) { if (op != JSOp::Goto) ic++; return c.jump(op); }
  void target() { c.target(ic); }
  void to(size_t at, size_t dest) { c.patch(at, dest); }
  void go(size_t dest) { to(jump(JSOp::Goto), dest); }
  void finish(size_t branch) { c.here(branch); target(); }
  size_t test(uint32_t lhs, uint32_t rhs) {
    get(lhs); get(rhs); calc(JSOp::Lt);
    size_t jf = jump(JSOp::JumpIfFalse); target(); return jf;
  }
  size_t equal(uint32_t lhs, uint32_t rhs) {
    get(lhs); get(rhs); calc(JSOp::StrictEq); return jump(JSOp::JumpIfTrue);
  }
};

static void emitNumeric(const char* dir, const char* name, NumericCode& n) {
  emit(dir, name, n.c, 0);
  char path[512]; snprintf(path, sizeof path, "%s/%s.bytecode.json", dir, name);
  FILE* f = fopen(path, "w");
  fputs("[", f);
  for (size_t at = 0; at < n.c.b.size();) {
    jsbytecode* pc = n.c.b.data() + at;
    JSOp op = JSOp(*pc);
    size_t len = GetBytecodeLength(pc);
    fprintf(f, "%s{\"pc\":%zu,\"op\":\"%s\",\"len\":%zu", at ? "," : "", at, CodeName(op), len);
    if (op == JSOp::Double) {
      double d; memcpy(&d, pc + 1, 8); fprintf(f, ",\"a\":%.17g", d);
    } else if (op == JSOp::Call) {
      fprintf(f, ",\"a\":%u", GET_ARGC(pc));
    } else if (len > 1) {
      int32_t a = op == JSOp::GetLocal || op == JSOp::SetLocal || op == JSOp::InitLexical
                      ? int32_t(GET_LOCALNO(pc)) : GET_INT32(pc);
      fprintf(f, ",\"a\":%d", a);
    }
    fputc('}', f);
    at += len;
  }
  fputs("]\n", f); fclose(f);
}

// sum=0, i=1, j=2, outerBound=3, innerBound=4, innerCount=5, outerCount=6.
static NumericCode rectangle(bool fractional = false) {
  NumericCode n;
  size_t outer = n.head(), out = n.test(1, 3);
  n.assign(2, 0);
  size_t inner = n.head(), in = n.test(2, 4);
  n.get(0); n.get(1); n.num(7); n.calc(JSOp::Mul); n.calc(JSOp::Add);
  n.get(2); n.calc(JSOp::Add); n.set(0); n.inc(5);
  if (fractional) { n.get(2); n.c.dbl(0.5); n.calc(JSOp::Add); n.set(2); }
  else n.inc(2);
  n.go(inner); n.finish(in);
  n.inc(6); n.inc(1); n.go(outer); n.finish(out); n.c.op(JSOp::Return);
  return n;
}
static void emitNestedFixtures(const char* dir) {
  reset();
  { auto n = rectangle(); emitNumeric(dir, "nested-rect", n); }
  { auto n = rectangle(true); emitNumeric(dir, "nested-widen", n); }
  { // A three-deep cube: independent counts prove all enclosing work runs.
    NumericCode n;
    size_t outer = n.head(), out = n.test(1, 4); n.assign(2, 0);
    size_t middle = n.head(), mid = n.test(2, 4); n.assign(3, 0);
    size_t inner = n.head(), in = n.test(3, 4);
    n.get(0); n.get(1); n.num(100); n.calc(JSOp::Mul); n.calc(JSOp::Add);
    n.get(2); n.num(10); n.calc(JSOp::Mul); n.calc(JSOp::Add);
    n.get(3); n.calc(JSOp::Add); n.set(0); n.inc(5); n.inc(3); n.go(inner);
    n.finish(in); n.inc(7); n.inc(2); n.go(middle);
    n.finish(mid); n.inc(6); n.inc(1); n.go(outer);
    n.finish(out); n.c.op(JSOp::Return); emitNumeric(dir, "nested-cube", n);
  }
  { // Inner continue, inner break, outer continue and outer break. All four
    // can occur with forward blocks still open around the innermost loop.
    // skip=7, breakAt=8, outerContinueAt=9, stopSum=10.
    NumericCode n;
    size_t outer = n.head(), out = n.test(1, 3); n.assign(2, 0);
    size_t inner = n.head(), in = n.test(2, 4); n.inc(2);
    n.to(n.equal(2, 7), inner); n.target();
    size_t breakInner = n.equal(2, 8); n.target();
    n.get(2); n.get(9); n.calc(JSOp::StrictEq);
    size_t noOuterContinue = n.jump(JSOp::JumpIfFalse); n.target();
    n.inc(1); n.go(outer); n.finish(noOuterContinue);
    n.add(0, 2); n.inc(5);
    n.get(0); n.get(10); n.calc(JSOp::Gt);
    size_t breakOuter = n.jump(JSOp::JumpIfTrue); n.target(); n.go(inner);
    n.to(breakInner, n.c.b.size()); n.finish(in);
    n.inc(6); n.inc(1); n.go(outer);
    n.to(breakOuter, n.c.b.size()); n.finish(out); n.c.op(JSOp::Return);
    emitNumeric(dir, "nested-control", n);
  }
  { // Widen a stack join and a loop-carried sum; change both loop bounds.
    NumericCode n;
    size_t outer = n.head(), out = n.test(1, 3); n.assign(2, 0);
    size_t inner = n.head(), in = n.test(2, 4);
    n.get(2); n.num(1); n.calc(JSOp::BitAnd);
    size_t even = n.jump(JSOp::JumpIfFalse); n.target(); n.c.dbl(0.5);
    size_t join = n.jump(JSOp::Goto); n.finish(even); n.num(2);
    n.finish(join); n.get(0); n.calc(JSOp::Add); n.set(0);
    n.get(4); n.num(1); n.calc(JSOp::Sub); n.set(4); n.inc(5); n.inc(2); n.go(inner);
    n.finish(in); n.get(3); n.num(1); n.calc(JSOp::Sub); n.set(3);
    n.inc(6); n.inc(1); n.go(outer); n.finish(out); n.c.op(JSOp::Return);
    emitNumeric(dir, "nested-bound-join", n);
  }
  { // The inner loop is do/while: its conditional backedge falls through.
    NumericCode n;
    size_t outer = n.head(), out = n.test(1, 3); n.assign(2, 0);
    size_t inner = n.head(); n.add(0, 2); n.inc(5); n.inc(2);
    n.get(2); n.get(4); n.calc(JSOp::Lt);
    n.to(n.jump(JSOp::JumpIfTrue), inner); n.target();
    n.inc(6); n.inc(1); n.go(outer); n.finish(out); n.c.op(JSOp::Return);
    emitNumeric(dir, "nested-posttest", n);
  }
  { // Bail before the overflowing Add, preserving both operands and locals.
    NumericCode n;
    size_t outer = n.head(), out = n.test(1, 3); n.assign(2, 0);
    size_t inner = n.head(), in = n.test(2, 4);
    n.get(0); n.get(2); gMark[0] = int(n.c.b.size()); n.calc(JSOp::Add); n.set(0);
    n.inc(5); n.inc(2); n.go(inner); n.finish(in);
    n.inc(6); n.inc(1); n.go(outer); n.finish(out); n.c.op(JSOp::Return);
    emitNumeric(dir, "nested-overflow", n);
  }
  { // Numeric entry accepts x (local7) as Double, but ToInt32 must bail on
    // NaN/infinity/out-of-range before touching the operands or counters.
    setLocal(7, DOUBLE_HI);
    NumericCode n;
    size_t outer = n.head(), out = n.test(1, 3); n.assign(2, 0);
    size_t inner = n.head(), in = n.test(2, 4);
    n.get(0); n.get(7); n.num(0); gMark[0] = int(n.c.b.size());
    n.calc(JSOp::BitOr); n.calc(JSOp::Add); n.set(0); n.inc(5); n.inc(2);
    n.go(inner); n.finish(in); n.inc(6); n.inc(1); n.go(outer);
    n.finish(out); n.c.op(JSOp::Return); emitNumeric(dir, "nested-number-bail", n); reset();
  }
  { // An inner trip count deliberately too long to finish before interruption.
    NumericCode n;
    size_t outer = n.head(), out = n.test(1, 3); n.assign(2, 0);
    size_t inner = n.head(), in = n.test(2, 4);
    n.inc(2); n.go(inner); n.finish(in); n.inc(6); n.inc(1); n.go(outer);
    n.finish(out); n.c.op(JSOp::Return); emitNumeric(dir, "nested-interrupt", n);
  }
  { // CFG rejection: an edge enters after a nested header.
    NumericCode n;
    size_t outer = n.head(), entry = n.jump(JSOp::Goto), inner = n.head();
    n.to(entry, n.c.b.size()); n.c.op(JSOp::Nop); n.go(inner); n.go(outer);
    emitNumeric(dir, "nested-reject-side-entry", n);
  }
  { // A branch into a header operand is never an instruction target.
    NumericCode n;
    size_t outer = n.head(), bad = n.jump(JSOp::Goto), inner = n.head();
    n.to(bad, inner + 1); n.go(inner); n.go(outer);
    emitNumeric(dir, "nested-reject-boundary", n);
  }
  { // A header with no backedge cannot be lowered as a natural loop.
    NumericCode n;
    size_t outer = n.head(); n.head(); n.c.op(JSOp::Nop); n.go(outer);
    emitNumeric(dir, "nested-reject-no-backedge", n);
  }
  { // CFG rejection: overlapping, non-laminar natural-loop intervals.
    NumericCode n;
    size_t outer = n.head(), a = n.head(), b = n.head();
    n.go(a); n.go(b); n.go(outer); emitNumeric(dir, "nested-reject-crossing", n);
  }
  { NumericCode n;
    size_t outer = n.head(), inner = n.head(), body = n.c.b.size();
    n.c.op(JSOp::Nop); n.go(body); n.go(inner); n.go(outer);
    emitNumeric(dir, "nested-reject-backward", n);
  }
  { NumericCode n;
    size_t h[4]; for (auto& at : h) at = n.head();
    for (unsigned i = 4; i > 0; i--) n.go(h[i - 1]);
    emitNumeric(dir, "nested-reject-depth", n);
  }
  { NumericCode n;
    size_t outer = n.head(); n.num(1); size_t inner = n.head();
    n.c.op(JSOp::Pop); n.go(inner); n.go(outer);
    emitNumeric(dir, "nested-reject-stack", n);
  }
  { NumericCode n;
    size_t outer = n.head(), inner = n.head(); n.c.op(JSOp::True); n.set(0);
    n.go(inner); n.go(outer); emitNumeric(dir, "nested-reject-bool", n);
  }
  { auto n = rectangle(); setLocal(0, OBJECT, ARR_INT);
    emitNumeric(dir, "nested-reject-object", n); reset();
  }
  for (JSOp op : {JSOp::GetElem, JSOp::Call}) {
    NumericCode n;
    size_t outer = n.head(), inner = n.head(); n.c.op(op);
    if (op == JSOp::Call) n.c.u(0, 2);
    n.go(inner); n.go(outer);
    emitNumeric(dir, op == JSOp::Call ? "nested-reject-call" : "nested-reject-array", n);
  }
  reset();
}
