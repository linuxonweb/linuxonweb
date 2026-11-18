// SuperCall in derived-class constructors (PBLBC_SUPERCALL direct path).
// stdout must be identical: tiers off, defaults, PBLBC_HITS=2, PBLBC_SUPERCALL=0.
// Each section prints its line as soon as it finishes.
function p(s) { print("SC " + s); }
function tryIt(f) {
  try { return "ok:" + f(); } catch (e) { return "E:" + (e && e.constructor && e.constructor.name) + ":" + (e && e.message); }
}
var N = 300;

// a: multi-level hierarchy, fields, new.target
class A0 { constructor(x) { this.a = x; this.nt0 = new.target.name; } }
class A1 extends A0 { constructor(x, y) { super(x); this.b = y; } }
class A2 extends A1 { constructor(x) { super(x, x + 1); this.c = new.target === A2; } }
class A3 extends A2 { constructor() { super(7); this.d = 1; } }
(function () {
  var s = 0, t = "";
  for (var i = 0; i < N; i++) {
    var o = new A2(i), q = new A3();
    s += o.a + o.b + (o.c ? 1 : 0) + q.a + q.b + (q.c ? 100 : 0) + q.d;
    if (i === N - 1) t = o.nt0 + "," + q.nt0 + "," + Object.getPrototypeOf(q).constructor.name + "," + (q instanceof A0);
  }
  p("a " + s + " " + t);
})();

// b: base returns object / primitive
class BObj { constructor(k) { if (k & 1) return { fromBase: k }; this.self = k; } }
class BPrim { constructor(k) { this.k = k; return k; } }
class DB1 extends BObj { constructor(k) { super(k); this.tag = "d"; } }
class DB2 extends BPrim { constructor(k) { super(k); this.tag2 = 2; } }
(function () {
  var r = "";
  var s = 0;
  for (var i = 0; i < N; i++) {
    var o = new DB1(i), q = new DB2(i);
    s += (o.fromBase !== undefined ? o.fromBase : o.self) + (o instanceof DB1 ? 1 : 0) + q.k + q.tag2;
    if (i < 2) r += JSON.stringify(o) + JSON.stringify(q);
  }
  p("b " + s + " " + r);
})();

// c: derived returns object / undefined / primitive (TypeError) / throws
class CB { constructor() { this.base = 1; } }
class C1 extends CB { constructor(m) { super(); if (m === 1) return { other: m }; if (m === 2) return undefined; if (m === 3) return 5; if (m === 4) throw new RangeError("c4"); } }
(function () {
  var r = "";
  for (var i = 0; i < N; i++) {
    var m = i % 5;
    var v = tryIt(function () { return JSON.stringify(new C1(m)); });
    if (i < 5 || i === N - 1) r += v + ";";
  }
  p("c " + r);
})();

// d: super() twice, super() not called, super in arrow, conditional super
class DB { constructor() { this.n = (this.n | 0) + 1; } }
class D2 extends DB { constructor() { super(); super(); } }
class D0 extends DB { constructor() { } }
class D0r extends DB { constructor() { return; } }
class DA extends DB { constructor(k) { var f = () => super(); if (k) f(); else { f(); } this.z = k; } }
class DA2 extends DB { constructor() { var f = () => super(); f(); f(); } }
class DC extends DB { constructor(k) { if (k) super(); } }
(function () {
  var r = "", s = 0;
  for (var i = 0; i < N; i++) {
    var a = tryIt(function () { return new D2().n; });
    var b = tryIt(function () { return new D0().n; });
    var b2 = tryIt(function () { return new D0r().n; });
    var c = new DA(i & 1); s += c.n + c.z;
    var c2 = tryIt(function () { return new DA2().n; });
    var d = tryIt(function () { return new DC(i & 1).n; });
    if (i < 2) r += [a, b, b2, c2, d].join("|") + ";";
  }
  p("d " + s + " " + r);
})();

// e: Reflect.construct with a different newTarget (function, class, bound, proxy)
class EB { constructor() { this.nt = new.target && new.target.name; this.pr = Object.getPrototypeOf(this) === (new.target && new.target.prototype); } }
class E1 extends EB { constructor() { super(); this.e1 = 1; } }
function NT() {}
NT.prototype.fromNT = "nt";
class NC {} NC.prototype.fromNC = "nc";
var boundNT = NT.bind(null);
var proxNT = new Proxy(NT, {});
var getCount = 0;
var proxGet = new Proxy(NT, { get(t, k, r) { if (k === "prototype") getCount++; return Reflect.get(t, k, r); } });
(function () {
  var r = "", s = 0;
  for (var i = 0; i < N; i++) {
    var nts = [NT, NC, E1, boundNT, proxNT, proxGet, Array, Proxy];
    for (var j = 0; j < nts.length; j++) {
      var o = Reflect.construct(E1, [], nts[j]);
      s += (o.pr ? 1 : 0) + (o.fromNT ? 2 : 0) + (o.fromNC ? 4 : 0) + o.e1;
      if (i === 0) r += j + ":" + o.nt + ":" + o.pr + ":" + Array.isArray(o) + ";";
    }
  }
  p("e " + s + " " + r + " gets=" + getCount);
})();

// f: extending built-ins
class MyArr extends Array { constructor(...a) { super(...a); this.extra = a.length; } }
class MyErr extends Error { constructor(m) { super(m); this.name = "MyErr"; } }
class MyMap extends Map { constructor(it) { super(it); this.mm = this.size; } }
(function () {
  var r = "", s = 0;
  for (var i = 0; i < N; i++) {
    var a = new MyArr(1, 2, i), e = new MyErr("m" + i), m = new MyMap([[1, i], [2, 3]]);
    s += a.length + a[2] + a.extra + (a instanceof MyArr ? 1 : 0) + (Array.isArray(a) ? 1 : 0) + e.message.length + (e instanceof Error ? 1 : 0) + m.get(1) + m.mm;
    if (i === 1) r = a.join() + "," + String(e) + "," + m.size + "," + new MyArr(3).length;
  }
  p("f " + s + " " + r);
})();

