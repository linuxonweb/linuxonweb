// Scripted getter semantics test (hot loops); prints results to compare across modes.
var out = [];
function P(s) { out.push(String(s)); }
function show(v) {
  if (v === null) return "null";
  var t = typeof v;
  if (t === "object" || t === "function") {
    try { return t + ":" + Object.prototype.toString.call(v) + (v && v.tag ? ":" + v.tag : ""); } catch (e) { return t + ":?"; }
  }
  return t + ":" + String(v);
}
var N = 400;
function run(name, fn) {
  var r, last;
  try {
    for (var i = 0; i < N; i++) { r = fn(i); if (i > 0 && r !== last) { P(name + " DIVERGE at " + i + ": " + last + " vs " + r); } last = r; }
    P(name + " = " + r);
  } catch (e) {
    P(name + " threw " + (e && e.constructor && e.constructor.name) + ": " + e.message);
  }
}
function runAll(name, fn) {
  var acc = [];
  try {
    for (var i = 0; i < N; i++) acc.push(fn(i));
    var h = 0, s = acc.join(",");
    for (var k = 0; k < s.length; k++) h = (h * 31 + s.charCodeAt(k)) | 0;
    P(name + " = " + acc.slice(0, 3).join(",") + "..." + acc[acc.length - 1] + " #" + h);
  } catch (e) {
    P(name + " threw at " + acc.length + " " + (e && e.constructor && e.constructor.name) + ": " + e.message);
  }
}
function runThrows(name, fn) {
  var msgs = {};
  for (var i = 0; i < N; i++) {
    try { var r = fn(i); msgs["ok:" + r] = 1; } catch (e) { msgs[(e && e.constructor && e.constructor.name) + ":" + e.message] = 1; }
  }
  P(name + " -> " + Object.keys(msgs).join(" ; "));
}
// Own getter, mono.
var o1 = { tag: "o1", get g() { return show(this) + "|" + arguments.length; } };
run("own", () => o1.g);
// Getter on prototype (holder != receiver).
function Pt(x) { this.x = x; this.tag = "pt"; }
Object.defineProperty(Pt.prototype, "dbl", { get: function () { return this.x * 2; } });
runAll("proto", (i) => new Pt(i).dbl);
var pts = [new Pt(1), new Pt(2), new Pt(3)];
runAll("protoReuse", (i) => pts[i % 3].dbl);
// Class getters, static getters, private fields.
class C {
  #p = 5;
  constructor(v) { this.v = v; }
  get val() { return this.v + this.#p; }
  get priv() { return this.#p++; }
  static get sg() { return "static:" + typeof this; }
}
runAll("classGet", (i) => new C(i).val);
var c1 = new C(1);
runAll("classPriv", () => c1.priv);
run("staticGet", () => C.sg);
class D extends C { get val() { return "D" + super.val; } }
runAll("superGet", (i) => new D(i).val);
// Getters on primitives' prototypes: this must be the primitive (strict) or boxed (sloppy).
Object.defineProperty(Number.prototype, "sloppyThis", { get: function () { return typeof this + ":" + (this + 1); }, configurable: true });
Object.defineProperty(Number.prototype, "strictThis", { get: function () { "use strict"; return typeof this + ":" + (this + 1); }, configurable: true });
Object.defineProperty(String.prototype, "first", { get: function () { "use strict"; return typeof this + this[0]; }, configurable: true });
Object.defineProperty(Boolean.prototype, "bt", { get: function () { return typeof this; }, configurable: true });
Object.defineProperty(Symbol.prototype, "st", { get: function () { "use strict"; return typeof this; }, configurable: true });
runAll("numSloppy", (i) => (i).sloppyThis);
runAll("numStrict", (i) => (i).strictThis);
runAll("strFirst", (i) => ("s" + i).first);
run("boolGet", () => true.bt);
run("symGet", () => Symbol.iterator.st);
// Polymorphic / megamorphic receivers through one site.
var shapes = [];
for (var k = 0; k < 12; k++) {
  var proto = { get pg() { return "pg" + this.k; } };
  var ob = Object.create(proto); ob.k = k; ob["f" + k] = k; shapes.push(ob);
}
function readPg(o) { return o.pg; }
runAll("poly3", (i) => readPg(shapes[i % 3]));
runAll("mega", (i) => readPg(shapes[i % 12]));
// Mixed data / getter / native getter through one site.
var mixed = [{ m: 1 }, { get m() { return 2; } }, Object.create({ get m() { return this === undefined ? "u" : 3; } }), [1, 2, 3]];
function readM(o) { return o.m; }
runAll("mixed", (i) => readM(mixed[i % 4]));
var natives = [[1, 2], new Map([[1, 1]]), new Set([1, 2, 3]), "abcd"];
function readSize(o) { return o.size !== undefined ? o.size : o.length; }
runAll("nativeGet", (i) => readSize(natives[i % 4]));
// Proxy get trap and DOM-like accessors.
var px = new Proxy({}, { get: function (t, k, r) { return "trap:" + String(k); } });
run("proxy", () => px.anything);
var pxg = new Proxy(o1, {});
run("proxyGetter", () => pxg.g);
// Getter that throws (sometimes).
var thr = { get t() { if (this.n++ % 3 === 2) throw new RangeError("boom" + this.n); return this.n; }, n: 0 };
runThrows("throws", () => thr.t);
// Getter that redefines itself / mutates the shape mid-loop.
var self = { get s() { Object.defineProperty(this, "s", { value: "data", writable: true, configurable: true }); return "first"; }, tag: "self" };
runAll("selfRedefine", (i) => { if (i === 200) { Object.defineProperty(self, "s", { get: function () { return "again"; }, configurable: true }); } return self.s; });
var mut = { get q() { this["z" + (this.c++ % 50)] = 1; return this.c; }, c: 0 };
runAll("shapeMutate", () => mut.q);
var flip = { get f() { return 1; } };
runAll("flipProto", (i) => { if (i === 150) Object.defineProperty(flip, "f", { get: function () { return 2; } , configurable: true}); if (i === 300) delete flip.f; return flip.f; });
// Bound function as getter (not a scripted getter for the stub).
var bget = { tag: "bt" };
Object.defineProperty(bget, "b", { get: function () { return show(this); }.bind({ tag: "bound" }) });
run("boundGetter", () => bget.b);
// Arrow getter (lexical this) and getter with default/rest params.
var arrowThis = { tag: "outer" };
var arrowObj = (function () { var g = () => show(this); var o = { tag: "ao" }; Object.defineProperty(o, "a", { get: g }); return o; }).call(arrowThis);
run("arrowGetter", () => arrowObj.a);
var oddArgs = {};
Object.defineProperty(oddArgs, "r", { get: function (...r) { return r.length + ":" + arguments.length; } });
Object.defineProperty(oddArgs, "d", { get: function (a = 9) { return a; } });
Object.defineProperty(oddArgs, "n1", { get: function (a) { return String(a) + arguments.length; } });
run("restGetter", () => oddArgs.r);
run("dfltGetter", () => oddArgs.d);
run("nargs1Getter", () => oddArgs.n1);
// Getter using arguments / closures / generators inside.
var envGet = (function () { var cnt = 0; return { get e() { cnt++; var f = function () { return cnt; }; return f() % 7; } }; })();
runAll("closureGet", () => envGet.e);
var argGet = { get a() { return arguments.length + Array.prototype.join.call(arguments, "-"); } };
run("argsGet", () => argGet.a);
var genGet = { get gn() { function* g() { yield 1; yield 2; } var s = 0; for (var v of g()) s += v; return s; } };
run("genInGetter", () => genGet.gn);
// Error().stack inside the getter.
function clean(s) { return s.split("\n").map(function (l) { return l.replace(/:\d+:\d+$/, ""); }).join(";"); }
var stk = { get st() { return clean(new Error().stack); } };
function stkOuter() { return stk.st; }
run("stack", () => stkOuter());
// Getter calling another getter, and recursion through getters (<= 40 deep).
var chain = { get a() { return this.b + 1; }, get b() { return this.c + 1; }, get c() { return 1; } };
run("chain", () => chain.a);
var rec = { n: 0, get r() { if (this.n <= 0) return 0; this.n--; var v = this.r; return v + 1; } };
run("recursive", () => { rec.n = 35; return rec.r; });
var recF = { get f() { return fibG(12); } };
function fibG(n) { return n < 2 ? n : fibG(n - 1) + fibG(n - 2); }
run("callsInside", () => recF.f);
// Getter called many times then invalidated (prototype change / delete).
function H() {}
Object.defineProperty(H.prototype, "hv", { get: function () { return "H"; }, configurable: true });
var hs = new H();
var hr = [];
for (var i = 0; i < 12000; i++) hr.push(hs.hv);
Object.defineProperty(H.prototype, "hv", { get: function () { return "H2"; }, configurable: true });
for (var i = 0; i < 400; i++) hr.push(hs.hv);
Object.setPrototypeOf(hs, { get hv() { return "H3"; } });
for (var i = 0; i < 400; i++) hr.push(hs.hv);
hs.hv2 = 1; Object.defineProperty(hs, "hv", { value: "own", configurable: true });
for (var i = 0; i < 400; i++) hr.push(hs.hv);
var cnts = {}; hr.forEach(function (v) { cnts[v] = (cnts[v] || 0) + 1; });
P("invalidate = " + JSON.stringify(cnts));
// GetElem / super property reads with getters.
var ge = { get ["k"]() { return "elem"; } };
var key = "k";
run("getElem", () => ge[key]);
var sym = Symbol("s");
var gs = { get [sym]() { return "sym"; } };
run("getElemSym", () => gs[sym]);
var base = { get sp() { return show(this) + "base"; } };
var derived = { __proto__: base, tag: "der", get sp() { return "der:" + super.sp; } };
run("superProp", () => derived.sp);
// Getter returning undefined / object / the receiver.
var rets = { get u() {}, get ob() { return { tag: "new" }; }, get me() { return this; }, tag: "rets" };
run("retUndef", () => rets.u);
runAll("retObj", () => show(rets.ob));
run("retThis", () => rets.me === rets);
// Getter used in conditions, as call target, in typeof/in/delete contexts.
var fnGet = { get fn() { return function (x) { return x * 3; }; } };
runAll("callGot", (i) => fnGet.fn(i));
run("typeofGet", () => typeof o1.g);
// Getter whose this is a function / array / arguments.
Object.defineProperty(Function.prototype, "fg", { get: function () { return "fg:" + this.name; }, configurable: true });
run("fnRecv", () => show.fg);
Object.defineProperty(Array.prototype, "lastEl", { get: function () { return this[this.length - 1]; }, configurable: true });
runAll("arrRecv", (i) => [i, i + 1].lastEl);
// Getter side effect in an ignored position.
var side = 0;
var se = { get x() { side++; return side; } };
for (var i = 0; i < N; i++) se.x;
P("ignored side=" + side);
// Accessor with only a setter (getter undefined).
var onlySet = { set w(v) { this._w = v; } };
run("onlySetter", () => onlySet.w);
// Cleanup prototypes.
delete Number.prototype.sloppyThis; delete Number.prototype.strictThis; delete String.prototype.first;
delete Boolean.prototype.bt; delete Symbol.prototype.st; delete Function.prototype.fg; delete Array.prototype.lastEl;
run("afterDelete", (i) => String((i).sloppyThis));
print(out.join("\n"));
print("GETTERS DONE");
