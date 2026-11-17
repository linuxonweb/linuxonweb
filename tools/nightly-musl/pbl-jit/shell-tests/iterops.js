// for-of / for-in / super / new.target semantics under the PBLBC tiers.
var out = [];
function P(s) { out.push(String(s)); }
function T(name, f) {
  var r;
  try { r = f(); } catch (e) { r = "EXC:" + (e && e.message); }
  P(name + "=" + (typeof r === "object" && r !== null ? JSON.stringify(r) : r));
}
var N = 300;

function sumOf(a) { var s = 0; for (var x of a) s += (x === undefined ? 1000 : x); return s; }
T("arr", function () { var t = 0; for (var i = 0; i < N; i++) t += sumOf([1, 2, 3, i]); return t; });
T("holey", function () { var t = 0; for (var i = 0; i < N; i++) { var a = [1, , 3]; a[5] = i; t += sumOf(a); } return t; });
T("instIter", function () {
  var t = 0;
  for (var i = 0; i < N; i++) {
    var a = [1, 2, 3];
    if (i % 7 == 3) a[Symbol.iterator] = function* () { yield 10; yield 20; };
    t += sumOf(a);
  }
  return t;
});
T("mutate", function () {
  var t = 0;
  for (var i = 0; i < N; i++) {
    var a = [1, 2, 3], n = 0;
    for (var x of a) { if (n++ < 3) a.push(x * 2); t += x; if (i % 5 == 0) a.length = 1; }
  }
  return t;
});
T("map", function () { var t = 0; var m = new Map([[1, 2], [3, 4]]); for (var i = 0; i < N; i++) for (var [k, v] of m) t += k * v + i; return t; });
T("set", function () { var t = 0; var m = new Set([1, 5, 9]); for (var i = 0; i < N; i++) for (var v of m) t += v; return t; });
T("str", function () { var t = ""; for (var i = 0; i < N; i++) for (var c of "a\u{1F600}b") t = c + t.slice(0, 20); return t; });
T("gen", function () { function* g(n) { for (var j = 0; j < n; j++) yield j; } var t = 0; for (var i = 0; i < N; i++) for (var v of g(i % 5)) t += v; return t; });
function mkIter(log, thr) {
  var o = {};
  o[Symbol.iterator] = function () {
    var j = 0;
    return {
      next: function () { log.push("n"); return { value: j, done: j++ >= 3 }; },
      return: function () { log.push("r"); if (thr) throw new Error("ret-throw"); return {}; }
    };
  };
  return o;
}
T("custom", function () {
  var log = [], t = 0;
  for (var i = 0; i < N; i++) {
    var mode = i % 4;
    try {
      (function () {
        for (var v of mkIter(log, i % 8 == 7)) {
          t += v;
          if (mode == 1 && v == 1) break;
          if (mode == 2 && v == 1) return;
          if (mode == 3 && v == 1) throw new Error("body");
        }
      })();
    } catch (e) { log.push(e.message); }
  }
  return t + ":" + log.length + ":" + log.slice(-40).join(",");
});
T("notIterable", function () { var c = 0, m = ""; for (var i = 0; i < N; i++) { try { for (var x of (i % 3 ? [1] : {})) c++; } catch (e) { m = e.message; } } return c + m; });
T("nullIter", function () { var m = ""; for (var i = 0; i < N; i++) { try { for (var x of (i % 2 ? null : undefined)) ; } catch (e) { m = e.message; } } return m; });
T("spread", function () { var t = 0; for (var i = 0; i < N; i++) { var [a, b, ...r] = [i, 2, 3, 4]; t += a + b + r.length; } return t; });

// Modify the array iterator fuses late (after the loops are hot).
function forofHot(a) { var s = 0; for (var x of a) s += x; return s; }
T("pre", function () { var t = 0; for (var i = 0; i < N; i++) t += forofHot([1, 2, i]); return t; });
var origNext = Object.getPrototypeOf([][Symbol.iterator]()).next;
T("modNext", function () {
  var t = 0;
  var AIP = Object.getPrototypeOf([][Symbol.iterator]());
  AIP.next = function () { var r = origNext.call(this); if (!r.done) r.value *= 10; return r; };
  for (var i = 0; i < N; i++) t += forofHot([1, 2, i]);
  AIP.next = origNext;
  for (var i = 0; i < N; i++) t += forofHot([1, 2, i]);
  return t;
});
T("modProtoIter", function () {
  var t = 0, orig = Array.prototype[Symbol.iterator];
  Array.prototype[Symbol.iterator] = function* () { yield 7; };
  for (var i = 0; i < N; i++) t += forofHot([1, 2, i]);
  Array.prototype[Symbol.iterator] = orig;
  for (var i = 0; i < N; i++) t += forofHot([1, 2, i]);
  return t;
});