// g: null-prototype, bound, Proxy, function superclasses; changing the superclass
class GN extends null { constructor() { return Object.create(GN.prototype); } }
class GN2 extends null { constructor() { super(); } }
function FBase(x) { this.fb = x; }
FBase.prototype.fbp = 1;
var BoundBase = FBase.bind(null, 42);
BoundBase.prototype = FBase.prototype;  // bound functions have no own prototype
class GB extends BoundBase { constructor() { super(); this.g = 1; } }
var ProxBase = new Proxy(FBase, {});
class GP extends ProxBase { constructor(x) { super(x); this.gp = 1; } }
class GF extends FBase { constructor(x) { super(x * 2); } }
class GS extends FBase { constructor(x) { super(x); } }
(function () {
  var r = "", s = 0;
  for (var i = 0; i < N; i++) {
    var a = new GN();
    var b = tryIt(function () { return new GN2(); });
    var c = new GB(), d = new GP(i), f = new GF(i);
    if (i === N / 2) Object.setPrototypeOf(GS, function Other(x) { this.other = x; });
    var g = new GS(i);
    s += (a instanceof GN ? 1 : 0) + c.fb + c.g + d.fb + d.gp + f.fb + (f.fbp | 0) + (g.fb !== undefined ? g.fb : 1000 + g.other);
    if (i === 0) r = b + "," + (c instanceof GB) + "," + (d instanceof FBase);
  }
  p("g " + s + " " + r);
})();

// h: exceptions in base caught in derived; spread; deep recursion through super
class HB { constructor(k) { if (k % 3 === 0) throw new TypeError("hb" + k); this.k = k; } }
class H1 extends HB { constructor(k) { try { super(k); } catch (e) { this.caught = e.message; } } }
class H2 extends HB { constructor(k) { var ok = false; try { super(k); ok = true; } catch (e) { super(k + 1); } this.ok = ok; } }
class HS { constructor(...a) { this.sum = a.reduce(function (x, y) { return x + y; }, 0); this.n = a.length; } }
class HS1 extends HS { constructor(...args) { super(...args, 1); } }
class HS2 extends HS { constructor(a, b) { super(...[a, b], ...[b]); } }
class Rec { constructor(n) { this.depth = n; } }
class RecD extends Rec { constructor(n) { super(n); this.child = n > 0 ? new RecD(n - 1) : null; } }
(function () {
  var r = "", s = 0;
  for (var i = 0; i < N; i++) {
    var a = tryIt(function () { var o = new H1(i); return o.caught; });
    var b = new H2(i);
    var c = new HS1(i, 2, 3), d = new HS2(i, 1);
    s += b.k + (b.ok ? 1 : 0) + c.sum + c.n + d.sum + d.n;
    if (i < 4) r += a + "|";
  }
  // Depth 200: deeper recursion through cold/interpreted constructors can
  // overflow the browser wasm stack (see deep.js in README.md).
  var depth = 0, t = null;
  try { t = new RecD(200); } catch (e) { depth = -1; }
  while (t) { depth++; t = t.child; }
  p("h " + s + " " + r + " depth=" + depth);
})();

// i: super() inside eval / with new.target undefined guard, default ctor chains
class IB { constructor(a, b) { this.ab = a + "," + b; } }
class I1 extends IB {}
class I2 extends I1 {}
class I3 extends IB { constructor() { eval("super(1, 2)"); } }
(function () {
  var r = "";
  for (var i = 0; i < N; i++) {
    var o = new I2(i, "x"), q = new I3();
    if (i === N - 1) r = o.ab + " " + q.ab + " " + (o instanceof I1);
  }
  p("i " + r);
})();
// j: super() into a base class whose new.target's prototype object, or the
// prototype's shape, changes between hot calls (super `this` cache guards).
function JBase(v) { this.v = v; }
class J1 extends JBase { constructor(v) { super(v); } }
class J2 extends JBase { constructor(v) { super(v); this.w = 1; } }
(function () {
  var r = [];
  var protoA = J1.prototype;
  for (var i = 0; i < N; i++) {
    var o = new J1(i), q = new J2(i);
    if (i === (N >> 1)) {
      // Rebinding a class's prototype is not allowed; change what new.target
      // resolves to through Reflect.construct instead, and mutate the prototype.
      protoA.extra = "e";
      Object.setPrototypeOf(protoA, { inherited: "h", __proto__: JBase.prototype });
    }
    if (i % 100 === 99) {
      r.push(o.v + ":" + (o.extra || "-") + ":" + (o.inherited || "-") + ":" + (q.w) + ":" +
             (Object.getPrototypeOf(o) === J1.prototype) + ":" + (o instanceof JBase));
    }
  }
  var F = function () {};
  F.prototype = { tag: "F1" };
  var t1 = Reflect.construct(J1, [1], F).tag, out2 = [];
  for (var k = 0; k < N; k++) {
    if (k === (N >> 1)) F.prototype = { tag: "F2" };
    var z = Reflect.construct(J1, [k], F);
    if (k === 0 || k === N - 1 || k === (N >> 1)) out2.push(z.tag + "/" + z.v);
  }
  p("j " + r.join(" ") + " | " + t1 + " " + out2.join(" "));
})();
print("SC end 1111");
