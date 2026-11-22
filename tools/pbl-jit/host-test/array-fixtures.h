// Symbolic final159 bytecode, based on CForEmitter/EmitterScope emission order.
// This is not a captured native disassembly. The unchanged cube's multiply is
// separately evaluated as ordinary JavaScript by run-array.mjs.
struct ArrayCode {
  struct Mark { const char* name; size_t pc; };
  Code c;
  uint32_t ic = 0;
  std::vector<Mark> marks;
  void mark(const char* name) { marks.push_back({name, c.b.size()}); }
  void get(uint32_t v) { c.loc(JSOp::GetLocal, v); }
  void arg(uint32_t v) { c.arg(JSOp::GetArg, v); }
  void set(uint32_t v) { c.loc(JSOp::SetLocal, v); c.op(JSOp::Pop); }
  void num(int32_t n) { c.op(JSOp::Int32); c.u(uint32_t(n), 4); }
  void calc(JSOp op) { c.op(op); ic++; }
  void poison(uint32_t v) {
    c.op(JSOp::Uninitialized); c.loc(JSOp::InitLexical, v); c.op(JSOp::Pop);
  }
  void init(uint32_t v, int32_t n = 0) {
    num(n); c.loc(JSOp::InitLexical, v); c.op(JSOp::Pop);
  }
  void inc(uint32_t v) { get(v); c.loc(JSOp::CheckLexical, v); calc(JSOp::ToNumeric); calc(JSOp::Inc); set(v); }
  size_t head() { return c.head(ic); }
  size_t jump(JSOp op) { if (op != JSOp::Goto) ic++; return c.jump(op); }
  void target() { c.target(ic); }
  void go(size_t pc) { c.patch(jump(JSOp::Goto), pc); }
  size_t testConst(uint32_t v, int32_t n) {
    get(v); num(n); calc(JSOp::Lt);
    size_t out = jump(JSOp::JumpIfFalse); target(); return out;
  }
  size_t test(uint32_t v, uint32_t bound) {
    get(v); get(bound); calc(JSOp::Lt);
    size_t out = jump(JSOp::JumpIfFalse); target(); return out;
  }
  void finish(size_t branch) { c.here(branch); target(); }
  void leave() { c.op(JSOp::DebugLeaveLexicalEnv); }
  void index(uint32_t row, uint32_t col) {
    get(row); num(4); calc(JSOp::Mul); get(col); calc(JSOp::Add);
  }
};

static void emitArray(const char* dir, const char* name, ArrayCode& a) {
  emit(dir, name, a.c, 0);
  char path[512]; snprintf(path, sizeof path, "%s/%s.bytecode.json", dir, name);
  FILE* f = fopen(path, "w"); fputs("{\"symbolic\":true,\"marks\":{", f);
  for (size_t i = 0; i < a.marks.size(); i++)
    fprintf(f, "%s\"%s\":%zu", i ? "," : "", a.marks[i].name, a.marks[i].pc);
  fputs("},\"ops\":[", f);
  for (size_t at = 0; at < a.c.b.size();) {
    jsbytecode* pc = a.c.b.data() + at;
    JSOp op = JSOp(*pc); size_t len = GetBytecodeLength(pc);
    fprintf(f, "%s{\"pc\":%zu,\"op\":\"%s\",\"len\":%zu", at ? "," : "", at, CodeName(op), len);
    if (op == JSOp::Double) {
      double d; memcpy(&d, pc + 1, 8); fprintf(f, ",\"a\":%.17g", d);
    } else if (op == JSOp::GetArg || op == JSOp::SetArg || op == JSOp::Call) {
      fprintf(f, ",\"a\":%u", GET_UINT16(pc));
    } else if (op == JSOp::GetLocal || op == JSOp::SetLocal || op == JSOp::InitLexical || op == JSOp::CheckLexical) {
      fprintf(f, ",\"a\":%u", GET_LOCALNO(pc));
    } else if (len >= 5) {
      fprintf(f, ",\"a\":%d", GET_INT32(pc));
    }
    fputc('}', f); at += len;
  }
  fputs("]}\n", f); fclose(f);
}

