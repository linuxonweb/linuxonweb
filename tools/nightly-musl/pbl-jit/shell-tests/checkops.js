// PBLBC_CHECKOPS semantics test: CheckObjCoercible, CheckThis,
// CheckThisReinit, CheckReturn, Mod, Typeof/TypeofExpr, TypeofEq.
// Every case runs in a hot loop (>= 300 iterations); output must be identical
// with tiers off, default and PBLBC_HITS=2.
var N = 300;
var out = [];
function rec(tag, f) {
  var last = "", changes = 0;
  for (var i = 0; i < N; i++) {
    var r;
    try { r = "ok:" + String(f(i)); } catch (e) { r = "ex:" + (e && e.constructor && e.constructor.name) + ":" + (e && e.message); }
    if (r !== last) { changes++; last = r; if (changes <= 3) out.push(tag + " i=" + i + " " + r); }
  }
  out.push(tag + " final " + last + " changes=" + changes);
}
function sd(i) { return Symbol.prototype.toString.call(i); }

// CheckObjCoercible (destructuring)
var coVals = [null, undefined, 0, "", "ab", true, {a: 1}, [1, 2], 5n, Symbol("s")];
for (var k = 0; k < coVals.length; k++) {
  (function (v, k) {
    rec("co" + k, function (i) { var {a} = v; return typeof a + ":" + (typeof a === "symbol" ? "" : String(a)); });
    rec("coarr" + k, function (i) { var {length} = v; return String(length); });
  })(coVals[k], k);
}
function coMix(i) { var v = (i % 7 == 6) ? (i % 2 ? null : undefined) : {a: i}; var {a} = v; return a; }
rec("comix", coMix);
function coParam({x, y}) { return x + y; }
rec("coparam", function (i) { return coParam(i % 50 == 49 ? undefined : {x: i, y: 1}); });

// Derived constructors: CheckThis, CheckThisReinit, CheckReturn
class Base { constructor(v) { this.v = v; } }
class D1 extends Base { constructor(i) { super(i); this.w = i * 2; } }
class D2 extends Base { constructor(i) { super(i); return {obj: i}; } }
class D3 extends Base { constructor(i) { super(i); return undefined; } }
class D4 extends Base { constructor(i) { super(i); return i; } }
class D5 extends Base { constructor(i) { if (i % 3 == 0) super(i); } }
class D6 extends Base { constructor(i) { super(i); if (i % 4 == 0) super(i); } }
class D7 extends Base { constructor(i) { this.x = 1; super(i); } }
class D8 extends Base { constructor(i) { return {r: i}; } }
class D9 extends Base { constructor(i) { if (i % 5 == 0) return null; super(i); } }
class D10 extends Base { constructor(i) { var f = () => this; super(i); return f() === this ? undefined : 1; } }
class D11 extends Base { constructor(i) { var f = () => super(i); f(); if (i % 6 == 0) f(); } }
class D12 extends Base { constructor(i) { super(i); return i % 2 ? function () {} : "str"; } }
class D13 extends Base { constructor() { var a = () => this.v; try { a(); } catch (e) { super(7); return {caught: e.message}; } } }
class E0 {}
class E1 extends E0 { constructor(i) { super(); this.k = i; } }
class E2 extends E1 { constructor(i) { super(i); } }
class E3 extends Object { constructor(i) { super(); } }
var ctors = [D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, D13, E1, E2, E3];
for (var k = 0; k < ctors.length; k++) {
  (function (C, k) {
    rec("ctor" + k, function (i) { var o = new C(i); return JSON.stringify(o) + ":" + (o instanceof C); });
  })(ctors[k], k);
}

// Mod
var modVals = [0, -0, 1, -1, 2, -2, 3, 7, -7, 2147483647, -2147483648, 0.5, -0.5, 2.75, -2.75, 1e300, -1e-300, NaN, Infinity, -Infinity, 4294967296];
function fmt(x) { return (x === 0 && 1 / x < 0) ? "-0" : String(x); }
function modAll(i) {
  var s = "";
  for (var a = 0; a < modVals.length; a++)
    for (var b = 0; b < modVals.length; b++)
      s += fmt(modVals[a] % modVals[b]) + ",";
  return s.length + ":" + s.slice(0, 64) + ":" + s.slice(-64);
}
rec("modall", modAll);
function modHash(i) {
  var s = "";
  var a = modVals[i % modVals.length], b = modVals[(i * 7) % modVals.length];
  s += fmt(a % b) + "|" + fmt(-i % 5) + "|" + fmt(i % -5) + "|" + fmt((i - 150) % 7) + "|" + fmt(-2147483648 % -1) + "|" + fmt(i % 0) + "|" + fmt(0 % (i + 1)) + "|" + fmt(-0 % (i + 1)) + "|" + fmt((i + 0.25) % 3);
  return s;
}
rec("modhash", modHash);
rec("modstr", function (i) { return fmt("17" % (i % 4)) + "|" + fmt(i % "3") + "|" + fmt(true % 2) + "|" + fmt(null % 3) + "|" + fmt(undefined % 2) + "|" + fmt([5] % 3) + "|" + fmt({valueOf() { return i; }} % 7); });
rec("modbig", function (i) { return String(BigInt(i) % 7n) + "|" + String(-BigInt(i) % 7n) + "|" + (i % 10 == 0 ? (1n % 0n) : 0); });
rec("modmix", function (i) { try { return String(5n % i); } catch (e) { return e.constructor.name + ":" + e.message; } });
var acc = 0;
rec("modsum", function (i) { var t = 0; for (var j = -50; j < 50; j++) t += j % 7 + (j * 0.5) % 3; acc += t; return t + ":" + acc; });

// typeof / TypeofEq
var callableProxy = new Proxy(function () {}, {});
var plainProxy = new Proxy({}, {});
var revocable = Proxy.revocable(function () {}, {}); revocable.revoke();
var revocable2 = Proxy.revocable({}, {}); revocable2.revoke();
var tyVals = [undefined, null, true, false, 0, -0, 1.5, NaN, "", "s", Symbol("t"), 0n, 12345678901234567890n,
  {}, [], function () {}, class {}, () => 1, async function () {}, function* () {}, callableProxy, plainProxy,
  revocable.proxy, revocable2.proxy, new Date(0), /re/, Math.max, Object, new Map(), Object.create(null),
  new Proxy(class {}, {}), Function.prototype];
if (typeof createIsHTMLDDA === "function") tyVals.push(createIsHTMLDDA());
if (typeof document !== "undefined" && document.all) tyVals.push(document.all);
out.push("nvals " + tyVals.length);
for (var k = 0; k < tyVals.length; k++) {
  (function (v, k) {
    rec("ty" + k, function (i) {
      return typeof v + "|" + (typeof v === "object") + (typeof v == "function") + (typeof v !== "undefined") +
        (typeof v === "string") + (typeof v != "number") + (typeof v === "boolean") + (typeof v === "symbol") +
        (typeof v === "bigint") + (typeof v != "object") + (typeof v !== "function") + (typeof v === "undefined");
    });
  })(tyVals[k], k);
}
rec("tymix", function (i) { var v = tyVals[i % tyVals.length]; var t = typeof v; return t + (typeof v === "function") + (typeof v === "object") + (typeof v === "undefined"); });
rec("tyexpr", function (i) { var v = tyVals[i % tyVals.length]; return (typeof (v)).length + typeof typeof v; });
rec("tyundecl", function (i) { return typeof notDeclaredAnywhere + (typeof notDeclaredAnywhere === "undefined"); });

print(out.join("\n"));
print("DONE lines=" + out.length);