// for-in
function keysOf(o) { var r = []; for (var k in o) r.push(k); return r.join(","); }
T("forinProto", function () {
  var r; function C() { this.a = 1; this.b = 2; } C.prototype.p = 3; C.prototype.b = 9;
  for (var i = 0; i < N; i++) { var o = new C(); if (i % 3 == 0) o.z = i; r = keysOf(o); } return r;
});
T("forinDelete", function () {
  var r = "";
  for (var i = 0; i < N; i++) { var o = { a: 1, b: 2, c: 3, d: 4 }; var ks = []; for (var k in o) { ks.push(k); if (k == "a") { delete o.c; o.e = 5; } } r = ks.join(","); }
  return r;
});
T("forinNonEnum", function () {
  var r = ""; var proto = { x: 1 }; Object.defineProperty(proto, "h", { value: 1, enumerable: false });
  for (var i = 0; i < N; i++) { var o = Object.create(proto); Object.defineProperty(o, "x", { value: 2, enumerable: false }); o.y = 3; r = keysOf(o); }
  return r;
});
T("forinMisc", function () {
  var r = [];
  for (var i = 0; i < N; i++) r = [keysOf([5, , 7]), keysOf("ab"), keysOf(null), keysOf(undefined), keysOf(5), keysOf(i % 2 ? { 2: 1, 1: 1, b: 1, a: 1 } : new Proxy({ q: 1 }, {}))];
  return r;
});
T("forinBreak", function () { var t = 0; for (var i = 0; i < N; i++) for (var k in { a: 1, b: 2, c: 3 }) { t++; if (k == "b") break; } return t; });

// super / new.target
class A { m() { return "A.m:" + this.v; } get g() { return "A.g"; } static s() { return "A.s"; } }
class B extends A {
  constructor(v) { super(); this.v = v; this.nt = new.target === B ? "B" : String(new.target && new.target.name); }
  m() { return "B>" + super.m() + "|" + super.g + "|" + super.missing; }
  static s() { return "B>" + super.s(); }
  arrow() { return (() => super.m())(); }
}
class C2 extends B { constructor() { super(5); } }
T("super", function () { var r; for (var i = 0; i < N; i++) { var b = new B(i); r = b.m() + b.arrow() + B.s() + b.nt + new C2().nt; } return r; });
T("superObj", function () {
  var base = { f() { return "base.f"; }, x: 1 }, r;
  var o = { __proto__: base, f() { return "o>" + super.f() + super.x; } };
  for (var i = 0; i < N; i++) { if (i == 200) Object.setPrototypeOf(o, { f() { return "other"; }, x: 2 }); r = o.f(); }
  return r;
});
T("superNull", function () {
  var o = { f() { return super.f(); } }, m = "";
  Object.setPrototypeOf(o, null);
  for (var i = 0; i < N; i++) { try { o.f(); } catch (e) { m = e.message; } }
  return m;
});
T("superCtorChange", function () {
  var m = "";
  class X { constructor() { this.k = "X"; } }
  class Y { constructor() { this.k = "Y"; } }
  class Z extends X { constructor() { super(); } }
  for (var i = 0; i < N; i++) { if (i == 250) Object.setPrototypeOf(Z, Y); if (i == 280) Object.setPrototypeOf(Z, null); try { m = new Z().k; } catch (e) { m = e.message; } }
  return m;
});
T("newTarget", function () {
  var r;
  function F() { return new.target === undefined ? "call" : (new.target === F ? "new" : "other"); }
  function G() { return (() => new.target)(); }
  for (var i = 0; i < N; i++) r = [F(), new F() instanceof F, Reflect.construct(F, [], Object) instanceof Object, G() === undefined, typeof new G()];
  return r;
});
print(out.join("\n"));