// out=local0, c=1, r=2, s=3, k=4; a/b are unaliased formal arguments.
static ArrayCode matrixCode() {
  ArrayCode a;
  size_t c = a.head(), cend = a.testConst(1, 4);
  a.poison(2); a.init(2);
  size_t r = a.head(), rend = a.testConst(2, 4);
  a.poison(3); a.init(3); a.poison(4); a.init(4);
  size_t k = a.head(), kend = a.testConst(4, 4);
  a.get(3); a.arg(0); a.index(4, 2); a.mark("readA"); a.calc(JSOp::GetElem);
  a.arg(1); a.index(1, 4); a.mark("readB"); a.calc(JSOp::GetElem);
  a.mark("product"); a.calc(JSOp::Mul); a.calc(JSOp::Add);
  a.c.op(JSOp::NopIsAssignOp); a.set(3); a.inc(4); a.go(k);
  a.finish(kend); a.leave();
  a.get(0); a.index(1, 2); a.calc(JSOp::ToPropertyKey); a.get(3);
  a.mark("write"); a.calc(JSOp::StrictSetElem); a.c.op(JSOp::Pop);
  a.leave(); a.inc(2); a.go(r); a.finish(rend); a.leave();
  a.inc(1); a.go(c); a.finish(cend); a.c.op(JSOp::Return);
  return a;
}
static void matrixFrame(uint32_t output = ARR_INIT) {
  reset(); setLocal(0, OBJECT, output); setArg(0, OBJECT, ARR_NUM); setArg(1, OBJECT, ARR_NUM);
  gFunction = true; gFormals = 2;
}
// out=0,row=1,col=2,rows=3,cols=4,outputOffset=5. Width is four.
static ArrayCode copyCode(bool update) {
  ArrayCode a;
  size_t row = a.head(), rend = a.test(1, 3); a.poison(2); a.init(2);
  size_t col = a.head(), cend = a.test(2, 4);
  a.get(0); a.index(1, 2); a.get(5); a.calc(JSOp::Add); a.calc(JSOp::ToPropertyKey);
  if (update) a.get(0); else a.arg(0);
  a.index(1, 2); a.mark("read"); a.calc(JSOp::GetElem);
  if (update) { a.c.dbl(0.5); a.calc(JSOp::Add); }
  a.mark("write"); a.calc(JSOp::StrictSetElem); a.c.op(JSOp::Pop);
  a.inc(2); a.go(col); a.finish(cend); a.leave(); a.inc(1); a.go(row);
  a.finish(rend); a.c.op(JSOp::Return); return a;
}
static bool checkArrayInitProofs(const char* dir) {
  uint32_t checks = 0, failures = 0;
  char path[512]; snprintf(path, sizeof path, "%s/array-proof-checks.json", dir);
  FILE* f = fopen(path, "w"); fputs("{\"cases\":[", f);
  auto test = [&](const char* name, bool expected, int protoCount = -1) {
    ArrayInitInfo info;
    bool result = InspectArrayForInit(ARR_INIT, info);
    bool pass = result == expected && (!result || protoCount < 0 || info.nprotos == uint32_t(protoCount));
    fprintf(f, "%s{\"name\":\"%s\",\"eligible\":%s,\"expected\":%s,\"pass\":%s}",
            checks ? "," : "", name, result ? "true" : "false", expected ? "true" : "false", pass ? "true" : "false");
    checks++; if (!pass) { failures++; fprintf(stderr, "ARRAY PROOF FAIL %s\n", name); }
    gArrayNodes.clear();
  };
  test("clean chain and nursery receiver", true, 2);
  auto receiver = [&](const char* name, auto change, bool expected = false) {
    ArrayInitNode node = arrayNode(ARR_INIT); change(node);
    gArrayNodes.push_back({ARR_INIT, node}); test(name, expected);
  };
  receiver("null prototype", [](auto& n) { n.prototype = 0; }, true);
  receiver("plain receiver", [](auto& n) { n.kind = ArrayInitNode::Kind::Plain; });
  receiver("proxy or exotic receiver", [](auto& n) { n.kind = ArrayInitNode::Kind::Other; });
  receiver("dictionary receiver", [](auto& n) { n.dictionary = true; });
  receiver("sparse or accessor receiver", [](auto& n) { n.indexed = true; });
  receiver("nonextensible receiver", [](auto& n) { n.extensible = false; });
  receiver("nonwritable length", [](auto& n) { n.lengthWritable = false; });
  receiver("receiver watched add", [](auto& n) { n.watchesAdd = true; });
  receiver("receiver watched value", [](auto& n) { n.watchesValue = true; });
  receiver("tenured receiver", [](auto& n) { n.tenured = true; }, true);
  receiver("fixed nonpacked storage", [](auto& n) { n.flags = 0x81; }, true);
  for (uint32_t flag : {2u, 8u, 0x10u, 0x20u, 0x40u, 0x100u, 0x400u, 1u << 21}) {
    ArrayInitNode node = arrayNode(ARR_INIT); node.flags = flag;
    gArrayNodes.push_back({ARR_INIT, node});
    char label[64]; snprintf(label, sizeof label, "forbidden receiver flag 0x%x", flag);
    test(label, false);
  }
  for (uint32_t pointer : {0x8500u, 0x8600u}) {
    auto proto = [&](const char* name, auto change, bool expected = false) {
      ArrayInitNode node = arrayNode(pointer); change(node);
      gArrayNodes.push_back({pointer, node}); test(name, expected);
    };
    proto("dense prototype property", [](auto& n) { n.initializedLength = 1; });
    proto("sparse or accessor prototype", [](auto& n) { n.indexed = true; });
    proto("dictionary prototype", [](auto& n) { n.dictionary = true; });
    proto("nursery prototype", [](auto& n) { n.tenured = false; });
    proto("proxy typed-array or exotic prototype", [](auto& n) { n.kind = ArrayInitNode::Kind::Other; });
    proto("empty frozen prototype", [](auto& n) { n.flags = 0x70; n.extensible = false; n.lengthWritable = false; }, true);
    ArrayInitNode node = arrayNode(pointer);
    gArrayNodes.push_back({pointer, node, false}); test("unreadable prototype", false);
  }
  for (uint32_t length : {8u, 9u}) {
    ArrayInitNode root = arrayNode(ARR_INIT); root.prototype = 0xb000;
    gArrayNodes.push_back({ARR_INIT, root});
    for (uint32_t i = 0; i < length; i++) {
      ArrayInitNode node;
      node.kind = ArrayInitNode::Kind::Plain; node.tenured = true; node.shape = 0xc000 + i * 0x20;
      node.prototype = i + 1 < length ? 0xb000 + (i + 1) * 0x100 : 0;
      gArrayNodes.push_back({0xb000 + i * 0x100, node});
    }
    test(length == 8 ? "bounded eight prototype chain" : "overlong nine prototype chain", length == 8, int(length));
  }
  { auto node = arrayNode(0x8500); node.prototype = 0x8500;
    gArrayNodes.push_back({0x8500, node}); test("prototype cycle bounded rejection", false); }
  { auto node = arrayNode(ARR_INIT);
    gArrayNodes.push_back({ARR_INIT, node, false}); test("unreadable receiver", false); }
  fprintf(f, "],\"pass\":%s,\"checks\":%u,\"failures\":%u,\"sharedProductionPredicates\":true,\"nativeReaderExecuted\":false}\n",
          failures ? "false" : "true", checks, failures); fclose(f);
  return failures == 0;
}

