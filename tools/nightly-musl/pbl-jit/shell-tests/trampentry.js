// PBLBC_TRAMPENTRY semantics test: calls from natives into (compiled) JS.
var out = [];
function P(s) { print(String(s)); }
function msg(e) { return (e && e.constructor && e.constructor.name) + ":" + (e && e.message); }
var N = 300;

// 1. sort comparators
(function () {
  var acc = 0;
  for (var i = 0; i < N; i++) {
    var a = [5, 3, 9, 1, 7, i % 11, 4];
    a.sort(function (x, y) { return x - y; });
    acc += a[0] * 1 + a[6];
    var b = [3, 1, 2];
    b.sort(function (x, y) { return x < y ? "-1" : (x > y ? {valueOf() { return 1; }} : 0); });
    acc += b[0];
    var c = [4, 2, 8, 6];
    c.sort(function (x, y) { c.length; c[0] = c[0]; return y - x; });
    acc += c[0];
    try {
      [1, 2, 3].sort(function (x, y) { if (x == 2 || y == 2) throw new Error("cmp" + (i % 3)); return x - y; });
    } catch (e) { if (i % 100 == 0) P("sort throw " + msg(e)); }
    var nested = [[3, 1], [2, 9], [0, 5]];
    nested.sort(function (x, y) { x.sort(function (p, q) { return q - p; }); return x[0] - y[0]; });
    acc += nested[0][0];
    if (i == 150) {
      var cold = new Function("x", "y", "return (x % 7) - (y % 7);");
      acc += [10, 20, 30].sort(cold)[0];
    }
  }
  P("sort acc " + acc);
})();

// 2. getters / setters from polymorphic sites
(function () {
  var objs = [];
  var sv = 0;
  for (var k = 0; k < 6; k++) {
    var o = {};
    o["p" + k] = k;
    Object.defineProperty(o, "v", {
      get: (function (k) { return function () { if (k == 5 && sv % 97 == 3) throw new TypeError("get" + k); return k == 4 ? {k: k} : k * 2; }; })(k),
      set: function (x) { if (x === -1) throw new RangeError("set"); sv += x; },
      configurable: true
    });
    objs.push(o);
  }
  var acc = 0;
  for (var i = 0; i < N * 3; i++) {
    var o = objs[i % 6];
    try {
      var r = o.v;
      acc += typeof r == "object" ? r.k : r;
      o.v = i % 5;
      if (i % 250 == 7) o.v = -1;
    } catch (e) { if (i % 50 < 3) P("acc " + i + " " + msg(e)); }
  }
  P("getset " + acc + " " + sv);
})();

// 3. apply / call with fewer/more args, arguments
(function () {
  function f3(a, b, c) { return [a, b, c, arguments.length].join(","); }
  function fa() { var s = 0; for (var j = 0; j < arguments.length; j++) s += arguments[j]; return s + ":" + this.t; }
  function fwd() { return f3.apply(this, arguments); }
  var obj = {t: 7};
  var acc = "";
  for (var i = 0; i < N; i++) {
    var r1 = fwd(1);
    var r2 = fwd(1, 2, 3, 4, 5);
    var r3 = fa.call(obj, 1, 2, i);
    var r4 = fa.apply(obj, [i]);
    var r5 = f3.call(null);
    if (i % 100 == 0) acc += r1 + "|" + r2 + "|" + r3 + "|" + r4 + "|" + r5 + ";";
  }
  P("apply " + acc);
})();

// 4. closures needing environment objects
(function () {
  var acc = 0;
  for (var i = 0; i < N; i++) {
    var arr = [i, 1, 2].map(function (x) { var y = x * 2; var g = function () { return y + x; }; return g(); });
    acc += arr[0] + arr[2];
    var fs = [];
    [1, 2, 3].forEach(function (x) { let z = x; fs.push(() => z * i); });
    acc += fs[2]();
  }
  P("env " + acc);
})();

// 5. constructors
(function () {
  function C(a, b) { this.a = a; this.b = b; }
  function Prim(a) { this.a = a; return 42; }
  function Obj(a) { this.a = a; return {o: a}; }
  class Base { constructor(x) { this.x = x; } }
  class Der extends Base { constructor(x) { super(x + 1); this.y = x; } }
  class DerRet extends Base { constructor(x) { super(x); return {r: x}; } }
  class DerPrim extends Base { constructor(x) { super(x); return 3; } }
  class DerNoSuper extends Base { constructor(x) { if (x > 1e9) super(x); } }
  var acc = 0, log = "";
  for (var i = 0; i < N; i++) {
    var c1 = Reflect.construct(C, [i, 2]);
    var c2 = new (Function.prototype.bind.apply(C, [null, i, 3]))();
    var c3 = Reflect.construct(Prim, [i]);
    var c4 = Reflect.construct(Obj, [i]);
    var c5 = Reflect.construct(Der, [i]);
    var c6 = Reflect.construct(DerRet, [i]);
    var c7 = Reflect.construct(Base, [i], Der);
    acc += c1.a + c1.b + c2.b + c3.a + c4.o + c5.x + c5.y + c6.r + c7.x + (c7 instanceof Der ? 1 : 0);
    try { Reflect.construct(DerPrim, [i]); } catch (e) { if (i % 100 == 0) log += msg(e) + ";"; }
    try { Reflect.construct(DerNoSuper, [i]); } catch (e) { if (i % 100 == 0) log += msg(e) + ";"; }
  }
  P("ctor " + acc + " " + log);
})();

// 6. generators / async called from natives
(function () {
  function* gen(n) { for (var j = 0; j < n; j++) yield j * 2; }
  var acc = 0;
  for (var i = 0; i < N; i++) {
    acc += Array.from(gen(i % 5)).reduce(function (a, b) { return a + b; }, 0);
    var g = [3].map(gen)[0];
    acc += g.next().value + (g.next().done ? 1 : 0);
  }
  async function af(x) { var y = await x; return y + 1; }
  var res = [];
  for (var i = 0; i < N; i++) [i].map(af)[0].then(function (v) { if (v % 100 == 1) res.push(v); });
  drainJobQueue();
  P("gen " + acc + " async " + res.join(","));
})();

// 7. first op exits / misc
(function () {
  function firstExit(x, y) { return typeof x == "symbol" ? 0 : (x | 0) - (y | 0); }
  function usesArgsFirst() { return arguments.length; }
  function thisFirst() { "use strict"; return this; }
  var acc = 0;
  for (var i = 0; i < N; i++) {
    acc += [3, 1, 2].sort(firstExit)[0];
    acc += usesArgsFirst.apply(null, [1, 2, 3]);
    acc += thisFirst.call(5) + (thisFirst.call(undefined) === undefined ? 1 : 0);
  }
  P("misc " + acc);
})();

// 9. exceptions through several native layers
(function () {
  var r = "";
  for (var i = 0; i < N; i++) {
    try {
      [1].map(function (x) {
        return [2, 1].sort(function (a, b) {
          return [0].reduce(function () {
            return Reflect.apply(function () { if (i % 7 == 3) throw new SyntaxError("deep" + i); return a - b; }, null, []);
          }, 0);
        });
      });
    } catch (e) { if (i % 70 == 3) r += msg(e) + ";"; }
  }
  P("layers " + r);
})();

print("END");