static void emitArrayFixtures(const char* dir) {
  matrixFrame(); { auto a = matrixCode(); emitArray(dir, "array-matrix", a); }
  matrixFrame(ARR_INT); { auto a = matrixCode(); emitArray(dir, "array-matrix-noinit", a); }
  matrixFrame();
  { auto node = arrayNode(0x8500); node.indexed = true; gArrayNodes.push_back({0x8500, node});
    auto a = matrixCode(); emitArray(dir, "array-matrix-unsafe-init", a); }
  matrixFrame(); { auto a = copyCode(false); emitArray(dir, "array-copy", a); }
  reset(); setLocal(0, OBJECT, ARR_INIT);
  { auto a = copyCode(true); emitArray(dir, "array-update", a); }
  { // Keep an exact TDZ sentinel dead across the inner loop. A numeric bailout
    // or interrupt must flush it before resuming the interpreter.
    reset(); setLocal(4, DOUBLE_HI);
    ArrayCode a; size_t outer = a.head(), out = a.test(1, 5);
    a.poison(2); a.init(3);
    size_t inner = a.head(), in = a.test(3, 6);
    a.get(4); a.num(0); a.mark("convert"); a.calc(JSOp::BitOr); a.set(0);
    a.inc(3); a.go(inner); a.finish(in); a.init(2, 9); a.inc(1); a.go(outer);
    a.finish(out); a.c.op(JSOp::Return); emitArray(dir, "array-tdz-bail", a);
  }
  matrixFrame(); gAliased = true;
  { auto a = matrixCode(); emitArray(dir, "array-reject-aliased-args", a); }
  matrixFrame(); gFormals = 1;
  { auto a = matrixCode(); emitArray(dir, "array-reject-arg-index", a); }
  matrixFrame();
  { // Writing through a formal array is unsupported even when its binding
    // itself is immutable.
    ArrayCode b; size_t outer = b.head(), inner = b.head();
    b.arg(0); b.num(0); b.num(1); b.calc(JSOp::SetElem); b.c.op(JSOp::Pop);
    b.go(inner); b.go(outer); b.c.op(JSOp::Return);
    emitArray(dir, "array-reject-formal-store", b);
  }
  matrixFrame();
  { ArrayCode a; size_t outer = a.head(), inner = a.head();
    a.get(0); a.set(0); a.go(inner); a.go(outer); a.c.op(JSOp::Return);
    emitArray(dir, "array-reject-ref-write", a);
  }
  reset();
  { ArrayCode a; size_t outer = a.head(), inner = a.head();
    a.poison(2); a.get(2); a.c.loc(JSOp::CheckLexical, 2); a.c.op(JSOp::Pop);
    a.go(inner); a.go(outer); a.c.op(JSOp::Return);
    emitArray(dir, "array-reject-tdz-read", a);
  }
  reset(); gFunction = true; gFormals = 1;
  { ArrayCode a; size_t outer = a.head(), inner = a.head();
    a.num(1); a.c.arg(JSOp::SetArg, 0); a.c.op(JSOp::Pop);
    a.go(inner); a.go(outer); a.c.op(JSOp::Return);
    emitArray(dir, "array-reject-formal-rebind", a);
  }
  reset();
}
